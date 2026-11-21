/** Delivers a bounded batch of committed, company-scoped course events. */
import { createHmac } from "node:crypto";
import { lookup } from "node:dns/promises";
import https from "node:https";
import { isIP } from "node:net";
import { pathToFileURL } from "node:url";
import { publicAddress } from "./notification-push-worker.mjs";

const destinationName =
  /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\/[a-z][a-z0-9-]{0,39}$/;

/** Require an exact operator-configured HTTPS destination for each tenant and alias. */
export function webhookConfiguration(env) {
  const api = new URL(env.PORTAL_WEBHOOK_API_URL);
  const serviceKey = env.PORTAL_WEBHOOK_SERVICE_KEY;
  if (
    !(
      api.protocol === "https:" ||
      (api.protocol === "http:" &&
        ["127.0.0.1", "[::1]"].includes(api.hostname))
    ) ||
    api.username ||
    api.password ||
    api.search ||
    api.hash ||
    !["/", "/backend", "/backend/"].includes(api.pathname) ||
    !serviceKey ||
    /\s/.test(serviceKey)
  )
    throw new Error("invalid_webhook_configuration");
  const encoded = env.PORTAL_WEBHOOK_DESTINATIONS ?? "{}";
  if (encoded.length > 65536) throw new Error("invalid_webhook_destinations");
  const entries = Object.entries(JSON.parse(encoded));
  if (entries.length > 100) throw new Error("invalid_webhook_destinations");
  const destinations = new Map(
    entries.map(([name, value]) => {
      if (
        !destinationName.test(name) ||
        typeof value !== "string" ||
        value.length > 2048 ||
        /[\s\\]/.test(value)
      )
        throw new Error("invalid_webhook_destination");
      const url = new URL(value);
      if (
        url.protocol !== "https:" ||
        url.port ||
        url.username ||
        url.password ||
        url.hash ||
        url.search ||
        isIP(url.hostname) ||
        !url.hostname.includes(".")
      )
        throw new Error("invalid_webhook_destination");
      return [name, url];
    }),
  );
  return { api: api.href.replace(/\/$/, ""), serviceKey, destinations };
}

/** Build the exact bytes signed with the per-subscription key. */
export function signedWebhook(event, secret, now = Date.now()) {
  const body = JSON.stringify(event);
  const timestamp = String(Math.floor(now / 1000));
  const signature = createHmac("sha256", Buffer.from(secret, "hex"))
    .update(timestamp + "." + body, "utf8")
    .digest("hex");
  return {
    body,
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
      "X-Luminovia-Event-Id": event.id,
      "X-Luminovia-Timestamp": timestamp,
      "X-Luminovia-Signature": "v1=" + signature,
    },
  };
}

/** Direct HTTPS pins the checked DNS answer and never follows redirects. */
function sendWebhook(url, address, { body, headers }) {
  return new Promise((resolve) => {
    const request = https.request(
      url,
      {
        method: "POST",
        headers,
        agent: false,
        signal: AbortSignal.timeout(10000),
        lookup: (_hostname, options, callback) =>
          options.all
            ? callback(null, [address])
            : callback(null, address.address, address.family),
      },
      (response) => {
        const status = response.statusCode ?? 0;
        response.destroy();
        if (status >= 200 && status < 300) resolve("delivered");
        else
          resolve(
            status === 408 || status === 429 || status >= 500
              ? "retry"
              : "failed",
          );
      },
    );
    request.on("error", () => resolve("retry"));
    request.end(body);
  });
}

/** A DNS timeout cannot hold the single worker or its delivery lease. */
async function resolveWebhook(hostname) {
  let timer;
  try {
    return await Promise.race([
      lookup(hostname, { all: true }),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("webhook_dns_timeout")),
          5000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Service credentials are sent only to the configured REST backend. */
async function callBackend(config, action, arguments_) {
  const response = await fetch(config.api + "/rest/v1/rpc/" + action, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(10000),
    headers: {
      "content-type": "application/json",
      apikey: config.serviceKey,
      authorization: "Bearer " + config.serviceKey,
    },
    body: JSON.stringify(arguments_),
  });
  if (!response.ok) throw new Error("webhook_backend_failed");
  return response.status === 204
    ? null
    : JSON.parse((await response.text()) || "null");
}

/** Recheck the subscription after DNS resolution, as close to network I/O as possible. */
export async function dispatchCompanyWebhooks(
  config,
  { call = callBackend, resolve = resolveWebhook, send = sendWebhook } = {},
) {
  const names = Array.from(config.destinations.keys());
  if (!names.length) return 0;
  let processed = 0;
  for (; processed < 10; processed++) {
    const lease = await call(config, "lease_company_course_webhook", {
      p_destinations: names,
    });
    if (!lease) break;
    const reference = { p_id: lease.id, p_token: lease.token };
    const url = config.destinations.get(lease.destination);
    let outcome = "cancelled";
    if (url) {
      let addresses;
      try {
        addresses = await resolve(url.hostname);
      } catch {
        outcome = "retry";
      }
      if (addresses) {
        if (!addresses.length) outcome = "retry";
        else if (addresses.some(({ address }) => !publicAddress(address)))
          outcome = "failed";
        else {
          const prepared = await call(
            config,
            "prepare_company_course_webhook",
            reference,
          );
          if (prepared?.destination === lease.destination) {
            const message = signedWebhook(
              prepared.event,
              prepared.signing_secret,
            );
            outcome = await send(url, addresses[0], message);
          }
        }
      }
    }
    await call(config, "finish_company_course_webhook", {
      ...reference,
      p_result: outcome,
    });
  }
  return processed;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const count = await dispatchCompanyWebhooks(
      webhookConfiguration(process.env),
    );
    console.log("Course webhook deliveries processed:", count);
  } catch {
    console.error("Course webhook dispatch failed.");
    process.exitCode = 1;
  }
}
