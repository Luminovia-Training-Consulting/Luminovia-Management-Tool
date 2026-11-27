/**
 * Browser workflows for client requests, immutable fee shares and lecturer-visible net invoicing.
 * Rendered workflows are checked in isolation; this does not replace manual device/platform acceptance.
 */
import {expect, type Page, test} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {createClient} from "@supabase/supabase-js";
import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {checked} from "./helpers/accounts-support";

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
    role: "lecturer" | "admin" | "client",
    label: string,
): Promise<Account> {
    const tag = randomUUID().slice(0, 8);
    const email = `commission-${label}-${tag}@example.invalid`;
    const name = `Commission QA ${label} ${tag}`;
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

/** Signs the test actor into a real Auth session for preparatory business API calls. */
async function signedIn(user: Account) {
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

test("client full-fee request becomes a net-only lecturer assignment with immutable split and labelled net invoice", async ({
                                                                                                                                page,
                                                                                                                                browser,
                                                                                                                            }, testInfo) => {
    test.setTimeout(300000);
    const customer = await account("client", "Customer");
    const outsider = await account("client", "OtherCustomer");
    const lecturer = await account("lecturer", "Teacher");
    const owner = await account("admin", "Owner");
    const ownerApi = await signedIn(owner);
    expect(
        (
            await ownerApi.rpc("save_lecturer_compensation", {
                p_user_id: lecturer.id,
                p_mode: "percent",
                p_percent: 31,
                p_daily_rate: 200,
                p_currency: "EUR",
                p_expected_version: 1,
            })
        ).error,
    ).toBeNull();
    const policy = await ownerApi.rpc("commission_access");
    expect(policy.error).toBeNull();
    expect(policy.data?.policy_version).toEqual(expect.any(Number));
    expect(
        (
            await ownerApi.rpc("configure_compensation_policy", {
                p_regular_percent: 32,
                p_senior_percent: 74,
                p_expected_version: policy.data.policy_version,
            })
        ).error,
    ).toBeNull();
    const orgName = `Client QA ${randomUUID().slice(0, 8)}`;
    const org = await service()
        .from("organisations")
        .insert({name: orgName, time_zone: "Europe/Berlin"})
        .select("id")
        .single();
    expect(org.error).toBeNull();
    expect(
        (
            await service()
                .from("client_organisation_memberships")
                .insert({user_id: customer.id, organisation_id: org.data!.id})
        ).error,
    ).toBeNull();
    const options = {
        baseURL: process.env.E2E_BASE_URL,
        viewport: testInfo.project.use.viewport,
        isMobile: testInfo.project.use.isMobile,
        hasTouch: testInfo.project.use.hasTouch,
    };
    const ownerContext = await browser.newContext(options);
    const teacherContext = await browser.newContext(options);
    try {
        const ownerPage = await ownerContext.newPage();
        const teacherPage = await teacherContext.newPage();
        await login(ownerPage, owner);
        await login(page, customer);
        await page.goto("/client");
        await page
            .getByRole("button", {name: "Kurs anfragen", exact: true})
            .click();
        let dialog = page.getByRole("dialog");
        const title = `Net commission ${randomUUID().slice(0, 8)}`;
        await dialog.getByLabel("Titel", {exact: true}).fill(title);
        await dialog
            .getByLabel("Beschreibung", {exact: true})
            .fill("Fictional private client request for software teaching.");
        await dialog
            .getByLabel("Voller Auftragspreis je Einheit", {exact: true})
            .fill("1000");
        await dialog
            .getByLabel("Voller Auftragspreis gesamt", {exact: true})
            .fill("1000");
        await dialog
            .getByLabel("Beginn 1", {exact: true})
            .fill("2037-05-04T09:00");
        await dialog.getByLabel("Ende 1", {exact: true}).fill("2037-05-04T15:00");
        await dialog
            .getByRole("button", {
                name: "Anfrage verbindlich speichern",
                exact: true,
            })
            .click();
        await expect(dialog).not.toBeVisible();
        const request = page
            .locator("article")
            .filter({has: page.getByRole("heading", {name: title, exact: true})});
        await expect(
            request.getByText("Eingereicht", {exact: true}),
        ).toBeVisible();
        await expect(request.locator(".commercial-facts dd strong")).toContainText(
            "1.000,00",
        );
        await a11y(page);
        const customerApi = await signedIn(customer);
        const otherApi = await signedIn(outsider);
        const privateRows = await otherApi.rpc("client_requests", {
            p_organisation_id: org.data!.id,
        });
        expect(privateRows.error).toBeNull();
        expect(privateRows.data).toEqual([]);
        await ownerPage.goto("/client");
        const ownerRequest = ownerPage.locator("article").filter({
            has: ownerPage.getByRole("heading", {name: title, exact: true}),
        });
        await ownerRequest
            .getByRole("button", {
                name: "Als Lehrauftrag veröffentlichen",
                exact: true,
            })
            .click();
        dialog = ownerPage.getByRole("dialog");
        await expect(
            dialog.getByRole("heading", {
                name: /Dozent:in – Standardanteil \(32\s*%\)/,
            }),
        ).toBeVisible();
        await expect(
            dialog.getByRole("heading", {
                name: /Senior-Dozent:in – Standardanteil \(74\s*%\)/,
            }),
        ).toBeVisible();
        await dialog
            .getByLabel("Konditionen", {exact: true})
            .fill("Fictional lecturer assignment terms.");
        await dialog
            .getByLabel("Gültiger Rahmenvertrag erforderlich", {exact: true})
            .uncheck();
        await dialog
            .getByRole("button", {
                name: "Als Lehrauftrag veröffentlichen",
                exact: true,
            })
            .click();
        await expect(dialog).not.toBeVisible();
        const published = await customerApi.rpc("client_requests", {
            p_organisation_id: org.data!.id,
        });
        expect(published.error).toBeNull();
        const linked = published.data.find(
            (row: { title: string }) => row.title === title,
        );
        expect(linked.job_id).toBeTruthy();
        expect(JSON.stringify(linked)).not.toMatch(
            /lecturer_net|platform_percent|platform_total/,
        );
        await login(teacherPage, lecturer);
        await teacherPage.goto(`/jobs/${linked.job_id}`);
        await expect(teacherPage.locator(".claim-panel .amount")).toContainText(
            "310,00",
        );
        await expect(
            teacherPage.getByText("1.000,00 €", {exact: true}),
        ).toHaveCount(0);
        await expect(
            teacherPage.getByText("Plattformanteil (%)", {exact: true}),
        ).toHaveCount(0);
        const teacherApi = await signedIn(lecturer);
        const concealedJob = await teacherApi
            .from("jobs")
            .select("id")
            .eq("id", linked.job_id)
            .maybeSingle();
        expect(concealedJob.error).toBeNull();
        expect(concealedJob.data).toBeNull();
        const ownQuotes = await teacherApi.rpc("job_offers");
        expect(ownQuotes.error).toBeNull();
        expect(
            Number(
                ownQuotes.data.find((row: { id: string }) => row.id === linked.job_id)
                    .total_amount,
            ),
        ).toBe(310);
        expect(JSON.stringify(ownQuotes.data)).not.toMatch(
            /gross_amount|platform_percent|platform_total/,
        );
        expect(
            (await teacherApi.rpc("commission_report", {p_organisation_id: null}))
                .error,
        ).toBeTruthy();
        await teacherPage.getByLabel(/Konditionen akzeptieren/).check();
        await teacherPage
            .getByRole("button", {name: "Auftrag übernehmen", exact: true})
            .click();
        await expect(teacherPage.getByRole("status").filter({
            hasText: /^Dein Auftrag ist bestätigt\. Alle Termine sind reserviert\.$/,
        })).toBeVisible();
        // Backdate only the fictional isolated schedule, then re-read the
        // course screen so the real final-session gate recalculates eligibility.
        const acceptedClaim = await checked(
            service()
                .from("job_claims")
                .select("id")
                .eq("job_id", linked.job_id)
                .eq("lecturer_id", lecturer.id)
                .eq("status", "confirmed")
                .single(),
            {requireData: true},
        );
        const scheduled = await checked(
            service()
                .from("job_sessions")
                .select("id,starts_at,ends_at")
                .eq("job_id", linked.job_id)
                .order("starts_at"),
            {requireData: true},
        );
        expect(scheduled.length).toBeGreaterThan(0);
        const latestEnd = Math.max(
                ...scheduled.map((session) => Date.parse(session.ends_at)),
            ),
            shift = Date.now() - 86400000 - latestEnd;
        for (const session of scheduled) {
            await checked(
                service()
                    .from("job_sessions")
                    .update({
                        starts_at: new Date(Date.parse(session.starts_at) + shift).toISOString(),
                        ends_at: new Date(Date.parse(session.ends_at) + shift).toISOString(),
                    })
                    .eq("id", session.id),
            );
        }
        const assignedSessions = await checked(
            service()
                .from("assignment_sessions")
                .select("id,starts_at,ends_at")
                .eq("claim_id", acceptedClaim.id),
            {requireData: true},
        );
        expect(assignedSessions.length).toBe(scheduled.length);
        for (const session of assignedSessions) {
            await checked(
                service()
                    .from("assignment_sessions")
                    .update({
                        starts_at: new Date(Date.parse(session.starts_at) + shift).toISOString(),
                        ends_at: new Date(Date.parse(session.ends_at) + shift).toISOString(),
                    })
                    .eq("id", session.id),
            );
        }
        await teacherPage.reload();
        await teacherPage
            .getByRole("link", {name: "Rechnung einreichen", exact: true})
            .click();
        await expect(teacherPage).toHaveURL(/\/finance\?claim=/);
        const linkedInvoice = teacherPage.getByRole("dialog", {
            name: "Rechnung einreichen",
            exact: true,
        });
        await expect(
            linkedInvoice.getByRole("checkbox", {name: new RegExp(title)}),
        ).toBeChecked();
        await teacherPage.goBack();
        await expect(teacherPage).toHaveURL(new RegExp(`/jobs/${linked.job_id}$`));
        await page.reload();
        await expect(
            request.getByText(`Zugewiesene Lehrkraft: ${lecturer.name}`, {
                exact: true,
            }),
        ).toBeVisible();
        await expect(
            request.getByText("Lehrkraft zugeteilt", {exact: true}),
        ).toBeVisible();
        await page.screenshot({
            path: `.local/screenshots/${testInfo.project.name}-client-portal.png`,
            fullPage: true,
        });
        await ownerPage.goto(`/jobs/${linked.job_id}`);
        await expect(
            ownerPage.getByText(
                "Die angenommene Preisaufteilung ist unveränderlich.",
                {exact: true},
            ),
        ).toBeVisible();
        await expect(
            ownerPage.getByRole("button", {
                name: "Preisaufteilung bearbeiten",
                exact: true,
            }),
        ).toHaveCount(0);
        await teacherPage.goto("/finance");
        await teacherPage
            .getByRole("button", {name: "Rechnung einreichen", exact: true})
            .click();
        dialog = teacherPage.getByRole("dialog");
        const number = `NET-${randomUUID().slice(0, 8)}`;
        await dialog.getByLabel("Rechnungsnummer", {exact: true}).fill(number);
        await dialog.getByRole("checkbox", {name: new RegExp(title)}).check();
        await dialog.getByLabel("Rechnung als PDF", {exact: true}).setInputFiles({
            name: "net-compensation.pdf",
            mimeType: "application/pdf",
            buffer: fictionalPdf(),
        });
        await expect(dialog.getByText(/PDF geprüft und bereit/)).toBeVisible({
            timeout: 45000,
        });
        await dialog
            .getByRole("button", {name: "Rechnung einreichen", exact: true})
            .click();
        await expect(dialog).not.toBeVisible();
        const invoice = teacherPage.locator("article").filter({
            has: teacherPage.getByRole("heading", {name: number, exact: true}),
        });
        await invoice
            .getByRole("button", {name: "Rechnungslabels bearbeiten", exact: true})
            .click();
        await teacherPage
            .getByRole("dialog")
            .getByLabel("Rechnungslabels", {exact: true})
            .fill("QA, Commission, =Review");
        await teacherPage
            .getByRole("dialog")
            .getByRole("button", {name: "Speichern", exact: true})
            .click();
        await expect(teacherPage.getByRole("dialog")).not.toBeVisible();
        await expect(
            invoice.getByText("Commission", {exact: true}),
        ).toBeVisible();
        await teacherPage
            .getByLabel("Rechnungslabels", {exact: true})
            .selectOption("Commission");
        await teacherPage
            .getByLabel("Rechnungen durchsuchen", {exact: true})
            .fill(number);
        await expect(invoice).toBeVisible();
        const invoiceRows = await teacherApi.rpc("invoice_records", {
            p_all: false,
        });
        expect(invoiceRows.error).toBeNull();
        const record = invoiceRows.data.find(
            (row: { number: string }) => row.number === number,
        );
        expect(Number(record.total_amount)).toBe(310);
        expect(record.labels).toEqual(["=Review", "Commission", "QA"]);
        const csvEvent = teacherPage.waitForEvent("download");
        await teacherPage
            .getByRole("button", {name: "Rechnungen als CSV", exact: true})
            .click();
        const csv = await csvEvent;
        expect((await readFile((await csv.path())!)).toString()).toContain(
            '"\'=Review | Commission | QA"',
        );
        await a11y(teacherPage);
        await teacherPage.screenshot({
            path: `.local/screenshots/${testInfo.project.name}-lecturer-net-invoice.png`,
            fullPage: true,
        });
        await ownerPage.goto("/admin/finance");
        // Follow the same invoice when payment changes its position in the list.
        await ownerPage.getByRole("searchbox", {name: "Rechnungen durchsuchen", exact: true}).fill(number);
        const ownerInvoice = ownerPage.locator("article").filter({
            has: ownerPage.getByRole("heading", {name: number, exact: true}),
        });
        await ownerInvoice
            .getByRole("button", {name: "Rechnung prüfen", exact: true})
            .click();
        await ownerPage
            .getByRole("dialog")
            .getByRole("button", {name: "Rechnung freigeben", exact: true})
            .click();
        await expect(ownerPage.getByRole("dialog")).not.toBeVisible();
        await ownerInvoice
            .getByRole("button", {name: "Zahlung eintragen", exact: true})
            .click();
        await expect(
            ownerPage
                .getByRole("dialog")
                .getByLabel("Zahlungsbetrag (EUR)", {exact: true}),
        ).toHaveValue("310.00");
        await ownerPage
            .getByRole("dialog")
            .getByRole("button", {name: "Zahlung speichern", exact: true})
            .click();
        await expect(ownerPage.getByRole("dialog")).not.toBeVisible();
        await expect(
            ownerInvoice.locator(".commercial-status-paid", {hasText: /^Bezahlt$/}),
        ).toBeVisible();
        await a11y(ownerPage);
        await ownerPage.screenshot({
            path: `.local/screenshots/${testInfo.project.name}-platform-revenue.png`,
            fullPage: true,
        });
    } finally {
        await teacherContext.close();
        await ownerContext.close();
    }
});
