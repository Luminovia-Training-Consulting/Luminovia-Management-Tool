/** Own versioned dashboard state and permission-scoped teaching-day previews; defaults support older payloads without inventing shared progress. */
import { queryOptions } from "@tanstack/react-query";
import { db } from "../../lib/supabase";
import { requireOnline } from "../../lib/online";
import {
  dashboardPreferencesSchema,
  preparationSchema,
  teachingDaySchema,
  type DashboardPreferences,
  type PreparationId,
} from "./personal-schema";

export {
  dashboardPreferencesSchema,
  defaultDashboardPreferences,
  preparationIds,
  teachingDaySchema,
  type TeachingDay,
  widgetIds,
  type DashboardPreferences,
  type WidgetId,
} from "./personal-schema";

export const dashboardPreferencesKey = (actor: string) =>
  ["dashboard-preferences", actor] as const;
export const dashboardPreferencesQuery = (actor: string) =>
  queryOptions({
    queryKey: dashboardPreferencesKey(actor),
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("dashboard_preferences")
        .abortSignal(signal);
      if (error) throw error;
      return dashboardPreferencesSchema.parse(data);
    },
    staleTime: 15000,
    retry: false,
  });

export async function saveDashboardPreferences(value: DashboardPreferences) {
  requireOnline();
  const { version, ...payload } = dashboardPreferencesSchema.parse(value);
  const { data, error } = await db().rpc("save_dashboard_preferences", {
    p_payload: payload,
    p_expected_version: version,
  });
  if (error) throw error;
  return dashboardPreferencesSchema.parse(data);
}

export const teachingDayKey = (actor: string) =>
  ["teaching-day", actor] as const;
export const teachingDayQuery = (actor: string) =>
  queryOptions({
    queryKey: teachingDayKey(actor),
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("teaching_day")
        .abortSignal(signal);
      if (error) throw error;
      return teachingDaySchema.parse(data);
    },
    staleTime: 15000,
    retry: false,
  });

export async function saveTeachingPreparation(
  claim: string,
  item: PreparationId,
  done: boolean,
  version: number,
) {
  requireOnline();
  const { data, error } = await db().rpc("save_teaching_preparation", {
    p_claim_id: claim,
    p_item: item,
    p_done: done,
    p_expected_version: version,
  });
  if (error) throw error;
  return preparationSchema.parse(data);
}

export function teachingLink(location: string) {
  if (
    location.includes("\\") ||
    [...location].some(
      (character) =>
        character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127,
    )
  )
    return null;
  try {
    const link = new URL(location);
    return link.protocol === "https:" && !link.username && !link.password
      ? link.href
      : null;
  } catch {
    return null;
  }
}
