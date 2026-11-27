import {chromium, expect, type Page, test} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {createHash, randomUUID} from "node:crypto";
import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {createServer} from "node:http";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DateTime} from "luxon";
import {Uint8ArrayReader, Uint8ArrayWriter, ZipWriter} from "@zip.js/zip.js";
import {actor, adminLogin, api, checked, login,} from "./helpers/accounts-support";
import {fillWorkbookCell} from "./helpers/spreadsheet";
import {accountingTestPdf} from "../../scripts/testing/accounting-pdf.mjs";
import {scormFixtureZip} from "../../scripts/testing/scorm-fixture.ts";
import {runXapiDispatchCli} from "../../scripts/xapi-lrs-dispatch.mjs";

test.skip(
    process.env.PORTAL_TEST_MODE !== "1",
    "Course workspace fixtures require canonical disposable services.",
);

type CompanyInvitation = {organisation_id: string; version: number};

async function dispatchFixtureArchive(run: string, email: string) {
    const directory = await mkdtemp(join(tmpdir(), "luminovia-test-xapi-dispatch-"));
    const config = join(directory, "courses.json"), checkpoint = join(directory, "delivery.json");
    const received: Array<{id: string}> = [];
    const lrs = createServer(async (request, response) => {
        const body = [];
        for await (const chunk of request) body.push(chunk);
        const statement = JSON.parse(Buffer.concat(body).toString("utf8"));
        const target = new URL(request.url!, "http://127.0.0.1");
        if (request.method !== "PUT" || target.pathname !== "/xapi/statements" ||
            target.searchParams.get("statementId") !== statement.id ||
            request.headers["x-experience-api-version"] !== "1.0.3") {
            response.writeHead(400).end();
            return;
        }
        received.push(statement);
        response.writeHead(204).end();
    });
    try {
        await new Promise<void>((resolve) => lrs.listen(0, "127.0.0.1", resolve));
        const address = lrs.address();
        if (!address || typeof address === "string") throw new Error("Missing fictional LRS address");
        const now = Date.now();
        await writeFile(config, JSON.stringify({courses: [{id: run, from: new Date(now - 3600000).toISOString()}]}));
        const [report] = await runXapiDispatchCli(config, checkpoint, {
            LMS_XAPI_PORTAL_URL: process.env.SUPABASE_URL,
            LMS_XAPI_PORTAL_PUBLISHABLE_KEY: process.env.SUPABASE_ANON_KEY,
            LMS_XAPI_PORTAL_EMAIL: email,
            LMS_XAPI_PORTAL_PASSWORD: process.env.E2E_PASSWORD,
            LMS_XAPI_LRS_ENDPOINT: `http://127.0.0.1:${address.port}/xapi`,
            LMS_XAPI_LRS_USERNAME: "fixture-lrs",
            LMS_XAPI_LRS_PASSWORD: "fixture-lrs-password",
        }, now + 360000);
        expect(report).toMatchObject({course: run, failure: null, submitted: received.length});
        const saved = JSON.parse(await readFile(checkpoint, "utf8"));
        expect(saved.courses[run]).toBe(report.through);
        return received;
    } finally {
        await new Promise<void>((resolve) => lrs.close(() => resolve()));
        await rm(directory, {recursive: true, force: true});
    }
}

async function fixture({
    upcoming = false,
    premium = true,
    sharedLearner,
}: {
    upcoming?: boolean;
    premium?: boolean;
    sharedLearner?: Awaited<ReturnType<typeof actor>>;
} = {}) {
    const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!),
        manager = await actor("Fictional course workspace manager", "admin"),
        teacher = await actor("Fictional course workspace teacher", "lecturer"),
        learner = sharedLearner ?? await actor("Fictional Müller Μαρία Мария", "participant"),
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
    await checked(service.from("assignment_sessions").insert({
        claim_id: claim,
        lecturer_id: teacher.id,
        starts_at: new Date(sessionEnd - 3600000).toISOString(),
        ends_at: new Date(sessionEnd).toISOString(),
    }));
    await checked(
        service
            .from("client_organisation_memberships")
            .insert({user_id: client.id, organisation_id: org}),
    );
    const adminClient = api(process.env.SUPABASE_ANON_KEY!);
    await checked(adminClient.auth.signInWithPassword({email: manager.email, password: process.env.E2E_PASSWORD!}));
    if (premium) {
        await checked(adminClient.rpc("set_company_premium", {
            p_organisation_id: org, p_enabled: true, p_expected_version: 0, p_request_id: randomUUID(),
        }));
    }
    return {
        service,
        manager,
        teacher,
        learner,
        client,
        org,
        adminClient,
        run,
        job,
        session,
        contact,
        title,
        token,
    };
}

async function linkWorkspaceLearner(f: Awaited<ReturnType<typeof fixture>>) {
    const learner = api(process.env.SUPABASE_ANON_KEY!);
    await checked(
        learner.auth.signInWithPassword({
            email: f.learner.email,
            password: process.env.E2E_PASSWORD!,
        }),
    );
    const profile = await checked(
        f.service.from("profiles").select("luminovia_user_id").eq("id", f.learner.id).single(),
        {requireData: true},
    );
    await checked(
        f.adminClient.rpc("request_company_participant_link", {
            p_organisation_id: f.org,
            p_luminovia_user_id: profile.luminovia_user_id,
            p_request_id: randomUUID(),
        }),
    );
    const invitations: CompanyInvitation[] = await checked(
        learner.rpc("my_company_participant_invitations"),
        {requireData: true},
    );
    const invite = invitations.find((entry) => entry.organisation_id === f.org);
    if (!invite) throw new Error("Fictional course invitation was not received");
    await checked(
        learner.rpc("accept_company_participant_invitation", {
            p_organisation_id: f.org,
            p_expected_version: invite.version,
            p_request_id: randomUUID(),
        }),
    );
    return learner;
}

test("the course menu groups tools and displays only the chosen section", async ({page}, info) => {
    const f = await fixture();
    const workspace = `/courses/${f.run}/workspace`;
    await adminLogin(page, f.manager);
    await page.goto(workspace);
    const mobile = info.project.name.startsWith("mobile");
    const nav = page.getByRole("navigation", {name: "Bereiche im Kursraum"});
    await expect(page.getByRole("heading", {name: "Kursübersicht & Termine"})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Kursdateien"})).toBeHidden();
    if (mobile) {
        const menu = nav.getByRole("combobox", {name: "Kursbereich"});
        await expect(menu.locator('optgroup[label="Kurs & Materialien"]')).toHaveCount(1);
        await expect(menu.locator('optgroup[label="Organisation"]')).toHaveCount(1);
        await menu.selectOption("course-materials");
    } else {
        const organisation = nav.getByText("Organisation", {exact: true});
        await organisation.focus();
        await organisation.press("Enter");
        await expect(nav.getByRole("link", {name: "Teilnehmende", exact: true})).toBeVisible();
        await expect(nav.getByRole("link", {name: "Materialien", exact: true})).toBeHidden();
        await nav.getByText("Kurs & Materialien", {exact: true}).click();
        await nav.getByRole("link", {name: "Materialien", exact: true}).click();
    }
    await expect(page).toHaveURL(workspace + "#course-materials");
    await expect(page.getByRole("heading", {name: "Kursdateien"})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Kursübersicht & Termine"})).toBeHidden();
    await page.reload();
    await expect(page.getByRole("heading", {name: "Kursdateien"})).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test("completed course evaluations and lecturer restrictions follow current roles", async ({page, browser}, info) => {
    test.setTimeout(120_000);
    const f = await fixture();
    await linkWorkspaceLearner(f);
    await checked(f.adminClient.rpc("manage_course_enrolment", {
        p_course_run_id: f.run,
        p_user_id: f.learner.id,
        p_status: "enrolled",
    }));
    const workspace = `/courses/${f.run}/workspace#course-evaluations`;
    const review = (current: Page) => current.getByRole("region", {name: "Kursbewertungen", exact: true});
    await login(page, f.learner.email, /\/learning$/);
    await page.goto(workspace);
    const learner = review(page);
    await learner.getByLabel("Wen oder was bewertest du?").selectOption(`learner/lecturer/${f.teacher.id}`);
    await learner.getByLabel("Punktzahl").selectOption("5");
    await learner.getByLabel("Kommentar (optional)").fill("Fictional clear and practical instruction");
    // Commit the actual first save and drop its response before the browser can use it.
    await page.route("**/rest/v1/rpc/save_course_evaluation", async (route) => {
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        expect(await response.json()).toMatchObject({score: 5, version: 1});
        await route.abort("failed");
    }, {times: 1});
    await learner.getByRole("button", {name: "Bewertung speichern", exact: true}).click();
    await expect(learner.getByText(/Die Speicherung konnte nicht bestätigt werden/)).toBeVisible();
    await learner.getByRole("button", {name: "Bewertung speichern", exact: true}).click();
    await expect(learner.getByText("Bewertung gespeichert.", {exact: true})).toBeVisible();
    await expect(learner.getByText(/5 von 5 · 1 Bewertung/)).toBeVisible();
    await expect(learner.getByRole("button", {name: /^Einzelbewertungen/})).toHaveCount(0);

    const viewport = page.viewportSize() ?? undefined;
    const teacherContext = await browser.newContext({viewport, isMobile: info.project.name.includes("mobile")});
    const companyContext = await browser.newContext({viewport, isMobile: info.project.name.includes("mobile")});
    try {
        const teacher = await teacherContext.newPage();
        const company = await companyContext.newPage();
        await login(teacher, f.teacher.email);
        await teacher.goto(workspace);
        const teacherReviews = review(teacher);
        await teacherReviews.getByRole("button", {name: /^Einzelbewertungen/}).click();
        await expect(teacherReviews.getByText("Fictional clear and practical instruction", {exact: true})).toBeVisible();
        await teacherReviews.getByLabel("Wen oder was bewertest du?").selectOption(`lecturer/course/${f.run}`);
        await teacherReviews.getByLabel("Anspruch des Kurses").selectOption("4");
        await teacherReviews.getByRole("button", {name: "Bewertung speichern", exact: true}).click();
        await expect(teacherReviews.getByText("Bewertung gespeichert.", {exact: true})).toBeVisible();
        await teacherReviews.getByLabel("Wen oder was bewertest du?").selectOption(`lecturer/participant/${f.learner.id}`);
        await teacherReviews.getByLabel("Punktzahl").selectOption("4");
        await teacherReviews.getByLabel("Kommentar (optional)").fill("Fictional individual lab feedback");
        await teacherReviews.getByRole("button", {name: "Bewertung speichern", exact: true}).click();
        await expect(teacherReviews.getByText("Bewertung gespeichert.", {exact: true})).toBeVisible();
        expect(await teacher.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

        await page.reload();
        await learner.getByRole("button", {name: /^Einzelbewertungen.*Teilnehmende Person/}).click();
        await expect(learner.getByText("Fictional individual lab feedback", {exact: true})).toBeVisible();

        await login(company, f.client.email);
        await company.goto(workspace);
        const companyReviews = review(company);
        await companyReviews.getByRole("button", {name: /^Einzelbewertungen.*Teilnehmende Person/}).click();
        await expect(companyReviews.getByText("Fictional individual lab feedback", {exact: true})).toBeVisible();
        await companyReviews.getByLabel("Wen oder was bewertest du?").selectOption(`company/lecturer/${f.teacher.id}`);
        await companyReviews.getByLabel("Punktzahl").selectOption("3");
        await companyReviews.getByRole("button", {name: "Bewertung speichern", exact: true}).click();
        await expect(companyReviews.getByText("Bewertung gespeichert.", {exact: true})).toBeVisible();
        await company.goto("/client");
        await company.getByText("Dozentensperren", {exact: true}).click();
        const block = company.getByRole("button", {name: "Sperren Fictional course workspace teacher", exact: true});
        await block.click();
        await company.getByRole("dialog").getByRole("button", {name: "Sperren", exact: true}).click();
        const release = company.getByRole("button", {name: "Freigeben Fictional course workspace teacher", exact: true});
        await expect(release).toBeVisible();
        await teacher.reload();
        await expect(teacher.getByRole("alert").first()).toBeVisible();
        await expect(teacher.getByRole("heading", {name: f.title, exact: true})).toHaveCount(0);
        await release.click();
        await company.getByRole("dialog").getByRole("button", {name: "Freigeben", exact: true}).click();
        await expect(block).toBeVisible();
        await teacher.reload();
        await expect(teacher.getByRole("heading", {name: f.title, exact: true})).toBeVisible();
        await expect(teacherReviews.getByText(/5 von 5 · 1 Bewertung/)).toBeVisible();
    } finally {
        await teacherContext.close();
        await companyContext.close();
    }
});

test("signed-in company opens an unbooked lecturer's anonymized reviews", async ({page}) => {
    const booked = await fixture();
    await linkWorkspaceLearner(booked);
    await checked(booked.adminClient.rpc("manage_course_enrolment", {
        p_course_run_id: booked.run, p_user_id: booked.learner.id, p_status: "enrolled",
    }));
    const learnerAccess = api(process.env.SUPABASE_ANON_KEY!);
    await checked(learnerAccess.auth.signInWithPassword({
        email: booked.learner.email, password: process.env.E2E_PASSWORD!,
    }));
    await checked(learnerAccess.rpc("save_course_evaluation", {
        p_run_id: booked.run, p_rater_role: "learner", p_subject_kind: "lecturer",
        p_subject_id: booked.teacher.id, p_score: 5, p_expected_version: 0,
        p_comment: "Fictional sensitive note retained in the booked course",
    }));
    const lecturerName = `Fictional rated lecturer ${booked.token}`;
    await checked(booked.service.from("profiles").update({display_name: lecturerName}).eq("id", booked.teacher.id));
    const unbooked = await fixture({premium: false});
    await login(page, unbooked.client.email);
    await page.goto("/people");
    await expect(page.getByRole("heading", {name: "Dozierende und Bewertungen"})).toBeVisible();
    await page.getByRole("searchbox", {name: "Person suchen"}).fill(lecturerName);
    await page.getByRole("button", {name: "Person suchen", exact: true}).click();
    await page.locator(`a[href="/people/${booked.teacher.id}?lecturers=feedback"]`).click();
    await expect(page.getByRole("heading", {name: "Bestätigte Qualifikationen"})).toBeVisible();
    await expect(page.getByText(/5 von 5.*Kursteilnehmende/)).toBeVisible();
    await expect(page.getByText("Fictional sensitive note retained in the booked course")).toHaveCount(0);
    await expect(page.getByText(booked.title)).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test("Premium exam switching and scanned bytes follow real access across two companies", async ({
    page,
    browser,
}, info) => {
    test.setTimeout(150_000);
    const f = await fixture({premium: false});
    // Preserve the earlier attendance row while this exam is currently open
    // within the course schedule. Timed papers cannot be shared as untimed files.
    const examTitle = `Fictional timed exam ${f.token}`;
    const examNow = Date.now();
    const starts = new Date(examNow - 10 * 60000).toISOString();
    const ends = new Date(examNow + 50 * 60000).toISOString();
    await checked(f.service.from("course_sessions").insert({
        course_run_id: f.run, starts_at: starts, ends_at: ends,
    }));
    const other = await fixture({premium: false, sharedLearner: f.learner});
    const togglePremium = async (target: typeof f, enabled: boolean, version: number) => {
        const result = await checked(target.adminClient.rpc("set_company_premium", {
            p_organisation_id: target.org,
            p_enabled: enabled,
            p_expected_version: version,
            p_request_id: randomUUID(),
        }), {requireData: true});
        expect(result).toEqual({status: "updated", enabled, version: version + 1});
    };
    await login(page, f.learner.email, /\/learning$/);
    await expect(page.getByText("Für dein Konto sind noch keine Kursräume freigegeben.", {exact: true})).toBeVisible();
    const company = api(process.env.SUPABASE_ANON_KEY!);
    await checked(company.auth.signInWithPassword({email: f.client.email, password: process.env.E2E_PASSWORD!}));
    const register = (requester: ReturnType<typeof api>, target = f) =>
        requester.rpc("course_session_register", {p_run_id: target.run, p_session_id: target.session});
    const standardRegister = await checked(register(company), {requireData: true});
    expect(standardRegister.rows).toEqual([]);
    expect(standardRegister.evidence).toEqual([]);
    expect((await register(company, other)).error?.code).toBe("42501");
    for (const target of [f, other]) await togglePremium(target, true, 0);
    const learner = await linkWorkspaceLearner(f);
    await linkWorkspaceLearner(other);
    for (const target of [f, other]) {
        await checked(target.adminClient.rpc("manage_course_enrolment", {
            p_course_run_id: target.run,
            p_user_id: f.learner.id,
            p_status: "enrolled",
        }));
    }
    await checked(company.rpc("save_course_exam_schedule", {
        p_run_id: f.run, p_title: examTitle,
        p_visible_from: starts, p_starts_at: starts, p_ends_at: ends,
        p_pass_percent: 50, p_version: 0,
    }));
    await checked(company.rpc("set_course_exam_required", {
        p_run_id: f.run, p_required: false, p_expected_version: 1,
    }));
    const attendanceNote = "Fictional reviewed attendance";
    await checked(company.rpc("save_course_session_attendance", {
        p_run_id: f.run, p_session_id: f.session, p_user_id: f.learner.id,
        p_status: "present", p_arrival_at: null, p_departure_at: null, p_note: attendanceNote,
        p_reason: null, p_expected_version: 0,
    }));
    const attendanceBefore = await checked(register(company), {requireData: true});
    expect(attendanceBefore.rows).toMatchObject([{user_id: f.learner.id, status: "present", note: attendanceNote, version: 1}]);
    expect((await register(company, other)).error?.code).toBe("42501");
    expect((await register(learner)).error?.code).toBe("42501");
    const startChat = async (target: typeof f, body: string) => {
        const room = await checked(target.adminClient.rpc("create_chat_group", {
            p_title: `Fictional chat ${target.token}`,
            p_kind: "participant_course",
            p_job_id: target.job,
            p_member_ids: [],
        }), {requireData: true});
        await checked(target.adminClient.rpc("send_course_chat_message", {
            p_room_id: room,
            p_body: body,
            p_client_id: randomUUID(),
        }));
        return room;
    };
    const messageA = "Fictional message for company A";
    const messageB = "Fictional message for company B";
    const roomA = await startChat(f, messageA);
    await startChat(other, messageB);
    const chat = page.getByRole("region", {name: "Kurs-Chat", exact: true});
    const enrolments = () => checked(f.service.from("course_enrolments")
        .select("course_run_id,user_id,status,created_at,updated_at")
        .eq("user_id", f.learner.id).order("course_run_id"), {requireData: true});
    const originalEnrolments = await enrolments();
    expect(originalEnrolments).toHaveLength(2);
    await page.reload();
    for (const target of [f, other]) {
        await expect(page.getByRole("heading", {name: target.title, exact: true})).toBeVisible();
    }
    const learnerSession = await checked(learner.auth.getSession(), {requireData: true});
    expect(learnerSession.session).toBeTruthy();
    const workspace = `/courses/${f.run}/workspace`;
    const exams = async (client = learner) =>
        (await checked(client.rpc("course_workspace", {p_run_id: f.run}), {requireData: true}))
            .exams;
    const examRegion = (actorPage: Page) =>
        actorPage.getByRole("region", {name: "Kursprüfung", exact: true});
    const requestPaper = async (id: string) =>
        page.request.post(`${process.env.SUPABASE_URL}/functions/v1/course-documents`, {
            data: {kind: "exam", id},
            headers: {
                apikey: process.env.SUPABASE_ANON_KEY!,
                Authorization: `Bearer ${learnerSession.session!.access_token}`,
                Origin: new URL(process.env.E2E_BASE_URL!).origin,
            },
        });
    const changeRequirement = async (actorPage: Page, required: boolean) => {
        const panel = examRegion(actorPage);
        await panel
            .getByRole("combobox", {name: "Kursprüfung", exact: true})
            .selectOption(required ? "yes" : "no");
        await panel
            .getByRole("button", {name: "Prüfungseinstellung speichern", exact: true})
            .click();
        await expect.poll(async () => (await exams()).required).toBe(required);
    };
    const upload = async (actorPage: Page, name: string, bytes: Buffer) => {
        const panel = examRegion(actorPage);
        await panel.getByLabel("Prüfungsdatei (PDF)", {exact: true}).setInputFiles({
            name,
            mimeType: "application/pdf",
            buffer: bytes,
        });
        await panel.getByRole("button", {name: "PDF hochladen und freigeben", exact: true}).click();
    };
    const context = {
        baseURL: process.env.E2E_BASE_URL,
        viewport: info.project.use.viewport,
        isMobile: info.project.use.isMobile,
        hasTouch: info.project.use.hasTouch,
        deviceScaleFactor: info.project.use.deviceScaleFactor,
    };
    const companyContext = await browser.newContext(context);
    const teachingContext = await browser.newContext(context);
    try {
        const companyPage = await companyContext.newPage();
        const teacher = await teachingContext.newPage();
        const companyAttendance = companyPage.getByRole("region", {name: "Anwesenheitsliste je Termin", exact: true});
        await page.goto(workspace + "#course-chat");
        await expect(page.getByRole("heading", {name: f.title, exact: true})).toBeVisible();
        await expect(examRegion(page)).toHaveCount(0);
        await expect(chat.getByText(messageA, {exact: true})).toBeVisible();
        await login(companyPage, f.client.email);
        await companyPage.goto(workspace + "#course-register");
        await companyAttendance.getByLabel("Kurstermin", {exact: true}).selectOption(f.session);
        await expect(companyAttendance.getByText("Anwesend: 1", {exact: true})).toBeVisible();
        await companyPage.goto(workspace + "#course-exam");
        await expect(
            examRegion(companyPage).getByRole("option", {
                name: "Lösungsschlüssel für das Kursteam",
                exact: true,
            }),
        ).toHaveCount(0);
        await changeRequirement(companyPage, true);
        await expect(examRegion(companyPage).getByText(/sofort herunterladen/)).toBeVisible();
        await upload(companyPage, "Invalid fictional exam.pdf", Buffer.from("Not a PDF."));
        await expect(
            examRegion(companyPage).getByText(/Die Dateiprüfung konnte nicht bestätigt werden/),
        ).toBeVisible({timeout: 45_000});
        expect((await exams()).documents).toEqual([]);
        const bytes = accountingTestPdf();
        const paper = `Fictional exam ${f.token}.pdf`;
        await upload(companyPage, paper, bytes);
        await expect(examRegion(companyPage).getByText(examTitle, {exact: true})).toBeVisible({
            timeout: 45_000,
        });
        const [published] = (await exams()).documents;
        expect(published.name).toBe(paper);
        await page.goto(workspace + "#course-exam");
        await expect(examRegion(page).getByText(examTitle, {exact: true})).toBeVisible();
        const downloaded = page.waitForEvent("download");
        await examRegion(page)
            .getByRole("button", {name: "PDF herunterladen", exact: true})
            .click();
        const download = await downloaded;
        expect(download.suggestedFilename()).toBe(`${examTitle}.pdf`);
        expect(await readFile((await download.path())!)).toEqual(bytes);

        await login(teacher, f.teacher.email);
        await teacher.goto(workspace + "#course-exam");
        await examRegion(teacher)
            .getByLabel("Dokumenttyp", {exact: true})
            .selectOption("exam_staff");
        const answer = `Fictional answer key ${f.token}.pdf`;
        await upload(teacher, answer, bytes);
        await expect(examRegion(teacher).getByText(answer, {exact: true})).toBeVisible({
            timeout: 45_000,
        });
        const teachingClient = api(process.env.SUPABASE_ANON_KEY!);
        await checked(
            teachingClient.auth.signInWithPassword({
                email: f.teacher.email,
                password: process.env.E2E_PASSWORD!,
            }),
        );
        const restricted = (await exams(teachingClient)).documents.find(
            (document: {name: string}) => document.name === answer,
        );
        expect(restricted.audience).toBe("exam_staff");
        expect((await requestPaper(restricted.id)).status()).toBe(403);
        await companyPage.reload();
        await expect(examRegion(companyPage).getByText(examTitle, {exact: true})).toBeVisible();
        await expect(examRegion(companyPage).getByText(answer, {exact: true})).toHaveCount(0);
        expect((await exams()).documents.map((document: {id: string}) => document.id)).toEqual([
            published.id,
        ]);
        await changeRequirement(teacher, false);
        await expect(examRegion(teacher).getByText(examTitle, {exact: true})).toBeVisible();
        const hidden = await requestPaper(published.id);
        expect(hidden.status()).toBe(403);
        expect(await hidden.json()).toMatchObject({error: "document_unavailable"});
        await page.reload();
        await expect(page.getByRole("heading", {name: f.title, exact: true})).toBeVisible();
        await expect(examRegion(page)).toHaveCount(0);
        await changeRequirement(teacher, true);
        await page.reload();
        await expect(examRegion(page).getByText(examTitle, {exact: true})).toBeVisible();
        await expect(examRegion(page).getByText(answer, {exact: true})).toHaveCount(0);

        await page.context().setOffline(true);
        const workspaceRequest = "**/rest/v1/rpc/course_workspace";
        let releaseRead!: () => void;
        const holdRead = new Promise<void>((resolve) => { releaseRead = resolve; });
        await page.route(workspaceRequest, async (route) => {
            await holdRead;
            await route.continue();
        });
        try {
            await expect(page.getByText(/Verbinde dich mit dem Internet, um den aktuellen Zugriff/)).toBeVisible();
            await expect(examRegion(page)).toHaveCount(0);
            await expect(chat).toHaveCount(0);
            await togglePremium(f, false, 1);
            // Delay delivery of the real response and check the warm content while waiting.
            const recheck = page.waitForRequest(workspaceRequest);
            await page.context().setOffline(false);
            await recheck;
            await expect(examRegion(page)).toHaveCount(0);
            await expect(chat).toHaveCount(0);
        } finally {
            releaseRead();
            await page.context().setOffline(false);
        }
        await expect(page.getByText("Kurs in Bearbeitung", {exact: true})).toBeVisible({timeout: 30_000});
        await page.unroute(workspaceRequest);
        await expect(examRegion(page)).toHaveCount(0);
        expect((await requestPaper(published.id)).status()).toBe(403);
        expect((await learner.rpc("course_chat_messages", {p_room_id: roomA})).error?.code).toBe("42501");
        expect((await register(company)).error).toBeNull();
        await companyPage.reload();
        await expect(companyPage.getByRole("heading", {name: f.title, exact: true})).toBeVisible();
        await expect(companyAttendance).toBeVisible();
        await companyAttendance.getByLabel("Kurstermin", {exact: true}).selectOption(f.session);
        await expect(companyAttendance.getByText("Anwesend: 1", {exact: true})).toBeVisible();
        await expect(examRegion(companyPage)).toHaveCount(0);

        await page.goto("/learning");
        await expect(page.getByRole("heading", {name: other.title, exact: true})).toBeVisible();
        await expect(page.getByRole("heading", {name: f.title, exact: true})).toBeVisible();
        await page.getByRole("link", {name: other.title, exact: true}).click();
        await expect(page.getByRole("heading", {name: other.title, exact: true})).toBeVisible();
        await page.goto(`/courses/${other.run}/workspace#course-chat`);
        await expect(chat.getByText(messageB, {exact: true})).toBeVisible();
        await expect(chat.getByText(messageA, {exact: true})).toHaveCount(0);
        const reply = "Fictional learner reply while company A is OFF";
        await chat.getByRole("textbox", {name: "Nachricht", exact: true}).fill(reply);
        await chat.getByRole("button", {name: "Nachricht senden", exact: true}).click();
        await expect(chat.getByText(reply, {exact: true})).toBeVisible();
        await expect(examRegion(page).getByText(examTitle, {exact: true})).toHaveCount(0);
        expect(await enrolments()).toEqual(originalEnrolments);

        await togglePremium(f, true, 2);
        const restored = await requestPaper(published.id);
        expect(restored.status()).toBe(200);
        expect(await restored.body()).toEqual(bytes);
        expect((await exams()).documents.map((document: {id: string}) => document.id)).toEqual([
            published.id,
        ]);
        expect((await checked(register(company), {requireData: true})).rows).toEqual(attendanceBefore.rows);
        expect(await enrolments()).toEqual(originalEnrolments);
        await companyPage.reload();
        await companyPage.goto(workspace + "#course-register");
        await companyAttendance.getByLabel("Kurstermin", {exact: true}).selectOption(f.session);
        await expect(companyAttendance.getByText("Anwesend: 1", {exact: true})).toBeVisible();
        await page.goto("/learning");
        for (const target of [f, other]) {
            await expect(page.getByRole("heading", {name: target.title, exact: true})).toBeVisible();
        }
        await page.getByRole("link", {name: f.title, exact: true}).click();
        await page.goto(workspace + "#course-exam");
        await expect(examRegion(page).getByText(examTitle, {exact: true})).toBeVisible();
        await page.goto(workspace + "#course-chat");
        await expect(chat.getByText(messageA, {exact: true})).toBeVisible();
    } finally {
        await companyContext.close();
        await teachingContext.close();
    }
});

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

    const course = async (title: string, company = organisation, published = true) => {
        const template = randomUUID();
        const id = randomUUID();
        const sessions = [randomUUID(), randomUUID()];
        await checked(service.from("course_templates").insert({id: template, title}));
        await checked(service.from("course_runs").insert({
            id, template_id: template, organisation_id: company,
            time_zone: "Australia/Brisbane", published,
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
        draft: await course("Fictional unpublished-only course", organisation, false),
    };
}

test("Premium company multi-course enrolment is confirmed atomically across real browser roles", async ({page, browser}) => {
    test.setTimeout(120000);
    const f = await fixture({upcoming: true});
    const {first, second, third, stale, foreign, draft} = await enrolmentOptions(f.service, f.org);
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
    await expect(choice(draft)).toHaveCount(0);
    // A filled offer publishes this option to the owning company's picker.
    await expect(choice(f)).toBeVisible();
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
        .getByLabel("Unternehmenskontakt für diesen Kurs freigeben", {exact: true})
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
    await page.goto(`/courses/${f.run}/workspace#course-materials`);
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
    await resources.getByText("Vorhandene Dateifassung freigeben", {exact: true}).click();
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
        await customer.goto(`/courses/${f.run}/workspace#course-materials`);
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
        await customer.goto(`/courses/${f.run}/workspace#course-overview`);
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
            .getByLabel("E-Mail", {exact: true})
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

test("company meeting link, instructor checklist and clocked class attendance", async ({page, browser}) => {
    const f = await fixture({upcoming: true});
    const now = Date.now();
    await checked(f.service.from("course_sessions").update({
        starts_at: new Date(now - 10 * 60000).toISOString(),
        ends_at: new Date(now + 50 * 60000).toISOString(),
    }).eq("id", f.session));
    await linkWorkspaceLearner(f);
    await checked(f.adminClient.rpc("manage_course_enrolment", {
        p_course_run_id: f.run, p_user_id: f.learner.id, p_status: "enrolled",
    }));
    await checked(f.adminClient.rpc("set_course_class", {
        p_course_id: f.run, p_new_name: "Fictional live class", p_class_id: null, p_expected_version: 0,
    }));
    const workspace = `/courses/${f.run}/workspace`;
    const meeting = "https://learning.example.invalid/fictional-live-room";
    await login(page, f.client.email);
    await page.goto(workspace);
    await page.getByRole("button", {name: "Meetinglink bearbeiten"}).click();
    await page.getByRole("textbox", {name: "Meetinglink (HTTPS)"}).fill(meeting);
    await page.getByRole("button", {name: "Meetinglink veröffentlichen"}).click();
    await expect(page.getByRole("link", {name: "Unterrichtslink öffnen"})).toHaveAttribute("href", meeting);

    const context = await browser.newContext({viewport: page.viewportSize() ?? undefined});
    try {
        const instructor = await context.newPage();
        await login(instructor, f.teacher.email);
        await instructor.goto(workspace);
        const checklist = instructor.getByRole("region", {name: "Checkliste für die Kursdurchführung"});
        await expect(checklist.getByText("Meetinglink vorhanden")).toBeVisible();
        await instructor.goto(workspace + "#course-register");
        await instructor.getByRole("button", {name: "Jetzt gekommen"}).click();
        const register = () => checked(f.adminClient.rpc("course_session_register", {
            p_run_id: f.run, p_session_id: f.session,
        }));
        await expect.poll(async () => (await register()).rows[0].version).toBe(1);
        await instructor.getByRole("button", {name: "Jetzt gegangen"}).click();
        await expect.poll(async () => (await register()).rows[0].version).toBe(2);
        const row = (await register()).rows[0];
        expect(row.status).toBe("present");
        expect(Date.parse(row.arrival_at)).toBeGreaterThanOrEqual(now);
        expect(Date.parse(row.departure_at)).toBeGreaterThanOrEqual(Date.parse(row.arrival_at));

        await page.goto(workspace + "#course-register");
        await page.reload();
        await page.getByText("Anwesenheitsverlauf", {exact: true}).click();
        await expect(page.getByText(/Klasse Fictional live class · 1/)).toBeVisible();
        await expect(page.getByRole("region", {name: "Anwesenheitsverlauf"}).getByRole("row").filter({hasText: f.learner.name})).toBeVisible();
        const localTime = (instant: string) => DateTime.fromISO(instant, {zone: "Europe/Berlin"})
            .toFormat("yyyy-MM-dd'T'HH:mm");
        await expect(page.getByLabel("Ankunft (optional)", {exact: true})).toHaveValue(localTime(row.arrival_at));
        await expect(page.getByLabel("Ende der Anwesenheit (optional)", {exact: true})).toHaveValue(localTime(row.departure_at));
    } finally {
        await context.close();
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

for (const asTeam of [false, true]) test(`${asTeam ? "Team" : "Versioned"} assignment uses the scanner, requests a revision and releases private feedback`, async ({page, browser}, info) => {
    test.setTimeout(120_000);
    const f = await fixture({upcoming: true});
    await linkWorkspaceLearner(f);
    await checked(f.adminClient.rpc("manage_course_enrolment", {
        p_course_run_id: f.run, p_user_id: f.learner.id, p_status: "enrolled",
    }));
    const teammate = asTeam ? await actor("Fictional lab teammate", "participant") : undefined;
    if (teammate) {
        await linkWorkspaceLearner({...f, learner: teammate});
        await checked(f.adminClient.rpc("manage_course_enrolment", {
            p_course_run_id: f.run, p_user_id: teammate.id, p_status: "enrolled",
        }));
    }
    const workspace = `/courses/${f.run}/workspace#course-submissions`;
    const scope = (target: Page) => target.getByRole("region", {name: "Kursaufgaben", exact: true});
    const prepare = async (target: Page) => {
        if (target.url().endsWith(workspace)) await target.reload();
        else await target.goto(workspace);
        await scope(target).getByRole("combobox", {name: "Aufgabe auswählen", exact: true})
            .selectOption({label: "Fiktive Laboraufgabe"});
    };
    await login(page, f.manager.email);
    await page.goto(workspace);
    const author = scope(page);
    await author.getByRole("button", {name: "Aufgabe erstellen", exact: true}).click();
    await author.getByLabel("Titel der Aufgabe", {exact: true}).fill("Fiktive Laboraufgabe");
    await author.getByLabel("Arbeitsauftrag", {exact: true}).fill("Lade ein fiktives Laborprotokoll hoch.");
    await author.getByLabel("Name des Kriteriums", {exact: true}).fill("Protokoll");
    const bands = author.getByLabel("Name der Stufe", {exact: true});
    await bands.nth(0).fill("Offen");
    await bands.nth(1).fill("Vollständig");
    await author.getByRole("button", {name: "Entwurf speichern", exact: true}).click();
    await author.getByRole("button", {name: "Aufgabe veröffentlichen", exact: true}).click();
    await expect(author.getByText("Version 1 veröffentlicht", {exact: true})).toBeVisible();
    if (teammate) {
        await author.getByText("Abgabeteams", {exact: true}).click();
        await author.getByLabel("Teamname", {exact: true}).fill("Fiktives Laborteam");
        await author.getByRole("checkbox", {name: "Fictional Müller Μαρία Мария", exact: true}).check();
        await author.getByRole("checkbox", {name: "Fictional lab teammate", exact: true}).check();
        await author.getByRole("button", {name: "Team speichern", exact: true}).click();
        await expect(author.getByRole("combobox", {name: "Team auswählen", exact: true})).toBeVisible();
    }
    const browserOptions = {
        viewport: page.viewportSize() ?? undefined,
        isMobile: info.project.use.isMobile,
        hasTouch: info.project.use.hasTouch,
    };
    const learnerContext = await browser.newContext(browserOptions);
    const teamContext = teammate ? await browser.newContext(browserOptions) : undefined;
    try {
        const learner = await learnerContext.newPage();
        const peerPage = await teamContext?.newPage();
        await login(learner, f.learner.email, /\/learning$/);
        await prepare(learner);
        const submission = scope(learner);
        if (peerPage && teammate) {
            await login(peerPage, teammate.email, /\/learning$/);
            await prepare(peerPage);
            await expect(scope(peerPage).getByText(/Team Fiktives Laborteam/)).toBeVisible();
        }
        const submit = async (target: Page, name: string, body: string) => {
            const form = scope(target);
            await form.getByLabel("Datei auswählen", {exact: true}).setInputFiles({
                name, mimeType: "text/plain", buffer: Buffer.from(body),
            });
            await form.getByRole("button", {name: "Datei abgeben", exact: true}).click();
            await expect(form.getByText(name, {exact: true})).toBeVisible();
        };
        const firstFile = "fiktives-protokoll.txt";
        const firstBytes = "Fiktives Laborprotokoll Teil 1\n";
        await submit(learner, firstFile, firstBytes);

        if (peerPage) {
            await prepare(peerPage);
            const peerAttempt = scope(peerPage).getByRole("listitem").filter({hasText: firstFile});
            const [sharedDownload] = await Promise.all([
                peerPage.waitForEvent("download", {timeout: 15_000}),
                peerAttempt.getByRole("button", {name: "Herunterladen", exact: true}).click(),
            ]);
            expect(await readFile(await sharedDownload.path(), "utf8")).toBe(firstBytes);
        }

        await prepare(page);
        const first = author.getByRole("listitem").filter({hasText: firstFile});
        const [download] = await Promise.all([
            page.waitForEvent("download", {timeout: 15_000}),
            first.getByRole("button", {name: "Herunterladen", exact: true}).click(),
        ]);
        expect(await readFile(await download.path(), "utf8")).toBe(firstBytes);
        await first.getByLabel("Rückmeldung für Teilnehmende", {exact: true}).fill("Bitte ergänze die Beobachtungen.");
        await first.getByLabel("Private Notiz für das Kursteam", {exact: true}).fill("Nur im Kursteam sichtbar");
        await first.getByRole("combobox", {name: "Veröffentlichung", exact: true}).selectOption("revision_requested");
        await first.getByRole("button", {name: "Rückmeldung speichern", exact: true}).click();
        await expect(first.getByText("Überarbeitung erbeten", {exact: true})).toBeVisible();

        await prepare(learner);
        await expect(submission.getByText("Bitte ergänze die Beobachtungen.")).toBeVisible();
        await expect(submission.getByText("Nur im Kursteam sichtbar")).toHaveCount(0);
        const secondFile = "fiktive-ueberarbeitung.txt";
        if (peerPage) await prepare(peerPage);
        await submit(peerPage ?? learner, secondFile, "Fiktives Laborprotokoll mit Beobachtungen.\n");
        await prepare(page);
        const second = author.getByRole("listitem").filter({hasText: secondFile});
        const importButton = author.getByRole("button", {name: "Aufgabenbewertungen importieren"});
        await importButton.press("Enter");
        const grades = page.getByRole("dialog", {name: "Aufgabenbewertungen importieren"});
        const capture = page.waitForEvent("download");
        await grades.getByRole("button", {name: "Excel-Vorlage herunterladen"}).click();
        const workbook = await readFile(await (await capture).path());
        await grades.getByLabel("Notentabelle auswählen").setInputFiles({
            name: "assignment-grades.xlsx",
            mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            buffer: await fillWorkbookCell(workbook, "G2", 1, asTeam ? "Fiktives Laborteam" : "Fictional Müller"),
        });
        await expect(grades.getByText("Offen → 1")).toBeVisible();
        await grades.getByRole("button", {name: "1 Note als Entwurf speichern"}).press("Enter");
        await expect(grades.getByText("1 Note wurde als Entwurf gespeichert.")).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(importButton).toBeFocused();
        await expect(second.getByRole("combobox", {name: "Protokoll", exact: true})).toHaveValue("1");
        await prepare(learner);
        await expect(submission.getByText("1 / 1 Punkte", {exact: true})).toHaveCount(0);
        await second.getByRole("combobox", {name: "Veröffentlichung", exact: true}).selectOption("released");
        await second.getByRole("button", {name: "Rückmeldung speichern", exact: true}).click();
        await expect(second.getByText("Rückmeldung freigegeben", {exact: true})).toBeVisible();
        await prepare(learner);
        await expect(submission.getByText("1 / 1 Punkte", {exact: true})).toBeVisible();
        await expect(submission.getByRole("button", {name: "Datei abgeben", exact: true})).toHaveCount(0);
        if (peerPage) {
            await prepare(peerPage);
            await expect(scope(peerPage).getByText("1 / 1 Punkte", {exact: true})).toBeVisible();
            expect((await new AxeBuilder({page: peerPage}).include("#course-submissions").analyze()).violations).toEqual([]);
        }
    } finally {
        await Promise.all([learnerContext.close(), teamContext?.close()]);
    }
});

test("Private course submission uses the real scanner, current staff access and withdrawal", async ({page, browser}, info) => {
    test.setTimeout(120_000);
    const f = await fixture({upcoming: true});
    await linkWorkspaceLearner(f);
    await checked(f.adminClient.rpc("manage_course_enrolment", {
        p_course_run_id: f.run, p_user_id: f.learner.id, p_status: "enrolled",
    }));
    const workspace = `/courses/${f.run}/workspace#course-submissions`;
    const filename = "fictional-lab-work.txt";
    const fileBytes = Buffer.from("Fictional classroom exercise\n");
    await login(page, f.client.email);
    await expect(page.getByRole("main")).toBeVisible();
    await page.goto(workspace);
    const control = page.getByRole("region", {name: "Dateiabgaben", exact: true});
    await control.getByRole("button", {name: "Dateiabgaben erlauben", exact: true}).click();
    await expect(control.getByRole("button", {name: "Dateiabgaben schließen", exact: true})).toBeVisible();
    await expect(control.getByLabel("Datei auswählen", {exact: true})).toHaveCount(0);

    const browserOptions = {
        viewport: page.viewportSize() ?? undefined,
        isMobile: info.project.use.isMobile,
        hasTouch: info.project.use.hasTouch,
    };
    const learnerContext = await browser.newContext(browserOptions);
    const reviewerContext = await browser.newContext(browserOptions);
    try {
        const learner = await learnerContext.newPage();
        await login(learner, f.learner.email, /\/learning$/);
        await learner.goto(workspace);
        const submissions = learner.getByRole("region", {name: "Dateiabgaben", exact: true});
        await expect(submissions.getByRole("button", {name: "Dateiabgaben schließen", exact: true})).toHaveCount(0);
        await submissions.getByLabel("Datei auswählen", {exact: true}).setInputFiles({
            name: filename, mimeType: "text/plain", buffer: fileBytes,
        });
        await submissions.getByRole("button", {name: "Datei abgeben", exact: true}).click();
        await expect(submissions.getByText("Die geprüfte Datei wurde abgegeben.", {exact: true})).toBeVisible();
        await expect(submissions.getByText(filename, {exact: true})).toBeVisible();

        const reviewer = await reviewerContext.newPage();
        await login(reviewer, f.teacher.email);
        await reviewer.goto(workspace);
        await reviewer.getByLabel("Sprache", {exact: true}).selectOption("en");
        await reviewer.getByLabel("Theme", {exact: true}).selectOption("dark");
        const review = reviewer.getByRole("region", {name: "File submissions", exact: true});
        const downloadButton = review.getByRole("button", {name: `Download file: ${filename}`, exact: true});
        await expect(downloadButton).toBeVisible();
        await expect(review.getByRole("button", {name: `Withdraw submission: ${filename}`, exact: true})).toHaveCount(0);
        expect((await new AxeBuilder({page: reviewer}).include("#course-submissions").analyze()).violations
            .map(({id, nodes}) => ({id, nodes: nodes.map((node) => node.target)}))).toEqual([]);
        const [download] = await Promise.all([reviewer.waitForEvent("download"), downloadButton.click()]);
        expect(download.suggestedFilename()).toBe(filename);
        expect(await readFile(await download.path())).toEqual(fileBytes);

        await submissions.getByRole("button", {name: `Abgabe zurückziehen: ${filename}`, exact: true}).click();
        await learner.getByRole("dialog", {name: "Abgabe zurückziehen", exact: true})
            .getByRole("button", {name: "Abgabe zurückziehen", exact: true}).click();
        await expect(submissions.getByText(filename, {exact: true})).toHaveCount(0);
        await reviewer.reload();
        await expect(review.getByText("There are no submissions on this page.", {exact: true})).toBeVisible();
        await expect(downloadButton).toHaveCount(0);
    } finally {
        await Promise.all([learnerContext.close(), reviewerContext.close()]);
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
    await linkWorkspaceLearner(f);

    await adminLogin(page,f.manager);
    await page.goto(`/courses/${f.run}/workspace#course-register`);
    const attendance = page.getByRole("region", {name: "Anwesenheitsliste je Termin", exact: true});
    await expect(attendance.getByText("Keine eingeschriebenen Teilnehmenden.", {exact: true})).toBeVisible();
    await page.goto(`/courses/${f.run}/workspace#course-enrolments`);
    await page.getByLabel("Teilnehmende Person",{exact:true}).selectOption(f.learner.id);
    await page.getByRole("button",{name:"Zum Kurs anmelden",exact:true}).click();
    await page.getByRole("dialog").getByRole("button",{name:"Bestätigen",exact:true}).click();
    await expect(page.getByText("Kursanmeldung aktualisiert.",{exact:true})).toBeVisible();

    // Switch back to the mounted session register without a full document reload.
    await page.goto(`/courses/${f.run}/workspace#course-register`);
    await expect(attendance.getByText("Keine eingeschriebenen Teilnehmenden.", {exact: true})).toHaveCount(0);
    await attendance.getByText("Anwesenheit aus CSV oder XLSX übernehmen",{exact:true}).click();
    const csvTemplate = attendance.getByRole("link", {name: "CSV-Vorlage laden", exact: true});
    const workbookTemplate = attendance.getByRole("button", {name: "XLSX-Vorlage laden", exact: true});
    await expect(csvTemplate).toBeVisible();
    await expect(workbookTemplate).toBeVisible();
    const csvTemplateBox = (await csvTemplate.boundingBox())!;
    const workbookTemplateBox = (await workbookTemplate.boundingBox())!;
    expect(Math.max(
        workbookTemplateBox.x - (csvTemplateBox.x + csvTemplateBox.width),
        workbookTemplateBox.y - (csvTemplateBox.y + csvTemplateBox.height),
    )).toBeGreaterThanOrEqual(11);
    const formatRules = attendance.getByText("Formatregeln für die Vorlage", {exact: true});
    const offsetHelp = attendance.getByText(/Zeiten als Text mit UTC-Offset/);
    await expect(offsetHelp).toBeHidden();
    await formatRules.press("Enter");
    await expect(offsetHelp).toBeVisible();
    await formatRules.press("Enter");
    await expect(offsetHelp).toBeHidden();
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

test("company filters live Premium LMS analytics without exposing learners", async ({ page }, info) => {
    test.setTimeout(90_000);
    const f = await fixture();
    await linkWorkspaceLearner(f);
    await checked(f.adminClient.rpc("manage_course_enrolment", {
        p_course_run_id: f.run,
        p_user_id: f.learner.id,
        p_status: "enrolled",
    }));
    await checked(f.service.from("course_runs").update({ published: true }).eq("id", f.run));
    const english = info.project.name.startsWith("mobile");
    const title = english ? "LMS analytics" : "LMS-Analysen";
    await login(page, f.client.email);
    await page.goto("/analytics");
    await page.getByLabel(/^Sprache$|^Language$/).selectOption(english ? "en" : "de");
    await page.getByLabel(/^Farbschema$|^Theme$/).selectOption(english ? "dark" : "light");
    await expect(page.getByRole("link", { name: title, exact: true })).toBeVisible();
    await page.getByRole("link", { name: title, exact: true }).click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    const breakdown = page.getByRole("region", {
        name: english ? "Metrics by course" : "Kennzahlen je Kurs",
    });
    const row = breakdown.getByRole("row").filter({ hasText: f.title });
    await expect(row.getByRole("cell").nth(2)).toHaveText("1");
    await expect(page.getByText(f.learner.name, { exact: true })).toHaveCount(0);
    await expect(page.locator("html")).toHaveAttribute("data-theme", english ? "dark" : "light");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    if (english) {
        expect(await breakdown.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    }
    await page.getByLabel(english ? "Course status" : "Kursstatus").selectOption("upcoming");
    await expect(page.getByText(english
        ? "No courses match this selection."
        : "Für diese Auswahl wurden keine Kurse gefunden.")).toBeVisible();
    await page.getByLabel(english ? "Course status" : "Kursstatus").selectOption("finished");
    await expect(row).toBeVisible();
    await page.getByRole("searchbox").fill("does not match any course");
    await page.getByRole("button", { name: english ? "Search" : "Suchen", exact: true }).click();
    await expect(row).toHaveCount(0);
});

test("scoped LMS assessment exports protect small cohorts and company views", async ({ page, browser, baseURL }, info) => {
    test.setTimeout(100_000);
    const f = await fixture();
    await linkWorkspaceLearner(f);
    await checked(f.adminClient.rpc("manage_course_enrolment", {
        p_course_run_id: f.run, p_user_id: f.learner.id, p_status: "enrolled",
    }));
    const english = info.project.name.startsWith("mobile");
    const chooseLanguage = async (target: Page) => {
        await target.getByLabel(/^Sprache$|^Language$/).selectOption(english ? "en" : "de");
    };
    await login(page, f.manager.email);
    await page.goto("/admin/finance/analytics/learning");
    await chooseLanguage(page);
    // The staff report spans all companies. Select this fixture explicitly
    // before exporting, even when earlier journeys have filled its first page.
    await page.getByRole("searchbox").fill(f.title);
    await page.getByRole("button", { name: english ? "Search" : "Suchen", exact: true }).click();
    const assessmentName = english ? "Assessments and submissions by course" : "Bewertungen und Abgaben je Kurs";
    const assessment = page.getByRole("region", { name: assessmentName });
    const row = assessment.getByRole("row").filter({ hasText: f.title });
    await expect(row).toBeVisible();
    await expect(row.getByRole("cell", { name: "—", exact: true })).toHaveCount(11);
    const [csv] = await Promise.all([
        page.waitForEvent("download", { timeout: 15_000 }),
        page.getByRole("button", { name: english ? "CSV for this page" : "CSV dieser Seite" }).click(),
    ]);
    const filename = csv.suggestedFilename();
    expect(filename).toMatch(/\.csv$/);
    const exportText = await readFile(await csv.path(), "utf8");
    expect(exportText).toContain(f.title);
    expect(exportText).toContain(english ? "Quiz attempts" : "Quizversuche");
    expect(exportText).not.toContain(f.learner.name);
    expect(exportText).not.toContain(f.learner.id);

    const [xlsx] = await Promise.all([
        page.waitForEvent("download", { timeout: 15_000 }),
        page.getByRole("button", { name: english ? "XLSX for this page" : "XLSX dieser Seite" }).click(),
    ]);
    expect(xlsx.suggestedFilename()).toMatch(/\.xlsx$/);
    expect((await readFile(await xlsx.path())).subarray(0, 2).toString("ascii")).toBe("PK");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);

    // Emulate print media and export the real Chromium-rendered page. Invoke
    // the browser dialog only in interactive usage, not in the test runner.
    await page.evaluate(() => { window.print = () => {}; });
    await page.getByRole("button", { name: english ? "Print this page" : "Diese Seite drucken" }).click();
    const printReport = page.locator(".learning-report-print");
    await expect(printReport).toHaveCount(1);
    await expect(printReport).toBeHidden();
    await page.emulateMedia({ media: "print" });
    await expect(printReport).toBeVisible();
    await expect(printReport.getByText(f.title)).toBeVisible();
    await expect(assessment).toBeHidden();
    expect((await page.pdf({preferCSSPageSize: true})).subarray(0, 5).toString("ascii")).toBe("%PDF-");
    await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
    await page.emulateMedia({ media: "screen" });

    const company = await browser.newContext({
        baseURL, viewport: info.project.use.viewport, isMobile: info.project.use.isMobile, hasTouch: info.project.use.hasTouch,
    });
    try {
        const companyPage = await company.newPage();
        await login(companyPage, f.client.email);
        await companyPage.goto("/client/finance/analytics/learning");
        await chooseLanguage(companyPage);
        await expect(companyPage.getByRole("region", {
            name: english ? "Metrics by course" : "Kennzahlen je Kurs",
        }).getByText(f.title)).toBeVisible();
        await expect(companyPage.getByRole("region", { name: assessmentName })).toHaveCount(0);
        const [companyExport] = await Promise.all([
            companyPage.waitForEvent("download", { timeout: 15_000 }),
            companyPage.getByRole("button", { name: english ? "CSV for this page" : "CSV dieser Seite" }).click(),
        ]);
        const companyRows = await readFile(await companyExport.path(), "utf8");
        expect(companyRows).toContain(f.title);
        expect(companyRows).not.toContain(english ? "Quiz attempts" : "Quizversuche");
        expect(companyRows).not.toContain(f.learner.name);
    } finally {
        await company.close();
    }
});

test("course staff can review a SCORM 1.2 ZIP locally without launching or uploading it", async ({ page, browser, baseURL }, info) => {
    const f = await fixture();
    const language = info.project.name.startsWith("mobile") ? "en" : "de";
    const english = language === "en";
    const regionName = english ? "SCORM 1.2 package review" : "SCORM-1.2-Paketprüfung";
    const workspace = "/courses/" + f.run + "/workspace#course-materials";
    await login(page, f.manager.email);
    await page.goto(workspace);
    await page.getByLabel(/^Sprache$|^Language$/).selectOption(language);
    const review = page.getByRole("region", { name: regionName });
    const bytes = Buffer.from(await scormFixtureZip());
    const uploads: string[] = [];
    page.on("request", (request) => {
        if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/functions/v1/files"))
            uploads.push(request.method());
    });
    await review.getByLabel(english ? "Choose SCORM ZIP" : "SCORM-ZIP auswählen").setInputFiles({
        name: "fictional-course.zip", mimeType: "application/zip", buffer: bytes,
    });
    await review.getByRole("button", { name: english ? "Review package" : "Paket prüfen" }).click();
    await expect(review.getByText(createHash("sha256").update(bytes).digest("hex"), { exact: true })).toBeVisible();
    await expect(review.getByText("Exercise <summary>", { exact: true })).toBeVisible();
    await expect(review.locator("summary,iframe,script")).toHaveCount(0);
    await expect(review.getByRole("link")).toHaveCount(0);
    expect(uploads).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await review.getByLabel(english ? "Choose SCORM ZIP" : "SCORM-ZIP auswählen").setInputFiles({
        name: "not-an-archive.zip", mimeType: "application/zip", buffer: Buffer.from("fictional invalid archive"),
    });
    await review.getByRole("button", { name: english ? "Review package" : "Paket prüfen" }).click();
    await expect(review.getByRole("alert")).toContainText(english ? "readable ZIP" : "lesbares ZIP");
    await expect(review.getByText("Exercise <summary>", { exact: true })).toHaveCount(0);

    const company = await browser.newContext({
        baseURL, viewport: info.project.use.viewport, isMobile: info.project.use.isMobile, hasTouch: info.project.use.hasTouch,
    });
    try {
        const companyPage = await company.newPage();
        await login(companyPage, f.client.email);
        await companyPage.goto(workspace);
        await companyPage.getByLabel(/^Sprache$|^Language$/).selectOption(language);
        await expect(companyPage.getByRole("heading", { name: f.title, exact: true })).toBeVisible();
        await expect(companyPage.getByRole("region", { name: regionName })).toHaveCount(0);
    } finally {
        await company.close();
    }
});

test("completed Premium course records a named closeout follow-up without resending it", async ({page}) => {
    const f = await fixture();
    await linkWorkspaceLearner(f);
    await checked(f.adminClient.rpc("manage_course_enrolment", {
        p_course_run_id: f.run,
        p_user_id: f.learner.id,
        p_status: "enrolled",
    }));
    const {run, manager} = f;
    await adminLogin(page, manager);
    await page.goto(`/courses/${run}/workspace#course-closeout`);
    const closeout = page.locator("#course-closeout");
    await expect(closeout.getByRole("heading", {name: "Kursabschluss", exact: true})).toBeVisible();
    await expect(closeout.getByRole("listitem").filter({hasText: "Fictional Müller Μαρία Мария"})).toBeVisible();
    const accept = closeout.getByRole("button", {name: "Kursabschluss bestätigen"});
    await expect(accept).toBeDisabled();
    await page.getByLabel(/Verantwortliche Person · Fehlende Anwesenheitseinträge/).selectOption(manager.id);
    await accept.click();
    await expect(page.getByText(/Abschluss bestätigt/)).toBeVisible();
    await expect(page.getByRole("link", {name: /Fictional course workspace manager.*Offen/})).toHaveAttribute("href", /workbench\?task=/);
    await page.reload();
    await expect(page.getByText(/Abschluss bestätigt/)).toBeVisible();
    await expect(accept).toHaveCount(0);
    await page.getByRole("link", {name: /Fictional course workspace manager.*Offen/}).click();
    await expect(page.getByRole("heading", {name: /Kursabschluss prüfen/})).toBeVisible();
    await page.getByRole("button", {name: "Als erledigt markieren"}).click();
    await expect(page.getByText("Status gespeichert.")).toBeVisible();
    await page.getByRole("link", {name: "Zum Kursabschluss"}).click();
    await expect(page.getByRole("link", {name: /Fictional course workspace manager.*Erledigt/})).toBeVisible();

});

/** Exercise the scanner, exact download, inert launch and learner-owned progress. */
for (const premium of [true, false]) {
    test(`published SCORM lessons open in a sandbox and retain learner completion (${premium ? "Premium" : "Standard"})`, async ({page, browser, baseURL}, info) => {
        test.setTimeout(120_000);
        const f = await fixture({premium});
        await linkWorkspaceLearner(f);
        await checked(f.adminClient.rpc("manage_course_enrolment", {
            p_course_run_id: f.run, p_user_id: f.learner.id, p_status: "enrolled",
        }));
        const workspace = `/courses/${f.run}/workspace#course-materials`;
        const openStandardScorm = async (target: Page) => {
            if (!premium) await target.getByText("SCORM-Kursinhalte", {exact: true}).click();
        };
        await adminLogin(page, f.manager);
        await page.goto(workspace);
        await openStandardScorm(page);
        const review = page.getByRole("region", {name: "SCORM-1.2-Paketprüfung"});
        await review.getByLabel("SCORM-ZIP auswählen").setInputFiles({
            name: "fictional-course.zip", mimeType: "application/zip", buffer: Buffer.from(await scormFixtureZip()),
        });
        await review.getByRole("button", {name: "Paket prüfen"}).press("Enter");
        const publish = review.getByRole("button", {name: "Paket veröffentlichen"});
        await expect(publish).toBeEnabled();
        if (!premium) {
            await expect(review.getByLabel("Interaktive SCORM-Wiedergabe")).toHaveCount(0);
            await expect(page.getByRole("region", {name: "Kursprüfung", exact: true})).toHaveCount(0);
        }
        await publish.press("Enter");
        await expect(review.getByText("Paket für den Kurs veröffentlicht.")).toBeVisible({timeout: 45_000});
        const staffPanel = page.getByRole("region", {name: "SCORM-Lernpakete"});
        const scoped = await staffPanel.getByLabel("Lernpaket auswählen").locator("option").all();
        expect(scoped).toHaveLength(2);
        const packageId = await scoped[1].getAttribute("value");
        expect(packageId).toMatch(/^[0-9a-f-]{36}$/);
        await staffPanel.getByLabel("Lernpaket auswählen").selectOption({label: "Fictional package"});

        const learnerContext = await browser.newContext({
            baseURL, viewport: info.project.use.viewport,
            isMobile: info.project.use.isMobile, hasTouch: info.project.use.hasTouch,
        });
        try {
            const learnerPage = await learnerContext.newPage();
            await login(learnerPage, f.learner.email, /\/learning$/);
            await learnerPage.goto(workspace);
            await openStandardScorm(learnerPage);
            const player = learnerPage.getByRole("region", {name: "SCORM-Lernpakete"});
            await player.getByLabel("Lernpaket auswählen").selectOption({label: "Fictional package"});
            await expect(player.getByText("0 von 1 Lektionen abgeschlossen")).toBeVisible();
            await player.getByRole("button", {name: "Lernpaket öffnen"}).press("Enter");
            const iframe = player.locator('iframe[title="Exercise <summary>"]');
            await expect(iframe).toHaveAttribute("sandbox", "");
            await expect(iframe.contentFrame().getByText("Fictional course file")).toBeVisible();
            await player.getByRole("button", {name: "Lektion abschließen"}).press("Enter");
            await expect(player.getByText("1 von 1 Lektionen abgeschlossen")).toBeVisible();
            await learnerPage.reload();
            await openStandardScorm(learnerPage);
            await player.getByLabel("Lernpaket auswählen").selectOption({label: "Fictional package"});
            await expect(player.getByText("1 von 1 Lektionen abgeschlossen")).toBeVisible();
            await expect(staffPanel.getByText("0 von 1 Lektionen abgeschlossen")).toBeVisible();

            await staffPanel.getByRole("button", {name: "Veröffentlichung zurückziehen"}).click();
            await page.getByRole("dialog").getByRole("button", {name: "Paket zurückziehen", exact: true}).click();
            await learnerPage.reload();
            await openStandardScorm(learnerPage);
            await expect(player.getByText("Für diesen Kurs ist kein Lernpaket veröffentlicht.")).toBeVisible();
        } finally {
            await learnerContext.close();
        }
    });
}

test.describe("separate HTTPS H5P player", () => {
    for (const premium of [true, false]) {
        test(`native workspace publishes, plays and withdraws a scanned H5P activity (${premium ? "Premium" : "Standard"})`, async ({baseURL}, info) => {
            test.setTimeout(120_000);
            const runtime = process.env.E2E_H5P_CONTENT_HOST;
            const sample = process.env.E2E_H5P_SAMPLE;
            const certificatePin = process.env.E2E_H5P_CERTIFICATE_PIN;
            if (!runtime || !sample) throw new Error("The native H5P journey requires the isolated test origin and verified TrueFalse sample.");
            const browser = await chromium.launch({args: [
                "--no-proxy-server",
                certificatePin ? "--ignore-certificate-errors-spki-list=" + certificatePin : "--ignore-certificate-errors",
                "--host-resolver-rules=MAP *." + new URL("https://" + runtime).hostname + " 127.0.0.1",
            ]});
            const session = {
                baseURL, viewport: info.project.use.viewport,
                isMobile: info.project.use.isMobile, hasTouch: info.project.use.hasTouch,
                ignoreHTTPSErrors: !certificatePin,
            };
            try {
                const context = await browser.newContext(session);
                const page = await context.newPage();
                const f = await fixture({premium});
                await linkWorkspaceLearner(f);
                await checked(f.adminClient.rpc("manage_course_enrolment", {
                    p_course_run_id: f.run, p_user_id: f.learner.id, p_status: "enrolled",
                }));
                const workspace = `/courses/${f.run}/workspace#course-materials`;
                const player = (target: Page) =>
                    target.getByRole("region", {name: "Interaktive H5P-Aktivitäten"});
                const openPractice = async (target: Page) => {
                    if (!premium) await target.getByText("Unbenotete H5P-Übungen", {exact: true}).click();
                };
                await adminLogin(page, f.manager);
                await page.goto(workspace);
                await openPractice(page);
                const staff = player(page);
                await staff.getByText("H5P-Aktivität veröffentlichen", {exact: true}).press("Enter");
                await staff.getByLabel("H5P-Paket auswählen").setInputFiles(sample);
                const publish = staff.getByRole("button", {name: "H5P-Aktivität veröffentlichen"});
                await expect(publish).toBeEnabled();
                await publish.press("Enter");
                await expect(staff.getByRole("button", {name: "Aktivität öffnen"})).toBeVisible({timeout: 45_000});
                const scope = await checked(f.adminClient.rpc("course_h5p_packages", {p_run_id: f.run}, {get: true}));
                expect(scope.packages).toHaveLength(1);
                expect(scope.packages[0].practice).toBe(premium ? undefined : true);
                const version = scope.packages[0].id;
                const scan = await checked(f.service.from("document_versions").select("scanner_version,status").eq("id", version).single());
                expect(scan).toMatchObject({status: "clean", scanner_version: expect.stringMatching(/^ClamAV /)});

                const learnerContext = await browser.newContext(session);
                const participant = await learnerContext.newPage();
                await login(participant, f.learner.email, /\/learning$/);
                await participant.goto(workspace);
                await openPractice(participant);
                const activity = player(participant);
                await activity.getByRole("button", {name: "Aktivität öffnen"}).press("Enter");
                const iframe = activity.locator('iframe[title="True/False Question"]');
                await expect(iframe).toHaveAttribute("sandbox", "allow-scripts allow-same-origin");
                expect(new URL((await iframe.getAttribute("src"))!).origin).not.toBe(baseURL);
                const frame = iframe.contentFrame();
                await expect(frame.getByText("Oslo is the capital of Norway.", {exact: true})).toBeVisible();
                await expect(frame.getByRole("img", {name: "The Oslo Opera House"})).toBeVisible();
                await frame.getByText("Yes", {exact: true}).click();
                await frame.getByRole("button", {name: "Check"}).click();
                await expect(activity.getByText("Abgeschlossen")).toBeVisible();
                await participant.reload();
                await openPractice(participant);
                await expect(activity.getByText("Abgeschlossen")).toBeVisible();
                await expect(staff.getByText("Abgeschlossen")).toHaveCount(0);

                await staff.getByRole("button", {name: "H5P-Freigabe zurückziehen"}).press("Enter");
                const dialog = page.getByRole("dialog", {name: "H5P-Freigabe zurückziehen"});
                await dialog.getByRole("button", {name: "H5P-Freigabe zurückziehen"}).press("Enter");
                await expect(staff.getByText("Es stehen keine H5P-Aktivitäten zur Verfügung.")).toBeVisible();
                await participant.reload();
                await openPractice(participant);
                await expect(activity.getByText("Es stehen keine H5P-Aktivitäten zur Verfügung.")).toBeVisible();
            } finally {
                await browser.close();
            }
        });
    }
});

test("Standard LTI offers a scoped basic tool without grade or roster configuration", async ({page, browser, baseURL}, info) => {
    const f = await fixture({premium: false});
    await linkWorkspaceLearner(f);
    await checked(f.adminClient.rpc("manage_course_enrolment", {
        p_course_run_id: f.run, p_user_id: f.learner.id, p_status: "enrolled",
    }));
    const workspace = `/courses/${f.run}/workspace#course-lti`;
    const panel = (target: Page) => target.getByRole("region", {name: "Externe Lernwerkzeuge"});
    const openTools = (target: Page) =>
        target.locator("summary").filter({hasText: /^Externe Lernwerkzeuge$/}).click();
    await adminLogin(page, f.manager);
    await page.goto(workspace);
    await openTools(page);
    await panel(page).getByRole("button", {name: "Lernwerkzeug registrieren"}).press("Enter");
    const title = "Fictional Standard LTI worksheet";
    for (const [label, value] of [
        ["Name des Lernwerkzeugs", title],
        ["LTI-Client-ID", "fictional-standard-client"],
        ["Anmelde-URL des Werkzeugs", "https://lti.example.invalid/login"],
        ["Registrierte Rückgabe-URL", "https://lti.example.invalid/return"],
        ["Ziel-URL des Kurslinks", "https://lti.example.invalid/worksheet"],
    ]) await panel(page).getByLabel(label).fill(value);
    await panel(page).getByLabel("Für diesen Kurs freigeben").check();
    await panel(page).getByRole("button", {name: "Registrierung speichern"}).press("Enter");
    await expect(panel(page).getByRole("heading", {name: title})).toBeVisible();
    await expect(panel(page).getByText("LTI-Advantage-Dienste", {exact: true})).toHaveCount(0);
    await expect(panel(page).getByText("Externe Bewertungen (AGS)", {exact: true})).toHaveCount(0);

    const learnerContext = await browser.newContext({
        baseURL, viewport: info.project.use.viewport,
        isMobile: info.project.use.isMobile, hasTouch: info.project.use.hasTouch,
    });
    try {
        const learnerPage = await learnerContext.newPage();
        await login(learnerPage, f.learner.email, /\/learning$/);
        await learnerPage.goto(workspace);
        await openTools(learnerPage);
        await expect(panel(learnerPage).getByRole("heading", {name: title})).toBeVisible();
        await expect(panel(learnerPage).getByRole("button", {name: "Externes Lernwerkzeug öffnen"})).toBeEnabled();
        await expect(panel(learnerPage).getByRole("button", {name: "Registrierung bearbeiten"})).toHaveCount(0);
    } finally {
        await learnerContext.close();
    }
});

/** Follow one fictional enrolment from curriculum publication to its released evidence and reports. */
test("LMS lifecycle links curriculum, assignments, competency, completion and reports", async ({ page, browser, baseURL }, info) => {
    test.setTimeout(120_000);
    const duplicateKeys: string[] = [];
    page.on("console", (message) => {
        if (message.type() === "error" && message.text().includes("Encountered two children with the same key")) {
            duplicateKeys.push(message.text());
        }
    });
    const f = await fixture();
    await linkWorkspaceLearner(f);
    const course = `/courses/${f.run}/workspace`;
    const curriculum = `${course}#course-curriculum`;
    const assignments = `${course}#course-submissions`;
    const workspace = `${course}#course-learning`;
    await adminLogin(page, f.manager);
    await page.goto(curriculum);
    await page.getByRole("button", {name: "Modul hinzufügen"}).click();
    await page.getByLabel("Modultitel").fill("Fiktives CLI-Modul");
    await page.getByRole("button", {name: "Lektion hinzufügen"}).click();
    await page.getByLabel("Lektionstitel").fill("Arbeitsverzeichnis anzeigen");
    await page.getByRole("textbox", {name: "Lektionsinhalt"}).fill("Der Befehl pwd zeigt das Arbeitsverzeichnis.");
    await page.getByRole("button", {name: "Veröffentlichen", exact: true}).click();
    await expect(page.getByText(/Veröffentlicht · Fassung 1/)).toBeVisible();
    const curriculumAudit = await new AxeBuilder({page})
        .include("#course-curriculum")
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
    expect(curriculumAudit.violations).toEqual([]);

    const assignment = (target: Page) => target.getByRole("region", {name: "Kursaufgaben", exact: true});
    await page.goto(assignments);
    const assess = assignment(page);
    await assess.getByRole("button", {name: "Aufgabe erstellen", exact: true}).click();
    await assess.getByLabel("Titel der Aufgabe", {exact: true}).fill("Fiktive CLI-Übung");
    await assess.getByLabel("Arbeitsauftrag", {exact: true}).fill("Lade die geprüfte Ausgabe als Textdatei hoch.");
    await assess.getByLabel("Name des Kriteriums", {exact: true}).fill("Ausgabe");
    await assess.getByLabel("Name der Stufe", {exact: true}).nth(0).fill("Offen");
    await assess.getByLabel("Name der Stufe", {exact: true}).nth(1).fill("Bestätigt");
    await assess.getByRole("button", {name: "Entwurf speichern", exact: true}).click();
    await assess.getByRole("button", {name: "Aufgabe veröffentlichen", exact: true}).click();
    await expect(assess.getByText("Version 1 veröffentlicht", {exact: true})).toBeVisible();

    const enrol = (status: "enrolled" | "completed") => checked(f.adminClient.rpc("manage_course_enrolment", {
        p_course_run_id: f.run, p_user_id: f.learner.id, p_status: status,
    }));
    const action = (name: string, payload: Record<string, unknown>) =>
        checked(f.adminClient.rpc("course_workspace_action", {
            p_run_id: f.run, p_action: name, p_payload: payload, p_expected_version: 0,
        }));
    const competency = (name: string, payload: Record<string, unknown>) =>
        checked(f.adminClient.rpc("course_competency_action", {
            p_run_id: f.run, p_action: name, p_payload: payload, p_expected_revision: 0,
        }));
    const framework = randomUUID(), guided = randomUUID(), independent = randomUUID(), skill = randomUUID();
    await competency("save_framework", {id: framework, content: {
        title: "Fiktive Linux-Kompetenzen",
        levels: [{id: guided, title: "Mit Anleitung"}, {id: independent, title: "Selbstständig"}],
        competencies: [{id: skill, code: "CLI", title: "Arbeitsverzeichnis bestimmen"}],
    }});
    await competency("pin", {framework_id: framework, framework_revision: 1});
    await enrol("enrolled");
    await action("quiz_config", {
        questions: [{ prompt: "Print the current working directory?", options: ["pwd", "ls"], correct: 0 }],
        pass_percent: 80, max_attempts: 2, published: true,
    });
    await page.goto(workspace);
    const policy = page.getByRole("region", {name: "Abschlussregeln verwalten", exact: true});
    await policy.getByLabel("Mindestanwesenheit je Termin (%)").fill("60");
    await policy.getByLabel("Abgabe mit freigegebener Bewertung").selectOption({label: "Fiktive CLI-Übung"});
    await policy.getByLabel("Erforderliche Kompetenz").selectOption(skill);
    await policy.getByLabel("Mindestens erforderliche Kompetenzstufe").selectOption(independent);
    await policy.getByLabel("Verifikation durch das Kursteam verlangen").check();
    await policy.getByRole("button", {name: "Abschlussregeln veröffentlichen", exact: true}).click();
    await expect(policy.getByText("Zuletzt veröffentlicht: Fassung 1", {exact: true})).toBeVisible();
    const staffStatus = page.getByRole("region", { name: "Abschlussstatus", exact: true });
    await staffStatus.getByLabel("Teilnehmende Person auswählen").selectOption(f.learner.id);
    await expect(staffStatus.getByText(/Die Teilnahme muss als abgeschlossen/)).toBeVisible();
    await expect(staffStatus.getByText(/0 von 1 bestätigt/)).toBeVisible();
    await expect(staffStatus.getByText(/Das veröffentlichte Quiz/)).toBeVisible();
    await expect(staffStatus.getByText("Diese Einschreibung nutzt die bisherigen Abschlussregeln.")).toBeVisible();
    await staffStatus.getByRole("button", {name: "Einschreibung auf Fassung 1 umstellen"}).click();
    await expect(staffStatus.getByText("Abschlussregeln, Fassung 1", {exact: true})).toBeVisible();
    await expect(staffStatus.getByText("Verifikation durch das Kursteam steht aus")).toBeVisible();
    await staffStatus.getByText("Individuelle Ausnahmen", {exact: true}).click();
    const competencyException = staffStatus.getByRole("group", {name: "Ausnahme für die Kompetenz", exact: true});
    await competencyException.getByLabel("Begründung für das Kursteam").fill("Gleichwertigen Kompetenznachweis geprüft.");
    await competencyException.getByRole("button", {name: "Ausnahme erteilen", exact: true}).click();
    await expect(staffStatus.getByText(/Ausnahme für die erforderliche Kompetenz erteilt/)).toBeVisible();
    await competencyException.getByLabel("Begründung für das Kursteam").fill("Reguläre Kompetenzprüfung wieder eingeplant.");
    await competencyException.getByRole("button", {name: "Ausnahme zurücknehmen", exact: true}).click();
    await expect(staffStatus.getByText(/Kompetenzstufe steht aus/)).toBeVisible();

    const context = await browser.newContext({
        baseURL, viewport: info.project.use.viewport,
        isMobile: info.project.use.isMobile, hasTouch: info.project.use.hasTouch,
    });
    try {
        const learnerPage = await context.newPage();
        await login(learnerPage, f.learner.email, /\/learning$/);
        await learnerPage.goto(curriculum);
        await expect(learnerPage.getByText("Der Befehl pwd zeigt das Arbeitsverzeichnis.")).toBeVisible();
        await learnerPage.goto(assignments);
        const submission = assignment(learnerPage);
        const selectAssignment = (target: Page) => assignment(target)
            .getByRole("combobox", {name: "Aufgabe auswählen", exact: true})
            .selectOption({label: "Fiktive CLI-Übung"});
        await selectAssignment(learnerPage);
        const filename = "fiktive-ausgabe.txt";
        await submission.getByLabel("Datei auswählen", {exact: true}).setInputFiles({
            name: filename, mimeType: "text/plain", buffer: Buffer.from("/tmp/fictional-lab\n"),
        });
        await submission.getByRole("button", {name: "Datei abgeben", exact: true}).click();
        await expect(submission.getByText(filename, {exact: true})).toBeVisible();
        await page.goto(assignments);
        await selectAssignment(page);
        const review = assess.getByRole("listitem").filter({hasText: filename});
        const feedback = "Die Ausgabe belegt das richtige Arbeitsverzeichnis.";
        await review.getByRole("combobox", {name: "Ausgabe", exact: true}).selectOption("1");
        await review.getByLabel("Rückmeldung für Teilnehmende", {exact: true}).fill(feedback);
        await review.getByRole("combobox", {name: "Veröffentlichung", exact: true}).selectOption("released");
        await review.getByRole("button", {name: "Rückmeldung speichern", exact: true}).click();
        await expect(review.getByText("Rückmeldung freigegeben", {exact: true})).toBeVisible();
        await learnerPage.reload();
        await selectAssignment(learnerPage);
        await expect(submission.getByText(feedback, {exact: true})).toBeVisible();
        await learnerPage.goto(workspace);
        const learnerStatus = learnerPage.getByRole("region", { name: "Mein Abschlussdokument", exact: true });
        await expect(learnerStatus.getByText(/60 % bestätigte Anwesenheit.*0 von 1 bestätigt/)).toBeVisible();
        await expect(learnerStatus.getByText("Abschlussregeln, Fassung 1", {exact: true})).toBeVisible();
        await expect(learnerStatus.getByText("Aufgabe bewertet und freigegeben: Fiktive CLI-Übung")).toBeVisible();
        await expect(learnerStatus.getByText(/Kompetenzstufe steht aus/)).toBeVisible();
        const issue = learnerStatus.getByRole("button", {name: "Voraussetzungen prüfen und Dokument ausstellen", exact: true});
        await expect(issue).toBeDisabled();

        const quiz = learnerPage.getByRole("region", {name: "Mini-Quiz"});
        const answer = quiz.getByRole("radio", {name: "pwd", exact: true});
        await answer.press("Space");
        await expect(answer).toBeChecked();
        const learnerAudit = await new AxeBuilder({page: learnerPage})
            .include("#course-learning")
            .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
            .analyze();
        expect(learnerAudit.violations).toEqual([]);
        const viewport = learnerPage.viewportSize();
        if (!viewport) throw new Error("The browser project requires an explicit viewport");
        await learnerPage.setViewportSize({width: 320, height: viewport.height});
        const width = await learnerPage.locator("main").evaluate((main) => ({
            visible: main.clientWidth,
            scroll: main.scrollWidth,
        }));
        expect(width.scroll).toBeLessThanOrEqual(width.visible + 1);
        const submitQuiz = quiz.getByRole("button", {name: "Antworten verbindlich abgeben"});
        await expect(submitQuiz).toBeEnabled();
        await submitQuiz.press("Enter");
        await expect(quiz.getByText(/Ergebnis: 100 %.*Bestanden/)).toBeVisible();
        await learnerPage.setViewportSize(viewport);
        const evidence = "Fiktiver Nachweis zum Arbeitsverzeichnis.";
        await page.goto(workspace);
        const staffCompetencies = page.locator("details").filter({
            has: page.getByText("Kompetenzen", {exact: true}),
        });
        await staffCompetencies.getByText("Kompetenzen", {exact: true}).click();
        await staffCompetencies.getByRole("combobox", {name: "Teilnehmende Person", exact: true}).selectOption(f.learner.id);
        await staffCompetencies.getByRole("combobox", {name: "Kompetenz", exact: true}).selectOption(skill);
        await staffCompetencies.getByRole("combobox", {name: "Stufe", exact: true}).selectOption(independent);
        await staffCompetencies.getByLabel("Begründung und Lernnachweis").fill(evidence);
        await staffCompetencies.getByRole("checkbox", {name: /Besten Versuch/}).check();
        await staffCompetencies.getByRole("combobox", {name: "Freigegebene Aufgabenbewertung"})
            .selectOption({label: "Fiktive CLI-Übung · 100 %"});
        await staffCompetencies.getByRole("button", {name: "Beurteilung freigeben"}).click();
        await expect(staffCompetencies.getByText(evidence, {exact: true})).toBeVisible();
        await enrol("completed");
        await action("attendance_verify", {
            session_id: f.session, user_id: f.learner.id, state: "attended", minutes: 36,
            reason: "Fictional attendance reviewed",
        });
        await learnerPage.reload();
        const competencies = learnerPage.locator("details").filter({
            has: learnerPage.getByText("Kompetenzen", {exact: true}),
        });
        await competencies.getByText("Kompetenzen", {exact: true}).click();
        await expect(competencies.getByText(evidence, {exact: true})).toBeVisible();
        await expect(competencies.getByText("Fiktive CLI-Übung · 100 %", {exact: true})).toBeVisible();
        await expect(learnerStatus.getByText(/Kompetenzstufe erreicht/)).toBeVisible();
        await expect(issue).toBeDisabled();
        await page.goto(workspace);
        await staffStatus.getByLabel("Teilnehmende Person auswählen").selectOption(f.learner.id);
        const verificationReason = "Aufgaben- und Kompetenznachweise geprüft.";
        const verification = staffStatus.getByRole("group", {name: "Abschluss für die Einschreibung verifizieren", exact: true});
        await verification.getByLabel("Begründung für das Kursteam").fill(verificationReason);
        await staffStatus.getByRole("button", {name: "Verifikation bestätigen"}).click();
        await expect(staffStatus.getByText("Verifikation durch das Kursteam erteilt")).toBeVisible();
        await learnerPage.reload();
        await expect(learnerStatus.getByText(/Alle Voraussetzungen/)).toBeVisible();
        await expect(learnerStatus.getByText(verificationReason)).toHaveCount(0);
        await issue.click();
        await expect(issue).toHaveCount(0);
        const pdf = learnerPage.waitForEvent("download");
        await learnerStatus.getByRole("button", {name: "Herunterladen", exact: true}).click();
        const downloaded = await pdf;
        expect(downloaded.suggestedFilename()).toBe("course-completion.pdf");
        expect((await readFile(await downloaded.path())).subarray(0, 5).toString()).toBe("%PDF-");
        await page.goto(workspace);
        await staffStatus.getByLabel("Teilnehmende Person auswählen").selectOption(f.learner.id);
        await staffStatus.getByRole("button", {name: "Abschlussstatus aktualisieren", exact: true}).click();
        await expect(staffStatus.getByText("Abschlussdokument ausgestellt.")).toBeVisible();
        const exportPanel = page.getByRole("region", {name: "Lernaktivitäten exportieren"});
        const receipt = page.waitForEvent("download");
        await exportPanel.getByRole("button", {name: "xAPI-Daten herunterladen"}).click();
        const archive = JSON.parse(await readFile(await (await receipt).path(), "utf8"));
        expect(archive.xapi_version).toBe("1.0.3");
        expect(archive.statements.map((entry: {verb: {id: string}}) => entry.verb.id)).toEqual([
            "http://adlnet.gov/expapi/verbs/attempted",
            "http://adlnet.gov/expapi/verbs/completed",
        ]);
        expect(JSON.stringify(archive)).not.toContain(f.learner.id);
        expect(await dispatchFixtureArchive(f.run, f.manager.email)).toEqual(archive.statements);
        await expect(learnerPage.getByRole("region", {name: "Lernaktivitäten exportieren"})).toHaveCount(0);
        await page.goto("/admin/finance/analytics/learning");
        await page.getByRole("searchbox", {name: "Kurs oder Klasse suchen"}).fill(f.title);
        await page.getByRole("button", {name: "Suchen", exact: true}).click();
        const report = page.getByRole("region", {name: "Bewertungen und Abgaben je Kurs"});
        const row = report.getByRole("row").filter({hasText: f.title});
        await expect(row).toBeVisible();
        await expect(row.getByRole("cell", {name: "—", exact: true})).toHaveCount(11);
        expect(duplicateKeys).toEqual([]);
    } finally {
        await context.close();
    }
});

/** Exercise private authoring, a named frozen share, own export and revocation in real sessions. */
test("a personal portfolio shares only the reviewed revision with the chosen course instructor", async ({page, browser, baseURL}, info) => {
    test.setTimeout(140_000);
    const f = await fixture();
    await linkWorkspaceLearner(f);
    await checked(f.adminClient.rpc("manage_course_enrolment", {
        p_course_run_id: f.run, p_user_id: f.learner.id, p_status: "enrolled",
    }));
    await login(page, f.learner.email, /\/learning$/);
    await page.getByRole("link", {name: "Mein Portfolio", exact: true}).click();
    const ownPortfolio = page.getByRole("region", {name: "Mein Portfolio", exact: true});
    await ownPortfolio.getByRole("button", {name: "Eintrag erstellen", exact: true}).click();
    await ownPortfolio.getByLabel("Titel des Eintrags").fill("Fictional reflection");
    await ownPortfolio.getByLabel("Inhalt des Eintrags").fill("Version one. Shared with chosen instructor.");
    await ownPortfolio.getByRole("button", {name: "Eintrag speichern", exact: true}).click();
    const evidenceName = "fictional-evidence.txt";
    const evidence = Buffer.from("Fictional supporting work for the learner’s reflection.");
    await ownPortfolio.getByText("Nachweis verknüpfen", {exact: true}).click();
    await ownPortfolio.getByLabel("Datei auswählen").setInputFiles({
        name: evidenceName, mimeType: "text/plain", buffer: evidence,
    });
    await ownPortfolio.getByRole("button", {name: "Datei prüfen und verknüpfen"}).click();
    await expect(ownPortfolio.getByText(evidenceName, {exact: true})).toBeVisible();
    const ownReceipt = page.waitForEvent("download");
    await ownPortfolio.getByRole("button", {name: evidenceName + " herunterladen"}).click();
    expect(await readFile(await (await ownReceipt).path())).toEqual(evidence);

    await ownPortfolio.getByRole("button", {name: "Fassung teilen", exact: true}).click();
    await ownPortfolio.getByLabel("Lehrkraft und Kurs").selectOption(f.run + ":" + f.teacher.id);
    await ownPortfolio.getByRole("button", {name: "Fassung 2 freigeben", exact: true}).click();
    await expect(ownPortfolio.getByRole("button", {name: "Freigabe widerrufen", exact: true})).toBeVisible();

    const instructor = await browser.newContext({baseURL, viewport: info.project.use.viewport,
        isMobile: info.project.use.isMobile, hasTouch: info.project.use.hasTouch});
    try {
        const teacher = await instructor.newPage();
        await login(teacher, f.teacher.email);
        await teacher.goto(`/courses/${f.run}/workspace#course-portfolio`);
        const assigned = teacher.getByRole("region", {name: "Geteilte Portfolios", exact: true});
        await expect(assigned.getByText("Version one. Shared with chosen instructor.")).toBeVisible();
        const teacherDownload = teacher.waitForEvent("download");
        const teacherRequest = teacher.waitForRequest((request) =>
            request.url().endsWith("/functions/v1/course-documents") &&
            request.postDataJSON()?.kind === "portfolio_evidence",
        );
        await assigned.getByRole("button", {name: evidenceName + " herunterladen"}).click();
        expect(await readFile(await (await teacherDownload).path())).toEqual(evidence);
        const evidenceRequest = await teacherRequest;

        await ownPortfolio.getByRole("button", {name: "Verknüpfung für " + evidenceName + " lösen"}).click();
        await expect(ownPortfolio.getByText(evidenceName, {exact: true})).toHaveCount(0);


        await ownPortfolio.getByRole("button", {name: "Eintrag bearbeiten", exact: true}).click();
        await ownPortfolio.getByLabel("Inhalt des Eintrags").fill("Version two. Private.");
        await ownPortfolio.getByRole("button", {name: "Eintrag speichern", exact: true}).click();
        await expect(ownPortfolio.getByText("Version two. Private.", {exact: true})).toBeVisible();
        await teacher.reload();
        await expect(assigned.getByText("Version one. Shared with chosen instructor.")).toBeVisible();
        await expect(assigned.getByText(evidenceName, {exact: true})).toBeVisible();
        await expect(assigned.getByText("Version two. Private.")).toHaveCount(0);

        const download = page.waitForEvent("download");
        await ownPortfolio.getByRole("button", {name: "Mein Portfolio exportieren"}).click();
        const exported = JSON.parse(await readFile(await (await download).path(), "utf8"));
        expect(exported[0].history).toMatchObject([
            {revision: 4, body: "Version two. Private.", evidence: []},
            {revision: 3, body: "Version one. Shared with chosen instructor.", evidence: []},
            {revision: 2, evidence: [{name: evidenceName}]},
            {revision: 1, body: "Version one. Shared with chosen instructor.", evidence: []},
        ]);
        await ownPortfolio.getByRole("button", {name: "Freigabe widerrufen", exact: true}).click();
        await expect(ownPortfolio.getByText("Widerrufen", {exact: true})).toBeVisible();
        const denied = await teacher.request.post(evidenceRequest.url(), {
            headers: await evidenceRequest.allHeaders(),
            data: evidenceRequest.postDataJSON(),
        });
        expect(denied.status()).toBe(403);
        await teacher.reload();
        await expect(assigned.getByText("Für dich sind keine Portfolioeinträge freigegeben.")).toBeVisible();
        await ownPortfolio.getByRole("button", {name: "Fassung teilen", exact: true}).click();
        await ownPortfolio.getByLabel("Lehrkraft und Kurs").selectOption(f.run + ":" + f.teacher.id);
        await ownPortfolio.getByRole("button", {name: "Fassung 4 freigeben", exact: true}).click();
        await expect(ownPortfolio.getByRole("button", {name: "Freigabe widerrufen", exact: true})).toBeVisible();
        await teacher.reload();
        await expect(assigned.getByText("Version two. Private.", {exact: true})).toBeVisible();
        const archiveEntry = async () => {
            await ownPortfolio.getByRole("button", {name: "Eintrag archivieren", exact: true}).click();
            await ownPortfolio.getByRole("button", {name: "Archivierung bestätigen", exact: true}).click();
            await expect(ownPortfolio.getByRole("heading", {name: "Fictional reflection"})).toHaveCount(0);
        };
        await archiveEntry();
        await teacher.reload();
        await expect(assigned.getByText("Für dich sind keine Portfolioeinträge freigegeben.")).toBeVisible();
        const archived = ownPortfolio.getByRole("checkbox", {name: "Archivierte Einträge anzeigen"});
        await archived.check();
        await ownPortfolio.getByRole("button", {name: "Eintrag wiederherstellen", exact: true}).click();
        await expect(ownPortfolio.getByText("Dein Archiv ist leer.")).toBeVisible();
        await archived.uncheck();
        await archiveEntry();
        await archived.check();
        await ownPortfolio.getByRole("button", {name: "Eintrag löschen", exact: true}).click();
        const remove = ownPortfolio.getByRole("button", {name: "Endgültig löschen", exact: true});
        await expect(remove).toBeDisabled();
        await ownPortfolio.getByLabel("Titel zur Bestätigung eingeben").fill("Fictional reflection");
        await remove.click();
        await expect(ownPortfolio.getByText("Dein Archiv ist leer.")).toBeVisible();
    } finally {
        await instructor.close();
    }
});
