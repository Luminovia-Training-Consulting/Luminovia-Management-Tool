/** Browser acceptance for the red/green admin-only Premium switch and audited retained-course view. */
import {expect, test} from "@playwright/test";
import {randomUUID} from "node:crypto";
import {actor, api, checked, login} from "./helpers/accounts-support";

test.skip(
    process.env.PORTAL_TEST_MODE !== "1",
    "Premium mutations require the isolated ./portal test stack.",
);

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
        await page.getByLabel("Suche", {exact: true}).fill(name);
        await page.getByRole("button", {name, exact: true}).click();
        let premiumSwitch = page.getByRole("switch", {
            name: "Premium aktivieren",
        });
        await expect(premiumSwitch).toBeVisible();
        await expect(premiumSwitch).toHaveAttribute("aria-checked", "false");

        await premiumSwitch.click();
        await expect(
            page.getByRole("dialog", {name: "Premium LMS aktivieren?"}),
        ).toBeVisible();
        await page.getByRole("button", {name: "Abbrechen", exact: true}).click();
        await expect(premiumSwitch).toHaveAttribute("aria-checked", "false");
        const unchanged = await admin.client.rpc("company_premium_settings");
        expect(unchanged.error).toBeNull();
        expect(
            unchanged.data.find((setting) => setting.organisation_id === organisation),
        ).toMatchObject({enabled: false, version: 0});

        await premiumSwitch.click();
        await page.getByRole("button", {name: "Weiter", exact: true}).click();
        await page
            .getByRole("button", {name: "Premium LMS jetzt einschalten", exact: true})
            .click();
        premiumSwitch = page.getByRole("switch", {
            name: "Premium deaktivieren",
        });
        await expect(premiumSwitch).toHaveAttribute("aria-checked", "true");

        await page
            .getByRole("button", {name: "Beibehaltene Kursdaten ansehen", exact: true})
            .click();
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

        await premiumSwitch.click();
        await page.getByRole("button", {name: "Weiter", exact: true}).click();
        await page
            .getByRole("button", {name: "Premium LMS jetzt ausschalten", exact: true})
            .click();
        premiumSwitch = page.getByRole("switch", {
            name: "Premium aktivieren",
        });
        await expect(premiumSwitch).toHaveAttribute("aria-checked", "false");

        const managerPage = await browser.newPage();
        await login(managerPage, manager.email);
        await managerPage.goto("/admin/clients");
        await managerPage.getByLabel("Suche", {exact: true}).fill(name);
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
        const direct = await manager.client.rpc("set_company_premium", {
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