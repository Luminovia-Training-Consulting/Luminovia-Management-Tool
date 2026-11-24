import { boundedFormData, RequestBodyTooLarge } from "../_shared/bounded-body.ts";
import { academyAssetVersion } from "./academy-logo.ts";
import { validateAvatar } from "./avatar.ts";

const variants = [
  { name: "icon_192", edge: 192, limit: 262_144 },
  { name: "icon_512", edge: 512, limit: 1_000_000 },
  { name: "maskable_512", edge: 512, limit: 1_000_000 },
] as const;
// This allows normal multipart boundaries and part headers while bounding all bytes read.
const bodyLimit = variants.reduce(
  (size, variant) => size + variant.limit,
  16_384,
);

interface ScannedIcons {
  icon_192: string;
  icon_512: string;
  maskable_512: string;
  scanners: string[];
}
interface Dependencies {
  check: (version: number) => PromiseLike<{ error: { code: string } | null }>;
  scan: (bytes: Uint8Array) => Promise<{ clean: boolean; version: string }>;
  publish: (version: number, icons: ScannedIcons) => PromiseLike<{
    data: unknown;
    error: { code: string } | null;
  }>;
}

function base64(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

/** The caller's existing authenticated gateway owns Origin, session and response headers. */
export async function uploadAcademyPwaIcon(
  request: Request,
  dependencies: Dependencies,
  json: (status: number, body: unknown) => Response,
) {
  const version = academyAssetVersion(
    new URL(request.url).searchParams,
    "academy-pwa-icon",
  );
  if (version === null) return json(400, { error: "invalid_request" });
  const contentType = request.headers.get("content-type");
  if (
    contentType?.split(";", 1)[0].trim().toLowerCase() !== "multipart/form-data"
  ) {
    return json(415, { error: "unsupported_type" });
  }
  const authorization = (error: { code: string }) =>
    error.code === "PT409"
      ? json(409, { error: "icon_changed" })
      : json(403, { error: "access_denied" });
  const before = await dependencies.check(version);
  if (before.error) return authorization(before.error);

  let form: FormData;
  try {
    form = await boundedFormData(request, bodyLimit);
  } catch (error) {
    return error instanceof RequestBodyTooLarge
      ? json(413, { error: "file_size" })
      : json(400, { error: "invalid_request" });
  }

  if (
    Array.from(form.keys()).sort().join(",") !==
      variants.map(({ name }) => name).join(",")
  ) {
    return json(400, { error: "invalid_request" });
  }
  const images: Uint8Array[] = [];
  for (const { name, edge, limit } of variants) {
    const file = form.get(name);
    if (!(file instanceof File)) return json(400, { error: "invalid_request" });
    if (file.size > limit) return json(413, { error: "file_size" });
    if (file.type !== "image/png") {
      return json(415, { error: "unsupported_type" });
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
      const { width, height } = await validateAvatar(bytes, limit + 1);
      if (width !== edge || height !== edge) {
        return json(415, { error: "invalid_icon" });
      }
    } catch {
      return json(415, { error: "invalid_icon" });
    }
    images.push(bytes);
  }

  const scanners: string[] = [];
  try {
    for (const bytes of images) {
      const verdict = await dependencies.scan(bytes);
      if (!verdict.clean) return json(422, { error: "scan_rejected" });
      if (
        !verdict.version || verdict.version.length > 160 ||
        /[\u0000-\u001f\u007f]/.test(verdict.version)
      ) {
        return json(503, { error: "scanner_unavailable" });
      }
      scanners.push(verdict.version);
    }
  } catch {
    return json(503, { error: "scanner_unavailable" });
  }
  const after = await dependencies.check(version);
  if (after.error) return authorization(after.error);
  const [icon_192, icon_512, maskable_512] = images.map(base64);
  const published = await dependencies.publish(version, {
    icon_192,
    icon_512,
    maskable_512,
    scanners,
  });
  if (published.error) {
    return ["PT409", "42501"].includes(published.error.code)
      ? authorization(published.error)
      : json(503, { error: "upload_failed" });
  }
  return json(200, published.data);
}
