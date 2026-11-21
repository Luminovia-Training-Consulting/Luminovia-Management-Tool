/** Public, build-bound visual choices. Only the database authorises private operations. */
export type InstallationEdition =
  "internal" | "customer-self-hosted" | "customer-managed";
export type InstallationTheme = "light" | "dark" | "system";

export type InstallationBrand = {
  edition: InstallationEdition;
  installationId: string | null;
  name: string;
  shortName: string;
  logo: string;
  mark: string;
  favicon: string;
  appleTouchIcon: string;
  pwaIcons: readonly {
    src: string;
    sizes: string;
    type: string;
    purpose?: "maskable";
  }[];
  defaultLanguage: "de" | "en";
  defaultTheme: InstallationTheme;
  themeColor: string;
};

export const internalInstallationBrand = {
  edition: "internal",
  installationId: null,
  name: "Luminovia Portal",
  shortName: "Luminovia",
  logo: "/brand/luminovia-logo-full.webp",
  mark: "/brand/luminovia-logo-mark-160.webp",
  favicon: "/icons/icon-192.png",
  appleTouchIcon: "/icons/apple-touch-icon.png",
  pwaIcons: [
    { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    {
      src: "/icons/maskable-512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable",
    },
  ],
  defaultLanguage: "de",
  defaultTheme: "system",
  themeColor: "#172b4b",
} as const satisfies InstallationBrand;

declare const __PORTAL_INSTALLATION_BRAND__: InstallationBrand | undefined;

/** Vite injects only validated public fields. Node-based source tools retain the internal defaults. */
export const installationBrand =
  typeof __PORTAL_INSTALLATION_BRAND__ === "undefined"
    ? internalInstallationBrand
    : __PORTAL_INSTALLATION_BRAND__;

declare const __PORTAL_INTERNAL_EDITION__: boolean;
export const portalInternalEdition =
  typeof __PORTAL_INTERNAL_EDITION__ === "undefined" ||
  __PORTAL_INTERNAL_EDITION__;
