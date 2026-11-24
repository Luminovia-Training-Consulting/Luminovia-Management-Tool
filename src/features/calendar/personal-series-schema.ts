import { z } from "zod";

export const personalSeriesLimit = 52;

const occurrence = z.strictObject({
  starts_at: z.iso.datetime({ offset: true }),
  ends_at: z.iso.datetime({ offset: true }),
});

export const createPersonalSeriesInput = z.strictObject({
  p_title: z.string().min(1).max(200),
  p_description: z.string().max(10000),
  p_meeting_url: z.string().max(2000),
  p_time_zone: z.string().min(1).max(100),
  p_occurrences: z.array(occurrence).min(1).max(personalSeriesLimit),
});

export const personalSeriesReceipt = z.strictObject({
  series_id: z.uuid(),
  created: z.number().int().min(1).max(personalSeriesLimit),
});

export const cancelledPersonalSeriesCount = z
  .number()
  .int()
  .min(0)
  .max(personalSeriesLimit);
