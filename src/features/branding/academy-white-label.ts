import { db } from "../../lib/supabase";
import { requireOnline } from "../../lib/online";
import { verifyAcademyBranding } from "./academy-branding";
import { verifyAcademyBrandLinks } from "./academy-brand-links";
import { type AcademyBrandingValues } from "./academy-branding-schema";
import { type AcademyBrandLinks } from "./academy-brand-links-schema";
import { academyWhiteLabelReceipt } from "./academy-white-label-schema";

export async function saveAcademyWhiteLabel(
  expectedBrandVersion: number,
  expectedLinksVersion: number,
  branding: AcademyBrandingValues,
  links: AcademyBrandLinks,
) {
  requireOnline();
  const { data, error } = await db().rpc("save_academy_white_label", {
    p_expected_brand_version: expectedBrandVersion,
    p_expected_links_version: expectedLinksVersion,
    p_name: branding.name,
    p_short_name: branding.short_name,
    p_theme_color: branding.theme_color,
    p_support_url: links.support_url,
    p_privacy_url: links.privacy_url,
    p_legal_url: links.legal_url,
    p_terms_url: links.terms_url,
  });
  if (error) throw error;
  const result = academyWhiteLabelReceipt.parse(data);
  return {
    branding: verifyAcademyBranding(result.branding),
    links: verifyAcademyBrandLinks(result.links),
  };
}
