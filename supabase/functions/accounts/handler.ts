/**
 * Account-management HTTP contract. Business RPCs use the caller's bearer token;
 * injected invitation and confirmed-deletion adapters hold server privileges.
 */
import type {DeletionResult} from "./deletion-worker.ts";

export const roles = [
    "owner",
    "admin",
    "management",
    "senior_lecturer",
    "lecturer",
    "client",
    "guest",
] as const;
// Allowed target roles are input values, not evidence of the caller's authority.
export type AccountRole = (typeof roles)[number];
type ProvisionedRole = AccountRole | "participant";

// Validated invitation request with a durable retry key and optional organization binding.
export interface Invitation<Role = AccountRole> {
    email: string;
    display_name: string;
    role: Role;
    organisation_id: string | null;
    idempotency_key: string;
}

// Bounded RPC result; do not expose internal database errors to HTTP clients.
interface RpcResult {
    data: unknown;
    error?: { code?: string; details?: string | null } | null;
}

// Separate caller-scoped database operations from server-only delivery/completion privileges.
export interface AccountDependencies {
    origins: string[];
    appOrigin: string;
    invitationsEnabled: boolean;
    authenticate: (token: string) => Promise<boolean>;
    authenticateAcademy?: (token: string) => Promise<boolean>;
    rpc: (
        token: string,
        name: string,
        args?: Record<string, unknown>,
    ) => Promise<RpcResult>;
    privilegedRpc?: (
        name: string,
        args?: Record<string, unknown>,
    ) => Promise<RpcResult>;
    sendInvitation: (
        invitation: Invitation<ProvisionedRole>,
        redirect: string,
    ) => Promise<string>;
    createAccount?: (
        account: Invitation<ProvisionedRole> & { password: string },
    ) => Promise<string>;
    completeAccount?: (
        id: string,
        userId: string | null,
        success: boolean,
    ) => Promise<void>;
    removeCreatedAccount?: (id: string) => Promise<void>;
    completeInvitation: (
        id: string,
        userId: string | null,
        displayName: string,
        success: boolean,
    ) => Promise<void>;
    executeDeletion?: (
        token: string,
        operationId: string,
    ) => Promise<DeletionResult>;
    openapi: unknown;
    /** The static account contract belongs to the current internal edition. */
    canPublishOpenApi?: () => Promise<boolean>;
}

// Validate an input UUID's format; a valid identifier grants no access.
const uuid = (value: unknown): value is string =>
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

// Accept only JSON objects as payloads; arrays and null do not satisfy the field contract.
function object(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function validAccountPassword(value: unknown): value is string {
    return typeof value === "string" &&
        value.length >= 8 && value.length <= 128 &&
        /[A-Z]/.test(value) && /[a-z]/.test(value) && /[0-9]/.test(value) &&
        /[!@#$%^&*()_+\-=\[\]{}|;:,.<>?\/]/.test(value) && !/[\x00-\x1f\x7f]/.test(value);
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
    ) {
        return null;
    }
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
    ) {
        return null;
    }
    return {
        email: email.trim().toLowerCase(),
        display_name: display_name.trim(),
        role: role as AccountRole,
        organisation_id: organisation_id as string | null,
        idempotency_key,
    };
}

/** Accept only the company-scoped participant invitation contract; role is fixed server-side. */
export function parseCompanyParticipantInvitation(
    value: unknown,
): Invitation<"participant"> | null {
    if (
        !object(value) ||
        Object.keys(value).some(
            (key) =>
                !["email", "display_name", "organisation_id", "idempotency_key"].includes(key),
        )
    )
        return null;
    const {email, display_name, organisation_id, idempotency_key} = value;
    if (
        typeof email !== "string" ||
        email.trim().length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
        typeof display_name !== "string" ||
        display_name.trim().length < 1 ||
        display_name.trim().length > 120 ||
        !uuid(organisation_id) ||
        !uuid(idempotency_key)
    )
        return null;
    return {
        email: email.trim().toLowerCase(),
        display_name: display_name.trim(),
        role: "participant",
        organisation_id,
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
    ) {
        throw new Error("json_required");
    }
    const limit = 16 * 1024;
    if (Number(request.headers.get("content-length") ?? 0) > limit) {
        throw new Error("request_too_large");
    }
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
        return JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes));
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
        if (origin && deps.origins.includes(origin)) {
            Object.assign(headers, {
                "Access-Control-Allow-Origin": origin,
                "Access-Control-Allow-Headers":
                    "authorization,apikey,content-type,x-client-info",
                "Access-Control-Allow-Methods":
                    "GET, PATCH, PUT, POST, DELETE, OPTIONS",
            });
        }
        const response = (status: number, data: unknown) =>
            new Response(JSON.stringify(data), {status, headers});
        if (origin && !deps.origins.includes(origin)) {
            return response(403, {error: "origin_not_allowed"});
        }
        if (request.method === "OPTIONS") {
            return new Response(null, {status: 204, headers});
        }
        const url = new URL(request.url);
        const segments = url.pathname.split("/").filter(Boolean);
        const index = segments.indexOf("accounts");
        const path =
            "/" + (index >= 0 ? segments.slice(index + 1) : segments).join("/");
        if (path === "/openapi.json" && request.method === "GET") {
            try {
                if (await deps.canPublishOpenApi?.()) return response(200, deps.openapi);
                return response(404, {error: "not_found"});
            } catch {
                return response(503, {error: "service_unavailable"});
            }
        }
        const token = /^Bearer (\S+)$/.exec(
            request.headers.get("authorization") ?? "",
        )?.[1];
        if (!token) return response(401, {error: "authentication_required"});
        try {
            if (path === "/v1/academy/users") {
                if (request.method !== "POST") return response(405, {error: "method_not_allowed"});
                if (!(await deps.authenticateAcademy?.(token)))
                    return response(401, {error: "authentication_required"});
                const input = await body(request);
                if (!object(input)) return response(400, {error: "invalid_request"});
                const {mode, password, role, organisation_id, ...metadata} = input;
                const base = parseInvitation(metadata);
                if (!base?.display_name ||
                    (role !== "lecturer" && role !== "participant" && role !== "management") ||
                    (role === "participant" ? !uuid(organisation_id) : organisation_id !== null) ||
                    (mode !== "password" && mode !== "invite") ||
                    (mode === "password" ? !validAccountPassword(password) : password !== undefined))
                    return response(400, {error: "invalid_request"});
                if (!deps.privilegedRpc || !deps.removeCreatedAccount ||
                    (mode === "password" ? !deps.createAccount : !deps.invitationsEnabled))
                    return response(503, {error: mode === "invite" ? "invitations_disabled" : "creation_disabled"});
                const invitation: Invitation<ProvisionedRole> = {
                    ...base, role, organisation_id: role === "participant" ? organisation_id as string : null,
                };
                const reservation = await deps.rpc(token, "reserve_academy_account", {
                    p_request_id: invitation.idempotency_key,
                    p_email: invitation.email,
                    p_display_name: invitation.display_name,
                    p_role: invitation.role,
                    p_organisation_id: invitation.organisation_id,
                    p_mode: mode,
                });
                const reservationError = reservation.error?.code;
                if (reservationError === "42501") return response(403, {error: "permission_required"});
                if (reservationError === "PT409") {
                    const error = reservation.error?.details === "academy_seat_limit"
                        ? "academy_seat_limit" : "creation_conflict";
                    return response(409, {error});
                }
                if (reservationError === "PT429") return response(429, {error: "creation_rate_limited"});
                if (reservationError === "22023") return response(400, {error: "invalid_request"});
                if (reservation.error || !object(reservation.data) || !uuid(reservation.data.creation_id))
                    return response(503, {error: "creation_unavailable"});

                const record = reservation.data;
                const creationId = record.creation_id;
                const receipt = (status: number, userId: string) =>
                    response(status, {status: "created", user_id: userId});
                if (record.status === "created" && uuid(record.user_id)) return receipt(200, record.user_id);
                if (record.status === "in_progress") return response(202, {status: "in_progress"});
                if (record.status !== "reserved" && record.status !== "cleanup")
                    return response(409, {error: "creation_conflict"});

                const finish = (decision: "complete" | "cleanup" | "discard", id: string | null) =>
                    deps.privilegedRpc!("finish_academy_account", {
                        p_creation_id: creationId, p_user_id: id, p_decision: decision,
                    });
                let createdId: string | null = null;
                let completionCode: string | undefined;
                if (record.status === "reserved") {
                    try {
                        const identity = mode === "invite"
                            ? await deps.sendInvitation(invitation, `${deps.appOrigin}/auth/callback?type=invite`)
                            : await deps.createAccount!({...invitation, password: password as string});
                        if (!uuid(identity)) throw new Error("creation_failed");
                        createdId = identity;
                        const completed = await finish("complete", identity);
                        completionCode = completed.error?.code;
                        if (!completed.error && object(completed.data) &&
                            completed.data.status === "created" && completed.data.user_id === identity)
                            return receipt(201, identity);
                    } catch {
                        // Auth or PostgREST may have committed before the transport failed.
                    }
                }
                const cleanup = await finish("cleanup", createdId);
                if (cleanup.error || !object(cleanup.data)) return response(502, {error: "creation_failed"});
                if (cleanup.data.status === "created" && uuid(cleanup.data.user_id))
                    return receipt(200, cleanup.data.user_id);
                if (cleanup.data.status === "cleanup" && uuid(cleanup.data.user_id)) {
                    const id = cleanup.data.user_id;
                    await deps.removeCreatedAccount(id);
                    const discarded = await finish("discard", id);
                    if (discarded.error || !object(discarded.data) || discarded.data.status !== "failed")
                        return response(502, {error: "creation_failed"});
                }
                return completionCode === "42501"
                    ? response(403, {error: "permission_required"})
                    : response(502, {error: "creation_failed"});
            }
            if (!(await deps.authenticate(token))) {
                return response(401, {error: "authentication_required"});
            }
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
                                ? "permission_required"
                                : status === 400
                                    ? "invalid_request"
                                    : "service_unavailable",
                    });
                }
                return response(200, result.data);
            };
            // Deletion plans are opaque database-owned capabilities. Target IDs and
            // kind names select a resource; they never establish authority or paths.
            if (path.startsWith("/v1/deletions/")) {
                const deletionCall = async (
                    name: string,
                    args?: Record<string, unknown>,
                ) => {
                    const result = await deps.rpc(token, name, args);
                    if (result.error) {
                        if (result.error.code === "42501") {
                            throw new Error("permission_required");
                        }
                        if (["23503", "40001", "P0001"].includes(result.error.code ?? "")) {
                            throw new Error("deletion_conflict");
                        }
                        if (["22023", "23514", "23505"].includes(result.error.code ?? "")) {
                            throw new Error("invalid_request");
                        }
                        throw new Error("deletion_unavailable");
                    }
                    return result.data;
                };
                const execute = async (operationId: string) => {
                    if (!deps.executeDeletion) throw new Error("deletion_unavailable");
                    const result = await deps.executeDeletion(token, operationId);
                    return response(result.status === "completed" ? 200 : 202, result);
                };
                if (path === "/v1/deletions/access") {
                    if (request.method !== "GET") {
                        return response(405, {error: "method_not_allowed"});
                    }
                    return response(200, await deletionCall("deletion_access"));
                }
                if (path === "/v1/deletions/operations") {
                    if (request.method !== "GET") {
                        return response(405, {error: "method_not_allowed"});
                    }
                    return response(200, await deletionCall("deletion_operations"));
                }
                if (path === "/v1/deletions/resources") {
                    if (request.method !== "GET") {
                        return response(405, {error: "method_not_allowed"});
                    }
                    const kind = url.searchParams.get("kind") ?? "";
                    const query = url.searchParams.get("q") ?? "";
                    const cursor = url.searchParams.get("cursor");
                    const limit = Number(url.searchParams.get("limit") ?? 25);
                    if (
                        !/^[a-z_]{1,40}$/.test(kind) ||
                        query.length > 120 ||
                        (cursor !== null && !uuid(cursor)) ||
                        !Number.isInteger(limit) ||
                        limit < 1 ||
                        limit > 100
                    ) {
                        return response(400, {error: "invalid_request"});
                    }
                    return response(
                        200,
                        await deletionCall("deletion_resources", {
                            p_kind: kind,
                            p_query: query,
                            p_cursor: cursor,
                            p_limit: limit,
                        }),
                    );
                }
                if (
                    path === "/v1/deletions/preview" ||
                    path === "/v1/deletions/confirm"
                ) {
                    if (request.method !== "POST") {
                        return response(405, {error: "method_not_allowed"});
                    }
                    const payload = await body(request);
                    if (!object(payload)) {
                        return response(400, {error: "invalid_request"});
                    }
                    if (path.endsWith("/preview")) {
                        if (
                            Object.keys(payload).some(
                                (key) => !["kind", "id"].includes(key),
                            ) ||
                            typeof payload.kind !== "string" ||
                            !/^[a-z_]{1,40}$/.test(payload.kind) ||
                            !uuid(payload.id)
                        ) {
                            return response(400, {error: "invalid_request"});
                        }
                        return response(
                            200,
                            await deletionCall("deletion_preview", {
                                p_kind: payload.kind,
                                p_id: payload.id,
                            }),
                        );
                    }
                    if (
                        Object.keys(payload).some(
                            (key) => !["plan_id", "request_id", "confirmation"].includes(key),
                        ) ||
                        !uuid(payload.plan_id) ||
                        !uuid(payload.request_id) ||
                        payload.confirmation !== "DELETE"
                    ) {
                        return response(400, {error: "invalid_request"});
                    }
                    const confirmed = await deletionCall("deletion_confirm", {
                        p_plan_id: payload.plan_id,
                        p_request_id: payload.request_id,
                        p_confirmation: payload.confirmation,
                    });
                    if (!object(confirmed) || !uuid(confirmed.operation_id)) {
                        throw new Error("deletion_unavailable");
                    }
                    // An idempotent retry can return a previously verified completion.
                    // Provider outages must never downgrade that committed result.
                    if (confirmed.status === "completed") return response(200, confirmed);
                    try {
                        return await execute(confirmed.operation_id);
                    } catch (error) {
                        // Confirmation has already committed the irreversible fence. Keep
                        // its receipt reachable when an external provider is unavailable;
                        // a 202 acknowledgement explicitly does not mean deletion success.
                        if (
                            error instanceof Error &&
                            error.message === "permission_required"
                        )
                            throw error;
                        return response(202, {...confirmed, status: "pending"});
                    }
                }
                const operation = /^\/v1\/deletions\/operations\/([^/]+)$/.exec(path);
                if (operation) {
                    if (request.method !== "POST") {
                        return response(405, {error: "method_not_allowed"});
                    }
                    const payload = await body(request);
                    if (
                        !uuid(operation[1]) ||
                        !object(payload) ||
                        Object.keys(payload).length > 0
                    ) {
                        return response(400, {error: "invalid_request"});
                    }
                    return await execute(operation[1]);
                }
                return response(404, {error: "not_found"});
            }
            // Own-profile and management requests use the same caller-scoped RPC path; target IDs never replace the actor.
            if (path === "/v1/me") {
                if (request.method === "GET") return await call("account_me");
                if (request.method === "PATCH") {
                    const payload = await body(request);
                    if (!object(payload)) {
                        return response(400, {error: "invalid_request"});
                    }
                    return await call("save_account_profile", {p_payload: payload});
                }
                return response(405, {error: "method_not_allowed"});
            }
            if (path === "/v1/roles" && request.method === "GET") {
                return await call("account_role_catalog");
            }
            if (path === "/v1/users" && request.method === "POST") {
                if (
                    !deps.createAccount ||
                    !deps.completeAccount ||
                    !deps.removeCreatedAccount
                )
                    return response(503, {error: "creation_disabled"});
                const payload = await body(request);
                if (!object(payload) || !validAccountPassword(payload.password))
                    return response(400, {error: "invalid_request"});
                const {password, ...metadata} = payload;
                const creation = parseInvitation(metadata);
                if (
                    !creation ||
                    !creation.display_name ||
                    creation.role === "owner" ||
                    (creation.role === "client" && !creation.organisation_id)
                )
                    return response(400, {error: "invalid_request"});
                const reserved = await deps.rpc(token, "reserve_account_creation", {
                    p_email: creation.email,
                    p_display_name: creation.display_name,
                    p_role: creation.role,
                    p_organisation_id: creation.organisation_id,
                    p_request_id: creation.idempotency_key,
                });
                if (reserved.error)
                    return response(
                        reserved.error.code === "42501"
                            ? 403
                            : reserved.error.code === "40001"
                                ? 409
                                : 400,
                        {
                            error:
                                reserved.error.code === "42501"
                                    ? "permission_required"
                                    : "invalid_request",
                        },
                    );
                const result = reserved.data as {
                    status: string;
                    creation_id?: string;
                    user_id?: string;
                };
                if (result.status !== "reserved")
                    return response(result.status === "created" ? 200 : 409, result);
                if (!uuid(result.creation_id))
                    return response(503, {error: "service_unavailable"});
                let createdId: string | null = null;
                try {
                    createdId = await deps.createAccount({...creation, password});
                    if (!uuid(createdId)) throw new Error("creation_failed");
                    await deps.completeAccount(result.creation_id, createdId, true);
                } catch {
                    // Only the freshly created identity can be rolled back. Existing email
                    // addresses are rejected by Auth and are never reused or reset.
                    if (createdId && uuid(createdId))
                        await deps.removeCreatedAccount(createdId);
                    await deps.completeAccount(result.creation_id, null, false);
                    return response(502, {error: "creation_failed"});
                }
                return response(201, {
                    status: "created",
                    creation_id: result.creation_id,
                    user_id: createdId,
                });
            }
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
                ) {
                    return response(400, {error: "invalid_request"});
                }
                return await call("account_users", {
                    p_search: search,
                    p_limit: limit,
                    p_offset: offset,
                });
            }
            const organisationTarget =
                /^\/v1\/users\/([^/]+)\/organisations\/([^/]+)$/.exec(path);
            if (organisationTarget) {
                if (!uuid(organisationTarget[1]) || !uuid(organisationTarget[2])) {
                    return response(400, {error: "invalid_request"});
                }
                if (!["PUT", "DELETE"].includes(request.method)) {
                    return response(405, {error: "method_not_allowed"});
                }
                return await call("manage_client_organisation", {
                    p_user_id: organisationTarget[1],
                    p_organisation_id: organisationTarget[2],
                    p_remove: request.method === "DELETE",
                });
            }
            const target = /^\/v1\/users\/([^/]+)\/(roles|status)$/.exec(path);
            if (target) {
                if (!uuid(target[1])) {
                    return response(400, {error: "invalid_request"});
                }
                const expected = target[2] === "roles" ? "PUT" : "PATCH";
                if (request.method !== expected) {
                    return response(405, {error: "method_not_allowed"});
                }
                const payload = await body(request);
                if (!object(payload)) {
                    return response(400, {error: "invalid_request"});
                }
                if (target[2] === "roles") {
                    if (
                        Object.keys(payload).some(
                            (key) => !["roles", "organisation_id"].includes(key),
                        ) ||
                        (payload.organisation_id !== undefined &&
                            !uuid(payload.organisation_id)) ||
                        !Array.isArray(payload.roles) ||
                        payload.roles.length < 1 ||
                        payload.roles.length > 7 ||
                        payload.roles.some((role) => !roles.includes(role as AccountRole))
                    ) {
                        return response(400, {error: "invalid_request"});
                    }
                    return await call(
                        payload.organisation_id === undefined
                            ? "set_account_roles"
                            : "set_account_roles_with_organisation",
                        {
                            p_user_id: target[1],
                            p_roles: payload.roles,
                            ...(payload.organisation_id === undefined
                                ? {}
                                : {p_organisation_id: payload.organisation_id}),
                        },
                    );
                }
                if (
                    Object.keys(payload).some((key) => key !== "active") ||
                    typeof payload.active !== "boolean"
                ) {
                    return response(400, {error: "invalid_request"});
                }
                return await call("set_user_active", {
                    p_user_id: target[1],
                    p_active: payload.active,
                });
            }
            if (
                path === "/v1/company-participant-invitations" &&
                request.method === "POST"
            ) {
                if (
                    !deps.invitationsEnabled ||
                    !deps.privilegedRpc ||
                    !deps.completeInvitation
                )
                    return response(503, {error: "invitations_disabled"});
                const invitation = parseCompanyParticipantInvitation(await body(request));
                if (!invitation) return response(400, {error: "invalid_request"});
                const reservation = await deps.rpc(
                    token,
                    "reserve_company_participant_invitation",
                    {
                        p_organisation_id: invitation.organisation_id,
                        p_email: invitation.email,
                        p_display_name: invitation.display_name,
                        p_request_id: invitation.idempotency_key,
                    },
                );
                if (reservation.error)
                    return response(
                        reservation.error.code === "42501"
                            ? 403
                            : reservation.error.code === "40001"
                                ? 409
                                : 400,
                        {
                            error:
                                reservation.error.code === "42501"
                                    ? "permission_required"
                                    : "invalid_request",
                        },
                    );
                const requestId = object(reservation.data)
                    ? reservation.data.request_id
                    : null;
                if (!uuid(requestId)) return response(202, {status: "requested"});
                const claimed = await deps.privilegedRpc(
                    "claim_company_participant_invitation",
                    {p_request_id: requestId},
                );
                const delivery = object(claimed.data) ? claimed.data : null;
                if (
                    claimed.error ||
                    !delivery ||
                    delivery.deliver !== true ||
                    !uuid(delivery.invitation_id) ||
                    !uuid(delivery.organisation_id) ||
                    typeof delivery.email !== "string" ||
                    typeof delivery.display_name !== "string" ||
                    typeof delivery.idempotency_key !== "string" ||
                    delivery.role !== "participant"
                )
                    return response(202, {status: "requested"});
                const reservedInvitation: Invitation<"participant"> = {
                    email: delivery.email,
                    display_name: delivery.display_name,
                    role: "participant",
                    organisation_id: delivery.organisation_id,
                    idempotency_key: delivery.idempotency_key,
                };
                try {
                    const userId = await deps.sendInvitation(
                        reservedInvitation,
                        `${deps.appOrigin}/auth/callback?type=invite`,
                    );
                    await deps.completeInvitation(
                        delivery.invitation_id,
                        userId,
                        delivery.display_name,
                        true,
                    );
                    await deps.privilegedRpc("finish_company_participant_invitation", {
                        p_request_id: requestId,
                        p_success: true,
                    });
                } catch {
                    try {
                        await deps.completeInvitation(
                            delivery.invitation_id,
                            null,
                            delivery.display_name,
                            false,
                        );
                    } catch {
                        // Never turn delivery diagnostics into account-existence evidence.
                    }
                    try {
                        await deps.privilegedRpc("finish_company_participant_invitation", {
                            p_request_id: requestId,
                            p_success: false,
                        });
                    } catch {
                        // The service queue remains private and can be reconciled by operations.
                    }
                }
                return response(202, {status: "requested"});
            }
            if (path === "/v1/invitations" && request.method === "POST") {
                if (!deps.invitationsEnabled) {
                    return response(503, {error: "invitations_disabled"});
                }
                const invitation = parseInvitation(await body(request));
                if (!invitation) return response(400, {error: "invalid_request"});
                // Complete the shared durable reservation before invoking external delivery.
                const reserved = await deps.rpc(token, "reserve_account_invitation", {
                    p_email: invitation.email,
                    p_display_name: invitation.display_name,
                    p_role: invitation.role,
                    p_organisation_id: invitation.organisation_id,
                    p_idempotency_key: invitation.idempotency_key,
                });
                if (reserved.error) {
                    return response(reserved.error.code === "42501" ? 403 : 400, {
                        error:
                            reserved.error.code === "42501"
                                ? "permission_required"
                                : "invalid_request",
                    });
                }
                const result = reserved.data as {
                    status: string;
                    invitation_id?: string;
                };
                // Retries and throttling return existing state without sending another invitation.
                if (result.status !== "reserved") {
                    return response(
                        result.status === "throttled"
                            ? 429
                            : result.status === "idempotency_conflict"
                                ? 409
                                : 200,
                        result,
                    );
                }
                if (!uuid(result.invitation_id)) {
                    return response(503, {error: "service_unavailable"});
                }
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
            return response(404, {error: "not_found"});
        } catch (error) {
            const code = error instanceof Error ? error.message : "";
            return response(
                code === "permission_required"
                    ? 403
                    : code === "deletion_conflict"
                        ? 409
                        : code === "request_too_large"
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
                        "permission_required",
                        "deletion_conflict",
                        "deletion_unavailable",
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
