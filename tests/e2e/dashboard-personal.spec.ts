import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import { api, actor, checked, login } from "./helpers/accounts-support";

test.skip(
  process.env.PORTAL_TEST_MODE !== "1",
  "Personal dashboard writes require the canonical disposable project.",
);
test("personal cards and teaching preparation persist in the real account across reload and language", async ({
  page,
  context,
}, testInfo) => {
  const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const teacher = await actor("Fictional teaching day UI lecturer", "lecturer");
  const job = randomUUID(),
    claim = randomUUID(),
    session = randomUUID(),
    suffix = randomUUID().slice(0, 8);
  const starts = DateTime.now()
    .setZone("Europe/Berlin")
    .startOf("day")
    .plus({ hours: 9 });
  await checked(
    service.from("jobs").insert({
      id: job,
      title: `Fictional teaching day ${suffix}`,
      customer_name: "Fictional teaching day academy",
      delivery_type: "online",
      status: "filled",
      location: "https://example.invalid/class",
      amount: 100,
      currency: "EUR",
      rate_unit: "fixed_total",
      total_amount: 100,
      terms: "Fictional whole course terms",
    }),
  );
  await checked(
    service.from("job_claims").insert({
      id: claim,
      job_id: job,
      lecturer_id: teacher.id,
      idempotency_key: randomUUID(),
      amount: 100,
      currency: "EUR",
      rate_unit: "fixed_total",
      total_amount: 100,
      terms: "Fictional whole course terms",
      terms_version: 1,
    }),
  );
  await checked(
    service.from("assignment_sessions").insert({
      id: session,
      claim_id: claim,
      lecturer_id: teacher.id,
      starts_at: starts.toUTC().toISO()!,
      ends_at: starts.plus({ hours: 1 }).toUTC().toISO()!,
    }),
  );
  await login(page, teacher.email);
  let teaching = page.getByRole("region", {
    name: "Mein Unterrichtstag",
    exact: true,
  });
  await expect(
    teaching.getByRole("link", {
      name: `Fictional teaching day ${suffix}`,
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    teaching.getByRole("link", { name: "Unterrichtslink öffnen", exact: true }),
  ).toHaveAttribute("href", "https://example.invalid/class");
  const ready = teaching.getByRole("checkbox", {
    name: "Unterlagen geprüft und vorbereitet",
    exact: true,
  });
  // The committed checklist changes only after its real save and refetch.
  // check() requires an immediate DOM toggle; click then await confirmation.
  await ready.click();
  await expect(ready).toBeEnabled();
  await expect(ready).toBeChecked();
  await page
    .getByRole("button", { name: "Dashboard anpassen", exact: true })
    .click();
  await page
    .getByRole("checkbox", {
      name: "Zuletzt hinzugefügte Dateien",
      exact: true,
    })
    .uncheck();
  await page
    .getByRole("button", {
      name: "Mein Unterrichtstag nach unten",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Dashboard speichern", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Dashboard speichern", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  teaching = page.getByRole("region", {
    name: "Mein Unterrichtstag",
    exact: true,
  });
  await expect(
    teaching.getByRole("checkbox", {
      name: "Unterlagen geprüft und vorbereitet",
      exact: true,
    }),
  ).toBeChecked();
  await expect(
    page.getByRole("region", {
      name: "Zuletzt hinzugefügte Dateien",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page
      .locator(".dashboard-widgets > .dashboard-widget-slot")
      .first()
      .getByRole("region", { name: "Nachrichten & Meldungen", exact: true }),
  ).toBeVisible();
  await context.setOffline(true);
  await expect(
    teaching.getByRole("checkbox", {
      name: "Unterrichtslink oder Raum geprüft",
      exact: true,
    }),
  ).toBeDisabled();
  await context.setOffline(false);
  await page.getByLabel("Sprache", { exact: true }).selectOption("en");
  await page.getByLabel("Theme", { exact: true }).selectOption("dark");
  const english = page.getByRole("region", {
    name: "My teaching day",
    exact: true,
  });
  await expect(
    english.getByRole("checkbox", {
      name: "Materials reviewed and prepared",
      exact: true,
    }),
  ).toBeChecked();
  await expect(
    english.getByRole("checkbox", {
      name: "Teaching link or room checked",
      exact: true,
    }),
  ).toBeEnabled();
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .filter(
          (animation) => animation.effect?.getTiming().iterations !== Infinity,
        )
        .map((animation) => animation.finished.catch(() => undefined)),
    );
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  const scan = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    scan.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
  await page.screenshot({
    path: `docs/screenshots/${testInfo.project.name}-dashboard-personal.png`,
    fullPage: true,
  });
});
