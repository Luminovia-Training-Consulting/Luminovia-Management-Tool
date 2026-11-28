/** Native operational navigation covers retained links and restored teaching evidence. */
import {expect, test} from "@playwright/test";
import {withApiFixture} from "../../scripts/testing/api.mjs";
import {login} from "./helpers/accounts-support";

test("legacy links redirect, teaching evidence opens directly, and collapsed header search works", async ({
                                                                                                                      page,
                                                                                                                  }) => {
    await withApiFixture(async ({actor}) => {
        const teacher = await actor("fictional-operational-navigation", "lecturer");
        await login(page, teacher.email);
        for (const [retired, destination] of [
            ["/availability", "/calendar"],
            ["/timesheets", "/finance"],
            ["/workbench", "/"],
        ]) {
            await page.goto(retired);
            await expect(page).toHaveURL(
                new RegExp(`${destination === "/" ? "/" : destination}$`),
            );
            await expect(page.locator("main h1").first()).toBeVisible();
        }
        await page.goto("/delivery");
        await expect(page).toHaveURL(/\/delivery$/);
        await expect(page.getByRole("heading", {
            name: /^(Leistungsnachweise|Delivery evidence)$/,
            level: 1,
        })).toBeVisible();
        const collapse = page.getByRole("button", {
            name: /Navigation einklappen|Collapse navigation/,
        });
        if (await collapse.isVisible()) await collapse.click();
        const searchResponse = page.waitForResponse((response) =>
            new URL(response.url()).pathname === "/rest/v1/rpc/unified_search" &&
            response.request().method() === "POST" &&
            response.request().postDataJSON().p_query === "Fictional",
        );
        const headerSearch = page.getByRole("banner").getByRole("search");
        await headerSearch.getByRole("searchbox").fill("Fictional");
        await headerSearch.getByRole("button", {
            name: /^(Suche starten|Run search)$/,
        }).click();
        await expect(page).toHaveURL(/\/search$/);
        await expect(page.getByRole("searchbox", {name: /^(Suchbegriff|Search term)$/})).toHaveValue("Fictional");
        expect((await searchResponse).status()).toBe(200);
        expect(await page.locator(".sidebar .global-search").count()).toBe(0);
        expect(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth + 1,
            ),
        ).toBe(true);
    });
});
