/**
 * Account-management HTTP contract. Business RPCs use the caller's bearer token; only injected invitation delivery/completion uses server administration privileges.
 */
export const roles = [
  "owner",
  "admin",
  "management",
  "senior_lecturer",
  "lecturer",
  "client",
  "participant",
  "guest",
  "guest",
  "guest",
] as const;
// Allowed target roles are input values, not evidence of the caller's authority.
export type AccountRole = (typeof roles)[number];
// Validated invitation request with a durable retry key and optional organization binding.
export interface Invitation {
  email: string;
  display_name: string;
  role: AccountRole;
  organisation_id: string | null;
  idempotency_key: string;
}
// Bounded RPC result; do not expose internal database errors to HTTP clients.
interface RpcResult {
  data: unknown;
  error?: { code?: string } | null;
}
// Separate caller-scoped database operations from server-only delivery/completion privileges.
export interface AccountDependencies {
  origins: string[];
  appOrigin: string;
  invitationsEnabled: boolean;
  authenticate: (token: string) => Promise<boolean>;
  rpc: (
    token: string,
    name: string,
    args?: Record<string, unknown>,
  ) => Promise<RpcResult>;
  sendInvitation: (invitation: Invitation, redirect: string) => Promise<string>;
  completeInvitation: (
    id: string,
    userId: string | null,
    displayName: string,
    success: boolean,
  ) => Promise<void>;
  openapi: unknown;
}
// Validate an input UUID's format; a valid identifier grants no access.
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
// Accept only JSON objects as payloads; arrays and null do not satisfy the field contract.
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
// Normalize the allowed invitation payload and bind client accounts to one valid organization.
export function parseInvitation(value: unknown): Invitation | null {
  if (
    !object(value) ||
    Object.keys(value).some(
      (key) =>
        ![
          "email",
          "display_name",
          "role",
          "organisation_id",
          "idempotency_key",
        ].includes(key),
    )
  )
    return null;
  const {
    email,
    display_name = "",
    role = "lecturer",
    organisation_id = null,
    idempotency_key,
  } = value;
  if (
    typeof email !== "string" ||
    email.trim().length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
    typeof display_name !== "string" ||
    display_name.length > 120 ||
    !roles.includes(role as AccountRole) ||
    !uuid(idempotency_key) ||
    (organisation_id !== null && !uuid(organisation_id)) ||
    (role !== "client" && organisation_id !== null)
  )
    return null;
  return {
    email: email.trim().toLowerCase(),
    display_name: display_name.trim(),
    role: role as AccountRole,
    organisation_id: organisation_id as string | null,
    idempotency_key,
  };
}
// Bound actual JSON bytes independently of Content-Length and reject invalid UTF-8.
async function body(request: Request): Promise<unknown> {
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    throw new Error("json_required");
  const limit = 16 * 1024;
  if (Number(request.headers.get("content-length") ?? 0) > limit)
    throw new Error("request_too_large");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("invalid_request");
  const parts: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    length += next.value.length;
    if (length > limit) {
      await reader.cancel();
      throw new Error("request_too_large");
    }
    parts.push(next.value);
  }
  const bytes = new Uint8Array(length);
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.length;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("invalid_request");
  }
}
// Map methods/payloads to caller-scoped RPCs and translate database failures into stable HTTP errors without internal details.
export function createAccountHandler(deps: AccountDependencies) {
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get("origin") ?? "";
    // CLI/API clients may omit Origin. Browser origins are an explicit allowlist;
    // authentication uses bearer headers, never ambient cookies.
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      Vary: "Origin",
    };
    if (origin && deps.origins.includes(origin))
      Object.assign(headers, {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Headers":
          "authorization,apikey,content-type,x-client-info",
        "Access-Control-Allow-Methods":
          "GET, PATCH, PUT, POST, DELETE, OPTIONS",
      });
    const response = (status: number, data: unknown) =>
      new Response(JSON.stringify(data), { status, headers });
    if (origin && !deps.origins.includes(origin))
      return response(403, { error: "origin_not_allowed" });
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers });
    const url = new URL(request.url);
    const segments = url.pathname.split("/").filter(Boolean);
    const index = segments.indexOf("accounts");
    const path =
      "/" + (index >= 0 ? segments.slice(index + 1) : segments).join("/");
    if (path === "/openapi.json" && request.method === "GET")
      return response(200, deps.openapi);
    const token = /^Bearer (\S+)$/.exec(
      request.headers.get("authorization") ?? "",
    )?.[1];
    if (!token) return response(401, { error: "authentication_required" });
    try {
      if (!(await deps.authenticate(token)))
        return response(401, { error: "authentication_required" });
      const call = async (name: string, args?: Record<string, unknown>) => {
        const result = await deps.rpc(token, name, args);
        if (result.error) {
          const status =
            result.error.code === "42501"
              ? 403
              : ["22023", "23514", "23505"].includes(result.error.code ?? "")
                ? 400
                : 503;
          return response(status, {
            error:
              status === 403
                ? "permission_or_mfa_required"
                : status === 400
                  ? "invalid_request"
                  : "service_unavailable",
          });
        }
        return response(200, result.data);
      };
      // Own-profile and management requests use the same caller-scoped RPC path; target IDs never replace the actor.
      if (path === "/v1/me") {
        if (request.method === "GET") return await call("account_me");
        if (request.method === "PATCH") {
          const payload = await body(request);
          if (!object(payload))
            return response(400, { error: "invalid_request" });
          return await call("save_account_profile", { p_payload: payload });
        }
        return response(405, { error: "method_not_allowed" });
      }
      if (path === "/v1/roles" && request.method === "GET")
        return await call("account_role_catalog");
      if (path === "/v1/users" && request.method === "GET") {
        const limit = Number(url.searchParams.get("limit") ?? 50);
        const offset = Number(url.searchParams.get("offset") ?? 0);
        const search = url.searchParams.get("q") ?? "";
        if (
          !Number.isInteger(limit) ||
          limit < 1 ||
          limit > 100 ||
          !Number.isInteger(offset) ||
          offset < 0 ||
          offset > 100000 ||
          search.length > 120
        )
          return response(400, { error: "invalid_request" });
        return await call("account_users", {
          p_search: search,
          p_limit: limit,
          p_offset: offset,
        });
      }
      const organisationTarget =
        /^\/v1\/users\/([^/]+)\/organisations\/([^/]+)$/.exec(path);
      if (organisationTarget) {
        if (!uuid(organisationTarget[1]) || !uuid(organisationTarget[2]))
          return response(400, { error: "invalid_request" });
        if (!["PUT", "DELETE"].includes(request.method))
          return response(405, { error: "method_not_allowed" });
        return await call("manage_client_organisation", {
          p_user_id: organisationTarget[1],
          p_organisation_id: organisationTarget[2],
          p_remove: request.method === "DELETE",
        });
      }
      const target = /^\/v1\/users\/([^/]+)\/(roles|status)$/.exec(path);
      if (target) {
        if (!uuid(target[1]))
          return response(400, { error: "invalid_request" });
        const expected = target[2] === "roles" ? "PUT" : "PATCH";
        if (request.method !== expected)
          return response(405, { error: "method_not_allowed" });
        const payload = await body(request);
        if (!object(payload))
          return response(400, { error: "invalid_request" });
        if (target[2] === "roles") {
          if (
            Object.keys(payload).some((key) => key !== "roles") ||
            !Array.isArray(payload.roles) ||
            payload.roles.length < 1 ||
            payload.roles.length > 7 ||
            payload.roles.some((role) => !roles.includes(role as AccountRole))
          )
            return response(400, { error: "invalid_request" });
          return await call("set_account_roles", {
            p_user_id: target[1],
            p_roles: payload.roles,
          });
        }
        if (
          Object.keys(payload).some((key) => key !== "active") ||
          typeof payload.active !== "boolean"
        )
          return response(400, { error: "invalid_request" });
        return await call("set_user_active", {
          p_user_id: target[1],
          p_active: payload.active,
        });
      }
      if (path === "/v1/invitations" && request.method === "POST") {
        if (!deps.invitationsEnabled)
          return response(503, { error: "invitations_disabled" });
        const invitation = parseInvitation(await body(request));
        if (!invitation) return response(400, { error: "invalid_request" });
        // Complete the shared durable reservation before invoking external delivery.
        const reserved = await deps.rpc(token, "reserve_account_invitation", {
          p_email: invitation.email,
          p_display_name: invitation.display_name,
          p_role: invitation.role,
          p_organisation_id: invitation.organisation_id,
          p_idempotency_key: invitation.idempotency_key,
        });
        if (reserved.error)
          return response(reserved.error.code === "42501" ? 403 : 400, {
            error:
              reserved.error.code === "42501"
                ? "permission_or_mfa_required"
                : "invalid_request",
          });
        const result = reserved.data as {
          status: string;
          invitation_id?: string;
        };
        // Retries and throttling return existing state without sending another invitation.
        if (result.status !== "reserved")
          return response(
            result.status === "throttled"
              ? 429
              : result.status === "idempotency_conflict"
                ? 409
                : 200,
            result,
          );
        if (!uuid(result.invitation_id))
          return response(503, { error: "service_unavailable" });
        let userId: string;
        try {
          userId = await deps.sendInvitation(
            invitation,
            new URL("/auth/callback", deps.appOrigin).toString(),
          );
        } catch {
          await deps.completeInvitation(
            result.invitation_id,
            null,
            invitation.display_name,
            false,
          );
          return response(502, {
            status: "failed",
            invitation_id: result.invitation_id,
          });
        }
        // If completion fails after delivery, keep the reservation so automatic retries cannot duplicate the invitation.
        await deps.completeInvitation(
          result.invitation_id,
          userId,
          invitation.display_name,
          true,
        );
        return response(200, {
          status: "sent",
          invitation_id: result.invitation_id,
        });
      }
      return response(404, { error: "not_found" });
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      return response(
        code === "request_too_large"
          ? 413
          : code === "json_required"
            ? 415
            : code === "invalid_request" || error instanceof SyntaxError
              ? 400
              : 503,
        {
          error: [
            "request_too_large",
            "json_required",
            "invalid_request",
          ].includes(code)
            ? code
            : error instanceof SyntaxError
              ? "invalid_request"
              : "service_unavailable",
        },
      );
    }
  };
}
