/** DTOs shared by the exact-session register and its OpenAPI projections. */
import { z } from "zod";

const uuid = z.uuid();
const instant = z.iso.datetime({ offset: true });
const version = z.number().int().nonnegative();
const minutes = z.number().int().nonnegative();
const note = z.string().max(1000);
const status = z.enum(["present", "absent", "excused"]);

export const maxAttendanceImportRows = 200;
export const attendanceImportRowSchema = z.strictObject({
  user_id: uuid,
  status,
  arrival_at: instant.nullable(),
  departure_at: instant.nullable(),
  note,
  reason: z.string().max(500),
  expected_version: version,
});
export const attendanceImportReceiptSchema = z.strictObject({
  saved: z.number().int().min(1).max(maxAttendanceImportRows),
});
export type AttendanceImportRow = z.infer<typeof attendanceImportRowSchema>;

/** A retained snapshot predating the session register has the original six fields. */
const priorAttendance = {
  session_id: uuid,
  user_id: uuid,
  state: z.enum(["reported", "attended", "absent"]),
  minutes,
  version: version.min(1),
  updated_at: instant,
};

const registerDetails = {
  arrival_at: instant.nullable(),
  departure_at: instant.nullable(),
  staff_note: note,
};

// PostgreSQL serializes an unpopulated composite row with null fields.
// Both the original composite and the expanded register composite are retained.
const empty = z.null();
const emptyPriorAttendance = {
  session_id: empty,
  user_id: empty,
  state: empty,
  minutes: empty,
  version: empty,
  updated_at: empty,
};

/** A legacy verification stores only state and minutes. Session-register writes
 * additionally preserve the exact status, times and staff note. */
const verifiedAttendance = { state: z.enum(["attended", "absent"]), minutes };
const attendanceAudit = {
  id: uuid,
  user_id: uuid,
  old_state: z
    .union([
      z.strictObject(priorAttendance),
      z.strictObject({
        ...priorAttendance,
        ...registerDetails,
        register_status: status.nullable(),
      }),
      z.strictObject(emptyPriorAttendance),
      z.strictObject({
        ...emptyPriorAttendance,
        register_status: empty,
        arrival_at: empty,
        departure_at: empty,
        staff_note: empty,
      }),
    ])
    .nullable(),
  new_state: z.union([
    z.strictObject(verifiedAttendance),
    z.strictObject({
      ...verifiedAttendance,
      ...registerDetails,
      register_status: status,
    }),
  ]),
  reason: z.string().min(3).max(500),
  created_at: instant,
};

/** The course-wide staff projection identifies the session but omits the actor. */
export const workspaceAttendanceHistorySchema = z.array(
  z.strictObject({ ...attendanceAudit, session_id: uuid }),
);

const attendanceRowSchema = z.strictObject({
  user_id: uuid,
  name: z.string(),
  status: status.nullable(),
  arrival_at: instant.nullable(),
  departure_at: instant.nullable(),
  note,
  version,
});

/** The register covers one exact session, so history identifies the correction actor. */
export const attendanceRegisterSchema = z.strictObject({
  session_id: uuid,
  starts_at: instant,
  ends_at: instant,
  time_zone: z.string(),
  rows: z.array(attendanceRowSchema),
  evidence: z.array(
    z.strictObject({
      id: uuid,
      resource_id: uuid,
      version_id: uuid,
      name: z.string(),
      attached_at: instant,
    }),
  ),
  history: z.array(z.strictObject({ ...attendanceAudit, actor_id: uuid })),
});

export type AttendanceStatus = z.infer<typeof status>;
export type AttendanceRow = z.infer<typeof attendanceRowSchema>;
export type AttendanceRegister = z.infer<typeof attendanceRegisterSchema>;
export type WorkspaceAttendanceHistory = z.infer<
  typeof workspaceAttendanceHistorySchema
>;
