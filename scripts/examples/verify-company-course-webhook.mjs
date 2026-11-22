/** Node.js receiver example. Pass the original bounded request bytes before JSON parsing. */
import { createHmac, timingSafeEqual } from "node:crypto";

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const secretPattern = /^[0-9a-f]{64}$/;
const signaturePattern = /^v1=([0-9a-f]{64})$/;
const timestampPattern = /^[1-9][0-9]{0,11}$/;
const accountingTypes = new Set([
  "invoice.registered",
  "payment.recorded",
  "payment.reversed",
  "credit_note.applied",
  "credit_note.reversed",
  "refund.recorded",
  "refund.reversed",
]);
const utf8 = new TextDecoder("utf-8", { fatal: true });
export const webhookBodyLimit = 65_536;

/** The subscription issuer displays a lower-case hex-encoded 256-bit key. */
export function isWebhookSigningSecret(secret) {
  return typeof secret === "string" && secretPattern.test(secret);
}

/**
 * Authenticate a company notification using a subscription-specific secret and
 * the lowercased HTTP headers provided by Node's IncomingMessage.
 * The caller must deduplicate the confirmed event ID in durable storage.
 */
export function verifyCompanyCourseWebhook({
  body,
  headers,
  secret,
  now = Date.now(),
}) {
  const timestamp = headers["x-luminovia-timestamp"];
  const signature = headers["x-luminovia-signature"];
  const eventId = headers["x-luminovia-event-id"];
  if (
    !Buffer.isBuffer(body) ||
    body.length === 0 ||
    body.length > webhookBodyLimit ||
    !isWebhookSigningSecret(secret) ||
    typeof timestamp !== "string" ||
    !timestampPattern.test(timestamp) ||
    typeof signature !== "string" ||
    typeof eventId !== "string" ||
    !uuid.test(eventId) ||
    !Number.isFinite(now) ||
    Math.abs(now - Number(timestamp) * 1000) > 300000
  )
    return null;
  const match = signaturePattern.exec(signature);
  if (!match) return null;
  const expected = createHmac("sha256", Buffer.from(secret, "hex"))
    .update(timestamp + ".", "utf8")
    .update(body)
    .digest();
  if (!timingSafeEqual(expected, Buffer.from(match[1], "hex"))) return null;
  try {
    const event = JSON.parse(utf8.decode(body));
    if (
      event?.id !== eventId ||
      // Keep the signed v1 fields identical to what the durable inbox stores.
      Object.keys(event).length !== 5 ||
      event.version !== 1 ||
      typeof event.type !== "string" ||
      typeof event.occurred_at !== "string" ||
      !Number.isFinite(Date.parse(event.occurred_at))
    )
      return null;
    const resource = event.type.startsWith("course.")
      ? event.course_id
      : accountingTypes.has(event.type)
        ? event.invoice_id
        : null;
    return typeof resource === "string" && uuid.test(resource) ? event : null;
  } catch {
    return null;
  }
}
