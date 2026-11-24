/**
 * Testable invitation handler with durable database reservation before delivery. Do not automatically resend ambiguous results; the reservation distinguishes retries.
 */
/** Dependency-injected invitation boundary. All sends require a durable DB reservation first. */
import {boundedJson, RequestBodyTooLarge} from "../_shared/bounded-body.ts";
import {definiteInvitationRejection} from "../_shared/invitation-delivery-rejection.ts";

// Validated request with normalized email and an explicit retry key.
export type InviteBody = {
    email: string;
    display_name: string;
    idempotency_key: string;
};
// Durable reservation result; only reserved permits delivery.
type Reservation = { status: string; invitation_id?: string };
// Testable boundary for actual caller permissions, reservation, delivery and durable completion.
export type InviteDependencies = {
    enabled: boolean;
    allowedOrigins: readonly string[];
    appOrigin: string;
    authorize: (token: string) => Promise<boolean>;
    reserve: (token: string, body: InviteBody) => Promise<Reservation>;
    send: (body: InviteBody, redirectTo: string) => Promise<string>;
    rejectDelivery?: (id: string, definite: boolean) => Promise<void>;
    complete: (
        id: string,
        userId: string | null,
        name: string,
        success: boolean,
    ) => Promise<void>;
};

// Reject unknown fields and normalize email, display name and retry key.
export function parseBody(value: unknown): InviteBody | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const v = value as Record<string, unknown>;
    if (
        Object.keys(v).some(
            (k) => !["email", "display_name", "idempotency_key"].includes(k),
        )
    )
        return null;
    if (typeof v.email !== "string" || typeof v.idempotency_key !== "string")
        return null;
    const email = v.email.trim().toLowerCase();
    if (
        email.length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            v.idempotency_key,
        )
    )
        return null;
    if (
        v.display_name !== undefined &&
        (typeof v.display_name !== "string" || v.display_name.length > 120)
    )
        return null;
    return {
        email,
        idempotency_key: v.idempotency_key,
        display_name:
            typeof v.display_name === "string" ? v.display_name.trim() : "",
    };
}

// Check origin/Auth and reserve durably before sending; ambiguous delivery failures remain blocked against automatic retries.
export function createHandler(deps: InviteDependencies) {
    return async (request: Request): Promise<Response> => {
        const origin = request.headers.get("Origin") ?? "";
        const allowed = deps.allowedOrigins.includes(origin);
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
            Vary: "Origin",
        };
        if (allowed)
            Object.assign(headers, {
                "Access-Control-Allow-Origin": origin,
                "Access-Control-Allow-Headers":
                    "authorization,apikey,content-type,x-client-info",
                "Access-Control-Allow-Methods": "POST, OPTIONS",
            });
        const respond = (status: number, body: unknown) =>
            new Response(JSON.stringify(body), {status, headers});
        if (!allowed) return respond(403, {error: "origin_not_allowed"});
        if (request.method === "OPTIONS")
            return new Response(null, {status: 204, headers});
        if (request.method !== "POST")
            return respond(405, {error: "method_not_allowed"});
        if (!deps.enabled) return respond(503, {error: "invitations_disabled"});
        const token = /^Bearer (\S+)$/.exec(
            request.headers.get("Authorization") ?? "",
        )?.[1];
        if (!token) return respond(401, {error: "authentication_required"});
        try {
            if (!(await deps.authorize(token)))
                return respond(403, {error: "permission_required"});
            let parsed: unknown;
            try {
                parsed = await boundedJson(request, 2048);
            } catch (error) {
                if (error instanceof RequestBodyTooLarge)
                    return respond(413, {error: "request_too_large"});
                return respond(400, {error: "invalid_request"});
            }
            const body = parseBody(parsed);
            if (!body) return respond(400, {error: "invalid_request"});
            const reservation = await deps.reserve(token, body);
            if (reservation.status !== "reserved")
                return respond(
                    reservation.status === "throttled"
                        ? 429
                        : reservation.status === "idempotency_conflict"
                            ? 409
                            : 200,
                    reservation,
                );
            if (!reservation.invitation_id)
                throw new Error("Reservation unavailable");
            let userId: string;
            try {
                userId = await deps.send(
                    body,
                    new URL("/auth/callback", deps.appOrigin).toString(),
                );
            } catch (error) {
                if (deps.rejectDelivery) {
                    await deps.rejectDelivery(reservation.invitation_id, definiteInvitationRejection(error));
                } else {
                    await deps.complete(reservation.invitation_id, null, body.display_name, false);
                }
                return respond(502, {
                    status: "failed",
                    invitation_id: reservation.invitation_id,
                });
            }
            // Failure after the email sent leaves reservation in_progress, preventing duplicate send.
            await deps.complete(
                reservation.invitation_id,
                userId,
                body.display_name,
                true,
            );
            return respond(200, {
                status: "sent",
                invitation_id: reservation.invitation_id,
            });
        } catch {
            return respond(503, {error: "invitation_unavailable"});
        }
    };
}