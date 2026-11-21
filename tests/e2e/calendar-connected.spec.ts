import {expect, test} from "@playwright/test";
import {randomUUID} from "node:crypto";
import {actor, api, checked, login} from "./helpers/accounts-support";

/** Exercise responsive native disclosures and real subscription/offline actions with disposable fictional records. */
test("calendar secret links and explicit minimal offline schedule survive reload and clear on logout", async ({
                                                                                                                  page,
                                                                                                              }) => {
    const owner = await actor(
            "Fictional connected calendar lecturer",
            "lecturer",
        ),
        service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const job = randomUUID(),
        organisation = randomUUID(),
        template = randomUUID(),
        run = randomUUID(),
        claim = randomUUID(),
        assignment = randomUUID(),
        privateEvent = randomUUID();
    const starts = new Date(Date.now() + 2 * 86400000).toISOString(),
        ends = new Date(Date.now() + 2 * 86400000 + 3600000).toISOString();
    try {
        await checked(
            service.from("organisations").insert({
                id: organisation,
                name: "Fictional calendar customer",
            }),
        );
        // Customer provenance is attached to the actual course run.
        await checked(service.from("course_templates").insert({
            id: template, title: "Fictional calendar curriculum",
        }));
        await checked(service.from("course_runs").insert({
            id: run, template_id: template, organisation_id: organisation,
        }));
        await checked(
            service.from("jobs").insert({
                id: job,
                course_run_id: run,
                title: "Fictional offline teaching",
                customer_name: "PRIVATE CUSTOMER",
                delivery_type: "online",
                status: "filled",
                location: "https://private.invalid/class",
                amount: 321,
                currency: "EUR",
                rate_unit: "fixed_total",
                total_amount: 321,
                terms: "PRIVATE COMMERCIAL TERMS",
            }),
        );
        await checked(
            service.from("job_claims").insert({
                id: claim,
                job_id: job,
                lecturer_id: owner.id,
                idempotency_key: randomUUID(),
                amount: 321,
                currency: "EUR",
                rate_unit: "fixed_total",
                total_amount: 321,
                terms: "PRIVATE COMMERCIAL TERMS",
                terms_version: 1,
            }),
        );
        await checked(
            service.from("assignment_sessions").insert({
                id: assignment,
                claim_id: claim,
                lecturer_id: owner.id,
                starts_at: starts,
                ends_at: ends,
            }),
        );
        await checked(
            service.from("personal_events").insert({
                id: privateEvent,
                user_id: owner.id,
                title: "PRIVATE APPOINTMENT",
                starts_at: starts,
                ends_at: ends,
                time_zone: "Europe/Berlin",
            }),
        );
        await login(page, owner.email);
        await page.goto(`/calendar?assignment=${job}`);
        const views = page.getByRole("group", {
            name: "Kalenderansicht",
            exact: true,
        });
        await views.getByRole("button", {name: "Monat", exact: true}).click();
        await page.getByText("Kalenderfarben", {exact: true}).click();
        await page
            .getByLabel("Eigene private Termine", {exact: true})
            .selectOption("#E6E0F0");
        await page
            .getByLabel("Kundenerstellte Kurse und Aufträge", {exact: true})
            .selectOption("#F5DDE7");
        await page
            .getByRole("button", {name: "Kalenderfarben speichern", exact: true})
            .click();
        await expect(
            page.getByText("Deine Kalenderfarben wurden gespeichert.", {
                exact: true,
            }),
        ).toBeVisible();
        await expect(
            page
                .locator(".fc-event")
                .filter({hasText: "PRIVATE APPOINTMENT"})
                .first(),
        ).toHaveCSS("background-color", "rgb(230, 224, 240)");
        await expect(
            page
                .locator(".fc-event")
                .filter({hasText: "Fictional offline teaching"})
                .first(),
        ).toHaveCSS("background-color", "rgb(245, 221, 231)");
        await views.getByRole("button", {name: "Termine", exact: true}).click();
        for (const [title, colour] of [
            ["PRIVATE APPOINTMENT", "rgb(230, 224, 240)"],
            ["Fictional offline teaching", "rgb(245, 221, 231)"],
        ]) {
            await expect(
                page.locator(".fc-list-event")
                    .filter({hasText: title})
                    .locator(".fc-list-event-dot")
                    .first(),
            ).toHaveCSS("border-top-color", colour);
        }
        await page.reload();
        await page.getByText("Kalenderfarben", {exact: true}).click();
        await expect(
            page.getByLabel("Eigene private Termine", {exact: true}),
        ).toHaveValue("#E6E0F0");
        await expect(
            page.getByLabel("Kundenerstellte Kurse und Aufträge", {exact: true}),
        ).toHaveValue("#F5DDE7");
        await page.getByText("Kalenderfarben", {exact: true}).click();
        const tools = page.locator(".calendar-tools"),
            toolSummary = tools.locator(":scope > summary");
        await toolSummary.focus();
        await page.keyboard.press("Enter");
        await expect(toolSummary).toBeFocused();
        await expect(tools).toHaveAttribute("open", "");
        expect(
            await toolSummary.evaluate((summary) =>
                summary.matches(":focus-visible"),
            ),
        ).toBe(true);
        for (const width of [390, 768, 1280, 1920]) {
            await page.setViewportSize({width, height: 900});
            const group = await tools.boundingBox(),
                calendar = await page.locator(".calendar-controls").boundingBox(),
                panels = await page
                    .locator(".calendar-tools-content > details")
                    .evaluateAll((elements) =>
                        elements.map((element) => {
                            const {x, right, y, bottom} = element.getBoundingClientRect();
                            return {x, right, y, bottom};
                        }),
                    );
            expect(group).not.toBeNull();
            expect(calendar).not.toBeNull();
            expect(panels).toHaveLength(4);
            expect(group!.bottom).toBeLessThanOrEqual(calendar!.y + 1);
            expect(group!.right).toBeLessThanOrEqual(width + 1);
            for (const [index, panel] of panels.entries()) {
                expect(panel.x).toBeGreaterThanOrEqual(0);
                expect(panel.right).toBeLessThanOrEqual(width + 1);
                if (index > 0)
                    expect(panels[index - 1]!.bottom).toBeLessThanOrEqual(panel.y + 1);
            }
        }
        await page.getByText("Kalender abonnieren", {exact: true}).click();
        await page
            .getByRole("button", {name: "Kalenderadresse erstellen", exact: true})
            .click();
        const dialog = page.getByRole("dialog");
        await dialog
            .getByLabel("Name des Kalenderabos", {exact: true})
            .fill("Fictional Google calendar");
        await expect(
            dialog.getByRole("checkbox", {
                name: "Auch meine privaten Termine ausdrücklich freigeben",
                exact: true,
            }),
        ).not.toBeChecked();
        await dialog
            .getByRole("button", {
                name: "Neue geheime Adresse bestätigen",
                exact: true,
            })
            .click();
        const address = page.getByLabel("Geheime Kalenderadresse", {exact: true});
        await expect(address).toHaveAttribute("type", "password");
        expect(
            (await address.inputValue()).includes(
                "/functions/v1/calendar-feed?token=",
            ),
        ).toBe(true);
        await page.reload();
        await page.getByText("Kalenderfunktionen", {exact: true}).click();
        await page.getByText("Kalender abonnieren", {exact: true}).click();
        await expect(
            page.getByText("Fictional Google calendar", {exact: true}),
        ).toBeVisible();
        await expect(
            page.getByLabel("Geheime Kalenderadresse", {exact: true}),
        ).toHaveCount(0);
        await page
            .getByRole("button", {name: "Adresse widerrufen", exact: true})
            .click();
        await expect(page.getByText("Widerrufen", {exact: true})).toBeVisible();
        await page
            .getByText("Unterrichtsplan offline bereithalten", {exact: true})
            .click();
        await page
            .getByRole("button", {
                name: "Unterrichtsplan für offline speichern",
                exact: true,
            })
            .click();
        await expect(
            page.getByText("Die reduzierte Offline-Vorschau wurde gespeichert.", {
                exact: true,
            }),
        ).toBeVisible();
        const readSnapshot = () =>
            page.evaluate(
                () =>
                    new Promise<unknown>((resolve, reject) => {
                        const open = indexedDB.open("luminovia-offline-schedule", 1);
                        open.onerror = reject;
                        open.onsuccess = () => {
                            const database = open.result,
                                request = database
                                    .transaction("snapshot")
                                    .objectStore("snapshot")
                                    .get("current");
                            request.onsuccess = () => {
                                database.close();
                                resolve(request.result);
                            };
                        };
                    }),
            );
        const snapshot = (await readSnapshot()) as { items: { title: string }[] };
        expect(snapshot.items[0].title).toBe("Fictional offline teaching");
        expect(JSON.stringify(snapshot)).not.toContain("PRIVATE");
        expect(JSON.stringify(snapshot)).not.toContain("https://");
        await page.context().setOffline(true);
        await expect(
            page.getByRole("button", {
                name: "Unterrichtsplan für offline speichern",
                exact: true,
            }),
        ).toBeDisabled();
        await expect(
            page.getByText(/Gespeicherte Vorschau: Änderungen und Absagen/),
        ).toBeVisible();
        await page.context().setOffline(false);
        await page.getByRole("button", {name: "Abmelden", exact: true}).click();
        await expect(page).toHaveURL(/\/login$/);
        await expect.poll(async () => Boolean(await readSnapshot())).toBe(false);
    } finally {
        await page.context().setOffline(false);
        await checked(
            service.from("notifications").delete().eq("user_id", owner.id),
        );
        await checked(
            service.from("personal_events").delete().eq("id", privateEvent),
        );
        await checked(
            service.from("assignment_sessions").delete().eq("id", assignment),
        );
        await checked(service.from("job_claims").delete().eq("id", claim));
        await checked(service.from("jobs").delete().eq("id", job));
        await checked(service.from("course_runs").delete().eq("id", run));
        await checked(service.from("course_templates").delete().eq("id", template));
        await checked(
            service.from("organisations").delete().eq("id", organisation),
        );
        await checked(
            service.from("audit_events").delete().eq("actor_id", owner.id),
        );
        await checked(service.auth.admin.deleteUser(owner.id));
    }
});
