import { z } from "zod";

const uuid = z.uuid();
const date = z.iso.datetime({ offset: true });
export const courseCloseoutKind = z.enum(["attendance", "grade", "submission"]);
export const courseCloseoutRequest = z.strictObject({
  p_course_run_id: uuid,
  p_review_token: z.string().regex(/^[a-f0-9]{32}$/),
  p_assignees: z.partialRecord(courseCloseoutKind, uuid),
});
export const courseCloseoutResponse = z.object({
  can_close: z.boolean(),
  review_token: z.string().regex(/^[a-f0-9]{32}$/),
  items: z.array(
    z.object({
      kind: courseCloseoutKind,
      person_id: uuid,
      person: z.string(),
      session_id: uuid.nullable(),
      session_start: date.nullable(),
    }),
  ),
  staff: z.array(z.object({ id: uuid, name: z.string() })),
  confirmed_at: date.nullable(),
  followups: z.partialRecord(
    courseCloseoutKind,
    z.object({
      task_id: uuid,
      name: z.string(),
      state: z.enum(["open", "doing", "done", "cancelled"]),
    }),
  ),
});

export const courseCloseoutFollowupSchema = z.object({
  course_run_id: uuid,
  title: z.string(),
  state: z.enum(["open", "doing", "done", "cancelled"]),
  due_at: date.nullable(),
  time_zone: z.string(),
  version: z.number().int().positive(),
  can_update: z.boolean(),
});
