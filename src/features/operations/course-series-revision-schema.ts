import { z } from "zod";
import { courseSeriesPattern, seriesSession } from "./course-series-schema.ts";

export const courseSeriesSnapshot = z
  .strictObject({
    revision: z.string().regex(/^[0-9a-f]{64}$/),
    time_zone: z.string(),
    runs: z
      .array(
        z.strictObject({
          id: z.uuid(),
          editable: z.boolean(),
          pattern: courseSeriesPattern.nullable(),
          sessions: z.array(seriesSession),
        }),
      )
      .min(2)
      .max(12),
  })
  .nullable();

export const courseSeriesRevisionRequest = z.strictObject({
  p_course_id: z.uuid(),
  p_revision: z.string().regex(/^[0-9a-f]{64}$/),
  p_changes: z
    .array(
      z.strictObject({
        id: z.uuid(),
        pattern: courseSeriesPattern,
        sessions: z.array(seriesSession).min(1).max(60),
      }),
    )
    .min(1)
    .max(12),
  p_confirm: z.boolean(),
});
