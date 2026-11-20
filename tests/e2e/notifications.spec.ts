/**
 * Browser workflows for the actor's own inbox and persisted DE/EN preferences.
 * Rendered workflows are checked in isolation; this does not replace manual device/platform acceptance.
 */
import {expect, test} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {randomUUID} from "node:crypto";
import {actor, api, checked, login} from "./helpers/accounts-support";

test("personal inbox, safe bulk read and DE/EN notification preferences persist", async ({
                                                                                             page,
                                                                                         }, testInfo) => {
    test.setTimeout(90000);
    const owner = await actor("Fictional inbox lecturer", "lecturer");
    const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const reader = api(process.env.SUPABASE_ANON_KEY!);
    try {
        await checked(
            reader.auth.signInWithPassword({
                email: owner.email,
                password: process.env.E2E_PASSWORD!,
            }),
        );
        const notes = Array.from({length: 45}, () => ({
            user_id: owner.id,
            kind: "activity",
            resource_id: randomUUID(),
        }));
        await checked(service.from("notifications").insert(notes));
        await login(page, owner.email);
        await page.goto("/notifications");
        await expect(page.locator(".inbox-toolbar").getByRole("status")).toHaveText(
            "45 ungelesen",
        );
        await expect(page.locator(".inbox-list>.notification-row")).toHaveCount(40);
        await page
            .getByRole("button", {name: "Weitere Meldungen laden", exact: true})
            .click();
        await expect(page.locator(".inbox-list>.notification-row")).toHaveCount(45);
        await page
            .getByRole("button", {
                name: "Alle bisher eingegangenen Meldungen lesen",
                exact: true,
            })
            .click();
        await expect(page.locator(".inbox-toolbar").getByRole("status")).toHaveText(
            "0 ungelesen",
        );
        await page
            .getByRole("combobox", {name: "Benachrichtigungen", exact: true})
            .selectOption("unread");
        await expect(
            page.getByText("Hier gibt es gerade keine Meldungen.", {exact: true}),
        ).toBeVisible();
        await page
            .getByRole("link", {name: "Benachrichtigungen einstellen", exact: true})
            .click();
        // This category form and the independent email/attention forms coexist on
        // Settings. Follow its exact DE/EN fieldset identity through locale/reload.
        const categorySettings = page.locator("form").filter({
            has: page.getByRole("group", {
                name: /^(Benachrichtigungen|Notifications)$/,
            }),
        });
        const chat = categorySettings.getByRole("checkbox", {
            name: "Neue Chatnachrichten",
            exact: true,
        });
        await expect(chat).toBeChecked();
        await chat.uncheck();
        await page
            .locator(".settings-section .preferences select[aria-label='Sprache']")
            .selectOption("en");
        await expect(
            categorySettings.getByRole("checkbox", {
                name: "New chat messages",
                exact: true,
            }),
        ).not.toBeChecked();
        await categorySettings
            .getByRole("button", {name: "Save", exact: true})
            .click();
        await expect(
            categorySettings.getByText("Preferences saved.", {exact: true}),
        ).toBeVisible();
        await page.reload();
        await expect(
            categorySettings.getByRole("checkbox", {
                name: "New chat messages",
                exact: true,
            }),
        ).not.toBeChecked();
        expect((await checked(reader.rpc("notification_preferences"))).chat).toBe(
            false,
        );
        await page
            .locator(".settings-section .preferences select[aria-label='Theme']")
            .selectOption("dark");
        await page.evaluate(() => document.fonts.ready);
        expect(
            (
                await new AxeBuilder({page})
                    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
                    .analyze()
            ).violations,
        ).toEqual([]);
        expect(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth,
            ),
        ).toBe(true);
        await page.screenshot({
            path: testInfo.outputPath("notification-settings.png"),
            fullPage: true,
        });
        await page.goto("/notifications");
        await page
            .getByRole("button", {name: "Check due reminders", exact: true})
            .click();
        await expect(
            page.getByText("Reminders checked.", {exact: true}),
        ).toBeVisible();
        await page.context().setOffline(true);
        await expect(
            page.getByRole("button", {name: "Check due reminders", exact: true}),
        ).toBeDisabled();
        await page.context().setOffline(false);
    } finally {
        await page.context().setOffline(false);
        await reader.auth.signOut();
        await checked(
            service.from("notifications").delete().eq("user_id", owner.id),
        );
        await checked(
            service.from("audit_events").delete().eq("actor_id", owner.id),
        );
        await checked(service.auth.admin.deleteUser(owner.id));
    }
});

test("email channel and IANA quiet hours persist across language, reload and offline edits", async ({
                                                                                                        page,
                                                                                                    }, testInfo) => {
    test.setTimeout(90000);
    const owner = await actor(
        "Fictional email notification lecturer",
        "lecturer",
    );
    const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const reader = api(process.env.SUPABASE_ANON_KEY!);
    try {
        await checked(
            reader.auth.signInWithPassword({
                email: owner.email,
                password: process.env.E2E_PASSWORD!,
            }),
        );
        await login(page, owner.email);
        await page.goto("/settings");
        const delivery = page
            .locator("details.settings-section")
            .filter({hasText: /Ruhezeiten & Zustellung|Quiet hours & delivery/});
        await delivery.locator("summary").click();
        await expect(delivery).toHaveJSProperty("open", true);
        // The form owning the named email fieldset includes its save button and
        // confirmation; in-app attention quiet hours are a separate region.
        const emailSettings = page.locator("form").filter({
            has: page.getByRole("group", {
                name: /^(E-Mail-Benachrichtigungen|Email notifications)$/,
            }),
        });
        const email = emailSettings.getByRole("checkbox", {
            name: "Zusätzliche Hinweise per E-Mail erhalten",
            exact: true,
        });
        await email.check();
        await emailSettings
            .getByRole("checkbox", {
                name: "Ruhezeiten für E-Mails verwenden",
                exact: true,
            })
            .check();
        await emailSettings
            .getByLabel("Ruhezeit von", {exact: true})
            .fill("23:15");
        await emailSettings
            .getByLabel("Ruhezeit bis", {exact: true})
            .fill("06:45");
        await emailSettings
            .getByLabel("Zeitzone der Ruhezeiten", {exact: true})
            .fill("Australia/Brisbane");
        await page
            .locator(".settings-section .preferences select[aria-label='Sprache']")
            .selectOption("en");
        await expect(
            emailSettings.getByRole("checkbox", {
                name: "Receive additional alerts by email",
                exact: true,
            }),
        ).toBeChecked();
        await expect(
            emailSettings.getByLabel("Quiet hours from", {exact: true}),
        ).toHaveValue("23:15");
        await emailSettings
            .getByRole("button", {name: "Save email preferences", exact: true})
            .click();
        await expect(
            emailSettings.getByText("Email preferences saved.", {exact: true}),
        ).toBeVisible();
        const saved = await checked(reader.rpc("delivery_preferences"));
        expect(saved).toEqual({
            email_enabled: true,
            quiet_start: "23:15",
            quiet_end: "06:45",
            time_zone: "Australia/Brisbane",
            version: 2,
        });
        await page.reload();
        // Browsers may restore a <details> disclosure's prior state across reload.
        // Ensure it is open instead of blindly toggling it closed.
        if (
            !(await delivery.evaluate(
                (element) => (element as HTMLDetailsElement).open,
            ))
        ) {
            await delivery.locator("summary").click();
        }
        await expect(delivery).toHaveJSProperty("open", true);
        await expect(
            emailSettings.getByRole("checkbox", {
                name: "Receive additional alerts by email",
                exact: true,
            }),
        ).toBeChecked();
        await expect(
            emailSettings.getByLabel("Quiet hours from", {exact: true}),
        ).toHaveValue("23:15");
        await expect(
            emailSettings.getByLabel("Quiet hours until", {exact: true}),
        ).toHaveValue("06:45");
        await expect(
            emailSettings.getByLabel("Quiet hours time zone", {exact: true}),
        ).toHaveValue("Australia/Brisbane");
        await page.screenshot({
            path: testInfo.outputPath("email-quiet-hours.png"),
            fullPage: true,
        });
        await page.context().setOffline(true);
        await emailSettings
            .getByRole("checkbox", {
                name: "Receive additional alerts by email",
                exact: true,
            })
            .uncheck();
        await expect(
            emailSettings.getByRole("button", {
                name: "Save email preferences",
                exact: true,
            }),
        ).toBeDisabled();
        expect(
            (await checked(reader.rpc("delivery_preferences"))).email_enabled,
        ).toBe(true);
        await page.context().setOffline(false);
        await expect(
            emailSettings.getByRole("button", {
                name: "Save email preferences",
                exact: true,
            }),
        ).toBeEnabled();
        await emailSettings
            .getByRole("button", {name: "Save email preferences", exact: true})
            .click();
        await expect(
            emailSettings.getByText("Email preferences saved.", {exact: true}),
        ).toBeVisible();
        expect(
            (await checked(reader.rpc("delivery_preferences"))).email_enabled,
        ).toBe(false);
        await page.reload();
        if (
            !(await delivery.evaluate(
                (element) => (element as HTMLDetailsElement).open,
            ))
        ) {
            await delivery.locator("summary").click();
        }
        await expect(delivery).toHaveJSProperty("open", true);
        await expect
            .poll(
                async () =>
                    (await checked(reader.rpc("delivery_preferences"))).email_enabled,
            )
            .toBe(false);
        await expect(
            emailSettings.getByRole("checkbox", {
                name: "Receive additional alerts by email",
                exact: true,
            }),
        ).not.toBeChecked();
    } finally {
        await page.context().setOffline(false);
        await reader.auth.signOut();
        await checked(
            service.from("notifications").delete().eq("user_id", owner.id),
        );
        await checked(
            service.from("audit_events").delete().eq("actor_id", owner.id),
        );
        await checked(service.auth.admin.deleteUser(owner.id));
    }
});