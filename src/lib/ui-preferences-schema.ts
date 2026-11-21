import { z } from "zod";

export const uiPreferencesSchema = z.object({
  language: z.enum(["de", "en"]),
  theme: z.enum(["system", "light", "dark"]),
  sidebar_collapsed: z.boolean(),
  version: z.number().int().nonnegative(),
});
export type UiPreferences = z.infer<typeof uiPreferencesSchema>;
export type UiPreferencesPatch = Partial<
  Pick<UiPreferences, "language" | "theme" | "sidebar_collapsed">
>;
