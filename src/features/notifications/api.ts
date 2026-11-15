import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { db } from "../../lib/supabase";

const notificationItemSchema = z.object({
  id: z.string().uuid(),
  kind: z.string(),
  created_at: z.string().datetime({ offset: true }),
  read_at: z.string().datetime({ offset: true }).nullable(),
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
const inboxPageSchema = z.object({
  items: z.array(notificationItemSchema),
  unread_count: z.number().int().nonnegative(),
  as_of: z.string().datetime({ offset: true }),
});
export const notificationPreferencesSchema = z.object({
  chat: z.boolean(),
  forum: z.boolean(),
  job_updates: z.boolean(),
  reminders: z.boolean(),
  version: z.number().int().positive(),
});
export type NotificationItem = z.infer<typeof notificationItemSchema>;
export type InboxPage = z.infer<typeof inboxPageSchema>;
export type NotificationPreferences = z.infer<
  typeof notificationPreferencesSchema
>;
interface Cursor {
  at: string;
  id: string;
}
export function mergeNotificationPages(pages: InboxPage[] | undefined) {
  const rows = new Map<string, NotificationItem>();
  for (const item of (pages ?? []).flatMap((page) => page.items))
    if (!rows.has(item.id)) rows.set(item.id, item);
  return [...rows.values()];
}
export const notificationKeys = {
  all: (actor: string) => ["notifications", actor] as const,
  preferences: (actor: string) => ["notification-preferences", actor] as const,
};
export const notificationPreviewQuery = (actor: string) =>
  queryOptions({
    queryKey: [...notificationKeys.all(actor), "preview"],
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("notification_inbox", { p_limit: 8 })
        .abortSignal(signal);
      if (error) throw error;
      return inboxPageSchema.parse(data);
    },
    staleTime: 15000,
    refetchInterval: 30000,
  });
export const notificationInboxQuery = (actor: string, unreadOnly: boolean) =>
  infiniteQueryOptions({
    queryKey: [...notificationKeys.all(actor), "inbox", unreadOnly],
    initialPageParam: null as Cursor | null,
    queryFn: async ({ pageParam, signal }) => {
      const { data, error } = await db()
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
        ? { at: last.created_at, id: last.id }
        : undefined;
    },
    // History is fetched on demand, not polled page after page in the background.
    staleTime: 15000,
  });
export const notificationPreferencesQuery = (actor: string) =>
  queryOptions({
    queryKey: notificationKeys.preferences(actor),
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("notification_preferences")
        .abortSignal(signal);
      if (error) throw error;
      return notificationPreferencesSchema.parse(data);
    },
    staleTime: 15000,
  });
export async function markNotifications(
  ids: string[] | null,
  before: string | null,
  read: boolean,
) {
  const { data, error } = await db().rpc("mark_notifications", {
    p_ids: ids,
    p_all_before: before,
    p_read: read,
  });
  if (error) throw error;
  return z.number().int().nonnegative().parse(data);
}
export async function saveNotificationPreferences(
  values: NotificationPreferences,
) {
  const { version, ...preferences } = values;
  const { data, error } = await db().rpc("save_notification_preferences", {
    p_payload: preferences,
    p_expected_version: version,
  });
  if (error) throw error;
  return notificationPreferencesSchema.parse(data);
}
export async function refreshNotifications() {
  const { data, error } = await db().rpc("refresh_my_notifications");
  if (error) throw error;
  return z.number().int().nonnegative().parse(data);
}
