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

test("customer invoice PDF, credit evidence, payment totals and exports stay private and bilingual", async ({
  page,
  browser,
  isMobile,
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
  // The finance journal spans organisations. Keep the two browser fixtures
  // on separate dates when their projects share the same isolated database.
  const refundOn = isMobile ? "2001-02-06" : "2001-02-05";
  const refundReference = `Fictional partial refund ${testInfo.project.name}`;
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
  const toolbar = page.locator(".accounting-toolbar");
  await expect(
    toolbar.getByRole("combobox", { name: "Rechnungsquelle" }),
  ).toBeVisible();
  const layout = await toolbar.evaluate((element) => {
    const { left, right } = element.getBoundingClientRect();
    const labelBottom = element
      .querySelector("label")!
      .getBoundingClientRect().bottom;
    const controls = Array.from(
      element.querySelectorAll("select, button"),
      (control) => {
        const box = control.getBoundingClientRect();
        return {
          top: box.top,
          bottom: box.bottom,
          height: box.height,
          fits:
            box.left >= left &&
            box.right <= right + 1 &&
            box.top >= labelBottom,
        };
      },
    );
    return controls;
  });
  expect(layout).toHaveLength(3);
  expect(layout.every(({ height, fits }) => fits && height >= 44)).toBe(true);
  if (isMobile) {
    for (const button of layout.slice(1))
      expect(button.top).toBeGreaterThan(layout[0].bottom);
  } else {
    for (const button of layout.slice(1)) {
      expect(Math.abs(button.top - layout[0].top)).toBeLessThan(1);
      expect(Math.abs(button.height - layout[0].height)).toBeLessThan(1);
    }
  }

  await page
    .getByRole("button", {
      name: "Externe Rechnung an ein Unternehmen erfassen",
      exact: true,
    })
    .click();
  const form = page.getByRole("dialog", {
    name: "Externe Rechnung an ein Unternehmen erfassen",
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
    .getByLabel("PDF der an das Unternehmen ausgestellten Rechnung hochladen", {
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

  const creditReference = `CREDIT-${testInfo.project.name}`;
  const creditBytes = Buffer.concat([
    bytes,
    Buffer.from("% Fictional issued credit note\n"),
  ]);
  const creditAction = card.getByRole("button", {
    name: "Gutschriften für Unternehmen",
    exact: true,
  });
  await creditAction.click();
  const credit = page.getByRole("dialog", {
    name: "Gutschriften für Unternehmen",
    exact: true,
  });
  await credit
    .getByLabel("Gutschriftnummer", { exact: true })
    .fill(creditReference);
  await credit
    .getByLabel("Ausstellungsdatum der Gutschrift", { exact: true })
    .fill("2001-02-02");
  await credit
    .getByLabel("Betrag der Gutschrift in AUD", { exact: true })
    .fill("20,05");
  await credit
    .getByLabel("Grund der Gutschrift", { exact: true })
    .fill("Fictional reviewed correction on the issued credit note.");
  await credit
    .getByLabel("Ausgestellter Gutschriftbeleg als PDF", { exact: true })
    .setInputFiles({
      name: "Fictional issued credit note.pdf",
      mimeType: "application/pdf",
      buffer: creditBytes,
    });
  await expect(
    credit.getByText("Fictional issued credit note.pdf", { exact: true }),
  ).toBeVisible({ timeout: 90000 });
  const confirmCredit = credit.getByRole("checkbox", {
    name: "Ich habe den ausgestellten PDF-Beleg, die Originalrechnung und den Betrag geprüft.",
    exact: true,
  });
  const saveCredit = credit.getByRole("button", {
    name: "Gutschriftbeleg erfassen",
    exact: true,
  });
  await expect(saveCredit).toBeDisabled();
  await confirmCredit.check();
  await saveCredit.click();
  await expect(
    credit.getByRole("status").filter({ hasText: "Gutschriftbeleg erfasst." }),
  ).toBeVisible();
  await credit.getByRole("button", { name: "Schließen", exact: true }).click();

  await creditAction.click();
  const storedCredit = credit.locator("li").filter({
    has: page.getByText(creditReference, { exact: true }),
  });
  await expect(storedCredit).toContainText("20.05 AUD");
  const creditDownload = page.waitForEvent("download", { timeout: 20000 });
  await storedCredit
    .getByRole("button", {
      name: `PDF für Gutschrift ${creditReference} herunterladen`,
    })
    .click();
  expect(await contents(await creditDownload)).toEqual(creditBytes);
  await credit.getByRole("button", { name: "Schließen", exact: true }).click();
  await expect(card.getByText("166.69 AUD", { exact: true })).toBeVisible();

  const settlementAction = card.getByRole("button", {
    name: "Unternehmenssaldo",
    exact: true,
  });
  const settlement = page.getByRole("dialog", {
    name: "Unternehmenssaldo",
    exact: true,
  });
  await settlementAction.click();
  await settlement
    .getByLabel("Vorgang", { exact: true })
    .selectOption("applyCredit");
  await settlement
    .getByLabel("Beleg oder Buchung", { exact: true })
    .selectOption({ label: `${creditReference} · 20.05 AUD` });
  await settlement
    .getByLabel("Begründung des Vorgangs", { exact: true })
    .fill("Fictional checked credit allocation");
  await settlement
    .getByRole("button", { name: "Gutschrift anrechnen", exact: true })
    .click();
  await expect(
    settlement.getByText("146.64 AUD", { exact: true }),
  ).toBeVisible();
  await expect(
    settlement.getByText("179.98 AUD", { exact: true }),
  ).toBeVisible();
  await settlement
    .getByRole("button", { name: "Schließen", exact: true })
    .click();

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

  await card
    .getByRole("button", { name: "Zahlung dokumentieren", exact: true })
    .click();
  await payment
    .getByLabel("Betrag (z. B. 100.01)", { exact: true })
    .fill("166.69");
  await payment
    .getByLabel("Tatsächlicher Zahlungszeitpunkt (UTC)", { exact: true })
    .fill("2001-02-04T12:00");
  await payment
    .getByLabel("Zahlungsreferenz", { exact: true })
    .fill("Fictional late original payment");
  await payment
    .getByRole("button", { name: "Zahlung erfassen", exact: true })
    .click();
  await expect(payment).not.toBeVisible();

  await settlementAction.click();
  await expect(
    settlement.getByText("Rückzahlung offen", { exact: true }),
  ).toBeVisible();
  await settlement
    .getByLabel("Vorgang", { exact: true })
    .selectOption("recordRefund");
  await settlement
    .getByLabel("Tatsächlich erstatteter Betrag in AUD", { exact: true })
    .fill("10,00");
  await settlement
    .getByLabel("Tatsächlicher Rückzahlungszeitpunkt (UTC)", { exact: true })
    .fill(`${refundOn}T09:30`);
  await settlement
    .getByLabel("Referenz der ausgeführten Rückzahlung", { exact: true })
    .fill(refundReference);
  await settlement
    .getByRole("checkbox", {
      name: "Ich bestätige, dass die Rückzahlung bereits ausgeführt wurde.",
    })
    .check();
  await settlement
    .getByRole("button", { name: "Rückzahlung dokumentieren", exact: true })
    .click();
  await expect(
    settlement.getByText("10.05 AUD", { exact: true }),
  ).toBeVisible();
  await settlement
    .getByRole("button", { name: "Schließen", exact: true })
    .click();

  const journalButton = page.getByRole("button", {
    name: "Abrechnungsjournal",
    exact: true,
  });
  await journalButton.click();
  const journal = page.getByRole("dialog", {
    name: "Abrechnungsjournal",
    exact: true,
  });
  await journal.getByLabel("Von (einschließlich)").fill(refundOn);
  await journal.getByLabel("Bis (einschließlich)").fill(refundOn);
  await journal.getByRole("button", { name: "Journal anzeigen" }).click();
  await expect(
    journal.getByText(refundReference, { exact: true }),
  ).toBeVisible();
  for (const format of ["JSON", "CSV"] as const) {
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      journal.getByRole("button", { name: `Journal als ${format}` }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(
      `luminovia-settlement-journal-${refundOn}-${refundOn}.${format.toLowerCase()}`,
    );
    const exported = (await contents(download)).toString("utf8");
    if (format === "JSON") {
      const report = JSON.parse(exported);
      expect(report.schema_version).toBe("luminovia.settlement-journal/1");
      expect(report.items).toContainEqual(
        expect.objectContaining({
          kind: "customer_refund",
          subject_id: json.invoices[0].id,
          currency: "AUD",
          amount: "10.00",
          effective_on: refundOn,
          reference: refundReference,
        }),
      );
    } else {
      expect(exported).toContain(`"AUD","10.00","${refundReference}"`);
    }
  }
  await journal.getByLabel("Währung", { exact: true }).selectOption("EUR");
  await expect(journal.getByText(refundReference, { exact: true })).toHaveCount(
    0,
  );
  await expect(
    journal.getByText("Für diese Auswahl sind keine Buchungen vorhanden."),
  ).toBeVisible();
  await journal.getByLabel("Währung", { exact: true }).selectOption("AUD");
  await journal
    .getByLabel("Buchungsart", { exact: true })
    .selectOption("customer_refund");
  await journal
    .getByLabel("Buchungsstatus", { exact: true })
    .selectOption("recorded");
  await expect(
    journal.getByText(refundReference, { exact: true }),
  ).toBeVisible();
  const [summary] = await Promise.all([
    page.waitForEvent("download"),
    journal
      .getByRole("button", { name: "Summen als CSV", exact: true })
      .click(),
  ]);
  expect(summary.suggestedFilename()).toBe(
    `luminovia-settlement-journal-${refundOn}-${refundOn}-AUD-customer_refund-recorded-totals.csv`,
  );
  const cells = (await contents(summary)).toString("utf8").split("\r\n");
  expect(cells).toHaveLength(2);
  expect(cells[1]).toContain('"customer_refund","AUD","10.00","0.00","10.00"');
  await journal
    .getByLabel("Buchungsstatus", { exact: true })
    .selectOption("reversed");
  await expect(journal.getByText(refundReference, { exact: true })).toHaveCount(
    0,
  );
  expect(
    await journal.evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1,
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(journalButton).toBeFocused();

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
          name: "Externe Rechnung an ein Unternehmen erfassen",
          exact: true,
        })
        .count(),
    ).toBe(0);
    await expect(
      clientPage.getByRole("button", {
        name: "Abrechnungsjournal",
        exact: true,
      }),
    ).toHaveCount(0);
    const clientCard = clientPage.locator("article.accounting-card").filter({
      has: clientPage.getByRole("heading", { name: number, exact: true }),
    });
    await expect(
      clientCard.getByRole("button", {
        name: "Gutschriften für Unternehmen",
        exact: true,
      }),
    ).toHaveCount(0);
    await clientCard
      .getByRole("button", { name: "Unternehmenssaldo", exact: true })
      .click();
    const customerBalance = clientPage.getByRole("dialog", {
      name: "Unternehmenssaldo",
      exact: true,
    });
    await expect(
      customerBalance.getByText("10.05 AUD", { exact: true }),
    ).toBeVisible();
    await expect(
      customerBalance.getByLabel("Vorgang", { exact: true }),
    ).toHaveCount(0);
    await expect(
      customerBalance.getByText(refundReference, { exact: true }),
    ).toHaveCount(0);
    await customerBalance
      .getByRole("button", { name: "Schließen", exact: true })
      .click();
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
