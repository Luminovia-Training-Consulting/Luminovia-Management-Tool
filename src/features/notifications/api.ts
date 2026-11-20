/**
 * Validated inbox DTOs, stable cursors and versioned personal preferences. Destinations must be
 * safe internal paths; only confirmed RPCs change read state or refresh reminders.
 */
import {infiniteQueryOptions, queryOptions} from "@tanstack/react-query";
import {z} from "zod";
import {db} from "../../lib/supabase";

/** Validate notification data and require a strictly internal, non-executable navigation destination. */
const notificationItemSchema = z.object({
    id: z.string().uuid(),
    kind: z.string(),
    created_at: z.string().datetime({offset: true}),
    read_at: z.string().datetime({offset: true}).nullable(),
    // Server-resolved internal destinations only; malformed API data must never
    // turn a notification into an external or executable link.
    href: z
        .string()
        .refine(
            (path) =>
                path.startsWith("/") &&
                !path.startsWith("//") &&
                !path.includes("\\") &&
                [...path].every(
                    (char) => char.charCodeAt(0) > 32 && char.charCodeAt(0) !== 127,
                ),
        )
        .nullable(),
    title: z.string(),
});
/**
 * Accept legacy inbox pages and validate quiet-hour attention when present.
 * Active quiet summaries require a count bounded by the complete unread total;
 * inactive/legacy pages omit that count. The server decides current visibility.
 */
const inboxPageSchema = z
    .object({
        items: z.array(notificationItemSchema),
        unread_count: z.number().int().nonnegative(),
        quiet_active: z.boolean().optional(),
        attention_count: z.number().int().nonnegative().optional(),
        as_of: z.string().datetime({offset: true}),
    })
    .refine((page) =>
        page.quiet_active === true
            ? page.attention_count !== undefined &&
            page.attention_count <= page.unread_count
            : page.attention_count === undefined,
    );
/** Four category flags retain their independent positive CAS version; quiet-hour settings use a separate API. */
export const notificationPreferencesSchema = z.object({
    chat: z.boolean(),
    forum: z.boolean(),
    job_updates: z.boolean(),
    reminders: z.boolean(),
    version: z.number().int().positive(),
});
/** Notification type derived from runtime-validated inbox data. */
export type NotificationItem = z.infer<typeof notificationItemSchema>;
/** Validated inbox page with server-provided unread count and read-state timestamp. */
export type InboxPage = z.infer<typeof inboxPageSchema>;
/** Versioned personal categories derived directly from the validated schema. */
export type NotificationPreferences = z.infer<
    typeof notificationPreferencesSchema
>;

/** Stable timestamp/ID continuation for an inbox page. */
interface Cursor {
    at: string;
    id: string;
}

/** Deduplicate inbox rows by ID while retaining the order from newer loaded pages. */
export function mergeNotificationPages(pages: InboxPage[] | undefined) {
    // Newer pages come first. For overlapping IDs, keep their first occurrence
    // instead of overwriting it with an older read state.
    const rows = new Map<string, NotificationItem>();
    for (const item of (pages ?? []).flatMap((page) => page.items))
        if (!rows.has(item.id)) rows.set(item.id, item);
    return [...rows.values()];
}

/** Shared actor keys connect preview/inbox views with targeted read-state revalidation. */
export const notificationKeys = {
    all: (actor: string) => ["notifications", actor] as const,
    preferences: (actor: string) => ["notification-preferences", actor] as const,
};
/** Read the notification_inbox server projection, propagate RPC errors and scope cached data to the actor and requested resource. */
export const notificationPreviewQuery = (actor: string) =>
    queryOptions({
        queryKey: [...notificationKeys.all(actor), "preview"],
        queryFn: async ({signal}) => {
            const {data, error} = await db()
                .rpc("notification_inbox", {p_limit: 8})
                .abortSignal(signal);
            if (error) throw error;
            return inboxPageSchema.parse(data);
        },
        staleTime: 15000,
        refetchInterval: 30000,
    });
/** Read the notification_inbox server projection, propagate RPC errors and scope cached data to the actor and requested resource. */
export const notificationInboxQuery = (actor: string, unreadOnly: boolean) =>
    infiniteQueryOptions({
        queryKey: [...notificationKeys.all(actor), "inbox", unreadOnly],
        initialPageParam: null as Cursor | null,
        queryFn: async ({pageParam, signal}) => {
            const {data, error} = await db()
                .rpc("notification_inbox", {
                    p_unread_only: unreadOnly,
                    p_before_at: pageParam?.at ?? null,
                    p_before_id: pageParam?.id ?? null,
                    p_limit: 40,
                })
                .abortSignal(signal);
            if (error) throw error;
            return inboxPageSchema.parse(data);
        },
        getNextPageParam: (page): Cursor | undefined => {
            const last = page.items.at(-1);
            return last && page.items.length === 40
                ? {at: last.created_at, id: last.id}
                : undefined;
        },
        // History is fetched on demand, not polled page after page in the background.
        staleTime: 15000,
    });
/** Read the notification_preferences server projection, propagate RPC errors and scope cached data to the actor and requested resource. */
export const notificationPreferencesQuery = (actor: string) =>
    queryOptions({
        queryKey: notificationKeys.preferences(actor),
        queryFn: async ({signal}) => {
            const {data, error} = await db()
                .rpc("notification_preferences")
                .abortSignal(signal);
            if (error) throw error;
            return notificationPreferencesSchema.parse(data);
        },
        staleTime: 15000,
    });

/** Change selected IDs or the confirmed timestamp and validate the server's affected-row count. */
export async function markNotifications(
    ids: string[] | null,
    before: string | null,
    read: boolean,
) {
    const {data, error} = await db().rpc("mark_notifications", {
        p_ids: ids,
        p_all_before: before,
        p_read: read,
    });
    if (error) throw error;
    return z.number().int().nonnegative().parse(data);
}

/** Save personal categories against the expected version and validate the returned server version. */
export async function saveNotificationPreferences(
    values: NotificationPreferences,
) {
    // Version is a comparison token, not an arbitrarily writable preference field.
    // The server must reject a version changed by another operation in the meantime.
    const {version, ...preferences} = values;
    const {data, error} = await db().rpc("save_notification_preferences", {
        p_payload: preferences,
        p_expected_version: version,
    });
    if (error) throw error;
    return notificationPreferencesSchema.parse(data);
}

/** Request an explicit refresh of the actor's reminders; this call is not a background scheduler. */
export async function refreshNotifications() {
    const {data, error} = await db().rpc("refresh_my_notifications");
    if (error) throw error;
    return z.number().int().nonnegative().parse(data);
}