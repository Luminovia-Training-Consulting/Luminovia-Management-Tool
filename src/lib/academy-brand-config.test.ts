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

it.each(["customer-managed", "customer-self-hosted"])(
  "prepares the signed notification title for the %s worker",
  (edition) => {
    const shortName = 'Example "A" & Co';
    writeFileSync(config, JSON.stringify({ ...settings, edition, shortName }));
    const worker = load().assets.get("push-sw.js")?.toString("utf8");
    expect(worker?.split("\n")[0]).toBe(
      `const PORTAL_PUSH_TITLE = ${JSON.stringify(shortName)};`,
    );
    expect(worker).toContain("showNotification(notificationTitle,");
  },
);

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
  const paths = Object.keys(document.paths).filter(
    (path) => !path.startsWith("/functions/v1/portal-api/v1/"),
  );
  expect(paths).toHaveLength(143);
  expect(paths).toContain("/rest/v1/rpc/academy_learning_action");
  expect(paths).toContain("/rest/v1/rpc/learning_portfolio");
  expect(paths).toContain("/rest/v1/rpc/learning_portfolio_command");
  expect(paths).toContain("/rest/v1/rpc/course_material_metadata_history");
  expect(paths).toContain("/rest/v1/rpc/set_learning_program_prerequisite");
  expect(paths).toContain("/rest/v1/rpc/course_completion_status");
  expect(paths).toContain("/rest/v1/rpc/course_gradebook");
  expect(paths).toContain("/rest/v1/rpc/course_gradebook_history");
  expect(paths).toContain("/rest/v1/rpc/course_gradebook_export");
  expect(paths).toContain("/rest/v1/rpc/admin_audit_events");
  expect(paths).toContain("/rest/v1/rpc/clear_administration_activity");
  expect(paths).toContain("/rest/v1/rpc/save_academy_white_label");
  expect(paths).toEqual(
    expect.arrayContaining([
      "/rest/v1/rpc/course_exam_state",
      "/rest/v1/rpc/published_course_exam_results",
      "/rest/v1/rpc/save_course_exam_grades",
      "/rest/v1/rpc/save_course_exam_schedule",
      "/rest/v1/rpc/submit_course_exam",
    ]),
  );
  expect(paths).toContain("/rest/v1/rpc/learning_analytics_access");
  expect(paths).toContain("/rest/v1/rpc/learning_analytics_report");
  expect(paths).toContain("/rest/v1/rpc/course_submissions");
  expect(paths).toContain("/rest/v1/rpc/academy_licence_receipt");
  expect(paths).toContain("/rest/v1/rpc/academy_support_access");
  expect(paths).toContain("/rest/v1/rpc/installation_capabilities");
  expect(paths).toContain("/rest/v1/rpc/course_workspace");
  expect(paths).toContain("/rest/v1/rpc/search_course_materials");
  expect(paths).toContain("/rest/v1/rpc/set_course_material_metadata");
  expect(paths).toContain("/rest/v1/rpc/import_table_row");
  expect(
    paths.filter((path) => !path.startsWith("/rest/v1/rpc/")).sort(),
  ).toEqual([
    "/functions/v1/accounts/v1/academy/company-invitations",
    "/functions/v1/accounts/v1/academy/invitations/{id}/retry",
    "/functions/v1/accounts/v1/academy/users",
    "/functions/v1/company-integration",
    "/functions/v1/company-integration/enrolments",
    "/functions/v1/company-integration/participation",
    "/functions/v1/course-documents",
    "/functions/v1/files",
    "/functions/v1/human-login",
    "/functions/v1/mail-admin",
  ]);
  expect(paths).toContain("/rest/v1/rpc/academy_course_material_action");
  expect(paths).toContain("/rest/v1/rpc/course_attendance_summary");
  expect(paths).toContain("/rest/v1/rpc/remove_course_exam_pdf");
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
