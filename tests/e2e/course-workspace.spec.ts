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

type CompanyInvitation = {organisation_id: string; version: number};

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

/** Seed published, multi-session course options plus an invisible foreign course. */
async function enrolmentOptions(service: ReturnType<typeof api>, organisation: string) {
    const foreignOrganisation = randomUUID();
    await checked(service.from("organisations").insert({
        id: foreignOrganisation,
        name: "Fictional separate training company",
    }));

    const course = async (title: string, company = organisation) => {
        const template = randomUUID();
        const id = randomUUID();
        const sessions = [randomUUID(), randomUUID()];
        await checked(service.from("course_templates").insert({id: template, title}));
        await checked(service.from("course_runs").insert({
            id, template_id: template, organisation_id: company,
            time_zone: "Australia/Brisbane", published: true,
        }));
        const first = Date.now() + 4 * 86400000;
        await checked(service.from("course_sessions").insert(
            sessions.map((session, index) => ({
                id: session, course_run_id: id,
                starts_at: new Date(first + index * 86400000).toISOString(),
                ends_at: new Date(first + index * 86400000 + 3600000).toISOString(),
            })),
        ));
        return {id, title, sessions};
    };

    return {
        first: await course("Fictional batch networking"),
        second: await course("Fictional batch system administration"),
        third: await course("Fictional batch documentation"),
        stale: await course("Fictional batch retired option"),
        foreign: await course("Fictional foreign-only course", foreignOrganisation),
    };
}

test("Premium company multi-course enrolment is confirmed atomically across real browser roles", async ({page, browser}) => {
    test.setTimeout(120000);
    const f = await fixture({upcoming: true});
    const {first, second, third, stale, foreign} = await enrolmentOptions(f.service, f.org);
    const learner = api(process.env.SUPABASE_ANON_KEY!);
    await checked(learner.auth.signInWithPassword({email: f.learner.email, password: process.env.E2E_PASSWORD!}));
    const profile = await checked(
        f.service.from("profiles").select("luminovia_user_id").eq("id", f.learner.id).single(),
        {requireData: true},
    );
    await checked(f.adminClient.rpc("request_company_participant_link", {
        p_organisation_id: f.org, p_luminovia_user_id: profile.luminovia_user_id, p_request_id: randomUUID(),
    }));
    const invites: CompanyInvitation[] = await checked(learner.rpc("my_company_participant_invitations"), {requireData: true});
    const invite = invites.find(({organisation_id}) => organisation_id === f.org);
    if (!invite) throw new Error("Fictional batch participant invitation was not confirmed");
    await checked(learner.rpc("accept_company_participant_invitation", {
        p_organisation_id: f.org, p_expected_version: invite.version, p_request_id: randomUUID(),
    }));

    const roster = page.getByRole("region", {name: "Teilnehmende", exact: true});
    const details = roster.getByRole("article", {name: f.learner.name, exact: true})
        .getByRole("button", {name: "Kurse und Teilnahme", exact: true});
    const dialog = page.getByRole("dialog");
    const openCourses = async () => {
        await details.click();
        await dialog.getByRole("button", {name: "Kurse zuweisen", exact: true}).click();
        await expect(dialog.getByRole("searchbox", {name: "Kurse nach Titel suchen", exact: true})).toBeFocused();
    };
    const choice = ({title}: {title: string}) => dialog.getByRole("checkbox", {name: new RegExp(title)});
    const submit = async (button: string, status: number) => {
        const receipt = page.waitForResponse((response) =>
            response.url().endsWith("/rpc/assign_company_participant_courses") &&
            response.request().method() === "POST" && response.status() === status,
        );
        await dialog.getByRole("button", {name: button, exact: true}).click();
        return (await receipt).json();
    };

    // Search while retaining previous selections, with no foreign or draft option.
    await login(page, f.client.email);
    await page.goto("/client");
    await openCourses();
    await expect(choice(first)).toBeVisible();
    await expect(choice(foreign)).toHaveCount(0);
    await expect(choice(f)).toHaveCount(0);
    await choice(first).check();
    const search = dialog.getByRole("searchbox", {name: "Kurse nach Titel suchen", exact: true});
    await search.fill(second.title);
    await dialog.getByRole("button", {name: "Suchen", exact: true}).click();
    await expect(choice(first)).toHaveCount(0);
    await choice(second).check();
    await dialog.getByRole("button", {name: "Suche löschen", exact: true}).click();
    await expect(choice(first)).toBeChecked();
    await choice(stale).check();

    // The candidate changes after selection. The server must perform no partial enrolment.
    await checked(f.service.from("course_runs").update({published: false}).eq("id", stale.id));
    expect(await submit("In 3 Kurse einschreiben", 409)).toMatchObject({code: "PT409"});
    await expect(dialog.getByText(/Es wurde keine neue Einschreibung vorgenommen/)).toBeVisible();
    const enrolments = () => checked(
        f.service.from("course_enrolments").select("course_run_id,status").eq("user_id", f.learner.id)
            .order("course_run_id"),
        {requireData: true},
    );
    expect(await enrolments()).toEqual([]);
    await dialog.getByText("Ausgewählte Kurse (3)", {exact: true}).click();
    await dialog.getByRole("button", {name: `${stale.title} aus Auswahl entfernen`, exact: true}).click();
    const enrolled = [first.id, second.id].sort();
    expect(await submit("In 2 Kurse einschreiben", 200)).toEqual({enrolled, unchanged: []});
    await expect(dialog.getByRole("status").filter({hasText: "2 neue Kurse zugewiesen."})).toBeVisible();
    await expect(dialog.getByRole("button", {name: "Kurse zuweisen", exact: true})).toBeFocused();
    expect(await enrolments()).toEqual(enrolled.map((course_run_id) => ({course_run_id, status: "enrolled"})));

    // A fresh administrator has the same scoped picker and cannot re-add existing enrolments.
    const adminContext = await browser.newContext();
    const learnerContext = await browser.newContext();
    try {
        const admin = await adminContext.newPage();
        await adminLogin(admin, f.manager);
        await admin.goto("/clients");
        await admin.getByRole("button", {name: `Fictional workspace academy ${f.token}`, exact: true}).click();
        const adminRoster = admin.getByRole("region", {name: "Teilnehmende", exact: true});
        await adminRoster.getByRole("article", {name: f.learner.name, exact: true})
            .getByRole("button", {name: "Kurse und Teilnahme", exact: true}).click();
        const adminDialog = admin.getByRole("dialog");
        await adminDialog.getByRole("button", {name: "Kurse zuweisen", exact: true}).click();
        await expect(adminDialog.getByRole("checkbox", {name: new RegExp(third.title)})).toBeVisible();
        await expect(adminDialog.getByRole("checkbox", {name: new RegExp(first.title)})).toHaveCount(0);
        const repeated = await checked(f.adminClient.rpc("assign_company_participant_courses", {
            p_organisation_id: f.org, p_user_id: f.learner.id, p_run_ids: [first.id, second.id],
        }), {requireData: true});
        expect(repeated).toEqual({enrolled: [], unchanged: enrolled});

        // The learner sees every scheduled session of both whole courses after real sign-in.
        const student = await learnerContext.newPage();
        const courseRenderErrors: string[] = [];
        student.on("console", (message) => {
            if (message.type() === "error" && message.text().includes("Encountered two children with the same key"))
                courseRenderErrors.push(message.text());
        });
        await login(student, f.learner.email, /\/learning$/);
        for (const course of [first, second]) {
            await expect(student.getByRole("heading", {name: course.title, exact: true})).toBeVisible();
            await student.goto(`/courses/${course.id}/workspace`);
            await expect(student.locator(".course-workspace-sessions > li")).toHaveCount(course.sessions.length);
            await student.goto("/learning");
        }
        await expect(student.getByRole("heading", {name: foreign.title, exact: true})).toHaveCount(0);
        expect(courseRenderErrors).toEqual([]);
    } finally {
        await learnerContext.close();
        await adminContext.close();
    }
});

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
        {requireData: true},
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
        {requireData: true},
    );
    expect(review.rating).toBe(5);
    await checked(
        f.service
            .from("client_organisation_memberships")
            .update({removed_at: new Date().toISOString()})
            .eq("user_id", f.client.id)
            .eq("organisation_id", f.org),
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
        .eq("id", f.learner.id).single(), {requireData: true});
    await checked(f.adminClient.rpc("request_company_participant_link", {
        p_organisation_id: f.org, p_luminovia_user_id: profile.luminovia_user_id, p_request_id: randomUUID(),
    }));
    const invitations: CompanyInvitation[] =
        await checked(learner.rpc("my_company_participant_invitations"), {requireData: true});
    const invitation = invitations.find((entry) => entry.organisation_id === f.org);
    if (!invitation) throw new Error("Fictional course invitation was not received");
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
    const secondSession = randomUUID();
    const secondEnd = Date.now() - 86_400_000;
    await checked(f.service.from("course_sessions").insert({
        id: secondSession,
        course_run_id: f.run,
        starts_at: new Date(secondEnd - 3_600_000).toISOString(),
        ends_at: new Date(secondEnd).toISOString(),
    }));
    const learner = api(process.env.SUPABASE_ANON_KEY!);
    await checked(learner.auth.signInWithPassword({email:f.learner.email,password:process.env.E2E_PASSWORD!}));
    const profile = await checked(f.service.from("profiles").select("luminovia_user_id").eq("id",f.learner.id).single(),
        {requireData: true});
    await checked(f.adminClient.rpc("request_company_participant_link", {
        p_organisation_id:f.org,p_luminovia_user_id:profile.luminovia_user_id,p_request_id:randomUUID(),
    }));
    const invites: CompanyInvitation[] =
        await checked(learner.rpc("my_company_participant_invitations"), {requireData: true});
    const invite = invites.find((entry) => entry.organisation_id === f.org);
    if (!invite) throw new Error("Fictional course invitation was not received");
    await checked(learner.rpc("accept_company_participant_invitation", {
        p_organisation_id:f.org,p_expected_version:invite.version,p_request_id:randomUUID(),
    }));

    await adminLogin(page,f.manager);
    await page.goto(`/courses/${f.run}/workspace#course-enrolments`);
    const attendance = page.getByRole("region", {name: "Anwesenheitsliste je Termin", exact: true});
    await expect(attendance.getByText("Keine eingeschriebenen Teilnehmenden.", {exact: true})).toBeVisible();
    await page.getByLabel("Teilnehmende Person",{exact:true}).selectOption(f.learner.id);
    await page.getByRole("button",{name:"Zum Kurs anmelden",exact:true}).click();
    await page.getByRole("dialog").getByRole("button",{name:"Bestätigen",exact:true}).click();
    await expect(page.getByText("Kursanmeldung aktualisiert.",{exact:true})).toBeVisible();

    // The mounted session register must get the newly enrolled roster without a reload.
    await expect(attendance.getByText("Keine eingeschriebenen Teilnehmenden.", {exact: true})).toHaveCount(0);
    await attendance.getByText("Anwesenheit aus CSV oder XLSX übernehmen",{exact:true}).click();
    await attendance.getByLabel("CSV- oder XLSX-Datei prüfen",{exact:true}).setInputFiles({
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
    await attendance.getByRole("button",{name:"1 Änderung verbindlich speichern",exact:true}).click();
    await expect(attendance.getByText("1 Änderung gespeichert.",{exact:true})).toBeVisible();
    expect((await register()).rows[0]).toMatchObject({
        user_id:f.learner.id, status:"present", note:"Reviewed register",version:1,
    });

    // A bulk mark uses the exact selected session, leaving the XLSX result intact.
    await attendance.getByLabel("Kurstermin", {exact: true}).selectOption(secondSession);
    const totals = attendance.getByRole("list", {name: "Statusübersicht für diesen Termin"});
    await expect(totals.getByText("Noch offen: 1", {exact: true})).toBeVisible();
    await attendance.getByRole("searchbox", {name: "Nach Namen filtern"}).fill("unmatched");
    await expect(attendance.getByText("Keine Teilnehmenden passen zu den Filtern.")).toBeVisible();
    await expect(attendance.getByRole("button", {name: "Sammelmarkierung prüfen"})).toHaveCount(0);
    await attendance.getByRole("searchbox", {name: "Nach Namen filtern"}).fill("MÜLLER");
    await attendance.getByLabel("Nach Status filtern", {exact: true}).selectOption("unmarked");
    await attendance.getByLabel("Status für sichtbare, noch nicht erfasste Personen").selectOption("excused");
    await attendance.getByRole("button", {name: "Sammelmarkierung prüfen"}).click();
    const preview = page.getByRole("dialog", {name: "Sammelmarkierung prüfen"});
    await expect(preview.getByText("Fictional Müller Μαρία Мария", {exact: true})).toBeVisible();
    const secondRegister = () => checked(f.adminClient.rpc("course_session_register", {
        p_run_id: f.run, p_session_id: secondSession,
    }));
    expect((await secondRegister()).rows[0].status).toBeNull();
    await preview.getByRole("button", {name: "1 Änderung verbindlich speichern", exact: true}).click();
    await expect(totals.getByText("Entschuldigt: 1", {exact: true})).toBeVisible();
    expect((await secondRegister()).rows[0]).toMatchObject({
        user_id: f.learner.id, status: "excused", version: 1,
    });
    const [csv] = await Promise.all([
        page.waitForEvent("download"),
        attendance.getByRole("button", {name: "Anwesenheit als CSV herunterladen"}).click(),
    ]);
    expect(csv.suggestedFilename()).toContain(`${secondSession.slice(0, 8)}.csv`);
    const csvContents = await readFile(await csv.path(), "utf8");
    expect(csvContents).toContain("Fictional Müller Μαρία Мария");
    expect(csvContents).toContain(secondSession);
    expect(csvContents).toContain('"excused"');
    expect(csvContents).not.toContain(f.session);
    expect(csvContents).not.toContain("Reviewed register");

    const [pdf] = await Promise.all([
        page.waitForEvent("download"),
        attendance.getByRole("button", {name: "Anwesenheit als PDF herunterladen"}).click(),
    ]);
    expect(pdf.suggestedFilename()).toContain(`${secondSession.slice(0, 8)}.pdf`);
    expect((await readFile(await pdf.path())).subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect((await register()).rows[0]).toMatchObject({
        user_id: f.learner.id, status: "present", note: "Reviewed register", version: 1,
    });
});
