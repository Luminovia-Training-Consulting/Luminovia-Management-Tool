/**
 * Browser workflows for shared profiles, course history and reviews by enrolled participants.
 * Rendered workflows are checked in isolation; this does not replace manual device/platform acceptance.
 */
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
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
  "Profile workflows require the isolated ./portal test project.",
);
/** Checks the rendered state with axe; this does not replace manual accessibility acceptance. */
async function a11y(page: Page) {
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
}
test("own labels connect searchable profiles, real course history, enrolled reviews and management moderation", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(120000);
  const teacher = await actor(
      `Profile Teacher ${randomUUID().slice(0, 8)}`,
      "lecturer",
    ),
    student = await actor(
      `Private Participant ${randomUUID().slice(0, 8)}`,
      "participant",
    ),
    admin = await actor("Profile Administrator", "admin");
  const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const org = randomUUID(),
    template = randomUUID(),
    run = randomUUID(),
    job = randomUUID(),
    claim = randomUUID(),
    title = `Completed UI Course ${randomUUID().slice(0, 8)}`;
  const start = new Date(Date.now() - 2 * 86400000).toISOString(),
    end = new Date(Date.now() - 86400000).toISOString();
  await checked(
    service
      .from("organisations")
      .insert({ id: org, name: "Fictional Review Academy" }),
  );
  await checked(
    service.from("course_templates").insert({
      id: template,
      title,
      syllabus: "Literal <script>safe course text</script>",
    }),
  );
  await checked(
    service.from("course_runs").insert({
      id: run,
      template_id: template,
      organisation_id: org,
      published: false,
    }),
  );
  await checked(
    service
      .from("course_sessions")
      .insert({ course_run_id: run, starts_at: start, ends_at: end }),
  );
  await checked(
    service.from("jobs").insert({
      id: job,
      course_run_id: run,
      title,
      customer_name: "Fictional Review Academy",
      delivery_type: "online",
      time_zone: "Europe/Berlin",
      status: "filled",
      amount: 100,
      total_amount: 100,
      currency: "EUR",
      rate_unit: "fixed_total",
      terms: "Fictional historic net fee",
    }),
  );
  await checked(
    service
      .from("job_sessions")
      .insert({ job_id: job, starts_at: start, ends_at: end }),
  );
  await checked(
    service.from("job_claims").insert({
      id: claim,
      job_id: job,
      lecturer_id: teacher.id,
      idempotency_key: randomUUID(),
      amount: 100,
      total_amount: 100,
      currency: "EUR",
      rate_unit: "fixed_total",
      terms: "Fictional historic net fee",
      terms_version: 1,
    }),
  );
  await checked(
    service.from("assignment_sessions").insert({
      claim_id: claim,
      lecturer_id: teacher.id,
      starts_at: start,
      ends_at: end,
    }),
  );
  await login(page, teacher.email);
  await page.goto("/profile");
  await page
    .getByLabel("Eigene Labels (mit Komma trennen)", { exact: true })
    .fill("Python, Mentoring");
  await page.getByLabel("Land", { exact: true }).fill("Germany");
  await page
    .getByLabel("Sprachen (mit Komma trennen)", { exact: true })
    .fill("Deutsch, English");
  await page
    .getByLabel("Lehrerfahrung", { exact: true })
    .fill("Fictional course teaching experience");
  const form = page.locator("form").filter({
    has: page.getByLabel("Eigene Labels (mit Komma trennen)", {
      exact: true,
    }),
  });
  await form.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(form.getByRole("status")).toContainText("Gespeichert");
  await page.reload();
  await expect(
    page.getByLabel("Eigene Labels (mit Komma trennen)", { exact: true }),
  ).toHaveValue(/Mentoring.*Python|Python.*Mentoring/);
  await page.goto("/people");
  await page.getByLabel("Person suchen", { exact: true }).fill(teacher.name);
  await page.getByLabel("Label filtern", { exact: true }).fill("Python");
  await page.getByRole("link", { name: teacher.name, exact: true }).click();
  await expect(
    page.getByRole("heading", { name: teacher.name, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Vergangene Kurse", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: title, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/courses\\?run=${run}`));
  await expect(
    page.getByRole("dialog", { name: title, exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Schließen", exact: true }).click();
  await expect(page).toHaveURL(/\/courses$/);
  const contextOptions = {
    baseURL: process.env.E2E_BASE_URL!,
    viewport: testInfo.project.use.viewport,
    isMobile: testInfo.project.use.isMobile,
    hasTouch: testInfo.project.use.hasTouch,
  };
  const managerContext = await browser.newContext(contextOptions);
  const learnerContext = await browser.newContext(contextOptions);
  try {
    const manager = await managerContext.newPage();
    await adminLogin(manager, admin);
    await manager.goto(`/courses?run=${run}`);
    const dialog = manager.getByRole("dialog", { name: title, exact: true });
    await expect(
      dialog.getByRole("heading", {
        name: "Kursteilnehmende verwalten",
        exact: true,
      }),
    ).toBeVisible();
    await dialog
      .getByLabel("Person auswählen", { exact: true })
      .selectOption(student.id);
    await dialog
      .getByLabel("Teilnahmestatus", { exact: true })
      .selectOption("completed");
    await dialog
      .getByRole("button", { name: "Zuordnung speichern", exact: true })
      .click();
    await expect(
      dialog
        .locator(".enrolment-list")
        .getByText(student.name, { exact: true }),
    ).toBeVisible();
    const learner = await learnerContext.newPage();
    await login(learner, student.email);
    await learner.goto("/my-reviews");
    const reviewForm = learner.locator("article").filter({
      has: learner.getByRole("heading", { name: title, exact: true }),
    });
    await reviewForm.getByLabel("Bewertung", { exact: true }).selectOption("4");
    const feedback = `Fictional clear teaching <script>${randomUUID().slice(0, 8)}</script>`;
    await reviewForm
      .getByLabel("Deine Rückmeldung", { exact: true })
      .fill(feedback);
    await reviewForm
      .getByRole("button", { name: "Bewertung speichern", exact: true })
      .click();
    await expect(
      reviewForm.getByRole("button", {
        name: "Eigene Bewertung zurückziehen",
        exact: true,
      }),
    ).toBeVisible();
    await page.goto(`/people/${teacher.id}`);
    await expect(page.getByText(feedback, { exact: true })).toBeVisible();
    await expect(page.getByText(student.name, { exact: true })).toHaveCount(0);
    expect(await page.locator(".people-review-list script").count()).toBe(0);
    await a11y(page);
    await page.screenshot({
      path: `docs/screenshots/${testInfo.project.name}-person-profile.png`,
      fullPage: true,
    });
    await manager.goto(`/people/${teacher.id}`);
    const review = manager
      .getByRole("listitem")
      .filter({ has: manager.getByText(feedback, { exact: true }) });
    await review
      .getByRole("button", { name: "Ausblenden", exact: true })
      .click();
    await manager
      .getByLabel("Begründung", { exact: true })
      .fill("Fictional moderation review");
    await manager
      .getByRole("dialog")
      .getByRole("button", { name: "Speichern", exact: true })
      .click();
    await expect(manager.getByRole("dialog")).toBeHidden();
    await page.reload();
    await expect(page.getByText(feedback, { exact: true })).toHaveCount(0);
    await learner.reload();
    await expect(
      learner.getByText("Durch Moderation ausgeblendet", { exact: false }),
    ).toBeVisible();
    await a11y(learner);
  } finally {
    await Promise.all([managerContext.close(), learnerContext.close()]);
  }
});
