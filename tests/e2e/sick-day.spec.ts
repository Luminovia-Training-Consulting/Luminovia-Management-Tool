import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import { actor, api, checked, login, signOut } from "./helpers/accounts-support";

test.skip(process.env.PORTAL_TEST_MODE !== "1", "Use the isolated portal.");

test("a sick day returns only that day's sessions to the top of normal job discovery", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const administrator = await actor(
    "Fictional sick-day administrator",
    "admin",
  );
  const lecturer = await actor("Fictional sick-day lecturer", "lecturer");
  const available = await actor("Fictional replacement lecturer", "lecturer");
  const blocked = await actor("Fictional restricted lecturer", "lecturer");
  const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const org = randomUUID(),
    template = randomUUID(),
    run = randomUUID(),
    original = randomUUID(),
    regular = randomUUID();
  const prefix = `Fictional sick-day ${randomUUID().slice(0, 8)}`;
  const title = `${prefix} course`;
  const zone = "Europe/Berlin";
  const first = DateTime.now()
    .setZone(zone)
    .plus({ days: 4 })
    .startOf("day")
    .plus({ hours: 9 });
  const second = first.plus({ days: 1 });
  const times = [first, second, second.plus({ hours: 3 })];
  await checked(
    service
      .from("organisations")
      .insert({ id: org, name: `${prefix} organisation` }),
  );
  await checked(
    service.from("course_templates").insert({ id: template, title }),
  );
  await checked(
    service.from("course_runs").insert({
      id: run,
      template_id: template,
      organisation_id: org,
      time_zone: zone,
    }),
  );
  const offer = {
    customer_name: `${prefix} organisation`,
    delivery_type: "online",
    time_zone: zone,
    status: "published",
    amount: 25,
    currency: "EUR",
    rate_unit: "per_hour",
    requires_contract: false,
    terms: "Fictional teaching terms for isolated QA",
  };
  await checked(
    service.from("jobs").insert([
      { ...offer, id: original, title, total_amount: 150, course_run_id: run },
      {
        ...offer,
        id: regular,
        title: `${prefix} ordinary offer`,
        total_amount: 50,
      },
    ]),
  );
  await checked(
    service.from("job_sessions").insert([
      ...times.map((start) => ({
        job_id: original,
        starts_at: start.toISO(),
        ends_at: start.plus({ hours: 2 }).toISO(),
      })),
      {
        job_id: regular,
        starts_at: first.minus({ days: 1 }).toISO(),
        ends_at: first.minus({ days: 1 }).plus({ hours: 2 }).toISO(),
      },
    ]),
  );

  async function session(email: string) {
    const client = api(process.env.SUPABASE_ANON_KEY!);
    await checked(
      client.auth.signInWithPassword({
        email,
        password: process.env.E2E_PASSWORD!,
      }),
    );
    return client;
  }

  const originalClaim = await checked(
    (await session(lecturer.email)).rpc("claim_job", {
      p_job_id: original,
      p_terms_version: 1,
      p_idempotency_key: randomUUID(),
    }),
    { requireData: true },
  );
  expect(originalClaim.status).toBe("confirmed");
  await checked(
    (await session(administrator.email)).rpc("set_company_lecturer_block", {
      p_organisation_id: org,
      p_lecturer_id: blocked.id,
      p_blocked: true,
      p_expected_version: 0,
    }),
  );

  await login(page, lecturer.email);
  await page.goto(`/jobs/${original}`);
  await page
    .getByRole("button", { name: "Für einen Unterrichtstag krankmelden" })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Für einen Unterrichtstag krankmelden",
  });
  await dialog.getByLabel("Unterrichtstag").selectOption(second.toISODate()!);
  const confirmed = page.waitForResponse(
    (response) =>
      response.url().endsWith("/rpc/report_assignment_sick_day") &&
      response.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "Krankmeldung bestätigen" }).click();
  const response = await confirmed;
  expect(response.ok()).toBe(true);
  const receipt = await response.json();
  expect(receipt).toMatchObject({
    released_sessions: 2,
    teaching_date: second.toISODate(),
  });
  await expect(page.getByText(/Krankmeldung erfasst/)).toBeVisible();

  const retained = await checked(
    service
      .from("assignment_sessions")
      .select("starts_at")
      .eq("claim_id", originalClaim.claim_id)
      .is("released_at", null),
    { requireData: true },
  );
  expect(retained.map(({ starts_at }) => Date.parse(starts_at))).toEqual([
    first.toMillis(),
  ]);

  const denied = await (
    await session(blocked.email)
  ).rpc("job_detail", { p_job_id: receipt.job_id });
  expect(denied.error?.code).toBe("42501");

  await signOut(page);
  await login(page, available.email);
  await page.goto(`/jobs?q=${encodeURIComponent(prefix)}`);
  const cards = page.locator(".jobs-grid > .job-card");
  await expect(cards.first()).toContainText("Notfall");
  await expect(cards.first().getByRole("link")).toHaveAttribute(
    "href",
    `/jobs/${receipt.job_id}`,
  );
  await expect(cards).toHaveCount(2);
  await cards.first().getByRole("link").click();
  await page.getByRole("checkbox", { name: "Konditionen akzeptieren" }).check();
  const allocation = page.waitForResponse(
    (result) =>
      result.url().endsWith("/rpc/claim_job") &&
      result.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Auftrag übernehmen", exact: true })
    .click();
  const won = await allocation;
  expect(won.ok()).toBe(true);
  expect(await won.json()).toMatchObject({ status: "confirmed" });
  await expect(
    page.getByText("Dein Auftrag ist bestätigt. Alle Termine sind reserviert."),
  ).toBeVisible();
});
