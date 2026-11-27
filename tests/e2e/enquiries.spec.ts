/** Real password-only authentication management UI for a fictional server-received enquiry; no public Website or email mutation. */
import {expect, type Page, test} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {randomUUID} from "node:crypto";
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

test("private incoming enquiry triage, explicit customer creation and course planning preserve original input", async ({
                                                                                                                           page,
                                                                                                                           browser,
                                                                                                                           context,
                                                                                                                       }, testInfo) => {
    test.setTimeout(120000);
    await withApiFixture(
        async ({service, actor, checked, sql, defer, suffix}) => {
            const manager = await actor("enquiry-browser-manager", "management"),
                outsider = await actor("enquiry-browser-outsider", "lecturer");
            const payload = {
                company_name: `Fictional Website Company ${suffix}`,
                contact_name: "Fictional Contact",
                email: "fictional@example.invalid",
                phone: "",
                topic: `Fictional enquiry training ${suffix}`,
                message: "Fictional requirements <script>literal text</script>",
                preferred_dates: "A future month",
                duration: "Two days",
                delivery_type: "online",
                time_zone: "Europe/Berlin",
                locale: "en",
                privacy_notice_version: "fictional-v1",
                consent: true,
            };
            const managementNote = "Fictional requirements reviewed.";
            const id = await checked(
                service.rpc("receive_website_enquiry", {
                    p_sender_hash: randomUUID().replaceAll("-", "").repeat(2),
                    p_submission_id: randomUUID(),
                    p_payload: payload,
                }),
            );
            defer(async () => {
                const row = JSON.parse(
                    await sql(
                        `select jsonb_build_object('organisation',organisation_id,'run',course_run_id) from private.website_enquiries where id='${id}'`,
                    ),
                );
                const template = row.run
                    ? await sql(
                        `select template_id from public.course_runs where id='${row.run}'`,
                    )
                    : null;
                await sql(
                    `delete from public.notifications where resource_id='${id}';delete from private.website_enquiry_requests where enquiry_id='${id}';delete from private.website_enquiry_events where enquiry_id='${id}';delete from private.website_enquiries where id='${id}';`,
                );
                if (row.run) {
                    await checked(
                        service
                            .from("course_sessions")
                            .delete()
                            .eq("course_run_id", row.run),
                    );
                    await checked(service.from("course_runs").delete().eq("id", row.run));
                }
                if (template)
                    await checked(
                        service.from("course_templates").delete().eq("id", template),
                    );
                if (row.organisation) {
                    await checked(
                        service
                            .from("organisation_contacts")
                            .delete()
                            .eq("organisation_id", row.organisation),
                    );
                    await checked(
                        service
                            .from("organisation_private_details")
                            .delete()
                            .eq("organisation_id", row.organisation),
                    );
                    await checked(
                        service.from("organisations").delete().eq("id", row.organisation),
                    );
                }
            });
            let other: Awaited<ReturnType<typeof browser.newContext>> | undefined;
            try {
                await adminLogin(page, manager);
                await page.goto("/enquiries");
                await page
                    .getByLabel("Unternehmen, Thema oder Kontakt-E-Mail suchen", {
                        exact: true,
                    })
                    .fill(suffix);
                await page
                    .getByRole("button", {name: "Filter anwenden", exact: true})
                    .click();
                await page
                    .getByRole("link", {name: payload.topic, exact: true})
                    .click();
                await expect(
                    page.getByText(payload.message, {exact: true}),
                ).toBeVisible();
                expect(
                    await page
                        .locator("script")
                        .filter({hasText: "literal text"})
                        .count(),
                ).toBe(0);
                await page
                    .getByRole("button", {
                        name: "Unternehmen und Kontakt anlegen",
                        exact: true,
                    })
                    .click();
                await page
                    .getByRole("dialog")
                    .getByRole("button", {name: "Bestätigen", exact: true})
                    .click();
                await expect(page.getByRole("dialog")).not.toBeVisible();
                await expect(
                    page
                        .locator(".enquiry-management")
                        .getByText(payload.company_name, {exact: true}),
                ).toBeVisible();
                await page
                    .getByRole("button", {name: "Verantwortung zuweisen", exact: true})
                    .click();
                await page
                    .getByRole("dialog")
                    .getByLabel("Verantwortliche Person", {exact: true})
                    .selectOption(manager.id);
                await page
                    .getByRole("dialog")
                    .getByRole("button", {name: "Bestätigen", exact: true})
                    .click();
                await expect(page.getByRole("dialog")).not.toBeVisible();
                await page
                    .getByRole("button", {
                        name: "Verwaltungsnotiz ergänzen",
                        exact: true,
                    })
                    .click();
                await page
                    .getByRole("dialog")
                    .getByLabel("Verwaltungsnotiz", {exact: true})
                    .fill(managementNote);
                await page
                    .getByRole("dialog")
                    .getByRole("button", {name: "Bestätigen", exact: true})
                    .click();
                await expect(
                    page.getByText(managementNote, {exact: true}),
                ).toBeVisible();
                await page
                    .getByRole("button", {name: "Kursentwurf aus Anfrage öffnen", exact: true})
                    .click();
                const form = page.getByRole("dialog");
                await expect(form.getByLabel("Titel", {exact: true})).toHaveValue(payload.topic);
                const courseDescription = form.getByLabel("Beschreibung", {exact: true});
                await expect(courseDescription).toHaveValue(payload.message);
                await courseDescription.fill("Reviewed course outline for the company.");
                const start = new Date(Date.now() + 90 * 86400000);
                start.setUTCHours(9, 0, 0, 0);
                const end = new Date(start.getTime() + 3600000);
                await form
                    .getByLabel("Beginn 1", {exact: true})
                    .fill(start.toISOString().slice(0, 16));
                await form
                    .getByLabel("Ende 1", {exact: true})
                    .fill(end.toISOString().slice(0, 16));
                await form
                    .getByRole("button", {name: "Zwischenstand speichern", exact: true})
                    .click();
                await expect(form.getByText("Entwurf auf dem Server gespeichert.", {exact:true})).toBeVisible();
                await page.reload();
                await expect(form.getByLabel("Beschreibung", {exact:true}))
                    .toHaveValue("Reviewed course outline for the company.");
                await expect(form.getByLabel("Beginn 1", {exact:true})).toHaveValue(start.toISOString().slice(0,16));
                const draftRoute = page.url();
                await form
                    .getByRole("button", {name: "Speichern und zum Auftrag", exact: true})
                    .click();
                await expect(page.getByRole("heading", {name:"Auftrag aus diesem Kurs",exact:true})).toBeVisible();
                const runId = await sql(
                    `select course_run_id from private.website_enquiries where id='${id}'`,
                );
                expect(page.url()).not.toBe(draftRoute);
                await expect(page).toHaveURL(new RegExp(`/courses\\?offer=${runId}$`));
                await page.goto(`/enquiries/${id}`);
                await expect(page.getByRole("link", {name:"Lehrauftrag vorbereiten",exact:true}))
                    .toHaveAttribute("href", `/courses?offer=${runId}`);
                await expect(
                    page.getByRole("link", {name: "Kursplanung öffnen", exact: true}),
                ).toBeVisible();
                await expect(
                    page.getByRole("button", {
                        name: "Kursentwurf aus Anfrage öffnen",
                        exact: true,
                    }),
                ).toHaveCount(0);
                await expect(
                    page.getByText(payload.message, {exact: true}),
                ).toBeVisible();
                await page.getByRole("link", {name: "Kursplanung öffnen", exact: true}).click();
                await expect(page).toHaveURL(new RegExp(`/courses\\?run=${runId}$`));
                const course = page.getByRole("dialog", {name: payload.topic});
                await expect(course).toBeVisible();
                await expect(course.getByRole("button", {name: "Bearbeiten", exact: true})).toBeEnabled();
                await page.goto(`/enquiries/${id}`);
                await page.getByLabel("Sprache", {exact: true}).selectOption("en");
                await page.getByLabel("Theme", {exact: true}).selectOption("dark");
                await accessible(page);
                await page.screenshot({
                    path: testInfo.outputPath("enquiry-dark-en.png"),
                    fullPage: true,
                });
                await context.setOffline(true);
                await expect(
                    page.getByRole("button", {
                        name: "Add management note",
                        exact: true,
                    }),
                ).toBeDisabled();
                await context.setOffline(false);
                other = await browser.newContext();
                const peer = await other.newPage();
                await login(peer, outsider.email);
                for (const path of ["/enquiries", `/enquiries/${id}`]) {
                    await peer.goto(path);
                    const main = peer.getByRole("main");
                    await expect(
                        main.getByRole("heading", {
                            level: 1,
                            name: "Diese Seite wurde nicht gefunden.",
                            exact: true,
                        }),
                    ).toBeVisible();
                    await expect(peer).toHaveURL(path);
                    const overview = main.getByRole("link", {name: "Zur Übersicht", exact: true});
                    const help = main.getByRole("link", {name: "Hilfe öffnen", exact: true});
                    await expect(overview).toBeVisible();
                    await expect(overview).toHaveAttribute("href", "/");
                    await expect(help).toBeVisible();
                    await expect(help).toHaveAttribute("href", "/help?topic=troubleshooting");
                    await expect(main).not.toContainText(
                        /Unternehmensanfragen|Unternehmensverwaltung/,
                    );
                    await expect(
                        main.locator(".enquiry-list, .enquiry-original, .enquiry-management"),
                    ).toHaveCount(0);
                    for (const value of [
                        payload.email,
                        payload.company_name,
                        payload.contact_name,
                        payload.topic,
                        payload.message,
                        managementNote,
                    ]) {
                        await expect(peer.locator("body")).not.toContainText(value);
                    }
                }
            } finally {
                await context.setOffline(false);
                await other?.close();
            }
        },
    );
});