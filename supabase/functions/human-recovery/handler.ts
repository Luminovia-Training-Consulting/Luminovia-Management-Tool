import { boundedJson } from "../_shared/bounded-json.ts";

export interface RecoveryDependencies {
  reserve: (hash: string) => Promise<boolean>;
  resolveUsername: (username: string) => Promise<string | null>;
  waitUntil: (task: Promise<void>) => void;
  sendRecovery: (
    email: string,
    challenge: string,
    redirect: string,
  ) => Promise<void>;
}

const usernamePattern = /^[a-z][a-z0-9._-]{1,30}[a-z0-9]$/;
const challengePattern = /^[A-Za-z0-9_-]{43}$/;
const headersFor = (
  origin: string | null,
  allowed: readonly string[],
): Record<string, string> => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store, private",
    "X-Content-Type-Options": "nosniff",
    "Vary": "Origin",
  };
  if (origin && allowed.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Headers"] =
      "authorization,apikey,content-type,x-client-info";
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
  }
  return headers;
};

/** Generic accepted responses avoid confirming whether an alias or email exists. */
export function createHumanRecoveryHandler(
  deps: RecoveryDependencies,
  allowedOrigins: readonly string[],
) {
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get("Origin");
    const headers = headersFor(origin, allowedOrigins);
    const reply = (status: number, error?: string) =>
      new Response(JSON.stringify(error ? { error } : {}), { status, headers });
    const path = new URL(request.url).pathname;
    if (!["/human-recovery", "/functions/v1/human-recovery"].includes(path)) {
      return reply(404, "not_found");
    }
    if (!origin || !allowedOrigins.includes(origin)) {
      return reply(403, "invalid_request");
    }
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== "POST") return reply(405, "invalid_request");
    if (
      request.headers.get("Content-Type")?.split(";")[0].trim()
        .toLowerCase() !== "application/json"
    ) {
      return reply(415, "invalid_request");
    }
    let raw: unknown;
    try {
      raw = await boundedJson(request, 1024);
    } catch {
      return reply(400, "invalid_request");
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return reply(400, "invalid_request");
    }
    const body = raw as Record<string, unknown>;
    if (
      Object.keys(body).some((key) =>
        !["username", "code_challenge", "code_challenge_method", "redirect_to"]
          .includes(key)
      ) ||
      typeof body.username !== "string" ||
      !usernamePattern.test(body.username) ||
      typeof body.code_challenge !== "string" ||
      !challengePattern.test(body.code_challenge) ||
      body.code_challenge_method !== "s256" ||
      body.redirect_to !== `${origin}/auth/callback`
    ) {
      return reply(400, "invalid_request");
    }
    const { username, code_challenge: challenge, redirect_to: redirect } = body;
    // Return before looking up the alias or contacting Auth, so delivery latency
    // does not distinguish an existing alias from an unknown one.
    deps.waitUntil(
      (async () => {
        const digest = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(`recover:${username}`),
        );
        const hash = [...new Uint8Array(digest)].map((byte) =>
          byte.toString(16).padStart(2, "0")
        ).join("");
        if (await deps.reserve(hash)) {
          const email = await deps.resolveUsername(username);
          if (email) await deps.sendRecovery(email, challenge, redirect);
        }
      })().catch(() => undefined),
    );
    return reply(202);
  };
}
