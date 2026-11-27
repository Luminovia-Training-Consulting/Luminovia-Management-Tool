/** Browser acceptance for the red/green admin-only Premium switch and audited retained-course view. */
import {expect, test, type Page} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {randomUUID} from "node:crypto";
import {actor, api, checked, login} from "./helpers/accounts-support";

test.skip(
    process.env.PORTAL_TEST_MODE !== "1",
    "Premium mutations require the isolated ./portal test stack.",
);

/** Use independent SDK sessions to assert the server state for each browser actor. */
async function signedInClient(email: string) {
    const client = api(process.env.SUPABASE_ANON_KEY!);
    await checked(client.auth.signInWithPassword({
        email,
        password: process.env.E2E_PASSWORD!,
    }), {requireData: true});
    return client;
}

async function checkPremiumAccessibility(page: Page) {
    const result = await new AxeBuilder({page})
        .include(".company-premium-control")
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
    expect(result.violations).toEqual([]);
}

test("admin provisions Premium while creating a company", async ({page}) => {
    const admin = await actor("Fictional company setup admin", "admin");
    const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const name = `Fictional Premium setup ${randomUUID().slice(0, 8)}`;
    try {
        await login(page, admin.email);
        await page.goto("/admin/clients");
        await page.getByRole("button", {name: "Organisation anlegen", exact: true}).click();
        const dialog = page.getByRole("dialog", {name: "Organisation anlegen"});
        const enable = dialog.getByRole("switch", {name: "Premium LMS", exact: true});
        await dialog.getByLabel("Name", {exact: true}).fill(name);
        await expect(enable).toHaveAttribute("aria-checked", "false");
        await enable.press("Space");
        await expect(enable).toHaveAttribute("aria-checked", "true");
        await dialog.getByRole("button", {name: "Speichern", exact: true}).click();
        await expect(dialog).toBeHidden();
        await expect(page.getByRole("heading", {name, exact: true})).toBeVisible();
        await expect(page.getByRole("switch", {name: "Premium LMS", exact: true}))
            .toHaveAttribute("aria-checked", "true");
        await page.reload();
        await page.getByRole("searchbox", {name: "Suchen", exact: true}).fill(name);
        await page.getByRole("button", {name, exact: true}).click();
        await expect(page.getByRole("switch", {name: "Premium LMS", exact: true}))
            .toHaveAttribute("aria-checked", "true");
    } finally {
        await service.from("organisations").delete().eq("name", name);
        await service.auth.admin.deleteUser(admin.id);
    }
});

test("only an actual admin can confirm Premium ON/OFF and inspect retained course data", async ({
                                                                                                    page,
                                                                                                    browser,
                                                                                                }) => {
    test.setTimeout(90_000);
    const admin = await actor("Fictional Premium admin", "admin"),
        manager = await actor("Fictional Premium manager", "management"),
        service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const organisation = randomUUID(),
        name = `Fictional Premium academy ${randomUUID().slice(0, 8)}`;
    await checked(service.from("organisations").insert({id: organisation, name}));
    try {
        await login(page, admin.email);
        const search = page.getByRole("searchbox", {name: "Suchen", exact: true});
        await expect(async () => {
            await page.goto("/admin/clients", {waitUntil: "commit", timeout: 8_000});
            await expect(search).toBeVisible({timeout: 8_000});
        }).toPass({timeout: 28_000, intervals: [300]});
        await search.fill(name);
        await page.getByRole("button", {name, exact: true}).click();
        const premiumSwitch = page.getByRole("switch", {name: "Premium LMS", exact: true});
        await expect(premiumSwitch).toBeVisible();
        await expect(premiumSwitch).toHaveAttribute("aria-checked", "false");

        await expect(premiumSwitch).toHaveText("Premium LMS AUS");
        await page.getByLabel("Farbschema", {exact: true}).selectOption("light");
        await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
        await checkPremiumAccessibility(page);

        await premiumSwitch.press("Space");
        await expect(
            page.getByRole("dialog", {name: "Premium LMS aktivieren?"}),
        ).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(premiumSwitch).toBeFocused();
        await expect(premiumSwitch).toHaveAttribute("aria-checked", "false");
        const adminClient = await signedInClient(admin.email);
        const unchanged: {organisation_id: string; enabled: boolean; version: number}[] =
            await checked(adminClient.rpc("company_premium_settings"), {requireData: true});
        expect(
            unchanged.find((setting) => setting.organisation_id === organisation),
        ).toMatchObject({enabled: false, version: 0});

        await premiumSwitch.click();
        await page.getByRole("button", {name: "Weiter", exact: true}).press("Enter");
        await expect(page.getByRole("button", {name: "Zurück", exact: true})).toBeFocused();
        await page.keyboard.press("Tab");
        await expect(
            page.getByRole("button", {name: "Premium LMS jetzt einschalten", exact: true}),
        ).toBeFocused();
        await page.keyboard.press("Enter");
        await expect(premiumSwitch).toHaveAttribute("aria-checked", "true");
        await expect(premiumSwitch).toHaveText("Premium LMS EIN");
        await expect(premiumSwitch).toBeFocused();

        const retained = page.getByRole("button", {
            name: "Beibehaltene Kursdaten ansehen",
            exact: true,
        });
        await retained.click();
        await expect(
            page.getByRole("dialog", {
                name: "Beibehaltene Kursdaten ansehen",
            }),
        ).toBeVisible();
        await expect(page.getByText("0 beibehaltene Kursdurchführungen")).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(
            page.getByRole("dialog", {name: "Beibehaltene Kursdaten ansehen"}),
        ).toHaveCount(0);

        await expect(retained).toBeFocused();
        await page.getByLabel("Sprache", {exact: true}).selectOption("en");
        await page.getByLabel("Theme", {exact: true}).selectOption("dark");
        await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
        await expect(premiumSwitch).toHaveText("Premium LMS ON");
        await checkPremiumAccessibility(page);
        await premiumSwitch.press("Space");
        await expect(page.getByRole("dialog", {name: "Disable Premium LMS?"})).toBeVisible();
        await page.getByRole("button", {name: "Continue", exact: true}).press("Enter");
        await expect(page.getByRole("button", {name: "Back", exact: true})).toBeFocused();
        await page.getByRole("button", {name: "Confirm disabling Premium LMS", exact: true}).press("Enter");
        await expect(premiumSwitch).toHaveAttribute("aria-checked", "false");
        await expect(premiumSwitch).toHaveText("Premium LMS OFF");
        await checkPremiumAccessibility(page);

        const managerPage = await browser.newPage();
        await login(managerPage, manager.email);
        await managerPage.goto("/admin/clients");
        await managerPage.getByRole("searchbox", {name: "Suchen", exact: true}).fill(name);
        await managerPage.getByRole("button", {name, exact: true}).click();
        await expect(managerPage.getByText("Premium LMS AUS")).toBeVisible();
        await expect(
            managerPage.getByText(
                "Nur eine aktive Administration darf Premium umschalten.",
            ),
        ).toBeVisible();
        await expect(managerPage.getByRole("switch")).toHaveCount(0);
        await expect(
            managerPage.getByRole("button", {
                name: "Beibehaltene Kursdaten ansehen",
            }),
        ).toHaveCount(0);
        const managerClient = await signedInClient(manager.email);
        const direct = await managerClient.rpc("set_company_premium", {
            p_organisation_id: organisation,
            p_enabled: true,
            p_expected_version: 2,
            p_request_id: randomUUID(),
        });
        expect(direct.error?.code).toBe("42501");
        await managerPage.close();
    } finally {
        await service.from("organisations").delete().eq("id", organisation);
        await service.auth.admin.deleteUser(admin.id);
        await service.auth.admin.deleteUser(manager.id);
    }
});

test("opens the standard course workspace from an assignment when Premium is off", async ({page}) => {
    const admin = await actor("Fictional standard course admin", "admin");
    const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const organisation = randomUUID(), template = randomUUID(),
        run = randomUUID(), session = randomUUID(), job = randomUUID();
    const title = "Fictional standard course";
    const description = "Fictional standard course description.";
    try {
        await checked(service.from("organisations").insert({id: organisation, name: "Fictional standard company"}));
        await checked(service.from("course_templates").insert({id: template, title, description}));
        await checked(service.from("course_runs").insert({id: run, template_id: template, organisation_id: organisation}));
        await checked(service.from("course_sessions").insert({
            id: session, course_run_id: run, starts_at: "2040-07-16T09:00:00Z", ends_at: "2040-07-16T11:00:00Z",
        }));
        await checked(service.from("jobs").insert({
            id: job, course_run_id: run, title: "Fictional teaching assignment", customer_name: "Fictional standard company",
            delivery_type: "online", status: "draft", amount: 100, total_amount: 100, currency: "EUR",
            rate_unit: "fixed_total", terms: "Fictional agreement",
        }));

        await login(page, admin.email);
        await page.goto(`/jobs/${job}`);
        await page.getByRole("link", {name: "Kursarbeitsraum öffnen", exact: true}).click();
        await expect(page).toHaveURL(new RegExp(`/courses/${run}/workspace$`));
        await expect(page.getByRole("heading", {name: title, exact: true})).toBeVisible();
        await expect(page.getByText(description, {exact: true})).toBeVisible();
        await expect(page.getByRole("button", {name: "Modul hinzufügen"})).toBeVisible();
        await expect(page.locator(".course-workspace-sessions li")).toHaveCount(1);
        await expect(page.locator("#course-materials")).toBeVisible();
        await expect(page.locator("#course-enrolments")).toBeVisible();
        await expect(page.locator("#course-exam")).toHaveCount(0);
    } finally {
        await service.from("jobs").delete().eq("id", job);
        await service.from("course_sessions").delete().eq("id", session);
        await service.from("course_runs").delete().eq("id", run);
        await service.from("course_templates").delete().eq("id", template);
        await service.from("organisations").delete().eq("id", organisation);
        await service.auth.admin.deleteUser(admin.id);
    }
});
