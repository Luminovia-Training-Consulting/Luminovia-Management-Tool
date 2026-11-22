/** Real role-scoped browser correction of historical evidence on a released allocation. */
import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { actor, api, checked, login } from "./helpers/accounts-support";

test.skip(
  process.env.PORTAL_TEST_MODE !== "1",
  "Teaching evidence writes require the disposable portal test project.",
);

test("reviewer reopens exact evidence and lecturer submits a retained correction", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(100_000);
  const [job, claim, session] = Array.from({ length: 3 }, randomUUID);
  const title = `Fictional protected evidence ${job.slice(0, 8)}`;
  const teacher = await actor("Fictional delivery lecturer", "lecturer");
  const manager = await actor("Fictional delivery reviewer", "admin");
  const outsider = await actor("Fictional delivery outsider", "lecturer");
  const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const start = "2001-01-01T09:12:30Z",
    end = "2001-01-01T10:12:30Z";
  await checked(
    service.from("jobs").insert({
      id: job,
      title,
      customer_name: "Fictional delivery organisation",
      delivery_type: "onsite",
      status: "filled",
      amount: 100,
      total_amount: 100,
      currency: "EUR",
      rate_unit: "fixed_total",
      terms: "Fictional immutable teaching terms",
      time_zone: "Europe/Berlin",
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
      terms: "Fictional immutable teaching terms",
      terms_version: 1,
    }),
  );
  await checked(
    service.from("assignment_sessions").insert({
      id: session,
      claim_id: claim,
      lecturer_id: teacher.id,
      starts_at: start,
      ends_at: end,
    }),
  );
  const teacherApi = api(process.env.SUPABASE_ANON_KEY!);
  await checked(
    teacherApi.auth.signInWithPassword({
      email: teacher.email,
      password: process.env.E2E_PASSWORD!,
    }),
    { requireData: true },
  );
  await checked(
    teacherApi.rpc("save_delivery_draft", {
      p_session_id: session,
      p_expected_version: 0,
      p_request_id: randomUUID(),
      p_payload: {
        outcome: "completed",
        actual_start: start,
        actual_end: end,
        time_zone: "Europe/Berlin",
        notes: "Fictional original evidence",
        correction_reason: "",
      },
    }),
  );
  await checked(
    teacherApi.rpc("submit_delivery", {
      p_session_id: session,
      p_expected_version: 1,
      p_request_id: randomUUID(),
    }),
  );
  await checked(
    service
      .from("assignment_sessions")
      .update({
        released_at: new Date().toISOString(),
      })
      .eq("id", session),
  );

  const context = await browser.newContext(testInfo.project.use);
  const outsiderContext = await browser.newContext(testInfo.project.use);
  const teaching = await context.newPage();
  const other = await outsiderContext.newPage();
  try {
    await login(page, manager.email);
    await page.goto("/notifications");
    const reviewNotice = page
      .locator(".notification-row")
      .filter({ hasText: title })
      .filter({
        hasText:
          /Leistungsnachweis eingereicht|Delivery confirmation submitted/,
      });
    await reviewNotice.getByRole("link").click();
    await expect(page).toHaveURL(new RegExp(`/delivery\\?session=${session}$`));
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    const askCorrection = page.getByRole("button", {
      name: /^(Korrektur anfragen|Request a correction)$/,
    });
    await expect(askCorrection).toBeDisabled();
    await page
      .getByLabel(/^(Begründung für die Prüfung|Review reason)$/)
      .fill("Verify the duration");
    await askCorrection.click();
    await expect(
      page.getByText(
        /^(Der Server hat den Leistungsnachweis aktualisiert|The server updated the delivery evidence)\.$/,
      ),
    ).toBeVisible();

    await login(teaching, teacher.email);
    await teaching.goto("/notifications");
    const correctionNotice = teaching
      .locator(".notification-row")
      .filter({ hasText: title })
      .filter({
        hasText:
          /Korrektur des Leistungsnachweises angefragt|Delivery correction requested/,
      });
    await correctionNotice.getByRole("link").click();
    await expect(teaching).toHaveURL(
      new RegExp(`/delivery\\?session=${session}$`),
    );
    await teaching
      .getByLabel(/^(Tatsächliches Ende|Actual end)$/)
      .fill("2001-01-01T10:57");
    await teaching
      .getByLabel(/^(Begründung der Korrektur|Reason for correction)$/)
      .fill("Verified shorter teaching time");
    await teaching
      .getByRole("button", { name: /^(Entwurf speichern|Save draft)$/ })
      .click();
    await teaching
      .getByRole("button", {
        name: /^(Gespeicherten Nachweis einreichen|Submit saved evidence)$/,
      })
      .click();
    await expect(
      teaching.getByText("Verified shorter teaching time", { exact: true }),
    ).toBeVisible();
    await expect(
      teaching.getByText("Fictional original evidence", { exact: true }),
    ).toHaveCount(2);
    await expect(teaching.getByText(/^Version 2/)).toBeVisible();
    const corrected = await checked(
      teacherApi.rpc("delivery_history", { p_session_id: session }),
      { requireData: true },
    );
    expect(corrected.submissions).toHaveLength(2);
    expect(Date.parse(corrected.submissions[0].scheduled_end)).toBe(
      Date.parse(end),
    );
    expect(Date.parse(corrected.submissions[0].actual_start)).toBe(
      Date.parse(start),
    );
    expect(Date.parse(corrected.submissions[0].actual_end)).toBe(
      Date.parse("2001-01-01T09:57:00Z"),
    );

    await page.reload();
    await page
      .getByRole("button", { name: /^(Nachweis bestätigen|Confirm evidence)$/ })
      .click();
    await expect(
      page.getByText(
        /^(Der Server hat den Leistungsnachweis aktualisiert|The server updated the delivery evidence)\.$/,
      ),
    ).toBeVisible();
    const history = await checked(
      teacherApi.rpc("delivery_history", { p_session_id: session }),
      { requireData: true },
    );
    expect(
      history.events.find(
        (event: { action: string }) => event.action === "confirmed",
      )?.submission_id,
    ).toBe(corrected.submissions[0].id);

    await teaching.goto("/delivery");
    await expect(teaching.getByRole("link", { name: title })).toBeVisible();
    const csvEvent = teaching.waitForEvent("download");
    await teaching
      .getByRole("button", {
        name: /^(Diese Seite als CSV herunterladen|Download this page as CSV)$/,
      })
      .click();
    const csvFile = await csvEvent;
    expect(csvFile.suggestedFilename()).toBe(
      "luminovia-delivery-evidence-own.csv",
    );
    const csv = await readFile((await csvFile.path())!, "utf8");
    expect(csv).toContain(title);
    expect(csv).toContain('"44.5","completed","confirmed","2"');
    expect(csv).not.toContain("Fictional original evidence");
    expect(csv).not.toContain("Verified shorter teaching time");
    const viewport = await teaching.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      width: document.documentElement.clientWidth,
    }));
    expect(viewport.scroll).toBeLessThanOrEqual(viewport.width + 1);

    await login(other, outsider.email);
    await other.goto(`/delivery?session=${session}`);
    await expect(other.getByRole("alert")).toBeVisible();
    await expect(other.getByRole("heading", { name: title })).toHaveCount(0);
    await expect(
      other.getByText("Fictional original evidence", { exact: true }),
    ).toHaveCount(0);
    await other.goto("/delivery");
    await expect(
      other.getByText(
        /^(Für diese Ansicht liegen keine Termine vor|This view has no sessions)\.$/,
      ),
    ).toBeVisible();
    await expect(
      other.getByRole("button", {
        name: /^(Diese Seite als CSV herunterladen|Download this page as CSV)$/,
      }),
    ).toHaveCount(0);
  } finally {
    await Promise.all([context.close(), outsiderContext.close()]);
  }
});
