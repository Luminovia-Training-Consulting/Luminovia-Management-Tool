import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useEffect, useMemo } from "react";
import { installationBrand } from "../../lib/installation-brand";
import { useOnline } from "../../lib/online";
import { isConfigured } from "../../lib/supabase";
import {
  AcademyBrandContext,
  useAcademyBrandingQuery,
} from "./academy-branding";
import { useAcademyLogoPng } from "./academy-logo";

export function AcademyBrandProvider({ children }: { children: ReactNode }) {
  const online = useOnline();
  const logo = useAcademyLogoPng();
  const branding = useQuery({
    ...useAcademyBrandingQuery(),
    enabled:
      online && isConfigured && Boolean(installationBrand.installationId),
  });
  const brand = useMemo(
    () => ({
      ...installationBrand,
      name: branding.data?.name ?? installationBrand.name,
      shortName: branding.data?.short_name ?? installationBrand.shortName,
      themeColor: branding.data?.theme_color ?? installationBrand.themeColor,
    }),
    [branding.data],
  );
  useEffect(() => {
    document.title = brand.name;
    document.documentElement.style.setProperty(
      "--portal-mobile-brand",
      JSON.stringify(brand.shortName),
    );
    document.documentElement.style.setProperty(
      "--academy-accent",
      brand.themeColor,
    );
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", brand.themeColor);
  }, [brand]);
  useEffect(() => {
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!icon) return;
    icon.href = logo
      ? `data:image/png;base64,${logo}`
      : installationBrand.favicon;
    return () => {
      icon.href = installationBrand.favicon;
    };
  }, [logo]);
  return <AcademyBrandContext value={brand}>{children}</AcademyBrandContext>;
}
