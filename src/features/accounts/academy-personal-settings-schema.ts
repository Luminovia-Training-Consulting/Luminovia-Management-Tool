import { z } from "zod";
import { uiPreferencesSchema } from "../../lib/ui-preferences-schema.ts";

const version = z.number().int().min(0).max(2147483647);
export const academyAppearanceSchema = uiPreferencesSchema
  .omit({ sidebar_collapsed: true })
  .extend({ version })
  .strict();
export const academyAppearancePatchSchema = academyAppearanceSchema
  .omit({ version: true })
  .partial()
  .meta({ minProperties: 1 });

export const academyPersonalSettingsSchema = z.strictObject({
  display_name: z.string(),
  appearance: academyAppearanceSchema,
});

export type AcademyPersonalSettings = z.infer<
  typeof academyPersonalSettingsSchema
>;
export type AcademyAppearancePatch = z.infer<
  typeof academyAppearancePatchSchema
>;
