/** Staff release a real quiz grade to an enrolled learner on the disposable QA stack. */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { enablePremiumAndLinkParticipant } from "../../scripts/testing/company-participant.mjs";
import { actor, api, checked, login } from "./helpers/accounts-support";

test.skip(
  process.env.PORTAL_TEST_MODE !== "1",
  "Course gradebook fixtures require the canonical disposable services.",
);

/** Give fixture RPCs the same role-scoped Auth sessions as their browser actors. */
async function authenticatedActor(name: string, role: string) {
  const account = await actor(name, role);
  const client = api(process.env.SUPABASE_ANON_KEY!);
  await checked(
    client.auth.signInWithPassword({
      email: account.email,
      password: process.env.E2E_PASSWORD!,
    }),
  );
  return { ...account, client };
}

/** Use a separate fictional course and scored attempt for every project. */
async function quizGradeFixture() {
  // Use a fresh course and actors on each project. The isolated runner disposes
  // of their records; the test never modifies shared fixture or grading history.
  const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const manager = await authenticatedActor("Fictional quiz manager", "admin");
  const company = await authenticatedActor("Fictional quiz contact", "client");
  const learner = await authenticatedActor(
    "Fictional quiz learner",
    "participant",
  );
  const organisation = randomUUID();
  const template = randomUUID();
  const run = randomUUID();
  const suffix = run.slice(0, 8);
  await checked(
    service.from("organisations").insert({
      id: organisation,
      name: `Fictional gradebook organisation ${suffix}`,
    }),
  );
  await checked(
    service.from("client_organisation_memberships").insert({
      user_id: company.id,
      organisation_id: organisation,
    }),
  );
  await checked(
    service.from("course_templates").insert({
      id: template,
      title: `Fictional gradebook course ${suffix}`,
    }),
  );
  await checked(
    service.from("course_runs").insert({
      id: run,
      template_id: template,
      organisation_id: organisation,
      published: true,
    }),
  );
  const now = Date.now();
  await checked(
    service.from("course_sessions").insert({
      course_run_id: run,
      starts_at: new Date(now - 2 * 3_600_000).toISOString(),
      ends_at: new Date(now - 3_600_000).toISOString(),
    }),
  );
  await enablePremiumAndLinkParticipant({
    admin: manager,
    company,
    learner,
    organisation,
    service,
    checked,
  });
  await checked(
    manager.client.rpc("manage_course_enrolment", {
      p_course_run_id: run,
      p_user_id: learner.id,
      p_status: "enrolled",
    }),
  );

  // The existing quiz RPCs create the source attempt; only the browsers save
  // the grading scale and release the grade. One correct answer yields 50%.
  await checked(
    manager.client.rpc("course_workspace_action", {
      p_run_id: run,
      p_action: "quiz_config",
      p_expected_version: 0,
      p_payload: {
        questions: [
          { prompt: "List a directory?", options: ["ls", "pwd"], correct: 0 },
          {
            prompt: "Print the working directory?",
            options: ["ls", "pwd"],
            correct: 1,
          },
        ],
        pass_percent: 50,
        max_attempts: 1,
        published: true,
      },
    }),
  );
  const attempt = await checked(
    learner.client.rpc("course_workspace_action", {
      p_run_id: run,
      p_action: "quiz_attempt",
      p_expected_version: 1,
      p_payload: { answers: [0, 0], request_id: randomUUID() },
    }),
    { requireData: true },
  );
  expect(attempt).toMatchObject({ score: 50 });

  return { manager, learner, run };
}

test("staff save the default quiz grading scale and release a grade to the enrolled learner", async ({
  page,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(120_000);
  const { manager, learner, run } = await quizGradeFixture();
  const workspace = `/courses/${run}/workspace#course-gradebook`;
  const title = { name: "Quiz-Notenbuch", exact: true };
  const saveScale = { name: "Notenskala speichern", exact: true };
  const releaseGrade = { name: "Note freigeben", exact: true };
  const unpublished = "Noch keine Note freigegeben.";

  await login(page, manager.email);
  await page.goto(workspace);
  await page.getByLabel("Farbschema", { exact: true }).selectOption("light");
  const staffGradebook = page.getByRole("region", title);
  await expect(staffGradebook.getByRole("heading", title)).toBeVisible();
  await expect(staffGradebook.getByRole("combobox")).toHaveValue("percentage");
  const learnerRow = staffGradebook.getByRole("listitem").filter({
    has: page.getByRole("heading", { name: learner.name, exact: true }),
  });
  const release = learnerRow.getByRole("button", releaseGrade);
  await expect(learnerRow).toBeVisible();
  await expect(release).toHaveCount(0);
  await staffGradebook.getByRole("button", saveScale).press("Enter");
  await expect(release).toBeEnabled();
  const checkLayout = async () => {
    expect(
      await staffGradebook.evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1,
      ),
    ).toBe(true);
    const result = await new AxeBuilder({ page })
      .include(".course-gradebook")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(result.violations).toEqual([]);
  };
  await checkLayout();
  // The release action must still be available after loading the saved scale.
  await page.reload();
  await expect(release).toBeEnabled();

  const context = await browser.newContext({
    baseURL,
    viewport: info.project.use.viewport,
    isMobile: info.project.use.isMobile,
    hasTouch: info.project.use.hasTouch,
  });
  try {
    const learnerPage = await context.newPage();
    await login(learnerPage, learner.email, /\/learning$/);
    await learnerPage.goto(workspace);
    const learnerGradebook = learnerPage.getByRole("region", title);
    const learnerStatus = learnerGradebook.getByRole("status");
    await expect(learnerGradebook.getByRole("heading", title)).toBeVisible();
    await expect(learnerStatus).toHaveText(unpublished);
    await expect(learnerGradebook.getByRole("button", saveScale)).toHaveCount(
      0,
    );
    await expect(
      learnerGradebook.getByRole("button", releaseGrade),
    ).toHaveCount(0);

    const staffUnpublished = learnerRow.getByText(unpublished, { exact: true });
    await expect(staffUnpublished).toBeVisible();
    await release.click();
    await expect(staffUnpublished).toHaveCount(0);
    await learnerPage.reload();
    await expect(learnerStatus).toHaveText(/\b50\s*%/);

    // Verify a reasoned correction with the other supported language and theme.
    await page.getByLabel("Sprache", { exact: true }).selectOption("en");
    await page.getByLabel("Theme", { exact: true }).selectOption("dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const englishGradebook = page.getByRole("region", {
      name: "Quiz gradebook",
      exact: true,
    });
    const openCorrection = englishGradebook.getByRole("button", {
      name: "Correct grade",
      exact: true,
    });
    await openCorrection.press("Enter");
    const correction = englishGradebook.getByRole("group", {
      name: "Correct grade",
      exact: true,
    });
    await expect(
      correction.getByRole("button", { name: "Publish correction" }),
    ).toBeDisabled();
    await correction.getByLabel("New grade").fill("65");
    await correction
      .getByLabel("Internal reason")
      .fill("Fictional correction after review");
    expect(
      await englishGradebook.evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1,
      ),
    ).toBe(true);
    const darkAudit = await new AxeBuilder({ page })
      .include(".course-gradebook")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(darkAudit.violations).toEqual([]);
    await correction
      .getByRole("button", { name: "Publish correction" })
      .press("Enter");
    await expect(
      englishGradebook.getByText(/Published grade: 65%/),
    ).toBeVisible();
    await learnerPage.reload();
    await expect(learnerStatus).toHaveText(/\b65\s*%/);
    await expect(
      learnerGradebook.getByText("Fictional correction after review"),
    ).toHaveCount(0);

    // A changed quiz leaves the previous grade stable until staff confirms
    // the new preview with a reason. Both actors can see the retained history.
    await checked(
      manager.client.rpc("course_workspace_action", {
        p_run_id: run,
        p_action: "quiz_config",
        p_expected_version: 1,
        p_payload: {
          questions: [
            {
              prompt: "Changes working directory?",
              options: ["cd", "ls"],
              correct: 0,
            },
          ],
          pass_percent: 80,
          max_attempts: 1,
          published: true,
        },
      }),
    );
    await checked(
      learner.client.rpc("course_workspace_action", {
        p_run_id: run,
        p_action: "quiz_attempt",
        p_expected_version: 2,
        p_payload: { answers: [0], request_id: randomUUID() },
      }),
    );
    await page.reload();
    await expect(
      englishGradebook.getByText(/Published grade: 65%/),
    ).toBeVisible();
    await englishGradebook
      .getByRole("button", { name: "Recalculate using current preview" })
      .click();
    await englishGradebook
      .getByLabel("Internal reason")
      .fill("Fictional revised quiz reviewed");
    await englishGradebook
      .getByRole("button", { name: "Publish recalculated grade" })
      .click();
    await expect(
      englishGradebook.getByText(/Published grade: 100%/),
    ).toBeVisible();
    await learnerPage.reload();
    await expect(learnerStatus).toHaveText(/\b100\s*%/);
    await learnerGradebook.getByText("Notenverlauf", { exact: true }).click();
    await expect(
      learnerGradebook.getByText(/Freigegebene Note: 65/),
    ).toBeVisible();
    await expect(
      learnerGradebook.getByText(/Freigegebene Note: 50/),
    ).toBeVisible();
    await expect(
      learnerGradebook.getByText("Fictional revised quiz reviewed"),
    ).toHaveCount(0);

    // CSV comes from a fresh server snapshot and omits correction reasons.
    const pendingDownload = page.waitForEvent("download");
    await englishGradebook
      .getByRole("button", { name: "Export published grades as CSV" })
      .click();
    const download = await pendingDownload;
    expect(download.suggestedFilename()).toBe(`quiz-grades-${run}.csv`);
    const csv = await readFile(await download.path(), "utf8");
    expect(csv).toContain(
      `"${learner.id}","${learner.name}","100","","3","1","2"`,
    );
    expect(csv).not.toContain("Fictional revised quiz reviewed");
    await expect(
      learnerGradebook.getByRole("button", {
        name: "Freigegebene Noten als CSV exportieren",
      }),
    ).toHaveCount(0);
  } finally {
    await context.close();
  }
});

/** Keep staff review and learner publication on separate authenticated sessions. */
test("staff review and publish one weighted course grade to the enrolled learner", async ({
  page,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(120_000);
  const duplicateKeys: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && message.text().includes("same key"))
      duplicateKeys.push(message.text());
  });
  const { manager, learner, run } = await quizGradeFixture();
  const workspace = `/courses/${run}/workspace`;

  await login(page, manager.email);
  await page.goto(workspace + "#course-gradebook");
  const quiz = page.getByRole("region", { name: "Quiz-Notenbuch", exact: true });
  await quiz.getByRole("button", { name: "Notenskala speichern" }).click();
  await quiz.getByRole("button", { name: "Note freigeben", exact: true }).click();
  await expect(quiz.getByText(/Freigegebene Note: 50\s*%/)).toBeVisible();

  await page.goto(workspace + "#course-weighted-gradebook");
  const weighted = page.getByRole("region", { name: "Gewichtete Kursnoten" });
  await weighted.getByRole("button", { name: "Bewertungsrichtlinie bearbeiten" }).click();
  await weighted.getByLabel("Bestehensgrenze (%)").fill("25");
  await weighted.getByLabel("Fehlende Pflichtleistungen").selectOption("zero");
  await weighted.getByRole("group", { name: "Leistung 1" })
    .getByLabel("Gewicht (%) oder Bonuspunkte").fill("50");
  await weighted.getByRole("button", { name: "Leistung hinzufügen" }).click();
  const exam = weighted.getByRole("group", { name: "Leistung 2" });
  await exam.getByLabel("Leistung", { exact: true }).selectOption("exam");
  await exam.getByLabel("Gewicht (%) oder Bonuspunkte").fill("50");
  await weighted.getByRole("button", { name: "Richtlinie als neue Fassung speichern" }).press("Enter");
  await weighted.getByLabel("Teilnehmende Person", { exact: true }).selectOption(learner.id);
  const preview = weighted.getByRole("region", { name: "Vorschau der Kursnote" });
  await expect(preview.getByRole("status")).toHaveText(/25\s*% · Bestanden/);
  await expect(preview.getByText("Fehlende Pflichtleistung mit 0 gewertet")).toBeVisible();

  await page.getByLabel("Sprache", { exact: true }).selectOption("en");
  await page.getByLabel("Theme", { exact: true }).selectOption("dark");
  const staff = page.getByRole("region", { name: "Weighted course grades" });
  const latest = staff.getByRole("region", { name: "Course grade preview" });
  await expect(latest.getByRole("status")).toHaveText("25% · Passed");
  expect(await staff.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  const audit = await new AxeBuilder({ page })
    .include(".course-gradebook")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(audit.violations).toEqual([]);

  const learnerContext = await browser.newContext({
    baseURL,
    viewport: info.project.use.viewport,
    isMobile: info.project.use.isMobile,
    hasTouch: info.project.use.hasTouch,
  });
  try {
    const learnerPage = await learnerContext.newPage();
    await login(learnerPage, learner.email, /\/learning$/);
    await learnerPage.goto(workspace + "#course-weighted-gradebook");
    const learnerGrades = learnerPage.getByRole("region", { name: "Gewichtete Kursnoten" });
    const unpublished = learnerGrades.getByText("Für diese Person ist noch keine Kursnote freigegeben.");
    await expect(unpublished).toBeVisible();
    const publish = staff.getByRole("button", { name: "Publish reviewed course grade" });
    await expect(publish).toHaveCount(0);
    await staff.getByRole("button", { name: "Save reviewed preview" }).press("Enter");
    await expect(publish).toBeEnabled();
    await learnerPage.reload();
    await expect(unpublished).toBeVisible();
    await publish.press("Enter");
    await expect(staff.getByRole("region", { name: "Course grade release history" })
      .getByRole("status")).toHaveText("25% · Passed");
    await learnerPage.goto("/notifications");
    const notice = learnerPage.getByRole("listitem").filter({hasText: "Kursnote freigegeben"});
    const resultLink = notice.getByRole("link", {name: "Öffnen", exact: true});
    await expect(resultLink).toHaveAttribute("href", workspace + "#course-weighted-gradebook");
    await resultLink.click();
    await expect(learnerGrades.getByRole("status")).toHaveText(/25\s*% · Bestanden/);
    await expect(learnerGrades.getByRole("button", { name: "Bewertungsrichtlinie bearbeiten" })).toHaveCount(0);
  } finally {
    await learnerContext.close();
  }
  expect(duplicateKeys).toEqual([]);
});
