/**
 * Browser workflows for account roles, scoped invitations and confirmed status changes.
 * Rendered workflows are checked in isolation; this does not replace manual device/platform acceptance.
 */
import {expect, test} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {randomUUID} from "node:crypto";
import {actor, adminLogin, api, checked, login,} from "./helpers/accounts-support";

test.skip(
    process.env.PORTAL_TEST_MODE !== "1",
    "Account workflows only run in isolated ./portal test.",
);
test("individual account roles, scoped invitations and linked status management use real API confirmation", async ({
                                                                                                                       page,
                                                                                                                       browser,
                                                                                                                   }, testInfo) => {
    test.setTimeout(120000);
    const suffix = randomUUID().slice(0, 8),
        admin = await actor(`Account Admin ${suffix}`, "admin"),
        teacher = await actor(`Account Teacher ${suffix}`, "lecturer");
    await adminLogin(page, admin);
    await page.goto("/admin/accounts");
    await expect(
        page.getByRole("heading", {name: "Konten & Zugänge", exact: true}),
    ).toBeVisible();
    const search = page.getByRole("searchbox", {
        name: "Konten suchen",
        exact: true,
    });
    await search.fill(teacher.name);
    await expect(search).toBeFocused();
    const roleEdit = page.getByRole("button", {
            name: "Rollen bearbeiten",
            exact: true,
        }),
        deleteAction = page.getByRole("button", {
            name: `Endgültig löschen: ${teacher.name}`,
            exact: true,
        });
    await expect(roleEdit).toBeVisible();
    await expect(deleteAction).toBeVisible();
    await expect(page.locator(".account-list .public-user-id code")).toHaveText(
        /^LV-[0-9A-F]{4}(?:-[0-9A-F]{4}){4}$/,
    );
    const initialViewport = page.viewportSize();
    for (const width of [390, 768, 1280, 1920]) {
        await page.setViewportSize({width, height: 900});
        const group = page.locator(".account-list-actions"),
            groupBox = await group.boundingBox(),
            deleteBox = await deleteAction.boundingBox(),
            roleBox = await roleEdit.boundingBox();
        expect(groupBox).not.toBeNull();
        expect(deleteBox).not.toBeNull();
        expect(roleBox).not.toBeNull();
        expect(groupBox!.right).toBeLessThanOrEqual(width + 1);
        expect(deleteBox!.right).toBeLessThanOrEqual(width + 1);
        expect(roleBox!.right).toBeLessThanOrEqual(width + 1);
        const overlap =
            deleteBox!.x < roleBox!.x + roleBox!.width &&
            roleBox!.x < deleteBox!.x + deleteBox!.width &&
            deleteBox!.y < roleBox!.y + roleBox!.height &&
            roleBox!.y < deleteBox!.y + deleteBox!.height;
        expect(overlap).toBe(false);
    }
    if (initialViewport) await page.setViewportSize(initialViewport);
    await roleEdit.focus();
    await page.keyboard.press("Enter");
    const roleDialog = page.getByRole("dialog", {
        name: "Rollen bearbeiten",
        exact: true,
    });
    await expect(
        roleDialog.getByLabel("Administration", {exact: true}),
    ).toBeVisible();
    await expect(
        roleDialog.getByLabel("Management", {exact: true}),
    ).toBeVisible();
    await expect(
        roleDialog.getByLabel("Kursteilnehmer:in", {exact: true}),
    ).toHaveCount(0);
    await expect(roleDialog.getByLabel("Gast", {exact: true})).toBeVisible();
    await roleDialog.getByLabel("Senior-Dozent:in", {exact: true}).check();
    await roleDialog
        .getByRole("button", {name: "Rollen speichern", exact: true})
        .click();
    const confirmation = page.getByRole("dialog", {
        name: `Rollen für ${teacher.name} ändern?`,
        exact: true,
    });
    await confirmation
        .getByRole("button", {name: "Rollen speichern", exact: true})
        .click();
    await expect(confirmation).not.toBeVisible();
    await expect(
        page.getByRole("status").filter({hasText: "Rollen wurden gespeichert."}),
    ).toBeVisible();
    const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const actualRoles = await checked(
        service.from("user_roles").select("role").eq("user_id", teacher.id),
    );
    expect(actualRoles.map((row) => row.role).sort()).toEqual([
        "lecturer",
        "senior_lecturer",
    ]);
    await page
        .getByRole("link", {
            name: "Profil, Nachweise und Kontostatus verwalten",
            exact: true,
        })
        .click();
    await expect(page).toHaveURL(
        new RegExp(`/admin/people\\?user=${teacher.id}`),
    );
    await expect(
        page.getByRole("heading", {name: teacher.name, exact: true}),
    ).toBeVisible();
    await page.goto("/admin/accounts");
    await page
        .getByLabel("Kontorolle", {exact: true})
        .selectOption("senior_lecturer");
    const email = `account-ui-invite-${suffix}@example.invalid`;
    await page.getByLabel("E-Mail", {exact: true}).fill(email);
    await page
        .getByLabel("Anzeigename", {exact: true})
        .fill(`Invited Lecturer ${suffix}`);
    await page
        .getByRole("button", {name: "Einladung senden", exact: true})
        .click();
    await expect(
        page.getByRole("status").filter({hasText: /Einladung.*versandt/}),
    ).toBeVisible({timeout: 30000});
    const invited = (
        await checked(service.auth.admin.listUsers({perPage: 1000}))
    ).users.find((user) => user.email === email);
    expect(invited).toBeTruthy();
    expect(
        (
            await checked(
                service.from("user_roles").select("role").eq("user_id", invited!.id),
            )
        ).map((row) => row.role),
    ).toEqual(["senior_lecturer"]);
    const lecturerContext = await browser.newContext({
        baseURL: process.env.E2E_BASE_URL!,
        viewport: testInfo.project.use.viewport,
        isMobile: testInfo.project.use.isMobile,
        hasTouch: testInfo.project.use.hasTouch,
    });
    try {
        const lecturerPage = await lecturerContext.newPage();
        await login(lecturerPage, teacher.email);
        await lecturerPage.goto("/admin/accounts");
        await expect(
            lecturerPage.getByText(
                "Für die Kontoverwaltung sind aktuelle Verwaltungsrechte erforderlich.",
                {exact: true},
            ),
        ).toBeVisible();
        await expect(
            lecturerPage.getByText(admin.email, {exact: true}),
        ).toHaveCount(0);
    } finally {
        await lecturerContext.close();
    }
    await page.getByLabel("Sprache", {exact: true}).selectOption("en");
    await expect(
        page.getByRole("heading", {name: "Accounts & access", exact: true}),
    ).toBeVisible();
    await page.getByLabel("Language", {exact: true}).selectOption("de");
    await page.evaluate(() => document.fonts.ready);
    const scan = await new AxeBuilder({page})
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
    expect(
        scan.violations.map((item) => ({
            id: item.id,
            nodes: item.nodes.map((node) => node.target),
        })),
    ).toEqual([]);
    expect(
        await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
        ),
    ).toBe(true);
    await page.screenshot({
        path: `.local/screenshots/${testInfo.project.name}-accounts.png`,
        fullPage: true,
    });
});