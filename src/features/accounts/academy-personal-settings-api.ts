import { queryOptions } from "@tanstack/react-query";
import { installationBrand } from "../../lib/installation-brand";
import { requireOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import {
  academyAppearanceSchema,
  academyPersonalSettingsSchema,
  academyUsernameSchema,
  type AcademyAppearancePatch,
} from "./academy-personal-settings-schema";

async function currentAcademySession(actor: string) {
  const client = db();
  const { data, error } = await client.auth.getSession();
  if (error || data.session?.user.id !== actor)
    throw new Error("academy_session_changed");
  // Fix this request's bearer to its actor even if a queued mutation runs
  // during a concurrent SDK session change.
  return { client, authorization: "Bearer " + data.session.access_token };
}

export function academyPersonalSettingsQuery(actor: string) {
  return queryOptions({
    queryKey: [
      "academy-personal-settings",
      installationBrand.installationId,
      actor,
    ],
    enabled: Boolean(actor),
    staleTime: 0,
    gcTime: 0,
    retry: false,
    queryFn: async ({ signal }) => {
      const { client, authorization } = await currentAcademySession(actor);
      const { data, error } = await client
        .rpc("academy_personal_settings")
        .setHeader("Authorization", authorization)
        .abortSignal(signal);
      if (error) throw error;
      return academyPersonalSettingsSchema.parse(data);
    },
  });
}

export async function saveAcademyUsername(
  actor: string,
  value: string | null,
  version: number,
) {
  requireOnline();
  const { client, authorization } = await currentAcademySession(actor);
  const { data, error } = await client
    .rpc("academy_save_username", {
      p_username: value,
      p_expected_version: version,
    })
    .setHeader("Authorization", authorization);
  if (error) throw error;
  return academyUsernameSchema.parse(data);
}

export async function saveAcademyAppearance(
  actor: string,
  patch: AcademyAppearancePatch,
) {
  requireOnline();
  const { client, authorization } = await currentAcademySession(actor);
  const { data, error } = await client
    .rpc("academy_save_appearance", { p_patch: patch })
    .setHeader("Authorization", authorization);
  if (error) throw error;
  return academyAppearanceSchema.parse(data);
}
