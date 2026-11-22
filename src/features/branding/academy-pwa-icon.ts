import { queryOptions } from "@tanstack/react-query";
import { validateAvatar } from "../../../supabase/functions/files/avatar";
import { installationBrand } from "../../lib/installation-brand";
import { requireOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import { academyLogoVersion } from "./academy-logo-schema";
import { academyPwaIcon } from "./academy-pwa-icon-schema";

const variants = {
  icon_192: { side: 192, limit: 262_144 },
  icon_512: { side: 512, limit: 1_000_000 },
  maskable_512: { side: 512, limit: 1_000_000 },
} as const;

type Variant = keyof typeof variants;
export type AcademyPwaImages = Record<Variant, Blob>;

function verifyIcon(value: unknown) {
  const result = academyPwaIcon.parse(value);
  if (result.installation_id !== installationBrand.installationId)
    throw new Error("academy_pwa_icon_unavailable");
  return result;
}

export function academyPwaIconQuery() {
  return queryOptions({
    queryKey: ["academy-pwa-icon", installationBrand.installationId],
    staleTime: 30_000,
    retry: false,
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("academy_pwa_icon", {}, { get: true })
        .abortSignal(signal);
      if (error) throw error;
      return verifyIcon(data);
    },
  });
}

function fileEndpoint() {
  return new URL(
    `${import.meta.env.VITE_SUPABASE_URL.replace(/\/$/, "")}/functions/v1/files`,
    location.origin,
  );
}

export function publishedAcademyPwaIcon(version: number) {
  const endpoint = new URL("/backend/functions/v1/files", location.origin);
  endpoint.searchParams.set("mode", "academy-pwa-image");
  endpoint.searchParams.set("variant", "icon_512");
  endpoint.searchParams.set("version", String(version));
  return endpoint.href;
}

export async function saveAcademyPwaIcon(
  version: number,
  images: AcademyPwaImages | null,
) {
  requireOnline();
  const expectedVersion = academyLogoVersion.parse(version);
  if (!images) {
    const { data, error } = await db().rpc("clear_academy_pwa_icon", {
      p_expected_version: expectedVersion,
    });
    if (error) throw error;
    return verifyIcon(data);
  }
  const { data, error } = await db().auth.getSession();
  if (error || !data.session) throw new Error("access_denied");
  const endpoint = fileEndpoint();
  endpoint.searchParams.set("mode", "academy-pwa-icon");
  endpoint.searchParams.set("expected_version", String(expectedVersion));
  const form = new FormData();
  for (const [variant, image] of Object.entries(images))
    form.set(variant, image, `${variant}.png`);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    },
    cache: "no-store",
    body: form,
  });
  if (response.status === 409)
    throw Object.assign(new Error("icon_changed"), { code: "PT409" });
  if (!response.ok) throw new Error("icon_upload_failed");
  return verifyIcon(await response.json());
}

/** Create ordinary sizes and fit the logo inside the maskable safe area. */
export async function prepareAcademyPwaImages(
  file: File,
  themeColor: string,
): Promise<AcademyPwaImages> {
  if (file.type !== "image/png" || file.size > variants.icon_512.limit)
    throw new Error("invalid_icon");
  const { width, height } = await validateAvatar(
    new Uint8Array(await file.arrayBuffer()),
    variants.icon_512.limit + 1,
  );
  if (width !== 512 || height !== 512) throw new Error("invalid_icon");
  const image = await createImageBitmap(file);
  try {
    async function render(variant: Exclude<Variant, "icon_512">) {
      const { side, limit } = variants[variant];
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = side;
      const context = canvas.getContext("2d", {
        alpha: variant !== "maskable_512",
      });
      if (!context) throw new Error("invalid_icon");
      if (variant === "maskable_512") {
        context.fillStyle = themeColor;
        context.fillRect(0, 0, side, side);
        // The full square fits inside the central circle with a radius of 40%.
        const inset = side * 0.23;
        context.drawImage(
          image,
          inset,
          inset,
          side - 2 * inset,
          side - 2 * inset,
        );
      } else {
        context.drawImage(image, 0, 0, side, side);
      }
      const result = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      if (!result || result.size > limit) throw new Error("invalid_icon");
      return result;
    }
    const [small, maskable] = await Promise.all([
      render("icon_192"),
      render("maskable_512"),
    ]);
    return { icon_192: small, icon_512: file, maskable_512: maskable };
  } finally {
    image.close();
  }
}
