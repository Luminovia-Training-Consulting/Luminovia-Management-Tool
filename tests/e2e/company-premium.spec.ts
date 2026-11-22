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

test("only an actual admin can confirm Premium ON/OFF and inspect retained course data", async ({
                                                                                                    page,
                                                                                                    browser,
                                                                                                }) => {
    const admin = await actor("Fictional Premium admin", "admin"),
        manager = await actor("Fictional Premium manager", "management"),
        service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const organisation = randomUUID(),
        name = `Fictional Premium academy ${randomUUID().slice(0, 8)}`;
    await checked(service.from("organisations").insert({id: organisation, name}));
    try {
        await login(page, admin.email);
        await page.goto("/admin/clients");
        await page.getByRole("searchbox", {name: "Suchen", exact: true}).fill(name);
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
