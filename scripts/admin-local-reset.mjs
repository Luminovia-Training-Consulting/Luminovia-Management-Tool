/** Loopback-only browser entry point for the existing local Docker reset. */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { join } from "node:path";
import { localResetTarget, readLocalResetReceipt } from "./local-reset.mjs";
import {
  cleanEnvironment,
  processIsOurs,
  readState,
  root,
} from "./runtime-lib.mjs";

const path = "/__portal/local-reset";
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const loopback = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

function reply(res, status, body) {
  res
    .writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    })
    .end(JSON.stringify(body));
}

async function readBody(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 4096) return null;
  }
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

/** Verify the current browser user and independently reauthenticate the same identity. */
export async function authorizeReset(
  api,
  key,
  browserToken,
  password,
  code,
  request = fetch,
) {
  async function auth(pathname, token, body) {
    const res = await request(api + pathname, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    return res.ok ? await res.json() : null;
  }
  async function activeAdmin(token, id) {
    if (!uuid.test(id ?? "")) return false;
    const [profile, roles] = await Promise.all([
      auth(`/rest/v1/profiles?select=active&id=eq.${id}`, token),
      auth(`/rest/v1/user_roles?select=role&user_id=eq.${id}`, token),
    ]);
    return (
      profile?.[0]?.active === true &&
      roles?.some(({ role }) => role === "admin" || role === "owner")
    );
  }

  const actor = await auth("/auth/v1/user", browserToken);
  if (
    !actor?.email_confirmed_at ||
    !(await activeAdmin(browserToken, actor.id))
  )
    return false;
  const signedIn = await auth("/auth/v1/token?grant_type=password", key, {
    email: actor.email,
    password,
  });
  if (signedIn?.user?.id !== actor.id || !signedIn.access_token) return false;
  let token = signedIn.access_token;
  try {
    const current = await auth("/auth/v1/user", token);
    if (current?.id !== actor.id) return false;
    const factors = (current.factors ?? []).filter(
      ({ factor_type, status }) =>
        factor_type === "totp" && status === "verified",
    );
    if (factors.length) {
      if (!/^\d{6}$/.test(code ?? "") || !uuid.test(factors[0].id))
        return false;
      const factor = `/auth/v1/factors/${factors[0].id}`;
      const challenge = await auth(factor + "/challenge", token, {});
      if (!uuid.test(challenge?.id ?? "")) return false;
      const verified = await auth(factor + "/verify", token, {
        challenge_id: challenge.id,
        code,
      });
      if (!verified?.access_token) return false;
      token = verified.access_token;
    }
    return await activeAdmin(token, actor.id);
  } finally {
    // Auth returns an empty response on logout. A failed cleanup cannot authorize deletion.
    await request(api + "/auth/v1/logout?scope=local", {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    }).catch(() => {});
  }
}

export function configureLocalReset(server, publishableKey, supervisor) {
  let config;
  try {
    config = localResetTarget(root);
  } catch {
    // An unsupported checkout can still run the app. It cannot reset through it.
    return;
  }
  const origin = new URL(config.site);
  const api = `http://127.0.0.1:${config.api}`;
  let starting = false;
  const ownsInstance = () => {
    const state = readState();
    return (
      state?.session === supervisor &&
      state.projectId === config.id &&
      state.phase === "ready" &&
      processIsOurs(state)
    );
  };
  server.middlewares.use((req, res, next) => {
    if (req.url?.split("?")[0] !== path) return next();
    if (
      !loopback.has(req.socket.remoteAddress) ||
      req.headers.host !== origin.host ||
      req.headers["sec-fetch-site"] === "cross-site" ||
      !ownsInstance()
    )
      return reply(res, 403, { error: "unavailable" });
    if (req.method === "GET") return reply(res, 200, { project: config.id });
    if (
      req.method !== "POST" ||
      req.headers.origin !== origin.origin ||
      req.headers["content-type"] !== "application/json"
    )
      return reply(res, 403, { error: "unavailable" });
    const browserToken = /^Bearer ([\w.-]+)$/.exec(
      req.headers.authorization ?? "",
    )?.[1];
    if (!browserToken) return reply(res, 401, { error: "denied" });
    if (starting || readLocalResetReceipt(root, config.id) === "running")
      return reply(res, 409, { error: "in_progress" });
    starting = true;
    void (async () => {
      const body = await readBody(req);
      if (
        body?.confirmation !== "DELETE" ||
        typeof body.password !== "string" ||
        !body.password ||
        body.password.length > 1024 ||
        (body.code !== undefined && typeof body.code !== "string")
      )
        return reply(res, 400, { error: "invalid_confirmation" });
      if (
        !(await authorizeReset(
          api,
          publishableKey,
          browserToken,
          body.password,
          body.code,
        ))
      )
        return reply(res, 403, { error: "denied" });
      if (!ownsInstance() || localResetTarget(root).id !== config.id)
        return reply(res, 409, { error: "unavailable" });
      const id = randomUUID();
      const child = spawn(
        process.execPath,
        [join(root, "scripts/admin-local-reset-worker.mjs"), config.id, id],
        { cwd: root, detached: true, env: cleanEnvironment(), stdio: "ignore" },
      );
      // Keep this middleware locked until the detached reset process exits.
      child.once("exit", () => {
        starting = false;
      });
      await once(child, "spawn");
      child.unref();
      reply(res, 202, { receipt: id });
    })()
      .catch(() => reply(res, 503, { error: "unavailable" }))
      .finally(() => {
        if (res.statusCode !== 202) starting = false;
      });
  });
}
