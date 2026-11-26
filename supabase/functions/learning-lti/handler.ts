/** OIDC resource-link message boundary for a locally registered LTI 1.3 tool. */
import type { createLtiAdvantage } from "./advantage.ts";
import type { createLtiDeepLink } from "./deep-link.ts";
import { boundedJson, RequestBodyTooLarge } from "../_shared/bounded-body.ts";
export interface LaunchHint {
  id: string;
  client_id: string;
  login_uri: string;
  target_uri: string;
  login_hint: string;
  message_hint: string;
}

export interface AuthorizedLaunch {
  id: string;
  subject: string;
  client_id: string;
  context_id: string;
  target_uri: string;
  redirect_uri: string;
  role: "Instructor" | "Learner";
  nrps_enabled?: boolean;
  deep_link_data?: string;
  resource_link_id?: string;
  resource_custom?: Record<string, string>;
}

type ProtocolRequest = {
  client_id: string;
  redirect_uri: string;
  login_hint: string;
  lti_message_hint: string;
  nonce: string;
  state: string;
};

type Principal = {
  prepare: (
    id: string,
    proof: string,
    placement?: { resource?: string; portalOrigin?: string },
  ) => Promise<LaunchHint | null>;
  consume: (
    request: ProtocolRequest,
    proof: string,
  ) => Promise<AuthorizedLaunch | null>;
};

type SigningKey = {
  issuer: string;
  publicKey: JsonWebKey & { kid: string };
  key: CryptoKey;
};

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const hint = /^[a-f0-9]{64}$/;
const keyId = /^[A-Za-z0-9._-]{1,80}$/;
const claim = "https://purl.imsglobal.org/spec/lti/claim/";
const utf8 = new TextEncoder();
const opaque = (value: unknown, capacity: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= capacity &&
  !Array.from(value).some((character) =>
    character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
  );

/** Parse registered tool addresses without normalization or network requests. */
export function httpsUrl(value: string): URL {
  const result = new URL(value);
  if (
    !value.startsWith("https://") || result.protocol !== "https:" ||
    result.username || result.password || result.hash ||
    value.length > 1500 || /[\s\\]/.test(value)
  ) throw new Error("invalid_lti_uri");
  return result;
}

/** Import the operator-provided key and construct a public JWK projection explicitly. */
export async function importSigningKey(
  issuer: string,
  raw: string,
): Promise<SigningKey> {
  const identity = httpsUrl(issuer);
  if (identity.search || issuer.includes("?")) {
    throw new Error("invalid_lti_issuer");
  }
  const jwk = JSON.parse(raw) as JsonWebKey & { kid?: string };
  if (
    jwk.kty !== "RSA" || !jwk.kid || !keyId.test(jwk.kid) || !jwk.n || !jwk.e ||
    !jwk.d ||
    (jwk.alg && jwk.alg !== "RS256")
  ) throw new Error("invalid_lti_key");
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mechanism = key.algorithm as RsaHashedKeyAlgorithm;
  if (mechanism.modulusLength < 2048 || mechanism.modulusLength > 4096) {
    throw new Error("invalid_lti_key");
  }
  return {
    issuer,
    key,
    publicKey: {
      kty: "RSA",
      kid: jwk.kid,
      n: jwk.n,
      e: jwk.e,
      use: "sig",
      alg: "RS256",
    },
  };
}

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");

/** Include only the pseudonymous, course-specific claims required for a resource launch. */
async function signLaunch(
  signing: SigningKey,
  launch: AuthorizedLaunch,
  nonce: string,
  services: object,
) {
  const issued = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT", kid: signing.publicKey.kid };
  const payload = {
    iss: signing.issuer,
    sub: launch.subject,
    aud: launch.client_id,
    iat: issued,
    exp: issued + 120,
    jti: crypto.randomUUID(),
    nonce,
    ...services,
    [claim + "message_type"]: launch.deep_link_data
      ? "LtiDeepLinkingRequest"
      : "LtiResourceLinkRequest",
    [claim + "version"]: "1.3.0",
    [claim + "deployment_id"]: launch.id,
    [claim + "target_link_uri"]: launch.target_uri,
    ...(launch.deep_link_data ? {} : {
      [claim + "resource_link"]: { id: launch.resource_link_id ?? launch.id },
      ...(launch.resource_custom &&
          Object.keys(launch.resource_custom).length > 0
        ? { [claim + "custom"]: launch.resource_custom }
        : {}),
    }),
    [claim + "roles"]: [
      "http://purl.imsglobal.org/vocab/lis/v2/membership#" + launch.role,
    ],
    [claim + "context"]: {
      id: launch.context_id,
      type: ["http://purl.imsglobal.org/vocab/lis/v2/course#CourseOffering"],
    },
  };
  const message = [header, payload].map((part) =>
    base64url(utf8.encode(JSON.stringify(part)))
  ).join(".");
  const signature = await crypto.subtle.sign(
    signing.key.algorithm,
    signing.key,
    utf8.encode(message),
  );
  return message + "." + base64url(new Uint8Array(signature));
}

/** Validate exact OIDC mode and caller-supplied values before touching the one-time transaction. */
function authorization(body: Record<string, unknown>): ProtocolRequest | null {
  if (
    body.scope !== "openid" || body.response_type !== "id_token" ||
    body.response_mode !== "form_post" || body.prompt !== "none" ||
    !opaque(body.client_id, 255) || !opaque(body.redirect_uri, 1500) ||
    !opaque(body.login_hint, 64) || !hint.test(body.login_hint) ||
    !opaque(body.lti_message_hint, 64) || !hint.test(body.lti_message_hint) ||
    !opaque(body.nonce, 255) || !opaque(body.state, 2048)
  ) return null;
  httpsUrl(body.redirect_uri);
  const {
    client_id,
    redirect_uri,
    login_hint,
    lti_message_hint,
    nonce,
    state,
  } = body;
  return {
    client_id,
    redirect_uri,
    login_hint,
    lti_message_hint,
    nonce,
    state,
  };
}

/** The JWKS is public; both browser actions require an authenticated portal bearer and exact origin. */
export function createLtiHandler(options: {
  origins: string[];
  signing: SigningKey | null;
  advantage?: ReturnType<typeof createLtiAdvantage>;
  deepLink?: ReturnType<typeof createLtiDeepLink>;
  principal: (bearer: string) => Promise<Principal | null>;
}) {
  return async (request: Request) => {
    const origin = request.headers.get("origin") ?? "";
    const allowed = options.origins.includes(origin);
    const headers = new Headers({
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    });
    if (allowed) {
      headers.set("Access-Control-Allow-Origin", origin);
      headers.set("Vary", "Origin");
    }
    const json = (status: number, value: object) =>
      new Response(JSON.stringify(value), {
        status,
        headers: new Headers([...headers, [
          "Content-Type",
          "application/json",
        ]]),
      });
    const path = new URL(request.url).pathname.replace(
      /^\/functions\/v1(?=\/)/,
      "",
    );
    if (request.method === "GET" && path === "/learning-lti/jwks") {
      return options.signing
        ? json(200, { keys: [options.signing.publicKey] })
        : json(503, { error: "lti_unconfigured" });
    }
    if (
      path === "/learning-lti/deep-link-return" && request.method === "POST" &&
      options.deepLink
    ) {
      return await options.deepLink.receive(request);
    }
    const service = await options.advantage?.route(request, path);
    if (service) return service;
    if (!allowed) return json(403, { error: "lti_origin" });
    if (request.method === "OPTIONS") {
      headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
      headers.set(
        "Access-Control-Allow-Headers",
        "authorization, apikey, content-type, x-client-info",
      );
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== "POST" || path !== "/learning-lti") {
      return json(405, { error: "lti_method" });
    }
    if (!options.signing) return json(503, { error: "lti_unconfigured" });
    // Browser actions use a small JSON envelope; raw protocol forms and uploads are not accepted here.
    if (!request.headers.get("content-type")?.startsWith("application/json")) {
      return json(400, { error: "lti_body" });
    }
    const bearer = request.headers.get("authorization");
    if (!bearer || !/^Bearer [A-Za-z0-9._-]+$/.test(bearer)) {
      return json(401, { error: "lti_session" });
    }

    try {
      const input = await boundedJson(request, 8192);
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        return json(400, { error: "lti_body" });
      }
      const body = input as Record<string, unknown>;
      if (typeof body.proof !== "string" || !uuid.test(body.proof)) {
        return json(400, { error: "lti_body" });
      }
      const principal = await options.principal(bearer);
      if (!principal) return json(401, { error: "lti_session" });
      if (
        body.action === "prepare" && typeof body.registration === "string" &&
        uuid.test(body.registration)
      ) {
        if (body.mode !== undefined && body.mode !== "select") {
          return json(400, { error: "lti_prepare" });
        }
        if (
          body.mode === "select" &&
          (!options.deepLink || body.resource !== undefined)
        ) {
          return json(403, { error: "lti_prepare" });
        }
        if (
          body.resource !== undefined &&
          (typeof body.resource !== "string" || !uuid.test(body.resource))
        ) {
          return json(400, { error: "lti_prepare" });
        }
        const prepared = await principal.prepare(
          body.registration,
          body.proof,
          {
            resource: body.resource,
            portalOrigin: body.mode === "select" ? origin : undefined,
          },
        );
        if (!prepared) return json(403, { error: "lti_prepare" });
        const login = httpsUrl(prepared.login_uri);
        httpsUrl(prepared.target_uri);
        for (
          const [name, value] of Object.entries({
            iss: options.signing.issuer,
            client_id: prepared.client_id,
            lti_deployment_id: prepared.id,
            login_hint: prepared.login_hint,
            lti_message_hint: prepared.message_hint,
            target_link_uri: prepared.target_uri,
          })
        ) login.searchParams.set(name, value);
        return json(200, {
          redirect: login.href,
          login_hint: prepared.login_hint,
        });
      }
      if (body.action !== "authorize") {
        return json(400, { error: "lti_action" });
      }
      const protocol = authorization(body);
      if (!protocol) return json(400, { error: "lti_authorization" });
      const launch = await principal.consume(protocol, body.proof);
      if (
        !launch || launch.client_id !== protocol.client_id ||
        launch.redirect_uri !== protocol.redirect_uri
      ) {
        return json(403, { error: "lti_launch" });
      }
      httpsUrl(launch.target_uri);
      if (launch.deep_link_data && !options.deepLink) {
        return json(403, { error: "lti_launch" });
      }
      const claims = launch.deep_link_data
        ? options.deepLink!.settings(launch.deep_link_data)
        : options.advantage?.claims(launch) ?? {};
      return json(200, {
        redirect: launch.redirect_uri,
        state: protocol.state,
        id_token: await signLaunch(
          options.signing,
          launch,
          protocol.nonce,
          claims,
        ),
      });
    } catch (error) {
      return json(error instanceof RequestBodyTooLarge ? 413 : 400, {
        error: "lti_request",
      });
    }
  };
}
