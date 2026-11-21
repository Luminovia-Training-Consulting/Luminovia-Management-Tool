import { z } from "zod";
import { validZone } from "../../lib/dates.ts";

const instant = z.iso.datetime({ offset: true });

export const calendarExportSchema = z
  .array(
    z.object({
      id: z.uuid(),
      kind: z.enum(["assignment", "private"]),
      title: z.string(),
      starts_at: instant,
      ends_at: instant,
      time_zone: z.string().refine(validZone),
    }),
  )
  .max(500);

export const calendarImportReceipt = z.object({
  created: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
});

export const calendarSubscriptionSchema = z.object({
  id: z.uuid(),
  label: z.string().min(1).max(80),
  include_private: z.boolean(),
  expires_at: instant,
  revoked_at: instant.nullable(),
  version: z.number().int().positive(),
  created_at: instant,
});

export const calendarSwatches = {
  "#DCE9F8": "calendarColorBlue",
  "#E1EDDA": "calendarColorMint",
  "#FFF0C5": "calendarColorYellow",
  "#F8E2D3": "calendarColorPeach",
  "#E6E0F0": "calendarColorLilac",
  "#F5DDE7": "calendarColorPink",
  "#DFE6EA": "calendarColorSlate",
} as const;

export const calendarSwatchSchema = z.enum(
  Object.keys(calendarSwatches) as (keyof typeof calendarSwatches)[],
);

export const calendarColorsSchema = z.object({
  personal_event_color: calendarSwatchSchema,
  assignment_event_color: calendarSwatchSchema,
  customer_event_color: calendarSwatchSchema,
  version: z.number().int().nonnegative(),
});
