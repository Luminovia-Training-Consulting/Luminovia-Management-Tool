/** Scoped state and write receipt for an active lesson version. */
import { z } from "zod";

export const lessonRuntimeState = z.strictObject({
  revision: z.number().int().nonnegative(),
  cmi: z.record(z.string(), z.string()),
  total_elapsed_cs: z.number().int().nonnegative().max(3_599_999_999),
  student_id: z.string().max(64),
  can_write: z.boolean(),
});
export const scormCommitPayload = z.strictObject({
  "cmi.core.lesson_status": z.enum([
    "passed",
    "completed",
    "failed",
    "incomplete",
    "browsed",
    "not attempted",
  ]),
  "cmi.core.lesson_location": z.string().max(255),
  "cmi.suspend_data": z.string().max(4096),
  "cmi.core.score.raw": z.string().max(12),
  "cmi.core.score.min": z.string().max(12),
  "cmi.core.score.max": z.string().max(12),
  "cmi.core.exit": z.enum(["", "time-out", "suspend", "logout"]),
  "cmi.core.session_time": z.string().max(13),
});
