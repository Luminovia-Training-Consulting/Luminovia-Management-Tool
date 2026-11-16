/**
 * Browser workflows for course source templates, planned sessions and lecturer-visible net claims.
 * Rendered workflows are checked in isolation; this does not replace manual device/platform acceptance.
 */
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { assertPointerReady } from "./helpers/pointer-readiness";
import { randomUUID } from "node:crypto";
import {
  api,
  checked,
  actor,
  login,
  adminLogin,
} from "./helpers/accounts-support";

test.skip(
  process.env.PORTAL_TEST_MODE !== "1",
  "Course writes require the canonical disposable project.",
);
/** Checks the rendered state with axe; this does not replace manual accessibility acceptance. */
async function a11y(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  const scan = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    scan.violations.map((row) => ({
      id: row.id,
      nodes: row.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}
test("Course source template plans ten real sessions and one linked net-only teaching claim", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(120000);
  const tag = randomUUID().slice(0, 8),
    admin = await actor(`Course Administration ${tag}`, "admin"),
    teacher = await actor(`Course Lecturer ${tag}`, "lecturer");
  const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const block = await checked(
    service
      .from("building_blocks")
      .select("*,building_block_sources(*)")
      .eq("code", "LPC3")
      .single(),
  );
  const primary = block.building_block_sources.find(
    (row: { is_primary: boolean }) => row.is_primary,
  );
  const org = randomUUID();
  await checked(
    service
      .from("organisations")
      .insert({ id: org, name: `Fictional Course UI ${tag}` }),
  );
  await adminLogin(page, admin);
  await page.goto("/courses");
  await page
    .getByRole("button", { name: "Kursbausteine", exact: true })
    .click();
  await page
    .getByRole("searchbox", { name: "Suchen", exact: true })
    .fill("LPC3");
  await expect(
    page.getByRole("button", { name: "Bausteindetails: LPC3", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Sprache", { exact: true }).selectOption("en");
  await expect(
    page.getByRole("searchbox", { name: "Search", exact: true }),
  ).toHaveValue("LPC3");
  await page.getByLabel("Theme", { exact: true }).selectOption("dark");
  await expect(
    page.getByRole("button", {
      name: "Building-block details: LPC3",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.locator(".building-block-cards .operations-course").first(),
  ).toHaveCSS("border-top-width", "5px");
  await a11y(page);
  await page.screenshot({
    path: `docs/screenshots/${testInfo.project.name}-course-building-blocks-catalogue-dark-en.png`,
    fullPage: true,
  });
  await page.getByLabel("Language", { exact: true }).selectOption("de");
  await page.getByLabel("Farbschema", { exact: true }).selectOption("light");
  const sourceAction = page.getByRole("button", {
    name: "Bausteindetails: LPC3",
    exact: true,
  });
  await assertPointerReady(sourceAction, "course source details");
  await sourceAction.click();
  const sourceDialog = page.getByRole("dialog", { name: /LPC3/ });
  await expect(
    sourceDialog.getByText("Bausteinbeschreibung-LPIC3.pdf", { exact: true }),
  ).toBeVisible();
  await expect(
    sourceDialog.getByText("Bausteinbeschreibung_LPC3.pdf", { exact: true }),
  ).toBeVisible();
  await sourceDialog
    .getByText("SHA-256-Prüfsumme anzeigen", { exact: true })
    .first()
    .click();
  await expect(sourceDialog.locator("code").first()).toHaveText(primary.sha256);
  const note = `Fictional reusable Course note ${tag} <script>literal only</script>`;
  await sourceDialog.getByLabel("Dein Kommentar", { exact: true }).fill(note);
  await sourceDialog
    .getByRole("button", { name: "Kommentar veröffentlichen", exact: true })
    .click();
  await expect(sourceDialog.getByText(note, { exact: true })).toBeVisible();
  await a11y(page);
  await page.screenshot({
    path: `docs/screenshots/${testInfo.project.name}-course-building-blocks-source-reference.png`,
    fullPage: true,
  });
  await sourceDialog
    .getByRole("button", { name: "Durchführung planen", exact: true })
    .click();
  const runDialog = page.getByRole("dialog", {
    name: "Durchführung anlegen",
    exact: true,
  });
  await expect(
    runDialog.getByLabel("Kursvorlage", { exact: true }),
  ).toHaveValue(block.default_template_id);
  await runDialog.getByLabel("Organisation", { exact: true }).selectOption(org);
  await runDialog
    .getByLabel("Erster Unterrichtstag", { exact: true })
    .fill("2037-07-06");
  await runDialog
    .getByRole("button", { name: "10 Werktagstermine erzeugen", exact: true })
    .click();
  await expect(runDialog.getByLabel(/^Beginn \d+$/)).toHaveCount(10);
  await expect(runDialog.getByLabel(/^Ende \d+$/)).toHaveCount(10);
  await runDialog
    .getByLabel("Ort / Zugangslink", { exact: true })
    .fill("Fictional Course online classroom");
  await runDialog
    .getByRole("button", { name: "Speichern", exact: true })
    .click();
  await expect(runDialog).not.toBeVisible();
  const run = await checked(
    service
      .from("course_runs")
      .select("id,template_id,course_sessions(*)")
      .eq("organisation_id", org)
      .single(),
  );
  expect(run.template_id).toBe(block.default_template_id);
  expect(run.course_sessions).toHaveLength(10);
  await page.goto(`/courses?run=${run.id}`);
  const courseDialog = page.getByRole("dialog", { name: /LPC3/ });
  await courseDialog
    .getByRole("link", { name: "Auftrag daraus erstellen", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/admin\\?courseRun=${run.id}`));
  await expect(
    page.getByRole("heading", { name: "Auftrag aus diesem Kurs", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Titel", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel(/^Beginn \d+$/)).toHaveCount(0);
  await page
    .getByLabel("Voller Auftragspreis je Einheit", { exact: true })
    .fill("100");
  await page
    .getByLabel("Voller Auftragspreis gesamt", { exact: true })
    .fill("1000");
  await page
    .getByLabel("Konditionen", { exact: true })
    .fill(`Fictional Course complete-block terms ${tag}`);
  await page.getByLabel("Sofort veröffentlichen", { exact: true }).check();
  await page
    .getByLabel("Gültiger Rahmenvertrag erforderlich", { exact: true })
    .uncheck();
  await page
    .getByRole("button", { name: "Stelle speichern", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Erstellten Auftrag öffnen", exact: true }),
  ).toBeVisible();
  const created = await checked(
    service
      .from("jobs")
      .select("id,course_run_id,total_amount,job_sessions(*)")
      .eq("course_run_id", run.id)
      .single(),
  );
  expect(created.course_run_id).toBe(run.id);
  expect(created.total_amount).toBe(500);
  expect(created.job_sessions).toHaveLength(10);
  expect(
    created.job_sessions
      .map((row: { course_session_id: string }) => row.course_session_id)
      .sort(),
  ).toEqual(run.course_sessions.map((row: { id: string }) => row.id).sort());
  await page
    .getByRole("link", { name: "Erstellten Auftrag öffnen", exact: true })
    .click();
  await expect(page).toHaveURL(`/jobs/${created.id}`);
  await expect(
    page.getByText("Bausteinbeschreibung-LPIC3.pdf", { exact: true }),
  ).toBeVisible();
  const context = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL!,
    viewport: testInfo.project.use.viewport,
    isMobile: testInfo.project.use.isMobile,
    hasTouch: testInfo.project.use.hasTouch,
  });
  try {
    const lecturerPage = await context.newPage();
    await login(lecturerPage, teacher.email);
    await lecturerPage.goto(`/jobs/${created.id}`);
    await expect(lecturerPage.locator(".claim-panel .amount")).toHaveText(
      /500,00/,
    );
    await expect(lecturerPage.getByText(/1\.000,00/)).toHaveCount(0);
    await expect(
      lecturerPage.getByText("Bausteinbeschreibung-LPIC3.pdf", { exact: true }),
    ).toBeVisible();
    await expect(
      lecturerPage.getByRole("region", {
        name: "Quellenreferenz",
        exact: true,
      }),
    ).toHaveCSS("border-top-style", "solid");
    await lecturerPage
      .getByLabel("Konditionen akzeptieren", { exact: true })
      .check();
    await lecturerPage
      .getByRole("button", { name: "Auftrag übernehmen", exact: true })
      .click();
    await expect(
      lecturerPage
        .getByRole("status")
        .filter({ hasText: /Dein Auftrag ist bestätigt/ }),
    ).toBeVisible();
    const claims = await checked(
      service
        .from("job_claims")
        .select("id,total_amount,assignment_sessions(*)")
        .eq("job_id", created.id),
    );
    expect(claims).toHaveLength(1);
    expect(claims[0].total_amount).toBe(500);
    expect(claims[0].assignment_sessions).toHaveLength(10);
    await a11y(lecturerPage);
    await lecturerPage.screenshot({
      path: `docs/screenshots/${testInfo.project.name}-course-building-blocks-linked-job.png`,
      fullPage: true,
    });
  } finally {
    await context.close();
  }
});
