import { z } from "zod";

export const courseParticipationReportRequest = z.strictObject({
  p_run_id: z.uuid(),
  p_after_user_id: z.uuid().nullable().optional(),
  p_limit: z.number().int().min(1).max(200).optional(),
});

export const courseParticipationReportSchema = z.strictObject({
  course_id: z.uuid(),
  session_count: z.number().int().nonnegative(),
  rows: z
    .array(
      z.strictObject({
        user_id: z.uuid(),
        participant_id: z.string(),
        name: z.string(),
        enrolment: z.enum(["enrolled", "completed"]),
        present: z.number().int().nonnegative(),
        absent: z.number().int().nonnegative(),
        excused: z.number().int().nonnegative(),
        completion: z.enum(["issued", "revoked", "not_issued"]),
      }),
    )
    .max(200),
  next_after: z.uuid().nullable(),
});
