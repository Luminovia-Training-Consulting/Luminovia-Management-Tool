/**
 * Real Auth/HTTP checks for shared profile fields, own labels and eligible course reviews.
 * Separate fictional identities verify actual API results and denied access; responses are not browser mocks.
 */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {withApiFixture} from "./testing/api.mjs";
import {quoteSql as q} from "./testing/database.mjs";
import {enablePremiumAndLinkParticipant} from "./testing/company-participant.mjs";

await withApiFixture(async (fixture) => {
    const {service, actor, checked, passwordOnly, sql, defer, suffix} = fixture;
    const [org, template, run, job, claim] = Array.from(
        {length: 5},
        randomUUID,
    );
    let businessCreated = false;
    const teacher = await actor("Teacher", "lecturer"),
        peer = await actor("Peer", "lecturer"),
        student = await actor("Student", "participant"),
        outsider = await actor("Outsider", "participant"),
        company = await actor("Company", "client"),
        admin = await actor("Administrator", "admin");
    const users = [
        teacher.id,
        peer.id,
        student.id,
        outsider.id,
        company.id,
        admin.id,
    ];
    defer(async () => {
        if (businessCreated) {
            await checked(
                service
                    .from("course_reviews")
                    .delete()
                    .eq("course_run_id", run),
                "Clean scoped reviews",
            );
            await checked(
                service
                    .from("course_enrolments")
                    .delete()
                    .eq("course_run_id", run),
                "Clean scoped attendance",
            );
            await checked(
                service
                    .from("assignment_sessions")
                    .delete()
                    .eq("claim_id", claim),
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
                service
                    .from("course_sessions")
                    .delete()
                    .eq("course_run_id", run),
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
            await sql(
                `delete from private.company_premium_audit where organisation_id=${q(org)}`,
            );
            await checked(
                service.from("organisations").delete().eq("id", org),
                "Clean scoped organisation",
            );
        }
        await checked(
            service.from("audit_events").delete().in("actor_id", users),
            "Clean scoped profile audit",
        );
    });
    await passwordOnly(admin.client);
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
        "Participant-only accounts have no operational directory access",
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
            .insert({user_id: company.id, organisation_id: org}),
        "Give the separate customer contact scoped access",
    );
    await enablePremiumAndLinkParticipant({
        admin,
        company,
        learner: student,
        organisation: org,
        service,
        checked,
    });
    await checked(
        service.from("course_templates").insert({
            id: template,
            title: `Fictional past course ${suffix}`,
        }),
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
    const workspace = await checked(
        student.client.rpc("course_workspace", {p_run_id: run}),
        "Own enrolled course workspace",
    );
    assert.equal(workspace.id, run);
    assert.equal(workspace.access.learner, true);
    assert.equal(
        (await outsider.client.rpc("course_workspace", {p_run_id: run})).error
            ?.code,
        "42501",
        "Unassociated participants cannot open another course workspace",
    );
    assert.equal(
        (await student.client.from("course_runs").select("id").eq("id", run))
            .error?.code,
        "42501",
        "A scoped learner cannot enumerate the operational course table",
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
    // Known application conflicts must return once through the pinned REST
    // transport and preserve the accepted review.
    const staleEdit = await student.client
        .rpc("submit_course_review", {
            p_course_run_id: run,
            p_lecturer_id: teacher.id,
            p_rating: 1,
            p_comment: "Stale",
            p_version: 0,
        })
        .abortSignal(AbortSignal.timeout(5000));
    assert.equal(staleEdit.status, 409);
    assert.equal(staleEdit.error?.code, "PT409");
    const staleDelete = await student.client
        .rpc("delete_course_review", {p_review_id: review, p_version: 0})
        .abortSignal(AbortSignal.timeout(5000));
    assert.equal(staleDelete.status, 409);
    assert.equal(staleDelete.error?.code, "PT409");
    const unchanged = await checked(student.client.rpc("reviewable_courses"));
    assert.equal(unchanged[0].review.comment, text);
    assert.equal(unchanged[0].review.version, 1);
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
    assert.equal(
        (await student.client.rpc("course_workspace", {p_run_id: run})).error
            ?.code,
        "42501",
        "Course access is denied after enrolment is removed",
    );
    assert.deepEqual(
        await checked(student.client.rpc("reviewable_courses")),
        [],
    );
    assert.equal(
        (
            await student.client.rpc("submit_course_review", {
                p_course_run_id: run,
                p_lecturer_id: teacher.id,
                p_rating: 5,
                p_comment: "Revoked participant",
                p_version: 1,
            })
        ).error?.code,
        "42501",
    );
    const companyDirectory = await checked(
        company.client.rpc("people_directory"),
        "Separate company contact retains its staff directory",
    );
    assert.equal(companyDirectory.length, 1);
    assert.equal(companyDirectory[0].id, teacher.id);
    await checked(
        admin.client.rpc("manage_client_organisation", {
            p_user_id: company.id,
            p_organisation_id: org,
            p_remove: true,
        }),
        "Revoke scoped customer profile access",
    );
    assert.deepEqual(
        await checked(
            company.client.rpc("people_directory"),
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
});
