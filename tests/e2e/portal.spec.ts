/**
 * Browser workflows for sign-in, profiles, whole-block claims and immediate permission checks.
 * Rendered workflows are checked in isolation; this does not replace manual device/platform acceptance.
 */
import {expect, type Page, test} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {createClient} from "@supabase/supabase-js";
import {randomUUID} from "node:crypto";
import {actor, api, assertPasswordOnly, checked, signOut} from "./helpers/accounts-support";

const configured = Boolean(
    process.env.SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_ROLE_KEY &&
    process.env.E2E_PASSWORD,
);
test.skip(
    !configured,
    "Real local Supabase fixtures required. Run scripts/local-start.sh and scripts/local-seed.mjs.",
);

/** Creates a local SDK test client with its own nonpersistent Auth session. */
function localClient(key: string) {
    const url = process.env.SUPABASE_URL!;
    if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname))
        throw new Error("E2E mutation fixtures only permit loopback Supabase.");
    return createClient(url, key, {
        auth: {persistSession: false, autoRefreshToken: false},
    });
}

/** Creates the administrative fixture client; its key stays outside the browser application. */
const service = () => localClient(process.env.SUPABASE_SERVICE_ROLE_KEY!);

/** Signs the fictional identity into a real session for API checks outside the browser. */
async function signInApi(email: string) {
    const client = localClient(process.env.SUPABASE_ANON_KEY!);
    const {data, error} = await client.auth.signInWithPassword({
        email,
        password: process.env.E2E_PASSWORD!,
    });
    expect(error, "Real Supabase Auth sign-in succeeds").toBeNull();
    expect(data.user).toBeTruthy();
    return {client, user: data.user!};
}

/** Signs this test actor in through the visible form and waits for confirmed navigation. */
async function login(page: Page, email = process.env.E2E_LECTURER_EMAIL!) {
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
    await page.evaluate(async () => {
        // Theme changes animate briefly. Inspect the settled screen, excluding infinite spinners.
        void getComputedStyle(document.documentElement).color;
        await Promise.all(
            document
                .getAnimations()
                .filter(
                    (animation) => animation.effect?.getTiming().iterations !== Infinity,
                )
                .map((animation) => animation.finished.catch(() => undefined)),
        );
    });
    const scan = await new AxeBuilder({page})
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
    const violations = scan.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        nodes: violation.nodes.map((node) => ({
            target: node.target,
            failure: node.failureSummary,
        })),
    }));
    expect(violations).toEqual([]);
}

test("administration navigation keeps shared workflows together on desktop and mobile", async ({page}, testInfo) => {
    await login(page, process.env.E2E_ADMIN_EMAIL!);
    await page.goto("/admin");
    await expect(page.getByRole("heading", {name: "Verwaltung", exact: true})).toBeVisible();
    const mobile = testInfo.project.name.includes("mobile");
    const more = page.getByLabel("Mehr", {exact: true});
    if (mobile) await more.click();
    const mainMenu = mobile ? page.locator(".mobile-more") : page.locator(".sidebar");
    await expect(mainMenu.getByRole("link", {name: "Verwaltung", exact: true})).toBeVisible();
    await expect(mainMenu.getByRole("link", {name: "Chat", exact: true})).toBeVisible();
    for (const name of ["Verträge", "Leitstand", "Themen & Tools", "Dozierende"])
        await expect(mainMenu.getByRole("link", {name, exact: true})).toHaveCount(0);
    if (mobile) await more.click();
    await page.locator(".account-menu summary").click();
    const personalContracts = page.locator(".account-menu").getByRole("link", {name: "Meine Verträge", exact: true});
    await expect(personalContracts).toHaveAttribute("href", "/profile/contracts");
    await personalContracts.click();
    await expect(page).toHaveURL(/\/profile\/contracts$/);
    await expect(page.getByRole("heading", {name: "Verträge", exact: true})).toBeVisible();
    await page.goto("/admin");

    const sections = page.getByRole("navigation", {name: "Verwaltung", exact: true});
    const administrationContent = page.locator("main");
    await expect(sections.getByRole("link", {name: /^Plattformfinanzen(?: |$)/})).toBeVisible();
    await sections.getByRole("link", {name: /^Unternehmen & Personen(?: |$)/}).click();
    await expect(page.getByRole("link", {name: /^Unternehmen(?! & Personen)/})).toBeVisible();
    const staffContracts = administrationContent.getByRole("link", {name: /^Verträge(?: |$)/});
    await expect(staffContracts).toHaveAttribute("href", "/admin/contracts");
    await staffContracts.click();
    await expect(page).toHaveURL(/\/admin\/contracts$/);
    await expect(page.getByRole("button", {name: "Ausgeführten Vertrag hinterlegen", exact: true})).toBeVisible();
    await sections.getByRole("link", {name: /^Unternehmen & Personen(?: |$)/}).click();
    await page.getByRole("link", {name: /^Dozierende(?: |$)/}).click();
    await expect(page).toHaveURL(/\/people$/);
    await expect(page.getByRole("heading", {name: "Dozierende", exact: true})).toBeVisible();
    await expect(sections.getByRole("link", {name: /^Unternehmen & Personen(?: |$)/})).toHaveAttribute("aria-current", "location");

    await sections.getByRole("link", {name: /^Kursbetrieb(?: |$)/}).click();
    await expect(page.getByRole("link", {name: /^Leitstand(?: |$)/})).toHaveAttribute("href", "/control-center");
    await expect(page.getByRole("link", {name: /^Themen & Tools(?: |$)/})).toHaveAttribute("href", "/topics");
    await expect(administrationContent.getByRole("link", {name: /^Verträge(?: |$)/})).toHaveCount(0);
    await page.getByRole("link", {name: /^Leitstand(?: |$)/}).click();
    const dates = page.locator(".finance-period");
    const until = dates.locator('input[type="date"]').last();
    const show = dates.getByRole("button", {name: "Zeitraum anzeigen", exact: true});
    await expect(show).toBeVisible();
    if (!mobile) {
        const fieldBox = (await until.boundingBox())!;
        const buttonBox = (await show.boundingBox())!;
        expect(Math.abs(fieldBox.y + fieldBox.height - buttonBox.y - buttonBox.height)).toBeLessThan(2);
    }
    await show.click();
    await sections.getByRole("link", {name: /^Kursbetrieb(?: |$)/}).click();
    await page.getByRole("link", {name: /^Auftragsänderungen(?: |$)/}).click();
    await expect(page).toHaveURL(/\/changes$/);
});

test("section cards remain visible and file search clears its icon on desktop and mobile", async ({page}) => {
    await login(page, process.env.E2E_ADMIN_EMAIL!);
    await page.goto("/chats");
    const forum = page.getByRole("link", {name: /^Forum(?: |$)/});
    await expect(forum).toBeVisible();
    await expect(forum).toHaveAccessibleName(/diskutiere/i);
    await forum.click();
    await expect(forum).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("button", {name: /^Diskussionen(?: |$)/})).toBeVisible();

    await page.goto("/courses");
    const courseSections = page.getByRole("navigation", {name: "Kursbereiche"});
    await expect(courseSections.getByRole("button", {name: /^Kursbereitschaft(?: |$)/})).toHaveAccessibleName(/Kursstart/);
    await courseSections.getByRole("button", {name: /^Durchführung(?: |$)/}).click();
    await expect(courseSections.getByRole("button", {name: /^Durchführung(?: |$)/})).toHaveAttribute("aria-current", "page");

    await page.goto("/assistance");
    await expect(page.getByRole("button", {name: /^Support(?: |$)/})).toHaveAccessibleName(/Tickets/);
    await expect(page.getByRole("button", {name: /^Probleme lösen(?: |$)/})).toHaveAccessibleName(/Schritt/);
    await page.getByRole("link", {name: /^API-Dokumentation(?: |$)/}).click();
    await expect(page.getByRole("link", {name: /^API-Dokumentation(?: |$)/})).toHaveAttribute("aria-current", "page");
    await page.getByRole("link", {name: /^Swagger UI(?: |$)/}).click();
    await expect(page.getByRole("link", {name: /^Swagger UI(?: |$)/})).toHaveAttribute("aria-current", "page");

    await page.goto("/files");
    const search = page.getByRole("searchbox", {name: "Dateien suchen"});
    await expect(search).toBeVisible();
    expect(await search.evaluate((input) => {
        const base = input.getBoundingClientRect();
        const icon = input.parentElement!.querySelector("svg")!.getBoundingClientRect();
        return base.left + Number.parseFloat(getComputedStyle(input).paddingLeft) > icon.right;
    })).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        await page.evaluate(() => document.documentElement.clientWidth + 1),
    );
});

test("staff analytics filters and forecast charts work across viewport sizes", async ({page}) => {
    await login(page, process.env.E2E_ADMIN_EMAIL!);
    await page.goto("/admin/finance/analytics");
    await expect(page.getByRole("heading", {name: "Analysen", exact: true})).toBeVisible();
    await page.getByLabel("Zeitraum", {exact: true}).selectOption("previousQuarter");
    const timeline = page.locator("section").filter({has: page.getByRole("heading", {name: "Bestätigte Aufträge", exact: true})});
    await timeline.getByLabel("Zeige im Auftragsdiagramm").selectOption("past");
    await expect(timeline.locator(".analytics-key").getByText("Vergangen", {exact: true})).toBeVisible();
    await expect(timeline.locator(".analytics-key").getByText("Bevorstehend", {exact: true})).toHaveCount(0);
    const financial = page.locator("section").filter({has: page.getByRole("heading", {name: "Finanzverlauf", exact: true})});
    await financial.getByLabel("Darstellung").selectOption("cumulative");
    await expect(financial.getByText("Kumulierte Werte als Tabelle")).toBeVisible();
    const forecast = page.locator("section").filter({has: page.getByRole("heading", {name: "Vorschau für offene Aufträge", exact: true})});
    await forecast.getByLabel("Vorschauzeitraum").selectOption("30");
    await expect(forecast.getByRole("heading", {name: "Erwarteter Umsatz", exact: true})).toBeVisible();
    await expect(forecast.getByRole("heading", {name: "Dozentenkosten im Monatsverlauf", exact: true})).toBeVisible();
    const revenue = forecast.getByRole("heading", {name: "Erwarteter Umsatz", exact: true}).locator("..");
    await expect(revenue.getByText("Monatswerte als Tabelle")).toBeVisible();
    await expect(revenue.locator("canvas")).toBeVisible();
    await expect(page.getByRole("heading", {name: "Erfasste Zahlungen im Monatsverlauf"})).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        await page.evaluate(() => document.documentElement.clientWidth + 1),
    );
    await page.getByRole("button", {name: "Filter zurücksetzen", exact: true}).click();
    await expect(page.getByLabel("Zeitraum", {exact: true})).toHaveValue("around");
    await page.goto("/admin/finance");
    await expect(page.getByRole("heading", {name: "Erwarteter Umsatz", exact: true})).toBeVisible();
    await expect(page.getByRole("link", {name: "Umsatz-Analytics öffnen"})).toHaveAttribute("href", "/admin/finance/analytics");
});

test("dual-role finance keeps personal and platform reports separate", async ({page}) => {
    const manager = await actor("Fictional finance lecturer", "management");
    const control = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
    try {
        await checked(control.from("user_roles").insert({user_id: manager.id, role: "lecturer"}));
        await login(page, manager.email);
        await page.goto("/");
        const shortcuts = page.getByRole("navigation", {name: "Direkt weiter", exact: true});
        await expect(shortcuts).toBeVisible();
        expect(await shortcuts.evaluate((nav) =>
            nav.previousElementSibling?.classList.contains("dashboard-metrics"),
        )).toBe(true);
        await page.goto("/finance");
        await expect(page.getByRole("navigation", {name: "Meine Finanzen", exact: true}).getByRole("link", {name: /^Analysen(?: |$)/}))
            .toHaveAccessibleName(/Eigene Einsätze und Einnahmen auswerten/);
        await expect(page.getByRole("heading", {name: "Meine Finanzen", exact: true})).toBeVisible();
        await expect(page.getByRole("checkbox", {name: "Alle Dozierenden anzeigen", exact: true})).toHaveCount(0);
        const personalReport = page.waitForRequest((request) =>
            new URL(request.url()).pathname.endsWith("/rpc/analytics_report"),
        );
        await page.getByRole("navigation", {name: "Meine Finanzen", exact: true})
            .getByRole("link", {name: /^Analysen(?: |$)/}).click();
        expect((await personalReport).postDataJSON()).toMatchObject({p_scope: "personal"});
        await page.goto("/admin/finance");
        await expect(page.getByRole("heading", {name: "Plattformfinanzen", exact: true})).toBeVisible();
        const finance = page.getByRole("main").getByRole("navigation", {name: "Plattformfinanzen", exact: true});
        const staffReport = page.waitForRequest((request) =>
            new URL(request.url()).pathname.endsWith("/rpc/analytics_report"),
        );
        await finance.getByRole("link", {name: /^Analysen(?: |$)/}).click();
        expect((await staffReport).postDataJSON()).toMatchObject({p_scope: "staff"});
        await expect(page.getByLabel("Ansicht", {exact: true})).toHaveCount(0);
        await finance.getByRole("link", {name: /^Buchhaltung und Exporte(?: |$)/}).click();
        const source = page.getByLabel("Rechnungsquelle", {exact: true});
        await expect(source).toHaveValue("lecturer_all");
        await expect(source.locator('option[value="own"]')).toHaveCount(0);
    } finally {
        await checked(control.auth.admin.deleteUser(manager.id));
    }
});

test("finance earnings render the next batch when their own list is scrolled", async ({page}) => {
    const lecturer = await actor("Fictional finance paging lecturer", "lecturer");
    await login(page, lecturer.email);
    const earnings = Array.from({length: 25}, (_, index) => ({
        claim_id: randomUUID(),
        job_id: randomUUID(),
        lecturer_id: lecturer.id,
        lecturer_name: lecturer.name,
        title: `Fictional paged earnings ${index + 1}`,
        customer_name: "Fictional finance academy",
        starts_at: "2057-05-06T08:00:00Z",
        ends_at: "2057-05-06T09:00:00Z",
        amount: 120,
        rate_unit: "fixed_total",
        total_amount: 120,
        currency: "EUR",
        stage: "expected",
        invoice_id: null,
    }));
    await page.route("**/rest/v1/rpc/finance_earnings", route => route.fulfill({json: earnings}));
    await page.goto("/finance");
    const region = page.getByRole("region", {name: "Vereinbarte Honorare", exact: true});
    await expect(region.getByRole("row")).toHaveCount(13);
    await region.scrollIntoViewIfNeeded();
    await region.evaluate(el => el.scrollTop = el.scrollHeight);
    await expect(region.getByRole("row")).toHaveCount(25);
    await region.evaluate(el => el.scrollTop = el.scrollHeight);
    await expect(region.getByRole("row")).toHaveCount(26);
    await expect(region.getByText("Fictional paged earnings 25", {exact: true})).toBeVisible();
});

test("private routes require real authentication and login is accessible", async ({
                                                                                      page,
                                                                                  }, testInfo) => {
    await page.goto("/jobs");
    await expect(page).toHaveURL(/\/login/);
    await expect(
        page.getByRole("button", {name: "Anmelden", exact: true}),
    ).toBeVisible();
    await a11y(page);
    await page.screenshot({
        path: `.local/screenshots/${testInfo.project.name}-login.png`,
        fullPage: true,
    });
});

test("lecturer signs in, edits bilingual profile and persists it on reload", async ({
                                                                                        page,
                                                                                    }, testInfo) => {
    await login(page);
    await expect(
        page.getByRole("region", {name: "Arbeitsbereich"}),
    ).toBeVisible();
    await page.screenshot({
        path: `.local/screenshots/${testInfo.project.name}-dashboard.png`,
        fullPage: true,
    });
    await page.goto("/profile");
    const text = `Lokale QA ${testInfo.project.name}`;
    await page.locator("#bio-de").fill(text);
    await page
        .getByRole("button", {name: "Profil speichern", exact: true})
        .click();
    await expect(page.getByRole("status")).toContainText(/gespeichert/i);
    await page.reload();
    await expect(page.locator("#bio-de")).toHaveValue(text);
    await a11y(page);
});

test("combined filters find a real job, claim confirms all five sessions and immutable fee", async ({
                                                                                                        page,
                                                                                                    }, testInfo) => {
    const id = randomUUID();
    const title = `QA Python ${testInfo.project.name} ${id.slice(0, 8)}`;
    const starts = new Date();
    starts.setUTCDate(
        starts.getUTCDate() +
        15 +
        (testInfo.project.name.includes("mobile") ? 8 : 0),
    );
    starts.setUTCHours(8, 0, 0, 0);
    const {data: accounts} = await service().auth.admin.listUsers({
        perPage: 1000,
    });
    const lecturer = accounts!.users.find(
        (user) => user.email === process.env.E2E_LECTURER_EMAIL,
    )!;
    const {data: previous} = await service()
        .from("assignment_sessions")
        .select("ends_at")
        .eq("lecturer_id", lecturer.id)
        .lt("ends_at", "2030-01-01T00:00:00Z")
        .order("ends_at", {ascending: false})
        .limit(1);
    if (previous?.[0] && new Date(previous[0].ends_at) >= starts) {
        starts.setTime(new Date(previous[0].ends_at).getTime() + 2 * 86_400_000);
        starts.setUTCHours(8, 0, 0, 0);
    }
    const {error: jobError} = await service().from("jobs").insert({
        id,
        title,
        description: "Fiktiver Testauftrag mit fünf Terminen.",
        customer_name: "QA Beispiel Akademie",
        delivery_type: "online",
        location: "Online",
        time_zone: "Europe/Berlin",
        status: "published",
        amount: 400,
        currency: "EUR",
        rate_unit: "per_day",
        total_amount: 2000,
        terms: "Fiktive Testkonditionen Version 1.",
        terms_version: 1,
        requires_contract: true,
    });
    expect(jobError).toBeNull();
    const sessions = Array.from({length: 5}, (_, index) => {
        const start = new Date(starts);
        start.setUTCDate(start.getUTCDate() + index);
        return {
            job_id: id,
            starts_at: start.toISOString(),
            ends_at: new Date(start.getTime() + 6 * 3600_000).toISOString(),
        };
    });
    const {error: sessionError} = await service()
        .from("job_sessions")
        .insert(sessions);
    expect(sessionError).toBeNull();
    await login(page);
    await page.goto("/jobs");
    await page.getByText("Filter & Ansichten", {exact: true}).click();
    await page
        .getByRole("searchbox", {name: "Suchtext", exact: true})
        .fill(title);
    await page.getByLabel("Durchführung", {exact: true}).selectOption("online");
    await page.getByLabel("Währung", {exact: true}).selectOption("EUR");
    await page.getByLabel("Gesamthonorar ab", {exact: true}).fill("1900");
    await page
        .getByRole("button", {name: "Filter anwenden", exact: true})
        .click();
    await expect(
        page.getByRole("link", {name: new RegExp(title)}).first(),
    ).toBeVisible();
    await page
        .getByRole("link", {name: new RegExp(title)})
        .first()
        .click();
    await expect(page).toHaveURL(new RegExp(`/jobs/${id}`));
    await expect(page.getByText(/2\.000,00\s*€/).first()).toBeVisible();
    await page.getByLabel(/Konditionen akzeptieren/).check();
    await page
        .getByRole("button", {name: "Auftrag übernehmen", exact: true})
        .click();
    // Wait for the actual claim receipt while the page may refresh related panels.
    await expect(page.getByRole("status").filter({
        hasText: /^Dein Auftrag ist bestätigt\. Alle Termine sind reserviert\.$/,
    })).toBeVisible();
    const {client, user} = await signInApi(process.env.E2E_LECTURER_EMAIL!);
    const {data: claims, error} = await client
        .from("job_claims")
        .select("*")
        .eq("job_id", id);
    expect(error).toBeNull();
    expect(claims).toHaveLength(1);
    const claim = claims![0];
    expect(claim).toMatchObject({
        lecturer_id: user.id,
        status: "confirmed",
        amount: 400,
        total_amount: 2000,
        currency: "EUR",
        terms_version: 1,
        terms: "Fiktive Testkonditionen Version 1.",
    });
    const {data: allocations, error: allocationError} = await client
        .from("assignment_sessions")
        .select("starts_at,ends_at,released_at")
        .eq("claim_id", claim.id)
        .order("starts_at");
    expect(allocationError).toBeNull();
    expect(allocations?.map((entry) => ({
        starts_at: new Date(entry.starts_at).toISOString(),
        ends_at: new Date(entry.ends_at).toISOString(),
        released_at: entry.released_at,
    }))).toEqual(sessions.map(({starts_at, ends_at}) => ({starts_at, ends_at, released_at: null})));
    // Raw job rows are hidden from lecturers after claiming until the company
    // identity reveal window. The authorized detail projection still exposes
    // lifecycle status without revealing protected columns.
    const {data: storedJob, error: storedJobError} = await client.rpc("job_detail", {
        p_job_id: id,
    });
    expect(storedJobError).toBeNull();
    expect((storedJob as {status?: string} | null)?.status).toBe("filled");
    await page.goto("/calendar");
    await expect(
        page.getByRole("heading", {name: /Kalender/}).first(),
    ).toBeVisible();
    await page.screenshot({
        path: `.local/screenshots/${testInfo.project.name}-calendar.png`,
        fullPage: true,
    });
});

test("private calendar event is persisted and invisible to another lecturer", async ({
                                                                                         page,
                                                                                     }, testInfo) => {
    const title = `Privat QA ${randomUUID().slice(0, 8)}`;
    await login(page);
    await page.goto("/calendar");
    await page
        .getByRole("button", {name: "Privaten Termin hinzufügen", exact: true})
        .click();
    await page.getByLabel("Titel", {exact: true}).fill(title);
    await page.getByLabel("Beginn", {exact: true}).fill("2030-05-06T10:00");
    await page.getByLabel("Ende", {exact: true}).fill("2030-05-06T11:00");
    await page
        .getByRole("button", {name: "Termin speichern", exact: true})
        .click();
    await expect(page.getByRole("status")).toContainText(/gespeichert/i);
    const owner = await signInApi(process.env.E2E_LECTURER_EMAIL!);
    const other = await signInApi(process.env.E2E_OTHER_EMAIL!);
    const {data: own, error} = await owner.client
        .from("personal_events")
        .select("*")
        .eq("title", title);
    expect(error).toBeNull();
    expect(own).toHaveLength(1);
    const {data: stolen, error: stolenError} = await other.client
        .from("personal_events")
        .select("*")
        .eq("id", own![0].id);
    expect(stolenError).toBeNull();
    expect(stolen).toEqual([]);
    const {data: mutated, error: mutationError} = await other.client
        .from("personal_events")
        .update({title: "forged"})
        .eq("id", own![0].id)
        .select();
    expect(mutationError).toBeNull();
    expect(mutated).toEqual([]);
    await a11y(page);
    const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow, `${testInfo.project.name} has no horizontal overflow`).toBe(
        false,
    );
});

test("role changes and private profile reads fail through the real REST API", async () => {
    const {client, user} = await signInApi(process.env.E2E_LECTURER_EMAIL!);
    const other = await signInApi(process.env.E2E_OTHER_EMAIL!);
    const {error: escalationError} = await client
        .from("user_roles")
        .insert({user_id: user.id, role: "admin"});
    expect(escalationError, "Lecturer cannot grant own admin role").toBeTruthy();
    const {data: profile, error: profileError} = await client
        .from("profiles")
        .select("*")
        .eq("id", other.user.id);
    expect(profileError).toBeNull();
    expect(profile).toEqual([]);
});

test("language changes preserve input, themes render accessibly, offline mutations stay disabled", async ({
                                                                                                              page,
                                                                                                              context,
                                                                                                          }, testInfo) => {
    await page.emulateMedia({reducedMotion: "reduce"});
    // This journey persists language and theme. Keep those writes off the shared lecturer.
    const lecturer = await actor("Fictional language and theme lecturer", "lecturer");
    await login(page, lecturer.email);
    await page.goto("/profile");
    const draft = `Ungespeicherter Sprachtest ${randomUUID().slice(0, 8)}`;
    await page.getByLabel("Über mich", {exact: true}).fill(draft);
    await page.getByLabel("Sprache", {exact: true}).selectOption("en");
    await expect(page.getByLabel("About me", {exact: true})).toHaveValue(draft);
    await page.getByLabel("Theme", {exact: true}).selectOption("dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await a11y(page);
    await page.screenshot({
        path: `.local/screenshots/${testInfo.project.name}-profile-dark-en.png`,
        fullPage: true,
    });
    await page.getByLabel("Theme", {exact: true}).selectOption("light");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await a11y(page);
    await page.emulateMedia({colorScheme: "dark"});
    await page.getByLabel("Theme", {exact: true}).selectOption("system");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await context.setOffline(true);
    await expect(page.getByRole("status")).toContainText(/You are offline/);
    await expect(
        page.getByRole("button", {name: "Save profile", exact: true}),
    ).toBeDisabled();
    await context.setOffline(false);
    await expect(
        page.getByRole("button", {name: "Save profile", exact: true}),
    ).toBeEnabled();
});

/** Uses the real password-only session before exercising database-authorized admin forms. */
async function adminSession(page: Page) {
    const {client} = await signInApi(process.env.E2E_ADMIN_EMAIL!);
    await assertPasswordOnly(client);
    await login(page, process.env.E2E_ADMIN_EMAIL!);
}

test("admin uses password-only access and publishes a five-session job through the UI", async ({
                                                                                                   page,
                                                                                               }, testInfo) => {
    test.setTimeout(70_000);
    await adminSession(page);
    await page.goto("/admin?create=job");
    const title = `QA Verwaltung ${testInfo.project.name} ${randomUUID().slice(0, 8)}`;
    await page.getByLabel("Titel", {exact: true}).fill(title);
    await page
        .getByLabel("Beschreibung", {exact: true})
        .fill("Fiktiver über die echte Adminoberfläche angelegter Testauftrag.");
    await page.getByLabel("Unternehmen", {exact: true}).fill("QA Beispielunternehmen");
    await page
        .getByLabel("Voller Auftragspreis je Einheit", {exact: true})
        .fill("450");
    await page
        .getByLabel("Voller Auftragspreis gesamt", {exact: true})
        .fill("2250");
    await page.getByLabel("Währung", {exact: true}).selectOption("EUR");
    await page.getByLabel("Einheit", {exact: true}).selectOption("per_day");
    await page
        .getByLabel("Konditionen", {exact: true})
        .fill("Fiktive lokale QA-Konditionen.");
    await page.getByLabel("Erster Tag", {exact: true}).fill("2028-06-12");
    await page.getByLabel("Letzter Tag", {exact: true}).fill("2028-06-16");
    await page.getByRole("button", {name: "Zeitraum übernehmen", exact: true}).click();
    const starts = page.getByLabel(/^Beginn \d+$/);
    const ends = page.getByLabel(/^Ende \d+$/);
    await expect(starts).toHaveCount(5);
    await expect(starts.first()).toHaveValue("2028-06-12T09:00");
    await starts.nth(1).fill("2028-06-13T10:30");
    await ends.nth(1).fill("2028-06-13T16:00");
    await page.getByLabel("Sofort veröffentlichen", {exact: true}).check();
    const [publication] = await Promise.all([
        page.waitForResponse(
            (response) =>
                response.request().method() === "POST" &&
                new URL(response.url()).pathname.endsWith("/rest/v1/rpc/training_offer_creator_draft_action") &&
                response.request().postDataJSON()?.p_action === "commit",
            {timeout: 25_000},
        ),
        page.getByRole("button", {name: "Auftrag speichern", exact: true}).click(),
    ]);
    expect(publication.ok(), "The server confirms the saved and published assignment").toBe(true);
    const {job_id: publishedId} = await publication.json();
    await expect(
        page
            .locator('.notice[role="status"]')
            .filter({hasText: /^Auftrag gespeichert\.$/}),
    ).toBeVisible();
    const {data: job, error: jobError} = await service()
        .from("jobs")
        .select("id,status,job_sessions(*)")
        .eq("title", title)
        .single();
    expect(jobError).toBeNull();
    expect(job!.id).toBe(publishedId);
    expect(job!.status).toBe("published");
    expect(job!.job_sessions).toHaveLength(5);
    const secondDay = job!.job_sessions.find((session) =>
        new Date(session.starts_at).toISOString().startsWith("2028-06-13"));
    expect(new Date(secondDay!.starts_at).toISOString()).toBe("2028-06-13T08:30:00.000Z");
    expect(new Date(secondDay!.ends_at).toISOString()).toBe("2028-06-13T14:00:00.000Z");
    await page.goto(`/jobs/${publishedId}`);
    await expect(page.getByRole("heading", {name: title, exact: true})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Durchführungszeitraum", exact: true})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Auftragsdateien", exact: true})).toBeVisible();

    // Account invitations live on their own current-authority administration page.
    await page.goto("/admin/accounts");
    const email = `ui-invite-${randomUUID()}@example.invalid`;
    await page.getByLabel("E-Mail", {exact: true}).fill(email);
    await page
        .getByLabel("Anzeigename", {exact: true})
        .fill("Fiktive UI-QA-Lehrkraft");
    const sendInvitation = page.getByRole("button", {name: "Einladung senden", exact: true});
    const inviteRole = page.getByLabel("Kontorolle", {exact: true});
    await expect(inviteRole).toBeEnabled();
    await expect(inviteRole).toHaveValue("");
    await expect(sendInvitation).toBeDisabled();
    await inviteRole.selectOption("lecturer");
    await sendInvitation.click();
    await expect(
        page
            .getByRole("status")
            .filter({hasText: "Die Einladung wurde versandt"}),
    ).toBeVisible();
    const {data: invitedAccounts} = await service().auth.admin.listUsers({
        perPage: 1000,
    });
    const invited = invitedAccounts!.users.find((user) => user.email === email);
    expect(invited).toBeTruthy();
    const {data: invitedRoles} = await service()
        .from("user_roles")
        .select("role")
        .eq("user_id", invited!.id);
    expect(invitedRoles!.map((role) => role.role)).toEqual(["lecturer"]);
    // Clear only this UUID email's disposable local reservation so repeated QA suites
    // do not consume the actor's five-invitations-per-15-minutes business quota.
    const cleanup = await service()
        .from("invitation_requests")
        .delete()
        .eq("email", email);
    expect(cleanup.error).toBeNull();
    await a11y(page);
    await page.screenshot({
        path: `.local/screenshots/${testInfo.project.name}-admin.png`,
        fullPage: true,
    });
});

test("admin verifies self-selected expertise and suspends/reactivates a fictional lecturer with immediate RLS enforcement", async ({
                                                                                                                                       page,
                                                                                                                                   }, testInfo) => {
    const email = "lecturer03@example.invalid";
    const actor = await signInApi(email);
    await login(page, email);
    await page.goto("/profile");
    const topic = page.getByRole("checkbox", {name: /Wireshark/});
    if (await topic.isChecked()) {
        await topic.click();
        await expect(topic).not.toBeChecked();
    }
    await topic.click();
    await expect(topic).toBeChecked();
    const {data: topics} = await service()
        .from("topics")
        .select("id")
        .eq("label_en", "Wireshark")
        .single();
    await expect
        .poll(async () => {
            const {data} = await actor.client
                .from("lecturer_topics")
                .select("verified")
                .eq("topic_id", topics!.id)
                .single();
            return data?.verified;
        })
        .toBe(false);
    await signOut(page);
    await adminSession(page);
    await page.goto("/admin/people");
    await expect(page).toHaveURL(/\/people$/);
    await page.locator("#people-search").fill("Lea Sommer");
    await page.getByRole("link", {name: "Lea Sommer", exact: true}).click();
    await page.getByRole("button", {name: "Qualifikationen und Nachweise", exact: true}).click();
    const review = page.getByRole("form", {
        name: "Expertise prüfen: Wireshark",
        exact: true,
    });
    await review
        .getByLabel("Gültig bis (UTC)", {exact: true})
        .fill("2029-12-31T23:59");
    await review
        .getByRole("button", {name: "Expertise verifizieren", exact: true})
        .click();
    await expect(review.getByRole("status")).toContainText(
        "Die Verifizierung wurde gespeichert.",
    );
    const {data: verified, error} = await actor.client
        .from("lecturer_topics")
        .select("*")
        .eq("topic_id", topics!.id)
        .single();
    expect(error).toBeNull();
    expect(verified!.verified).toBe(true);
    expect(new Date(verified!.valid_until).toISOString()).toBe(
        "2029-12-31T23:59:00.000Z",
    );
    await page
        .getByRole("button", {name: "Zugang sperren", exact: true})
        .click();
    const confirm = page.getByRole("dialog", {
        name: "Zugang sperren",
        exact: true,
    });
    await confirm
        .getByRole("button", {name: "Kontostatus bestätigen", exact: true})
        .click();
    await expect(confirm).not.toBeVisible();
    await expect
        .poll(async () => {
            const {error} = await actor.client.from("jobs").select("id");
            return error?.code;
        })
        .toBe("42501");
    const forbidden = await actor.client.from("personal_events").insert({
        user_id: actor.user.id,
        title: "Suspended QA mutation",
        starts_at: "2030-03-01T09:00:00Z",
        ends_at: "2030-03-01T10:00:00Z",
    });
    expect(forbidden.error).toBeTruthy();
    await page
        .getByRole("button", {name: "Zugang aktivieren", exact: true})
        .click();
    const restore = page.getByRole("dialog", {
        name: "Zugang aktivieren",
        exact: true,
    });
    await restore
        .getByRole("button", {name: "Kontostatus bestätigen", exact: true})
        .click();
    await expect(restore).not.toBeVisible();
    await expect
        .poll(async () => {
            const {data} = await actor.client
                .from("profiles")
                .select("active")
                .eq("id", actor.user.id)
                .single();
            return data?.active;
        })
        .toBe(true);
    await a11y(page);
    await page.screenshot({
        path: `.local/screenshots/${testInfo.project.name}-people.png`,
        fullPage: true,
    });
});
