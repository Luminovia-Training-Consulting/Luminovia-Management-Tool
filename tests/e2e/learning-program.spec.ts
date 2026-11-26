import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { enablePremiumAndLinkParticipant } from "../../scripts/testing/company-participant.mjs";
import { actor, api, checked, login } from "./helpers/accounts-support";

test.skip(
  process.env.PORTAL_TEST_MODE !== "1",
  "Learning programme fixtures need an isolated project.",
);

test("a complete learning programme unlocks its next course and produces whole-programme proof", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120_000);
  const manager = await actor("Fictional programme planner", "admin");
  const learner = await actor("Fictional programme learner", "participant");
  const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const managerClient = api(process.env.SUPABASE_ANON_KEY!);
  const learnerClient = api(process.env.SUPABASE_ANON_KEY!);
  await checked(
    managerClient.auth.signInWithPassword({
      email: manager.email,
      password: process.env.E2E_PASSWORD!,
    }),
  );
  await checked(
    learnerClient.auth.signInWithPassword({
      email: learner.email,
      password: process.env.E2E_PASSWORD!,
    }),
  );
  const organisation = randomUUID();
  const name = `Fictional programme ${organisation.slice(0, 8)}`;
  await checked(
    service.from("organisations").insert({ id: organisation, name }),
  );
  await enablePremiumAndLinkParticipant({
    admin: { ...manager, client: managerClient },
    company: { ...manager, client: managerClient },
    learner: { ...learner, client: learnerClient },
    organisation,
    service,
    checked,
  });
  const courses = await Promise.all(
    ["First course", "Second course", "Conditional course"].map(
      async (part, index) => {
        const id = randomUUID(),
          template = randomUUID(),
          session = randomUUID();
        await checked(
          service
            .from("course_templates")
            .insert({ id: template, title: `${name} ${part}` }),
        );
        await checked(
          service.from("course_runs").insert({
            id,
            template_id: template,
            organisation_id: organisation,
            published: true,
          }),
        );
        const ends = Date.now() - (4 - index) * 86_400_000;
        await checked(
          service.from("course_sessions").insert({
            id: session,
            course_run_id: id,
            starts_at: new Date(ends - 3_600_000).toISOString(),
            ends_at: new Date(ends).toISOString(),
          }),
        );
        return { id, session };
      },
    ),
  );

  const className = `${name} · Class A`;
  const classOptions = await checked(
    managerClient.rpc("set_course_class", {
      p_course_id: courses[0].id,
      p_class_id: null,
      p_new_name: className,
      p_expected_version: 0,
    }),
    { requireData: true },
  );
  await login(page, manager.email);
  await page.goto("/learning?view=programmes");
  await page.getByRole("button", { name: "Programm anlegen" }).click();
  if (await page.getByLabel("Unternehmen", { exact: true }).isVisible())
    await page
      .getByLabel("Unternehmen", { exact: true })
      .selectOption(organisation);
  await page.getByLabel("Programmtitel").fill(name);
  for (const course of courses) {
    await page
      .getByLabel("Kursdurchlauf", { exact: true })
      .selectOption(course.id);
    await page.getByRole("button", { name: "Kurs hinzufügen" }).click();
  }
  await page.getByRole("button", { name: "Programm speichern" }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await page.getByLabel("Kurs mit Zugangsvoraussetzungen").selectOption("3");
  await page.getByLabel("Regel für den Kurszugang").selectOption("any");
  await page
    .getByRole("checkbox", { name: `${name} First course`, exact: true })
    .check();
  await page
    .getByRole("checkbox", { name: `${name} Second course`, exact: true })
    .check();
  await page.getByRole("button", { name: "Voraussetzungen speichern" }).click();
  await expect(page.getByText("Voraussetzungen gespeichert.")).toBeVisible();
  await page.reload();
  await page.getByLabel("Teilnehmende Person").selectOption(learner.id);
  await page.getByRole("button", { name: "Für Programm einschreiben" }).click();
  await expect(
    page.getByText("Die Person wurde für das gesamte Programm eingeschrieben."),
  ).toBeVisible();

  await page.getByLabel("Person für Klassenzuordnung").selectOption(learner.id);
  await page
    .getByLabel("Klasse für die Person")
    .selectOption(classOptions.current.id);
  await page
    .getByRole("button", { name: "Klassenzuordnung speichern" })
    .click();
  await expect(
    page.getByText("Die Klassenzuordnung wurde gespeichert."),
  ).toBeVisible();
  await expect(
    page.getByText("0 von 3 Kursabschlüssen erreicht."),
  ).toBeVisible();

  const href = new URL(page.url()).pathname + new URL(page.url()).search;
  const programme = new URL(page.url()).searchParams.get("program")!;
  const context = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL!,
    viewport: info.project.use.viewport,
    isMobile: info.project.use.isMobile,
    hasTouch: info.project.use.hasTouch,
  });
  try {
    const student = await context.newPage();
    await login(student, learner.email, /\/learning$/);
    await student.goto(href);
    await expect(
      student.getByText(/Schließe mindestens einen dieser Kurse ab/),
    ).toBeVisible();
    await expect(
      student.getByRole("button", { name: "Kurs freischalten" }),
    ).toHaveCount(0);
    const denied = await learnerClient.rpc("start_learning_program_course", {
      p_program_id: programme,
      p_course_id: courses[2].id,
    });
    expect(denied.status).toBe(409);

    // Publish real assessment evidence; a privately reviewed programme result
    // must remain absent until the course-level weighted grade is released.
    const course = courses[0].id;
    const courseAction = (
      p_action: string,
      p_payload: object,
      p_expected_version: number,
    ) =>
      checked(
        managerClient.rpc("course_workspace_action", {
          p_run_id: course,
          p_action,
          p_payload,
          p_expected_version,
        }),
      );
    await courseAction(
      "quiz_config",
      {
        questions: [
          { prompt: "Print a file?", options: ["cat", "pwd"], correct: 0 },
          {
            prompt: "Show the working directory?",
            options: ["cat", "pwd"],
            correct: 1,
          },
        ],
        published: true,
        pass_percent: 50,
        max_attempts: 1,
      },
      0,
    );
    const attempt = await checked(
      learnerClient.rpc("course_workspace_action", {
        p_run_id: course,
        p_action: "quiz_attempt",
        p_expected_version: 1,
        p_payload: { answers: [0, 0], request_id: randomUUID() },
      }),
      { requireData: true },
    );
    await courseAction(
      "gradebook_policy",
      { scheme: "percentage", bands: [] },
      0,
    );
    await courseAction(
      "gradebook_publish",
      {
        user_id: learner.id,
        attempt_id: attempt.id,
        expected_revision: 0,
        reason: "",
      },
      1,
    );
    const weighted = (
      p_action: string,
      p_payload: object,
      p_expected_policy = 1,
    ) =>
      checked(
        managerClient.rpc("course_weighted_gradebook_command", {
          p_run_id: course,
          p_action,
          p_payload,
          p_expected_policy,
        }),
      );
    await weighted(
      "policy",
      {
        threshold: 60,
        missing_required: "block",
        separate_reviewer: false,
        items: [{ key: "quiz", weight: 100, treatment: "required" }],
      },
      0,
    );
    const preview = await checked(
      managerClient.rpc("course_weighted_gradebook", {
        p_run_id: course,
        p_user_id: learner.id,
      }),
      { requireData: true },
    );
    await weighted("review", {
      user_id: learner.id,
      expected_review: 0,
      expected_release: 0,
      fingerprint: preview.fingerprint,
      reason: "",
    });
    const selfReport = student.getByText("Meine freigegebenen Programmnoten", {
      exact: true,
    });
    await selfReport.press("Enter");
    await expect(
      student.getByText(
        "Für diese Person sind noch keine Kursnoten im Programm freigegeben.",
      ),
    ).toBeVisible();
    await weighted("release", {
      user_id: learner.id,
      expected_review: 1,
      expected_release: 0,
    });
    await student.reload();
    await selfReport.press("Enter");
    const studentGrades = student.getByRole("list", {
      name: "Freigegebene Noten je Kurs",
    });
    await expect(
      studentGrades.getByText(/50\s*% · Nicht bestanden/),
    ).toBeVisible();
    await expect(
      student.getByRole("button", {
        name: "Notenbericht als CSV herunterladen",
      }),
    ).toHaveCount(0);
    await page
      .getByText("Freigegebene Programmnoten", { exact: true })
      .press("Enter");
    await page
      .getByLabel("Notenbericht für teilnehmende Person", { exact: true })
      .selectOption(learner.id);
    const staffGrades = page.getByRole("list", {
      name: "Freigegebene Noten je Kurs",
    });
    await expect(
      staffGrades.getByText(/50\s*% · Nicht bestanden/),
    ).toBeVisible();
    expect(
      await staffGrades.evaluate(
        (list) => list.scrollWidth <= list.clientWidth + 1,
      ),
    ).toBe(true);
    const [csv] = await Promise.all([
      page.waitForEvent("download"),
      page
        .getByRole("button", { name: "Notenbericht als CSV herunterladen" })
        .press("Enter"),
    ]);
    expect(csv.suggestedFilename()).toBe(`programme-grades-${programme}.csv`);
    const rows = await readFile((await csv.path())!, "utf8");
    expect(rows).toContain(`"${name} First course","50","Nicht bestanden"`);
    expect(rows).not.toContain("Second course");

    const complete = async ({ id, session }: (typeof courses)[number]) => {
      await checked(
        managerClient.rpc("manage_course_enrolment", {
          p_course_run_id: id,
          p_user_id: learner.id,
          p_status: "completed",
        }),
      );
      await checked(
        managerClient.rpc("save_course_session_attendance", {
          p_run_id: id,
          p_session_id: session,
          p_user_id: learner.id,
          p_status: "present",
          p_arrival_at: null,
          p_departure_at: null,
          p_note: "",
          p_reason: "",
          p_expected_version: 0,
        }),
      );
      await checked(
        learnerClient.rpc("course_workspace_action", {
          p_run_id: id,
          p_action: "completion_issue",
          p_payload: {},
          p_expected_version: 0,
        }),
      );
    };
    await complete(courses[0]);
    await student.reload();
    const unlock = (title: string) =>
      student
        .getByRole("listitem")
        .filter({
          has: student.getByText(`${name} ${title}`, { exact: true }),
        })
        .getByRole("button", { name: "Kurs freischalten" });
    // A first receipt unlocks the conditional course even while the second is incomplete.
    await unlock("Conditional course").click();
    await expect(
      student.getByRole("link", { name: "Kurs öffnen" }),
    ).toHaveCount(2);
    await expect(
      student.getByRole("heading", { name: "Programmabschluss" }),
    ).toHaveCount(0);
    await complete(courses[2]);
    await student.reload();
    await unlock("Second course").click();
    await expect(
      student.getByRole("link", { name: "Kurs öffnen" }),
    ).toHaveCount(3);
    await complete(courses[1]);
    await student.reload();
    await expect(
      student.getByRole("heading", { name: "Programmabschluss" }),
    ).toBeVisible();
    await expect(
      student.getByText("3 von 3 Kursen abgeschlossen"),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByText("3 von 3 Kursen abgeschlossen")).toBeVisible();
    const classProgress = page.getByRole("region", {
      name: "Gesamtfortschritt pro Klasse",
    });
    await classProgress
      .getByLabel("Klasse filtern")
      .selectOption(classOptions.current.id);
    await expect(
      classProgress.getByRole("heading", { name: className }),
    ).toBeVisible();
    await expect(
      classProgress.getByText(
        "1 von 1 Teilnehmenden haben das Programm abgeschlossen.",
      ),
    ).toBeVisible();
    await expect(
      classProgress.getByText("3 von 3 Kursabschlüssen erreicht."),
    ).toBeVisible();
    await page.getByLabel("Sprache", { exact: true }).selectOption("en");
    await page
      .getByText("Released programme grades", { exact: true })
      .press("Enter");
    await page
      .getByLabel("Learner for grade report", { exact: true })
      .selectOption(learner.id);
    await expect(
      page
        .getByRole("list", { name: "Released grades by course" })
        .getByText("50% · Failed"),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});
