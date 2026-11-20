/** Verify the staff role-preview switch renders only fictional content and never calls business APIs while active. */
import {expect, test} from "@playwright/test";
import {actor, api, checked, login,} from "./helpers/accounts-support";

test.skip(
    process.env.PORTAL_TEST_MODE !== "1",
    "Role preview writes and identity checks require the isolated ./portal test project.",
);

test("management/lecturer/company previews do not impersonate or issue live business requests", async ({
                                                                                                           page,
                                                                                                       }) => {
    const administrator = await actor("Fictional role-preview administrator", "admin"),
        service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const violations: string[] = [];
    let previewActive = false;
    await page.route(/\/(?:rest|functions)\/v1\//, async (route) => {
        if (previewActive) {
            violations.push(`${route.request().method()} ${route.request().url()}`);
            await route.abort();
        } else {
            await route.continue();
        }
    });
    try {
        const before = await checked(
            service
                .from("user_roles")
                .select("role")
                .eq("user_id", administrator.id),
            "Read fictional preview actor roles",
        );
        await login(page, administrator.email);
        await page.goto("/");
        await expect(
            page.getByRole("region", {name: "Arbeitsbereich"}),
        ).toBeVisible();
        await page.waitForLoadState("networkidle");
        previewActive = true;
        const selector = page.getByLabel("Navigationsvorschau", {exact: true});
        await selector.selectOption("management");
        await expect(
            page.getByRole("heading", {name: "Beispielansicht: Verwaltung"}),
        ).toBeVisible();
        await expect(page.getByText(/Aktiver Beispielbereich.*Kurse/)).toBeVisible();
        await expect(
            page.getByText("Fiktive offene Plätze und bestätigte Zuordnungen."),
        ).toBeVisible();
        await expect(page.getByRole("search")).toHaveCount(0);
        await expect(page.locator(".notification-menu")).toHaveCount(0);
        await page
            .getByRole("link", {name: "Kurse & Durchführung", exact: true})
            .click();
        await expect(page).toHaveURL(/\/courses$/);
        await expect(
            page.getByRole("heading", {name: "Beispielansicht: Verwaltung"}),
        ).toBeVisible();

        await selector.selectOption("lecturer");
        await expect(
            page.getByRole("heading", {name: "Beispielansicht: Dozent:in"}),
        ).toBeVisible();
        await selector.selectOption("company");
        await expect(
            page.getByRole("heading", {name: "Beispielansicht: Unternehmen"}),
        ).toBeVisible();
        expect(violations).toEqual([]);
        const after = await checked(
            service
                .from("user_roles")
                .select("role")
                .eq("user_id", administrator.id),
            "Recheck actual preview actor roles",
        );
        expect(after).toEqual(before);

        previewActive = false;
        await selector.selectOption("live");
        await expect(
            page.getByRole("heading", {name: "Kurse", exact: true}),
        ).toBeVisible();
    } finally {
        await checked(service.auth.admin.deleteUser(administrator.id));
    }
});