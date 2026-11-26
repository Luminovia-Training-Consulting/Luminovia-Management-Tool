/** Import and publish a real H5P ZIP question on the disposable QA stack. */
import { randomUUID } from "node:crypto";
import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { expect, test } from "@playwright/test";
import { enablePremiumAndLinkParticipant } from "../../scripts/testing/company-participant.mjs";
import { actor, api, checked, login } from "./helpers/accounts-support";

test.skip(
  process.env.PORTAL_TEST_MODE !== "1",
  "H5P import fixtures require the canonical disposable services.",
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

test("a staff member imports licensed H5P text and the learner sees attribution on the quiz", async ({
  page,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(120_000);
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
      name: `Fictional H5P organisation ${suffix}`,
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
      title: `Fictional H5P course ${suffix}`,
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

  const prompt = `Ein lokaler Dateiname kann Leerzeichen enthalten. ${suffix}`;
  const name = "Fictional H5P author";
  const writer = new ZipWriter(new Uint8ArrayWriter(), {
    useWebWorkers: false,
  });
  await writer.add(
    "h5p.json",
    new TextReader(
      JSON.stringify({
        title: "A fictional H5P true/false question",
        language: "de",
        embedTypes: ["iframe"],
        mainLibrary: "H5P.TrueFalse",
        preloadedDependencies: [
          { machineName: "H5P.TrueFalse", majorVersion: 1, minorVersion: 8 },
        ],
        license: "CC BY",
        licenseVersion: "4.0",
        authors: [{ name, role: "Author" }],
      }),
    ),
  );
  await writer.add(
    "content/content.json",
    new TextReader(
      JSON.stringify({
        question: `<p>${prompt}</p>`,
        correct: "true",
        l10n: { trueText: "Richtig", falseText: "Falsch" },
      }),
    ),
  );
  await writer.add(
    "H5P.TrueFalse-1.8/scripts/sample.js",
    new TextReader("globalThis.sampleH5pCodeWasLoaded = true;"),
  );
  const archive = Buffer.from(await writer.close());

  const workspace = `/courses/${run}/workspace#course-learning`;
  await login(page, manager.email);
  await page.goto(workspace);
  const quiz = page.getByRole("region", { name: "Mini-Quiz" });
  await quiz.getByText("Fragenbank", { exact: true }).click();
  const importer = quiz
    .locator("details")
    .filter({
      has: page.getByText("H5P-Frage importieren", { exact: true }),
    })
    .last();
  await importer.getByText("H5P-Frage importieren", { exact: true }).click();
  await importer.getByLabel("H5P-Datei auswählen").setInputFiles({
    name: "question.h5p",
    mimeType: "application/zip",
    buffer: archive,
  });
  await expect(importer.getByText(prompt, { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => "sampleH5pCodeWasLoaded" in globalThis),
  ).toBe(false);
  await importer
    .getByRole("button", { name: "H5P-Frage in Fragenbank speichern" })
    .click();
  await expect(
    importer.getByText("H5P-Frage in der Fragenbank gespeichert."),
  ).toBeVisible();
  await importer.getByRole("button", { name: "Ins Quiz übernehmen" }).click();
  await quiz
    .getByLabel("Quiz für eingeschriebene Teilnehmende veröffentlichen")
    .check();
  await quiz
    .getByRole("button", { name: "Neue Quizfassung speichern" })
    .click();
  await expect
    .poll(async () => {
      const learnerView = await checked(
        learner.client.rpc("course_workspace", { p_run_id: run }),
        { requireData: true },
      );
      return learnerView.quiz?.questions[0].h5p_attribution?.authors[0]?.name;
    })
    .toBe(name);

  const learnerContext = await browser.newContext({
    baseURL,
    viewport: info.project.use.viewport,
    isMobile: info.project.use.isMobile,
    hasTouch: info.project.use.hasTouch,
  });
  try {
    const learnerPage = await learnerContext.newPage();
    await login(learnerPage, learner.email, /\/learning$/);
    await learnerPage.goto(workspace);
    const learnerQuiz = learnerPage.getByRole("region", { name: "Mini-Quiz" });
    await learnerQuiz
      .getByText("Quelle und Lizenz · CC BY 4.0", { exact: true })
      .click();
    await expect(learnerQuiz.getByText(name, { exact: true })).toBeVisible();
    await expect(
      learnerQuiz.getByRole("link", { name: "CC BY 4.0" }),
    ).toHaveAttribute("href", "https://creativecommons.org/licenses/by/4.0/");
    await learnerQuiz
      .getByRole("radio", { name: "Richtig", exact: true })
      .check();
    await learnerQuiz
      .getByRole("button", { name: "Antworten verbindlich abgeben" })
      .click();
    await expect(
      learnerQuiz.getByText(/Ergebnis: 100 %.*Bestanden/),
    ).toBeVisible();
  } finally {
    await learnerContext.close();
  }
});
