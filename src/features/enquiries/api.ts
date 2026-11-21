/** Actor-scoped enquiry projections and online CAS writes; raw intake is server-only. */
import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { db } from "../../lib/supabase";
import { requireOnline } from "../../lib/online";
import { zonedInstant } from "../../lib/dates";

import {
  enquiryContextSchema,
  enquiryDetailSchema,
  enquiryPageSchema,
  type Cursor,
  type Enquiry,
  type EnquiryAction,
} from "./schema";
export {
  enquiryStatuses,
  type Enquiry,
  type EnquiryAction,
  type EnquiryContext,
} from "./schema";

/** Directory choices are returned only under the caller's live management authority. */
export const enquiryContextQuery = (actor: string) =>
  queryOptions({
    queryKey: ["enquiry-context", actor],
    queryFn: async ({ signal }) => {
      requireOnline();
      const { data, error } = await db()
        .rpc("enquiry_context")
        .abortSignal(signal);
      if (error) throw error;
      return enquiryContextSchema.parse(data);
    },
    retry: false,
    staleTime: 0,
  });
/** Search is explicit and bounded; a tuple cursor never broadens the server permission. */
export const enquiryInboxQuery = (
  actor: string,
  search: string,
  status: string,
  cursor: Cursor,
) =>
  queryOptions({
    queryKey: ["enquiry-inbox", actor, search, status, cursor],
    queryFn: async ({ signal }) => {
      requireOnline();
      const { data, error } = await db()
        .rpc("enquiry_inbox", {
          p_search: search,
          p_status: status,
          p_before_at: cursor?.at ?? null,
          p_before_id: cursor?.id ?? null,
          p_limit: 40,
        })
        .abortSignal(signal);
      if (error) throw error;
      return enquiryPageSchema.parse(data);
    },
    retry: false,
    staleTime: 0,
  });
/** Refetch on focus/interval rechecks private contact access without a persisted cache. */
export const enquiryDetailQuery = (actor: string, id: string) =>
  queryOptions({
    queryKey: ["enquiry-detail", actor, id],
    queryFn: async ({ signal }) => {
      requireOnline();
      const { data, error } = await db()
        .rpc("enquiry_detail", { p_enquiry_id: id })
        .abortSignal(signal);
      if (error) throw error;
      return enquiryDetailSchema.parse(data);
    },
    retry: false,
    staleTime: 0,
    refetchInterval: 30000,
  });

/** The caller supplies the reviewed version and stable retry key; no optimistic mutation. */
export async function manageEnquiry(
  id: string,
  action: EnquiryAction,
  payload: Record<string, unknown>,
  version: number,
  request: string,
) {
  requireOnline();
  const { data, error } = await db().rpc("manage_enquiry", {
    p_enquiry_id: id,
    p_action: action,
    p_payload: payload,
    p_expected_version: version,
    p_request_id: request,
  });
  if (error) throw error;
  return z.uuid().parse(data);
}

/** Map server categories to DE/EN copy without showing private error details. */
export function enquiryError(error: unknown) {
  const code =
    error && typeof error === "object" && "code" in error ? error.code : "";
  return code === "PT409" || code === "40001"
    ? "conflict"
    : code === "42501"
      ? "denied"
      : "error";
}

/** Offer meaningful next choices; PostgreSQL independently enforces the lifecycle. */
export function nextEnquiryStatuses(status: Enquiry["status"]) {
  return status === "received"
    ? (["reviewing", "closed"] as const)
    : status === "reviewing"
      ? (["awaiting_customer", "closed"] as const)
      : status === "awaiting_customer" || status === "closed"
        ? ([
            "reviewing",
            ...(status === "awaiting_customer" ? (["closed"] as const) : []),
          ] as const)
        : [];
}

/** Convert reviewed wall times to canonical instants, rejecting overlaps and DST uncertainty. */
export function enquirySessions(
  rows: { starts_at: string; ends_at: string }[],
  zone: string,
) {
  if (rows.length < 1 || rows.length > 60) return null;
  const sessions: { starts_at: string; ends_at: string }[] = [];
  for (const row of rows) {
    const start = zonedInstant(row.starts_at, zone),
      end = zonedInstant(row.ends_at, zone);
    if (
      !start ||
      !end ||
      start >= end ||
      sessions.some((item) => start < item.ends_at && end > item.starts_at)
    )
      return null;
    sessions.push({ starts_at: start, ends_at: end });
  }
  return sessions;
}
