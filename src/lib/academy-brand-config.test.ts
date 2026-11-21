/** Inspect only operator-owned temporary input and ensure the external package excludes vendor assets. */
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { afterEach, beforeEach, expect, it } from "vitest";
import { loadAcademyBrand } from "../../scripts/academy-brand-config";
import { portalOpenApi } from "../features/developer-api/contract";

let root: string;
let config: string;
const settings = {
  edition: "customer-managed",
  installationId: "c23c5015-398f-4d6a-9dd2-f7bb1d8b27ca",
  name: "Example & Practice Academy",
  shortName: "Example Academy",
  defaultLanguage: "en",
  defaultTheme: "dark",
  themeColor: "#102857",
  files: {
    logo: "logo.png",
    icon192: "192.png",
    icon512: "512.png",
    maskable512: "mask.png",
    appleTouchIcon: "touch.png",
  },
};

function chunk(type: string, body: Buffer) {
  const name = Buffer.from(type);
  const header = Buffer.alloc(4),
    tail = Buffer.alloc(4);
  header.writeUInt32BE(body.length);
  tail.writeUInt32BE(crc32(Buffer.concat([name, body])));
  return Buffer.concat([header, name, body, tail]);
}

function fixturePng(size: number, metadata = false) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", header),
    ...(metadata
      ? [chunk("tEXt", Buffer.from("Note\0Fictional private metadata"))]
      : []),
    chunk("IDAT", deflateSync(Buffer.alloc((3 * size + 1) * size))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function load() {
  return loadAcademyBrand(config, resolve("public"));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "academy-brand-test-"));
  config = join(root, "academy.json");
  writeFileSync(config, JSON.stringify(settings));
  for (const [name, size] of [
    ["logo.png", 240],
    ["192.png", 192],
    ["512.png", 512],
    ["mask.png", 512],
    ["touch.png", 180],
  ] as const)
    writeFileSync(join(root, name), fixturePng(size, name === "logo.png"));
});
afterEach(() => rmSync(root, { force: true, recursive: true }));

it("retains the internal brand by default", () => {
  const result = loadAcademyBrand(undefined, resolve("public"));
  expect(result.brand).toMatchObject({
    edition: "internal",
    name: "Luminovia Portal",
  });
  expect(result.assets.size).toBe(0);
});

it("packages the exact approved customer assets and its scoped licensed API", () => {
  const { brand, assets } = load();
  expect(brand).toMatchObject({
    name: settings.name,
    edition: settings.edition,
    installationId: settings.installationId,
    logo: "/brand/academy-logo.png",
    defaultLanguage: "en",
    defaultTheme: "dark",
  });
  expect(assets.has("brand/luminovia-logo-full.webp")).toBe(false);
  expect(
    assets
      .get("brand/academy-logo.png")
      ?.includes("Fictional private metadata"),
  ).toBe(false);
  const document = portalOpenApi(
    "https://example.invalid/backend",
    true,
    brand,
  );
  expect(document).toMatchObject({
    info: { title: "Example & Practice Academy API" },
    "x-portal-installation": {
      installation_id: settings.installationId,
      edition: settings.edition,
      customer_ready: false,
    },
  });
  const paths = Object.keys(document.paths);
  expect(paths).toHaveLength(17);
  expect(paths).toContain("/rest/v1/rpc/installation_capabilities");
  expect(paths).toContain("/rest/v1/rpc/course_workspace");
  expect(paths.filter((path) => !path.startsWith("/rest/v1/rpc/"))).toEqual([
    "/functions/v1/files",
  ]);
  expect(paths).toContain("/rest/v1/rpc/academy_course_material_action");
  expect(paths).not.toContain("/rest/v1/rpc/job_discovery");
});

it("rejects extra data, traversal, HTML text and incorrectly sized or corrupted PNGs", () => {
  writeFileSync(
    config,
    JSON.stringify({ ...settings, token: "fictional-private-value" }),
  );
  expect(load).toThrow(/^Invalid academy brand file or image assets/);
  writeFileSync(
    config,
    JSON.stringify({
      ...settings,
      files: { ...settings.files, logo: "../logo.png" },
    }),
  );
  expect(load).toThrow(/^Invalid academy brand file or image assets/);
  writeFileSync(
    config,
    JSON.stringify({ ...settings, name: "<script>invalid</script>" }),
  );
  expect(load).toThrow(/^Invalid academy brand file or image assets/);
  writeFileSync(config, JSON.stringify(settings));
  writeFileSync(join(root, "512.png"), fixturePng(192));
  expect(load).toThrow(/^Invalid academy brand file or image assets/);
  const corrupt = fixturePng(512);
  corrupt[corrupt.length - 1] ^= 0xff;
  writeFileSync(join(root, "512.png"), corrupt);
  expect(load).toThrow(/^Invalid academy brand file or image assets/);
});

it("won't follow a symlink to include unexpected local files", () => {
  symlinkSync(join(root, "logo.png"), join(root, "other.png"));
  writeFileSync(
    config,
    JSON.stringify({
      ...settings,
      files: { ...settings.files, logo: "other.png" },
    }),
  );
  expect(load).toThrow(/^Invalid academy brand file or image assets/);
});
