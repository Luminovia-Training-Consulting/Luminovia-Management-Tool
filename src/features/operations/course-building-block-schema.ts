/** Shared validation for course authoring, reviewed job previews and provenance. */
import { currencyCodes } from "../../lib/currencies.ts";
import { z } from "zod";

export const courseRecordId = z.uuid();
const id = courseRecordId;
const dateTime = z.iso.datetime({ offset: true });
const sourceRevision = z.string().regex(/^[a-f0-9]{64}$/);
const templateFields = {
  title: z.string().trim().min(1).max(200),
  description: z.string().max(12000),
};

export const courseTemplateFormSchema = z.object({
  ...templateFields,
  syllabus: z.string().max(30000),
  prerequisites: z.string().max(8000),
  topic_ids: z.array(z.string()),
  archived: z.boolean(),
});

export const courseTemplatePayloadSchema = z.strictObject({
  owner_organisation_id: id.nullable().optional(),
  title: templateFields.title.regex(/[^ ]/),
  description: templateFields.description.nullable().optional(),
  syllabus: z.string().nullable().optional(),
  prerequisites: z.string().nullable().optional(),
  topic_ids: z
    .array(id)
    .optional()
    .describe(
      "Up to 50 distinct topic identifiers. Duplicate identifiers are collapsed.",
    ),
  archived: z.boolean().nullable().optional().meta({ default: false }),
});

const courseRunFields = {
  source_revision: sourceRevision,
  course_run_id: id,
  template_id: id,
  title: z.string(),
  description: z.string(),
  syllabus: z.string(),
  prerequisites: z.string(),
  organisation_id: id.nullable(),
  customer_name: z.string(),
  delivery_type: z.enum(["online", "onsite"]),
  location: z.string(),
  time_zone: z.string(),
  topic_ids: z.array(id),
  sessions: z.array(
    z.strictObject({
      source_course_session_id: id,
      starts_at: dateTime,
      ends_at: dateTime,
    }),
  ),
};

export const courseRunJobDefaultsSchema = z.union([
  z.strictObject({
    ...courseRunFields,
    building_block_id: id,
    building_block_source_id: id,
  }),
  z.strictObject({
    ...courseRunFields,
    building_block_id: z.null(),
    building_block_source_id: z.null(),
  }),
]);
export type CourseRunJobDefaults = z.infer<typeof courseRunJobDefaultsSchema>;

export const jobBuildingBlockReferenceSchema = z
  .strictObject({ template_id: id, building_block_id: id, source_id: id })
  .nullable();
export type JobBuildingBlockSource = NonNullable<
  z.infer<typeof jobBuildingBlockReferenceSchema>
>;

export const courseOfferCurrencySchema = z.enum(currencyCodes);
export const courseOfferRateUnitSchema = z.enum([
  "per_day",
  "per_teaching_unit",
  "per_hour",
  "fixed_total",
]);
const amount = z.number().min(0.01).max(9999999999.99).multipleOf(0.01);
const offerFields = {
  source_revision: sourceRevision,
  title: templateFields.title
    .regex(/\S/)
    .optional()
    .describe("Marketplace title. Omit to use the course template title."),
  description: templateFields.description
    .optional()
    .describe(
      "Marketplace description. Omit to use the course template description. An empty string clears the listing description.",
    ),
  capacity: z
    .int()
    .min(1)
    .max(20)
    .optional()
    .meta({ default: 1 })
    .describe(
      "Number of lecturer positions. Each quoted amount covers one position for the complete shared schedule.",
    ),
  currency: courseOfferCurrencySchema,
  rate_unit: courseOfferRateUnitSchema,
  terms: z.string().max(10000).optional(),
  requires_contract: z.boolean().optional().meta({ default: true }),
  status: z
    .enum(["draft", "published"])
    .nullable()
    .optional()
    .meta({ default: "draft" }),
  claim_deadline: dateTime.nullable().optional(),
};

const commissionOfferPayload = z.strictObject({
  ...offerFields,
  gross_amount: amount,
  gross_total_amount: amount,
});
const legacyNetOfferPayload = z.strictObject({
  ...offerFields,
  amount,
  total_amount: amount,
});
export type CourseRunOfferPayload =
  | z.input<typeof commissionOfferPayload>
  | z.input<typeof legacyNetOfferPayload>;

const runJobFields = { p_course_run_id: id, p_client_id: id };
export const createCourseRunJobRequestSchema = z.union([
  z.strictObject({
    ...runJobFields,
    p_payload: commissionOfferPayload,
    p_platform_percent: z
      .number()
      .min(0)
      .max(100)
      .multipleOf(0.01)
      .nullable()
      .optional(),
  }),
  z.strictObject({
    ...runJobFields,
    p_payload: legacyNetOfferPayload,
    p_platform_percent: z.literal(50).nullable().optional(),
  }),
]);
