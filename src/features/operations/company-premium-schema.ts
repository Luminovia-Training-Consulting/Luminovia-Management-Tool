/** Shared UI and OpenAPI DTOs for the company entitlement and audited summaries. */
import { z } from "zod";

const uuid = z.uuid();
const instant = z.iso.datetime({ offset: true });
const count = z.number().int().nonnegative();

export const companyPremiumSettingsSchema = z.array(
  z.strictObject({
    organisation_id: uuid,
    enabled: z.boolean(),
    version: count,
    updated_at: instant.nullable(),
  }),
);

export type CompanyPremiumSetting = z.infer<
  typeof companyPremiumSettingsSchema
>[number];

/** Changed and unchanged toggles, including a version conflict, share one receipt. */
export const companyPremiumCommandSchema = z.strictObject({
  status: z.enum(["updated", "unchanged", "conflict"]),
  enabled: z.boolean(),
  version: count,
});

/** Only audited counts and resource metadata cross this admin-read boundary. */
export const retainedCompanyLmsSchema = z.strictObject({
  organisation_id: uuid,
  premium_enabled: z.boolean(),
  course_count: count,
  courses: z.array(
    z.strictObject({
      run_id: uuid,
      title: z.string(),
      archived_at: instant.nullable(),
      sessions: count,
      enrolments: count,
      resources: z.array(
        z.strictObject({
          name: z.string(),
          version: count.min(1),
          audience: z.enum(["staff", "client", "participants", "all"]),
          removed: z.boolean(),
        }),
      ),
      attendance_entries: count,
      course_group_messages: count,
      questions: count,
      quiz_attempts: count,
      completion_records: count,
    }),
  ),
});
