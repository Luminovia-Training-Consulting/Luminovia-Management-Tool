/**
 * Zeitlich begrenzte, cursorbasierte Lese-API für freigegebene Administrationsereignisse. Datumseingaben werden in der beabsichtigten Zone zu UTC-Grenzen; die RPC entscheidet über MFA, Capability und erlaubte Ereignisse.
 */
import { queryOptions } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { db } from "../../lib/supabase";
import { validZone } from "../../lib/dates";
import { requireOnline } from "../../lib/online";

/** Bewusst reduzierte Ereignisprojektion ohne freie Payloads oder vertrauliche Dokumentinhalte. */
export interface AuditEvent {
  id: string;
  actor_name: string;
  action: string;
  resource_id: string | null;
  created_at: string;
}
/** Stabile Position über Zeitstempel und ID, auch wenn mehrere Ereignisse denselben Zeitpunkt teilen. */
export interface AuditCursor {
  at: string;
  id: string;
}
/** Eine autorisierte Auditseite samt Fortsetzung, angewendetem Zeitfenster und erlaubten Aktionen. */
export interface AuditPage {
  items: AuditEvent[];
  has_more: boolean;
  next_cursor: AuditCursor | null;
  from: string;
  to: string;
  actions: string[];
}
/** Aktiv übernommener Auditfilter; zone bewahrt die Bedeutung lokaler Kalendertage. */
export interface AuditFilter {
  from: string;
  to: string;
  action: string;
  search: string;
  zone: string;
}
/** Wandelt inklusive lokale Kalendertage in ein halboffenes UTC-Fenster mit maximal 93 Tagen um. */
export function auditRange(from: string, to: string, zone: string) {
  if (
    !validZone(zone) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(from) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(to)
  )
    return null;
  const start = DateTime.fromISO(from, { zone }).startOf("day"),
    last = DateTime.fromISO(to, { zone }).startOf("day"),
    end = last.plus({ days: 1 }).startOf("day");
  if (
    !start.isValid ||
    !last.isValid ||
    start.toISODate() !== from ||
    last.toISODate() !== to ||
    end <= start ||
    end.diff(start, "days").days > 93
  )
    return null;
  return { from: start.toUTC().toISO()!, to: end.toUTC().toISO()! };
}
/** Lädt die Serverprojektion über admin_audit_events und propagiert deren Fehler an den Queryzustand. Der Cache ist an den jeweiligen Akteur beziehungsweise die abgefragte Person gebunden. */
export const auditEventsQuery = (
  actor: string,
  filter: AuditFilter,
  cursor: AuditCursor | null,
) =>
  queryOptions({
    queryKey: ["admin-audit", actor, filter, cursor],
    queryFn: async ({ signal }) => {
      requireOnline();
      const { data, error } = await db()
        .rpc("admin_audit_events", {
          p_from: filter.from,
          p_to: filter.to,
          p_action: filter.action,
          p_search: filter.search,
          p_before_at: cursor?.at ?? null,
          p_before_id: cursor?.id ?? null,
          p_limit: 40,
        })
        .abortSignal(signal);
      if (error) throw error;
      return data as AuditPage;
    },
    // No persisted cache or background history crawl. Access is rechecked by
    // PostgreSQL on every page, refresh and browser-focus refetch.
    staleTime: 0,
    retry: false,
  });
