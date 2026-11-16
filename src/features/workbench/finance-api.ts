import { queryOptions } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { z } from "zod";
import { db } from "../../lib/supabase";
import { requireOnline } from "../../lib/online";
import { validZone } from "../../lib/dates";

const uuid = z.string().uuid(),
  instant = z.string().datetime({ offset: true }),
  zone = z.string().refine(validZone);
export const financePeriodSchema = z
  .object({ from: z.string(), until: z.string() })
  .refine((value) => {
    const from = DateTime.fromISO(value.from, { zone: "UTC" }),
      until = DateTime.fromISO(value.until, { zone: "UTC" });
    return (
      /^\d{4}-\d{2}-\d{2}$/.test(value.from) &&
      /^\d{4}-\d{2}-\d{2}$/.test(value.until) &&
      from.isValid &&
      until.isValid &&
      until > from &&
      until.diff(from, "days").days <= 93
    );
  });
export type FinancePeriod = z.infer<typeof financePeriodSchema>;
export function initialFinancePeriod(): FinancePeriod {
  return {
    from: DateTime.now().minus({ days: 30 }).toISODate()!,
    until: DateTime.now().plus({ days: 1 }).toISODate()!,
  };
}
export const timesheetSchema = z.object({
  id: uuid,
  session_id: uuid,
  lecturer_id: uuid,
  claim_id: uuid,
  job_id: uuid,
  title: z.string(),
  lecturer_name: z.string(),
  time_zone: zone,
  starts_at: instant,
  ends_at: instant,
  break_minutes: z.number().int().nonnegative(),
  minutes: z.number().int().positive(),
  note: z.string(),
  state: z.enum(["draft", "submitted", "approved", "rejected"]),
  version: z.number().int().positive(),
  reviewed_by: uuid.nullable(),
  reviewed_at: instant.nullable(),
  review_note: z.string(),
  created_at: instant,
  updated_at: instant,
});
export type Timesheet = z.infer<typeof timesheetSchema>;
export const timesheetsSchema = z.object({
  time_zone: zone,
  can_review: z.boolean(),
  items: z.array(timesheetSchema).max(500),
  sessions: z
    .array(
      z.object({
        id: uuid,
        claim_id: uuid,
        job_id: uuid,
        title: z.string(),
        starts_at: instant,
        ends_at: instant,
        time_zone: zone,
        editable: z.boolean(),
      }),
    )
    .max(500),
});
export type Timesheets = z.infer<typeof timesheetsSchema>;
export async function fetchTimesheets(
  period: FinancePeriod,
  all: boolean,
  signal?: AbortSignal,
) {
  financePeriodSchema.parse(period);
  const query = db().rpc("timesheets", {
    p_from: period.from,
    p_until: period.until,
    p_all: all,
  });
  const { data, error } = await (signal ? query.abortSignal(signal) : query);
  if (error) throw error;
  return timesheetsSchema.parse(data);
}
export const timesheetsKey = (actor: string) => ["timesheets", actor] as const;
export const timesheetsQuery = (
  actor: string,
  period: FinancePeriod,
  all: boolean,
) =>
  queryOptions({
    queryKey: [...timesheetsKey(actor), period, all],
    queryFn: ({ signal }) => fetchTimesheets(period, all, signal),
    staleTime: 15000,
    retry: false,
  });
export interface TimesheetDraft {
  session_id: string;
  starts_at: string;
  ends_at: string;
  break_minutes: number;
  note: string;
}
export async function saveTimesheet(
  id: string,
  payload: TimesheetDraft,
  version: number,
) {
  requireOnline();
  const { data, error } = await db().rpc("save_timesheet", {
    p_id: id,
    p_payload: payload,
    p_expected_version: version,
  });
  if (error) throw error;
  return timesheetSchema.parse(data);
}
export type TimesheetAction =
  "submit" | "approve" | "reject" | "request_correction";
export async function manageTimesheet(
  item: Timesheet,
  action: TimesheetAction,
  request: string,
  reason: string,
) {
  requireOnline();
  const { data, error } = await db().rpc("manage_timesheet", {
    p_id: item.id,
    p_action: action,
    p_expected_version: item.version,
    p_request_id: request,
    p_reason: reason,
  });
  if (error) throw error;
  return timesheetSchema.parse(data);
}
export const timesheetHistoryQuery = (actor: string, id: string) =>
  queryOptions({
    queryKey: ["timesheet-history", actor, id],
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("timesheet_history", { p_id: id })
        .abortSignal(signal);
      if (error) throw error;
      return z
        .array(
          z.object({
            id: uuid,
            timesheet_id: uuid,
            actor_id: uuid,
            action: z.string(),
            before_state: z.record(z.string(), z.unknown()).nullable(),
            after_state: z.record(z.string(), z.unknown()),
            created_at: instant,
          }),
        )
        .parse(data);
    },
    staleTime: 0,
    retry: false,
  });
const forecastSchema = z.object({
  from: z.string(),
  until: z.string(),
  time_zone: zone,
  pipeline_probability: z.number().min(0).max(1),
  gross_authorized: z.boolean(),
  payment_basis: z.literal("lecturer_invoice_payment_records"),
  months: z.array(
    z.object({
      month: z.string(),
      currency: z.enum(["EUR", "AUD"]),
      accepted_lecturer_cost: z.number(),
      accepted_gross_known: z.number().nullable(),
      accepted_margin_known: z.number().nullable(),
      unknown_gross_claims: z.number().int().nullable(),
      pipeline_lecturer_cost_known: z.number(),
      pipeline_gross_known: z.number().nullable(),
      lecturer_invoice_payments: z.number(),
    }),
  ),
});
export const forecastQuery = (
  actor: string,
  period: FinancePeriod,
  probability: number,
  enabled: boolean,
) =>
  queryOptions({
    queryKey: ["finance-forecast", actor, period, probability],
    enabled,
    queryFn: async ({ signal }) => {
      financePeriodSchema.parse(period);
      const { data, error } = await db()
        .rpc("finance_forecast", {
          p_from: period.from,
          p_until: period.until,
          p_pipeline_probability: probability,
        })
        .abortSignal(signal);
      if (error) throw error;
      return forecastSchema.parse(data);
    },
    staleTime: 15000,
    retry: false,
  });
const controlSchema = z.object({
  from: z.string(),
  until: z.string(),
  time_zone: zone,
  unstaffed: z.array(
    z.object({
      id: uuid,
      title: z.string(),
      customer_name: z.string(),
      starts_at: instant,
      open_positions: z.number().int(),
    }),
  ),
  missing_documents: z.array(z.object({ id: uuid, title: z.string() })),
  cancellations: z.array(
    z.object({
      id: uuid,
      job_id: uuid,
      title: z.string(),
      lecturer_id: uuid,
      event_type: z.string(),
      created_at: instant,
    }),
  ),
  overdue_tasks: z.array(
    z.object({
      id: uuid,
      title: z.string(),
      due_at: instant,
      state: z.string(),
      assignee_id: uuid,
    }),
  ),
  requests: z.array(
    z.object({
      id: uuid,
      organisation_id: uuid,
      organisation_name: z.string(),
      title: z.string(),
      status: z.string(),
      job_id: uuid.nullable(),
      created_at: instant,
    }),
  ),
  contracts_expiring: z.array(
    z.object({ id: uuid, user_id: uuid, expires_at: instant }),
  ),
  qualifications_expiring: z.array(
    z.object({
      user_id: uuid,
      topic_id: uuid,
      label_de: z.string(),
      label_en: z.string(),
      valid_until: instant,
    }),
  ),
  preparation: z.array(
    z.object({
      run_id: uuid,
      total: z.number().int(),
      complete: z.number().int(),
      customer_visible: z.number().int(),
    }),
  ),
  quality: z.array(
    z.object({
      run_id: uuid,
      responses: z.number().int(),
      average_rating: z.number().nullable(),
    }),
  ),
});
export type ControlCenter = z.infer<typeof controlSchema>;
export const controlCenterQuery = (
  actor: string,
  period: FinancePeriod,
  enabled: boolean,
) =>
  queryOptions({
    queryKey: ["control-center", actor, period],
    enabled,
    queryFn: async ({ signal }) => {
      financePeriodSchema.parse(period);
      const { data, error } = await db()
        .rpc("control_center", { p_from: period.from, p_until: period.until })
        .abortSignal(signal);
      if (error) throw error;
      return controlSchema.parse(data);
    },
    staleTime: 15000,
    retry: false,
  });
