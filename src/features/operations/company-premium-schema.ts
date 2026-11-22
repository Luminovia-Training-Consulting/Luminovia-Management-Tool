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

export const retainedCourseAttendanceSchema = z.strictObject({
  time_zone: z.string(),
  items: z
    .array(
      z.strictObject({
        session_id: uuid,
        starts_at: instant,
        ends_at: instant,
        user_id: uuid,
        name: z.string(),
        status: z.enum(["present", "absent", "excused", "reported"]),
        arrival_at: instant.nullable(),
        departure_at: instant.nullable(),
        note: z.string().max(1000),
      }),
    )
    .max(50),
  next_cursor: z
    .strictObject({ starts_at: instant, session_id: uuid, user_id: uuid })
    .nullable(),
});

export type RetainedCourseAttendance = z.infer<
  typeof retainedCourseAttendanceSchema
>;

const retainedFileKind = z.enum(["exam", "material"]);

export const retainedCourseFilesSchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        file_kind: retainedFileKind,
        id: uuid,
        version_id: uuid,
        version: count.min(1),
        name: z.string(),
        audience: z.enum([
          "staff",
          "client",
          "participants",
          "all",
          "students",
          "exam_staff",
        ]),
        withdrawn: z.boolean(),
      }),
    )
    .max(50),
  next_cursor: z
    .strictObject({ file_kind: retainedFileKind, id: uuid })
    .nullable(),
});

export type RetainedCourseFiles = z.infer<typeof retainedCourseFilesSchema>;
