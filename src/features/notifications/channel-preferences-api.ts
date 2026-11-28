/** Read and save versioned external delivery choices for the signed-in account. */
import { queryOptions } from "@tanstack/react-query";
import { db } from "../../lib/supabase";
import { throwPagedReadError } from "../../lib/paged-read";
import {
  notificationChannelPreferencesSchema,
  type NotificationChannelPreferences,
} from "./channel-preferences-schema";

/** Keep settings scoped to the actor when the browser changes accounts. */
export const notificationChannelPreferencesQuery = (actor: string) =>
  queryOptions({
    queryKey: ["notification-channel-preferences", actor] as const,
    queryFn: async ({ signal }) => {
      const { data, error, status } = await db()
        .rpc("notification_channel_preferences")
        .abortSignal(signal);
      if (error) throwPagedReadError(error, status);
      return notificationChannelPreferencesSchema.parse(data);
    },
    staleTime: 15000,
  });

/** Save both channel maps against the version reviewed by the editor. */
export async function saveNotificationChannelPreferences(
  values: NotificationChannelPreferences,
) {
  const { channels, version } =
    notificationChannelPreferencesSchema.parse(values);
  const { data, error } = await db().rpc(
    "save_notification_channel_preferences",
    { p_payload: channels, p_expected_version: version },
  );
  if (error) throw error;
  return notificationChannelPreferencesSchema.parse(data);
}

/** The legacy settings remain usable during a rollback to an older database. */
export function missingChannelPreferences(error: unknown) {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error.code === "PGRST202" || error.code === "42883"),
  );
}
