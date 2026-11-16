import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { DateTime } from "luxon";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  actor,
  api,
  checked,
  login,
  adminLogin,
} from "./helpers/accounts-support";

test("actual teaching time, MFA review, protected PDFs and scoped Control Center work in DE/EN", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(120000);
  const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
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
      title: "Fictional actual teaching evidence",
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
  const next = DateTime.utc()
    .plus({ days: 5 })
    .startOf("day")
    .plus({ hours: 8 });
  await checked(
    service.from("jobs").insert({
      id: openJob,
      title: "Fictional unstaffed scenario course",
      customer_name: "Fictional time UI academy",
      delivery_type: "online",
      status: "published",
      amount: 201,
      total_amount: 201,
      currency: "EUR",
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
  const context = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL,
    viewport: testInfo.project.use.viewport,
    isMobile: testInfo.project.use.isMobile,
    hasTouch: testInfo.project.use.hasTouch,
  });
  const review = await context.newPage();
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
      .fill("Fictional actual classroom time");
    await form
      .getByRole("button", { name: "Zeitnachweis speichern", exact: true })
      .click();
    await expect(form).not.toBeVisible();
    let card = page.getByRole("article", {
      name: "Fictional actual teaching evidence · Fictional time UI lecturer",
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
    const management = review.getByRole("article", {
      name: "Fictional actual teaching evidence · Fictional time UI lecturer",
      exact: true,
    });
    await management
      .getByLabel("Begründung der Prüfung oder Korrektur", { exact: true })
      .fill("Fictional reviewed teaching evidence");
    await management
      .getByRole("button", { name: "Zeitnachweis freigeben", exact: true })
      .click();
    await expect(management.getByText(/· Freigegeben$/)).toBeVisible();
    await page.reload();
    card = page.getByRole("article", {
      name: "Fictional actual teaching evidence · Fictional time UI lecturer",
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
          name: "Fictional unstaffed scenario course",
          exact: true,
        }),
    ).toBeVisible();
    await expect(
      review
        .getByRole("region", { name: "Fehlende Kursunterlagen", exact: true })
        .getByRole("link", {
          name: "Fictional actual teaching evidence",
          exact: true,
        }),
    ).toBeVisible();
    await review
      .getByLabel(
        "Angenommene Wahrscheinlichkeit für offene Angebote und Anfragen (%)",
        { exact: true },
      )
      .fill("25");
    await review
      .getByRole("button", { name: "Szenario berechnen", exact: true })
      .click();
    await expect(
      review.getByRole("cell", { name: /50,25/ }).first(),
    ).toBeVisible();
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
  } finally {
    await page.context().setOffline(false);
    await context.close();
  }
});
