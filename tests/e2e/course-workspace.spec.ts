import {expect, type Page, test} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {Uint8ArrayReader, Uint8ArrayWriter, ZipWriter} from "@zip.js/zip.js";
import {actor, adminLogin, api, checked, login,} from "./helpers/accounts-support";

test.skip(
    process.env.PORTAL_TEST_MODE !== "1",
    "Course workspace fixtures require canonical disposable services.",
);

async function fixture({ upcoming = false } = {}) {
    const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!),
        manager = await actor("Fictional course workspace manager", "admin"),
        teacher = await actor("Fictional course workspace teacher", "lecturer"),
        learner = await actor("Fictional Müller Μαρία Мария", "participant"),
        client = await actor("Fictional course workspace customer", "client");
    const org = randomUUID(),
        template = randomUUID(),
        run = randomUUID(),
        session = randomUUID(),
        job = randomUUID(),
        claim = randomUUID(),
        contact = randomUUID(),
        token = randomUUID().slice(0, 8),
        title = `Fictional Linux course ${token}`;
    await checked(
        service
            .from("organisations")
            .insert({id: org, name: `Fictional workspace academy ${token}`}),
    );
    await checked(
        service.from("organisation_contacts").insert({
            id: contact,
            organisation_id: org,
            name: "Fictional agreed contact",
            email: "course@example.invalid",
            phone: "+49 40 123",
            notes: "Private organisation note stays hidden",
        }),
    );
    await checked(
        service.from("course_templates").insert({
            id: template,
            title,
            syllabus: "Fictional Linux permissions and safe commands",
        }),
    );
    await checked(
        service.from("course_runs").insert({
            id: run,
            template_id: template,
            organisation_id: org,
            time_zone: "Europe/Berlin",
            venue: "https://example.invalid/class",
        }),
    );
    const sessionEnd = Date.now() + (upcoming ? 2 : -2) * 86400000;
    await checked(
        service.from("course_sessions").insert({
            id: session,
            course_run_id: run,
            starts_at: new Date(sessionEnd - 3600000).toISOString(),
            ends_at: new Date(sessionEnd).toISOString(),
        }),
    );
    await checked(
        service.from("jobs").insert({
            id: job,
            course_run_id: run,
            title,
            customer_name: "Fictional workspace academy",
            delivery_type: "online",
            status: "filled",
            amount: 100,
            total_amount: 100,
            currency: "EUR",
            rate_unit: "fixed_total",
            terms: "Fictional accepted terms",
        }),
    );
    await checked(
        service.from("job_claims").insert({
            id: claim,
            job_id: job,
            lecturer_id: teacher.id,
            idempotency_key: randomUUID(),
            amount: 100,
            total_amount: 100,
            currency: "EUR",
            rate_unit: "fixed_total",
            terms: "Fictional accepted terms",
            terms_version: 1,
        }),
    );
    await checked(
        service
            .from("client_organisation_memberships")
            .insert({user_id: client.id, organisation_id: org}),
    );
    const adminClient = api(process.env.SUPABASE_ANON_KEY!);
    await checked(adminClient.auth.signInWithPassword({email: manager.email, password: process.env.E2E_PASSWORD!}));
    await checked(adminClient.rpc("set_company_premium", {
        p_organisation_id: org, p_enabled: true, p_expected_version: 0, p_request_id: randomUUID(),
    }));
    return {
        service,
        manager,
        teacher,
        learner,
        client,
        org,
        adminClient,
        run,
        session,
        contact,
        title,
        token,
    };
}

async function a11y(page: Page) {
    await page.evaluate(() => document.fonts.ready);
    const scan = await new AxeBuilder({page})
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
    expect(
        scan.violations.map((v) => ({
            id: v.id,
            nodes: v.nodes.map((n) => n.target),
        })),
    ).toEqual([]);
    expect(
        await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
    ).toBe(true);
}

test("real shared preparation, explicitly agreed contact and scanned file version reach only the linked customer", async ({
                                                                                                                              page,
                                                                                                                              browser,
                                                                                                                          }, info) => {
    test.setTimeout(120000);
    const f = await fixture();
    await adminLogin(page, f.manager);
    await page.goto(`/courses/${f.run}/workspace`);
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page
        .getByRole("button", {name: "Unterrichtslink kopieren", exact: true})
        .click();
    await expect(
        page.getByRole("status").filter({hasText: "Unterrichtslink kopiert."}),
    ).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
        "https://example.invalid/class",
    );
    const prep = page.getByRole("region", {
        name: "Gemeinsame Kursvorbereitung",
        exact: true,
    });
    await prep
        .getByLabel("Neuer Vorbereitungspunkt", {exact: true})
        .fill("Fictional lab accounts ready");
    await prep.getByRole("button", {name: "Hinzufügen", exact: true}).click();
    const checkbox = prep.getByRole("checkbox", {
        name: "Fictional lab accounts ready",
        exact: true,
    });
    await expect(checkbox).toBeVisible();
    await checkbox.click();
    await expect(checkbox).toBeChecked();
    const contact = page.getByRole("region", {
        name: "Kursinformationen & Kontakt",
        exact: true,
    });
    await contact
        .getByLabel("Kundenkontakt für diesen Kurs freigeben", {exact: true})
        .selectOption(f.contact);
    await contact.getByRole("button", {name: "Speichern", exact: true}).click();
    await expect(
        contact.getByText("course@example.invalid", {exact: false}),
    ).toBeVisible();
    await page.goto("/files");
    await page
        .getByRole("button", {name: "Datei hochladen", exact: true})
        .click();
    const dialog = page.getByRole("dialog");
    const name = `Agreed-${f.token}.txt`,
        bytes = Buffer.from("Fictional malware-scanned agreed course material.");
    await dialog
        .getByLabel("Datei auswählen", {exact: true})
        .setInputFiles({name, mimeType: "text/plain", buffer: bytes});
    await dialog
        .getByRole("button", {name: "Datei hochladen", exact: true})
        .click();
    await expect(dialog).toBeHidden({timeout: 45000});
    await page.goto(`/courses/${f.run}/workspace`);
    const resources = page.getByRole("region", {
        name: "Kursdateien",
        exact: true,
    });
    const selected = await checked(
        f.service
            .from("documents")
            .select("current_version_id")
            .eq("original_name", name)
            .single(),
    );
    await resources
        .getByLabel("Geprüfte Dateifassung", {exact: true})
        .selectOption(selected.current_version_id);
    await resources
        .getByRole("button", {name: "Fassung freigeben", exact: true})
        .click();
    await expect(resources.getByText(name, {exact: true})).toBeVisible();
    const otherContext = await browser.newContext({
        viewport: page.viewportSize() ?? undefined,
    });
    const customer = await otherContext.newPage();
    try {
        await login(customer, f.client.email);
        await customer.goto(`/courses/${f.run}/workspace`);
        await expect(
            customer.getByRole("checkbox", {
                name: "Fictional lab accounts ready",
                exact: true,
            }),
        ).toBeChecked();
        await expect(
            customer.getByRole("checkbox", {
                name: "Fictional lab accounts ready",
                exact: true,
            }),
        ).toBeDisabled();
        await expect(
            customer.getByText("Private organisation note stays hidden", {
                exact: true,
            }),
        ).toHaveCount(0);
        await expect(
            customer.getByRole("region", {name: "Fragen & Antworten", exact: true}),
        ).toHaveCount(0);
        const download = customer.waitForEvent("download");
        await customer
            .getByRole("region", {
                name: "Kursdateien",
                exact: true,
            })
            .getByRole("button", {name: "Herunterladen", exact: true})
            .click();
        const file = await download;
        expect(await readFile((await file.path())!)).toEqual(bytes);
        await customer.getByLabel("Sprache", {exact: true}).selectOption("en");
        await customer.getByLabel("Theme", {exact: true}).selectOption("dark");
        await expect(
            customer.getByRole("region", {
                name: "Shared course preparation",
                exact: true,
            }),
        ).toBeVisible();
        await a11y(customer);
        await customer.screenshot({
            path: `.local/screenshots/${info.project.name}-course-client-workspace.png`,
            fullPage: true,
        });
    } finally {
        await otherContext.close();
    }
});
test("company reviews are current-membership scoped and an unassociated participant cannot enter the course", async ({
                                                                                                                     page,
                                                                                                                     browser,
                                                                                                                 }) => {
    const f = await fixture();
    await login(page, f.client.email);
    await page.goto("/courses?section=reviews");
    await expect(
        page.getByRole("heading", {name: f.title, exact: true}),
    ).toBeVisible();
    await page.getByLabel("Bewertung", {exact: true}).selectOption("5");
    await page
        .getByLabel("Deine Rückmeldung", {exact: true})
        .fill("Fictional company review after the completed course.");
    const submitted = page.waitForResponse(
        (response) =>
            response.url().endsWith("/rpc/submit_course_review") &&
            response.request().method() === "POST" &&
            response.ok(),
    );
    await page
        .getByRole("button", {name: "Bewertung speichern", exact: true})
        .click();
    await submitted;
    const review = await checked(
        f.service
            .from("course_reviews")
            .select("rating")
            .eq("course_run_id", f.run)
            .eq("reviewer_id", f.client.id)
            .single(),
    );
    expect(review.rating).toBe(5);
    await checked(
        f.service
            .from("client_organisation_memberships")
            .update({removed_at: new Date().toISOString()})
            .eq("user_id", f.client.id)
            .eq(
                "organisation_id",
                (
                    await checked(
                        f.service
                            .from("course_runs")
                            .select("organisation_id")
                            .eq("id", f.run)
                            .single(),
                    )
                ).organisation_id,
            ),
    );
    await page.reload();
    await expect(
        page.getByRole("heading", {name: f.title, exact: true}),
    ).toHaveCount(0);
    const participantContext = await browser.newContext();
    try {
        const participant = await participantContext.newPage();
        await participant.goto("/login");
        await participant
            .getByLabel("Benutzername oder E-Mail", {exact: true})
            .fill(f.learner.email);
        await participant
            .getByLabel("Passwort", {exact: true})
            .fill(process.env.E2E_PASSWORD!);
        await participant
            .getByRole("button", {name: "Anmelden", exact: true})
            .click();
        await expect(participant).toHaveURL(/\/learning$/);
        await participant.goto(`/courses/${f.run}/workspace`);
        await expect(participant.getByRole("alert")).toBeVisible();
        await expect(
            participant.getByRole("heading", {name: f.title, exact: true}),
        ).toHaveCount(0);
    } finally {
        await participantContext.close();
    }
});

test("current instructor publishes a meeting link for a consented participant", async ({page, browser}) => {
    const f = await fixture({upcoming: true});
    const learner = api(process.env.SUPABASE_ANON_KEY!);
    await checked(learner.auth.signInWithPassword({
        email: f.learner.email, password: process.env.E2E_PASSWORD!,
    }));
    const profile = await checked(f.service.from("profiles").select("luminovia_user_id")
        .eq("id", f.learner.id).single());
    await checked(f.adminClient.rpc("request_company_participant_link", {
        p_organisation_id: f.org, p_luminovia_user_id: profile.luminovia_user_id, p_request_id: randomUUID(),
    }));
    const invitations = await checked(learner.rpc("my_company_participant_invitations"));
    const invitation = invitations.find((entry) => entry.organisation_id === f.org);
    expect(invitation).toBeDefined();
    await checked(learner.rpc("accept_company_participant_invitation", {
        p_organisation_id: f.org, p_expected_version: invitation.version, p_request_id: randomUUID(),
    }));
    await checked(f.adminClient.rpc("manage_course_enrolment", {
        p_course_run_id: f.run, p_user_id: f.learner.id, p_status: "enrolled",
    }));

    const classroom = "https://classroom.example.invalid/Join%20Now?pwd=fictional#class";
    const workspace = `/courses/${f.run}/workspace`;
    await login(page, f.teacher.email);
    await page.goto(workspace);
    await page.getByRole("button", {name: "Meetinglink bearbeiten", exact: true}).click();
    const input = page.getByRole("textbox", {name: "Meetinglink (HTTPS)", exact: true});
    const publish = page.getByRole("button", {name: "Meetinglink veröffentlichen", exact: true});
    await input.fill("http://classroom.example.invalid/");
    await expect(publish).toBeDisabled();
    await input.fill(classroom);
    const response = page.waitForResponse((item) =>
        item.url().endsWith("/rpc/set_course_meeting_link") && item.request().method() === "POST" && item.ok());
    await publish.click();
    expect(await (await response).json()).toEqual({url: classroom, version: 1, can_edit: true});
    await expect(page.getByRole("link", {name: "Unterrichtslink öffnen", exact: true})).toHaveAttribute("href", classroom);

    const context = await browser.newContext();
    try {
        const participant = await context.newPage();
        await login(participant, f.learner.email, /\/learning$/);
        await participant.goto(workspace);
        const join = participant.getByRole("link", {name: "Virtuellen Kursraum öffnen", exact: true});
        await expect(join).toHaveAttribute("href", classroom);
        await expect(participant.getByRole("button", {name: "Meetinglink bearbeiten", exact: true})).toHaveCount(0);

        await page.getByRole("button", {name: "Meetinglink bearbeiten", exact: true}).click();
        await expect(input).toHaveValue(classroom);
        await input.clear();
        await publish.click();
        await expect(page.getByRole("link", {name: "Unterrichtslink öffnen", exact: true}))
            .toHaveAttribute("href", "https://example.invalid/class");
        await participant.getByRole("button", {name: "Kurs aktualisieren", exact: true}).click();
        await expect(join).toHaveAttribute("href", "https://example.invalid/class");
    } finally {
        await context.close();
    }
});

/** Produce a real single-sheet workbook without attaching any existing learner data. */
async function attendanceWorkbook(participantId: string) {
    const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
    const office = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    const rel = "http://schemas.openxmlformats.org/package/2006/relationships";
    const row = (values: string[], number: number) => `<row r="${number}">${values.map((value, column) =>
        `<c r="${String.fromCharCode(65 + column)}${number}" t="inlineStr"><is><t>${value}</t></is></c>`).join("")}</row>`;
    const parts = {
        "_rels/.rels": `<Relationships xmlns="${rel}"><Relationship Id="w" Type="${office}/officeDocument" Target="/xl/workbook.xml"/></Relationships>`,
        "xl/workbook.xml": `<workbook xmlns="${ns}" xmlns:r="${office}"><sheets><sheet name="Attendance" sheetId="1" r:id="s"/></sheets></workbook>`,
        "xl/_rels/workbook.xml.rels": `<Relationships xmlns="${rel}"><Relationship Id="s" Type="${office}/worksheet" Target="worksheets/sheet.xml"/></Relationships>`,
        "xl/worksheets/sheet.xml": `<worksheet xmlns="${ns}"><sheetData>${row(
            ["user_id","name","status","arrival_at","departure_at","note","reason"],1,
        )}${row([participantId,"Fictional workbook label","present","","","Reviewed register","Attendance review"],2)}</sheetData></worksheet>`,
    };
    const writer = new ZipWriter(new Uint8ArrayWriter(), {useWebWorkers:false});
    for (const [name, value] of Object.entries(parts)) {
        await writer.add(name,new Uint8ArrayReader(new TextEncoder().encode(value)));
    }
    return Buffer.from(await writer.close());
}

test("consented participant enrolment and reviewed XLSX attendance use the native course workspace", async ({page}) => {
    const f = await fixture();
    const learner = api(process.env.SUPABASE_ANON_KEY!);
    await checked(learner.auth.signInWithPassword({email:f.learner.email,password:process.env.E2E_PASSWORD!}));
    const profile = await checked(f.service.from("profiles").select("luminovia_user_id,display_name").eq("id",f.learner.id).single());
    await checked(f.adminClient.rpc("request_company_participant_link", {
        p_organisation_id:f.org,p_luminovia_user_id:profile.luminovia_user_id,p_request_id:randomUUID(),
    }));
    const invites = await checked(learner.rpc("my_company_participant_invitations"));
    const invite = invites.find((entry) => entry.organisation_id === f.org);
    expect(invite).toBeDefined();
    await checked(learner.rpc("accept_company_participant_invitation", {
        p_organisation_id:f.org,p_expected_version:invite.version,p_request_id:randomUUID(),
    }));

    await adminLogin(page,f.manager);
    await page.goto(`/courses/${f.run}/workspace#course-enrolments`);
    await page.getByLabel("Teilnehmende Person",{exact:true}).selectOption(f.learner.id);
    await page.getByRole("button",{name:"Zum Kurs anmelden",exact:true}).click();
    await page.getByRole("dialog").getByRole("button",{name:"Bestätigen",exact:true}).click();
    await expect(page.getByText("Kursanmeldung aktualisiert.",{exact:true})).toBeVisible();

    await page.getByText("Anwesenheit aus CSV oder XLSX übernehmen",{exact:true}).click();
    await page.getByLabel("CSV- oder XLSX-Datei prüfen",{exact:true}).setInputFiles({
        name:"attendance.xlsx",
        mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer:await attendanceWorkbook(f.learner.id),
    });
    await expect(page.getByText("Reviewed register",{exact:true})).toBeVisible();
    await expect(page.getByText("Fictional workbook label",{exact:false})).toHaveCount(0);
    const register = () => checked(f.adminClient.rpc("course_session_register",{
        p_run_id:f.run,p_session_id:f.session,
    }));
    expect((await register()).rows[0].status).toBeNull();
    await page.getByRole("button",{name:"1 Änderungen verbindlich speichern",exact:true}).click();
    await expect(page.getByText("1 Änderungen gespeichert.",{exact:true})).toBeVisible();
    expect((await register()).rows[0]).toMatchObject({
        user_id:f.learner.id, status:"present", note:"Reviewed register",version:1,
    });
});
