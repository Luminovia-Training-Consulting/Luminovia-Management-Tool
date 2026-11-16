/**
 * Validierte Inbox-DTOs, stabile Cursor und versionierte persönliche Präferenzen. Ziele müssen sichere interne Pfade sein; Lesestände und Erinnerungsauffrischung werden ausschließlich per bestätigter RPC verändert.
 */
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { db } from "../../lib/supabase";

/** Laufzeitvalidierung der Meldungsdaten samt strikt internem, nicht ausführbarem Navigationsziel. */
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
/** Prüft Meldungsliste, nicht negative Ungelesenzahl und echten Zeitstand vor der Anzeige. */
const inboxPageSchema = z.object({
  items: z.array(notificationItemSchema),
  unread_count: z.number().int().nonnegative(),
  as_of: z.string().datetime({ offset: true }),
});
/** Gemeinsamer Validierungsvertrag für optionale Kategorien und positive Versionsnummer. */
export const notificationPreferencesSchema = z.object({
  chat: z.boolean(),
  forum: z.boolean(),
  job_updates: z.boolean(),
  reminders: z.boolean(),
  version: z.number().int().positive(),
});
/** Aus tatsächlich validierten Inboxdaten abgeleiteter Meldungstyp. */
export type NotificationItem = z.infer<typeof notificationItemSchema>;
/** Validierte Inboxseite mit serverermittelter Ungelesenzahl und Lesestandzeitpunkt. */
export type InboxPage = z.infer<typeof inboxPageSchema>;
/** Versionierte persönliche Kategorien direkt aus dem validierten Schema. */
export type NotificationPreferences = z.infer<
  typeof notificationPreferencesSchema
>;
/** Stabile Zeit/ID-Fortsetzung einer Inboxseite. */
interface Cursor {
  at: string;
  id: string;
}
/** Entfernt sich überschneidende Inboxzeilen nach ID und erhält die Reihenfolge der neueren geladenen Seiten. */
export function mergeNotificationPages(pages: InboxPage[] | undefined) {
  // Neuere Seiten stehen zuerst. Bei einem parallelen Read-/Refetch gewinnt
  // deren erstes Exemplar, statt einen älteren Lesestand darüberzuschreiben.
  const rows = new Map<string, NotificationItem>();
  for (const item of (pages ?? []).flatMap((page) => page.items))
    if (!rows.has(item.id)) rows.set(item.id, item);
  return [...rows.values()];
}
/** Gemeinsame Akteursschlüssel verbinden Vorschau/Inbox mit gezielter Lesestatusrevalidierung. */
export const notificationKeys = {
  all: (actor: string) => ["notifications", actor] as const,
  preferences: (actor: string) => ["notification-preferences", actor] as const,
};
/** Lädt die Serverprojektion über notification_inbox und propagiert deren Fehler an den Queryzustand. Der Cache ist an den jeweiligen Akteur beziehungsweise die abgefragte Person gebunden. */
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
/** Lädt die Serverprojektion über notification_inbox und propagiert deren Fehler an den Queryzustand. Der Cache ist an den jeweiligen Akteur beziehungsweise die abgefragte Person gebunden. */
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
/** Lädt die Serverprojektion über notification_preferences und propagiert deren Fehler an den Queryzustand. Der Cache ist an den jeweiligen Akteur beziehungsweise die abgefragte Person gebunden. */
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
/** Ändert gezielte IDs oder den bestätigten Zeitstand und validiert die vom Server gemeldete Anzahl. */
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
/** Speichert persönliche Kategorien gegen die erwartete Version und validiert die neue Serverfassung. */
export async function saveNotificationPreferences(
  values: NotificationPreferences,
) {
  // Version ist ein Vergleichswert und keine frei überschreibbare Präferenz.
  // Der Server muss eine zwischenzeitlich geänderte Fassung zurückweisen können.
  const { version, ...preferences } = values;
  const { data, error } = await db().rpc("save_notification_preferences", {
    p_payload: preferences,
    p_expected_version: version,
  });
  if (error) throw error;
  return notificationPreferencesSchema.parse(data);
}
/** Fordert die explizite eigene Erinnerungsauffrischung an; dieser Aufruf ist kein Hintergrundscheduler. */
export async function refreshNotifications() {
  const { data, error } = await db().rpc("refresh_my_notifications");
  if (error) throw error;
  return z.number().int().nonnegative().parse(data);
}
