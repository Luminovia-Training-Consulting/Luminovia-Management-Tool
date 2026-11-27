/** Price component contracts shared by native finance clients and the API reference. */
import { z } from "zod";

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
export const trainingPlanSchema = z.object({
  configuration,
  unpaid_breaks: z.record(z.string(), z.number().int().nonnegative()),
});
export type TrainingPlan = z.infer<typeof trainingPlanSchema>;

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
export const trainingOfferCompensationSchema = z.object({
  job_id: z.uuid(),
  organisation_id: z.uuid(),
  currency,
  terms_version: z.number().int().positive(),
  editable: z.boolean(),
  base_rate: z.string(),
  rate_unit: baseRateUnit,
  plan: trainingPlanSchema.nullable(),
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
export const trainingCommercialPresetSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  currency,
  revision: z.number().int().positive(),
  base_rate: z.string().nullable(),
  rate_unit: baseRateUnit.nullable(),
  configuration,
});
export type CommercialPreset = z.infer<typeof trainingCommercialPresetSchema>;
export const trainingAssignmentCompensationSchema = z.object({
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
