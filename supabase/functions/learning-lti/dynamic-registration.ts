/** Token-gated OIDC Dynamic Registration for reviewed, inactive course deployments. */
import { boundedJson, RequestBodyTooLarge } from "../_shared/bounded-body.ts";
import { agsScopes } from "./ags.ts";
import { bounded, uuid } from "./tool-jwt.ts";

const toolConfiguration =
  "https://purl.imsglobal.org/spec/lti-tool-configuration";
const platformConfiguration =
  "https://purl.imsglobal.org/spec/lti-platform-configuration";
const rosterScope =
  "https://purl.imsglobal.org/spec/lti-nrps/scope/contextmembership.readonly";
type Json = Record<string, unknown>;
const object = (value: unknown): value is Json =>
  !!value && typeof value === "object" && !Array.isArray(value);

export type RegistrationGrant = {
  course: string;
  initiation: string;
  jwks: string;
  key: Json;
  roster: boolean;
  grades: boolean;
};
type ToolConfiguration = {
  title: string;
  login: string;
  redirect: string;
  jwks: string;
  target: string;
  picker: string | null;
  scopes: string[];
};

function https(value: unknown) {
  if (!bounded(value, 1500) || /[\s\\]/.test(value)) return null;
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password &&
      !url.hash
    ? url
    : null;
}

function validKey(key: Json) {
  return key.kty === "RSA" && bounded(key.kid, 80) &&
    /^[A-Za-z0-9._-]+$/.test(key.kid) &&
    typeof key.n === "string" && /^[A-Za-z0-9_-]{342,683}$/.test(key.n) &&
    typeof key.e === "string" && /^[A-Za-z0-9_-]{2,8}$/.test(key.e) &&
    (key.alg === undefined || key.alg === "RS256") &&
    (key.use === undefined || key.use === "sig") &&
    Object.keys(key).every((name) =>
      ["kty", "kid", "n", "e", "alg", "use"].includes(name)
    );
}

function requestedTool(value: unknown): ToolConfiguration | null {
  if (!object(value)) return null;
  const extension = value[toolConfiguration];
  if (
    !object(extension) || !bounded(value.client_name, 140) ||
    value.application_type !== "web" ||
    value.token_endpoint_auth_method !== "private_key_jwt" ||
    !Array.isArray(value.response_types) ||
    !value.response_types.includes("id_token") ||
    !Array.isArray(value.grant_types) ||
    !value.grant_types.includes("implicit") ||
    !value.grant_types.includes("client_credentials") ||
    !Array.isArray(value.redirect_uris) || value.redirect_uris.length < 1 ||
    value.redirect_uris.length > 10 ||
    !bounded(value.scope ?? "openid", 2048)
  ) return null;

  const login = https(value.initiate_login_uri);
  const redirect = https(value.redirect_uris[0]);
  const jwks = https(value.jwks_uri);
  const target = https(extension.target_link_uri);
  if (
    !login || !redirect || !target || !jwks || extension.domain !== target.host
  ) return null;
  const messages = extension.messages ?? [];
  if (
    !Array.isArray(messages) || messages.length > 15 ||
    messages.some((message) => !object(message))
  ) return null;
  const pickerMessage = messages.find((message) =>
    message.type === "LtiDeepLinkingRequest"
  );
  const picker = pickerMessage
    ? https(pickerMessage.target_link_uri ?? extension.target_link_uri)
    : null;
  if (pickerMessage && !picker) return null;
  return {
    title: value.client_name,
    login: value.initiate_login_uri as string,
    redirect: value.redirect_uris[0] as string,
    target: extension.target_link_uri as string,
    jwks: value.jwks_uri as string,
    picker: picker
      ? (pickerMessage.target_link_uri ?? extension.target_link_uri) as string
      : null,
    scopes: [
      ...new Set(String(value.scope ?? "").split(/\s+/).filter(Boolean)),
    ],
  };
}

type Registration = { id: string; client_id: string; scopes: string[] };
type Completion = (
  token: string,
  tool: ToolConfiguration,
) => Promise<Registration | null>;

export function createDynamicRegistration(
  baseUrl: string,
  issuer: string,
  portalOrigins: string[],
  complete: Completion,
) {
  const base = new URL(baseUrl);
  const identity = new URL(issuer);
  if (
    base.protocol !== "https:" || base.origin !== identity.origin ||
    !base.pathname.startsWith(identity.pathname.replace(/\/$/, "") + "/") ||
    !portalOrigins.includes(base.origin)
  ) return undefined;

  const registrationEndpoint = base.href + "/registration";
  const discoveryEndpoint = base.href + "/registration/configuration";
  const headers = {
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  };
  const json = (body: Json, status = 200) =>
    Response.json(body, { status, headers });
  return {
    async begin(
      input: Json,
      origin: string,
      issue: (grant: RegistrationGrant) => Promise<string | null>,
    ) {
      if (
        origin !== identity.origin || typeof input.course !== "string" ||
        !uuid.test(input.course) ||
        typeof input.roster !== "boolean" ||
        typeof input.grades !== "boolean" ||
        !object(input.key) || !validKey(input.key)
      ) return null;
      const initiation = https(input.initiation);
      const jwks = https(input.jwks);
      if (!initiation || !jwks || initiation.origin !== jwks.origin) {
        return null;
      }
      const key = await crypto.subtle.importKey(
        "jwk",
        input.key as JsonWebKey,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"],
      );
      const algorithm = key.algorithm as RsaHashedKeyAlgorithm;
      if (algorithm.modulusLength < 2048 || algorithm.modulusLength > 4096) {
        return null;
      }
      const token = await issue({
        course: input.course,
        initiation: input.initiation as string,
        jwks: input.jwks as string,
        key: input.key,
        roster: input.roster,
        grades: input.grades,
      });
      if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
      initiation.searchParams.set("openid_configuration", discoveryEndpoint);
      initiation.searchParams.set("registration_token", token);
      return { redirect: initiation.href };
    },
    async route(request: Request, path: string) {
      if (
        path === "/learning-lti/registration/configuration" &&
        request.method === "GET"
      ) {
        return json({
          issuer,
          authorization_endpoint: new URL("/lti/authorize", identity).href,
          token_endpoint: base.href + "/token",
          jwks_uri: base.href + "/jwks",
          registration_endpoint: registrationEndpoint,
          token_endpoint_auth_methods_supported: ["private_key_jwt"],
          token_endpoint_auth_signing_alg_values_supported: ["RS256"],
          scopes_supported: ["openid", rosterScope, ...agsScopes],
          response_types_supported: ["id_token"],
          grant_types_supported: ["implicit", "client_credentials"],
          id_token_signing_alg_values_supported: ["RS256"],
          claims_supported: ["sub", "iss"],
          subject_types_supported: ["pairwise"],
          [platformConfiguration]: {
            product_family_code: "luminovia-portal",
            version: "1.0",
            messages_supported: [
              { type: "LtiResourceLinkRequest" },
              { type: "LtiDeepLinkingRequest" },
            ],
          },
        });
      }
      if (path !== "/learning-lti/registration" || request.method !== "POST") {
        return null;
      }
      const token = /^Bearer ([a-f0-9]{64})$/i.exec(
        request.headers.get("authorization") ?? "",
      )?.[1];
      if (!token) return json({ error: "invalid_token" }, 401);
      try {
        if (
          request.headers.get("content-type")?.split(";", 1)[0].trim()
            .toLowerCase() !== "application/json"
        ) {
          return json({ error: "invalid_client_metadata" }, 400);
        }
        const tool = requestedTool(await boundedJson(request, 16_384));
        if (!tool) return json({ error: "invalid_client_metadata" }, 400);
        const confirmed = await complete(token, tool);
        if (!confirmed) return json({ error: "invalid_client_metadata" }, 400);
        return json({
          client_id: confirmed.client_id,
          client_name: tool.title,
          application_type: "web",
          response_types: ["id_token"],
          grant_types: ["implicit", "client_credentials"],
          initiate_login_uri: tool.login,
          redirect_uris: [tool.redirect],
          jwks_uri: tool.jwks,
          token_endpoint_auth_method: "private_key_jwt",
          scope: confirmed.scopes.join(" "),
          [toolConfiguration]: {
            domain: new URL(tool.target).host,
            target_link_uri: tool.target,
            deployment_id: confirmed.id,
            claims: ["iss", "sub"],
            ...(tool.picker
              ? {
                messages: [{
                  type: "LtiDeepLinkingRequest",
                  target_link_uri: tool.picker,
                }],
              }
              : {}),
          },
        }, 201);
      } catch (error) {
        return json(
          { error: "invalid_client_metadata" },
          error instanceof RequestBodyTooLarge ? 413 : 400,
        );
      }
    },
  };
}
