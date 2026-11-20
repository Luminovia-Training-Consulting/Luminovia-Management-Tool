/**
 * Real Auth/HTTP checks for shared profile fields, own labels and eligible course reviews.
 * Separate fictional identities verify actual API results and denied access; responses are not browser mocks.
 */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {createClient} from "@supabase/supabase-js";
import {assertPasswordOnly} from "./testing/password-only.mjs";

if (process.env.PORTAL_TEST_MODE !== "1")
    throw new Error("Profile API mutations run only in ./portal test.");
const config = readFileSync("supabase/config.toml", "utf8");
assert.match(
    config,
    /project_id\s*=\s*"luminovia-portal-test-[a-z0-9]+"/,
    "Only a disposable canonical project is permitted.",
);
process.loadEnvFile(".env.test.local");
const url = process.env.SUPABASE_URL;
assert.ok(
    url && ["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname),
);
/** Creates a separate SDK client without persistent sessions or automatic session refresh. */
const make = (key) =>
    createClient(url, key, {
        auth: {persistSession: false, autoRefreshToken: false},
    });
const service = make(process.env.SUPABASE_SERVICE_ROLE_KEY),
    users = [],
    clients = [];
const suffix = randomUUID(),
    org = randomUUID(),
    template = randomUUID(),
    run = randomUUID(),
    job = randomUUID(),
    claim = randomUUID();
let businessCreated = false;

/** Requires actual SDK success before returning the response data. */
async function checked(request, label) {
    const {data, error} = await request;
    assert.equal(error, null, `${label}: ${error?.message}`);
    return data;
}

/** Creates separate fictional accounts and signs them in through Auth; their IDs belong only to the fixture. */
async function fixture(name, role) {
    const email = `profile-${name}-${suffix}@example.invalid`;
    const data = await checked(
        service.auth.admin.createUser({
            email,
            password: process.env.E2E_PASSWORD,
            email_confirm: true,
        }),
        "Create fictional profile actor",
    );
    users.push(data.user.id);
    await checked(
        service.from("user_roles").insert({user_id: data.user.id, role}),
        "Set fixture role",
    );
    await checked(
        service
            .from("profiles")
            .update({display_name: `Fictional ${name}`, phone: "Never public"})
            .eq("id", data.user.id),
        "Set fixture profile",
    );
    const client = make(process.env.SUPABASE_ANON_KEY);
    clients.push(client);
    await checked(
        client.auth.signInWithPassword({
            email,
            password: process.env.E2E_PASSWORD,
        }),
        "Actual Auth login",
    );
    return {id: data.user.id, client};
}

try {
    const teacher = await fixture("Teacher", "lecturer"),
        peer = await fixture("Peer", "lecturer"),
        student = await fixture("Student", "participant"),
        outsider = await fixture("Outsider", "participant"),
        admin = await fixture("Administrator", "admin");
    await checked(
        service.from("user_roles").insert({user_id: student.id, role: "client"}),
        "Give enrolled learner an operational portal role",
    );
    await assertPasswordOnly(admin.client);
    await checked(
        teacher.client.rpc("save_profile_details", {
            p_payload: {
                country: "Australia",
                languages: ["Deutsch", "English"],
                labels: ["Python", "Mentoring"],
                teaching_experience: "Fictional teaching experience",
            },
        }),
        "Save own authored profile details",
    );
    const listing = await checked(
        peer.client.rpc("people_directory", {
            p_search: "Teacher",
            p_label: "Python",
        }),
        "Search real directory",
    );
    assert.equal(listing.length, 1);
    assert.equal(listing[0].id, teacher.id);
    assert.equal("phone" in listing[0], false);
    assert.equal("email" in listing[0], false);
    assert.equal(
        (await outsider.client.rpc("people_directory")).error?.code,
        "42501",
        "Retired participant has no operational directory access",
    );
    assert.ok(
        (
            await peer.client
                .from("profile_details")
                .update({labels: ["Administrator"]})
                .eq("user_id", teacher.id)
        ).error,
    );
    businessCreated = true;
    await checked(
        service
            .from("organisations")
            .insert({id: org, name: `Fictional profile academy ${suffix}`}),
        "Seed scoped org",
    );
    await checked(
        service
            .from("client_organisation_memberships")
            .insert({user_id: student.id, organisation_id: org}),
        "Give enrolled learner scoped customer access",
    );
    await checked(
        service
            .from("course_templates")
            .insert({id: template, title: `Fictional past course ${suffix}`}),
        "Seed scoped template",
    );
    await checked(
        service.from("course_runs").insert({
            id: run,
            template_id: template,
            organisation_id: org,
            published: false,
        }),
        "Seed scoped past run",
    );
    const starts = new Date(Date.now() - 2 * 86400000).toISOString(),
        ends = new Date(Date.now() - 86400000).toISOString();
    await checked(
        service
            .from("course_sessions")
            .insert({course_run_id: run, starts_at: starts, ends_at: ends}),
        "Seed actual historical session",
    );
    await checked(
        service.from("jobs").insert({
            id: job,
            course_run_id: run,
            title: "Fictional completed assignment",
            customer_name: "Fictional academy",
            delivery_type: "online",
            time_zone: "Europe/Berlin",
            status: "filled",
            amount: 100,
            total_amount: 100,
            currency: "EUR",
            rate_unit: "fixed_total",
            terms: "Fictional original net terms",
        }),
        "Seed scoped original agreement",
    );
    await checked(
        service
            .from("job_sessions")
            .insert({job_id: job, starts_at: starts, ends_at: ends}),
        "Seed scoped teaching interval",
    );
    await checked(
        service.from("job_claims").insert({
            id: claim,
            job_id: job,
            lecturer_id: teacher.id,
            idempotency_key: randomUUID(),
            status: "confirmed",
            amount: 100,
            total_amount: 100,
            currency: "EUR",
            rate_unit: "fixed_total",
            terms: "Fictional original net terms",
            terms_version: 1,
        }),
        "Seed immutable historic claim",
    );
    await checked(
        service.from("assignment_sessions").insert({
            claim_id: claim,
            lecturer_id: teacher.id,
            starts_at: starts,
            ends_at: ends,
        }),
        "Seed actual accepted teaching block",
    );
    await checked(
        admin.client.rpc("manage_course_enrolment", {
            p_course_run_id: run,
            p_user_id: student.id,
            p_status: "completed",
        }),
        "Attest actual fictional completed attendance",
    );
    const ownCourses = await checked(
        student.client.from("course_runs").select("id").eq("id", run),
        "Own enrolled course",
    );
    assert.equal(ownCourses.length, 1);
    assert.equal(
        (await outsider.client.from("course_runs").select("id").eq("id", run)).error
            ?.code,
        "42501",
        "Retired participant cannot query another enrolment",
    );
    const tasks = await checked(
        student.client.rpc("reviewable_courses"),
        "Actual review eligibility",
    );
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].lecturer_id, teacher.id);
    const text = "Fictional feedback <script>stays text</script>";
    const review = await checked(
        student.client.rpc("submit_course_review", {
            p_course_run_id: run,
            p_lecturer_id: teacher.id,
            p_rating: 4,
            p_comment: text,
            p_version: 0,
        }),
        "Submit real bounded review",
    );
    const ratings = await checked(
        peer.client.rpc("lecturer_reviews", {p_user_id: teacher.id}),
        "Read anonymous real feedback",
    );
    assert.equal(ratings.length, 1);
    assert.equal(ratings[0].comment, text);
    assert.equal(ratings[0].reviewer_id, null);
    assert.equal(ratings[0].reviewer_label, "participant");
    assert.deepEqual(
        await checked(
            peer.client.from("course_reviews").select("*").eq("id", review),
            "Direct reviewer table denial",
        ),
        [],
    );
    assert.ok(
        (
            await outsider.client.rpc("submit_course_review", {
                p_course_run_id: run,
                p_lecturer_id: teacher.id,
                p_rating: 5,
                p_comment: "Forged",
            })
        ).error,
    );
    assert.ok(
        (
            await student.client.rpc("submit_course_review", {
                p_course_run_id: run,
                p_lecturer_id: teacher.id,
                p_rating: 1,
                p_comment: "Stale",
                p_version: 0,
            })
        ).error,
    );
    await checked(
        admin.client.rpc("moderate_course_review", {
            p_review_id: review,
            p_hidden: true,
            p_reason: "Fictional policy review",
        }),
        "password-only authentication hide",
    );
    assert.deepEqual(
        await checked(
            peer.client.rpc("lecturer_reviews", {p_user_id: teacher.id}),
            "Hidden review privacy",
        ),
        [],
    );
    await checked(
        admin.client.rpc("moderate_course_review", {
            p_review_id: review,
            p_hidden: false,
            p_reason: "Fictional review restored",
        }),
        "password-only authentication restore",
    );
    await checked(
        admin.client.rpc("manage_course_enrolment", {
            p_course_run_id: run,
            p_user_id: student.id,
            p_status: "removed",
        }),
        "Revoke course membership",
    );
    assert.deepEqual(
        await checked(
            student.client.from("course_runs").select("id").eq("id", run),
            "Course denied after revoke",
        ),
        [],
    );
    const companyDirectory = await checked(
        student.client.rpc("people_directory"),
        "Company staff directory after course removal",
    );
    assert.equal(companyDirectory.length, 1);
    assert.equal(companyDirectory[0].id, teacher.id);
    await checked(
        service
            .from("client_organisation_memberships")
            .update({removed_at: new Date().toISOString()})
            .eq("user_id", student.id)
            .eq("organisation_id", org),
        "Revoke scoped customer profile access",
    );
    assert.deepEqual(
        await checked(
            student.client.rpc("people_directory"),
            "Directory denied after company membership revocation",
        ),
        [],
    );
    await checked(
        service.from("profiles").update({active: false}).eq("id", student.id),
        "Suspend scoped participant",
    );
    assert.ok(
        (
            await student.client.rpc("save_profile_details", {
                p_payload: {labels: ["forged"]},
            })
        ).error,
    );
    console.log(
        "PASS: actual Auth/password-only authentication/REST profile labels and safe directory, real completed-course enrolment, restricted history, anonymous author-versioned reviews, password-only authentication moderation, cross-participant and existing-session revocation/suspension.",
    );
} finally {
    for (const client of clients) await client.removeAllChannels();
    if (businessCreated) {
        await checked(
            service.from("course_reviews").delete().eq("course_run_id", run),
            "Clean scoped reviews",
        );
        await checked(
            service.from("course_enrolments").delete().eq("course_run_id", run),
            "Clean scoped attendance",
        );
        await checked(
            service.from("assignment_sessions").delete().eq("claim_id", claim),
            "Clean scoped assignments",
        );
        await checked(
            service.from("job_claims").delete().eq("id", claim),
            "Clean scoped claim",
        );
        await checked(
            service.from("job_sessions").delete().eq("job_id", job),
            "Clean scoped job intervals",
        );
        await checked(
            service.from("jobs").delete().eq("id", job),
            "Clean scoped job",
        );
        await checked(
            service.from("course_sessions").delete().eq("course_run_id", run),
            "Clean scoped course sessions",
        );
        await checked(
            service.from("course_runs").delete().eq("id", run),
            "Clean scoped run",
        );
        await checked(
            service.from("course_templates").delete().eq("id", template),
            "Clean scoped template",
        );
        await checked(
            service
                .from("client_organisation_memberships")
                .delete()
                .eq("organisation_id", org),
            "Clean scoped course customer membership",
        );
        await checked(
            service.from("organisations").delete().eq("id", org),
            "Clean scoped organisation",
        );
    }
    if (users.length) {
        await checked(
            service.from("audit_events").delete().in("actor_id", users),
            "Clean scoped profile audit",
        );
        for (const id of users)
            await checked(
                service.auth.admin.deleteUser(id),
                "Clean temporary profile account",
            );
    }
}