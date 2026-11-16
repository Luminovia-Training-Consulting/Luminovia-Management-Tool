import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  api,
  actor,
  checked,
  login,
  adminLogin,
} from "./helpers/accounts-support";
test.skip(
  process.env.PORTAL_TEST_MODE !== "1",
  "Course workspace fixtures require canonical disposable services.",
);
async function fixture() {
  const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!),
    manager = await actor("Fictional course workspace manager", "admin"),
    teacher = await actor("Fictional course workspace teacher", "lecturer"),
    learner = await actor("Fictional Müller Μαρία Мария", "participant"),
    client = await actor("Fictional course workspace customer", "client");
  const org = randomUUID(),
    template = randomUUID(),
    run = randomUUID(),
    session = randomUUID(),
    job = randomUUID(),
    claim = randomUUID(),
    contact = randomUUID(),
    token = randomUUID().slice(0, 8),
    title = `Fictional Linux course ${token}`;
  await checked(
    service
      .from("organisations")
      .insert({ id: org, name: `Fictional workspace academy ${token}` }),
  );
  await checked(
    service.from("organisation_contacts").insert({
      id: contact,
      organisation_id: org,
      name: "Fictional agreed contact",
      email: "course@example.invalid",
      phone: "+49 40 123",
      notes: "Private organisation note stays hidden",
    }),
  );
  await checked(
    service.from("course_templates").insert({
      id: template,
      title,
      syllabus: "Fictional Linux permissions and safe commands",
    }),
  );
  await checked(
    service.from("course_runs").insert({
      id: run,
      template_id: template,
      organisation_id: org,
      time_zone: "Europe/Berlin",
      venue: "https://example.invalid/class",
    }),
  );
  await checked(
    service.from("course_sessions").insert({
      id: session,
      course_run_id: run,
      starts_at: new Date(Date.now() - 2 * 86400000 - 3600000).toISOString(),
      ends_at: new Date(Date.now() - 2 * 86400000).toISOString(),
    }),
  );
  await checked(
    service.from("jobs").insert({
      id: job,
      course_run_id: run,
      title,
      customer_name: "Fictional workspace academy",
      delivery_type: "online",
      status: "filled",
      amount: 100,
      total_amount: 100,
      currency: "EUR",
      rate_unit: "fixed_total",
      terms: "Fictional accepted terms",
    }),
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
      terms: "Fictional accepted terms",
      terms_version: 1,
    }),
  );
  await checked(
    service.from("course_enrolments").insert({
      course_run_id: run,
      user_id: learner.id,
      status: "completed",
      enrolled_by: manager.id,
    }),
  );
  await checked(
    service
      .from("client_organisation_memberships")
      .insert({ user_id: client.id, organisation_id: org }),
  );
  return {
    service,
    manager,
    teacher,
    learner,
    client,
    run,
    session,
    contact,
    title,
    token,
  };
}
async function a11y(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  const scan = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    scan.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
}
test("real shared preparation, explicitly agreed contact and scanned file version reach only the linked customer", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120000);
  const f = await fixture();
  await adminLogin(page, f.manager);
  await page.goto(`/courses/${f.run}/workspace`);
  const prep = page.getByRole("region", {
    name: "Gemeinsame Kursvorbereitung",
    exact: true,
  });
  await prep
    .getByLabel("Neuer Vorbereitungspunkt", { exact: true })
    .fill("Fictional lab accounts ready");
  await prep.getByRole("button", { name: "Hinzufügen", exact: true }).click();
  const checkbox = prep.getByRole("checkbox", {
    name: "Fictional lab accounts ready",
    exact: true,
  });
  await expect(checkbox).toBeVisible();
  await checkbox.click();
  await expect(checkbox).toBeChecked();
  const contact = page.getByRole("region", {
    name: "Kursinformationen & Kontakt",
    exact: true,
  });
  await contact
    .getByLabel("Kundenkontakt für diesen Kurs freigeben", { exact: true })
    .selectOption(f.contact);
  await contact.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(
    contact.getByText("course@example.invalid", { exact: false }),
  ).toBeVisible();
  await page.goto("/files");
  await page
    .getByRole("button", { name: "Datei hochladen", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  const name = `Agreed-${f.token}.txt`,
    bytes = Buffer.from("Fictional malware-scanned agreed course material.");
  await dialog
    .getByLabel("Datei auswählen", { exact: true })
    .setInputFiles({ name, mimeType: "text/plain", buffer: bytes });
  await dialog
    .getByRole("button", { name: "Datei hochladen", exact: true })
    .click();
  await expect(dialog).toBeHidden({ timeout: 45000 });
  await page.goto(`/courses/${f.run}/workspace`);
  const resources = page.getByRole("region", {
    name: "Vereinbarte Materialien & Berichte",
    exact: true,
  });
  const selected = await checked(
    f.service
      .from("documents")
      .select("current_version_id")
      .eq("original_name", name)
      .single(),
  );
  await resources
    .getByLabel("Geprüfte Dateifassung", { exact: true })
    .selectOption(selected.current_version_id);
  await resources
    .getByRole("button", { name: "Fassung freigeben", exact: true })
    .click();
  await expect(resources.getByText(name, { exact: true })).toBeVisible();
  const otherContext = await browser.newContext({
    viewport: page.viewportSize() ?? undefined,
  });
  const customer = await otherContext.newPage();
  try {
    await login(customer, f.client.email);
    await customer.goto("/learning");
    await customer.getByRole("link", { name: f.title, exact: true }).click();
    await expect(
      customer.getByRole("checkbox", {
        name: "Fictional lab accounts ready",
        exact: true,
      }),
    ).toBeChecked();
    await expect(
      customer.getByRole("checkbox", {
        name: "Fictional lab accounts ready",
        exact: true,
      }),
    ).toBeDisabled();
    await expect(
      customer.getByText("Private organisation note stays hidden", {
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      customer.getByRole("region", { name: "Fragen & Antworten", exact: true }),
    ).toHaveCount(0);
    const download = customer.waitForEvent("download");
    await customer
      .getByRole("region", {
        name: "Vereinbarte Materialien & Berichte",
        exact: true,
      })
      .getByRole("button", { name: "Herunterladen", exact: true })
      .click();
    const file = await download;
    expect(await readFile((await file.path())!)).toEqual(bytes);
    await customer.getByLabel("Sprache", { exact: true }).selectOption("en");
    await customer.getByLabel("Theme", { exact: true }).selectOption("dark");
    await expect(
      customer.getByRole("region", {
        name: "Shared course preparation",
        exact: true,
      }),
    ).toBeVisible();
    await a11y(customer);
    await customer.screenshot({
      path: `docs/screenshots/${info.project.name}-course-client-workspace.png`,
      fullPage: true,
    });
  } finally {
    await otherContext.close();
  }
});
test("enrolled learner persists private notes, posts course questions, passes eligible quiz and downloads a protected completion PDF", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const f = await fixture();
  const teacher = api(process.env.SUPABASE_ANON_KEY!);
  await checked(
    teacher.auth.signInWithPassword({
      email: f.teacher.email,
      password: process.env.E2E_PASSWORD!,
    }),
  );
  const action = (
    name: string,
    payload: Record<string, unknown>,
    version = 0,
  ) =>
    checked(
      teacher.rpc("course_workspace_action", {
        p_run_id: f.run,
        p_action: name,
        p_payload: payload,
        p_expected_version: version,
      }),
    );
  await action("attendance_verify", {
    session_id: f.session,
    user_id: f.learner.id,
    state: "attended",
    minutes: 60,
    reason: "Fictional signed register checked",
  });
  await action("quiz_config", {
    questions: [
      { prompt: "Read a directory?", options: ["ls", "rm"], correct: 0 },
    ],
    pass_percent: 80,
    max_attempts: 2,
    published: true,
  });
  await login(page, f.learner.email);
  await page.goto("/learning");
  await page.getByRole("link", { name: f.title, exact: true }).click();
  const notebook = page.locator(".learning-panel").filter({
    has: page.getByRole("heading", {
      name: "Mein privates Kursnotizbuch",
      exact: true,
    }),
  });
  await notebook
    .getByLabel("Persönliche Kursnotizen", { exact: true })
    .fill("Fictional private notebook persists");
  await notebook
    .getByRole("button", { name: "Speichern", exact: true })
    .click();
  await expect(
    notebook.getByText("Änderung auf dem Server gespeichert.", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByLabel("Persönliche Kursnotizen", { exact: true }),
  ).toHaveValue("Fictional private notebook persists");
  const questions = page.getByRole("region", {
    name: "Fragen & Antworten",
    exact: true,
  });
  await questions
    .getByLabel("Neue Kursfrage", { exact: true })
    .fill("Fictional question about least privilege");
  await questions
    .getByRole("button", { name: "Frage veröffentlichen", exact: true })
    .click();
  await expect(
    questions.getByText("Fictional question about least privilege", {
      exact: true,
    }),
  ).toBeVisible();
  const quiz = page.getByRole("region", { name: "Mini-Quiz", exact: true });
  await quiz.getByRole("radio", { name: "ls", exact: true }).check();
  await quiz
    .getByRole("button", { name: "Antworten verbindlich abgeben", exact: true })
    .click();
  await expect(quiz.getByText("Bestanden", { exact: false })).toBeVisible();
  const completion = page.getByRole("region", {
    name: "Mein Abschlussdokument",
    exact: true,
  });
  await completion
    .getByRole("button", {
      name: "Voraussetzungen prüfen und Dokument ausstellen",
      exact: true,
    })
    .click();
  await expect(
    completion.getByRole("button", { name: "Herunterladen", exact: true }),
  ).toBeVisible();
  const event = page.waitForEvent("download");
  await completion
    .getByRole("button", { name: "Herunterladen", exact: true })
    .click();
  const file = await event;
  const bytes = await readFile((await file.path())!);
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  expect(bytes.length).toBeGreaterThan(10000);
  const feedback = page.getByRole("region", {
    name: "Kursfeedback & Qualität",
    exact: true,
  });
  await feedback
    .getByLabel("Rückmeldung", { exact: true })
    .fill("Fictional practical feedback without personal details");
  const feedbackSaved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/rpc/course_workspace_action") &&
      response.request().method() === "POST" &&
      response.request().postDataJSON()?.p_action === "feedback" &&
      response.ok(),
  );
  await feedback
    .getByRole("button", { name: "Kursfeedback speichern", exact: true })
    .click();
  await feedbackSaved;
  await page.reload();
  await expect(feedback.getByLabel("Rückmeldung", { exact: true })).toHaveValue(
    "Fictional practical feedback without personal details",
  );
  await page.getByLabel("Sprache", { exact: true }).selectOption("en");
  await page.getByLabel("Theme", { exact: true }).selectOption("dark");
  await a11y(page);
  await page.screenshot({
    path: `docs/screenshots/${info.project.name}-course-participant-workspace.png`,
    fullPage: true,
  });
});
