import {expect, test} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {randomUUID} from "node:crypto";
import {actor, adminLogin, api, checked} from "./helpers/accounts-support";

test.skip(
    process.env.PORTAL_TEST_MODE !== "1",
    "Delegated roles require the isolated ./portal test project.",
);

test("management assigns only subordinate roles while only administration sees and confirms private policy", async ({
                                                                                                                        page,
                                                                                                                    }, testInfo) => {
    test.setTimeout(120000);
    const suffix = randomUUID().slice(0, 8);
    const manager = await actor(`Delegated Manager ${suffix}`, "management");
    const peer = await actor(`Peer Manager ${suffix}`, "management");
    const admin = await actor(`Policy Admin ${suffix}`, "admin");
    const teacher = await actor(`Delegated Teacher ${suffix}`, "lecturer");
    // Bind actions to the exact account row while search refreshes the page.
    const accountRow = (email: string) => page.locator(".account-list").getByRole("listitem").filter({
        has: page.getByText(email, {exact: true}),
    });
    const teacherRoles = accountRow(teacher.email).getByRole("button", {
        name: "Rollen bearbeiten", exact: true,
    });
    const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const orgRequests: string[] = [];
    page.on("request", (request) => {
        if (
            /\/rest\/v1\/(?:organisations|client_organisation_memberships)(?:\?|$)/.test(
                request.url(),
            )
        )
            orgRequests.push(request.url());
    });
    try {
        await adminLogin(page, manager);
        await page.goto("/admin/accounts");
        await expect(
            page.getByRole("heading", {name: "Konten & Zugänge", exact: true}),
        ).toBeVisible();
        const search = page.getByRole("searchbox", {
            name: "Konten suchen",
            exact: true,
        });
        for (const protectedAccount of [manager, peer, admin]) {
            await search.fill(protectedAccount.name);
            const row = accountRow(protectedAccount.email);
            await expect(
                row,
            ).toBeVisible();
            await expect(
                row.getByRole("button", {
                    name: "Rollen bearbeiten",
                    exact: true,
                }),
            ).toHaveCount(0);
        }
        await search.fill(teacher.name);
        await teacherRoles.click();
        const roles = page.getByRole("dialog", {
            name: "Rollen bearbeiten",
            exact: true,
        });
        await expect(
            roles.getByRole("checkbox", {name: "Administration", exact: true}),
        ).toHaveCount(0);
        await expect(
            roles.getByRole("checkbox", {name: "Management", exact: true}),
        ).toHaveCount(0);
        await expect(
            roles.getByRole("checkbox", {
                name: "Inhaberin / Plattformleitung",
                exact: true,
            }),
        ).toHaveCount(0);
        await roles
            .getByRole("checkbox", {name: "Senior-Dozent:in", exact: true})
            .check();
        await roles.getByRole("checkbox", {name: "Gast", exact: true}).check();
        await roles
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
            page
                .getByRole("status")
                .filter({hasText: "Rollen wurden gespeichert."}),
        ).toBeVisible();
        const committed = await checked(
            service.from("user_roles").select("role").eq("user_id", teacher.id),
            {requireData: true},
        );
        expect(committed.map((row) => row.role).sort()).toEqual([
            "guest",
            "lecturer",
            "senior_lecturer",
        ]);
        await page.getByLabel("Kontorolle", {exact: true}).selectOption("client");
        await expect(
            page.getByLabel("Unternehmen", {exact: true}),
        ).toHaveCount(0);
        await expect(
            page.getByRole("button", {name: "Organisation zuordnen", exact: true}),
        ).toHaveCount(0);
        expect(orgRequests).toEqual([]);
        const managerApi = api(process.env.SUPABASE_ANON_KEY!);
        await checked(
            managerApi.auth.signInWithPassword({
                email: manager.email,
                password: process.env.E2E_PASSWORD!,
            }),
        );
        const reduced = await checked(managerApi.rpc("commission_access"));
        expect(reduced.can_manage_gross).toBe(false);
        expect(reduced.can_manage_client_memberships).toBe(true);
        expect("regular_lecturer_percent" in reduced).toBe(false);
        expect("senior_lecturer_percent" in reduced).toBe(false);
        expect("policy_version" in reduced).toBe(false);
        expect((await managerApi.rpc("lecturer_compensation", {
            p_user_id: teacher.id,
        })).error?.code).toBe("42501");
        await page.goto("/admin/operations");
        await expect(
            page.getByRole("heading", {
                name: "Kurse & Aufträge verwalten",
                exact: true,
            }),
        ).toBeVisible();
        await expect(
            page.getByRole("region", {name: "Vergütungsregeln", exact: true}),
        ).toHaveCount(0);
        await page.goto("/admin/accounts");
        await page
            .getByRole("combobox", {name: "Sprache", exact: true})
            .selectOption("en");
        await expect(
            page.getByRole("heading", {name: "Accounts & access", exact: true}),
        ).toBeVisible();
        const managerScan = await new AxeBuilder({page})
            .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
            .analyze();
        expect(managerScan.violations).toEqual([]);
        await testInfo.attach("delegated-manager-accounts", {
            body: await page.screenshot({fullPage: true}),
            contentType: "image/png",
        });
        await page
            .getByRole("combobox", {name: "Language", exact: true})
            .selectOption("de");
        await page.getByRole("button", {name: "Abmelden", exact: true}).click();
        await expect(page).toHaveURL(/\/login$/);
        await adminLogin(page, admin);
        const adminApi = api(process.env.SUPABASE_ANON_KEY!);
        await checked(adminApi.auth.signInWithPassword({
            email: admin.email,
            password: process.env.E2E_PASSWORD!,
        }), {requireData: true});
        const policy = await checked(adminApi.rpc("commission_access"), {requireData: true});
        expect(policy.can_manage_gross).toBe(true);
        expect(typeof policy.senior_lecturer_percent).toBe("number");
        const customPercent = policy.senior_lecturer_percent === 31 ? 32 : 31;
        await page.goto("/admin/accounts");
        await page
            .getByRole("searchbox", {name: "Konten suchen", exact: true})
            .fill(teacher.name);
        await teacherRoles.click();
        const compensation = page
            .getByRole("heading", {name: "Dozentenhonorar", exact: true})
            .locator("..");
        const percentage = compensation.getByLabel("Anteil am Unternehmensbudget (%)", {
            exact: true,
        });
        await expect(percentage).toHaveValue(String(policy.senior_lecturer_percent));
        await percentage.fill(String(customPercent));
        await compensation
            .getByRole("button", {name: "Honorar speichern", exact: true})
            .click();
        await expect(compensation.getByRole("status")).toHaveText(
            "Honorar gespeichert.",
        );
        expect(await checked(adminApi.rpc("lecturer_compensation", {
            p_user_id: teacher.id,
        }), {requireData: true})).toMatchObject({
            percent: customPercent, is_customized: true,
        });
        await page.reload();
        await page.goto("/admin/accounts");
        await page
            .getByRole("searchbox", {name: "Konten suchen", exact: true})
            .fill(teacher.name);
        await teacherRoles.click();
        const reloadedCompensation = page
            .getByRole("heading", {name: "Dozentenhonorar", exact: true})
            .locator("..");
        await expect(
            reloadedCompensation.getByLabel("Anteil am Unternehmensbudget (%)", {
                exact: true,
            }),
        ).toHaveValue(String(customPercent));
        const policyScan = await new AxeBuilder({page})
            .include(".account-roles")
            .analyze();
        expect(policyScan.violations).toEqual([]);
        await testInfo.attach("administration-private-lecturer-compensation", {
            body: await page.screenshot({fullPage: true}),
            contentType: "image/png",
        });
    } finally {
        const ids = [manager.id, peer.id, admin.id, teacher.id];
        await checked(service.from("audit_events").delete().in("actor_id", ids));
        // The confirmed policy retains its administrator provenance FK. Its fictional
        // author is intentionally retained until the owned disposable stack cleanup.
        for (const id of [manager.id, peer.id, teacher.id])
            await checked(service.auth.admin.deleteUser(id));
    }
});
