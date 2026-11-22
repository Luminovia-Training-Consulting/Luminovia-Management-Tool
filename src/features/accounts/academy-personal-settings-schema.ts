import { z } from "zod";
import { uiPreferencesSchema } from "../../lib/ui-preferences-schema.ts";

const version = z.number().int().min(0).max(2147483647);
export const usernamePattern = /^[a-z][a-z0-9._-]{1,30}[a-z0-9]$/;
export const academyUsernameSchema = z.strictObject({
  username: z.string().regex(usernamePattern).nullable(),
  version,
});
export const academyUsernameRequestSchema = z.strictObject({
  p_username: z.string().max(64).nullable(),
  p_expected_version: version,
});
export const academyAppearanceSchema = uiPreferencesSchema
  .omit({ sidebar_collapsed: true })
  .extend({ version })
  .strict();
export const academyAppearancePatchSchema = academyAppearanceSchema
  .omit({ version: true })
  .partial()
  .meta({ minProperties: 1 });

export const academyPersonalSettingsSchema = z.strictObject({
  username: academyUsernameSchema,
  appearance: academyAppearanceSchema,
});

export type AcademyPersonalSettings = z.infer<
  typeof academyPersonalSettingsSchema
>;
export type AcademyAppearancePatch = z.infer<
  typeof academyAppearancePatchSchema
>;
