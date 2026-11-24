import { z } from "zod";

export const courseSeriesClasses = z.array(
  z.strictObject({ id: z.uuid(), name: z.string() }),
);

const seriesSession = z.strictObject({
  starts_at: z.iso.datetime({ offset: true }),
  ends_at: z.iso.datetime({ offset: true }),
});

export const courseSeriesRequest = z.strictObject({
  p_organisation_id: z.uuid(),
  p_template_id: z.uuid(),
  p_time_zone: z.string().min(1).max(100),
  p_runs: z
    .array(
      z.strictObject({
        delivery_type: z.enum(["online", "onsite"]),
        venue: z.string().max(500),
        class_id: z.uuid().nullable().optional(),
        sessions: z.array(seriesSession).min(1).max(60),
      }),
    )
    .min(2)
    .max(12),
  p_request_id: z.uuid().nullable(),
});

export const courseSeriesResult = z.strictObject({
  run_ids: z.array(z.uuid()).max(12),
  conflicts: z
    .array(
      z.strictObject({
        run_no: z.int().min(1).max(12),
        session_no: z.int().min(1).max(60),
        reason: z.enum(["session", "class", "room"]),
      }),
    )
    .max(720),
});

export type SeriesRun = z.infer<typeof courseSeriesRequest>["p_runs"][number];
