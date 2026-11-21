/** Public presentation settings are separate from the signed installation identity. */
import { queryOptions } from "@tanstack/react-query";
import { createContext, useContext } from "react";
import { installationBrand } from "../../lib/installation-brand";
import { requireOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import { useAuth } from "../auth/auth-context";
import { sessionCacheBoundary } from "../auth/session-cache-boundary";

import {
  type AcademyBrandingValues,
  academyBrandingSettings,
} from "./academy-branding-schema";

function verifyBranding(value: unknown) {
  const result = academyBrandingSettings.parse(value);
  if (
    result.installation_id !== installationBrand.installationId ||
    (result.name === null) !== (result.short_name === null) ||
    (result.name === null) !== (result.theme_color === null)
  ) {
    throw new Error("academy_branding_unavailable");
  }
  return result;
}

/** Rebind the public query observer whenever Auth clears its shared query cache. */
export function useAcademyBrandingQuery() {
  const { session } = useAuth();
  const boundary = sessionCacheBoundary(session?.access_token);
  return queryOptions({
    queryKey: [
      "academy-public-branding",
      installationBrand.installationId,
      session?.user.id,
      boundary,
    ],
    staleTime: 30_000,
    retry: false,
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("academy_public_branding", {}, { get: true })
        .abortSignal(signal);
      if (error) throw error;
      return verifyBranding(data);
    },
  });
}

export async function saveAcademyBranding(
  version: number,
  values: AcademyBrandingValues,
) {
  requireOnline();
  const { data, error } = await db().rpc("save_academy_public_branding", {
    p_expected_version: version,
    p_name: values.name,
    p_short_name: values.short_name,
    p_theme_color: values.theme_color,
  });
  if (error) throw error;
  return verifyBranding(data);
}

export const AcademyBrandContext = createContext(installationBrand);
export const useAcademyBrand = () => useContext(AcademyBrandContext);
