/**
 * Browserabläufe für Stornierung, ausdrückliche Wiederöffnung und erneute Annahme auf derselben Seite.
 * Die Assertions prüfen tatsächliche Oberfläche und Serverantworten; ihre Ausführung ersetzt keine manuelle Plattformabnahme.
 */
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import {
  api,
  actor,
  checked,
  adminLogin,
  login,
} from "./helpers/accounts-support";
test.skip(
  process.env.PORTAL_TEST_MODE !== "1",
  "Lifecycle writes require the canonical disposable project.",
);
test("reasoned cancellation, explicit reopening, same-page reclaim and safe copy preserve the complete accepted block", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(90000);
  const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!),
    manager = await actor("Fictional lifecycle manager", "admin"),
    teacher = await actor("Fictional lifecycle lecturer", "lecturer");
  const template = randomUUID(),
    run = randomUUID(),
    job = randomUUID(),
    sessions = [
      {
        id: randomUUID(),
        course_run_id: run,
        starts_at: "2049-01-10T08:00:00Z",
        ends_at: "2049-01-10T09:00:00Z",
      },
      {
        id: randomUUID(),
        course_run_id: run,
        starts_at: "2049-01-11T08:00:00Z",
        ends_at: "2049-01-11T09:00:00Z",
      },
    ];
  await checked(
    service
      .from("course_templates")
      .insert({ id: template, title: "Fictional lifecycle curriculum" }),
  );
  await checked(
    service
      .from("course_runs")
      .insert({ id: run, template_id: template, time_zone: "Europe/Berlin" }),
  );
  await checked(service.from("course_sessions").insert(sessions));
  await checked(
    service.from("jobs").insert({
      id: job,
      course_run_id: run,
      title: "Fictional lifecycle block",
      customer_name: "Fictional academy",
      delivery_type: "online",
      time_zone: "Europe/Berlin",
      status: "published",
      amount: 100,
      total_amount: 200,
      currency: "EUR",
      rate_unit: "per_day",
      terms: "Original fictional terms",
    }),
  );
  await checked(
    service.from("job_sessions").insert(
      sessions.map((s) => ({
        job_id: job,
        course_session_id: s.id,
        starts_at: s.starts_at,
        ends_at: s.ends_at,
      })),
    ),
  );
  await adminLogin(page, manager);
  await page.goto(`/jobs/${job}`);
  const management = page.getByRole("region", {
    name: "Zuweisung und Auftragsverlauf",
    exact: true,
  });
  await management
    .getByRole("button", {
      name: "Unangenommenen Auftrag bearbeiten",
      exact: true,
    })
    .click();
  await page
    .getByLabel("Auftragsbedingungen", { exact: true })
    .fill("Reviewed fictional terms preserved forever");
  await page
    .getByLabel(/Übernahmefrist · Europe\/Berlin/)
    .fill("2048-12-01T12:00");
  await page
    .getByRole("button", { name: "Auftrag speichern", exact: true })
    .click();
  await expect(
    management.getByText("Die bestätigte Serveränderung wurde gespeichert."),
  ).toBeVisible();
  const edited = await checked(
    service
      .from("jobs")
      .select("terms_version,claim_deadline")
      .eq("id", job)
      .single(),
  );
  expect(edited.terms_version).toBe(2);
  expect(Date.parse(edited.claim_deadline)).toBe(
    Date.parse("2048-12-01T11:00:00Z"),
  );
  const context = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:5273",
  });
  try {
    const lecturerPage = await context.newPage();
    await login(lecturerPage, teacher.email);
    await lecturerPage.goto(`/jobs/${job}`);
    await lecturerPage
      .getByLabel("Konditionen akzeptieren", { exact: true })
      .check();
    await lecturerPage
      .getByRole("button", { name: "Auftrag übernehmen", exact: true })
      .click();
    await expect(
      lecturerPage.getByText(
        "Dein Auftrag ist bestätigt. Alle Termine sind reserviert.",
      ),
    ).toBeVisible();
    await lecturerPage
      .getByRole("button", { name: "Zuweisung stornieren", exact: true })
      .click();
    const dialog = lecturerPage.getByRole("dialog");
    await expect(
      dialog.getByRole("button", { name: "Stornierung bestätigen" }),
    ).toBeDisabled();
    await dialog
      .getByLabel("Begründung (5–1000 Zeichen)", { exact: true })
      .fill("Fictional agreed scheduling change");
    await dialog
      .getByRole("button", { name: "Stornierung bestätigen", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    await expect(
      lecturerPage.getByText("Storniert", { exact: true }),
    ).toBeVisible();
    await expect(
      lecturerPage.getByRole("button", {
        name: "Auftrag übernehmen",
        exact: true,
      }),
    ).toBeDisabled();
    await expect(
      lecturerPage.getByText(
        "Dein Auftrag ist bestätigt. Alle Termine sind reserviert.",
      ),
    ).not.toBeVisible();
    await page.goto(`/jobs/${job}`);
    await management
      .getByRole("button", { name: "Auftrag wieder öffnen", exact: true })
      .click();
    const reopen = page.getByRole("dialog");
    await reopen
      .getByLabel("Begründung (5–1000 Zeichen)", { exact: true })
      .fill("Fictional revised availability accepted");
    await reopen
      .getByRole("button", { name: "Auftrag wieder öffnen", exact: true })
      .click();
    await expect(reopen).not.toBeVisible();
    // Observe the real stale-query focus contract without reloading/remounting the
    // lecturer page: its retired claim key and confirmed-result state must stay safe.
    await lecturerPage.waitForTimeout(16000);
    await lecturerPage.bringToFront();
    const refreshedJobs = lecturerPage.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.endsWith("/rest/v1/jobs") &&
        response.request().method() === "GET" &&
        response.status() === 200,
    );
    // TanStack's browser focus manager listens on window. A non-bubbling
    // document event does not reach it and would leave this page on the draft.
    await lecturerPage.evaluate(() =>
      window.dispatchEvent(new Event("visibilitychange")),
    );
    await refreshedJobs;
    await expect(lecturerPage.locator(".status-published")).toHaveText("Offen");
    await expect(
      lecturerPage.getByText("1 Platz zur Übernahme offen", { exact: true }),
    ).toBeVisible();
    const currentTerms = lecturerPage.getByLabel("Konditionen akzeptieren", {
      exact: true,
    });
    // Reopening retains the accepted terms version. Explicitly review consent
    // for this new operation and prove it still gates the actual claim button.
    await currentTerms.uncheck();
    await expect(
      lecturerPage.getByRole("button", {
        name: "Auftrag übernehmen",
        exact: true,
      }),
    ).toBeDisabled();
    await currentTerms.check();
    await expect(
      lecturerPage.getByRole("button", {
        name: "Auftrag übernehmen",
        exact: true,
      }),
    ).toBeEnabled();
    await lecturerPage
      .getByRole("button", { name: "Auftrag übernehmen", exact: true })
      .click();
    await expect(
      lecturerPage.getByText(
        "Dein Auftrag ist bestätigt. Alle Termine sind reserviert.",
      ),
    ).toBeVisible();
    const history = await checked(
      service
        .from("job_claims")
        .select("id,status,idempotency_key,total_amount,terms")
        .eq("job_id", job),
    );
    expect(history).toHaveLength(2);
    expect(history.map((c) => c.status).sort()).toEqual([
      "cancelled",
      "confirmed",
    ]);
    expect(new Set(history.map((c) => c.idempotency_key)).size).toBe(2);
    expect(
      history.every(
        (c) =>
          Number(c.total_amount) === 200 &&
          c.terms === "Reviewed fictional terms preserved forever",
      ),
    ).toBe(true);
    await page.goto(`/jobs/${job}`);
    await management
      .getByRole("button", { name: "Als Entwurf kopieren", exact: true })
      .click();
    const copy = page.getByRole("dialog");
    await copy
      .getByLabel("Titel der Kopie", { exact: true })
      .fill("Fictional safe lifecycle copy");
    await copy
      .getByRole("button", { name: "Als Entwurf kopieren", exact: true })
      .click();
    await expect(page).not.toHaveURL(new RegExp(`/jobs/${job}$`));
    await expect(
      page.getByRole("heading", {
        name: "Fictional safe lifecycle copy",
        exact: true,
      }),
    ).toBeVisible();
    const copyId = new URL(page.url()).pathname.split("/").at(-1)!;
    const copied = await checked(
      service
        .from("jobs")
        .select("status,course_run_id")
        .eq("id", copyId)
        .single(),
    );
    expect(copied.status).toBe("draft");
    expect(copied.course_run_id).not.toBe(run);
    expect(
      await checked(
        service.from("job_claims").select("id").eq("job_id", copyId),
      ),
    ).toEqual([]);
    await page.getByLabel("Sprache", { exact: true }).selectOption("en");
    await page.getByLabel("Theme", { exact: true }).selectOption("dark");
    await expect(
      page.getByRole("heading", {
        name: "Assignment and offer history",
        exact: true,
      }),
    ).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(result.violations.map((v) => v.id)).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `docs/screenshots/${testInfo.project.name}-job-lifecycle.png`,
      fullPage: true,
    });
  } finally {
    await context.close();
  }
});
