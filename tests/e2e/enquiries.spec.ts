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
                        name: "Auftraggeber und Kontakt anlegen",
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
                    .fill("Fictional requirements reviewed.");
                await page
                    .getByRole("dialog")
                    .getByRole("button", {name: "Bestätigen", exact: true})
                    .click();
                await expect(
                    page.getByText("Fictional requirements reviewed.", {exact: true}),
                ).toBeVisible();
                await page
                    .getByRole("button", {name: "Kursdurchlauf erstellen", exact: true})
                    .click();
                const form = page.getByRole("dialog");
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
                    .getByRole("button", {name: "Bestätigen", exact: true})
                    .click();
                await expect(form).not.toBeVisible();
                await expect(
                    page.getByRole("link", {name: "Kursplanung öffnen", exact: true}),
                ).toBeVisible();
                await expect(
                    page.getByRole("button", {
                        name: "Kursdurchlauf erstellen",
                        exact: true,
                    }),
                ).toHaveCount(0);
                await expect(
                    page.getByText(payload.message, {exact: true}),
                ).toBeVisible();
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
                await peer.goto(`/enquiries/${id}`);
                await expect(peer.getByRole("alert")).toContainText(
                    "Auftraggeberverwaltung",
                );
                await expect(
                    peer.getByText(payload.email, {exact: true}),
                ).toHaveCount(0);
            } finally {
                await context.setOffline(false);
                await other?.close();
            }
        },
    );
});