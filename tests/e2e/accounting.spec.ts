/** Canonical disposable browser journey: register scanned fictional customer
 * evidence, record an actual-payment fixture and download authorized exports. */
import { test, expect, type Download } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  api,
  actor,
  checked,
  login,
  adminLogin,
} from "./helpers/accounts-support";
import { accountingTestPdf } from "../../scripts/testing/accounting-pdf.mjs";

/** Only the existing random, loopback canonical stack receives private ledger
 * fixtures. UUIDs and known fictional values are passed through stdin to psql. */
async function fixtureSql(text: string) {
  if (process.env.PORTAL_TEST_MODE !== "1")
    throw new Error("Only canonical accounting fixtures");
  const project = /^project_id\s*=\s*"(luminovia-portal-test-[a-f0-9]+)"/m.exec(
    readFileSync("supabase/config.toml", "utf8"),
  )?.[1];
  if (!project) throw new Error("Disposable accounting project required");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "docker",
      [
        "exec",
        "-i",
        `supabase_db_${project}`,
        "psql",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-X",
        "-qAt",
        "-v",
        "ON_ERROR_STOP=1",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let error = "";
    child.stderr.on("data", (value) => (error += value));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(error)),
    );
    child.stdin.end(text);
  });
}
/** Inspect the actual browser-produced download without publishing real files. */
async function contents(download: Download) {
  expect(await download.failure()).toBeNull();
  const path = await download.path();
  if (!path) throw new Error("Download bytes required");
  return readFileSync(path);
}

test("customer invoice PDF, exact payment totals and JSON/CSV stay private and bilingual", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(130000);
  const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!),
    owner = await actor("Fictional accounting owner", "admin"),
    teacher = await actor("Fictional accounting teacher", "lecturer"),
    customer = await actor("Fictional accounting customer", "client"),
    outsider = await actor("Fictional accounting outsider", "client");
  const [org, foreignOrg, job, claim] = Array.from({ length: 4 }, randomUUID);
  const title = `Fictional accounting block ${testInfo.project.name}`;
  const number = `=FICTIONAL-${testInfo.project.name}`;
  await checked(
    service.from("organisations").insert([
      { id: org, name: "Fictional accounting academy" },
      { id: foreignOrg, name: "Fictional other academy" },
    ]),
  );
  await checked(
    service.from("client_organisation_memberships").insert([
      { user_id: customer.id, organisation_id: org },
      { user_id: outsider.id, organisation_id: foreignOrg },
    ]),
  );
  await checked(
    service.from("jobs").insert({
      id: job,
      title,
      customer_name: "Fictional accounting academy",
      delivery_type: "online",
      status: "filled",
      amount: 100.01,
      total_amount: 100.01,
      currency: "AUD",
      rate_unit: "fixed_total",
      terms: "Fictional immutable accepted compensation",
    }),
  );
  await checked(
    service.from("job_claims").insert({
      id: claim,
      job_id: job,
      lecturer_id: teacher.id,
      idempotency_key: randomUUID(),
      amount: 100.01,
      total_amount: 100.01,
      currency: "AUD",
      rate_unit: "fixed_total",
      terms: "Fictional immutable accepted compensation",
      terms_version: 1,
    }),
  );
  await fixtureSql(
    `insert into private.claim_revenue_ledger(claim_id,job_id,organisation_id,lecturer_id,gross_amount,gross_total_amount,platform_percent,platform_total_amount,lecturer_net_amount,lecturer_net_total_amount,currency) values('${claim}','${job}','${org}','${teacher.id}',200.03,200.03,50,100.02,100.01,100.01,'AUD');`,
  );
  await adminLogin(page, owner);
  await page.goto("/accounting");
  await page
    .getByRole("button", {
      name: "Externe Kundenrechnung erfassen",
      exact: true,
    })
    .click();
  const form = page.getByRole("dialog", {
    name: "Externe Kundenrechnung erfassen",
    exact: true,
  });
  await form.getByRole("checkbox", { name: new RegExp(title) }).check();
  await form.getByLabel("Rechnungsnummer", { exact: true }).fill(number);
  await form.getByLabel("Rechnungsdatum", { exact: true }).fill("2001-01-01");
  await form.getByLabel("Fällig am", { exact: true }).fill("2001-02-01");
  await form
    .getByLabel("Dokumentierter Rechnungsbetrag", { exact: true })
    .fill("200.03");
  const bytes = accountingTestPdf();
  await form
    .getByLabel("PDF der ausgestellten Kundenrechnung hochladen", {
      exact: true,
    })
    .setInputFiles({
      name: "Fictional issued invoice.pdf",
      mimeType: "application/pdf",
      buffer: bytes,
    });
  await expect(
    form.getByText("Fictional issued invoice.pdf", { exact: true }),
  ).toBeVisible({ timeout: 90000 });
  await form
    .getByRole("checkbox", {
      name: "Ich habe Nummer, Daten, Betrag und Währung mit dieser ausgestellten PDF abgeglichen.",
      exact: true,
    })
    .check();
  await form
    .getByRole("button", { name: "Rechnung dokumentieren", exact: true })
    .click();
  await expect(form).not.toBeVisible();
  await page
    .getByLabel("Rechnungsquelle", { exact: true })
    .selectOption("customer");
  const card = page
    .locator("article.accounting-card")
    .filter({ has: page.getByRole("heading", { name: number, exact: true }) });
  await expect(card).toBeVisible();
  await expect(
    card.getByText("200.03 AUD", { exact: true }).first(),
  ).toBeVisible();
  await card
    .getByRole("button", { name: "Zahlung dokumentieren", exact: true })
    .click();
  const payment = page.getByRole("dialog", {
    name: "Zahlung dokumentieren",
    exact: true,
  });
  await payment
    .getByLabel("Betrag (z. B. 100.01)", { exact: true })
    .fill("33.34");
  await payment
    .getByLabel("Tatsächlicher Zahlungszeitpunkt (UTC)", { exact: true })
    .fill("2001-01-02T12:00");
  await payment
    .getByLabel("Zahlungsreferenz", { exact: true })
    .fill("+FICTIONAL-REMITTANCE");
  await payment
    .getByRole("button", { name: "Zahlung erfassen", exact: true })
    .click();
  await expect(payment).not.toBeVisible();
  await expect(card.getByText("166.69 AUD", { exact: true })).toBeVisible();
  await card
    .getByRole("checkbox", {
      name: `Rechnung ${number} auswählen`,
      exact: true,
    })
    .check();
  let downloadPromise = page.waitForEvent("download", { timeout: 20000 });
  await page
    .getByRole("button", { name: "JSON-Export erstellen", exact: true })
    .click();
  const json = JSON.parse(
    (await contents(await downloadPromise)).toString("utf8"),
  );
  expect(json.schema_version).toBe("luminovia.accounting/1");
  expect(json.invoices[0]).toMatchObject({
    recorded_total: "200.03",
    paid_total: "33.34",
    outstanding_total: "166.69",
    currency: "AUD",
    tax: { status: "not_recorded", gross: null, vat_amount: null },
  });
  downloadPromise = page.waitForEvent("download", { timeout: 20000 });
  await page
    .getByRole("button", { name: "CSV-Export erstellen", exact: true })
    .click();
  const csv = (await contents(await downloadPromise)).toString("utf8");
  expect(csv).toContain(`"'${number}"`);
  expect(csv).toContain('"\'+FICTIONAL-REMITTANCE"');
  const context = await browser.newContext({
    viewport: page.viewportSize(),
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173",
    acceptDownloads: true,
  });
  try {
    const clientPage = await context.newPage();
    await login(clientPage, customer.email);
    await clientPage.goto("/accounting");
    await clientPage
      .getByLabel("Rechnungsquelle", { exact: true })
      .selectOption("customer");
    await expect(
      clientPage.getByRole("heading", { name: number, exact: true }),
    ).toBeVisible();
    expect(
      await clientPage
        .getByRole("button", {
          name: "Externe Kundenrechnung erfassen",
          exact: true,
        })
        .count(),
    ).toBe(0);
    const clientCard = clientPage.locator("article.accounting-card").filter({
      has: clientPage.getByRole("heading", { name: number, exact: true }),
    });
    const document = json.invoices[0];
    const pdfPromise = clientPage.waitForEvent("download", { timeout: 20000 });
    // Keep a failed gateway request visible even if Chromium never emits a download.
    void pdfPromise.catch(() => {});
    const [response] = await Promise.all([
      clientPage.waitForResponse(
        (candidate) => {
          const request = candidate.request();
          if (
            request.method() !== "POST" ||
            !new URL(request.url()).pathname.endsWith("/functions/v1/files")
          )
            return false;
          const payload = request.postDataJSON();
          return (
            payload?.action === "download" &&
            payload.id === document.document_id &&
            payload.version_id === document.document_version_id
          );
        },
        { timeout: 20000 },
      ),
      clientCard
        .getByRole("button", {
          name: "Geprüfte Rechnungs-PDF herunterladen",
          exact: true,
        })
        .click(),
    ]);
    expect(
      response.status(),
      "The scoped customer can download the exact retained version",
    ).toBe(200);
    expect(await response.body()).toEqual(bytes);
    expect(await contents(await pdfPromise)).toEqual(bytes);
    await clientPage.getByLabel("Sprache", { exact: true }).selectOption("en");
    await clientPage.getByLabel("Theme", { exact: true }).selectOption("dark");
    await expect(
      clientPage.getByRole("heading", {
        level: 1,
        name: "Accounting exports",
        exact: true,
      }),
    ).toBeVisible();
    await clientPage.evaluate(() => document.fonts.ready);
    expect(
      (
        await new AxeBuilder({ page: clientPage })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    expect(
      await clientPage.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
    await clientPage.screenshot({
      path: `docs/screenshots/${testInfo.project.name}-accounting-dark-en.png`,
      fullPage: true,
    });
    await checked(
      service
        .from("client_organisation_memberships")
        .update({ removed_at: new Date().toISOString() })
        .eq("user_id", customer.id),
    );
    await clientPage.reload();
    await expect(
      clientPage.getByRole("heading", { name: number, exact: true }),
    ).toHaveCount(0);
  } finally {
    await context.close();
  }
  const outside = api(process.env.SUPABASE_ANON_KEY!);
  await checked(
    outside.auth.signInWithPassword({
      email: outsider.email,
      password: process.env.E2E_PASSWORD!,
    }),
  );
  expect(
    (
      await checked(
        outside.rpc("accounting_invoices", { p_source: "customer" }),
      )
    ).items,
  ).toEqual([]);
  expect(
    (await outside.rpc("accounting_export", { p_id: json.id })).error?.code,
  ).toBe("42501");
  // All records and immutable scanned bytes belong to this canonical UUID fixture;
  // the runner tears the entire disposable stack down after browser acceptance.
});
