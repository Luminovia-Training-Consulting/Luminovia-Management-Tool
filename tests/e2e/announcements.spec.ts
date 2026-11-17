import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import {
  actor,
  api,
  checked,
  login,
  adminLogin,
} from "./helpers/accounts-support";

test.skip(
  process.env.PORTAL_TEST_MODE !== "1",
  "Announcement fixtures belong only to the canonical disposable project.",
);
async function reader(user: { email: string }) {
  const client = api(process.env.SUPABASE_ANON_KEY!);
  await checked(
    client.auth.signInWithPassword({
      email: user.email,
      password: process.env.E2E_PASSWORD!,
    }),
  );
  return client;
}
async function a11y(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    result.violations.map((item) => ({
      id: item.id,
      targets: item.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}
async function fillDraft(page: Page, title: string, english: string) {
  await page
    .getByRole("button", { name: "Ankündigung erstellen", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Titel auf Deutsch", { exact: true }).fill(title);
  await dialog.getByLabel("Titel auf Englisch", { exact: true }).fill(english);
  await dialog
    .getByLabel("Inhalt auf Deutsch", { exact: true })
    .fill(`Fiktiver Hinweis ${title} <script> als Text.`);
  await dialog
    .getByLabel("Inhalt auf Englisch", { exact: true })
    .fill(`Fictional notice ${english} <script> as text.`);
  return dialog;
}
test("password-only authentication administration publishes bilingual revisions; saved drafts stay private and revision ACKs reveal a later publication", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(120000);
  const token = randomUUID().slice(0, 8),
    admin = await actor(`Announcement Admin ${token}`, "admin"),
    teacher = await actor(`Announcement Reader ${token}`, "lecturer");
  const teacherApi = await reader(teacher),
    context = await browser.newContext({
      baseURL: process.env.E2E_BASE_URL,
      viewport: testInfo.project.use.viewport,
      isMobile: testInfo.project.use.isMobile,
      hasTouch: testInfo.project.use.hasTouch,
    });
  try {
    await adminLogin(page, admin);
    await page.goto("/admin/announcements");
    const title = `Fiktive Portalnachricht ${token}`,
      english = `Fictional portal notice ${token}`;
    const dialog = await fillDraft(page, title, english);
    await dialog
      .getByRole("checkbox", { name: "Wichtig", exact: true })
      .check();
    await dialog
      .getByRole("checkbox", { name: "Dozierende", exact: true })
      .check();
    await dialog
      .getByRole("button", { name: "Entwurf speichern", exact: true })
      .click();
    await expect(dialog).toBeHidden();
    expect(
      (await checked(teacherApi.rpc("announcements", { p_search: token })))
        .items,
    ).toEqual([]);
    let row = page
      .getByRole("article")
      .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
    await row
      .getByRole("button", { name: "Jetzt veröffentlichen", exact: true })
      .click();
    await expect(
      row.getByText("Veröffentlicht", { exact: true }),
    ).toBeVisible();
    const original = (
      await checked(teacherApi.rpc("announcements", { p_search: token }))
    ).items[0];
    expect(original.title_de).toBe(title);
    const viewer = await context.newPage();
    await login(viewer, teacher.email);
    let banners = viewer.getByRole("region", {
      name: "Ankündigungen",
      exact: true,
    });
    await expect(
      banners.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    expect(await banners.locator("script").count()).toBe(0);
    await banners
      .getByRole("article")
      .filter({
        has: viewer.getByRole("heading", { name: title, exact: true }),
      })
      .getByRole("button", { name: "Gelesen, ausblenden", exact: true })
      .click();
    await expect(
      viewer.getByRole("heading", { name: title, exact: true }),
    ).toHaveCount(0);
    await row
      .getByRole("button", { name: "Entwurf bearbeiten", exact: true })
      .click();
    const edit = page.getByRole("dialog"),
      v2 = `Neue Portalrevision ${token}`,
      englishV2 = `New portal revision ${token}`;
    await edit.getByLabel("Titel auf Deutsch", { exact: true }).fill(v2);
    await edit
      .getByLabel("Titel auf Englisch", { exact: true })
      .fill(englishV2);
    await edit
      .getByLabel("Inhalt auf Deutsch", { exact: true })
      .fill(`Unveröffentlichter Entwurf ${token}`);
    await edit
      .getByRole("button", { name: "Entwurf speichern", exact: true })
      .click();
    await expect(edit).toBeHidden();
    const unchanged = (
      await checked(teacherApi.rpc("announcements", { p_search: token }))
    ).items[0];
    expect(unchanged.id).toBe(original.id);
    expect(unchanged.body_de).toBe(original.body_de);
    await viewer.goto("/announcements");
    await expect(
      viewer.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await expect(
      viewer.getByText(`Unveröffentlichter Entwurf ${token}`, { exact: true }),
    ).toHaveCount(0);
    row = page
      .getByRole("article")
      .filter({ has: page.getByRole("heading", { name: v2, exact: true }) });
    await row
      .getByRole("button", { name: "Jetzt veröffentlichen", exact: true })
      .click();
    await expect
      .poll(async () =>
        (
          await checked(teacherApi.rpc("announcements", { p_search: token }))
        ).items.map((item: { title_de: string }) => item.title_de),
      )
      .toContain(v2);
    await viewer.goto("/");
    banners = viewer.getByRole("region", {
      name: "Ankündigungen",
      exact: true,
    });
    await expect(
      banners.getByRole("heading", { name: v2, exact: true }),
    ).toBeVisible();
    await viewer.getByLabel("Sprache", { exact: true }).selectOption("en");
    await viewer.getByLabel("Theme", { exact: true }).selectOption("dark");
    await expect(
      viewer.getByRole("heading", { name: englishV2, exact: true }),
    ).toBeVisible();
    await a11y(viewer);
    await viewer.screenshot({
      path: `.local/screenshots/${testInfo.project.name}-announcements.png`,
      fullPage: true,
    });
    await row.getByRole("button", { name: "Archivieren", exact: true }).click();
    await expect(row.getByText("Archiviert", { exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});

test("future publication remains manual; archive/recover and an informational publication work without an inbox event", async ({
  page,
}) => {
  test.setTimeout(100000);
  const token = randomUUID().slice(0, 8),
    admin = await actor(`Announcement Operator ${token}`, "admin"),
    teacher = await actor(`Announcement Info Reader ${token}`, "lecturer"),
    teacherApi = await reader(teacher);
  await adminLogin(page, admin);
  await page.goto("/admin/announcements");
  const title = `Fiktive Zukunftsinfo ${token}`,
    dialog = await fillDraft(
      page,
      title,
      `Fictional future information ${token}`,
    );
  await dialog
    .getByLabel("Anzeigen ab", { exact: true })
    .fill(new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 16));
  await dialog
    .getByLabel("Anzeigen bis", { exact: true })
    .fill(new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 16));
  await dialog
    .getByRole("button", { name: "Entwurf speichern", exact: true })
    .click();
  await expect(dialog).toBeHidden();
  const row = page
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
  await row
    .getByRole("button", { name: "Jetzt veröffentlichen", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "manuelle Veröffentlichung",
  );
  expect(
    (await checked(teacherApi.rpc("announcements", { p_search: token }))).items,
  ).toEqual([]);
  await row.getByRole("button", { name: "Archivieren", exact: true }).click();
  await expect(row.getByText("Archiviert", { exact: true })).toBeVisible();
  await row
    .getByRole("button", { name: "Wiederherstellen", exact: true })
    .click();
  await expect(row.getByText("Entwurf", { exact: true })).toBeVisible();
  await row
    .getByRole("button", { name: "Entwurf bearbeiten", exact: true })
    .click();
  const edit = page.getByRole("dialog");
  await edit
    .getByLabel("Anzeigen ab", { exact: true })
    .fill(new Date(Date.now() - 3600000).toISOString().slice(0, 16));
  await edit
    .getByRole("button", { name: "Entwurf speichern", exact: true })
    .click();
  await expect(edit).toBeHidden();
  await row
    .getByRole("button", { name: "Jetzt veröffentlichen", exact: true })
    .click();
  await expect(row.getByText("Veröffentlicht", { exact: true })).toBeVisible();
  const info = (
    await checked(teacherApi.rpc("announcements", { p_search: token }))
  ).items[0];
  expect(info.important).toBe(false);
  expect(
    await checked(
      teacherApi
        .from("notifications")
        .select("id")
        .eq("kind", "portal_announcement")
        .eq("resource_id", info.id),
    ),
  ).toEqual([]);
  await row.getByRole("button", { name: "Archivieren", exact: true }).click();
  await expect(row.getByText("Archiviert", { exact: true })).toBeVisible();
});
