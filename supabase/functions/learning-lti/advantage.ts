/** LTI Advantage tool authentication and Names and Role Provisioning Service. */
import { boundedBytes, RequestBodyTooLarge } from "../_shared/bounded-body.ts";

const utf8 = new TextDecoder("utf-8", { fatal: true });
const bytes = new TextEncoder();
const id = "[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}";
const uuid = new RegExp(`^${id}$`, "i");
const membershipsPath = new RegExp(`^/learning-lti/memberships/(${id})$`, "i");
const nrpsScope =
  "https://purl.imsglobal.org/spec/lti-nrps/scope/contextmembership.readonly";
const membershipType =
  "application/vnd.ims.lti-nrps.v2.membershipcontainer+json";
const roles = ["Instructor", "Learner"];
const rolePrefix = "http://purl.imsglobal.org/vocab/lis/v2/membership#";
const ltiClaim = "https://purl.imsglobal.org/spec/lti/claim/";

type Registration = {
  id: string;
  version: number;
  key: JsonWebKey & { kid: string };
};
type Member = { user_id: string; status: "Active"; roles: string[] };
type Memberships = { context_id: string; members: Member[] };

export type AdvantageBackend = {
  registration: (
    client: string,
    deployment: string | null,
  ) => Promise<Registration | null>;
  issueToken: (
    registration: Registration,
    assertionId: string,
    assertionExpiry: string,
    scopes: string[],
  ) => Promise<string | null>;
  memberships: (
    deployment: string,
    token: string,
    role: string | null,
    after: string | null,
    limit: number,
  ) => Promise<Memberships | null>;
};

const bounded = (value: unknown, limit: number): value is string =>
  typeof value === "string" && value.length >= 1 && value.length <= limit &&
  !/[\u0000-\u001f\u007f]/.test(value);

function decode(base64url: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(base64url)) {
    throw new Error("assertion_encoding");
  }
  return Uint8Array.from(
    atob(base64url.replaceAll("-", "+").replaceAll("_", "/")),
    (ch) => ch.charCodeAt(0),
  );
}

function object(base64url: string) {
  const input = JSON.parse(utf8.decode(decode(base64url)));
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("assertion_type");
  }
  return input as Record<string, unknown>;
}

function audienceIs(value: unknown, expected: string) {
  return value === expected ||
    (Array.isArray(value) && value.length === 1 && value[0] === expected);
}

async function verifyAssertion(
  backend: AdvantageBackend,
  assertion: string,
  audience: string,
) {
  const parts = assertion.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  const jose = object(header);
  const claims = object(payload);
  const { iss, sub, aud, iat, exp, jti } = claims;
  const deployment = claims[ltiClaim + "deployment_id"];
  const now = Math.floor(Date.now() / 1000);
  if (
    jose.alg !== "RS256" || !bounded(jose.kid, 80) ||
    Object.keys(jose).some((name) => !["alg", "kid", "typ"].includes(name)) ||
    (jose.typ !== undefined && jose.typ !== "JWT") ||
    !bounded(iss, 255) || iss !== sub || !audienceIs(aud, audience) ||
    typeof iat !== "number" || !Number.isSafeInteger(iat) ||
    typeof exp !== "number" || !Number.isSafeInteger(exp) ||
    exp <= now || iat > now + 30 || iat < now - 330 || exp <= iat ||
    exp - iat > 300 ||
    (claims.nbf !== undefined && (
      typeof claims.nbf !== "number" || !Number.isSafeInteger(claims.nbf) ||
      claims.nbf > now
    )) ||
    !bounded(jti, 255) ||
    (deployment !== undefined &&
      (typeof deployment !== "string" || !uuid.test(deployment)))
  ) return null;

  const registration = await backend.registration(iss, deployment ?? null);
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
    ? { registration, jti, expiresAt: new Date(exp * 1000).toISOString() }
    : null;
}

function response(status: number, body: object, additional?: HeadersInit) {
  const headers = new Headers(additional);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  headers.set("Cache-Control", "no-store");
  headers.set("Pragma", "no-cache");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(JSON.stringify(body), { status, headers });
}

/** Return null only for unrelated routes, which retain their normal Auth and CORS handling. */
export function createLtiAdvantage(base: string, backend: AdvantageBackend) {
  const endpoint = new URL(base);
  if (
    endpoint.protocol !== "https:" || endpoint.username || endpoint.password ||
    endpoint.search || endpoint.hash ||
    !endpoint.pathname.endsWith("/functions/v1/learning-lti")
  ) throw new Error("invalid_lti_service_url");

  const tokenEndpoint = `${endpoint.href}/token`;

  async function token(request: Request) {
    if (
      request.headers.get("content-type")?.split(";", 1)[0].trim()
        .toLowerCase() !==
        "application/x-www-form-urlencoded"
    ) return response(400, { error: "invalid_request" });
    const form = new URLSearchParams(
      utf8.decode(await boundedBytes(request, 12_288)),
    );
    const fields = [
      "grant_type",
      "client_assertion_type",
      "client_assertion",
      "scope",
    ];
    if (fields.some((field) => form.getAll(field).length !== 1)) {
      return response(400, { error: "invalid_request" });
    }
    if (form.get("grant_type") !== "client_credentials") {
      return response(400, { error: "unsupported_grant_type" });
    }
    if (
      form.get("client_assertion_type") !==
        "urn:ietf:params:oauth:client-assertion-type:jwt-bearer"
    ) return response(400, { error: "invalid_request" });

    const scopes = Array.from(
      new Set((form.get("scope") ?? "").trim().split(/ +/)),
    );
    if (scopes.length !== 1 || scopes[0] !== nrpsScope) {
      return response(400, { error: "invalid_scope" });
    }
    const assertion = form.get("client_assertion");
    const verified = bounded(assertion, 8192)
      ? await verifyAssertion(backend, assertion, tokenEndpoint).catch(() =>
        null
      )
      : null;
    const accessToken = verified && await backend.issueToken(
      verified.registration,
      verified.jti,
      verified.expiresAt,
      scopes,
    );
    return accessToken
      ? response(200, {
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: 300,
        scope: scopes.join(" "),
      })
      : response(400, { error: "invalid_client" });
  }

  async function memberships(request: Request, deployment: string) {
    const authorization = request.headers.get("authorization");
    const credential = /^Bearer ([0-9a-f]{64})$/i.exec(authorization ?? "")
      ?.[1];
    if (!credential) {
      return response(401, { error: "invalid_token" }, {
        "WWW-Authenticate": "Bearer",
      });
    }
    const input = new URL(request.url).searchParams;
    const readOnce = (name: string) => {
      const values = input.getAll(name);
      if (values.length > 1) throw new Error("query_parameter");
      return values[0] ?? null;
    };
    const roleName = readOnce("role");
    const role = roleName?.startsWith(rolePrefix)
      ? roleName.slice(rolePrefix.length)
      : roleName;
    const rlid = readOnce("rlid");
    const after = readOnce("after");
    const limit = readOnce("limit") ?? "100";
    if (
      (role !== null && !roles.includes(role)) ||
      (after !== null && !uuid.test(after)) ||
      !/^(?:[1-9][0-9]?|1[0-9]{2}|200)$/.test(limit)
    ) return response(400, { error: "invalid_request" });
    if (rlid !== null && rlid !== deployment) {
      return response(403, { error: "invalid_resource_link" });
    }

    const roster = await backend.memberships(
      deployment,
      credential,
      role,
      after,
      Number(limit),
    );
    if (!roster) {
      return response(401, { error: "invalid_token" }, {
        "WWW-Authenticate": "Bearer",
      });
    }
    const canonical = new URL(`${endpoint.href}/memberships/${deployment}`);
    if (roleName !== null) canonical.searchParams.set("role", roleName);
    if (rlid !== null) canonical.searchParams.set("rlid", rlid);
    const page = roster.members.slice(0, Number(limit));
    const headers = new Headers({ "Content-Type": membershipType });
    if (roster.members.length > page.length) {
      const next = new URL(canonical);
      next.searchParams.set("limit", limit);
      next.searchParams.set("after", page.at(-1)!.user_id);
      headers.set("Link", `<${next.href}>; rel="next"`);
    }
    return response(200, {
      id: canonical.href,
      context: { id: roster.context_id },
      members: rlid === null ? page : page.map((member) => ({
        ...member,
        message: [{ [ltiClaim + "message_type"]: "LtiResourceLinkRequest" }],
      })),
    }, headers);
  }

  return {
    claims(launch: { id: string; nrps_enabled?: boolean }) {
      if (!launch.nrps_enabled) return {};
      return {
        "https://purl.imsglobal.org/spec/lti-nrps/claim/namesroleservice": {
          context_memberships_url: `${endpoint.href}/memberships/${launch.id}`,
          service_versions: ["2.0"],
        },
      };
    },
    async route(request: Request, path: string) {
      try {
        if (path === "/learning-lti/token" && request.method === "POST") {
          return await token(request);
        }
        const deployment = membershipsPath.exec(path)?.[1];
        if (deployment && request.method === "GET") {
          return await memberships(request, deployment);
        }
        return null;
      } catch (error) {
        return response(error instanceof RequestBodyTooLarge ? 413 : 400, {
          error: "invalid_request",
        });
      }
    },
  };
}
