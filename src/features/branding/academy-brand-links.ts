import { queryOptions } from "@tanstack/react-query";
import { installationBrand } from "../../lib/installation-brand";
import { requireOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import { useAuth } from "../auth/auth-context";
import { sessionCacheBoundary } from "../auth/session-cache-boundary";
import {
  academyBrandLinkRequest,
  academyBrandLinkSettings,
  type AcademyBrandLinks,
} from "./academy-brand-links-schema";

function verifyLinks(value: unknown) {
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
      return verifyLinks(data);
    },
  });
}

export async function saveAcademyBrandLinks(
  version: number,
  links: AcademyBrandLinks,
) {
  requireOnline();
  const request = academyBrandLinkRequest.parse({
    p_expected_version: version,
    p_support_url: links.support_url,
    p_privacy_url: links.privacy_url,
    p_legal_url: links.legal_url,
    p_terms_url: links.terms_url,
  });
  const { data, error } = await db().rpc(
    "save_academy_public_brand_links",
    request,
  );
  if (error) throw error;
  return verifyLinks(data);
}
