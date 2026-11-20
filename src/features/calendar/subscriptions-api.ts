// Actor-scoped subscription metadata excludes bearer tokens; mutations require
// online server confirmation and the exact last observed subscription version.
import {queryOptions} from "@tanstack/react-query";
import {z} from "zod";
import {db} from "../../lib/supabase";
import {requireOnline} from "../../lib/online";

const item = z.object({
    id: z.string().uuid(),
    label: z.string(),
    include_private: z.boolean(),
    expires_at: z.string().datetime({offset: true}),
    revoked_at: z.string().datetime({offset: true}).nullable(),
    version: z.number().int().positive(),
    created_at: z.string().datetime({offset: true}),
});
export type CalendarSubscription = z.infer<typeof item>;
export const subscriptionKey = (actor: string) => [
    "calendar-subscriptions",
    actor,
];
export const subscriptionsQuery = (actor: string) =>
    queryOptions({
        queryKey: subscriptionKey(actor),
        queryFn: async ({signal}) => {
            const {data, error} = await db()
                .rpc("my_calendar_subscriptions")
                .abortSignal(signal);
            if (error) throw error;
            return z.array(item).parse(data);
        },
        staleTime: 15000,
    });

/** Generate 256 random bits locally; the server persists only their hash. */
export function calendarSecretToken() {
    return [...crypto.getRandomValues(new Uint8Array(32))]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
}

export function calendarSubscriptionUrl(token: string) {
    if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("invalid_calendar_token");
    const base = import.meta.env.VITE_SUPABASE_URL;
    if (!base) throw new Error("calendar_unconfigured");
    const url = new URL(`${base.replace(/\/$/, "")}/functions/v1/calendar-feed`);
    url.searchParams.set("token", token);
    return url.href;
}

/** Retry with the same token/request key; abort prevents late secret revelation. */
export async function saveSubscription(
    id: string | null,
    label: string,
    includePrivate: boolean,
    token: string,
    version: number,
    request: string,
    signal: AbortSignal,
) {
    requireOnline();
    const {data, error} = await db()
        .rpc("save_calendar_subscription", {
            p_id: id,
            p_label: label,
            p_include_private: includePrivate,
            p_token: token,
            p_expected_version: version,
            p_client_id: request,
        })
        .abortSignal(signal);
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    if (error) throw error;
    return item.parse(data);
}

export async function revokeSubscription(id: string, version: number) {
    requireOnline();
    const {data, error} = await db().rpc("revoke_calendar_subscription", {
        p_id: id,
        p_expected_version: version,
    });
    if (error) throw error;
    return z.boolean().parse(data);
}