/** Common trust checks for JWTs presented by a registered LTI tool. */
const utf8 = new TextDecoder("utf-8", { fatal: true });
const bytes = new TextEncoder();

export type ToolRegistration = {
  id: string;
  version: number;
  key: JsonWebKey & { kid: string };
};
export const ltiClaim = "https://purl.imsglobal.org/spec/lti/claim/";
export const uuidPattern = "[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}";
export const uuid = new RegExp(`^${uuidPattern}$`, "i");
export const bounded = (value: unknown, limit: number): value is string =>
  typeof value === "string" && value.length >= 1 && value.length <= limit &&
  !/[\u0000-\u001f\u007f]/.test(value);

function decode(base64url: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(base64url)) throw new Error("tool_jwt_encoding");
  return Uint8Array.from(
    atob(base64url.replaceAll("-", "+").replaceAll("_", "/")),
    (ch) => ch.charCodeAt(0),
  );
}

function object(base64url: string) {
  const value = JSON.parse(utf8.decode(decode(base64url)));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("tool_jwt_object");
  }
  return value as Record<string, unknown>;
}

export async function toolJwt(
  credential: string,
  audience: string,
  registrationFor: (
    client: string,
    deployment: string | null,
  ) => Promise<ToolRegistration | null>,
) {
  const parts = credential.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  const jose = object(header);
  const claims = object(payload);
  const { iss, aud, iat, exp, nbf } = claims;
  const deployment = claims[ltiClaim + "deployment_id"];
  const now = Math.floor(Date.now() / 1000);
  const intendedAudience = aud === audience ||
    (Array.isArray(aud) && aud.length === 1 && aud[0] === audience);
  if (
    jose.alg !== "RS256" || !bounded(jose.kid, 80) ||
    Object.keys(jose).some((name) => !["alg", "kid", "typ"].includes(name)) ||
    (jose.typ !== undefined && jose.typ !== "JWT") ||
    !bounded(iss, 255) || !intendedAudience ||
    typeof iat !== "number" || !Number.isSafeInteger(iat) ||
    typeof exp !== "number" || !Number.isSafeInteger(exp) ||
    exp <= now || iat > now + 30 || iat < now - 330 || exp <= iat ||
    exp - iat > 300 ||
    (nbf !== undefined &&
      (typeof nbf !== "number" || !Number.isSafeInteger(nbf) || nbf > now)) ||
    (deployment !== undefined &&
      (typeof deployment !== "string" || !uuid.test(deployment)))
  ) return null;

  const registration = await registrationFor(iss, deployment ?? null);
  if (!registration || registration.key.kid !== jose.kid) return null;
  const key = await crypto.subtle.importKey(
    "jwk",
    registration.key,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const algorithm = key.algorithm as RsaHashedKeyAlgorithm;
  if (algorithm.modulusLength < 2048 || algorithm.modulusLength > 4096) {
    return null;
  }
  const valid = await crypto.subtle.verify(
    key.algorithm,
    key,
    decode(signature),
    bytes.encode(`${header}.${payload}`),
  );
  return valid
    ? { registration, claims, expiresAt: new Date(exp * 1000).toISOString() }
    : null;
}
