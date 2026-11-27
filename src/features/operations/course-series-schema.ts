import { z } from "zod";
import { operationalPresetCommand } from "./operational-preset-schema.ts";

export const courseSeriesClasses = z.array(
  z.strictObject({ id: z.uuid(), name: z.string() }),
);

export const seriesSession = z.strictObject({
  starts_at: z.iso.datetime({ offset: true }),
  ends_at: z.iso.datetime({ offset: true }),
});

const seriesClock = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/);

export const courseSeriesPattern = z.strictObject({
  first_day: z.iso.date(),
  days: z.int().min(1).max(60),
  start: seriesClock,
  end: seriesClock,
  weekdays: z.array(z.int().min(1).max(7)).min(1).max(7),
  excluded_dates: z.string().max(1000),
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
        operational_preset: operationalPresetCommand.optional(),
        pattern: courseSeriesPattern.optional(),
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
