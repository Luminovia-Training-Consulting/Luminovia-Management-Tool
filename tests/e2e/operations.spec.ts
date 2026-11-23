/**
 * Browser workflows for the company directory, course templates and safe unpublished copies.
 * Rendered workflows are checked in isolation; this does not replace manual device/platform acceptance.
 */
import {expect, type Page, test} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {assertPointerReady} from "./helpers/pointer-readiness";
import {actor, assertPasswordOnly} from "./helpers/accounts-support";
import {createClient} from "@supabase/supabase-js";
import {randomUUID} from "node:crypto";
import {DateTime} from "luxon";

test.skip(
    process.env.PORTAL_TEST_MODE !== "1",
    "Operations workflows run only through the isolated ./portal test command.",
);

/** Creates the local fixture client within this module's explicit test-target boundaries. */
function api(key: string) {
    const url = process.env.SUPABASE_URL!;
    if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname))
        throw new Error("Operations tests require loopback fixtures.");
    return createClient(url, key, {
        auth: {persistSession: false, autoRefreshToken: false},
    });
}

/** Signs this test actor in through the visible form and waits for confirmed navigation. */
async function login(page: Page, email: string) {
    await page.goto("/login");
    await page.getByLabel("E-Mail", {exact: true}).fill(email);
    await page
        .getByLabel("Passwort", {exact: true})
        .fill(process.env.E2E_PASSWORD!);
    await page.getByRole("button", {name: "Anmelden", exact: true}).click();
    await expect(page).toHaveURL(/\/$/);
}

/** Checks the rendered state with axe; this does not replace manual accessibility acceptance. */
async function a11y(page: Page) {
    await page.evaluate(() => document.fonts.ready);
    const scan = await new AxeBuilder({page})
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
    expect(
        scan.violations.map((item) => ({
            id: item.id,
            nodes: item.nodes.map((node) => ({
                target: node.target,
                summary: node.failureSummary,
            })),
        })),
    ).toEqual([]);
}

test("readonly course overview is accessible and private client directory is denied", async ({
                                                                                                      page,
                                                                                                  }, testInfo) => {
    const lecturer = await actor("Fictional operations catalogue lecturer", "lecturer");
    await login(page, lecturer.email);
    await page.goto("/courses");
    await expect(
        page.getByRole("heading", {name: "Kurse", exact: true}),
    ).toBeVisible();
    await a11y(page);
    expect(
        await page.evaluate(
            () =>
                document.documentElement.scrollWidth <=
                document.documentElement.clientWidth,
        ),
    ).toBe(true);
    await page.screenshot({
        path: `.local/screenshots/${testInfo.project.name}-courses.png`,
        fullPage: true,
    });
    await page.goto("/clients");
    await expect(page.getByRole("alert")).toContainText(
        "Für diesen Bereich fehlt dir die Berechtigung.",
    );
});
test("admin persists private customer/contact, course template/run and safe unpublished copy through real UI", async ({
                                                                                                                          page,
                                                                                                                      }, testInfo) => {
    test.setTimeout(100000);
    const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const email = `operations-ui-${randomUUID()}@example.invalid`;
    const created = await service.auth.admin.createUser({
        email,
        password: process.env.E2E_PASSWORD!,
        email_confirm: true,
    });
    expect(created.error).toBeNull();
    const role = await service
        .from("user_roles")
        .insert({user_id: created.data.user!.id, role: "admin"});
    expect(role.error).toBeNull();
    const client = api(process.env.SUPABASE_ANON_KEY!);
    expect(
        (
            await client.auth.signInWithPassword({
                email,
                password: process.env.E2E_PASSWORD!,
            })
        ).error,
    ).toBeNull();
    await assertPasswordOnly(client);
    await login(page, email);
    const suffix = randomUUID().slice(0, 8);
    const company = `Fiktive Akademie ${suffix}`;
    const title = `Linux Kurs ${suffix}`;
    const note = `Private contact note ${suffix}`;
    await page.goto("/clients");
    await page
        .getByRole("button", {name: "Organisation anlegen", exact: true})
        .click();
    let dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name", {exact: true}).fill(company);
    await dialog.getByLabel("Land", {exact: true}).fill("DE");
    await dialog.getByLabel("Ort", {exact: true}).fill("Fiktivstadt");
    await dialog.getByLabel("Branche", {exact: true}).fill("Training");
    await dialog.getByLabel("Interne Notizen", {exact: true}).fill(note);
    await dialog.getByRole("button", {name: "Speichern", exact: true}).click();
    await expect(dialog).toBeHidden();
    await expect(
        page.getByRole("heading", {name: company, exact: true}),
    ).toBeVisible();
    await page
        .getByRole("button", {name: "Kontakt hinzufügen", exact: true})
        .click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name", {exact: true}).fill("Fiktive Kursplanung");
    await dialog
        .getByLabel("Geschäftliche E-Mail", {exact: true})
        .fill("contact@example.invalid");
    await dialog.getByLabel("Telefon", {exact: true}).fill("+490000000");
    await dialog.getByLabel("Kontaktnotizen", {exact: true}).fill(note);
    await dialog.getByRole("button", {name: "Speichern", exact: true}).click();
    await expect(dialog).toBeHidden();
    await page.reload();
    // Selection is view state; reselect the saved organisation after the document
    // reload before asserting that its private data was persisted by the server.
    await page.getByRole("button", {name: company, exact: true}).click();
    await expect(page.getByText(note, {exact: true}).first()).toBeVisible();
    await expect(
        page.getByRole("heading", {name: "Fiktive Kursplanung", exact: true}),
    ).toBeVisible();
    await a11y(page);
    await page.screenshot({
        path: `.local/screenshots/${testInfo.project.name}-clients.png`,
        fullPage: true,
    });
    await page.goto("/courses");
    await page
        .getByRole("button", {name: "Kurs anlegen", exact: true})
        .click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("Titel", {exact: true}).fill(title);
    await dialog
        .getByLabel("Beschreibung", {exact: true})
        .fill("Fiktiver Kurs für die tatsächliche Browserprüfung.");
    await dialog
        .getByLabel("Lehrplan", {exact: true})
        .fill("Shell, Rechte und Prozesse. <script>alert(1)</script>");
    await dialog
        .getByLabel("Voraussetzungen", {exact: true})
        .fill("Linux Grundlagen");
    await dialog.getByRole("checkbox", {name: "Linux", exact: true}).check();
    await dialog.getByRole("button", {name: "Als Vorlage speichern", exact: true}).click();
    await expect(dialog).toBeHidden();
    await page.getByRole("button", {name: "Durchführungen", exact: true}).click();
    await page
        .getByRole("button", {name: "Kurs anlegen", exact: true})
        .click();
    dialog = page.getByRole("dialog");
    await dialog
        .getByLabel("Kursvorlage", {exact: true})
        .selectOption({label: title});
    await dialog
        .getByLabel("Organisation", {exact: true})
        .selectOption({label: company});
    await dialog
        .getByLabel("Ort / Zugangslink", {exact: true})
        .fill("Fiktiver Schulungsraum");
    const first = DateTime.now()
        .setZone("Europe/Berlin")
        .plus({days: 100})
        .set({hour: 9, minute: 0, second: 0});
    await dialog
        .getByLabel("Beginn 1", {exact: true})
        .fill(first.toFormat("yyyy-MM-dd'T'HH:mm"));
    await dialog
        .getByLabel("Ende 1", {exact: true})
        .fill(first.plus({hours: 5}).toFormat("yyyy-MM-dd'T'HH:mm"));
    await dialog
        .getByRole("button", {name: "Termin ergänzen", exact: true})
        .click();
    await dialog
        .getByLabel("Beginn 2", {exact: true})
        .fill(first.plus({days: 1}).toFormat("yyyy-MM-dd'T'HH:mm"));
    await dialog
        .getByLabel("Ende 2", {exact: true})
        .fill(first.plus({days: 1, hours: 5}).toFormat("yyyy-MM-dd'T'HH:mm"));
    await dialog.getByRole("button", {name: "Entwurf speichern", exact: true}).click();
    await expect(dialog).toBeHidden();
    await page.getByLabel("Suchen", {exact: true}).fill(title);
    let card = page
        .locator(".operations-course")
        .filter({has: page.getByRole("heading", {name: title, exact: true})});
    await expect(card).toHaveCount(1);
    const viewAction = card.getByRole("button", {name: "Ansehen", exact: true});
    await assertPointerReady(viewAction, "saved course view");
    await viewAction.click();
    dialog = page.getByRole("dialog");
    await expect(
        dialog.getByText("Shell, Rechte und Prozesse. <script>alert(1)</script>", {
            exact: true,
        }),
    ).toBeVisible();
    expect(await dialog.locator("script").count()).toBe(0);
    await expect(dialog.locator(".session-list li")).toHaveCount(2);
    await dialog.getByRole("button", {name: "Schließen", exact: true}).click();
    await card
        .getByRole("button", {name: "Sicher kopieren", exact: true})
        .click();
    dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(
        "keine Aufträge, Verträge, persönlichen Daten",
    );
    await dialog
        .getByRole("button", {name: "Sicher kopieren", exact: true})
        .click();
    await expect(dialog).toBeHidden();
    await expect(card).toHaveCount(2);
    await page.reload();
    await page.getByLabel("Suchen", {exact: true}).fill(title);
    card = page
        .locator(".operations-course")
        .filter({has: page.getByRole("heading", {name: title, exact: true})});
    await expect(card).toHaveCount(2);
    await expect(card.filter({hasText: "Entwurf"})).toHaveCount(2);
    await a11y(page);
});
test("course editor publishes and withdraws the linked marketplace offer", async ({page}) => {
    const admin = await actor("Fictional marketplace course admin", "admin");
    const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const [organisation, template, run, courseSlot, job] = Array.from({length: 5}, randomUUID);
    const title = "Fictional marketplace course " + run.slice(0, 8);
    const starts = DateTime.utc().plus({days: 120});
    const dates = {starts_at: starts.toISO(), ends_at: starts.plus({hours: 2}).toISO()};
    const write = async (table: string, row: object) => {
        const {error} = await service.from(table).insert(row);
        expect(error?.message).toBeUndefined();
    };
    await write("organisations", {id: organisation, name: "Fictional marketplace company"});
    await write("course_templates", {id: template, title});
    await write("course_runs", {id: run, template_id: template, organisation_id: organisation});
    await write("course_sessions", {id: courseSlot, course_run_id: run, ...dates});
    await write("jobs", {
        id: job, course_run_id: run, title, customer_name: "Fictional marketplace company",
        delivery_type: "online", status: "draft", currency: "EUR", amount: 100,
        total_amount: 100, rate_unit: "fixed_total", terms: "Fictional offer terms",
    });
    await write("job_sessions", {job_id: job, course_session_id: courseSlot, ...dates});

    await login(page, admin.email);
    const openEditor = async (status: string) => {
        await page.goto("/courses");
        await page.getByLabel("Suchen", {exact: true}).fill(title);
        const card = page.locator(".operations-course").filter({
            has: page.getByRole("heading", {name: title, exact: true}),
        });
        await expect(card.getByText(status, {exact: true})).toBeVisible();
        await card.getByRole("button", {name: "Bearbeiten", exact: true}).click();
        return page.getByRole("dialog", {name: "Bearbeiten"});
    };
    let editor = await openEditor("Entwurf");
    await editor.getByRole("button", {name: "In der Stellenbörse veröffentlichen"}).click();
    await expect(editor).toBeHidden();
    expect((await service.from("jobs").select("status").eq("id", job).single()).data?.status).toBe("published");
    editor = await openEditor("Veröffentlicht");
    await editor.getByRole("button", {name: "Veröffentlichung zurücknehmen"}).click();
    await expect(editor).toBeHidden();
    expect((await service.from("jobs").select("status").eq("id", job).single()).data?.status).toBe("draft");
});
