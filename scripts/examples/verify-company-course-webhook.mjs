/** Node.js receiver example. Pass the original bounded request bytes before JSON parsing. */
import { createHmac, timingSafeEqual } from "node:crypto";

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const secretPattern = /^[0-9a-f]{64}$/;
const signaturePattern = /^v1=([0-9a-f]{64})$/;
const timestampPattern = /^[1-9][0-9]{0,11}$/;
const utf8 = new TextDecoder("utf-8", { fatal: true });
export const webhookBodyLimit = 65_536;

/** The subscription issuer displays a lower-case hex-encoded 256-bit key. */
export function isWebhookSigningSecret(secret) {
  return typeof secret === "string" && secretPattern.test(secret);
}

/**
 * Authenticate a course notification using a subscription-specific secret and
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
    return event?.id === eventId &&
      event.version === 1 &&
      typeof event.type === "string" &&
      event.type.startsWith("course.") &&
      typeof event.course_id === "string" &&
      uuid.test(event.course_id) &&
      typeof event.occurred_at === "string" &&
      Number.isFinite(Date.parse(event.occurred_at))
      ? event
      : null;
  } catch {
    return null;
  }
}
