/** Responses shared by the operations screens and the native OpenAPI catalogue. */
import { currencyCodes } from "../../lib/currencies.ts";
import { z } from "zod";
import { validZone } from "../../lib/dates.ts";

const uuid = z.string().uuid(),
  instant = z.string().datetime({ offset: true }),
  zone = z.string().refine(validZone);
/** Amounts and their visibility flags are reported for each currency and month. */
export const forecastSchema = z.object({
  from: z.iso.date(),
  until: z.iso.date(),
  time_zone: zone,
  pipeline_probability: z.number().min(0).max(1),
  gross_authorized: z.boolean(),
  payment_basis: z.literal("lecturer_invoice_payment_records"),
  months: z.array(
    z.object({
      month: z.iso.date(),
      currency: z.enum(currencyCodes),
      accepted_lecturer_cost: z.number(),
      accepted_gross_known: z.number().nullable(),
      accepted_margin_known: z.number().nullable(),
      unknown_gross_claims: z.number().int().nullable(),
      pipeline_lecturer_cost_known: z.number().nullable(),
      pipeline_cost_unknown_positions: z
        .number()
        .int()
        .nonnegative()
        .default(0),
      pipeline_gross_known: z.number().nullable(),
      lecturer_invoice_payments: z.number(),
    }),
  ),
});
/** Review queues retain the server's permission-filtered rows. */
export const controlSchema = z.object({
  from: z.iso.date(),
  until: z.iso.date(),
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
