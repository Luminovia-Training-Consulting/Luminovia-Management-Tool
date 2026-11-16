/** Real file discovery, quarantine scan, exact bytes and private organisation in the canonical disposable stack. */
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { actor, api, checked, login } from "./helpers/accounts-support";
test.skip(
  process.env.PORTAL_TEST_MODE !== "1",
  "File discovery fixtures require the canonical disposable stack.",
);
test("file discovery pages, scans, privately organises and downloads unchanged bytes in both languages", async ({
  page,
  browser,
  context,
}, testInfo) => {
  test.setTimeout(120000);
  const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!),
    owner = await actor("Fictional file discovery owner", "lecturer"),
    peer = await actor("Fictional file discovery peer", "lecturer"),
    token = randomUUID().slice(0, 8),
    prefix = `Discovery-${token}`,
    name = `${prefix}-scanned.txt`,
    contents = Buffer.from(
      "Fictional scanned course handout; personal tags must not change these bytes.",
    );
  const rows = Array.from({ length: 84 }, (_, i) => ({
    id: randomUUID(),
    owner_id: owner.id,
    uploaded_by: owner.id,
    scope: "personal",
    kind: "material",
    original_name: `${prefix}-${String(i).padStart(3, "0")}.txt`,
    mime_type: "text/plain",
    size_bytes: 100,
    client_id: randomUUID(),
    created_at: new Date(Date.now() - (i + 1) * 1000).toISOString(),
  }));
  await checked(service.from("documents").insert(rows));
  let peerContext: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  try {
    await login(page, owner.email);
    await page.goto(`/files?q=${prefix}`);
    await expect(
      page.getByRole("searchbox", { name: "Dateien suchen", exact: true }),
    ).toHaveValue(prefix);
    await expect(
      page.getByText("40 Dateien geladen", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Weitere Dateien laden", exact: true })
      .click();
    await expect(
      page.getByText("80 Dateien geladen", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Weitere Dateien laden", exact: true })
      .click();
    await expect(
      page.getByText("84 Dateien geladen", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(rows[83].original_name, { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Datei hochladen", exact: true })
      .click();
    const upload = page.getByRole("dialog");
    await upload
      .getByLabel("Datei auswählen", { exact: true })
      .setInputFiles({ name, mimeType: "text/plain", buffer: contents });
    await upload
      .getByRole("button", { name: "Datei hochladen", exact: true })
      .click();
    await expect(upload).not.toBeVisible({ timeout: 45000 });
    const file = () =>
      page
        .getByRole("listitem")
        .filter({ has: page.getByText(name, { exact: true }) });
    await expect(file().getByText("Geprüft", { exact: true })).toBeVisible();
    await file()
      .getByRole("button", {
        name: `Persönlich organisieren: ${name}`,
        exact: true,
      })
      .click();
    const editor = page.getByRole("dialog"),
      tag = `Teaching-${token}`,
      folder = `Course-${token}-${"Preparation".repeat(5)}`;
    await editor
      .getByLabel("Eigene Tags", { exact: true })
      .fill(`${tag}\nLinux`);
    await editor
      .getByLabel("Eigener virtueller Ordner", { exact: true })
      .fill(folder);
    await page.getByLabel("Sprache", { exact: true }).selectOption("en");
    await expect(editor.getByLabel("Your tags", { exact: true })).toHaveValue(
      `${tag}\nLinux`,
    );
    await editor
      .getByRole("button", { name: "Save my organisation", exact: true })
      .click();
    await expect(editor).not.toBeVisible();
    await page.getByLabel("Filter by your tag", { exact: true }).fill(tag);
    await page
      .getByLabel("Filter by your folder", { exact: true })
      .fill(folder);
    await expect(
      page.getByText("1 file loaded", { exact: true }),
    ).toBeVisible();
    await expect(file().getByText(tag, { exact: true })).toBeVisible();
    const pendingDownload = page.waitForEvent("download");
    await file()
      .getByRole("button", { name: `Download: ${name}`, exact: true })
      .click();
    const download = await pendingDownload;
    expect(await download.failure()).toBeNull();
    expect(await readFile((await download.path())!)).toEqual(contents);
    await page.getByLabel("Theme", { exact: true }).selectOption("dark");
    await page.evaluate(() => document.fonts.ready);
    const a11y = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(
      a11y.violations.map(({ id, nodes }) => ({
        id,
        targets: nodes.map((node) => node.target),
      })),
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `docs/screenshots/${testInfo.project.name}-file-discovery.png`,
      fullPage: true,
    });
    peerContext = await browser.newContext({ viewport: page.viewportSize() });
    const other = await peerContext.newPage();
    await login(other, peer.email);
    await other.goto("/files");
    await other.getByLabel("Eigenes Tag filtern", { exact: true }).fill(tag);
    await expect(
      other.getByText("Noch keine Dateien vorhanden.", { exact: true }),
    ).toBeVisible();
    await expect(other.getByText(name, { exact: true })).toHaveCount(0);
    await context.setOffline(true);
    await expect(
      page.getByRole("button", {
        name: `Organise for me: ${name}`,
        exact: true,
      }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Refresh file list", exact: true }),
    ).toBeDisabled();
    await context.setOffline(false);
    await page.reload();
    await page.getByLabel("Filter by your tag", { exact: true }).fill(tag);
    // The tag exists in the unfiltered row too. Wait for the debounced server
    // filter before opening native details, which a pending row remount closes.
    await expect(
      page.getByText("1 file loaded", { exact: true }),
    ).toBeVisible();
    await expect(file().getByText(tag, { exact: true })).toBeVisible();
    await file().getByLabel(`File name: ${name}`, { exact: true }).click();
    await file().getByRole("button", { name: "Archive", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Archive", exact: true })
      .click();
    await expect(page.getByText(name, { exact: true })).toHaveCount(0);
  } finally {
    await context.setOffline(false);
    await peerContext?.close();
  }
});
