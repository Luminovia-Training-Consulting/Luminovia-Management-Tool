/**
 * Browser workflows for password-only authentication-restricted audit filters and revoked access.
 * Rendered workflows are checked in isolation; this does not replace manual device/platform acceptance.
 */
import {expect, type Page, test} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {randomUUID} from "node:crypto";
import {actor, adminLogin, api, checked, login,} from "./helpers/accounts-support";

test.skip(
    process.env.PORTAL_TEST_MODE !== "1",
    "Audit fixtures require the canonical disposable stack.",
);

/** Checks the current rendered browser state for the selected axe violations. */
async function accessible(page: Page) {
    await page.evaluate(() => document.fonts.ready);
    const result = await new AxeBuilder({page})
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
    expect(
        result.violations.map(({id, nodes}) => ({
            id,
            targets: nodes.map((node) => node.target),
        })),
    ).toEqual([]);
    expect(
        await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
        ),
    ).toBe(true);
}

async function expectAuditNotFound(page: Page, label: string, secret: string) {
    const main = page.getByRole("main");
    await expect(
        main.getByRole("heading", {
            level: 1,
            name: /^(Diese Seite wurde nicht gefunden\.|This page could not be found\.)$/,
        }),
    ).toBeVisible();
    await expect(page).toHaveURL("/admin/audit");
    const overview = main.getByRole("link", {name: /^(Zur Übersicht|Go to overview)$/});
    const help = main.getByRole("link", {name: /^(Hilfe öffnen|Open help)$/});
    await expect(overview).toBeVisible();
    await expect(overview).toHaveAttribute("href", "/");
    await expect(help).toBeVisible();
    await expect(help).toHaveAttribute("href", "/help?topic=troubleshooting");
    await expect(page.getByRole("article", {includeHidden: true})).toHaveCount(0);
    await expect(main).not.toContainText(
        /Verwaltungsprotokoll|Administration log|Das Protokoll erfordert/i,
    );
    await expect(main).not.toContainText(label);
    await expect(page.locator("body")).not.toContainText(secret);
}

test("administrators and management can inspect redacted activity with role-appropriate controls", async ({
                                                                                                                                                          page,
                                                                                                                                                          browser,
                                                                                                                                                          context,
                                                                                                                                                      }, testInfo) => {
    test.setTimeout(120000);
    const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!),
        suffix = randomUUID().slice(0, 8),
        label = `Fictional audit actor ${suffix} <script>literal</script>`,
        secret = `PRIVATE audit detail ${suffix}`,
        administrator = await actor(`Fictional audit admin ${suffix}`, "admin"),
        manager = await actor(`Fictional audit manager ${suffix}`, "management"),
        teacher = await actor(label, "lecturer"),
        ids = Array.from({length: 45}, randomUUID),
        at = new Date(Date.now() - 3600000).toISOString();
    let readerContext: Awaited<ReturnType<typeof browser.newContext>> | undefined;
    let managerContext: Awaited<ReturnType<typeof browser.newContext>> | undefined;
    try {
        await checked(
            service.from("audit_events").insert(
                ids.map((id) => ({
                    id,
                    actor_id: teacher.id,
                    action: "taxonomy.created",
                    resource_id: randomUUID(),
                    created_at: at,
                    details: {notes: secret},
                })),
            ),
        );
        await checked(
            service.from("audit_events").insert(
                [
                    "chat.member_added",
                    "availability.created",
                    "contract.executed_version_registered",
                    "invoice.private_draft_saved",
                    "job.lifecycle.private_unknown",
                ].map((action) => ({
                    actor_id: teacher.id,
                    action,
                    resource_id: randomUUID(),
                    details: {body: secret},
                })),
            ),
        );
        await adminLogin(page, administrator);
        await page.goto("/admin/audit");
        await expect(
            page.getByRole("heading", {
                name: "Verwaltungsprotokoll",
                exact: true,
            }),
        ).toBeVisible();
        await page.getByLabel("Im Protokoll suchen", {exact: true}).fill(suffix);
        await page
            .getByLabel("Aktion", {exact: true})
            .selectOption("taxonomy.created");
        await page
            .getByRole("button", {name: "Filter anwenden", exact: true})
            .click();
        await expect(page.getByRole("article")).toHaveCount(40);
        await expect(page.getByText(label, {exact: true})).toHaveCount(40);
        await expect(page.getByText(secret, {exact: true})).toHaveCount(0);
        expect(
            await page.locator("script").filter({hasText: "literal"}).count(),
        ).toBe(0);
        await page
            .getByRole("button", {name: "Ältere Seite", exact: true})
            .click();
        await expect(page.getByRole("article")).toHaveCount(5);
        await expect(
            page.getByRole("button", {name: "Ältere Seite", exact: true}),
        ).toBeDisabled();
        await page.getByLabel("Sprache", {exact: true}).selectOption("en");
        await expect(
            page.getByLabel("Search audit trail", {exact: true}),
        ).toHaveValue(suffix);
        await expect(
            page.getByRole("heading", {
                name: "Administration log",
                exact: true,
            }),
        ).toBeVisible();
        await page.getByRole("button", {name: "Newer page", exact: true}).click();
        await expect(page.getByRole("article")).toHaveCount(40);
        await page.getByRole("button", {name: "Clear log", exact: true}).click();
        const confirmation = page.getByRole("dialog", {name: "Clear the entire log?"});
        await expect(confirmation.getByRole("button", {name: "Delete all entries", exact: true})).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(confirmation).toHaveCount(0);
        await expect(page.getByRole("article")).toHaveCount(40);
        await page.getByLabel("Theme", {exact: true}).selectOption("dark");
        await accessible(page);
        await page.screenshot({
            path: `.local/screenshots/${testInfo.project.name}-admin-audit.png`,
            fullPage: true,
        });
        managerContext = await browser.newContext();
        const managerPage = await managerContext.newPage();
        await login(managerPage, manager.email);
        await managerPage.goto("/admin/audit");
        await expect(managerPage.getByRole("heading", {name: "Verwaltungsprotokoll", exact: true})).toBeVisible();
        await managerPage.getByLabel("Im Protokoll suchen", {exact: true}).fill(suffix);
        await managerPage.getByLabel("Aktion", {exact: true}).selectOption("taxonomy.created");
        await managerPage.getByRole("button", {name: "Filter anwenden", exact: true}).click();
        await expect(managerPage.getByRole("article")).toHaveCount(40);
        await expect(managerPage.getByRole("button", {name: "Protokoll leeren", exact: true})).toHaveCount(0);
        readerContext = await browser.newContext();
        const reader = await readerContext.newPage();
        await login(reader, teacher.email);
        await reader.goto("/admin/audit");
        await expectAuditNotFound(reader, label, secret);
        await context.setOffline(true);
        await expect(
            page.getByRole("button", {name: "Apply filters", exact: true}),
        ).toBeDisabled();
        await expect(
            page.getByRole("button", {name: "Refresh", exact: true}),
        ).toBeDisabled();
        await context.setOffline(false);
        await checked(
            service.from("user_roles").delete().eq("user_id", administrator.id),
        );
        await page.getByRole("button", {name: "Refresh", exact: true}).click();
        await expect(page.getByText(label, {exact: true})).toHaveCount(0);
        await expect(page.getByRole("alert")).toBeVisible();
        // Restore portal access as a lecturer without restoring audit access.
        await checked(
            service.from("user_roles").insert({
                user_id: administrator.id,
                role: "lecturer",
            }),
        );
        await page.reload();
        await expectAuditNotFound(page, label, secret);
    } finally {
        await context.setOffline(false);
        await readerContext?.close();
        await managerContext?.close();
        for (const user of [administrator, manager, teacher]) {
            await checked(
                service.from("audit_events").delete().eq("actor_id", user.id),
            );
            await checked(service.auth.admin.deleteUser(user.id));
        }
    }
});
