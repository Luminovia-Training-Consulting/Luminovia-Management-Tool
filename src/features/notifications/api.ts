/**
 * Validated inbox DTOs, stable cursors and versioned personal preferences. Destinations must be
 * safe internal paths; only confirmed RPCs change read state or refresh reminders.
 */
import { mergeCursorItems } from "../../lib/cursor-rows";
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { throwPagedReadError } from "../../lib/paged-read";
import { db } from "../../lib/supabase";

import {
  inboxPageSchema,
  notificationPreferencesSchema,
  type InboxPage,
  type NotificationPreferences,
} from "./schema";
export {
  notificationPreferencesSchema,
  type InboxPage,
  type NotificationItem,
  type NotificationPreferences,
} from "./schema";

/** Stable timestamp/ID continuation for an inbox page. */
interface Cursor {
  at: string;
  id: string;
}

/** Deduplicate inbox rows by ID while retaining the order from newer loaded pages. */
export function mergeNotificationPages(pages: InboxPage[] | undefined) {
  // Newer pages come first. For overlapping IDs, keep their first occurrence
  // instead of overwriting it with an older read state.
  return mergeCursorItems(pages);
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
/** Read the notification_inbox server projection, propagate RPC errors and scope cached data to the actor and requested resource. */
export const notificationInboxQuery = (actor: string, unreadOnly: boolean) =>
  infiniteQueryOptions({
    queryKey: [...notificationKeys.all(actor), "inbox", unreadOnly],
    initialPageParam: null as Cursor | null,
    queryFn: async ({ pageParam, signal }) => {
      const { data, error, status } = await db()
        .rpc("notification_inbox", {
          p_unread_only: unreadOnly,
          p_before_at: pageParam?.at ?? null,
          p_before_id: pageParam?.id ?? null,
          p_limit: 40,
        })
        .abortSignal(signal);
      if (error) throwPagedReadError(error, status);
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
/** Read the notification_preferences server projection, propagate RPC errors and scope cached data to the actor and requested resource. */
export const notificationPreferencesQuery = (actor: string) =>
  queryOptions({
    queryKey: notificationKeys.preferences(actor),
    queryFn: async ({ signal }) => {
      const { data, error, status } = await db()
        .rpc("notification_preferences")
        .abortSignal(signal);
      if (error) throwPagedReadError(error, status);
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
  const { data, error } = await db().rpc("mark_notifications", {
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
  const { version, ...preferences } = values;
  const { data, error } = await db().rpc("save_notification_preferences", {
    p_payload: preferences,
    p_expected_version: version,
  });
  if (error) throw error;
  return notificationPreferencesSchema.parse(data);
}

/** Request an explicit refresh of the actor's reminders; this call is not a background scheduler. */
export async function refreshNotifications() {
  const { data, error } = await db().rpc("refresh_my_notifications");
  if (error) throw error;
  return z.number().int().nonnegative().parse(data);
}
