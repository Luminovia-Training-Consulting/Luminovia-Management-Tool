import { queryOptions } from "@tanstack/react-query";
import { installationBrand } from "../../lib/installation-brand";
import { db } from "../../lib/supabase";
import { useAuth } from "../auth/auth-context";
import { sessionCacheBoundary } from "../auth/session-cache-boundary";
import { academyBrandLinkSettings } from "./academy-brand-links-schema";

export function verifyAcademyBrandLinks(value: unknown) {
  const result = academyBrandLinkSettings.parse(value);
  if (result.installation_id !== installationBrand.installationId) {
    throw new Error("academy_brand_links_unavailable");
  }
  return result;
}

export function useAcademyBrandLinksQuery() {
  const { session } = useAuth();
  return queryOptions({
    queryKey: [
      "academy-public-brand-links",
      installationBrand.installationId,
      session?.user.id,
      sessionCacheBoundary(session?.access_token),
    ],
    staleTime: 30_000,
    retry: false,
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("academy_public_brand_links", {}, { get: true })
        .abortSignal(signal);
      if (error) throw error;
      return verifyAcademyBrandLinks(data);
    },
  });
}
