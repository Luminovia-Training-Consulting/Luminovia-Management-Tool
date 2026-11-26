import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { actor, api, checked, login } from "./helpers/accounts-support";
import { enablePremiumAndLinkParticipant } from "../../scripts/testing/company-participant.mjs";

test.skip(
  process.env.PORTAL_TEST_MODE !== "1",
  "Course authoring needs an isolated project with authenticated browser services.",
);

test("lesson library copies a published lesson into an independent destination draft", async ({
  page,
}) => {
  const manager = await actor("Fictional lesson librarian", "admin");
  const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const author = api(process.env.SUPABASE_ANON_KEY!);
  await checked(
    author.auth.signInWithPassword({
      email: manager.email,
      password: process.env.E2E_PASSWORD!,
    }),
  );
  const [organisation, template, source, destination, module, lesson] =
    Array.from({ length: 6 }, randomUUID);
  const suffix = source.slice(0, 8);
  const courseTitle = `Fictional lesson library ${suffix}`;
  const lessonTitle = `Reusable shell lesson ${suffix}`;
  const lessonText = `Fictional published lesson ${suffix}`;
  await checked(
    service
      .from("organisations")
      .insert({ id: organisation, name: courseTitle }),
  );
  await checked(
    service
      .from("course_templates")
      .insert({ id: template, title: courseTitle }),
  );
  await checked(
    service.from("course_runs").insert(
      [source, destination].map((id) => ({
        id,
        template_id: template,
        organisation_id: organisation,
        published: true,
      })),
    ),
  );
  await checked(
    author.rpc("set_company_premium", {
      p_organisation_id: organisation,
      p_enabled: true,
      p_expected_version: 0,
      p_request_id: randomUUID(),
    }),
  );
  const sourceContent = {
    modules: [
      {
        id: module,
        title: "Fictional navigation module",
        description: "",
        lessons: [
          {
            id: lesson,
            title: lessonTitle,
            objectives: "Find the working directory",
            duration_minutes: 12,
            body: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: lessonText }],
                },
              ],
            },
          },
        ],
      },
    ],
  };
  const read = (run: string) =>
    checked(author.rpc("course_content_studio", { p_run_id: run }), {
      requireData: true,
    });
  const saved = await checked(
    author.rpc("course_content_action", {
      p_run_id: source,
      p_action: "save_draft",
      p_payload: {
        published_version: 0,
        draft_version: 0,
        content: sourceContent,
      },
    }),
    { requireData: true },
  );
  await checked(
    author.rpc("course_content_action", {
      p_run_id: source,
      p_action: "publish",
      p_payload: { published_version: 0, draft_version: saved.draft_version },
    }),
  );
  const originalPublication = (await read(source)).published_content;

  await login(page, manager.email);
  await page.goto(`/courses/${destination}/workspace#course-curriculum`);
  await page
    .getByRole("button", { name: "Modul hinzufügen", exact: true })
    .click();
  await page
    .getByLabel("Modultitel", { exact: true })
    .fill("Fictional destination module");
  const openLibrary = page.getByRole("button", {
    name: "Lektionsbibliothek",
    exact: true,
  });
  await openLibrary.click();
  const library = page.getByRole("dialog", {
    name: "Lektionsbibliothek",
    exact: true,
  });
  await expect(library.getByText(lessonTitle, { exact: true })).toBeVisible();
  const accessibility = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(library).toHaveCount(0);
  await expect(openLibrary).toBeFocused();
  await openLibrary.click();
  const search = library.getByLabel("Kurs, Modul oder Lektion", {
    exact: true,
  });
  const find = library.getByRole("button", {
    name: "Lektionen suchen",
    exact: true,
  });
  await search.fill("nonexistent lesson");
  await find.click();
  await expect(
    library.getByText("Keine passenden veröffentlichten Lektionen gefunden."),
  ).toBeVisible();
  await search.fill(suffix);
  await find.click();
  await library
    .getByRole("button", {
      name: `Lektion übernehmen – ${lessonTitle} (${courseTitle})`,
    })
    .click();
  await expect(library).toHaveCount(0);
  await expect(
    page.getByText(`${lessonTitle} wurde zum Entwurf hinzugefügt.`, {
      exact: true,
    }),
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        (await read(destination)).draft_content?.modules[0]?.lessons[0]?.title,
    )
    .toBe(lessonTitle);
  const draft = (await read(destination)).draft_content.modules[0].lessons[0];
  expect(draft.id).not.toBe(lesson);
  expect(draft.body).toEqual(originalPublication.modules[0].lessons[0].body);
  await page.reload();
  await page
    .getByRole("button", { name: "Fictional destination module", exact: true })
    .click();
  await page.getByRole("button", { name: lessonTitle, exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Lektionsinhalt" }),
  ).toHaveText(lessonText);
  await page
    .getByLabel("Lektionstitel", { exact: true })
    .fill("Edited destination lesson");
  await expect
    .poll(
      async () =>
        (await read(destination)).draft_content?.modules[0]?.lessons[0]?.title,
    )
    .toBe("Edited destination lesson");
  expect((await read(source)).published_content).toEqual(originalPublication);
});

test("course author publishes a versioned module and learner sees only the assigned publication", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120_000);
  const manager = await actor("Fictional course author", "admin");
  const company = await actor("Fictional course contact", "client");
  const learner = await actor("Fictional enrolled learner", "participant");
  const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const managerClient = api(process.env.SUPABASE_ANON_KEY!);
  const companyClient = api(process.env.SUPABASE_ANON_KEY!);
  const learnerClient = api(process.env.SUPABASE_ANON_KEY!);
  await checked(
    managerClient.auth.signInWithPassword({
      email: manager.email,
      password: process.env.E2E_PASSWORD!,
    }),
  );
  await checked(
    companyClient.auth.signInWithPassword({
      email: company.email,
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
  const template = randomUUID();
  const run = randomUUID();
  const suffix = randomUUID().slice(0, 8);
  await checked(
    service.from("organisations").insert({
      id: organisation,
      name: `Fictional authoring organisation ${suffix}`,
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
      title: `Fictional authoring course ${suffix}`,
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
  await enablePremiumAndLinkParticipant({
    admin: { ...manager, client: managerClient },
    company: { ...company, client: companyClient },
    learner: { ...learner, client: learnerClient },
    organisation,
    service,
    checked,
  });
  await checked(
    managerClient.rpc("manage_course_enrolment", {
      p_course_run_id: run,
      p_user_id: learner.id,
      p_status: "enrolled",
    }),
  );

  const workspace = `/courses/${run}/workspace#course-curriculum`;
  await login(page, manager.email);
  await page.goto(workspace);
  await page.getByRole("heading", { name: "Kursinhalte" }).waitFor();
  await page.getByRole("button", { name: "Modul hinzufügen" }).click();
  await page.getByLabel("Modultitel").fill(`Fictional module ${suffix}`);
  await page.getByRole("button", { name: "Lektion hinzufügen" }).click();
  await page.getByLabel("Lektionstitel").fill(`Fictional lesson ${suffix}`);
  const lessonText = `Fictional lesson body ${suffix}`;
  await page.getByRole("textbox", { name: "Lektionsinhalt" }).fill(lessonText);
  await page.getByRole("button", { name: "Modul hinzufügen" }).click();
  const destination = `Fictional destination ${suffix}`;
  await page.getByLabel("Modultitel").fill(destination);
  await page
    .getByRole("button", { name: `Fictional lesson ${suffix}`, exact: true })
    .click();
  await page.getByRole("button", { name: "Lektion duplizieren" }).click();
  const copyTitle = `Fictional lesson copy ${suffix}`;
  await page.getByLabel("Lektionstitel").fill(copyTitle);
  await page
    .getByLabel("Zielmodul")
    .selectOption({ label: `2. ${destination}` });
  await page.getByRole("button", { name: "In Zielmodul verschieben" }).click();
  await page.getByRole("button", { name: "Lektion hinzufügen" }).click();
  const archivedTitle = `Fictional archived lesson ${suffix}`;
  await page.getByLabel("Lektionstitel").fill(archivedTitle);
  await page.getByRole("button", { name: "Lektion archivieren" }).click();
  await expect(
    page.getByRole("button", { name: "Lektion wiederherstellen" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Teilnehmendenvorschau" }).click();
  const narrow = page.getByRole("button", { name: "Schmale Ansicht" });
  await narrow.click();
  await expect(narrow).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: copyTitle })).toBeVisible();
  await expect(page.getByText(/Entwurf · Fassung \d+/)).toBeVisible();
  const publish = page.getByRole("button", { name: "Veröffentlichen" });
  await expect(publish).toBeEnabled();
  const beforePublish = await checked(
    learnerClient.rpc("course_content_studio", { p_run_id: run }),
    { requireData: true },
  );
  expect(beforePublish.published_content.modules).toEqual([]);
  expect(beforePublish.draft_content).toBeNull();
  await page.getByRole("button", { name: "Freigabe anfragen" }).click();
  await expect(
    page.getByText("Freigabe angefragt", { exact: true }),
  ).toBeVisible();
  await expect(publish).toBeDisabled();
  await page.getByRole("button", { name: "Entwurf freigeben" }).click();
  await expect(
    page.getByText("Entwurf freigegeben", { exact: true }),
  ).toBeVisible();
  await expect(publish).toBeEnabled();

  await publish.click();
  await expect(page.getByText(/Veröffentlicht · Fassung 1/)).toBeVisible();

  const learnerState = await checked(
    learnerClient.rpc("course_content_studio", { p_run_id: run }),
    { requireData: true },
  );
  expect(learnerState.published_content.modules[0].title).toBe(
    `Fictional module ${suffix}`,
  );
  expect(learnerState.draft_content).toBeNull();
  expect(learnerState.versions).toEqual([]);
  expect(JSON.stringify(learnerState)).not.toContain(archivedTitle);
  expect(learnerState.published_content.modules[1].title).toBe(destination);
  const [originalModule, destinationModule] =
    learnerState.published_content.modules;
  expect(originalModule.lessons).toHaveLength(1);
  expect(destinationModule.lessons).toHaveLength(1);
  expect(destinationModule.lessons[0].id).not.toBe(
    originalModule.lessons[0].id,
  );
  expect(destinationModule.lessons[0].body).toEqual(
    originalModule.lessons[0].body,
  );

  const context = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL!,
    viewport: info.project.use.viewport,
    isMobile: info.project.use.isMobile,
    hasTouch: info.project.use.hasTouch,
  });
  try {
    const learnerPage = await context.newPage();
    await login(learnerPage, learner.email, /\/learning$/);
    await learnerPage.goto(workspace);
    await expect(
      learnerPage.getByRole("heading", { name: `Fictional module ${suffix}` }),
    ).toBeVisible();
    await expect(
      learnerPage.getByRole("heading", { name: `Fictional lesson ${suffix}` }),
    ).toBeVisible();
    await expect(
      learnerPage.getByText(lessonText, { exact: true }),
    ).toHaveCount(2);
    await expect(
      learnerPage.getByRole("heading", { name: copyTitle }),
    ).toBeVisible();
    await expect(
      learnerPage.getByRole("heading", { name: archivedTitle }),
    ).toHaveCount(0);
    await expect(
      learnerPage.getByRole("button", { name: "Entwurf speichern" }),
    ).toHaveCount(0);
    await expect(
      learnerPage.getByRole("button", { name: "Veröffentlichen" }),
    ).toHaveCount(0);
  } finally {
    await context.close();
  }
});
