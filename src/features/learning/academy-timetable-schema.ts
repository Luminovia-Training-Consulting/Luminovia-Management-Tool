import { z } from "zod";

export const maxAcademyTimetableDays = 31;
const day = z.iso.date();
const instant = z.iso.datetime({ offset: true });
const cursor = z.strictObject({ start: instant, id: z.uuid() });

export const academyTimetableRequestSchema = z
  .strictObject({
    p_from: day,
    p_until: day,
    p_after_start: instant.optional(),
    p_after_id: z.uuid().optional(),
  })
  .refine(
    ({ p_from, p_until }) =>
      p_from >= "0001-01-01" &&
      p_from <= p_until &&
      Date.parse(p_until) - Date.parse(p_from) <
        maxAcademyTimetableDays * 86_400_000,
  )
  .refine(
    ({ p_after_start, p_after_id }) =>
      Boolean(p_after_start) === Boolean(p_after_id),
  );

const timetableSession = z.strictObject({
  session_id: z.uuid(),
  course_run_id: z.uuid(),
  course_title: z.string(),
  starts_at: instant,
  ends_at: instant,
  time_zone: z.string().min(1),
  local_day: day,
  venue: z.string(),
  delivery_type: z.enum(["online", "onsite"]),
});

export const academyTimetableSchema = z.strictObject({
  rows: z.array(timetableSession).max(100),
  next: cursor.nullable(),
});

export type AcademyTimetableRequest = z.infer<
  typeof academyTimetableRequestSchema
>;
export type AcademyTimetableCursor = z.infer<typeof cursor>;
export type AcademyTimetableSession = z.infer<typeof timetableSession>;
