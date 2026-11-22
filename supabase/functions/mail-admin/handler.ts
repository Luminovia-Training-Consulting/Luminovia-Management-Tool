/** Queue and report private SMTP/IMAP connection checks without exposing credentials or provider diagnostics. */
import {boundedJson} from "../_shared/bounded-body.ts";

export type MailProtocol = "smtp" | "imap";
type RelayResult = {
    status: "succeeded" | "failed";
    error_code: string | null;
};
export type MailAdminDependencies = {
    origins: string[];
    relayAvailable: boolean;
    queueTest: (
        userToken: string,
        protocol: MailProtocol,
    ) => Promise<{ data: unknown; error: { code?: string } | null }>;
    relayTest: (testId: string) => Promise<unknown>;
};

const safeErrors = new Set([
    "connect_failed",
    "tls_failed",
    "authentication_failed",
    "protocol_failed",
    "timeout",
    "configuration_changed",
    "configuration_unavailable",
]);
const responseHeaders = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
};

/** Return a JSON failure without including SQL, relay, URL, or secret-bearing error text. */
function response(
    status: number,
    body: Record<string, unknown>,
    origin?: string,
) {
    const headers = new Headers(responseHeaders);
    if (origin) {
        headers.set("Access-Control-Allow-Origin", origin);
        headers.set("Vary", "Origin");
    }
    return new Response(status === 204 ? null : JSON.stringify(body), {
        status,
        headers,
    });
}

/** Accept only one small protocol request and let SQL enforce current admin authority. */
export function createMailAdminHandler(deps: MailAdminDependencies) {
    return async function handle(request: Request): Promise<Response> {
        const origin = request.headers.get("origin") ?? undefined;
        if (origin && !deps.origins.includes(origin))
            return response(403, {error: "origin_not_allowed"});
        if (request.method === "OPTIONS") {
            if (!origin) return response(204, {});
            const preflight = response(204, {}, origin);
            preflight.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
            preflight.headers.set(
                "Access-Control-Allow-Headers",
                "authorization, apikey, content-type, x-client-info",
            );
            preflight.headers.set("Access-Control-Max-Age", "600");
            return preflight;
        }
        if (request.method !== "POST")
            return response(405, {error: "method_not_allowed"}, origin);
        const authorization = request.headers.get("authorization") ?? "";
        const token = /^Bearer ([A-Za-z0-9._~-]{20,8192})$/.exec(
            authorization,
        )?.[1];
        if (!token)
            return response(401, {error: "authentication_required"}, origin);
        if (
            request.headers.get("content-type")?.split(";", 1)[0].trim() !==
            "application/json"
        )
            return response(400, {error: "invalid_request"}, origin);

        let body: unknown;
        try {
            body = await boundedJson(request, 2048);
        } catch {
            return response(400, {error: "invalid_request"}, origin);
        }
        if (
            !body ||
            typeof body !== "object" ||
            Array.isArray(body) ||
            !["smtp", "imap"].includes(
                (body as Record<string, unknown>).protocol as string,
            ) ||
            Object.keys(body).length !== 1
        )
            return response(400, {error: "invalid_request"}, origin);
        if (!deps.relayAvailable)
            return response(503, {error: "test_unavailable"}, origin);

        const protocol = (body as { protocol: MailProtocol }).protocol;
        let queued: { data: unknown; error: { code?: string } | null };
        try {
            queued = await deps.queueTest(token, protocol);
        } catch {
            return response(503, {error: "test_unavailable"}, origin);
        }
        if (queued.error) {
            return response(
                queued.error.code === "42501" ? 403 : 503,
                {
                    error:
                        queued.error.code === "42501"
                            ? "permission_denied"
                            : "test_unavailable",
                },
                origin,
            );
        }
        if (
            typeof queued.data !== "string" ||
            !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(queued.data)
        )
            return response(503, {error: "test_unavailable"}, origin);

        try {
            const result = (await deps.relayTest(
                queued.data,
            )) as Partial<RelayResult>;
            if (result.status !== "succeeded" && result.status !== "failed")
                return response(503, {error: "test_unavailable"}, origin);
            const errorCode =
                typeof result.error_code === "string" &&
                safeErrors.has(result.error_code)
                    ? result.error_code
                    : null;
            return response(
                200,
                {
                    status: result.status,
                    error_code: result.status === "failed" ? errorCode : null,
                },
                origin,
            );
        } catch {
            return response(503, {error: "test_unavailable"}, origin);
        }
    };
}