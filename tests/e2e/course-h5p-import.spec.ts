/** Import and publish a real H5P ZIP question on the disposable QA stack. */
import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { expect, test } from "@playwright/test";
import { checked, login } from "./helpers/accounts-support";
import { createAssessmentCourse } from "./helpers/assessment-course";

test.skip(
  process.env.PORTAL_TEST_MODE !== "1",
  "H5P import fixtures require the canonical disposable services.",
);

/** Include a real archive member that must never execute on either page. */
async function h5pArchive(manifest: object, content: object) {
  const writer = new ZipWriter(new Uint8ArrayWriter(), {
    useWebWorkers: false,
  });
  await writer.add("h5p.json", new TextReader(JSON.stringify(manifest)));
  await writer.add(
    "content/content.json",
    new TextReader(JSON.stringify(content)),
  );
  await writer.add(
    "H5P.TestLibrary-1.0/scripts/sample.js",
    new TextReader("globalThis.sampleH5pCodeWasLoaded = true;"),
  );
  return Buffer.from(await writer.close());
}

test("a staff member imports licensed H5P text and the learner sees attribution on the quiz", async ({
  page,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(120_000);
  const { manager, learner, run, suffix } =
    await createAssessmentCourse("H5P question");
  const prompt = `Ein lokaler Dateiname kann Leerzeichen enthalten. ${suffix}`;
  const name = "Fictional H5P author";
  const archive = await h5pArchive(
    {
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
    },
    {
      question: `<p>${prompt}</p>`,
      correct: "true",
      l10n: { trueText: "Richtig", falseText: "Falsch" },
    },
  );

  const workspace = `/courses/${run}/workspace#course-learning`;
  await login(page, manager.email);
  await page.goto(workspace);
  const quiz = page.getByRole("region", { name: "Mini-Quiz" });
  await quiz.getByText("Fragenbank", { exact: true }).click();
  const importer = quiz
    .locator("details")
    .filter({
      has: page.getByText("H5P importieren", { exact: true }),
    })
    .last();
  await importer.getByText("H5P importieren", { exact: true }).click();
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

for (const library of ["H5P.SingleChoiceSet", "H5P.QuestionSet"]) {
  test(`staff publishes a licensed ${library} as ordered native quiz questions`, async ({
    page,
    browser,
    baseURL,
  }, info) => {
    test.setTimeout(120_000);
    const { manager, learner, run, suffix } =
      await createAssessmentCourse("H5P collection");
    const isChoiceSet = library === "H5P.SingleChoiceSet";
    const prompt = [
      `Was zeigt pwd an? ${suffix}`,
      `Dateinamenerweiterungen sind optional. ${suffix}`,
    ];
    const name = "Fictional H5P collection owner";
    const embeddedName = "Fictional independently credited author";
    const archive = await h5pArchive(
      {
        title: "Fictional text collection",
        language: "de",
        embedTypes: ["iframe"],
        mainLibrary: library,
        preloadedDependencies: [
          {
            machineName: library,
            majorVersion: 1,
            minorVersion: isChoiceSet ? 11 : 21,
          },
          ...(!isChoiceSet
            ? [
                {
                  machineName: "H5P.MultiChoice",
                  majorVersion: 1,
                  minorVersion: 16,
                },
                {
                  machineName: "H5P.TrueFalse",
                  majorVersion: 1,
                  minorVersion: 8,
                },
              ]
            : []),
        ],
        license: "CC BY",
        licenseVersion: "4.0",
        authors: [{ name, role: "Author" }],
      },
      isChoiceSet
        ? {
            choices: [
              {
                question: prompt[0],
                answers: ["Arbeitsverzeichnis", "Dateiliste"],
              },
              { question: prompt[1], answers: ["Richtig", "Falsch"] },
            ],
          }
        : {
            questions: [
              {
                library: "H5P.MultiChoice 1.16",
                params: {
                  question: prompt[0],
                  answers: [
                    { text: "Dateiliste", correct: false },
                    { text: "Arbeitsverzeichnis", correct: true },
                  ],
                },
              },
              {
                library: "H5P.TrueFalse 1.8",
                params: {
                  question: prompt[1],
                  correct: "true",
                  l10n: { trueText: "Richtig", falseText: "Falsch" },
                },
                metadata: {
                  title: "Fictional question with its own credit",
                  license: "CC BY",
                  licenseVersion: "4.0",
                  authors: [{ name: embeddedName, role: "Author" }],
                },
              },
            ],
          },
    );
    const workspace = `/courses/${run}/workspace#course-learning`;
    await login(page, manager.email);
    await page.goto(workspace);
    const quiz = page.getByRole("region", { name: "Mini-Quiz" });
    await quiz.getByText("Fragenbank", { exact: true }).click();
    const importer = quiz
      .locator("details")
      .filter({
        has: page.getByText("H5P importieren", { exact: true }),
      })
      .last();
    await importer.getByText("H5P importieren", { exact: true }).click();
    await importer.getByLabel("H5P-Datei auswählen").setInputFiles({
      name: "collection.h5p",
      mimeType: "application/zip",
      buffer: archive,
    });
    for (const question of prompt)
      await expect(importer.getByText(question, { exact: true })).toBeVisible();
    await importer
      .getByRole("button", { name: "Fragensammlung in Fragenbank speichern" })
      .click();
    await expect(importer.getByText("2 H5P-Fragen gespeichert.")).toBeVisible();
    for (const question of prompt) {
      await importer
        .getByRole("listitem")
        .filter({ hasText: question })
        .getByRole("button", { name: "Ins Quiz übernehmen" })
        .click();
    }
    await quiz
      .getByLabel("Quiz für eingeschriebene Teilnehmende veröffentlichen")
      .check();
    await quiz
      .getByRole("button", { name: "Neue Quizfassung speichern" })
      .click();
    const read = async () =>
      (
        await checked(
          learner.client.rpc("course_workspace", { p_run_id: run }),
          { requireData: true },
        )
      ).quiz;
    await expect
      .poll(async () =>
        (await read())?.questions.map(
          ({ prompt }: { prompt: string }) => prompt,
        ),
      )
      .toEqual(prompt);
    expect(
      (await read()).questions.every(
        (question: object) => !("correct" in question),
      ),
    ).toBe(true);
    expect(
      await page.evaluate(() => "sampleH5pCodeWasLoaded" in globalThis),
    ).toBe(false);

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
      const learnerQuiz = learnerPage.getByRole("region", {
        name: "Mini-Quiz",
      });
      const second = learnerQuiz.getByRole("group", {
        name: prompt[1],
        exact: true,
      });
      await second
        .getByText("Quelle und Lizenz · CC BY 4.0", { exact: true })
        .click();
      await expect(second.getByText(name, { exact: true })).toBeVisible();
      if (!isChoiceSet) {
        await second
          .getByText("Quelle der Teilfrage · CC BY 4.0", { exact: true })
          .click();
        await expect(
          second.getByText(embeddedName, { exact: true }),
        ).toBeVisible();
      }
      await learnerQuiz
        .getByRole("radio", { name: "Arbeitsverzeichnis", exact: true })
        .check();
      await learnerQuiz
        .getByRole("radio", { name: "Richtig", exact: true })
        .check();
      await learnerQuiz
        .getByRole("button", { name: "Antworten verbindlich abgeben" })
        .click();
      await expect(
        learnerQuiz.getByText(/Ergebnis: 100 %.*Bestanden/),
      ).toBeVisible();
      expect(
        await learnerPage.evaluate(
          () => "sampleH5pCodeWasLoaded" in globalThis,
        ),
      ).toBe(false);

      const archive = await checked(
        manager.client.rpc("course_xapi_statements", {
          p_run_id: run,
          p_from: new Date(Date.now() - 600_000).toISOString(),
          p_until: new Date(Date.now() + 60_000).toISOString(),
        }),
        { requireData: true },
      );
      const interactions = archive.statements.filter(
        (event: { verb: { id: string } }) =>
          event.verb.id.endsWith("/answered"),
      );
      expect(interactions).toHaveLength(2);
      for (const [index, event] of interactions.entries()) {
        expect(event.object.id).toMatch(
          new RegExp(`/quiz/1/h5p/${index + 1}$`),
        );
        expect(event.result).toEqual({
          completion: true,
          response: "choice-1",
          success: true,
        });
        expect(JSON.stringify(event)).not.toContain(learner.email);
      }
    } finally {
      await learnerContext.close();
    }
  });
}
