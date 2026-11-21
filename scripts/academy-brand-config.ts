/** Resolve the operator-owned brand file and package an allowlist of static raster assets. */
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
  readSync,
} from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { crc32 } from "node:zlib";
import { z } from "zod";
import {
  internalInstallationBrand,
  type InstallationBrand,
} from "../src/lib/installation-brand.ts";

const MAX_CONFIG_BYTES = 16_384;
const MAX_PNG_BYTES = 2_097_152;

const humanText = (maxLength: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(maxLength)
    .regex(/^[^\p{Cc}\p{Cf}<>]+$/u);
const pngFile = z.string().regex(/^[a-zA-Z0-9_-]{1,72}\.png$/);
const customerSchema = z.strictObject({
  edition: z.enum(["customer-self-hosted", "customer-managed"]),
  installationId: z.uuid().toLowerCase(),
  name: humanText(72),
  shortName: humanText(20),
  defaultLanguage: z.enum(["de", "en"]),
  defaultTheme: z.enum(["light", "dark", "system"]),
  themeColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  files: z.strictObject({
    logo: pngFile,
    icon192: pngFile,
    icon512: pngFile,
    maskable512: pngFile,
    appleTouchIcon: pngFile,
  }),
});

const sharedAssets = [
  "brand/space-grotesk-latin-wght-normal.woff2",
  "brand/space-grotesk-OFL.txt",
  "push-sw.js",
];

/** Open only bounded regular files. A symlink may otherwise import an unintended host file. */
function readBounded(path: string, maxBytes: number) {
  const fd = openSync(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stats = fstatSync(fd);
    if (!stats.isFile() || stats.size < 1 || stats.size > maxBytes)
      throw new Error("invalid brand file size or type");
    const bytes = Buffer.alloc(stats.size + 1);
    let size = 0;
    while (size < bytes.length) {
      const count = readSync(fd, bytes, size, bytes.length - size, null);
      if (!count) break;
      size += count;
    }
    if (size !== stats.size)
      throw new Error("brand file changed while reading");
    return bytes.subarray(0, size);
  } finally {
    closeSync(fd);
  }
}

/** The package accepts PNG only and preserves render chunks while dropping metadata. */
function readPng(path: string, exactSize?: number): Buffer {
  const bytes = readBounded(path, MAX_PNG_BYTES);
  const signature = "89504e470d0a1a0a";
  if (bytes.subarray(0, 8).toString("hex") !== signature)
    throw new Error("brand image is not PNG");
  const keep = new Set([
    "IHDR",
    "PLTE",
    "IDAT",
    "IEND",
    "tRNS",
    "sRGB",
    "gAMA",
    "cHRM",
    "pHYs",
  ]);
  const parts = [bytes.subarray(0, 8)];
  let offset = 8;
  let data = false;
  while (offset + 12 <= bytes.length) {
    const size = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const next = offset + 12 + size;
    if (next > bytes.length || !/^[A-Za-z]{4}$/.test(type))
      throw new Error("invalid brand image chunk");
    if (
      crc32(bytes.subarray(offset + 4, next - 4)) !==
      bytes.readUInt32BE(next - 4)
    )
      throw new Error("invalid brand image checksum");
    if (offset === 8) {
      if (type !== "IHDR" || size !== 13)
        throw new Error("brand image lacks a PNG header");
      const width = bytes.readUInt32BE(offset + 8),
        height = bytes.readUInt32BE(offset + 12);
      if (
        width < 1 ||
        height < 1 ||
        width > 2048 ||
        height > 1024 ||
        (exactSize && (width !== exactSize || height !== exactSize))
      )
        throw new Error("invalid brand image dimensions");
    } else if (type === "IHDR")
      throw new Error("invalid repeated brand image header");
    if (!keep.has(type) && type[0] === type[0].toUpperCase())
      throw new Error("unsupported critical brand image chunk");
    if (keep.has(type)) parts.push(bytes.subarray(offset, next));
    if (type === "IDAT" && size > 0) data = true;
    if (type === "IEND") {
      if (!data || size !== 0 || next !== bytes.length)
        throw new Error("invalid brand image end");
      return Buffer.concat(parts);
    }
    offset = next;
  }
  throw new Error("brand image is incomplete");
}

/**
 * An absent config retains the existing internal installation. A customer config
 * must be explicit, complete, adjacent to its own assets and free of unknown keys.
 */
export function loadAcademyBrand(
  file: string | undefined,
  publicRoot: string,
): {
  brand: InstallationBrand;
  assets: ReadonlyMap<string, Buffer>;
} {
  const assets = new Map<string, Buffer>();
  if (file === undefined) return { brand: internalInstallationBrand, assets };
  if (!isAbsolute(file))
    throw new Error(
      "PORTAL_ACADEMY_BRAND_FILE must be an absolute local filename.",
    );
  try {
    const input = JSON.parse(
      readBounded(file, MAX_CONFIG_BYTES).toString("utf8"),
    );
    if (
      z.strictObject({ edition: z.literal("internal") }).safeParse(input)
        .success
    )
      return { brand: internalInstallationBrand, assets };
    const { files, ...settings } = customerSchema.parse(input);
    const logo = "/brand/academy-logo.png";
    const favicon = "/icons/icon-192.png";
    const appleTouchIcon = "/icons/apple-touch-icon.png";
    const pwaIcons = [
      { src: favicon, sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable" as const,
      },
    ];
    for (const [target, source, size] of [
      [logo, files.logo],
      [favicon, files.icon192, 192],
      [pwaIcons[1].src, files.icon512, 512],
      [pwaIcons[2].src, files.maskable512, 512],
      [appleTouchIcon, files.appleTouchIcon, 180],
    ] as const) {
      assets.set(target.slice(1), readPng(join(dirname(file), source), size));
    }
    for (const path of sharedAssets)
      assets.set(path, readFileSync(join(publicRoot, path)));
    return {
      brand: {
        ...settings,
        logo,
        mark: favicon,
        favicon,
        appleTouchIcon,
        pwaIcons,
      },
      assets,
    };
  } catch {
    // Build logs must neither display rejected configuration values nor expose local file paths.
    throw new Error(
      "Invalid academy brand file or image assets. Check the documented format and dimensions.",
    );
  }
}
