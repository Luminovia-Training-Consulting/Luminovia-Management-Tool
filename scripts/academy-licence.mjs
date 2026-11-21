/**
 * Offline vendor signer and operator verifier for a dedicated Academy licence.
 * Neither the signing key nor the verifier's trust anchor comes from a licence,
 * public build environment, customer account, or browser.
 */
import {
  createPrivateKey,
  createPublicKey,
  KeyObject,
  sign,
  verify,
} from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const domain = "Luminovia Academy Licence v1\n";
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const commit = /^[0-9a-f]{40}$/;
const editions = new Set(["customer-self-hosted", "customer-managed"]);
const envelopeTtl = 30 * 86_400_000;

/** Accept a closed signed document and reject fields that another version could interpret differently. */
function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function instant(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  )
    throw new Error("academy_licence_timestamp");
  const timestamp = Date.parse(value);
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString() !== value
  )
    throw new Error("academy_licence_timestamp");
  return timestamp;
}

function trustedKey(input, type) {
  const key =
    input instanceof KeyObject
      ? input
      : type === "public"
        ? createPublicKey(input)
        : createPrivateKey(input);
  if (key.type !== type || key.asymmetricKeyType !== "ed25519")
    throw new Error("academy_licence_key");
  return key;
}

/** Use mutually agreed whole-number limits. This version binds one exact release commit. */
function validateTerms(terms) {
  if (
    !exactKeys(terms, [
      "installation_id",
      "edition",
      "release_commit",
      "issued_at",
      "starts_at",
      "expires_at",
      "grace_until",
      "modules",
      "limits",
    ]) ||
    !uuid.test(terms.installation_id) ||
    !editions.has(terms.edition) ||
    !commit.test(terms.release_commit) ||
    !Array.isArray(terms.modules) ||
    terms.modules.length !== 1 ||
    terms.modules[0] !== "lms" ||
    !exactKeys(terms.limits, [
      "seat_count",
      "storage_bytes",
      "api_requests_per_minute",
    ]) ||
    !Object.values(terms.limits).every(
      (limit) => Number.isSafeInteger(limit) && limit > 0,
    )
  )
    throw new Error("academy_licence_terms");
  const issued = instant(terms.issued_at);
  const starts = instant(terms.starts_at);
  const expires = instant(terms.expires_at);
  const grace = instant(terms.grace_until);
  if (
    issued > starts ||
    starts >= expires ||
    grace < expires ||
    grace - expires > envelopeTtl
  )
    throw new Error("academy_licence_validity");
  return { starts, expires, grace };
}

/** Vendor-only signing. Consumers never import or obtain this private key from their portal. */
export function signAcademyLicence(terms, privateKey) {
  validateTerms(terms);
  const message = Buffer.from(JSON.stringify(terms), "utf8").toString(
    "base64url",
  );
  return (
    message +
    "." +
    sign(
      null,
      Buffer.from(domain + message),
      trustedKey(privateKey, "private"),
    ).toString("base64url")
  );
}

/** Check canonical encoding, detached signature, signed terms and out-of-band installation binding. */
export function verifyAcademyLicence(
  envelope,
  publicKey,
  expected,
  now = Date.now(),
) {
  if (
    typeof envelope !== "string" ||
    envelope.length > 16384 ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{86}$/.test(envelope)
  )
    throw new Error("academy_licence_encoding");
  const [message, encodedSignature] = envelope.split(".");
  const bytes = Buffer.from(message, "base64url");
  const signature = Buffer.from(encodedSignature, "base64url");
  if (
    bytes.toString("base64url") !== message ||
    signature.toString("base64url") !== encodedSignature
  )
    throw new Error("academy_licence_encoding");
  if (
    !verify(
      null,
      Buffer.from(domain + message),
      trustedKey(publicKey, "public"),
      signature,
    )
  )
    throw new Error("academy_licence_signature");
  const terms = JSON.parse(bytes.toString("utf8"));
  const { starts, expires, grace } = validateTerms(terms);
  if (
    !Number.isFinite(now) ||
    terms.installation_id !== expected.installation_id ||
    terms.edition !== expected.edition ||
    terms.release_commit !== expected.release_commit
  )
    throw new Error("academy_licence_binding");
  const state =
    now < starts
      ? "not-yet-valid"
      : now < expires
        ? "active"
        : now < grace
          ? "grace"
          : "expired";
  return { state, terms };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const [
      command,
      inputFile,
      keyFile,
      installationId,
      edition,
      releaseCommit,
      ...extra
    ] = process.argv.slice(2);
    if (
      !inputFile ||
      !keyFile ||
      extra.length ||
      !["sign", "verify"].includes(command)
    )
      throw new Error("academy_licence_usage");
    const input = await readFile(inputFile, "utf8");
    const key = await readFile(keyFile);
    if (command === "sign") {
      if (installationId || edition || releaseCommit)
        throw new Error("academy_licence_usage");
      process.stdout.write(signAcademyLicence(JSON.parse(input), key) + "\n");
    } else {
      const result = verifyAcademyLicence(input.trim(), key, {
        installation_id: installationId,
        edition,
        release_commit: releaseCommit,
      });
      process.stdout.write(JSON.stringify(result) + "\n");
      if (result.state === "expired" || result.state === "not-yet-valid")
        process.exitCode = 2;
    }
  } catch {
    console.error(
      "Academy licence rejected. Check the command, trusted key, installation and release binding.",
    );
    process.exitCode = 1;
  }
}
