/**
 * Prüft Bereitschaft des tatsächlichen lokalen Einladungshandlers.
 * Nur dessen erwartete anonyme Ablehnung zählt; eine erfolgreiche Gateway-OPTIONS-Antwort genügt nicht.
 */
import { setTimeout as delay } from "node:timers/promises";

process.loadEnvFile(".env.test.local");
const url = new URL(process.env.SUPABASE_URL ?? "");
if (
  url.protocol !== "http:" ||
  !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
) {
  throw new Error(
    "Invitation readiness checks only permit loopback local Supabase.",
  );
}
const key = process.env.SUPABASE_ANON_KEY;
let role;
try {
  role = JSON.parse(
    Buffer.from(key.split(".")[1], "base64url").toString("utf8"),
  ).role;
} catch {
  throw new Error(
    "A local legacy anonymous JWT is required for the readiness check.",
  );
}
if (role !== "anon")
  throw new Error("Readiness checks require anonymous credentials only.");

const deadline = Date.now() + 45_000;
while (Date.now() < deadline) {
  try {
    const response = await fetch(
      new URL("/functions/v1/invite-lecturer", url),
      {
        method: "POST",
        headers: {
          Origin: process.env.PORTAL_APP_ORIGIN ?? "http://127.0.0.1:5173",
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: "{}",
        signal: AbortSignal.timeout(
          Math.max(1, Math.min(3_000, deadline - Date.now())),
        ),
      },
    );
    // Kong can return successful OPTIONS before the Edge runtime exists. Require
    // the actual handler's anonymous-denial response, which cannot reserve/send.
    if (response.status === 403) {
      const body = await response.json();
      if (body?.error === "permission_or_mfa_required") {
        console.log(
          "Local invitation handler is ready; anonymous POST was correctly rejected.",
        );
        process.exit(0);
      }
    }
  } catch {
    // Connection failures, gateway bodies and cold runtime responses are retried.
    // Never log request headers, keys or response bodies.
  }
  const remaining = deadline - Date.now();
  if (remaining > 0) await delay(Math.min(1_000, remaining));
}
throw new Error(
  "Local invitation handler did not become ready within 45 seconds.",
);
