/**
 * Bounded cursor-based reads of permitted administrative events. Interpret calendar dates in
 * their intended zone; the RPC enforces capability and the event allowlist.
 */
import { queryOptions } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { db } from "../../lib/supabase";
import { validZone } from "../../lib/dates";
import { requireOnline } from "../../lib/online";

/** Deliberately reduced event projection without arbitrary payloads or confidential document contents. */
export interface AuditEvent {
  id: string;
  actor_name: string;
  action: string;
  resource_id: string | null;
  created_at: string;
  resource_kind?: string;
  changed_fields?: string[];
  payment?: { amount: string; currency: string };
}

/** Stable timestamp/ID position when several events share the same instant. */
export interface AuditCursor {
  at: string;
  id: string;
}

/** Authorized audit page with continuation, applied date window and allowed actions. */
export interface AuditPage {
  items: AuditEvent[];
  has_more: boolean;
  next_cursor: AuditCursor | null;
  from: string;
  to: string;
  actions: string[];
}

/** Applied audit filter; zone preserves the meaning of local calendar days. */
export interface AuditFilter {
  from: string;
  to: string;
  action: string;
  search: string;
  zone: string;
}

/** Convert inclusive local calendar days into a half-open UTC window of at most 93 days. */
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

/** Read the admin_audit_events server projection, propagate RPC errors and scope cached data to the actor and requested resource. */
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
