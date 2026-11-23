/** Exact PostgREST projections for internal commercial capabilities and company decisions. */
import { currencyCodes } from "../../lib/currencies.ts";
import { z } from "zod";

const id = z.uuid();
const instant = z.iso.datetime({ offset: true });
const retainedInstant = z.union([instant, z.enum(["infinity", "-infinity"])]);
const currency = z.enum(currencyCodes);
const count = z.number().int().nonnegative();
const percent = z.number().min(0).max(100).multipleOf(0.01);
const dailyRate = z.number().min(0).max(999_999_999_999.99).multipleOf(0.01);
const compensationMode = z.enum(["percent", "daily"]);

export const clientSpendSummarySchema = z.array(
  z.strictObject({
    organisation_id: id,
    organisation_name: z.string(),
    currency,
    request_count: count,
    published_count: count,
    assigned_count: count,
    gross_total_amount: z.number().positive(),
    gross_assigned_amount: z.number().nonnegative(),
    teachers: z.array(z.strictObject({ id, display_name: z.string() })),
  }),
);

export const commercialAccessSchema = z.strictObject({
  can_manage_contracts: z.boolean(),
  can_manage_finance: z.boolean(),
  can_submit_invoice: z.boolean(),
});

const commissionCapabilities = {
  can_manage_client_memberships: z.boolean(),
  can_request: z.boolean(),
  can_manage_own_course_pricing: z.literal(true).optional(),
};
const commissionPolicy = {
  regular_lecturer_percent: percent,
  senior_lecturer_percent: percent,
  policy_version: z.number().int().positive(),
};

export const commissionAccessSchema = z.union([
  z.strictObject({
    ...commissionCapabilities,
    can_manage_gross: z.literal(false),
    policy_configured: z.boolean(),
  }),
  z.strictObject({
    ...commissionCapabilities,
    ...commissionPolicy,
    can_manage_gross: z.literal(true),
    policy_configured: z.literal(true),
  }),
  z.strictObject({
    ...commissionCapabilities,
    can_manage_gross: z.literal(true),
    policy_configured: z.literal(false),
    regular_lecturer_percent: z.null(),
    senior_lecturer_percent: z.null(),
    policy_version: z.literal(0),
  }),
]);

export const commissionOfferPolicySchema = z
  .strictObject({
    ...commissionPolicy,
    platform_percent_override: percent.optional(),
    gross_amount: z.number().nonnegative().optional(),
    gross_total_amount: z.number().nonnegative().optional(),
  })
  .nullable();

const claimLecturer = { claim_id: id, lecturer_name: z.string() };

export const companyLecturerDecisionsSchema = z.array(
  z.strictObject({
    ...claimLecturer,
    lecturer_id: id,
    status: z.enum([
      "pending",
      "accepted",
      "auto_accepted",
      "rejected",
      "review_required",
    ]),
    deadline: retainedInstant,
    can_reject: z.boolean().nullable(),
  }),
);

export const companyRejectedLecturersSchema = z.array(
  z.strictObject(claimLecturer),
);

export const companyInvoiceReviewsSchema = z.array(
  z.strictObject({
    ...claimLecturer,
    job_id: id,
    job_title: z.string(),
    requested_at: retainedInstant,
    invoices: z.array(
      z.strictObject({
        number: z.string(),
        status: z.enum([
          "submitted",
          "approved",
          "paid",
          "rejected",
          "cancelled",
        ]),
      }),
    ),
  }),
);

const compensationVersion = z.number().int().min(1).max(1999);

export const lecturerCompensationSchema = z.strictObject({
  mode: compensationMode,
  percent,
  daily_rate: dailyRate,
  currency,
  version: compensationVersion,
  is_customized: z.boolean(),
});

export const saveLecturerCompensationSchema = z.strictObject({
  p_user_id: id,
  p_mode: compensationMode,
  p_percent: percent,
  p_daily_rate: dailyRate,
  p_currency: currency,
  p_expected_version: compensationVersion.max(1998),
});
