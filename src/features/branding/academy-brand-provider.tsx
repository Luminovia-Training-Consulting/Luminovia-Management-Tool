import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useLayoutEffect, useMemo } from "react";
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
  useLayoutEffect(() => {
    const { style } = document.documentElement;
    const theme = document.querySelector('meta[name="theme-color"]');
    const previousTitle = document.title;
    const previousTheme = theme?.getAttribute("content");
    const previousStyles = ["--portal-mobile-brand", "--academy-accent"].map(
      (name) => [
        name,
        style.getPropertyValue(name),
        style.getPropertyPriority(name),
      ],
    );
    document.title = brand.name;
    style.setProperty("--portal-mobile-brand", JSON.stringify(brand.shortName));
    style.setProperty("--academy-accent", brand.themeColor);
    theme?.setAttribute("content", brand.themeColor);
    // Restore the packaged branding before the public demo paints.
    return () => {
      document.title = previousTitle;
      if (previousTheme == null) theme?.removeAttribute("content");
      else theme?.setAttribute("content", previousTheme);
      for (const [name, value, priority] of previousStyles)
        style.setProperty(name, value, priority);
    };
  }, [brand]);
  useLayoutEffect(() => {
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
