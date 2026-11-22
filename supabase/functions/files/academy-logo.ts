import { validateAvatar } from "./avatar.ts";

export const logoMaxBytes = 256 * 1024;

export function academyLogoVersion(params: URLSearchParams) {
  return academyAssetVersion(params, "academy-logo");
}

export function academyAssetVersion(
  params: URLSearchParams,
  mode: "academy-logo" | "academy-pwa-icon",
) {
  const version = params.get("expected_version");
  if (
    params.size !== 2 || params.get("mode") !== mode ||
    version === null || !/^(0|[1-9]\d{0,9})$/.test(version)
  ) {
    return null;
  }
  const parsed = Number(version);
  return parsed <= 2_147_483_647 ? parsed : null;
}

export async function verifyAcademyLogo(
  bytes: Uint8Array,
  scanner: (buffer: Uint8Array) => Promise<{ clean: boolean; version: string }>,
) {
  try {
    await validateAvatar(bytes, logoMaxBytes + 1);
  } catch {
    return 415;
  }
  try {
    const result = await scanner(bytes);
    if (!result.clean) return 422;
    if (!result.version || result.version.length > 160) return 503;
    return { version: result.version };
  } catch {
    return 503;
  }
}
