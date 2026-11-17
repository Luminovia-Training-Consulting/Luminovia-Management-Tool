/**
 * Browser workflows for canonical scanned avatars after actual image processing.
 * Rendered workflows are checked in isolation; this does not replace manual device/platform acceptance.
 */
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { actor, api, checked, login } from "./helpers/accounts-support";

test.skip(
  process.env.PORTAL_TEST_MODE !== "1",
  "Avatar integration requires isolated ./portal test.",
);
test("profile picture is rasterised, scanned, retained across reload and visible only through profile access", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(120000);
  const teacher = await actor(
    `Avatar Teacher ${randomUUID().slice(0, 8)}`,
    "lecturer",
  );
  const peer = await actor(
    `Avatar Peer ${randomUUID().slice(0, 8)}`,
    "lecturer",
  );
  const secret = "Fictional private source metadata";
  const input = await sharp({
    create: { width: 1000, height: 800, channels: 3, background: "#1749b5" },
  })
    .withMetadata({ exif: { IFD0: { Artist: secret } } })
    .jpeg()
    .toBuffer();
  expect((await sharp(input).metadata()).exif).toBeTruthy();
  await login(page, teacher.email);
  await page.goto("/profile");
  const editor = page.locator(".avatar-editor");
  const [picker] = await Promise.all([
    page.waitForEvent("filechooser"),
    editor
      .getByRole("button", { name: "Profilbild auswählen", exact: true })
      .click(),
  ]);
  await picker.setFiles({
    name: "source-with-metadata.jpg",
    mimeType: "image/jpeg",
    buffer: input,
  });
  await expect(editor.getByRole("status")).toContainText(
    "Profilbild gespeichert.",
    { timeout: 30000 },
  );
  const picture = editor.locator("img");
  await expect(picture).toHaveAttribute("src", /^blob:/);
  await expect
    .poll(() =>
      picture.evaluate((element: HTMLImageElement) => [
        element.naturalWidth,
        element.naturalHeight,
      ]),
    )
    .toEqual([480, 480]);
  await page.reload();
  await expect(editor.locator("img")).toHaveAttribute("src", /^blob:/);
  await expect
    .poll(() =>
      editor
        .locator("img")
        .evaluate((element: HTMLImageElement) => element.naturalWidth),
    )
    .toBe(480);
  const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const selected = await checked(
    service
      .from("profile_avatars")
      .select("document_version_id")
      .eq("user_id", teacher.id)
      .single(),
  );
  const version = await checked(
    service
      .from("document_versions")
      .select("object_path,scanner_version,mime_type")
      .eq("id", selected.document_version_id)
      .single(),
  );
  expect(version.scanner_version).toMatch(/^ClamAV /);
  expect(version.mime_type).toBe("image/png");
  const stored = await checked(
    service.storage.from("portal-clean").download(version.object_path),
  );
  const bytes = Buffer.from(await stored.arrayBuffer());
  const metadata = await sharp(bytes).metadata();
  expect(metadata.exif).toBeUndefined();
  expect(metadata.icc).toBeUndefined();
  expect(bytes.includes(Buffer.from(secret))).toBe(false);
  // A malformed source is rejected without displacing the confirmed picture.
  const [invalidPicker] = await Promise.all([
    page.waitForEvent("filechooser"),
    editor
      .getByRole("button", { name: "Profilbild auswählen", exact: true })
      .click(),
  ]);
  await invalidPicker.setFiles({
    name: "forged.png",
    mimeType: "image/png",
    buffer: Buffer.from("not an image"),
  });
  await expect(editor.getByRole("alert")).toBeVisible();
  await expect(editor.locator("img")).toHaveAttribute("src", /^blob:/);
  const peerContext = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL!,
    viewport: testInfo.project.use.viewport,
    isMobile: testInfo.project.use.isMobile,
    hasTouch: testInfo.project.use.hasTouch,
  });
  try {
    const peerPage = await peerContext.newPage();
    await login(peerPage, peer.email);
    await peerPage.goto(`/people/${teacher.id}`);
    const peerPicture = peerPage.locator(".profile-avatar-large img");
    await expect(peerPicture).toHaveAttribute("src", /^blob:/);
    await expect
      .poll(() =>
        peerPicture.evaluate(
          (element: HTMLImageElement) => element.naturalWidth,
        ),
      )
      .toBe(480);
    await page.getByLabel("Sprache", { exact: true }).selectOption("en");
    await expect(
      editor.getByRole("heading", { name: "Profile picture", exact: true }),
    ).toBeVisible();
    await page.getByLabel("Theme", { exact: true }).selectOption("dark");
    await page.evaluate(() => document.fonts.ready);
    const scan = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(
      scan.violations.map((item) => ({
        id: item.id,
        nodes: item.nodes.map((node) => node.target),
      })),
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `.local/screenshots/${testInfo.project.name}-profile-avatar.png`,
      fullPage: true,
    });
    await editor
      .getByRole("button", { name: "Remove profile picture", exact: true })
      .click();
    await expect(editor.getByRole("status")).toContainText(
      "Profile picture removed.",
    );
    await expect(editor.locator("img")).toBeHidden();
    await peerPage.reload();
    await expect(peerPage.locator(".profile-avatar-large img")).toBeHidden();
    await expect(
      peerPage.getByRole("img", {
        name: `Profilbild von ${teacher.name}`,
        exact: true,
      }),
    ).toBeVisible();
  } finally {
    await peerContext.close();
  }
});
