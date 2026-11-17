import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import {
  api,
  actor,
  checked,
  login,
  adminLogin,
} from "./helpers/accounts-support";

test("real lecturer delivery, independent correction and confirmation preserve immutable revisions", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(100000);
  const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!),
    teacher = await actor("Fictional delivery teacher", "lecturer"),
    manager = await actor("Fictional delivery manager", "admin"),
    peer = await actor("Fictional isolated teacher", "lecturer");
  const [job, claim, session] = Array.from({ length: 3 }, randomUUID);
  const title = `Fictional delivery ${testInfo.project.name}`;
  await checked(
    service
      .from("jobs")
      .insert({
        id: job,
        title,
        customer_name: "Fictional delivery academy",
        delivery_type: "online",
        status: "filled",
        location: "https://example.invalid/class",
        amount: 125,
        currency: "AUD",
        rate_unit: "fixed_total",
        total_amount: 125,
        terms: "Fictional immutable agreement",
      }),
  );
  await checked(
    service
      .from("job_claims")
      .insert({
        id: claim,
        job_id: job,
        lecturer_id: teacher.id,
        idempotency_key: randomUUID(),
        amount: 125,
        currency: "AUD",
        rate_unit: "fixed_total",
        total_amount: 125,
        terms: "Fictional immutable agreement",
        terms_version: 1,
      }),
  );
  await checked(
    service
      .from("assignment_sessions")
      .insert({
        id: session,
        claim_id: claim,
        lecturer_id: teacher.id,
        starts_at: "2001-01-01T09:00:00Z",
        ends_at: "2001-01-01T10:00:00Z",
      }),
  );
  await login(page, teacher.email);
  await page.goto(`/delivery?session=${session}`);
  const detail = page.getByRole("region", { name: title, exact: true });
  await expect(
    detail.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  await detail
    .getByLabel("Hinweise zur Durchführung", { exact: true })
    .fill("Fictional lesson delivered as scheduled");
  await detail
    .getByRole("button", { name: "Entwurf speichern", exact: true })
    .click();
  await expect(
    page.getByText("Änderung vom Server bestätigt.", { exact: true }),
  ).toBeVisible();
  await detail
    .getByRole("button", {
      name: "Unterrichtsnachweis einreichen",
      exact: true,
    })
    .click();
  await expect(
    detail.getByText("Status: Eingereicht", { exact: true }),
  ).toBeVisible();
  await expect(
    detail.getByRole("button", { name: "Leistung bestätigen", exact: true }),
  ).toHaveCount(0);
  const managerContext = await browser.newContext({
    viewport: page.viewportSize(),
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173",
  });
  try {
    const managerPage = await managerContext.newPage();
    await adminLogin(managerPage, manager);
    await managerPage.goto(`/delivery?session=${session}`);
    const review = managerPage.getByRole("region", {
      name: title,
      exact: true,
    });
    await review
      .getByLabel("Begründung / Rückmeldung", { exact: true })
      .fill("Please clarify fictional interruption");
    await review
      .getByRole("button", { name: "Korrektur anfordern", exact: true })
      .click();
    await expect(
      review.getByText("Status: Korrektur angefordert", { exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      detail.getByLabel("Begründung der Korrektur", { exact: true }),
    ).toBeVisible();
    await detail
      .getByLabel("Ergebnis", { exact: true })
      .selectOption("partial");
    await detail
      .getByLabel("Tatsächliches Ende", { exact: true })
      .fill("2001-01-01T10:30");
    await detail
      .getByLabel("Hinweise zur Durchführung", { exact: true })
      .fill("Fictional classroom connection interruption");
    await detail
      .getByLabel("Begründung der Korrektur", { exact: true })
      .fill("Corrected actual teaching duration");
    await detail
      .getByRole("button", { name: "Entwurf speichern", exact: true })
      .click();
    await expect(
      detail.getByRole("button", {
        name: "Unterrichtsnachweis einreichen",
        exact: true,
      }),
    ).toBeEnabled();
    await detail
      .getByRole("button", {
        name: "Unterrichtsnachweis einreichen",
        exact: true,
      })
      .click();
    await expect(
      detail.getByText("Status: Eingereicht", { exact: true }),
    ).toBeVisible();
    await expect(
      detail.getByText("Fassung 1 · Vollständig erbracht", { exact: true }),
    ).toBeVisible();
    await expect(
      detail.getByText("Fassung 2 · Teilweise erbracht", { exact: true }),
    ).toBeVisible();
    await managerPage.reload();
    await review
      .getByRole("button", { name: "Leistung bestätigen", exact: true })
      .click();
    await expect(
      review.getByText("Status: Bestätigt", { exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      detail.getByText("Status: Bestätigt", { exact: true }),
    ).toBeVisible();
    await page.getByLabel("Sprache", { exact: true }).selectOption("en");
    await page.getByLabel("Theme", { exact: true }).selectOption("dark");
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Teaching delivery",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const exportButton = page.getByRole("button", {
      name: "Export loaded records as CSV",
      exact: true,
    });
    await exportButton.focus();
    await expect(exportButton).toBeFocused();
    const downloadPromise = page.waitForEvent("download");
    await exportButton.press("Enter");
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(
      /^luminovia-delivery-en\.csv$/,
    );
    await page.evaluate(() => document.fonts.ready);
    const accessibility = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(accessibility.violations).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `.local/screenshots/${testInfo.project.name}-delivery-dark-en.png`,
      fullPage: true,
    });
    const peerApi = api(process.env.SUPABASE_ANON_KEY!);
    await checked(
      peerApi.auth.signInWithPassword({
        email: peer.email,
        password: process.env.E2E_PASSWORD!,
      }),
    );
    expect(
      (await peerApi.rpc("delivery_session", { p_session_id: session })).error
        ?.code,
    ).toBe("42501");
    const snapshot = await checked(
      service
        .from("job_claims")
        .select("amount,total_amount,currency,terms")
        .eq("id", claim)
        .single(),
    );
    expect(snapshot).toEqual({
      amount: 125,
      total_amount: 125,
      currency: "AUD",
      terms: "Fictional immutable agreement",
    });
  } finally {
    await managerContext.close();
  }
  // These UUID-bound fictional records belong to the canonical disposable stack;
  // its final teardown removes immutable evidence without altering live data.
});
