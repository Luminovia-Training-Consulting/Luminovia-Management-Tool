/** Real isolated support lifecycle: wait for each committed action to close its dialog,
 * then inspect persisted conversation/history content rather than the draft field.
 * Separate Auth sessions retain internal-note and foreign-account denial checks.
 */
import {expect, type Page, test} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {withApiFixture} from "../../scripts/testing/api.mjs";
import {adminLogin, login} from "./helpers/accounts-support";

async function accessible(page: Page) {
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
}

test("own support lifecycle, restricted management note, reasoned reopening and foreign account denial", async ({
                                                                                                                    page,
                                                                                                                    browser,
                                                                                                                    context,
                                                                                                                }, testInfo) => {
    test.setTimeout(120000);
    await withApiFixture(async ({actor, sql, defer, suffix}) => {
        const requester = await actor("support-browser-owner", "lecturer"),
            peer = await actor("support-browser-peer", "lecturer"),
            manager = await actor("support-browser-manager", "management");
        const users = [requester.id, peer.id, manager.id];
        defer(async () => {
            const ids = users.map((id) => `'${id}'`).join(",");
            await sql(
                `delete from public.notifications where resource_id in(select id from private.support_tickets where requester_id in(${ids}));delete from private.support_requests where actor_id in(${ids}) or ticket_id in(select id from private.support_tickets where requester_id in(${ids}));delete from private.support_events where ticket_id in(select id from private.support_tickets where requester_id in(${ids}));delete from private.support_messages where ticket_id in(select id from private.support_tickets where requester_id in(${ids}));delete from private.support_tickets where requester_id in(${ids});`,
            );
        });
        const title = `Fictional support journey ${suffix}`;
        let staffContext:
                Awaited<ReturnType<typeof browser.newContext>> | undefined,
            peerContext: Awaited<ReturnType<typeof browser.newContext>> | undefined;
        try {
            await login(page, requester.email);
            await page.goto("/support");
            await expect(page.getByText("Hier sind noch keine Supporttickets.", {exact: true})).toBeVisible();
            const search = page.getByRole("searchbox", {name: "Betreff und Beschreibung durchsuchen", exact: true});
            await search.fill("Fictional missing ticket");
            await page.getByRole("button", {name: "Filter anwenden", exact: true}).click();
            await expect(page.getByText("Keine Tickets passen zu deiner Suche.", {exact: true})).toBeVisible();
            await page.getByRole("button", {name: "Filter zurücksetzen", exact: true}).click();
            await expect(search).toHaveValue("");
            await page
                .getByRole("button", {name: "Supportticket erstellen", exact: true})
                .click();
            const create = page.getByRole("dialog");
            await create.getByLabel("Betreff", {exact: true}).fill(title);
            await create
                .getByLabel("Problem und erwartetes Ergebnis", {exact: true})
                .fill("Expected the fictional course page to load.");
            await create
                .getByRole("button", {name: "Ticket absenden", exact: true})
                .click();
            await expect(create).not.toBeVisible();
            await expect(
                page.getByRole("heading", {name: title, exact: true}),
            ).toBeVisible();
            const path = new URL(page.url()).pathname;
            await page.locator('input[type="file"][aria-label="Datei auswählen"]').setInputFiles({
                name: "fictional-trace.txt",
                mimeType: "text/plain",
                buffer: Buffer.from("Fictional support trace"),
            });
            await expect(page.getByText("fictional-trace.txt", {exact: true})).toBeVisible();
            await expect(page.getByText("Sichtbar für die anfragende Person und berechtigtes Supportpersonal", {exact: true})).toBeVisible();
            await page
                .getByRole("button", {name: "Antwort senden", exact: true})
                .click();
            await page
                .getByRole("dialog")
                .getByLabel("Nachricht", {exact: true})
                .fill("Fictional reproduction supplied.");
            await page
                .getByRole("dialog")
                .getByRole("button", {name: "Antwort senden", exact: true})
                .click();
            // Refetch can render the committed reply before the submitting dialog closes.
            // A page-wide text match also selects the textarea during that interval.
            await expect(page.getByRole("dialog")).not.toBeVisible();
            await expect(
                page
                    .locator(".support-thread")
                    .getByText("Fictional reproduction supplied.", {exact: true}),
            ).toBeVisible();
            // The confirmed reply advances the ticket version without submitting the selected file.
            await expect(page.getByText("fictional-trace.txt", {exact: true})).toBeVisible();
            await page.getByRole("button", {name: "Dateiauswahl entfernen", exact: true}).click();
            await expect(page.getByText("fictional-trace.txt", {exact: true})).toHaveCount(0);
            staffContext = await browser.newContext();
            const staff = await staffContext.newPage();
            await adminLogin(staff, manager);
            await staff.goto(path);
            await staff
                .getByRole("button", {name: "Interne Notiz speichern", exact: true})
                .click();
            await staff
                .getByRole("dialog")
                .getByLabel("Nachricht", {exact: true})
                .fill("RESTRICTED fictional staff analysis.");
            await staff
                .getByRole("dialog")
                .getByRole("button", {name: "Interne Notiz speichern", exact: true})
                .click();
            await expect(staff.getByRole("dialog")).not.toBeVisible();
            await expect(
                staff
                    .locator(".support-thread")
                    .getByText("RESTRICTED fictional staff analysis.", {
                        exact: true,
                    }),
            ).toBeVisible();
            await page
                .getByRole("button", {
                    name: "Bestätigten Stand neu laden",
                    exact: true,
                })
                .click();
            await expect(
                page.getByText("RESTRICTED fictional staff analysis.", {exact: true}),
            ).toHaveCount(0);
            await expect(
                page.getByRole("button", {
                    name: "Interne Notiz speichern",
                    exact: true,
                }),
            ).toHaveCount(0);
            for (const status of [
                "in_progress",
                "waiting_for_user",
                "resolved",
                "closed",
            ]) {
                await staff
                    .getByRole("button", {name: "Status ändern", exact: true})
                    .click();
                const dialog = staff.getByRole("dialog");
                await dialog.getByLabel("Status", {exact: true}).selectOption(status);
                await dialog
                    .getByLabel("Begründung", {exact: true})
                    .fill(`Fictional ${status} reason`);
                await dialog
                    .getByRole("button", {name: "Speichern", exact: true})
                    .click();
                await expect(dialog).not.toBeVisible();
            }
            await page
                .getByRole("button", {
                    name: "Bestätigten Stand neu laden",
                    exact: true,
                })
                .click();
            await page
                .getByRole("button", {name: "Ticket wieder öffnen", exact: true})
                .click();
            await page
                .getByRole("dialog")
                .getByLabel("Begründung", {exact: true})
                .fill("A fictional regression remains.");
            await page
                .getByRole("dialog")
                .getByRole("button", {name: "Speichern", exact: true})
                .click();
            await expect(page.getByRole("dialog")).not.toBeVisible();
            await expect(
                page
                    .locator(".support-history")
                    .getByText("A fictional regression remains.", {exact: true}),
            ).toBeVisible();
            await page.getByLabel("Sprache", {exact: true}).selectOption("en");
            await page.getByLabel("Theme", {exact: true}).selectOption("dark");
            await accessible(page);
            await page.screenshot({
                path: testInfo.outputPath("support-dark-en.png"),
                fullPage: true,
            });
            await context.setOffline(true);
            await expect(
                page.getByRole("button", {name: "Send reply", exact: true}),
            ).toBeDisabled();
            await context.setOffline(false);
            peerContext = await browser.newContext();
            const outsider = await peerContext.newPage();
            await login(outsider, peer.email);
            await outsider.goto(path);
            await expect(outsider.getByRole("alert")).toContainText("keinen Zugriff");
            await expect(
                outsider.getByRole("heading", {name: title, exact: true}),
            ).toHaveCount(0);
        } finally {
            await context.setOffline(false);
            await staffContext?.close();
            await peerContext?.close();
        }
    });
});