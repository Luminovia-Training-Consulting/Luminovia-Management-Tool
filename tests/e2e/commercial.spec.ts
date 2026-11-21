/**
 * Browser workflows for executed-contract evidence, original currencies and invoice/payment states.
 * Rendered workflows are checked in isolation; this does not replace manual device/platform acceptance.
 */
import {expect, type Page, test} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {createClient} from "@supabase/supabase-js";
import {randomUUID} from "node:crypto";
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
    await page.getByLabel("Benutzername oder E-Mail", {exact: true}).fill(user.email);
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
                .insert({
                    job_id: id,
                    starts_at: `2035-05-${String(day).padStart(2, "0")}T08:00:00Z`,
                    ends_at: `2035-05-${String(day).padStart(2, "0")}T10:00:00Z`,
                })
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

/** Move the exact one-session fictional offer and its accepted allocation into the past. */
async function finishAcceptedJob(job: Awaited<ReturnType<typeof acceptedJob>>, daysAgo: number) {
    const starts = Date.now() - daysAgo * 86_400_000;
    const interval = {
        starts_at: new Date(starts).toISOString(),
        ends_at: new Date(starts + 7_200_000).toISOString(),
    };
    const scheduled = await service().from("job_sessions").update(interval)
        .eq("job_id", job.id).select("id").single();
    expect(scheduled.error).toBeNull();
    const assigned = await service().from("assignment_sessions").update(interval)
        .eq("claim_id", job.claimId).select("id").single();
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
    await adminPage.goto("/contracts");
    await adminPage
        .getByRole("button", {
            name: "Ausgeführten Vertrag hinterlegen",
            exact: true,
        })
        .click();
    let dialog = adminPage.getByRole("dialog");
    const title = `Rahmenvertrag QA ${randomUUID().slice(0, 8)}`;
    await dialog
        .getByLabel("Dozent:in", {exact: true})
        .selectOption(lecturer.id);
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
        .getByLabel("Alle Dozierenden anzeigen", {exact: true})
        .check();
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
    await page.reload();
    await page.getByRole("button", {name: "Rechnung einreichen", exact: true}).click();
    const number = `=QA-${randomUUID().slice(0, 8)}`;
    await dialog.getByLabel("Rechnungsnummer", {exact: true}).fill(number);
    const issueField = dialog.getByLabel("Rechnungsdatum", {exact: true});
    const issueDate = DateTime.fromISO(await issueField.inputValue(), {
        zone: "utc",
    }).minus({days: 1});
    await issueField.fill(issueDate.toISODate()!);
    await expect(dialog.getByLabel("Fällig am", {exact: true})).toHaveValue("");
    await dialog.getByRole("checkbox", {name: new RegExp(eur.title)}).check();
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
    await adminPage.goto("/finance");
    await adminPage
        .getByLabel("Alle Dozierenden anzeigen", {exact: true})
        .check();
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
        await adminPage.goto("/finance");
        const financeCase = adminPage.locator("article.invoice-review-row")
            .filter({hasText: job.title});
        await financeCase.getByText("Abrechnung berechnen", {exact: true}).click();
        await financeCase.getByLabel("Zeitzone des Auftrags").fill("Europe/Berlin");
        await financeCase.getByLabel("Datum der Leistung").fill("2035-05-04");
        await financeCase.getByLabel("Ergebnis der Prüfung").selectOption("customer");
        await financeCase.getByLabel("Vereinbartes Honorar je Einheit (EUR)").fill("200");
        await financeCase.getByLabel("Vereinbartes Kundenhonorar für diese Einheit").fill("512.42");
        await financeCase.getByLabel("Tatsächlich erhaltene Stornozahlung für diese Einheit").fill("256.21");
        await financeCase.getByRole("button", {name: "Einheit hinzufügen", exact: true}).click();
        const holiday = financeCase.getByRole("group", {name: "Vergütungseinheit 2"});
        await holiday.getByLabel("Leistung", {exact: true}).selectOption("nonTeaching");
        await holiday.getByLabel("Datum der Leistung").fill("2035-05-05");
        await holiday.getByLabel("Ergebnis der Prüfung").selectOption("customerNonTeaching");
        await holiday.getByLabel("Vereinbartes Honorar je Einheit (EUR)").fill("200");
        await holiday.getByLabel("Vereinbartes Kundenhonorar für diese Einheit").fill("404.20");
        await holiday.getByLabel("Tatsächlich erhaltene Kundenzahlung für den unterrichtsfreien Tag").fill("101.05");
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
        await financePage.goto("/finance");
        const review = financePage.locator("article.invoice-review-row").filter({hasText: job.title});
        await review.getByRole("button", {name: "Ausnahmeabrechnung vorbereiten"}).click();
        await review.getByLabel("Prüfnotiz (mindestens 10 Zeichen)").fill("Fiktive Prüfung der ausgeführten Vertragsfassung und des Stornobetrags.");
        await review.getByLabel("Geprüfter Betrag (EUR)").fill("90,25");
        await review.getByLabel("Vereinbarte Fälligkeit").fill(DateTime.utc().plus({days: 7}).toISODate()!);
        await review.getByRole("button", {name: "Schlussrechnung zur Einreichung freigeben"}).click();
        await expect(review.getByRole("button", {name: "Freigabe verwalten"})).toBeVisible();

        await page.reload();
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

        await page.reload();
        await expect(lecturerCase.getByText("Prüfung angefordert", {exact: true})).toBeVisible();
        await expect(ready).toHaveCount(0);
    } finally {
        await financeContext.close();
    }
});
