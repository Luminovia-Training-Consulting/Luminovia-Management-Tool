import { z } from "zod";

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
