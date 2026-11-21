/** Account-scoped UI settings. Login controls still work locally before a session exists. */
import { z } from "zod";
import { db } from "./supabase";
import { requireOnline } from "./online";

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

export async function loadUiPreferences(): Promise<UiPreferences> {
  const { data, error } = await db().rpc("ui_preferences");
  if (error) throw error;
  return uiPreferencesSchema.parse(data);
}

export async function saveUiPreferences(
  patch: UiPreferencesPatch,
): Promise<UiPreferences> {
  requireOnline();
  const { data, error } = await db().rpc("save_ui_preferences", {
    p_patch: patch,
  });
  if (error) throw error;
  return uiPreferencesSchema.parse(data);
}
