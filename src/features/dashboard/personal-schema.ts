import { z } from "zod";
import { validZone } from "../../lib/dates.ts";

export const widgetIds = [
  "teaching_day",
  "activity",
  "contracts",
  "files",
  "followups",
] as const;
export type WidgetId = (typeof widgetIds)[number];
const widgetSchema = z.enum(widgetIds);
export const dashboardPreferencesSchema = z.object({
  widget_order: z
    .array(widgetSchema)
    .length(widgetIds.length)
    .refine((ids) => new Set(ids).size === widgetIds.length)
    .meta({ uniqueItems: true }),
  hidden_widgets: z
    .array(widgetSchema)
    .max(widgetIds.length)
    .refine((ids) => new Set(ids).size === ids.length)
    .meta({ uniqueItems: true }),
  version: z.number().int().nonnegative(),
});
export type DashboardPreferences = z.infer<typeof dashboardPreferencesSchema>;
export const defaultDashboardPreferences: DashboardPreferences = {
  widget_order: [...widgetIds],
  hidden_widgets: [],
  version: 0,
};

export const preparationIds = [
  "materials_ready",
  "location_ready",
  "contact_ready",
] as const;
export type PreparationId = (typeof preparationIds)[number];
export const preparationSchema = z.object({
  materials_ready: z.boolean(),
  location_ready: z.boolean(),
  contact_ready: z.boolean(),
  version: z.number().int().nonnegative(),
});
export const teachingDaySchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time_zone: z.string().refine(validZone),
  sessions: z
    .array(
      z.object({
        id: z.string().uuid(),
        claim_id: z.string().uuid(),
        job_id: z.string().uuid(),
        title: z.string(),
        customer_name: z.string(),
        starts_at: z.string().datetime({ offset: true }),
        ends_at: z.string().datetime({ offset: true }),
        time_zone: z.string().refine(validZone),
        delivery_type: z.enum(["online", "onsite"]),
        location: z.string(),
        documents: z
          .array(z.object({ id: z.string().uuid(), name: z.string() }))
          .max(20),
        document_count: z.number().int().nonnegative().optional(),
        course_run_id: z.string().uuid().nullable().default(null),
        course_contact: z
          .object({ name: z.string(), email: z.string(), phone: z.string() })
          .nullable()
          .default(null),
        shared_preparation: z
          .object({
            done: z.number().int().nonnegative(),
            total: z.number().int().nonnegative(),
          })
          .refine((value) => value.done <= value.total)
          .nullable()
          .default(null),
        course_resources: z
          .array(
            z.object({
              id: z.string().uuid(),
              version_id: z.string().uuid(),
              name: z.string(),
              sha256: z.string().regex(/^[a-f0-9]{64}$/),
              category: z.enum(["material", "report"]),
            }),
          )
          .max(10)
          .default([]),
        course_resource_count: z.number().int().nonnegative().default(0),
        preparation: preparationSchema,
      }),
    )
    .max(100),
});
export type TeachingDay = z.infer<typeof teachingDaySchema>;
