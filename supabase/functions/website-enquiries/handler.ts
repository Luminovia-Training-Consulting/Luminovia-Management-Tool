/** Bounded integration-only HTTP intake: validate/authenticate before one durable RPC. */
import {timingSafeEqual} from "node:crypto";
import {boundedJson, RequestBodyTooLarge} from "../_shared/bounded-body.ts";

export interface EnquiryConfiguration {
    enabled: boolean;
    integrationToken: string;
    websiteOrigin: string;
    privacyNoticeVersion: string;
}

export interface EnquiryDependencies {
    receive: (
        sender: string,
        submission: string,
        payload: Record<string, unknown>,
    ) => Promise<{
        data: unknown;
        error: { code?: string; message?: string } | null;
    }>;
}

const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const encoder = new TextEncoder();

/** Fixed-size digest comparisons avoid revealing useful token-prefix timing. */
async function digest(text: string) {
    return new Uint8Array(
        await crypto.subtle.digest("SHA-256", encoder.encode(text)),
    );
}

/** Accept exact server-owned origins only; permissive paths/wildcards are configuration errors. */
function validOrigin(value: string) {
    try {
        const url = new URL(value);
        return (
            url.origin === value &&
            (url.protocol === "https:" ||
                (url.protocol === "http:" &&
                    ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)))
        );
    } catch {
        return false;
    }
}

/** Normalise a small allowlist; no claimed identity/role/customer identifier is accepted. */
function validatedInput(
    value: unknown,
): { submission: string; payload: Record<string, unknown> } | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const input = value as Record<string, unknown>;
    const fields = [
        "company_name",
        "contact_name",
        "email",
        "phone",
        "topic",
        "message",
        "preferred_dates",
        "duration",
        "delivery_type",
        "time_zone",
        "locale",
        "privacy_notice_version",
    ];
    if (
        Object.keys(input).some(
            (key) =>
                ![...fields, "submission_id", "consent", "website"].includes(key),
        ) ||
        fields.some((key) => typeof input[key] !== "string") ||
        typeof input.submission_id !== "string" ||
        !uuid.test(input.submission_id) ||
        input.consent !== true ||
        (input.website !== undefined && input.website !== "")
    )
        return null;
    const text = Object.fromEntries(
        fields.map((key) => [key, (input[key] as string).trim()]),
    );
    if (
        !text.company_name ||
        text.company_name.length > 200 ||
        !text.contact_name ||
        text.contact_name.length > 120 ||
        text.email.length > 254 ||
        !/^(?:[A-Za-z0-9_+'-]+\.)*[A-Za-z0-9_+'-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/.test(
            text.email,
        ) ||
        text.phone.length > 60 ||
        /[\u0000-\u001f\u007f]/.test(text.phone) ||
        !text.topic ||
        text.topic.length > 200 ||
        !text.message ||
        text.message.length > 12000 ||
        text.preferred_dates.length > 1000 ||
        text.duration.length > 200 ||
        !["online", "onsite", "flexible"].includes(text.delivery_type) ||
        !["de", "en"].includes(text.locale) ||
        !text.privacy_notice_version ||
        text.privacy_notice_version.length > 120
    )
        return null;
    try {
        new Intl.DateTimeFormat("en", {timeZone: text.time_zone});
    } catch {
        return null;
    }
    return {
        submission: input.submission_id,
        payload: {...text, email: text.email.toLowerCase(), consent: true},
    };
}

/** Authenticated server-to-server intake; never embed its token in the Website. */
export function createWebsiteEnquiryHandler(
    configuration: EnquiryConfiguration,
    dependencies: EnquiryDependencies,
) {
    return async (request: Request): Promise<Response> => {
        const headers = {
            "Content-Type": "application/json",
            "Cache-Control": "no-store, private",
            Pragma: "no-cache",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer",
        };
        const json = (status: number, body: unknown) =>
            new Response(JSON.stringify(body), {status, headers});
        if (request.method !== "POST")
            return json(405, {error: "method_not_allowed"});
        if (
            !configuration.enabled ||
            configuration.integrationToken.length < 32 ||
            configuration.integrationToken.length > 256 ||
            !validOrigin(configuration.websiteOrigin) ||
            configuration.privacyNoticeVersion.length < 1 ||
            configuration.privacyNoticeVersion.length > 120
        )
            return json(503, {error: "integration_unavailable"});
        // Origin is only a secondary boundary. Authentication always uses the
        // separately provisioned server credential; client IP headers are ignored.
        const origin = request.headers.get("Origin");
        if (origin !== null && origin !== configuration.websiteOrigin)
            return json(403, {error: "origin_not_allowed"});
        const token = request.headers.get("X-Luminovia-Integration-Token") ?? "";
        if (
            token.length < 32 ||
            token.length > 256 ||
            !timingSafeEqual(
                await digest(token),
                await digest(configuration.integrationToken),
            )
        )
            return json(401, {error: "integration_authentication_required"});
        if (
            request.headers
                .get("Content-Type")
                ?.split(";")[0]
                .trim()
                .toLowerCase() !== "application/json"
        )
            return json(415, {error: "json_required"});
        let input;
        try {
            input = validatedInput(await boundedJson(request, 24000));
        } catch (error) {
            return json(
                error instanceof RequestBodyTooLarge ? 413 : 400,
                {error: "invalid_request"},
            );
        }
        if (
            !input ||
            input.payload.privacy_notice_version !==
            configuration.privacyNoticeVersion
        )
            return json(400, {error: "invalid_request"});
        const sender = [...(await digest(configuration.integrationToken))]
            .map((byte) => byte.toString(16).padStart(2, "0"))
            .join("");
        try {
            const result = await dependencies.receive(
                sender,
                input.submission,
                input.payload,
            );
            if (result.error?.code === "54000")
                return json(429, {error: "rate_limited"});
            if (result.error?.message === "Website enquiry retry conflict")
                return json(409, {error: "retry_conflict"});
            if (result.error?.code === "22023")
                return json(400, {error: "invalid_request"});
            if (
                result.error ||
                typeof result.data !== "string" ||
                !uuid.test(result.data)
            )
                return json(503, {error: "delivery_unavailable"});
            // An external sender receives its own receipt only, never an internal
            // customer ID, matching organisation, contact details or management state.
            return json(202, {received: true, receipt: input.submission});
        } catch {
            return json(503, {error: "delivery_unavailable"});
        }
    };
}