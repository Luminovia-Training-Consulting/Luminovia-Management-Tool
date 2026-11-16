import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { db } from "../../lib/supabase";
import { requireOnline } from "../../lib/online";
import { validZone, zonedInstant } from "../../lib/dates";

const outcome = z.enum(["completed", "partial", "cancelled", "interrupted"]);
const instant = z.string().datetime({ offset: true });
const draftSchema = z.object({
  outcome,
  actual_start: instant.nullable(),
  actual_end: instant.nullable(),
  time_zone: z.string(),
  notes: z.string(),
  correction_reason: z.string(),
});
const submissionSchema = z.object({
  id: z.string().uuid(),
  revision: z.number().int().positive(),
  outcome,
  actual_start: instant.nullable(),
  actual_end: instant.nullable(),
  time_zone: z.string(),
  created_at: instant,
  notes: z.string().nullable(),
  correction_reason: z.string().nullable(),
});
export const deliverySchema = z.object({
  session_id: z.string().uuid(),
  claim_id: z.string().uuid(),
  job_id: z.string().uuid(),
  course_run_id: z.string().uuid().nullable(),
  title: z.string(),
  lecturer_name: z.string(),
  scheduled_start: instant,
  scheduled_end: instant,
  time_zone: z.string(),
  status: z.enum([
    "missing",
    "draft",
    "submitted",
    "confirmed",
    "disputed",
    "correction_requested",
  ]),
  version: z.number().int().nonnegative(),
  draft: draftSchema.nullable(),
  submission: submissionSchema.nullable(),
  scheduled_minutes: z.number().nonnegative(),
  actual_minutes: z.number().nonnegative(),
  invoice_id: z.string().uuid().nullable(),
  can_edit: z.boolean(),
  can_review: z.boolean(),
  can_customer_confirm: z.boolean(),
  customer_confirmed: z.boolean(),
});
const pageSchema = z.object({
  items: z.array(deliverySchema),
  has_more: z.boolean(),
});
const historySchema = z.object({
  submissions: z.array(
    submissionSchema.extend({
      scheduled_start: instant,
      scheduled_end: instant,
    }),
  ),
  events: z.array(
    z.object({
      id: z.string().uuid(),
      submission_id: z.string().uuid().nullable(),
      action: z.enum([
        "submitted",
        "confirmed",
        "disputed",
        "correction_requested",
        "customer_confirmed",
      ]),
      created_at: instant,
      note: z.string().nullable(),
    }),
  ),
});
export type DeliverySession = z.infer<typeof deliverySchema>;
export type DeliveryDraft = z.infer<typeof draftSchema>;
export type DeliveryScope = "own" | "management" | "customer";
export const deliveryKeys = {
  all: (actor: string) => ["delivery", actor] as const,
};
interface Cursor {
  at: string;
  id: string;
}
export const deliverySessionsQuery = (actor: string, scope: DeliveryScope) =>
  infiniteQueryOptions({
    queryKey: [...deliveryKeys.all(actor), "sessions", scope],
    initialPageParam: null as Cursor | null,
    queryFn: async ({ pageParam, signal }) => {
      const { data, error } = await db()
        .rpc("delivery_sessions", {
          p_scope: scope,
          p_before_at: pageParam?.at ?? null,
          p_before_id: pageParam?.id ?? null,
          p_limit: 40,
        })
        .abortSignal(signal);
      if (error) throw error;
      return pageSchema.parse(data);
    },
    getNextPageParam: (page) => {
      const last = page.items.at(-1);
      return page.has_more && last
        ? { at: last.scheduled_start, id: last.session_id }
        : undefined;
    },
    staleTime: 10000,
  });
export const deliverySessionQuery = (actor: string, session: string) =>
  queryOptions({
    queryKey: [...deliveryKeys.all(actor), "session", session],
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("delivery_session", { p_session_id: session })
        .abortSignal(signal);
      if (error) throw error;
      return deliverySchema.parse(data);
    },
    enabled: z.string().uuid().safeParse(session).success,
    staleTime: 10000,
  });
export const deliveryHistoryQuery = (actor: string, session: string) =>
  queryOptions({
    queryKey: [...deliveryKeys.all(actor), "history", session],
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("delivery_history", { p_session_id: session })
        .abortSignal(signal);
      if (error) throw error;
      return historySchema.parse(data);
    },
    staleTime: 10000,
  });
export interface DeliveryForm {
  outcome: DeliveryDraft["outcome"];
  start: string;
  end: string;
  zone: string;
  notes: string;
  reason: string;
}
/** No browser-local/DST guess becomes an authoritative teaching instant. */
export function deliveryDraft(
  values: DeliveryForm,
  correction: boolean,
): DeliveryDraft {
  const actual_start =
    values.outcome === "cancelled"
      ? null
      : zonedInstant(values.start, values.zone);
  const actual_end =
    values.outcome === "cancelled"
      ? null
      : zonedInstant(values.end, values.zone);
  if (
    !validZone(values.zone) ||
    values.notes.trim().length > 4000 ||
    values.reason.trim().length > 1000 ||
    (values.outcome !== "completed" && values.notes.trim().length < 5) ||
    (correction && values.reason.trim().length < 5) ||
    (values.outcome !== "cancelled" &&
      (!actual_start ||
        !actual_end ||
        actual_end <= actual_start ||
        Date.parse(actual_end) - Date.parse(actual_start) > 86400000))
  )
    throw new Error("delivery_invalid");
  return draftSchema.parse({
    outcome: values.outcome,
    actual_start,
    actual_end,
    time_zone: values.zone,
    notes: values.notes.trim(),
    correction_reason: values.reason.trim(),
  });
}
export async function deliveryWrite(
  name:
    | "save_delivery_draft"
    | "submit_delivery"
    | "review_delivery"
    | "confirm_customer_delivery",
  payload: Record<string, unknown>,
) {
  requireOnline();
  const { data, error } = await db().rpc(name, payload);
  if (error) throw error;
  return deliverySchema.parse(data);
}
export function deliveryCsvRows(rows: DeliverySession[], headers: string[]) {
  return [
    headers,
    ...rows.map((row) => [
      row.title,
      row.lecturer_name,
      row.claim_id,
      row.session_id,
      row.scheduled_start,
      row.scheduled_end,
      row.submission?.actual_start ?? "",
      row.submission?.actual_end ?? "",
      row.time_zone,
      row.scheduled_minutes,
      row.actual_minutes,
      row.status,
      row.submission?.outcome ?? "",
      row.submission?.revision ?? "",
      row.customer_confirmed,
    ]),
  ];
}
