/** Public presentation settings are separate from the signed installation identity. */
import { queryOptions } from "@tanstack/react-query";
import { createContext, useContext } from "react";
import { installationBrand } from "../../lib/installation-brand";
import { db } from "../../lib/supabase";
import { useAuth } from "../auth/auth-context";
import { sessionCacheBoundary } from "../auth/session-cache-boundary";

import { academyBrandingSettings } from "./academy-branding-schema";

export function verifyAcademyBranding(value: unknown) {
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
      return verifyAcademyBranding(data);
    },
  });
}

export const AcademyBrandContext = createContext(installationBrand);
export const useAcademyBrand = () => useContext(AcademyBrandContext);
