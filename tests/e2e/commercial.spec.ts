/**
 * Browser workflows for executed-contract evidence, original currencies and invoice/payment states.
 * Rendered workflows are checked in isolation; this does not replace manual device/platform acceptance.
 */
import {expect, type Browser, type Page, test, type TestInfo} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {createClient} from "@supabase/supabase-js";
import {createHash, randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {DateTime} from "luxon";

test.skip(
    process.env.PORTAL_TEST_MODE !== "1",
    "Commercial writes run only in the isolated ./portal test stack.",
);

/** Creates an SDK test client; each account session must be signed in explicitly. */
function client(key: string) {
    const url = process.env.SUPABASE_URL!;
    if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname))
        throw new Error("Commercial fixtures require loopback isolation.");
    return createClient(url, key, {
        auth: {persistSession: false, autoRefreshToken: false},
    });
}

/** Creates the administrative fixture client; its key stays outside the browser application. */
const service = () => client(process.env.SUPABASE_SERVICE_ROLE_KEY!);

interface Account {
    id: string;
    email: string;
    name: string;
}

/** Creates a fictional actor for separate browser/API sessions and later scoped cleanup. */
async function account(
    role: "lecturer" | "admin",
    label: string,
): Promise<Account> {
    const tag = randomUUID().slice(0, 8);
    const email = `commercial-${label}-${tag}@example.invalid`;
    const name = `Commercial QA ${label} ${tag}`;
    const result = await service().auth.admin.createUser({
        email,
        password: process.env.E2E_PASSWORD!,
        email_confirm: true,
    });
    expect(result.error).toBeNull();
    const id = result.data.user!.id;
    expect(
        (
            await service()
                .from("profiles")
                .update({display_name: name})
                .eq("id", id)
        ).error,
    ).toBeNull();
    expect(
        (await service().from("user_roles").insert({user_id: id, role})).error,
    ).toBeNull();
    return {id, email, name};
}

/** Signs this test actor in through the visible form and waits for confirmed navigation. */
async function login(page: Page, user: Account) {
    await page.goto("/login");
    await page.getByLabel("E-Mail", {exact: true}).fill(user.email);
    await page
        .getByLabel("Passwort", {exact: true})
        .fill(process.env.E2E_PASSWORD!);
    await page.getByRole("button", {name: "Anmelden", exact: true}).click();
    await expect(page).toHaveURL(/\/$/);
}

/** Checks the rendered state with axe; this does not replace manual accessibility acceptance. */
async function a11y(page: Page) {
    await page.evaluate(() => document.fonts.ready);
    const result = await new AxeBuilder({page})
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
    expect(
        result.violations.map((item) => ({
            id: item.id,
            nodes: item.nodes.map((node) => ({
                target: node.target,
                summary: node.failureSummary,
            })),
        })),
    ).toEqual([]);
}

/** Small actual PDF with a valid xref, not renamed plain text. */

function fictionalPdf() {
    const objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        "<< /Length 67 >>\nstream\nBT /F1 12 Tf 30 100 Td (Fictional local commercial QA only.) Tj ET\nendstream",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ];
    let pdf = "%PDF-1.7\n";
    const offsets = [0];
    objects.forEach((object, index) => {
        offsets.push(Buffer.byteLength(pdf));
        pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xref = Buffer.byteLength(pdf);
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
        .join(
            "",
        )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(pdf);
}

/** Signs the existing fictional actor in with its password and returns its own unprivileged API client. */
async function actor(user: Account) {
    const api = client(process.env.SUPABASE_ANON_KEY!);
    expect(
        (
            await api.auth.signInWithPassword({
                email: user.email,
                password: process.env.E2E_PASSWORD!,
            })
        ).error,
    ).toBeNull();
    return api;
}

/** Creates and confirms a real fixture job so the invoice derives from actual accepted terms. */
async function acceptedJob(
    user: Account,
    currency: "EUR" | "AUD",
    total: number,
    day: number,
    requiresContract = true,
    otherDays: number[] = [],
) {
    const id = randomUUID();
    const title = `QA ${currency} ${id.slice(0, 8)}`;
    expect(
        (
            await service().from("jobs").insert({
                id,
                title,
                description: "Fictional commercial QA.",
                customer_name: "Fictional QA Academy",
                delivery_type: "online",
                location: "Online",
                time_zone: "Europe/Berlin",
                status: "published",
                amount: total,
                currency,
                rate_unit: "fixed_total",
                total_amount: total,
                terms: "Fictional accepted terms.",
                requires_contract: requiresContract,
            })
        ).error,
    ).toBeNull();
    expect(
        (
            await service()
                .from("job_sessions")
                .insert([day, ...otherDays].map(sessionDay => ({
                    job_id: id,
                    starts_at: `2035-05-${String(sessionDay).padStart(2, "0")}T08:00:00Z`,
                    ends_at: `2035-05-${String(sessionDay).padStart(2, "0")}T10:00:00Z`,
                })))
        ).error,
    ).toBeNull();
    const api = await actor(user);
    const result = await api.rpc("claim_job", {
        p_job_id: id,
        p_idempotency_key: randomUUID(),
        p_terms_version: 1,
    });
    expect(result.error).toBeNull();
    expect(result.data.status).toBe("confirmed");
    return {title, id, claimId: result.data.claim_id};
}

/** Move an exact fictional offer session and its accepted allocation into the past. */
async function finishAcceptedJob(
    job: Awaited<ReturnType<typeof acceptedJob>>,
    daysAgo: number,
    originalStart?: string,
) {
    const starts = Date.now() - daysAgo * 86_400_000;
    const interval = {
        starts_at: new Date(starts).toISOString(),
        ends_at: new Date(starts + 7_200_000).toISOString(),
    };
    const schedule = service().from("job_sessions").update(interval).eq("job_id", job.id);
    const allocation = service().from("assignment_sessions").update(interval).eq("claim_id", job.claimId);
    if (originalStart) {
        schedule.eq("starts_at", originalStart);
        allocation.eq("starts_at", originalStart);
    }
    const scheduled = await schedule.select("id").single();
    expect(scheduled.error).toBeNull();
    const assigned = await allocation.select("id").single();
    expect(assigned.error).toBeNull();
}

test("executed PDF receipt, original-currency earnings, invoice review and recorded payment corrections work through the UI", async ({
                                                                                                                                         page,
                                                                                                                                         browser,
                                                                                                                                     }, testInfo) => {
    test.setTimeout(160_000);
    const lecturer = await account("lecturer", "Lecturer");
    const administrator = await account("admin", "Commercial");
    const stranger = await account("lecturer", "Other");
    const adminContext = await browser.newContext({
        baseURL: process.env.E2E_BASE_URL,
        viewport: testInfo.project.use.viewport,
        isMobile: testInfo.project.use.isMobile,
        hasTouch: testInfo.project.use.hasTouch,
        deviceScaleFactor: testInfo.project.use.deviceScaleFactor,
    });
    const adminPage = await adminContext.newPage();
    const pdf = fictionalPdf();
    await login(page, lecturer);
    await page.goto("/files");
    const contractsLink = page.getByRole("link", {
        name: "Verträge öffnen",
        exact: true,
    });
    await expect(contractsLink).toBeVisible();
    await contractsLink.click();
    await expect(page).toHaveURL(/\/contracts$/);
    await page
        .getByLabel("Ausgeführter Vertrag als PDF", {exact: true})
        .setInputFiles({
            name: "fictional-contract.pdf",
            mimeType: "application/pdf",
            buffer: pdf,
        });
    await expect(page.getByText(/PDF geprüft und bereit/)).toBeVisible({
        timeout: 45_000,
    });
    await login(adminPage, administrator);
    await adminPage.goto(`/contracts?user=${lecturer.id}`);
    await adminPage
        .getByRole("button", {
            name: "Ausgeführten Vertrag hinterlegen",
            exact: true,
        })
        .click();
    let dialog = adminPage.getByRole("dialog");
    const title = `Rahmenvertrag QA ${randomUUID().slice(0, 8)}`;
    await expect(dialog.getByLabel("Dozent:in", {exact: true})).toHaveValue(
        lecturer.id,
    );
    await dialog.getByLabel("Titel", {exact: true}).fill(title);
    await dialog.getByLabel(/Gültig ab/).fill("2026-01-01T00:00");
    await expect(
        dialog
            .getByLabel("Hochgeladene Vertragsdatei")
            .locator("option", {hasText: "fictional-contract.pdf"}),
    ).toHaveCount(1);
    await dialog
        .getByLabel("Hochgeladene Vertragsdatei")
        .selectOption({label: "fictional-contract.pdf"});
    await dialog
        .getByRole("button", {name: "Vertrag speichern", exact: true})
        .click();
    await expect(dialog).not.toBeVisible();
    const staffFile = `fictional-admin-contract-${randomUUID().slice(0, 8)}.pdf`,
        staffTitle = `Rahmenvertrag Verwaltung ${randomUUID().slice(0, 8)}`;
    await adminPage
        .getByRole("button", {
            name: "Ausgeführten Vertrag hinterlegen",
            exact: true,
        })
        .click();
    dialog = adminPage.getByRole("dialog");
    await dialog.getByLabel("Dozent:in", {exact: true}).selectOption(lecturer.id);
    await dialog.getByLabel("Titel", {exact: true}).fill(staffTitle);
    await dialog.getByLabel(/Gültig ab/).fill("2026-01-02T00:00");
    await dialog.getByLabel("Ausgeführter Vertrag als PDF", {exact: true}).setInputFiles({
        name: staffFile,
        mimeType: "application/pdf",
        buffer: pdf,
    });
    await expect(dialog.getByText(/PDF geprüft und bereit/)).toBeVisible({
        timeout: 45_000,
    });
    await expect(
        dialog
            .getByLabel("Hochgeladene Vertragsdatei")
            .locator("option", {hasText: staffFile}),
    ).toHaveCount(1);
    await dialog
        .getByRole("button", {name: "Vertrag speichern", exact: true})
        .click();
    await expect(dialog).not.toBeVisible();
    const uploaded = await service()
            .from("documents")
            .select("id,owner_id,uploaded_by,current_version_id")
            .eq("original_name", staffFile)
            .single(),
        registered = await service()
            .from("contracts")
            .select("user_id,document_version_id,registered_by")
            .eq("user_id", lecturer.id)
            .eq("title", staffTitle)
            .single();
    expect(uploaded.error).toBeNull();
    if (!uploaded.data) throw new Error("Expected the scanned fixture version");
    expect(uploaded.data).toMatchObject({
        owner_id: lecturer.id,
        uploaded_by: administrator.id,
    });
    expect(registered.error).toBeNull();
    expect(registered.data).toMatchObject({
        user_id: lecturer.id,
        document_version_id: uploaded.data.current_version_id,
        registered_by: administrator.id,
    });
    await adminPage
        .getByRole("button", {name: "Alle Dozierenden anzeigen", exact: true})
        .click();
    await expect(adminPage).toHaveURL(/\/contracts$/);
    await expect(
        adminPage.getByRole("checkbox", {name: "Alle Dozierenden anzeigen", exact: true}),
    ).toBeChecked();
    await expect(
        adminPage.getByRole("heading", {name: title, exact: true}),
    ).toBeVisible();
    await page.goto("/contracts");
    const contract = page
        .locator("article")
        .filter({has: page.getByRole("heading", {name: title, exact: true})});
    await expect(
        contract.getByText("SHA-256-Prüfsumme", {exact: true}),
    ).toBeVisible();
    const download = page.waitForEvent("download");
    await contract
        .getByRole("button", {name: "Dokument herunterladen", exact: true})
        .click();
    const saved = await download;
    expect(await saved.failure()).toBeNull();
    expect(await readFile((await saved.path())!)).toEqual(pdf);
    await expect(
        contract.getByRole("button", {name: "Empfang bestätigen", exact: true}),
    ).toBeDisabled();
    await contract
        .getByLabel(
            "Ich habe diese Vertragsfassung erhalten und zur Kenntnis genommen.",
            {exact: true},
        )
        .check();
    await contract
        .getByRole("button", {name: "Empfang bestätigen", exact: true})
        .click();
    await expect(contract.getByText(/Empfang bestätigt am/)).toBeVisible();
    await page.reload();
    await expect(page.getByText(/Empfang bestätigt am/)).toBeVisible();
    await a11y(page);
    const otherApi = await actor(stranger);
    const others = await otherApi.rpc("contract_records", {p_all: false});
    expect(others.error).toBeNull();
    expect(
        others.data.some((record: { title: string }) => record.title === title),
    ).toBe(false);
    const eur = await acceptedJob(lecturer, "EUR", 123.45, 2);
    const aud = await acceptedJob(lecturer, "AUD", 456.78, 3);
    await page.goto("/finance");
    // The trend chart uses its own currency headings below the summary cards.
    await expect(
        page.getByRole("heading", {name: "EUR", level: 2, exact: true}),
    ).toBeVisible();
    await expect(
        page.getByRole("heading", {name: "AUD", level: 2, exact: true}),
    ).toBeVisible();
    await page
        .getByRole("button", {name: "Rechnung einreichen", exact: true})
        .click();
    dialog = page.getByRole("dialog");
    for (const job of [eur, aud]) {
        await expect(dialog.getByText(new RegExp(`^${job.title}: Der letzte geplante Unterrichtstermin hat noch nicht geendet\\.`))).toBeVisible();
        await expect(dialog.getByRole("checkbox", {name: new RegExp(job.title)})).toHaveCount(0);
    }
    await dialog.getByRole("button", {name: "Schließen", exact: true}).click();
    await finishAcceptedJob(eur, 3);
    await finishAcceptedJob(aud, 2);
    await page.goto("/finance/accounting");
    await expect(page.getByLabel("Rechnungsquelle", {exact: true})).toHaveCount(0);
    await page.getByRole("link", {name: "Kursrechnung einreichen", exact: true}).click();
    await expect(dialog.getByRole("checkbox", {name: new RegExp(eur.title)})).not.toBeChecked();
    await dialog.getByRole("button", {name: "Schließen", exact: true}).click();
    await page.getByRole("row").filter({hasText: eur.title})
        .getByRole("button", {name: "Für diesen Kurs abrechnen", exact: true}).click();
    await expect(dialog.getByRole("checkbox", {name: new RegExp(eur.title)})).toBeChecked();
    const number = `=QA-${randomUUID().slice(0, 8)}`;
    await dialog.getByLabel("Rechnungsnummer", {exact: true}).fill(number);
    const issueField = dialog.getByLabel("Rechnungsdatum", {exact: true});
    const issueDate = DateTime.fromISO(await issueField.inputValue(), {
        zone: "utc",
    }).minus({days: 1});
    await issueField.fill(issueDate.toISODate()!);
    await expect(dialog.getByLabel("Fällig am", {exact: true})).toHaveValue("");
    await expect(
        dialog.getByRole("checkbox", {name: new RegExp(aud.title)}),
    ).toBeDisabled();
    await dialog.getByLabel("Rechnung als PDF", {exact: true}).setInputFiles({
        name: "fictional-invoice.pdf",
        mimeType: "application/pdf",
        buffer: pdf,
    });
    await expect(dialog.getByText(/PDF geprüft und bereit/)).toBeVisible({
        timeout: 45_000,
    });
    await dialog
        .getByRole("button", {name: "Rechnung einreichen", exact: true})
        .click();
    await expect(dialog).not.toBeVisible();
    const invoice = page
        .locator("article")
        .filter({has: page.getByRole("heading", {name: number, exact: true})});
    await expect(invoice.getByText("Eingereicht", {exact: true})).toBeVisible();
    const csvDownload = page.waitForEvent("download");
    await page
        .getByRole("button", {name: "Rechnungen als CSV", exact: true})
        .click();
    const csv = await csvDownload;
    expect((await readFile((await csv.path())!)).toString("utf8")).toContain(
        `"'${number}"`,
    );
    await a11y(page);
    await page.screenshot({
        path: `.local/screenshots/${testInfo.project.name}-finance.png`,
        fullPage: true,
    });
    await adminPage.goto("/admin/finance");
    const reviewCard = adminPage.locator("article").filter({
        has: adminPage.getByRole("heading", {name: number, exact: true}),
    });
    await reviewCard
        .getByRole("button", {name: "Rechnung prüfen", exact: true})
        .click();
    await adminPage
        .getByRole("dialog")
        .getByLabel("Notiz zur Prüfung", {exact: true})
        .fill("Fictional QA review.");
    await adminPage
        .getByRole("dialog")
        .getByRole("button", {name: "Rechnung freigeben", exact: true})
        .click();
    await expect(adminPage.getByRole("dialog")).not.toBeVisible();
    await expect(
        reviewCard.getByText("Freigegeben", {exact: true}),
    ).toBeVisible();
    await reviewCard
        .getByRole("button", {name: "Zahlung eintragen", exact: true})
        .click();
    await adminPage
        .getByRole("dialog")
        .getByLabel("Zahlungsbetrag (EUR)", {exact: true})
        .fill("50.00");
    await adminPage
        .getByRole("dialog")
        .getByLabel("Verwendungszweck / Referenz", {exact: true})
        .fill("QA partial payment");
    await adminPage
        .getByRole("dialog")
        .getByRole("button", {name: "Zahlung speichern", exact: true})
        .click();
    await expect(adminPage.getByRole("dialog")).not.toBeVisible();
    await expect(
        reviewCard.getByText("Freigegeben", {exact: true}),
    ).toBeVisible();
    await reviewCard
        .getByRole("button", {name: "Zahlungsverlauf", exact: true})
        .click();
    await expect(
        reviewCard.getByText("QA partial payment", {exact: true}),
    ).toBeVisible();
    await reviewCard
        .getByRole("button", {name: "Zahlungseintrag stornieren", exact: true})
        .click();
    await adminPage
        .getByRole("dialog")
        .getByLabel("Grund der Stornierung", {exact: true})
        .fill("Fictional mistaken record corrected in QA.");
    await adminPage
        .getByRole("dialog")
        .getByRole("button", {name: "Zahlungseintrag stornieren", exact: true})
        .click();
    await expect(adminPage.getByRole("dialog")).not.toBeVisible();
    await expect(
        reviewCard.getByText(/Fictional mistaken record corrected/),
    ).toBeVisible();
    await reviewCard
        .getByRole("button", {name: "Zahlung eintragen", exact: true})
        .click();
    await expect(
        adminPage
            .getByRole("dialog")
            .getByLabel("Zahlungsbetrag (EUR)", {exact: true}),
    ).toHaveValue("123.45");
    await adminPage
        .getByRole("dialog")
        .getByRole("button", {name: "Zahlung speichern", exact: true})
        .click();
    await expect(adminPage.getByRole("dialog")).not.toBeVisible();
    await expect(
        reviewCard.locator(".commercial-status-paid", {hasText: /^Bezahlt$/}),
    ).toBeVisible();
    await page.reload();
    await expect(
        invoice.locator(".commercial-status-paid", {hasText: /^Bezahlt$/}),
    ).toBeVisible();
    const api = await actor(lecturer);
    const records = await api.rpc("invoice_records", {p_all: false});
    expect(records.error).toBeNull();
    const record = records.data.find(
        (item: { number: string }) => item.number === number,
    );
    expect(record.status).toBe("paid");
    expect(Number(record.total_amount)).toBe(123.45);
    expect(Number(record.paid_amount)).toBe(123.45);
    expect(record.currency).toBe("EUR");
    expect(record.claim_ids).toEqual([eur.claimId]);
    expect(record.issued_on).toBe(issueDate.toISODate());
    expect(record.due_on).toBe(issueDate.plus({days: 30}).toISODate());
    await a11y(adminPage);
    await adminContext.close();
});

test("settlement for a cancelled assignment shares only verified lecturer totals", async ({
    page,
    browser,
}, testInfo) => {
    test.setTimeout(90_000);
    const lecturer = await account("lecturer", "settlement-lecturer");
    const administrator = await account("admin", "settlement-finance");
    const job = await acceptedJob(lecturer, "EUR", 200, 4, false);
    const adminApi = await actor(administrator);
    const cancelled = await adminApi.rpc("cancel_job_assignment", {
        p_claim_id: job.claimId,
        p_reason: "Fictional schedule change before delivery.",
        p_request_id: randomUUID(),
    });
    expect(cancelled.error).toBeNull();

    await login(page, lecturer);
    await page.goto("/finance");
    const lecturerCase = page.locator("article.invoice-review-row")
        .filter({hasText: job.title});
    await lecturerCase.getByRole("button", {name: "Prüfung anfordern", exact: true}).click();
    await expect(lecturerCase.getByText("Prüfung angefordert", {exact: true})).toBeVisible();

    const adminContext = await browser.newContext({
        baseURL: process.env.E2E_BASE_URL,
        viewport: testInfo.project.use.viewport,
        isMobile: testInfo.project.use.isMobile,
        hasTouch: testInfo.project.use.hasTouch,
        deviceScaleFactor: testInfo.project.use.deviceScaleFactor,
    });
    try {
        const adminPage = await adminContext.newPage();
        await login(adminPage, administrator);
        await adminPage.goto("/admin/finance");
        const financeCase = adminPage.locator("article.invoice-review-row")
            .filter({hasText: job.title});
        await financeCase.getByText("Abrechnung berechnen", {exact: true}).click();
        await financeCase.getByLabel("Zeitzone des Auftrags").fill("Europe/Berlin");
        await financeCase.getByLabel("Datum der Leistung").fill("2035-05-04");
        await financeCase.getByLabel("Ergebnis der Prüfung").selectOption("customer");
        await financeCase.getByLabel("Vereinbartes Honorar je Einheit (EUR)").fill("200");
        await financeCase.getByLabel("Vereinbartes Auftragshonorar für diese Einheit").fill("512.42");
        await financeCase.getByLabel("Tatsächlich erhaltene Stornozahlung für diese Einheit").fill("256.21");
        await financeCase.getByRole("button", {name: "Einheit hinzufügen", exact: true}).click();
        const holiday = financeCase.getByRole("group", {name: "Vergütungseinheit 2"});
        await holiday.getByLabel("Leistung", {exact: true}).selectOption("nonTeaching");
        await holiday.getByLabel("Datum der Leistung").fill("2035-05-05");
        await holiday.getByLabel("Ergebnis der Prüfung").selectOption("customerNonTeaching");
        await holiday.getByLabel("Vereinbartes Honorar je Einheit (EUR)").fill("200");
        await holiday.getByLabel("Vereinbartes Auftragshonorar für diese Einheit").fill("404.20");
        await holiday.getByLabel("Tatsächlich erhaltene Zahlung des Unternehmens für den unterrichtsfreien Tag").fill("101.05");
        await financeCase.getByRole("button", {name: "Berechnen", exact: true}).click();
        const attach = financeCase.getByRole("button", {name: "Beträge in die Prüfnotiz übernehmen"});
        await expect(attach).toBeDisabled();
        await financeCase.getByRole("checkbox", {name: "Ich habe den Vertrag, die Leistungen und die zugeordneten Belege geprüft."}).check();
        await attach.click();
        await financeCase.getByRole("textbox", {name: /Prüfnotiz/}).fill("Geprüfter fiktiver Zahlungseingang.");
        await financeCase.getByRole("button", {name: "Prüfung dokumentieren"}).click();
        await expect(financeCase).toHaveCount(0);
    } finally {
        await adminContext.close();
    }

    await page.reload();
    const notice = lecturerCase.getByRole("status");
    await expect(notice).toContainText(/Stornovergütung: 100,00\s*€/);
    await expect(notice).toContainText(/Vergütung für unterrichtsfreie Tage: 50,00\s*€/);
    await expect(notice).toContainText(/Offener Betrag laut Berechnung: 150,00\s*€/);
    await expect(notice).not.toContainText(/512[.,]42|256[.,]21|404[.,]20|101[.,]05/);
    const lecturerApi = await actor(lecturer);
    const invoices = await lecturerApi.rpc("invoice_records", {p_all: false});
    expect(invoices.error).toBeNull();
    expect(invoices.data).toEqual([]);
});

test("finance can revoke an exceptional approval after reloading the portal", async ({
    page,
    browser,
}, testInfo) => {
    test.setTimeout(120_000);
    const lecturer = await account("lecturer", "exception-lecturer");
    const administrator = await account("admin", "exception-finance");
    const contract = randomUUID(), document = randomUUID(), version = randomUUID();
    const clientId = randomUUID(), digest = "a".repeat(64);
    const sharedPdfMetadata = {
        original_name: "Fictional executed contract.pdf",
        mime_type: "application/pdf",
        size_bytes: 100,
        status: "clean",
        client_id: clientId,
        uploaded_by: lecturer.id,
    };
    expect((await service().from("documents").insert({
        ...sharedPdfMetadata,
        id: document,
        owner_id: lecturer.id,
        scope: "personal",
        kind: "contract",
    })).error).toBeNull();
    expect((await service().from("document_versions").insert({
        ...sharedPdfMetadata,
        id: version,
        document_id: document,
        version: 1,
        object_path: `${lecturer.id}/${document}/${version}`,
        sha256: digest,
    })).error).toBeNull();
    expect((await service().from("documents").update({current_version_id: version}).eq("id", document)).error).toBeNull();
    expect((await service().from("contracts").insert({
        id: contract,
        user_id: lecturer.id,
        status: "active",
        version: 1,
        effective_from: DateTime.utc().minus({days: 7}).toISO(),
        document_version_id: version,
        document_sha256: digest,
    })).error).toBeNull();

    const job = await acceptedJob(lecturer, "EUR", 200, 6, false);
    const adminApi = await actor(administrator);
    expect((await adminApi.rpc("cancel_job_assignment", {
        p_claim_id: job.claimId,
        p_reason: "Fictional course cancellation for final invoice review.",
        p_request_id: randomUUID(),
    })).error).toBeNull();

    await login(page, lecturer);
    await page.goto("/finance");
    const lecturerCase = page.locator("article.invoice-review-row").filter({hasText: job.title});
    await lecturerCase.getByRole("button", {name: "Prüfung anfordern", exact: true}).click();
    await expect(lecturerCase.getByText("Prüfung angefordert", {exact: true})).toBeVisible();

    const financeContext = await browser.newContext({
        baseURL: process.env.E2E_BASE_URL,
        viewport: testInfo.project.use.viewport,
        isMobile: testInfo.project.use.isMobile,
        hasTouch: testInfo.project.use.hasTouch,
        deviceScaleFactor: testInfo.project.use.deviceScaleFactor,
    });
    try {
        const financePage = await financeContext.newPage();
        await login(financePage, administrator);
        await financePage.goto("/notifications");
        const reviewNotice = financePage.locator(".inbox-list > .notification-row").filter({
            hasText: "Prüfung einer Rechnung angefragt",
        }).first();
        await expect(reviewNotice).toBeVisible();
        await reviewNotice.getByRole("link", {name: "Öffnen", exact: true}).click();
        await expect(financePage).toHaveURL(/\/finance$/);
        const review = financePage.locator("article.invoice-review-row").filter({hasText: job.title});
        await review.getByRole("button", {name: "Ausnahmeabrechnung vorbereiten"}).click();
        await review.getByLabel("Prüfnotiz (mindestens 10 Zeichen)").fill("Fiktive Prüfung der ausgeführten Vertragsfassung und des Stornobetrags.");
        await review.getByLabel("Geprüfter Betrag (EUR)").fill("90,25");
        await review.getByLabel("Vereinbarte Fälligkeit").fill(DateTime.utc().plus({days: 7}).toISODate()!);
        await review.getByRole("button", {name: "Schlussrechnung zur Einreichung freigeben"}).click();
        await expect(review.getByRole("button", {name: "Freigabe verwalten"})).toBeVisible();

        await page.goto("/notifications");
        const approvalNotice = page.locator(".inbox-list > .notification-row").filter({
            hasText: "Ausnahmerechnung zur Einreichung freigegeben",
        });
        await expect(approvalNotice).toHaveCount(1);
        await expect(approvalNotice).not.toContainText(job.title);
        await approvalNotice.getByRole("link", {name: "Öffnen", exact: true}).click();
        const ready = page.locator("section.invoice-review-request-list").filter({
            has: page.getByRole("heading", {name: "Freigegebene Ausnahmeabrechnungen"}),
        });
        await expect(ready.getByRole("button", {name: "Ausnahmerechnung einreichen"})).toBeVisible();

        await financePage.reload();
        await review.getByRole("button", {name: "Freigabe verwalten"}).click();
        await expect(review.getByText(/90,25\s*€/)).toBeVisible();
        await review.getByLabel("Widerrufsgrund (mindestens 10 Zeichen)").fill("Fiktive Korrektur vor der Rechnungseinreichung.");
        await review.getByRole("button", {name: "Einreichungsfreigabe widerrufen"}).click();
        await expect(review.getByRole("button", {name: "Ausnahmeabrechnung vorbereiten"})).toBeVisible();

        await page.goto("/notifications");
        const revokeNotice = page.locator(".inbox-list > .notification-row").filter({
            hasText: "Freigabe für Ausnahmerechnung widerrufen",
        });
        await expect(revokeNotice).toHaveCount(1);
        await expect(approvalNotice).toHaveCount(0);
        await revokeNotice.getByRole("link", {name: "Öffnen", exact: true}).click();
        await expect(lecturerCase.getByText("Prüfung angefordert", {exact: true})).toBeVisible();
        await expect(ready).toHaveCount(0);
    } finally {
        await financeContext.close();
    }
});

test("a scanned exceptional invoice can be submitted and downloaded through the portal", async ({
    page,
    browser,
}, testInfo) => {
    test.setTimeout(120_000);
    const lecturer = await account("lecturer", "scanned-exception-lecturer");
    const administrator = await account("admin", "scanned-exception-finance");
    const pdf = fictionalPdf();
    const tag = randomUUID().slice(0, 8);
    const contractFile = `fictional-exception-contract-${tag}.pdf`;
    const invoiceFile = `fictional-exception-invoice-${tag}.pdf`;
    const number = `EX-QA-${tag}`;
    const dueOn = DateTime.utc().plus({days: 7}).toISODate()!;
    const financeContext = await browser.newContext({
        baseURL: process.env.E2E_BASE_URL,
        viewport: testInfo.project.use.viewport,
        isMobile: testInfo.project.use.isMobile,
        hasTouch: testInfo.project.use.hasTouch,
        deviceScaleFactor: testInfo.project.use.deviceScaleFactor,
    });
    try {
        await login(page, lecturer);
        await page.goto("/contracts");
        await page.getByLabel("Ausgeführter Vertrag als PDF", {exact: true}).setInputFiles({
            name: contractFile,
            mimeType: "application/pdf",
            buffer: pdf,
        });
        await expect(page.getByText(/PDF geprüft und bereit/)).toBeVisible({
            timeout: 45_000,
        });
        const financePage = await financeContext.newPage();
        await login(financePage, administrator);
        await financePage.goto("/contracts");
        await financePage.getByRole("button", {name: "Ausgeführten Vertrag hinterlegen"}).click();
        const contract = financePage.getByRole("dialog");
        await contract.getByLabel("Dozent:in", {exact: true}).selectOption(lecturer.id);
        await contract.getByLabel("Titel", {exact: true}).fill(`Fiktiver Rahmenvertrag ${tag}`);
        await contract.getByLabel(/Gültig ab/).fill("2026-01-01T00:00");
        const contractFileField = contract.getByLabel("Hochgeladene Vertragsdatei");
        await expect(contractFileField.locator("option", {hasText: contractFile})).toHaveCount(1);
        await contractFileField.selectOption({label: contractFile});
        await contract.getByRole("button", {name: "Vertrag speichern"}).click();
        await expect(contract).not.toBeVisible();

        const job = await acceptedJob(lecturer, "EUR", 200, 7, false);
        const adminApi = await actor(administrator);
        expect((await adminApi.rpc("cancel_job_assignment", {
            p_claim_id: job.claimId,
            p_reason: "Fictional cancellation for verified PDF invoice submission.",
            p_request_id: randomUUID(),
        })).error).toBeNull();
        await page.goto("/finance");
        const lecturerReview = page.locator("article.invoice-review-row").filter({hasText: job.title});
        await lecturerReview.getByRole("button", {name: "Prüfung anfordern", exact: true}).click();
        await expect(lecturerReview.getByText("Prüfung angefordert", {exact: true})).toBeVisible();

        await financePage.goto("/admin/finance");
        const review = financePage.locator("article.invoice-review-row").filter({hasText: job.title});
        await review.getByRole("button", {name: "Ausnahmeabrechnung vorbereiten"}).click();
        await review.getByLabel("Prüfnotiz (mindestens 10 Zeichen)").fill("Fiktive Vertragsprüfung und Freigabe des Stornobetrags.");
        await review.getByLabel("Geprüfter Betrag (EUR)").fill("90,25");
        await review.getByLabel("Vereinbarte Fälligkeit").fill(dueOn);
        const approval = financePage.waitForResponse((response) =>
            new URL(response.url()).pathname === "/rest/v1/rpc/approve_invoice_exception" &&
            response.request().method() === "POST");
        await review.getByRole("button", {name: "Schlussrechnung zur Einreichung freigeben"}).click();
        const approvalResponse = await approval;
        expect(approvalResponse.status()).toBe(200);
        const approvalId = await approvalResponse.json();
        await expect(review.getByRole("button", {name: "Freigabe verwalten"})).toBeVisible();

        await page.reload();
        const ready = page.locator("section.invoice-review-request-list").filter({
            has: page.getByRole("heading", {name: "Freigegebene Ausnahmeabrechnungen"}),
        });
        await ready.getByRole("button", {name: "Ausnahmerechnung einreichen"}).click();
        const dialog = page.getByRole("dialog");
        await dialog.getByLabel("Rechnungsnummer", {exact: true}).fill(number);
        await expect(dialog.getByLabel("Fällig am", {exact: true})).toHaveValue(dueOn);
        await expect(dialog.getByLabel("Fällig am", {exact: true})).not.toBeEditable();
        await expect(dialog.getByText(/90,25\s*€/)).toBeVisible();
        const submit = dialog.getByRole("button", {name: "Rechnung einreichen", exact: true});
        await expect(submit).toBeDisabled();
        const upload = page.waitForResponse((response) =>
            new URL(response.url()).pathname === "/functions/v1/files" &&
            response.request().method() === "POST", {timeout: 45_000});
        await dialog.getByLabel("Rechnung als PDF", {exact: true}).setInputFiles({
            name: invoiceFile,
            mimeType: "application/pdf",
            buffer: pdf,
        });
        const uploadResponse = await upload;
        expect(uploadResponse.status(), await uploadResponse.text()).toBe(200);
        const {document} = await uploadResponse.json();
        expect(document).toMatchObject({owner_id: lecturer.id, kind: "invoice", status: "clean"});
        await expect(dialog.getByText(/PDF geprüft und bereit/)).toBeVisible();
        const version = await service().from("document_versions")
            .select("document_id,sha256,status,scanner_version")
            .eq("id", document.current_version_id).single();
        expect(version.error).toBeNull();
        expect(version.data).toMatchObject({
            document_id: document.id,
            sha256: createHash("sha256").update(pdf).digest("hex"),
            status: "clean",
            scanner_version: expect.stringMatching(/^ClamAV\s/),
        });

        const submission = page.waitForResponse((response) =>
            new URL(response.url()).pathname === "/rest/v1/rpc/submit_exception_invoice" &&
            response.request().method() === "POST");
        await submit.click();
        const submissionResponse = await submission;
        expect(submissionResponse.status()).toBe(200);
        const invoiceId = await submissionResponse.json();
        await expect(dialog).not.toBeVisible();
        await expect(ready.getByRole("button", {name: "Ausnahmerechnung einreichen"})).toHaveCount(0);
        const submitted = page.locator("article").filter({
            has: page.getByRole("heading", {name: number, exact: true}),
        });
        await expect(submitted.getByText("Eingereicht", {exact: true})).toBeVisible();
        const invoice = await service().from("invoices")
            .select("user_id,number,due_on,currency,total_amount,status,document_version_id,exception_approval_id")
            .eq("id", invoiceId).single();
        expect(invoice.error).toBeNull();
        expect(invoice.data).toMatchObject({
            user_id: lecturer.id,
            number,
            due_on: dueOn,
            currency: "EUR",
            total_amount: 90.25,
            status: "submitted",
            document_version_id: document.current_version_id,
            exception_approval_id: approvalId,
        });
        const items = await service().from("invoice_items")
            .select("claim_id,active").eq("invoice_id", invoiceId);
        expect(items.error).toBeNull();
        expect(items.data).toEqual([{claim_id: job.claimId, active: true}]);

        await financePage.reload();
        const financeInvoice = financePage.locator("article").filter({
            has: financePage.getByRole("heading", {name: number, exact: true}),
        });
        await expect(financeInvoice.getByText("Eingereicht", {exact: true})).toBeVisible();
        const download = financePage.waitForEvent("download");
        await financeInvoice.getByRole("button", {name: "Dokument herunterladen", exact: true}).click();
        const saved = await download;
        expect(await saved.failure()).toBeNull();
        expect(await readFile((await saved.path())!)).toEqual(pdf);

        const unrelatedLecturer = await account("lecturer", "unrelated-invoice-reader");
        const unrelatedApi = await actor(unrelatedLecturer);
        const unrelatedSession = await unrelatedApi.auth.getSession();
        expect(unrelatedSession.error).toBeNull();
        const denied = await page.request.post(`${process.env.SUPABASE_URL}/functions/v1/files`, {
            headers: {
                origin: new URL(page.url()).origin,
                authorization: `Bearer ${unrelatedSession.data.session!.access_token}`,
                apikey: process.env.SUPABASE_ANON_KEY!,
            },
            data: {action: "download", id: document.id, version_id: document.current_version_id},
        });
        expect(denied.status()).toBe(403);
        expect(await denied.json()).toEqual({error: "access_denied"});
    } finally {
        await financeContext.close();
    }
});

test("a closing invoice credits two paid interim invoices in the same series", async ({page, browser}, testInfo) => {
    await checkInvoiceSeries(page, browser, testInfo, false);
});

test("an invoice-series overpayment is acknowledged and settled with separately recorded repayments", async ({page, browser}, testInfo) => {
    await checkInvoiceSeries(page, browser, testInfo, true);
});

async function checkInvoiceSeries(page: Page, browser: Browser, testInfo: TestInfo, overpayment: boolean) {
    test.setTimeout(180_000);
    const lecturer = await account("lecturer", "series-lecturer");
    const administrator = await account("admin", "series-finance");
    const tag = randomUUID().slice(0, 8);
    const pdf = fictionalPdf();
    const contractFile = `fictional-series-contract-${tag}.pdf`;
    const dueOn = DateTime.utc().plus({days: 10}).toISODate()!;
    const financeContext = await browser.newContext({
        baseURL: process.env.E2E_BASE_URL,
        viewport: testInfo.project.use.viewport,
        isMobile: testInfo.project.use.isMobile,
        hasTouch: testInfo.project.use.hasTouch,
        deviceScaleFactor: testInfo.project.use.deviceScaleFactor,
    });
    try {
        const financePage = await financeContext.newPage();
        await login(page, lecturer);
        await page.goto("/contracts");
        await page.getByLabel("Ausgeführter Vertrag als PDF", {exact: true}).setInputFiles({
            name: contractFile,
            mimeType: "application/pdf",
            buffer: pdf,
        });
        await expect(page.getByText(/PDF geprüft und bereit/)).toBeVisible({timeout: 45_000});
        await login(financePage, administrator);
        await financePage.goto("/contracts");
        await financePage.getByRole("button", {name: "Ausgeführten Vertrag hinterlegen"}).click();
        const managementDialog = financePage.getByRole("dialog");
        await managementDialog.getByLabel("Dozent:in", {exact: true}).selectOption(lecturer.id);
        await managementDialog.getByLabel("Titel", {exact: true}).fill(`Fiktiver Vertrag für Abschläge ${tag}`);
        await managementDialog.getByLabel(/Gültig ab/).fill("2026-01-01T00:00");
        const contractFileField = managementDialog.getByLabel("Hochgeladene Vertragsdatei");
        await expect(contractFileField.locator("option", {hasText: contractFile})).toHaveCount(1);
        await contractFileField.selectOption({label: contractFile});
        await managementDialog.getByRole("button", {name: "Vertrag speichern", exact: true}).click();
        await expect(managementDialog).not.toBeVisible();
        const job = await acceptedJob(lecturer, "EUR", 300, 16, false, [17]);
        await finishAcceptedJob(job, 7, "2035-05-16T08:00:00Z");

        const finance = () => financePage.goto("/admin/finance");
        async function openSeries() {
            await finance();
            await financePage.getByRole("row").filter({hasText: job.title})
                .getByRole("button", {name: "Rechnungsserie öffnen", exact: true}).click();
        }
        async function approve(kind: "interim" | "final", amount: string) {
            await openSeries();
            await managementDialog.getByLabel(kind === "interim"
                ? "Geprüfter Betrag (EUR)"
                : "Geprüfter Gesamtanspruch (EUR)", {exact: true}).fill(amount);
            await expect(managementDialog.getByLabel("Vertragsfassung", {exact: true})).not.toHaveValue("");
            await managementDialog.getByLabel("Vereinbarte Fälligkeit", {exact: true}).fill(dueOn);
            await managementDialog.getByLabel("Prüfnotiz (mindestens 10 Zeichen)", {exact: true})
                .fill("Fiktive Überprüfung der Vertragsfassung, der Leistung und der erfassten Zahlungen.");
            if (kind === "final") {
                await expect(managementDialog.getByText(/Erfasste Abschlagszahlungen: 110,00\s*€/)).toBeVisible();
                await expect(managementDialog.getByText(/Rechnungsbetrag: 120,00\s*€/)).toBeVisible();
            }
            const approval = financePage.waitForResponse((response) =>
                new URL(response.url()).pathname === "/rest/v1/rpc/approve_invoice_series_entry" &&
                response.request().method() === "POST");
            await managementDialog.getByRole("button", {name: "Einreichung freigeben", exact: true}).click();
            const response = await approval;
            expect(response.status(), await response.text()).toBe(200);
            await managementDialog.getByRole("button", {name: "Schließen", exact: true}).click();
            return await response.json();
        }
        async function submit(kind: "interim" | "final", number: string, amount: RegExp) {
            await page.goto("/finance");
            const entry = page.locator("section.invoice-review-request-list")
                .filter({has: page.getByRole("heading", {name: "Rechnungsserien zur Einreichung", exact: true})})
                .locator("article").filter({hasText: job.title});
            await expect(entry.getByText(amount)).toBeVisible();
            if (kind === "final") {
                await entry.getByText(/Verrechnete Abschlagszahlungen: 110,00\s*€/).click();
                await expect(entry.getByText(new RegExp(`EX-${tag}-1.*50,25`))).toBeVisible();
                await expect(entry.getByText(new RegExp(`EX-${tag}-2.*59,75`))).toBeVisible();
            }
            await entry.getByRole("button", {
                name: kind === "interim"
                    ? "Abschlagsrechnung einreichen"
                    : "Schlussrechnung mit Verrechnung einreichen",
                exact: true,
            }).click();
            const dialog = page.getByRole("dialog");
            await dialog.getByLabel("Rechnungsnummer", {exact: true}).fill(number);
            await expect(dialog.getByLabel("Fällig am", {exact: true})).toHaveValue(dueOn);
            await expect(dialog.getByLabel("Fällig am", {exact: true})).not.toBeEditable();
            const send = dialog.getByRole("button", {name: "Rechnung einreichen", exact: true});
            await expect(send).toBeDisabled();
            await dialog.getByLabel("Rechnung als PDF", {exact: true}).setInputFiles({
                name: `${number}.pdf`,
                mimeType: "application/pdf",
                buffer: pdf,
            });
            await expect(dialog.getByText(/PDF geprüft und bereit/)).toBeVisible({timeout: 45_000});
            const submission = page.waitForResponse((response) =>
                new URL(response.url()).pathname === "/rest/v1/rpc/submit_invoice_series_entry" &&
                response.request().method() === "POST");
            await send.click();
            const response = await submission;
            expect(response.status(), await response.text()).toBe(200);
            await expect(dialog).not.toBeVisible();
            return await response.json();
        }
        async function pay(number: string, amount: string) {
            await finance();
            const card = financePage.locator("article").filter({
                has: financePage.getByRole("heading", {name: number, exact: true}),
            });
            await card.getByRole("button", {name: "Rechnung prüfen", exact: true}).click();
            await managementDialog.getByLabel("Notiz zur Prüfung", {exact: true}).fill("Fiktive Rechnungsprüfung.");
            await managementDialog.getByRole("button", {name: "Rechnung freigeben", exact: true}).click();
            await expect(managementDialog).not.toBeVisible();
            await card.getByRole("button", {name: "Zahlung eintragen", exact: true}).click();
            await expect(managementDialog.getByLabel("Zahlungsbetrag (EUR)", {exact: true})).toHaveValue(amount);
            await managementDialog.getByRole("button", {name: "Zahlung speichern", exact: true}).click();
            await expect(managementDialog).not.toBeVisible();
            await expect(card.locator(".commercial-status-paid", {hasText: /^Bezahlt$/})).toBeVisible();
        }

        const firstNumber = `EX-${tag}-1`;
        const secondNumber = `EX-${tag}-2`;
        const closingNumber = `EX-${tag}-FINAL`;
        await approve("interim", "50,25");
        const firstInvoice = await submit("interim", firstNumber, /Rechnungsbetrag: 50,25\s*€/);
        await openSeries();
        await expect(managementDialog.getByText(/Zurzeit kann keine weitere Rechnung freigegeben werden/)).toBeVisible();
        await managementDialog.getByRole("button", {name: "Schließen", exact: true}).click();
        await pay(firstNumber, "50.25");
        await approve("interim", "59,75");
        const secondInvoice = await submit("interim", secondNumber, /Rechnungsbetrag: 59,75\s*€/);
        await pay(secondNumber, "59.75");

        await finishAcceptedJob(job, 2, "2035-05-17T08:00:00Z");
        if (overpayment) {
            const postedDate = DateTime.utc().minus({days: 1}).toISODate()!;
            const managerApi = await actor(administrator);
            const lecturerApi = await actor(lecturer);
            await openSeries();
            await managementDialog.locator("summary").filter({hasText: /^Überzahlung zur Prüfung vorlegen$/}).click();
            const proposal = managementDialog.getByRole("group", {name: "Überzahlung zur Prüfung vorlegen", exact: true});
            await proposal.getByLabel("Geprüfter Gesamtanspruch (EUR)", {exact: true}).fill("75");
            await proposal.getByLabel("Vereinbarte Fälligkeit", {exact: true}).fill(dueOn);
            await proposal.getByLabel("Prüfnotiz (mindestens 10 Zeichen)", {exact: true})
                .fill("Fiktive Prüfung der Überzahlung und der erfassten Abschlagszahlungen.");
            await expect(proposal.getByText(/Saldo nach Abschlägen: [-−]35,00\s*€/)).toBeVisible();
            const proposed = financePage.waitForResponse((response) =>
                new URL(response.url()).pathname === "/rest/v1/rpc/propose_invoice_series_correction" &&
                response.request().method() === "POST");
            await proposal.getByRole("button", {name: "Korrektur vorlegen", exact: true}).click();
            const proposalResponse = await proposed;
            expect(proposalResponse.status(), await proposalResponse.text()).toBe(200);
            const correctionId = await proposalResponse.json();

            await page.goto("/notifications");
            const proposalNotice = page.locator(".inbox-list > .notification-row").filter({
                hasText: "Überzahlungskorrektur zur Bestätigung vorgelegt",
            });
            await expect(proposalNotice).toBeVisible();
            await expect(proposalNotice).not.toContainText("35,00");
            await expect(proposalNotice).not.toContainText("Fiktive Prüfung");
            const proposalLink = proposalNotice.getByRole("link");
            await expect(proposalLink).toHaveAttribute("href", `/finance#correction-${correctionId}`);
            await proposalLink.click();
            const card = page.locator("section.invoice-review-request-list").filter({
                has: page.getByRole("heading", {name: "Korrektur überzahlter Abschläge", exact: true}),
            }).locator("article").filter({hasText: job.title});
            await expect(card.getByText("Bestätigung ausstehend", {exact: true})).toBeVisible();
            await expect(card).toBeFocused();
            await card.getByText("Verrechnete Zahlungsbelege", {exact: true}).click();
            await expect(card.getByText(new RegExp(firstNumber + ".*50,25"))).toBeVisible();
            await expect(card.getByText(new RegExp(secondNumber + ".*59,75"))).toBeVisible();
            const confirm = card.getByRole("button", {name: "Korrektur bestätigen", exact: true});
            await expect(confirm).toBeDisabled();
            await card.getByRole("checkbox", {name: /Ich habe Vertragsfassung/}).check();
            await confirm.click();
            await expect(card.getByText("Bestätigt · Rückzahlung offen", {exact: true})).toBeVisible();

            const refundInputs = () => managementDialog.getByRole("group", {name: "Rückzahlungseingang erfassen", exact: true});
            const registerReceipt = async (amount: string, reference: string) => {
                const fields = refundInputs();
                await fields.getByLabel("Geprüfter Betrag (EUR)", {exact: true}).fill(amount);
                await fields.getByLabel("Eingangsdatum", {exact: true}).fill(postedDate);
                await fields.getByLabel("Referenz des Zahlungseingangs", {exact: true}).fill(reference);
                const receipt = financePage.waitForResponse((response) =>
                    new URL(response.url()).pathname === "/rest/v1/rpc/record_invoice_series_repayment" &&
                    response.request().method() === "POST");
                await fields.getByRole("button", {name: "Rückzahlungseingang erfassen", exact: true}).click();
                const response = await receipt;
                expect(response.status(), await response.text()).toBe(200);
                return await response.json();
            };
            await financePage.goto("/notifications");
            const responseNotice = financePage.locator(".inbox-list > .notification-row").filter({
                hasText: "Überzahlungskorrektur bestätigt",
            });
            await expect(responseNotice).toBeVisible();
            await expect(responseNotice).not.toContainText("35,00");
            const responseLink = responseNotice.getByRole("link");
            await expect(responseLink).toHaveAttribute("href", `/finance?series=${job.claimId}`);
            await responseLink.click();
            await expect(managementDialog).toBeVisible();
            const firstReceipt = await registerReceipt("20", `R-${tag}-1`);
            await expect(managementDialog.getByText(/^15,00\s*€$/)).toBeVisible();
            const lastReceipt = await registerReceipt("15", `R-${tag}-2`);
            await expect(managementDialog.getByText("Rückzahlung vollständig erfasst", {exact: true})).toBeVisible();
            await managementDialog.getByText("Verrechnete Zahlungsbelege", {exact: true}).click();
            const download = financePage.waitForEvent("download");
            await managementDialog.getByRole("button", {name: "Korrekturbeleg als CSV", exact: true}).click();
            const saved = await download;
            expect(await saved.failure()).toBeNull();
            const csv = await readFile((await saved.path())!, "utf8");
            expect(csv).toContain(firstNumber);
            expect(csv).toContain(lastReceipt);
            expect(csv).toContain(postedDate);

            await page.reload();
            await expect(card.getByText("Rückzahlung vollständig erfasst", {exact: true})).toBeVisible();
            const retained = await lecturerApi.rpc("invoice_series_corrections", {p_claim_id: null, p_all: false});
            expect(retained.error).toBeNull();
            expect(retained.data.entries).toEqual([expect.objectContaining({
                id: correctionId, state: "settled", balance: -35, credited: 110, repaid: 35, outstanding: 0,
                repayments: expect.arrayContaining([
                    expect.objectContaining({id: firstReceipt, amount: 20, received_on: postedDate}),
                    expect.objectContaining({id: lastReceipt, amount: 15, received_on: postedDate}),
                ]),
            })]);
            const earlier = await managerApi.rpc("invoice_records", {p_all: true});
            expect(earlier.error).toBeNull();
            expect(earlier.data.filter((invoice: {id: string}) => [firstInvoice, secondInvoice].includes(invoice.id)))
                .toEqual(expect.arrayContaining([
                    expect.objectContaining({id: firstInvoice, status: "paid", total_amount: 50.25, paid_amount: 50.25}),
                    expect.objectContaining({id: secondInvoice, status: "paid", total_amount: 59.75, paid_amount: 59.75}),
                ]));
            return;
        }
        const closingApproval = await approve("final", "230");
        const closingInvoice = await submit("final", closingNumber, /Rechnungsbetrag: 120,00\s*€/);
        const lecturerApi = await actor(lecturer);
        const records = await lecturerApi.rpc("invoice_series_records", {p_all: false});
        expect(records.error).toBeNull();
        const closing = records.data.find((record: {id: string}) => record.id === closingApproval);
        expect(closing).toMatchObject({
            claim_id: job.claimId,
            kind: "final",
            invoice_id: closingInvoice,
            gross_amount: 230,
            credit_amount: 110,
            amount: 120,
            due_on: dueOn,
            currency: "EUR",
        });
        expect(closing.credits).toEqual(expect.arrayContaining([
            expect.objectContaining({invoice_id: firstInvoice, invoice_number: firstNumber, amount: 50.25}),
            expect.objectContaining({invoice_id: secondInvoice, invoice_number: secondNumber, amount: 59.75}),
        ]));
        expect(closing.credits).toHaveLength(2);
        await pay(closingNumber, "120.00");
    } finally {
        await financeContext.close();
    }
}

test("coordinated commercial amendment preserves the agreement through corrected delivery and settlement", async ({
    page,
    browser,
}, testInfo) => {
    test.setTimeout(180_000);
    const lecturer = await account("lecturer", "amendment-teacher");
    const colleague = await account("lecturer", "amendment-colleague");
    const manager = await account("admin", "amendment-reviewer");
    const managerContext = await browser.newContext(testInfo.project.use);
    const colleagueContext = await browser.newContext(testInfo.project.use);
    const review = await managerContext.newPage();
    const other = await colleagueContext.newPage();
    const backend = service();
    const pdf = fictionalPdf();
    const zone = "Europe/Berlin";
    const originalTerms = "Fictional original commissioned terms.";
    const newTerms = "Fictional approved scope for the rescheduled course.";
    const correctReason = "Verified the actual shorter teaching duration.";

    try {
        await login(review, manager);
        // Both independent lecturers need a genuinely scanned executed contract
        // before claiming the same contract-restricted course.
        for (const user of [lecturer, colleague]) {
            await review.goto(`/contracts?user=${user.id}`);
            await review
                .getByRole("button", {
                    name: "Ausgeführten Vertrag hinterlegen",
                    exact: true,
                })
                .click();
            const form = review.getByRole("dialog");
            await expect(
                form.getByLabel("Dozent:in", {exact: true}),
            ).toHaveValue(user.id);
            const fileName = `fictional-agreement-${user.id.slice(0, 8)}.pdf`;
            await form
                .getByLabel("Titel", {exact: true})
                .fill(`Fictional agreement ${user.name}`);
            await form
                .getByLabel(/Gültig ab/)
                .fill(
                    DateTime.now()
                        .minus({days: 7})
                        .toFormat("yyyy-MM-dd'T'HH:mm"),
                );
            await form
                .getByLabel("Ausgeführter Vertrag als PDF", {exact: true})
                .setInputFiles({
                    name: fileName,
                    mimeType: "application/pdf",
                    buffer: pdf,
                });
            await expect(form.getByText(/PDF geprüft und bereit/)).toBeVisible({
                timeout: 45_000,
            });
            await form
                .getByLabel("Hochgeladene Vertragsdatei")
                .selectOption({label: fileName});
            await form
                .getByRole("button", {name: "Vertrag speichern", exact: true})
                .click();
            await expect(form).not.toBeVisible();
        }
        const contract = await backend
            .from("contracts")
            .select("id,document_sha256,document_version_id")
            .eq("user_id", lecturer.id)
            .single();
        expect(contract.error).toBeNull();
        expect(contract.data?.document_sha256).toBe(
            createHash("sha256").update(pdf).digest("hex"),
        );
        await login(page, lecturer);
        await page.goto("/contracts");
        const agreement = page.locator("article").filter({
            has: page.getByRole("heading", {
                name: `Fictional agreement ${lecturer.name}`,
                exact: true,
            }),
        });
        const contractDownload = page.waitForEvent("download");
        await agreement
            .getByRole("button", {name: "Dokument herunterladen", exact: true})
            .click();
        expect(
            await readFile((await (await contractDownload).path())!),
        ).toEqual(pdf);

        const company = randomUUID();
        const course = randomUUID();
        const template = randomUUID();
        const courseSession = randomUUID();
        const title = `Fictional coordinated amendment ${course.slice(0, 8)}`;
        const starts = DateTime.now()
            .setZone(zone)
            .plus({days: 80})
            .startOf("day")
            .set({hour: 10});
        const rescheduled = starts.plus({days: 2});
        expect(
            (
                await backend.from("organisations").insert({
                    id: company,
                    name: `Fictional customer ${company.slice(0, 8)}`,
                })
            ).error,
        ).toBeNull();
        expect(
            (
                await backend
                    .from("course_templates")
                    .insert({id: template, title})
            ).error,
        ).toBeNull();
        expect(
            (
                await backend.from("course_runs").insert({
                    id: course,
                    template_id: template,
                    organisation_id: company,
                    published: true,
                    time_zone: zone,
                })
            ).error,
        ).toBeNull();
        expect(
            (
                await backend.from("course_sessions").insert({
                    id: courseSession,
                    course_run_id: course,
                    starts_at: starts.toISO(),
                    ends_at: starts.plus({hours: 1}).toISO(),
                })
            ).error,
        ).toBeNull();
        const managerApi = await actor(manager);
        const teacherApi = await actor(lecturer);
        const otherApi = await actor(colleague);
        const defaults = await managerApi.rpc("course_run_job_defaults", {
            p_course_run_id: course,
        });
        expect(defaults.error).toBeNull();
        const offer = await managerApi.rpc("create_course_run_job", {
            p_course_run_id: course,
            p_platform_percent: null,
            p_payload: {
                source_revision: defaults.data.source_revision,
                capacity: 2,
                gross_amount: 400,
                gross_total_amount: 400,
                currency: "EUR",
                rate_unit: "fixed_total",
                status: "published",
                terms: originalTerms,
                requires_contract: true,
            },
            p_client_id: randomUUID(),
        });
        expect(offer.error).toBeNull();
        async function claim(own: typeof teacherApi) {
            const quote = await own.rpc("job_detail", {p_job_id: offer.data});
            expect(quote.error).toBeNull();
            const receipt = await own.rpc("claim_job", {
                p_job_id: offer.data,
                p_idempotency_key: randomUUID(),
                p_terms_version: quote.data.terms_version,
            });
            expect(receipt.error).toBeNull();
            expect(receipt.data.status).toBe("confirmed");
            return receipt.data.claim_id as string;
        }
        const primary = await claim(teacherApi);
        const companion = await claim(otherApi);
        const originals = () =>
            backend
                .from("job_claims")
                .select(
                    "id,amount,total_amount,currency,terms,terms_version,contract_id",
                )
                .in("id", [primary, companion])
                .order("id");
        const original = await originals();
        expect(original.error).toBeNull();
        const ownAccepted = original.data?.find(({id}) => id === primary);
        expect(ownAccepted?.contract_id).toBe(contract.data?.id);
        expect(ownAccepted?.terms).toBe(originalTerms);
        // Lower the net by a known amount while preserving the original charge and unit.
        const amendedAmount = Number(ownAccepted?.total_amount) - 12.5;
        expect(amendedAmount).toBeGreaterThan(0);

        await review.goto("/changes");
        await review
            .getByRole("button", {
                name: "Änderungsantrag erstellen",
                exact: true,
            })
            .click();
        const proposal = review.getByRole("dialog");
        await proposal
            .getByLabel("Bestätigter Auftrag", {exact: true})
            .selectOption(primary);
        await expect(
            proposal.getByText(/Bedingungen und Vergütung gelten nur/),
        ).toBeVisible();
        await proposal
            .getByLabel("Begründung", {exact: true})
            .fill(
                "Fictional staffing and compensation review for both allocations.",
            );
        await proposal
            .getByLabel("Auftragsbedingungen", {exact: true})
            .fill(newTerms);
        await proposal
            .getByLabel("Vergütung pro Einheit", {exact: true})
            .fill(amendedAmount.toFixed(2));
        await proposal
            .getByLabel("Gesamte Vergütung", {exact: true})
            .fill(amendedAmount.toFixed(2));
        await proposal
            .getByLabel("Beginn 1", {exact: true})
            .fill(rescheduled.toFormat("yyyy-MM-dd'T'HH:mm"));
        await proposal
            .getByLabel("Ende 1", {exact: true})
            .fill(rescheduled.plus({hours: 1}).toFormat("yyyy-MM-dd'T'HH:mm"));
        await proposal
            .getByRole("button", {
                name: "Entwurf online speichern",
                exact: true,
            })
            .click();
        await expect(review).toHaveURL(/\/changes\/[0-9a-f-]+$/);
        const target = review.url();
        await review
            .getByRole("button", {
                name: "Zur Zustimmung einreichen",
                exact: true,
            })
            .click();
        await expect(
            review.getByRole("status").filter({hasText: "0 von 2"}),
        ).toBeVisible();
        const requests = await managerApi.rpc("assignment_changes", {
            p_id: null,
        });
        expect(requests.error).toBeNull();
        const sibling = requests.data.find(
            ({claim_id}: {claim_id: string}) => claim_id === companion,
        );
        expect(sibling).toBeDefined();
        const companionUrl = "/changes/" + sibling.id;
        const consent = async (at: Page, granted: number) => {
            await at
                .getByRole("checkbox", {name: /^Ich habe Original/})
                .check();
            await at
                .getByRole("button", {
                    name: "Dieser Änderung zustimmen",
                    exact: true,
                })
                .click();
            await expect(
                at
                    .locator(".changes-decisions")
                    .getByText("Erteilt", {exact: true}),
            ).toHaveCount(granted);
        };
        await consent(review, 1);
        await review.goto(companionUrl);
        await consent(review, 1);
        await page.goto(target);
        await expect(
            page.getByText(originalTerms, {exact: true}),
        ).toBeVisible();
        await expect(page.getByText(newTerms, {exact: true})).toBeVisible();
        await consent(page, 2);
        await review.goto(target);
        await expect(
            review.getByRole("status").filter({hasText: "1 von 2"}),
        ).toBeVisible();
        const apply = review.getByRole("button", {
            name: "Angenommene Änderung anwenden",
            exact: true,
        });
        await expect(apply).toHaveCount(0);
        await login(other, colleague);
        await other.goto(companionUrl);
        await expect(other.getByText(newTerms, {exact: true})).toHaveCount(0);
        await consent(other, 2);
        await review.reload();
        await expect(
            review.getByRole("status").filter({hasText: "2 von 2"}),
        ).toBeVisible();
        await apply.click();
        await expect(
            review
                .getByRole("status")
                .filter({hasText: "wurden gemeinsam angewendet"}),
        ).toBeVisible();
        expect((await originals()).data).toEqual(original.data);
        const moved = await backend
            .from("course_sessions")
            .select("starts_at,ends_at")
            .eq("course_run_id", course)
            .single();
        expect(moved.error).toBeNull();
        expect(Date.parse(moved.data!.starts_at)).toBe(rescheduled.toMillis());

        // Advance only the disposable schedule fixtures past the completed
        // appointment before submitting evidence or a payable invoice.
        const deliveredAt = DateTime.now()
            .setZone(zone)
            .minus({days: 2})
            .startOf("day")
            .set({hour: 10});
        const delivered = {
            starts_at: deliveredAt.toISO(),
            ends_at: deliveredAt.plus({hours: 1}).toISO(),
        };
        expect(
            (
                await backend
                    .from("course_sessions")
                    .update(delivered)
                    .eq("course_run_id", course)
            ).error,
        ).toBeNull();
        expect(
            (
                await backend
                    .from("job_sessions")
                    .update(delivered)
                    .eq("job_id", offer.data)
            ).error,
        ).toBeNull();
        const active = await backend
            .from("assignment_sessions")
            .update(delivered)
            .eq("claim_id", primary)
            .is("released_at", null)
            .select("id")
            .single();
        expect(active.error).toBeNull();
        const session = active.data!.id;
        const deliveryUrl = "/delivery?session=" + session;
        await page.goto(deliveryUrl);
        await page
            .getByLabel("Erbrachte Leistung", {exact: true})
            .selectOption("completed");
        await page
            .getByLabel("Tatsächlicher Beginn", {exact: true})
            .fill(deliveredAt.toFormat("yyyy-MM-dd'T'HH:mm"));
        await page
            .getByLabel("Tatsächliches Ende", {exact: true})
            .fill(deliveredAt.plus({hours: 1}).toFormat("yyyy-MM-dd'T'HH:mm"));
        await page
            .getByLabel("Notizen zum Unterricht", {exact: true})
            .fill("Fictional original evidence for the amended assignment.");
        await page
            .getByRole("button", {name: "Entwurf speichern", exact: true})
            .click();
        const submitEvidence = page.getByRole("button", {
            name: "Gespeicherten Nachweis einreichen",
            exact: true,
        });
        await submitEvidence.click();
        await expect(page.getByText(/^Version 1/)).toBeVisible();
        await review.goto(deliveryUrl);
        await review
            .getByLabel("Begründung für die Prüfung", {exact: true})
            .fill("Check the actual teaching duration.");
        await review
            .getByRole("button", {name: "Korrektur anfragen", exact: true})
            .click();
        await expect(
            review.getByText(
                "Der Server hat den Leistungsnachweis aktualisiert.",
                {exact: true},
            ),
        ).toBeVisible();
        await page.reload();
        await page
            .getByLabel("Tatsächliches Ende", {exact: true})
            .fill(
                deliveredAt.plus({minutes: 45}).toFormat("yyyy-MM-dd'T'HH:mm"),
            );
        await page
            .getByLabel("Begründung der Korrektur", {exact: true})
            .fill(correctReason);
        await page
            .getByRole("button", {name: "Entwurf speichern", exact: true})
            .click();
        await submitEvidence.click();
        await expect(page.getByText(/^Version 2/)).toBeVisible();
        await review.reload();
        await review
            .getByRole("button", {name: "Nachweis bestätigen", exact: true})
            .click();
        await expect(
            review.getByText(
                "Der Server hat den Leistungsnachweis aktualisiert.",
                {exact: true},
            ),
        ).toBeVisible();
        const evidence = await teacherApi.rpc("delivery_history", {
            p_session_id: session,
        });
        expect(evidence.error).toBeNull();
        const submissions = evidence.data.submissions;
        expect(
            submissions.map(({revision}: {revision: number}) => revision),
        ).toEqual([2, 1]);
        expect(Date.parse(submissions[0].actual_end)).toBe(
            deliveredAt.plus({minutes: 45}).toMillis(),
        );
        expect(Date.parse(submissions[1].actual_end)).toBe(
            deliveredAt.plus({hours: 1}).toMillis(),
        );
        expect(submissions[0].correction_reason).toBe(correctReason);
        expect(
            evidence.data.events.find(
                ({action}: {action: string}) => action === "confirmed",
            )?.submission_id,
        ).toBe(evidence.data.submissions[0].id);

        await page.goto("/finance");
        await page
            .getByRole("button", {name: "Rechnung einreichen", exact: true})
            .click();
        const form = page.getByRole("dialog");
        const invoiceNumber = `QA-AMENDMENT-${course.slice(0, 8)}`;
        await form
            .getByLabel("Rechnungsnummer", {exact: true})
            .fill(invoiceNumber);
        await form.getByRole("checkbox", {name: new RegExp(title)}).check();
        await form.getByLabel("Rechnung als PDF", {exact: true}).setInputFiles({
            name: "fictional-amended-invoice.pdf",
            mimeType: "application/pdf",
            buffer: pdf,
        });
        await expect(form.getByText(/PDF geprüft und bereit/)).toBeVisible({
            timeout: 45_000,
        });
        await form
            .getByRole("button", {name: "Rechnung einreichen", exact: true})
            .click();
        await expect(form).not.toBeVisible();
        await review.goto("/admin/finance");
        const bill = review.locator("article").filter({
            has: review.getByRole("heading", {
                name: invoiceNumber,
                exact: true,
            }),
        });
        await bill
            .getByRole("button", {name: "Rechnung prüfen", exact: true})
            .click();
        const decision = review.getByRole("dialog");
        await decision
            .getByLabel("Notiz zur Prüfung", {exact: true})
            .fill(
                "Fictional approval of the accepted amendment and corrected evidence.",
            );
        await decision
            .getByRole("button", {name: "Rechnung freigeben", exact: true})
            .click();
        await expect(decision).not.toBeVisible();
        await bill
            .getByRole("button", {name: "Zahlung eintragen", exact: true})
            .click();
        await expect(
            decision.getByLabel("Zahlungsbetrag (EUR)", {exact: true}),
        ).toHaveValue(amendedAmount.toFixed(2));
        await decision
            .getByRole("button", {name: "Zahlung speichern", exact: true})
            .click();
        await expect(
            bill.locator(".commercial-status-paid", {hasText: /^Bezahlt$/}),
        ).toBeVisible();
        const records = await teacherApi.rpc("invoice_records", {p_all: false});
        expect(records.error).toBeNull();
        const settled = records.data.find(
            ({number}: {number: string}) => number === invoiceNumber,
        );
        expect(settled).toMatchObject({
            status: "paid",
            claim_ids: [primary],
            currency: "EUR",
        });
        expect(Number(settled.total_amount)).toBe(amendedAmount);
        expect(Number(settled.paid_amount)).toBe(amendedAmount);
        const invoiceItem = await teacherApi
            .from("invoice_items")
            .select("claim_id,amendment_id")
            .eq("invoice_id", settled.id)
            .single();
        expect(invoiceItem.error).toBeNull();
        expect(invoiceItem.data).toEqual({
            claim_id: primary,
            amendment_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        });
        const unrelatedInvoice = await otherApi.rpc("invoice_records", {
            p_all: false,
        });
        expect(unrelatedInvoice.error).toBeNull();
        expect(unrelatedInvoice.data).not.toContainEqual(
            expect.objectContaining({id: settled.id}),
        );
        expect((await originals()).data).toEqual(original.data);
        const retained = await backend
            .from("contracts")
            .select("id,document_sha256,document_version_id")
            .eq("id", contract.data!.id)
            .single();
        expect(retained.error).toBeNull();
        expect(retained.data).toEqual(contract.data);
    } finally {
        await Promise.all([managerContext.close(), colleagueContext.close()]);
    }
});
