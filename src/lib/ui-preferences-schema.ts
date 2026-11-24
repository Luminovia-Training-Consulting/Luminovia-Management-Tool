import { z } from "zod";
import { accountLanguages } from "./account-languages.ts";

export const uiPreferencesSchema = z.object({
  language: z.enum(accountLanguages),
  theme: z.enum(["system", "light", "dark"]),
  sidebar_collapsed: z.boolean(),
  version: z.number().int().nonnegative(),
});
export type UiPreferences = z.infer<typeof uiPreferencesSchema>;
export type UiPreferencesPatch = Partial<
  Pick<UiPreferences, "language" | "theme" | "sidebar_collapsed">
>;
