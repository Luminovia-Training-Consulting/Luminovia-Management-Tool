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
    // A debounced search can still display other accounts when the action is found.
    const teacherRow = page.getByRole("listitem").filter({
        has: page.getByText(teacher.email, {exact: true}),
    });
    const roleEdit = teacherRow.getByRole("button", {
            name: "Rollen bearbeiten",
            exact: true,
        }),
        deleteAction = teacherRow.getByRole("button", {
            name: `Endgültig löschen: ${teacher.name}`,
            exact: true,
        });
    await expect(roleEdit).toBeVisible();
    await expect(deleteAction).toBeVisible();
    await expect(teacherRow.locator(".public-user-id code")).toHaveText(
        /^LV-[0-9A-F]{4}(?:-[0-9A-F]{4}){4}$/,
    );
    const initialViewport = page.viewportSize();
    for (const width of [390, 768, 1280, 1920]) {
        await page.setViewportSize({width, height: 900});
        const group = teacherRow.locator(".account-list-actions"),
            groupBox = await group.boundingBox(),
            deleteBox = await deleteAction.boundingBox(),
            roleBox = await roleEdit.boundingBox();
        expect(groupBox).not.toBeNull();
        expect(deleteBox).not.toBeNull();
        expect(roleBox).not.toBeNull();
        // Playwright reports x/y/width/height rather than DOMRect.right.
        expect(groupBox!.x + groupBox!.width).toBeLessThanOrEqual(width + 1);
        expect(deleteBox!.x + deleteBox!.width).toBeLessThanOrEqual(width + 1);
        expect(roleBox!.x + roleBox!.width).toBeLessThanOrEqual(width + 1);
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
    const learnerRole = roleDialog.getByLabel("Kursteilnehmer:in", {exact: true});
    await expect(learnerRole).toBeVisible();
    await expect(learnerRole).not.toBeChecked();
    await expect(roleDialog.getByLabel("Gast", {exact: true})).toBeVisible();
    await roleDialog.getByLabel("Senior-Dozent:in", {exact: true}).check();
    await learnerRole.check();
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
        {requireData: true},
    );
    expect(actualRoles.map((row) => row.role).sort()).toEqual([
        "lecturer",
        "participant",
        "senior_lecturer",
    ]);
    await teacherRow.getByRole("button", {name: teacher.name, exact: true}).click();
    const details = page.getByRole("dialog", {name: "Kontodetails", exact: true});
    await expect(details.getByLabel("Anzeigename", {exact: true})).toHaveValue(teacher.name);
    await details.getByRole("button", {name: "Person & Expertise", exact: true}).click();
    await expect(details.getByRole("heading", {name: teacher.name, exact: true})).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/accounts$/);
    await page.keyboard.press("Escape");
    await expect(details).toBeHidden();
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
                {requireData: true},
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

test("administrator combines own roles and delegates company, lecturer and participant access as management", async ({page}) => {
    test.setTimeout(75000);
    const suffix = randomUUID().slice(0, 8);
    const admin = await actor(`Fictional self-admin ${suffix}`, "admin");
    const participant = await actor(`Fictional learner ${suffix}`, "participant");
    const company = {id: randomUUID(), name: `Fictional training company ${suffix}`};
    const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
    await checked(service.from("organisations").insert(company));
    await adminLogin(page, admin);
    await page.goto("/admin/accounts");
    const search = page.getByRole("searchbox", {name: "Konten suchen", exact: true});
    const saveRoles = async (dialogName: string, person: string) => {
        const editor = page.getByRole("dialog", {name: dialogName, exact: true});
        await editor.getByRole("button", {name: "Rollen speichern", exact: true}).click();
        const confirmation = page.getByRole("dialog", {name: `Rollen für ${person} ändern?`, exact: true});
        await confirmation.getByRole("button", {name: "Rollen speichern", exact: true}).click();
        await expect(confirmation).not.toBeVisible();
        await expect(editor).not.toBeVisible();
    };
    await search.fill(admin.email);
    const own = page.getByRole("button", {name: "Meine Rollen", exact: true});
    await own.click();
    const ownEditor = page.getByRole("dialog", {name: "Meine Rollen", exact: true});
    await expect(ownEditor.getByLabel("Administration", {exact: true})).toBeChecked();
    for (const label of ["Management", "Dozent:in", "Kursteilnehmer:in", "Unternehmen"])
        await ownEditor.getByLabel(label, {exact: true}).check();
    await ownEditor.getByLabel("Zugeordnetes Unternehmen", {exact: true}).selectOption(company.id);
    await saveRoles("Meine Rollen", admin.name);

    const rolesOf = async (userId: string) =>
        (await checked(service.from("user_roles").select("role").eq("user_id", userId), {requireData: true}))
            .map(({role}) => role).sort();
    const membersOf = async (userId: string) =>
        (await checked(service.from("client_organisation_memberships").select("organisation_id")
            .eq("user_id", userId).is("removed_at", null), {requireData: true}))
            .map(({organisation_id}) => organisation_id);
    expect(await rolesOf(admin.id)).toEqual(["admin", "client", "lecturer", "management", "participant"]);
    expect(await membersOf(admin.id)).toEqual([company.id]);

    await own.click();
    await ownEditor.getByLabel("Administration", {exact: true}).uncheck();
    await saveRoles("Meine Rollen", admin.name);
    expect(await rolesOf(admin.id)).toEqual(["client", "lecturer", "management", "participant"]);
    await expect(own).toHaveCount(0);

    await search.fill(participant.email);
    const participantCard = page.locator(".account-list > li").filter({
        has: page.getByText(participant.email, {exact: true}),
    });
    await participantCard.getByRole("button", {name: "Rollen bearbeiten", exact: true}).click();
    const otherEditor = page.getByRole("dialog", {name: "Rollen bearbeiten", exact: true});
    await expect(otherEditor.getByLabel("Administration", {exact: true})).toHaveCount(0);
    await expect(otherEditor.getByLabel("Management", {exact: true})).toHaveCount(0);
    await expect(otherEditor.getByLabel("Kursteilnehmer:in", {exact: true})).toBeChecked();
    await otherEditor.getByLabel("Unternehmen", {exact: true}).check();
    await otherEditor.getByLabel("Dozent:in", {exact: true}).check();
    await otherEditor.getByLabel("Zugeordnetes Unternehmen", {exact: true}).selectOption(company.id);
    await saveRoles("Rollen bearbeiten", participant.name);
    expect(await rolesOf(participant.id)).toEqual(["client", "lecturer", "participant"]);
    expect(await membersOf(participant.id)).toEqual([company.id]);
});
