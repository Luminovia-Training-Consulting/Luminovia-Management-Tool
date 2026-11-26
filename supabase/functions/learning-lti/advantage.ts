/** LTI Advantage tool authentication and Names and Role Provisioning Service. */
import { boundedBytes, RequestBodyTooLarge } from "../_shared/bounded-body.ts";
import {
  bounded,
  ltiClaim,
  toolJwt,
  type ToolRegistration,
  uuid,
  uuidPattern,
} from "./tool-jwt.ts";
import {
  type AgsBackend,
  agsClaims,
  agsScopes,
  createAgsRoute,
} from "./ags.ts";

const utf8 = new TextDecoder("utf-8", { fatal: true });
const membershipsPath = new RegExp(
  `^/learning-lti/memberships/(${uuidPattern})$`,
  "i",
);
const nrpsScope =
  "https://purl.imsglobal.org/spec/lti-nrps/scope/contextmembership.readonly";
const membershipType =
  "application/vnd.ims.lti-nrps.v2.membershipcontainer+json";
const roles = ["Instructor", "Learner"];
const rolePrefix = "http://purl.imsglobal.org/vocab/lis/v2/membership#";
type Member = { user_id: string; status: "Active"; roles: string[] };
type Memberships = {
  context_id: string;
  members: Member[];
  resource_custom?: Record<string, string>;
};

export type AdvantageBackend = {
  ags?: AgsBackend;
  registration: (
    client: string,
    deployment: string | null,
  ) => Promise<ToolRegistration | null>;
  issueToken: (
    registration: ToolRegistration,
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
    resourceLink: string | null,
  ) => Promise<Memberships | null | false>;
};

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
  const agsRoute = backend.ags && createAgsRoute(endpoint.href, backend.ags);
  const offeredScopes = backend.ags ? [nrpsScope, ...agsScopes] : [nrpsScope];

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
    if (
      !scopes.length || scopes.some((scope) => !offeredScopes.includes(scope))
    ) {
      return response(400, { error: "invalid_scope" });
    }
    const assertion = form.get("client_assertion");
    const verified = bounded(assertion, 8192)
      ? await toolJwt(assertion, tokenEndpoint, backend.registration).catch(
        () => null,
      )
      : null;
    const claims = verified?.claims;
    const accessToken =
      verified && claims?.iss === claims?.sub && bounded(claims?.jti, 255)
        ? await backend.issueToken(
          verified.registration,
          claims.jti,
          verified.expiresAt,
          scopes,
        )
        : null;
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
      (rlid !== null && !uuid.test(rlid)) ||
      !/^(?:[1-9][0-9]?|1[0-9]{2}|200)$/.test(limit)
    ) return response(400, { error: "invalid_request" });

    const roster = await backend.memberships(
      deployment,
      credential,
      role,
      after,
      Number(limit),
      rlid,
    );
    if (roster === false) {
      return response(403, { error: "invalid_resource_link" });
    }
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
        message: [{
          [ltiClaim + "message_type"]: "LtiResourceLinkRequest",
          ...(roster.resource_custom &&
              Object.keys(roster.resource_custom).length > 0
            ? { [ltiClaim + "custom"]: roster.resource_custom }
            : {}),
        }],
      })),
    }, headers);
  }

  return {
    claims(
      launch: {
        id: string;
        nrps_enabled?: boolean;
        ags_enabled?: boolean;
        ags_lineitem?: string;
      },
    ) {
      const roster = launch.nrps_enabled
        ? {
          "https://purl.imsglobal.org/spec/lti-nrps/claim/namesroleservice": {
            context_memberships_url:
              `${endpoint.href}/memberships/${launch.id}`,
            service_versions: ["2.0"],
          },
        }
        : {};
      return {
        ...roster,
        ...(backend.ags ? agsClaims(endpoint.href, launch) : {}),
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
        return await agsRoute?.(request, path) ?? null;
      } catch (error) {
        return response(error instanceof RequestBodyTooLarge ? 413 : 400, {
          error: "invalid_request",
        });
      }
    },
  };
}
