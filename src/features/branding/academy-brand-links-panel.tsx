import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { installationBrand } from "../../lib/installation-brand";
import { useOnline } from "../../lib/online";
import { isConfigured } from "../../lib/supabase";
import { academyPublicLinkFields } from "./academy-brand-links-schema";
import { useAcademyBrandLinksQuery } from "./academy-brand-links";

function useWord() {
  const { i18n } = useTranslation();
  return (de: string, en: string) => (i18n.language.startsWith("de") ? de : en);
}

export function AcademyBrandLinksFooter() {
  const word = useWord();
  const online = useOnline();
  const links = useQuery({
    ...useAcademyBrandLinksQuery(),
    enabled:
      online && isConfigured && Boolean(installationBrand.installationId),
  });
  const current = links.data;
  if (!current || !academyPublicLinkFields.some(([key]) => current[key]))
    return null;
  return (
    <footer className="academy-public-links">
      <nav
        aria-label={word(
          "Support und Rechtliches",
          "Support and legal information",
        )}
      >
        {academyPublicLinkFields.map(([key, de, en]) => {
          const href = current[key];
          return href ? (
            <a key={key} href={href} target="_blank" rel="noopener noreferrer">
              {word(de, en)}
            </a>
          ) : null;
        })}
      </nav>
    </footer>
  );
}
