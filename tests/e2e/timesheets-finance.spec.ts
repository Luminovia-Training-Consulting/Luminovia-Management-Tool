/** Real time receipts, original-currency forecasts and gross-finance privacy.
 * Exact receipt IDs and per-fixture metadata distinguish legitimate period rows;
 * known and role-priced unknown cost fixtures never depend on earlier tests.
 */
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { DateTime } from "luxon";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  actor,
  api,
  checked,
  assertPasswordOnly,
  login,
  adminLogin,
} from "./helpers/accounts-support";

test("actual teaching time, password-only role review, protected PDFs and scoped Control Center work in DE/EN", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(120000);
  const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const suffix = randomUUID();
  const title = `Fictional actual teaching evidence ${suffix}`;
  const note = `Fictional actual classroom time ${suffix}`;
  const owner = await actor("Fictional time UI lecturer", "lecturer"),
    manager = await actor("Fictional time UI reviewer", "management");
  await checked(
    service
      .from("profiles")
      .update({ time_zone: "UTC" })
      .in("id", [owner.id, manager.id]),
  );
  const job = randomUUID(),
    claim = randomUUID(),
    session = randomUUID(),
    openJob = randomUUID();
  const starts = DateTime.utc()
    .minus({ days: 3 })
    .startOf("day")
    .plus({ hours: 8 });
  await checked(
    service.from("jobs").insert({
      id: job,
      title,
      customer_name: "Fictional time UI academy",
      delivery_type: "online",
      status: "filled",
      amount: 301,
      total_amount: 301,
      currency: "EUR",
      rate_unit: "fixed_total",
      terms: "Accepted fee remains unchanged by teaching hours",
    }),
  );
  await checked(
    service.from("job_claims").insert({
      id: claim,
      job_id: job,
      lecturer_id: owner.id,
      idempotency_key: randomUUID(),
      amount: 301,
      total_amount: 301,
      currency: "EUR",
      rate_unit: "fixed_total",
      terms: "Accepted fee remains unchanged by teaching hours",
      terms_version: 1,
    }),
  );
  await checked(
    service.from("assignment_sessions").insert({
      id: session,
      claim_id: claim,
      lecturer_id: owner.id,
      starts_at: starts.toISO()!,
      ends_at: starts.plus({ hours: 8 }).toISO()!,
    }),
  );
  await checked(
    service.from("job_sessions").insert({
      job_id: job,
      starts_at: starts.toISO()!,
      ends_at: starts.plus({ hours: 8 }).toISO()!,
    }),
  );
  // Both browser projects share the same owned database. Give each one a
  // separate future day (desktop +47, mobile +48) within the default 60-day
  // window; unique titles do not isolate month-wide financial aggregates.
  // The explicit one-day scenario below then contains only this project's
  // known AUD offer and recipient-priced unknown EUR offer.
  const projectIndex = testInfo.config.projects.findIndex(
    (project) => project.name === testInfo.project.name,
  );
  expect(projectIndex).toBeGreaterThanOrEqual(0);
  const next = DateTime.utc()
    .plus({ days: 47 + projectIndex })
    .startOf("day")
    .plus({ hours: 8 });
  await checked(
    service.from("jobs").insert({
      id: openJob,
      title: `Fictional unstaffed scenario course ${suffix}`,
      customer_name: "Fictional time UI academy",
      delivery_type: "online",
      status: "published",
      amount: 201,
      total_amount: 201,
      currency: "AUD",
      rate_unit: "fixed_total",
      terms: "Fictional future course offer",
    }),
  );
  await checked(
    service.from("job_sessions").insert({
      job_id: openJob,
      starts_at: next.toISO()!,
      ends_at: next.plus({ hours: 6 }).toISO()!,
    }),
  );
  // A password-only administrator creates an actual role-priced EUR offer.
  // Management must see its cost as unknown, never a privacy sentinel zero;
  // the unrelated fixed AUD offer above has a known contractual cost.
  const pricingActor = await actor(
    "Fictional scenario pricing administrator",
    "admin",
  );
  const pricing = api(process.env.SUPABASE_ANON_KEY!);
  expect(
    (
      await pricing.auth.signInWithPassword({
        email: pricingActor.email,
        password: process.env.E2E_PASSWORD!,
      })
    ).error,
  ).toBeNull();
  await assertPasswordOnly(pricing);
  const organisation = randomUUID();
  await checked(
    service.from("organisations").insert({
      id: organisation,
      name: `Fictional scenario academy ${suffix}`,
      time_zone: "UTC",
    }),
  );
  await checked(
    pricing.rpc("create_capacity_job", {
      p_payload: {
        title: `Fictional unknown recipient cost ${suffix}`,
        description: "Fictional complete future teaching block",
        delivery_type: "online",
        location: "https://example.invalid/scenario",
        time_zone: "UTC",
        status: "published",
        gross_amount: 402,
        gross_total_amount: 402,
        currency: "EUR",
        rate_unit: "fixed_total",
        terms: "Fictional recipient-specific future agreement",
        requires_contract: false,
        topic_ids: [],
        sessions: [
          {
            starts_at: next.toISO()!,
            ends_at: next.plus({ hours: 6 }).toISO()!,
          },
        ],
      },
      p_capacity: 1,
      p_request_id: randomUUID(),
      p_organisation_id: organisation,
      p_platform_percent: null,
    }),
  );
  const context = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL,
    viewport: testInfo.project.use.viewport,
    isMobile: testInfo.project.use.isMobile,
    hasTouch: testInfo.project.use.hasTouch,
  });
  const review = await context.newPage();
  let failed = false;
  let originalFailure: unknown;
  let cleanupErrors: unknown[];
  try {
    await login(page, owner.email);
    await page.goto("/timesheets");
    await page
      .getByRole("button", { name: "Unterrichtszeit erfassen", exact: true })
      .click();
    const form = page.getByRole("dialog");
    await form
      .getByLabel("Bestätigter Unterrichtstermin", { exact: true })
      .selectOption(session);
    await form.getByLabel("Pause in Minuten", { exact: true }).fill("30");
    await form
      .getByLabel("Notiz zur geleisteten Zeit", { exact: true })
      .fill(note);
    const savedResponse = page.waitForResponse((response) => {
      if (!new URL(response.url()).pathname.endsWith("/rpc/save_timesheet"))
        return false;
      return (
        response.request().postDataJSON().p_payload?.session_id === session
      );
    });
    await form
      .getByRole("button", { name: "Zeitnachweis speichern", exact: true })
      .click();
    const saved = await savedResponse;
    expect(saved.ok()).toBe(true);
    const receipt = (await saved.json()) as {
      id: string;
      session_id: string;
      claim_id: string;
      job_id: string;
      lecturer_id: string;
      state: string;
      minutes: number;
    };
    expect(receipt).toMatchObject({
      session_id: session,
      claim_id: claim,
      job_id: job,
      lecturer_id: owner.id,
      state: "draft",
      minutes: 450,
    });
    expect(receipt.id).toMatch(/^[0-9a-f-]{36}$/);
    await expect(form).not.toBeVisible();
    let card = page.getByRole("article", {
      name: `${title} · ${owner.name}`,
      exact: true,
    });
    await expect(card.getByText(/450 Minuten/)).toBeVisible();
    await card
      .getByRole("button", { name: "Zur Prüfung einreichen", exact: true })
      .click();
    await expect(card.getByText(/· Zur Prüfung eingereicht$/)).toBeVisible();
    await expect(
      card.getByRole("button", { name: "Entwurf bearbeiten", exact: true }),
    ).toHaveCount(0);
    await expect(
      card.getByRole("button", { name: "Zeitnachweis freigeben", exact: true }),
    ).toHaveCount(0);
    await adminLogin(review, manager);
    await review.goto("/timesheets");
    await review
      .getByRole("checkbox", {
        name: "Finanzprüfung für alle Lehrkräfte",
        exact: true,
      })
      .check();
    const management = review
      .getByRole("article", {
        name: `${title} · ${owner.name}`,
        exact: true,
      })
      .filter({ has: review.locator(`[id="review-${receipt.id}"]`) });
    await expect(management).toHaveCount(1);
    await management
      .getByLabel("Begründung der Prüfung oder Korrektur", { exact: true })
      .fill("Fictional reviewed teaching evidence");
    const reviewedResponse = review.waitForResponse((response) => {
      if (!new URL(response.url()).pathname.endsWith("/rpc/manage_timesheet"))
        return false;
      const input = response.request().postDataJSON();
      return input.p_id === receipt.id && input.p_action === "approve";
    });
    await management
      .getByRole("button", { name: "Zeitnachweis freigeben", exact: true })
      .click();
    const approved = await reviewedResponse;
    expect(approved.ok()).toBe(true);
    expect(await approved.json()).toMatchObject({
      id: receipt.id,
      session_id: session,
      claim_id: claim,
      lecturer_id: owner.id,
      state: "approved",
      minutes: 450,
    });
    await expect(management.getByText(/· Freigegeben$/)).toBeVisible();
    await page.reload();
    card = page.getByRole("article", {
      name: `${title} · ${owner.name}`,
      exact: true,
    });
    await expect(card.getByText(/· Freigegeben$/)).toBeVisible();
    await card
      .getByRole("button", { name: "Änderungsverlauf", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toContainText(
      "Fictional reviewed teaching evidence",
    );
    await page.keyboard.press("Escape");
    let downloading = page.waitForEvent("download");
    await card
      .getByRole("button", { name: "Auftragsbestätigung als PDF", exact: true })
      .click();
    let download = await downloading;
    let bytes = await readFile((await download.path())!);
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(500);
    downloading = page.waitForEvent("download");
    await page
      .getByRole("button", {
        name: "Honorarübersicht als PDF herunterladen",
        exact: true,
      })
      .click();
    download = await downloading;
    bytes = await readFile((await download.path())!);
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    await page.context().setOffline(true);
    await expect(
      page.getByRole("button", {
        name: "Zeitnachweise als CSV herunterladen",
        exact: true,
      }),
    ).toBeDisabled();
    await page.context().setOffline(false);
    await review.goto("/control-center");
    await expect(
      review.getByRole("heading", { name: "Control Center", exact: true }),
    ).toBeVisible();
    await expect(
      review
        .getByRole("region", { name: "Noch zu besetzen", exact: true })
        .getByRole("link", {
          name: `Fictional unstaffed scenario course ${suffix}`,
          exact: true,
        }),
    ).toBeVisible();
    await expect(
      review
        .getByRole("region", { name: "Fehlende Kursunterlagen", exact: true })
        .getByRole("link", {
          name: title,
          exact: true,
        }),
    ).toBeVisible();
    const from = next.toISODate()!;
    const until = next.plus({ days: 1 }).toISODate()!;
    await review.getByLabel("Zeitraum von", { exact: true }).fill(from);
    await review
      .getByLabel("Zeitraum bis (ausschließlich)", { exact: true })
      .fill(until);
    await review
      .getByRole("button", { name: "Zeitraum anzeigen", exact: true })
      .click();
    await review
      .getByLabel(
        "Angenommene Wahrscheinlichkeit für offene Angebote und Anfragen (%)",
        { exact: true },
      )
      .fill("25");
    const forecastResponse = review.waitForResponse((response) => {
      if (!new URL(response.url()).pathname.endsWith("/rpc/finance_forecast"))
        return false;
      const input = response.request().postDataJSON();
      return (
        input.p_from === from &&
        input.p_until === until &&
        input.p_pipeline_probability === 0.25
      );
    });
    await review
      .getByRole("button", { name: "Szenario berechnen", exact: true })
      .click();
    const scenario = await forecastResponse;
    expect(scenario.ok()).toBe(true);
    const forecast = (await scenario.json()) as {
      gross_authorized: boolean;
      months: {
        month: string;
        currency: string;
        pipeline_lecturer_cost_known: number | null;
        pipeline_cost_unknown_positions: number;
        accepted_gross_known: number | null;
        accepted_margin_known: number | null;
        pipeline_gross_known: number | null;
      }[];
    };
    expect(forecast.gross_authorized).toBe(false);
    const month = next.startOf("month").toISODate()!;
    const known = forecast.months.find(
      (item) => item.month === month && item.currency === "AUD",
    );
    const unknown = forecast.months.find(
      (item) => item.month === month && item.currency === "EUR",
    );
    expect(known).toMatchObject({
      pipeline_lecturer_cost_known: 50.25,
      pipeline_cost_unknown_positions: 0,
    });
    expect(unknown).toMatchObject({
      pipeline_lecturer_cost_known: null,
      pipeline_cost_unknown_positions: 1,
    });
    for (const bucket of [known, unknown])
      expect(bucket).toMatchObject({
        accepted_gross_known: null,
        accepted_margin_known: null,
        pipeline_gross_known: null,
      });
    const forecastRegion = review.getByRole("region", {
      name: "Finanzszenario",
      exact: true,
    });
    const row = (currency: string) =>
      forecastRegion
        .getByRole("row")
        .filter({
          has: review.getByRole("rowheader", { name: month, exact: true }),
        })
        .filter({
          has: review.getByRole("cell", { name: currency, exact: true }),
        });
    await expect(row("AUD")).toHaveCount(1);
    await expect(row("AUD").getByRole("cell", { name: /50,25/ })).toBeVisible();
    await expect(row("EUR")).toHaveCount(1);
    await expect(
      row("EUR").getByRole("cell", { name: /Nicht verfügbar/ }),
    ).toContainText(
      /1 offene Position(?:en)? ohne verbindlich vereinbarte persönliche Vergütung/,
    );
    await expect(
      review.getByRole("columnheader", {
        name: "Bekannter Bruttoumsatz",
        exact: true,
      }),
    ).toHaveCount(0);
    await review.getByLabel("Sprache", { exact: true }).selectOption("en");
    await review.getByLabel("Theme", { exact: true }).selectOption("dark");
    await expect(
      review.getByRole("region", { name: "Unstaffed courses", exact: true }),
    ).toBeVisible();
    await review.evaluate(() => document.fonts.ready);
    await review.evaluate(async () => {
      await Promise.all(
        document
          .getAnimations()
          .filter(
            (animation) =>
              animation.effect?.getTiming().iterations !== Infinity,
          )
          .map((animation) => animation.finished.catch(() => undefined)),
      );
    });
    expect(
      (
        await new AxeBuilder({ page: review })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
          .analyze()
      ).violations.map((value) => value.id),
    ).toEqual([]);
    expect(
      await review.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await review.screenshot({
      path: testInfo.outputPath("control-center.png"),
      fullPage: true,
    });
    expect(
      await checked(
        service
          .from("job_claims")
          .select("total_amount,terms")
          .eq("id", claim)
          .single(),
      ),
    ).toEqual({
      total_amount: 301,
      terms: "Accepted fee remains unchanged by teaching hours",
    });
  } catch (error) {
    failed = true;
    originalFailure = error;
  } finally {
    const offline = await Promise.allSettled([
      page.context().setOffline(false),
    ]);
    const closed = await Promise.allSettled([
      context.close(),
      pricing.auth.signOut(),
    ]);
    cleanupErrors = [...offline, ...closed].flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
  }
  if (failed) throw originalFailure;
  if (cleanupErrors.length)
    throw new AggregateError(
      cleanupErrors,
      "Owned finance context cleanup failed",
    );
});
