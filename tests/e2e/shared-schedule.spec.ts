/** The manager and two independent lecturers share one versioned course schedule. */
import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import { actor, api, checked, login } from "./helpers/accounts-support";

test.skip(
  process.env.PORTAL_TEST_MODE !== "1",
  "Shared schedule writes require the disposable portal test project.",
);

test("staff and both lecturers approve adding a shared session in the internal portal", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(120_000);
  const manager = await actor("Fictional schedule manager", "admin");
  const first = await actor("Fictional first lecturer", "lecturer");
  const second = await actor("Fictional second lecturer", "lecturer");
  const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
  async function signedIn(user: { email: string }) {
    const client = api(process.env.SUPABASE_ANON_KEY!);
    await checked(
      client.auth.signInWithPassword({
        email: user.email,
        password: process.env.E2E_PASSWORD!,
      }),
      { requireData: true },
    );
    return client;
  }

  const zone = "Australia/Brisbane";
  const firstStart = DateTime.now()
    .setZone(zone)
    .plus({ days: 60 })
    .startOf("day")
    .set({ hour: 10 });
  const newStart = firstStart.plus({ days: 2 });
  const session = randomUUID();
  const company = randomUUID();
  const template = randomUUID();
  const course = randomUUID();
  const title = `Fictional shared course ${course.slice(0, 8)}`;
  await checked(
    service
      .from("organisations")
      .insert({ id: company, name: "Fictional shared academy" }),
  );
  await checked(
    service.from("course_templates").insert({ id: template, title }),
  );
  await checked(
    service.from("course_runs").insert({
      id: course,
      organisation_id: company,
      template_id: template,
      time_zone: zone,
      published: true,
    }),
  );
  await checked(
    service.from("course_sessions").insert({
      id: session,
      course_run_id: course,
      starts_at: firstStart.toISO(),
      ends_at: firstStart.plus({ hours: 1 }).toISO(),
    }),
  );
  const managerApi = await signedIn(manager);
  const defaults = await checked(
    managerApi.rpc("course_run_job_defaults", { p_course_run_id: course }),
    { requireData: true },
  );
  const offer = await checked(
    managerApi.rpc("create_course_run_job", {
      p_course_run_id: course,
      p_platform_percent: null,
      p_payload: {
        source_revision: defaults.source_revision,
        capacity: 2,
        gross_amount: 300,
        gross_total_amount: 300,
        currency: "AUD",
        rate_unit: "fixed_total",
        status: "published",
        terms: "Retained fictional terms",
        requires_contract: false,
      },
      p_client_id: randomUUID(),
    }),
    { requireData: true },
  );

  const firstApi = await signedIn(first);
  const secondApi = await signedIn(second);
  async function claim(client: typeof firstApi) {
    const quote = await checked(client.rpc("job_detail", { p_job_id: offer }), {
      requireData: true,
    });
    const receipt = await checked(
      client.rpc("claim_job", {
        p_job_id: offer,
        p_terms_version: quote.terms_version,
        p_idempotency_key: randomUUID(),
      }),
      { requireData: true },
    );
    expect(receipt.status).toBe("confirmed");
    return receipt.claim_id;
  }
  const firstClaim = await claim(firstApi);
  const secondClaim = await claim(secondApi);

  await login(page, manager.email);
  await page.goto("/changes");
  if (testInfo.project.use.isMobile) {
    await page.getByLabel("Sprache", { exact: true }).selectOption("en");
    await page.getByLabel("Theme", { exact: true }).selectOption("dark");
  }
  await page
    .getByRole("button", {
      name: /^(Änderungsantrag erstellen|Create change request)$/,
    })
    .click();
  const form = page.getByRole("dialog");
  await form
    .getByLabel(/^(Bestätigter Auftrag|Confirmed assignment)$/)
    .selectOption(firstClaim);
  await expect(
    form.getByText(/^(Beim Einreichen erhält|Submitting sends)/),
  ).toBeVisible();
  await expect(
    form.getByLabel(/^(Leistungsumfang|Scope of work)$/),
  ).toHaveCount(0);
  await form
    .getByLabel(/^(Begründung|Reason)$/)
    .fill(
      "Fictional schedule update agreed after participant availability review.",
    );
  await form
    .getByRole("button", { name: /^(Termin hinzufügen|Add session)$/ })
    .click();
  await form
    .getByLabel(/^(Beginn|Start) 2$/)
    .fill(newStart.toFormat("yyyy-MM-dd'T'HH:mm"));
  await form
    .getByLabel(/^(Ende|Finish) 2$/)
    .fill(newStart.plus({ hours: 1 }).toFormat("yyyy-MM-dd'T'HH:mm"));
  await form
    .getByRole("button", {
      name: /^(Entwurf online speichern|Save draft online)$/,
    })
    .click();
  await expect(page).toHaveURL(/\/changes\/[0-9a-f-]+$/);
  const initialRequest = page.url();
  await page
    .getByRole("button", {
      name: /^(Zur Zustimmung einreichen|Submit for consent)$/,
    })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: /0 (von|of) 2/ }),
  ).toBeVisible();

  const changes = (await checked(
    managerApi.rpc("assignment_changes", { p_id: null }),
    { requireData: true },
  )) as { id: string; claim_id: string }[];
  const related = changes.find(({ claim_id }) => claim_id === secondClaim);
  expect(related).toBeDefined();

  async function accept(at: typeof page, expectedApprovals: number) {
    await at
      .getByRole("checkbox", { name: /^(Ich habe Original|I have reviewed)/ })
      .check();
    const confirmed = at.waitForResponse(
      (response) =>
        response.url().endsWith("/rpc/assignment_change_action") &&
        response.request().method() === "POST",
    );
    const button = at.getByRole("button", {
      name: /^(Dieser Änderung zustimmen|Accept this amendment)$/,
    });
    await button.click();
    expect((await confirmed).status()).toBe(200);
    await expect(
      at.locator(".changes-decisions").getByText(/^(Erteilt|Granted)$/),
    ).toHaveCount(expectedApprovals);
  }

  await accept(page, 1);
  await page.goto("/changes/" + related!.id);
  await accept(page, 1);
  const options = {
    baseURL: process.env.E2E_BASE_URL,
    viewport: testInfo.project.use.viewport,
    isMobile: testInfo.project.use.isMobile,
    hasTouch: testInfo.project.use.hasTouch,
    deviceScaleFactor: testInfo.project.use.deviceScaleFactor,
  };
  const lecturerContext = await browser.newContext(options);
  try {
    const lecturerPage = await lecturerContext.newPage();
    await login(lecturerPage, first.email);
    await lecturerPage.goto(initialRequest);
    await accept(lecturerPage, 2);
    await page.reload();
    await expect(
      page.getByRole("status").filter({ hasText: /1 (von|of) 2/ }),
    ).toBeVisible();
    const apply = page.getByRole("button", {
      name: /^(Angenommene Änderung anwenden|Apply accepted amendment)$/,
    });
    await expect(apply).toHaveCount(0);

    const secondContext = await browser.newContext(options);
    try {
      const secondPage = await secondContext.newPage();
      await login(secondPage, second.email);
      await secondPage.goto("/changes/" + related!.id);
      await accept(secondPage, 2);
    } finally {
      await secondContext.close();
    }

    await page.reload();
    await expect(
      page.getByRole("status").filter({ hasText: /2 (von|of) 2/ }),
    ).toBeVisible();
    await apply.click();
    await expect(
      page.getByRole("status").filter({
        hasText: /wurden gemeinsam angewendet|were applied together/,
      }),
    ).toBeVisible();
    const updated = await checked(
      service
        .from("course_sessions")
        .select("id,starts_at")
        .eq("course_run_id", course)
        .order("starts_at"),
      { requireData: true },
    );
    expect(updated).toHaveLength(2);
    expect(updated[0].id).toBe(session);
    expect(Date.parse(updated[0].starts_at)).toBe(firstStart.toMillis());
    expect(Date.parse(updated[1].starts_at)).toBe(newStart.toMillis());
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(
      await page.evaluate(() => document.documentElement.clientWidth),
    );
    const reconciliationErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" && message.text().includes("same key"))
        reconciliationErrors.push(message.text());
    });
    await page.goto("/finance");
    const positionRows = page.locator(".platform-revenue tbody tr").filter({
      has: page.locator(`a[href="/jobs/${offer}"]`),
    });
    await expect(positionRows).toHaveCount(2);
    await expect(positionRows.filter({ hasText: first.name })).toHaveCount(1);
    await expect(positionRows.filter({ hasText: second.name })).toHaveCount(1);
    expect(reconciliationErrors).toEqual([]);
  } finally {
    await lecturerContext.close();
  }
});
