import { randomUUID } from "node:crypto";
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
  test.setTimeout(90_000);
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
  } finally {
    await context.close();
  }
});
