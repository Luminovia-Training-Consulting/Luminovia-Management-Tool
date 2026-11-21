/** Shared wire projections for the internal Premium company participant centre. */
import { z } from "zod";

const count = z.int().nonnegative();
const instant = z.iso.datetime({ offset: true });
export const companyReferenceLimit = 64;
const companyReference = z
  .string()
  .min(1)
  .max(companyReferenceLimit)
  .nullable();

export const companyParticipantSchema = z.object({
  user_id: z.uuid(),
  luminovia_user_id: z.string(),
  display_name: z.string(),
  joined_at: instant,
  company_reference: companyReference.default(null),
  version: z.int().positive(),
});
export type CompanyParticipant = z.infer<typeof companyParticipantSchema>;
export const companyParticipantsSchema = z.array(companyParticipantSchema);

export const companyParticipantReferenceSchema = z.object({
  company_reference: companyReference,
  version: z.int().positive(),
});
export const companyParticipantOverviewSchema = z.object({
  items: z
    .array(
      z.object({
        run_id: z.uuid(),
        title: z.string(),
        status: z.enum(["enrolled", "completed", "removed"]),
        starts_at: instant.nullable(),
        ends_at: instant.nullable(),
        time_zone: z.string(),
        session_count: count,
        present_count: count,
        absent_count: count,
        excused_count: count,
      }),
    )
    .max(100),
  has_more: z.boolean(),
});

export const companyParticipantHistorySchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        id: z.uuid(),
        kind: z.enum([
          "email_invite_requested",
          "user_id_link_requested",
          "association_confirmed",
          "association_removed",
          "reference_changed",
          "course_enrolment_changed",
        ]),
        occurred_at: instant,
      }),
    )
    .max(100),
  has_more: z.boolean(),
});
