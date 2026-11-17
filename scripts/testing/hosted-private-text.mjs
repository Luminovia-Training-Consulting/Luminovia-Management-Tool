/**
 * Private text and public request-field boundaries for the explicit hosted
 * operator check. Importing these helpers never starts its CLI or requests.
 */
import assert from "node:assert/strict";
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
} from "node:fs";

const privateFileRefusal =
  "Private configuration must be an exclusive regular file (0600)";
const publicKeyRefusal =
  "A public Supabase publishable or legacy anon HS256 key is required.";
const publicKeyAlphabet =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Reconstruct finite base64url characters through numeric indices without decoding or changing credential bytes. */
function publicKeySegment(segment) {
  return Array.from(segment, (character) => {
    const index = publicKeyAlphabet.indexOf(character);
    if (index < 0) throw new TypeError(publicKeyRefusal);
    return publicKeyAlphabet[index];
  }).join("");
}

/**
 * Classify only public keys, preserving exact bytes; the server still authenticates
 * them. Opaque checksum validation is deliberately absent.
 * https://supabase.com/docs/guides/self-hosting/self-hosted-auth-keys
 */
export function hostedPublicApiKey(value) {
  if (typeof value !== "string") throw new TypeError(publicKeyRefusal);
  const opaque = /^sb_publishable_([A-Za-z0-9_-]{22})_([A-Za-z0-9_-]{8})$/.exec(
    value,
  );
  if (opaque?.[0] === value)
    return (
      "sb_publishable_" +
      publicKeySegment(opaque[1]) +
      "_" +
      publicKeySegment(opaque[2])
    );
  const legacy =
    /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/.exec(value);
  if (legacy?.[0] === value) {
    try {
      // Decode metadata for classification only; retain the original JSON encoding and signature.
      const decode = (segment) =>
        JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            Buffer.from(segment, "base64url"),
          ),
        );
      const header = decode(legacy[1]);
      const payload = decode(legacy[2]);
      if (
        header &&
        typeof header === "object" &&
        !Array.isArray(header) &&
        Object.hasOwn(header, "alg") &&
        header.alg === "HS256" &&
        (header.typ === undefined || header.typ === "JWT") &&
        payload &&
        typeof payload === "object" &&
        !Array.isArray(payload) &&
        Object.hasOwn(payload, "role") &&
        payload.role === "anon"
      )
        return legacy.slice(1).map(publicKeySegment).join(".");
    } catch {
      // Parsing must never disclose configured key bytes or attach them as a cause.
    }
  }
  throw new TypeError(publicKeyRefusal);
}

/** Rebuild only a validated document UUID; arbitrary private-ledger fields cannot become request data. */
export function hostedDownloadRequest(id) {
  if (
    typeof id !== "string" ||
    id.length !== 36 ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)
  )
    throw new TypeError("A hosted document UUID is required.");
  const widths = [8, 4, 4, 4, 12];
  return {
    action: "download",
    id: id
      .split("-")
      .map((part, index) =>
        Number.parseInt(part, 16).toString(16).padStart(widths[index], "0"),
      )
      .join("-"),
  };
}

/** Preserve raw text, ENOENT/read failures and the existing no-group/other mode rule; no UID, link-count or parent policy is inferred. */
export function readHostedPrivateText(path) {
  // Do not follow a leaf symlink or wait for a FIFO writer before inspecting
  // the opened object. A later pathname replacement cannot change this fd.
  let descriptor;
  try {
    try {
      descriptor = openSync(
        path,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
    } catch (error) {
      if (error?.code !== "ELOOP" && error?.code !== "ENXIO") throw error;
      // Only open-time symlink/socket errors retain the legacy bounded refusal.
    }
    assert(descriptor !== undefined, privateFileRefusal);
    const stat = fstatSync(descriptor);
    assert(stat.isFile() && (stat.mode & 0o077) === 0, privateFileRefusal);
    return readFileSync(descriptor, "utf8");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}
