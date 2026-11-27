/** DTOs for protected offer pricing and the lecturer's own accepted amounts. */
import { z } from "zod";
import { DateTime } from "luxon";
import { db } from "../../lib/supabase";

export const componentKinds = [
  "on_site",
  "travel",
  "mileage",
  "accommodation",
  "preparation",
  "examination",
  "assessment",
  "materials",
  "administration",
  "paid_travel_time",
  "cancellation",
  "other",
] as const;
export const componentBases = [
  "course",
  "assignment",
  "session",
  "teaching_day",
  "teaching_hour",
  "teaching_unit",
  "physical_day",
  "physical_session",
  "kilometre",
  "night",
  "fixed_total",
  "agreed_quantity",
] as const;
export const commissionTreatments = [
  "commission",
  "pass_through",
  "custom",
  "fixed_platform",
] as const;

const currency = z.enum(["EUR", "AUD", "USD", "CHF"]);
const baseRateUnit = z.enum([
  "per_day",
  "per_hour",
  "per_teaching_unit",
  "fixed_total",
]);
const component = z.object({
  kind: z.enum(componentKinds),
  label: z.string().max(160),
  basis: z.enum(componentBases),
  treatment: z.enum(commissionTreatments),
  customer_rate: z.string(),
  agreed_rate: z.string().optional(),
  quantity: z.string().optional(),
  reason: z.string().max(500),
  session_rates: z.record(z.uuid(), z.string()).optional(),
});
export type TrainingComponent = z.infer<typeof component>;
const configuration = z.object({
  unit_minutes: z.number().int().min(1).max(1440),
  components: z.array(component).max(24),
});
const plan = z.object({
  configuration,
  unpaid_breaks: z.record(z.string(), z.number().int().nonnegative()),
});
export type TrainingPlan = z.infer<typeof plan>;

const projection = z.object({
  components: z.array(
    component.extend({
      units: z.number(),
      customer_amount: z.number(),
      lecturer_amount: z.number(),
      platform_amount: z.number(),
    }),
  ),
  currency,
  base_customer: z.number(),
  base_lecturer: z.number(),
  customer_total: z.number(),
  lecturer_total: z.number(),
  platform_total: z.number(),
  paid_teaching_minutes: z.number(),
  teaching_days: z.number(),
  physical_days: z.number(),
});
const response = z.object({
  job_id: z.uuid(),
  organisation_id: z.uuid(),
  currency,
  terms_version: z.number().int().positive(),
  editable: z.boolean(),
  base_rate: z.string(),
  rate_unit: baseRateUnit,
  plan: plan.nullable(),
  preview: projection.nullable(),
  accepted: z.array(z.object({ claim_id: z.uuid(), snapshot: projection })),
  sessions: z.array(
    z.object({
      id: z.uuid(),
      starts_at: z.string(),
      ends_at: z.string(),
      physical: z.boolean(),
    }),
  ),
});
export type CompensationProjection = z.infer<typeof projection>;
const preset = z.object({
  id: z.uuid(),
  name: z.string(),
  currency,
  revision: z.number().int().positive(),
  base_rate: z.string().nullable(),
  rate_unit: baseRateUnit.nullable(),
  configuration,
});
export type CommercialPreset = z.infer<typeof preset>;
const lecturerReceipt = z.object({
  currency,
  base_amount: z.number(),
  total_amount: z.number(),
  components: z.array(
    component.pick({ kind: true, label: true, basis: true }).extend({
      units: z.number(),
      amount: z.number(),
    }),
  ),
});

export function trainingOfferCompensationKey(actor: string, jobId: string) {
  return ["training-offer-compensation", actor, jobId] as const;
}
export function trainingCommercialPresetsKey(
  actor: string,
  organisationId: string,
) {
  return ["training-commercial-presets", actor, organisationId] as const;
}
export async function trainingOfferCompensation(
  jobId: string,
  action: "read" | "preview" | "save",
  expectedVersion: number | null = null,
  payload: TrainingPlan | null = null,
) {
  const { data, error } = await db().rpc("training_offer_compensation", {
    p_job_id: jobId,
    p_action: action,
    p_expected_version: expectedVersion,
    p_payload: payload,
  });
  if (error) throw error;
  return response.nullable().parse(data);
}

export async function trainingCommercialPresets(organisationId: string) {
  const { data, error } = await db().rpc("training_commercial_presets", {
    p_organisation_id: organisationId,
    p_action: "list",
  });
  if (error) throw error;
  return z.array(preset).parse(data);
}
export async function changeTrainingCommercialPreset(
  organisationId: string,
  action: "save" | "archive",
  original: CommercialPreset | undefined,
  draft: Pick<
    CommercialPreset,
    "name" | "currency" | "configuration" | "base_rate" | "rate_unit"
  > | null,
) {
  const { data, error } = await db().rpc("training_commercial_presets", {
    p_organisation_id: organisationId,
    p_action: action,
    p_preset_id: original?.id ?? null,
    p_expected_revision: original?.revision ?? 0,
    p_payload: draft,
  });
  if (error) throw error;
  return preset.parse(data);
}
export async function trainingAssignmentCompensation(claimId: string) {
  const { data, error } = await db().rpc(
    "training_assignment_compensation",
    {
      p_claim_id: claimId,
    },
    { get: true },
  );
  if (error) throw error;
  return lecturerReceipt.nullable().parse(data);
}

/** Price the initial form value with integer cents from the reviewed schedule. */
export function presetBaseTotal(
  preset: CommercialPreset,
  sessions: readonly { starts_at: string; ends_at: string }[],
  zone: string,
) {
  if (!preset.base_rate || !preset.rate_unit) return null;
  const [whole, fractional = ""] = preset.base_rate.split(".");
  const cents = BigInt(whole) * 100n + BigInt(fractional.padEnd(2, "0"));
  if (preset.rate_unit === "fixed_total") return Number(cents) / 100;
  if (preset.rate_unit === "per_day") {
    const localDays = new Set<string>();
    for (const { starts_at, ends_at } of sessions) {
      const first = DateTime.fromISO(starts_at, { zone }).startOf("day");
      const last = DateTime.fromISO(ends_at, { zone })
        .minus({ milliseconds: 1 })
        .startOf("day");
      if (
        !first.isValid ||
        !last.isValid ||
        last.diff(first, "days").days > 366
      )
        return null;
      for (let day = first; day <= last; day = day.plus({ days: 1 })) {
        localDays.add(day.toISODate()!);
      }
    }
    return Number(cents * BigInt(localDays.size)) / 100;
  }
  const milliseconds = sessions.reduce(
    (total, session) =>
      total + Date.parse(session.ends_at) - Date.parse(session.starts_at),
    0,
  );
  if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0) return null;
  const millisecondsPerUnit = BigInt(
    (preset.rate_unit === "per_hour" ? 60 : preset.configuration.unit_minutes) *
      60_000,
  );
  return (
    Number(
      (cents * BigInt(milliseconds) + millisecondsPerUnit / 2n) /
        millisecondsPerUnit,
    ) / 100
  );
}
