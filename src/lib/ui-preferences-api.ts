/** Account-scoped UI settings. Login controls still work locally before a session exists. */
import { db } from "./supabase";
import { requireOnline } from "./online";
import {
  uiPreferencesSchema,
  type UiPreferences,
  type UiPreferencesPatch,
} from "./ui-preferences-schema";

export {
  uiPreferencesSchema,
  type UiPreferences,
  type UiPreferencesPatch,
} from "./ui-preferences-schema";

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
