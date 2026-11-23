/** Actual Auth/REST regression for organisation decisions and whole-course self-cancellation.
 * The canonical test runner owns the disposable stack; all identities and resources are fictional.
 */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {withApiFixture} from "./testing/api.mjs";
import {quoteSql as q} from "./testing/database.mjs";
import {assertLmsResponse as assertRpcResponse} from "./testing/premium-lms-contract.mjs";

await withApiFixture(async ({actor, sql, defer, checked}) => {
    const manager = await actor("decision-admin", "admin"),
        company = await actor("decision-company", "client"),
        outsider = await actor("decision-outsider", "client"),
        teacher = await actor("decision-teacher", "lecturer"),
        learner = await actor("decision-learner", "participant"),
        peer = await actor("decision-peer", "participant");
    const [org, foreignOrg, template, early, late, job, claim, classId, foreignClass] = Array.from(
        {length: 9},
        randomUUID,
    );
    const users = [
        manager.id,
        company.id,
        outsider.id,
        teacher.id,
        learner.id,
        peer.id,
    ];
    // Delete only this fixture's UUID-scoped records before the helper removes Auth users.
    defer(async () => {
        await sql(`delete from private.company_lecturer_decisions where claim_id=${q(claim)};
      delete from private.company_premium_commands where organisation_id=${q(org)};delete from private.company_premium_settings where organisation_id=${q(org)};delete from private.company_premium_audit where organisation_id=${q(org)};
      delete from private.job_lifecycle_requests where actor_id in(${users.map(q).join(",")});
      delete from public.notifications where user_id in(${users.map(q).join(",")});
      delete from public.audit_events where actor_id in(${users.map(q).join(",")});
      delete from public.claim_events where claim_id=${q(claim)};
      delete from public.assignment_sessions where claim_id=${q(claim)};
      delete from public.job_claims where id=${q(claim)};
      delete from public.job_sessions where job_id=${q(job)};
      delete from public.jobs where id=${q(job)};
      delete from public.course_enrolments where course_run_id in(${q(early)},${q(late)});
      delete from public.course_sessions where course_run_id in(${q(early)},${q(late)});
      delete from public.course_runs where id in(${q(early)},${q(late)});
      delete from public.course_templates where id=${q(template)};
      delete from private.course_classes where id in(${q(classId)},${q(foreignClass)});
      delete from public.client_organisation_memberships where user_id in(${q(company.id)},${q(outsider.id)});
      delete from public.organisations where id in(${q(org)},${q(foreignOrg)});`);
    });
    await sql(`insert into public.organisations(id, name)
               values (${q(org)}, 'Fictional integration company'),
                      (${q(foreignOrg)}, 'Fictional other company');
    insert into public.client_organisation_memberships(user_id, organisation_id)
    values (${q(company.id)}, ${q(org)}),
           (${q(outsider.id)}, ${q(foreignOrg)});
    insert into private.course_classes(id,organisation_id,name)
    values (${q(classId)},${q(org)},'Fictional participant class'),
           (${q(foreignClass)},${q(foreignOrg)},'Foreign participant class');
    insert into public.course_templates(id, title)
    values (${q(template)}, 'Fictional integration course');
    insert into public.course_runs(id, template_id, organisation_id)
    values (${q(early)}, ${q(template)}, ${q(org)}),
           (${q(late)}, ${q(template)}, ${q(org)});
    insert into public.course_sessions(course_run_id, starts_at, ends_at)
    values (${q(early)}, now() + interval '8 days', now() + interval '8 days 1 hour'),
           (${q(early)}, now() + interval '9 days', now() + interval '9 days 1 hour'),
           (${q(late)}, now() + interval '6 days', now() + interval '6 days 1 hour');
    insert into public.jobs(id, course_run_id, title, customer_name, delivery_type, status, amount, currency, rate_unit, total_amount, terms)
    values (${q(job)}, ${q(early)}, 'Fictional integration assignment', 'Fictional integration company', 'online', 'filled', 100, 'EUR', 'fixed_total', 100, 'Fictional immutable terms');
    insert into public.job_sessions(job_id, starts_at, ends_at)
    values (${q(job)}, now() + interval '8 days', now() + interval '8 days 1 hour');
    insert into public.job_claims(id, job_id, lecturer_id, idempotency_key, amount, currency, rate_unit, total_amount, terms, terms_version, created_at)
    values (${q(claim)}, ${q(job)}, ${q(teacher.id)}, ${q(randomUUID())}, 100, 'EUR', 'fixed_total', 100, 'Fictional immutable terms', 1, now() - interval '73 hours');
    insert into public.assignment_sessions(claim_id, lecturer_id, starts_at, ends_at)
    values (${q(claim)}, ${q(teacher.id)}, now() + interval '8 days', now() + interval '8 days 1 hour');`);

    await checked(
        manager.client.rpc("set_company_premium", {
            p_organisation_id: org,
            p_enabled: true,
            p_expected_version: 0,
            p_request_id: randomUUID(),
        }),
    );

    // Use real company and participant sessions to establish the verified link
    // before the course-cancellation path. An identical client retry is safe.
    const learnerId = await sql(`select luminovia_user_id from public.profiles where id=${q(learner.id)}`);
    const link = {
        p_organisation_id: org,
        p_luminovia_user_id: learnerId,
        p_request_id: randomUUID(),
    };
    const requested = {status: "request_submitted"};
    assert.equal((await outsider.client.rpc("request_company_participant_link", link)).error?.code, "42501");
    assert.deepEqual(await checked(company.client.rpc("request_company_participant_link", link)), requested);
    assert.deepEqual(await checked(company.client.rpc("request_company_participant_link", link)), requested);
    assert.deepEqual(await checked(company.client.rpc("request_company_participant_link", {
        ...link,
        p_luminovia_user_id: "UNKNOWN-FICTIONAL-ID",
        p_request_id: randomUUID(),
    })), requested);
    const historyArgs = {p_organisation_id: org, p_limit: 1};
    const history = await company.client.rpc("company_participant_history", historyArgs);
    assert.equal(history.status, 200);
    const first = await checked(Promise.resolve(history));
    assertRpcResponse("company_participant_history", first);
    assert.equal(first.has_more, true);
    assert.equal(first.items[0].kind, "user_id_link_requested");
    const after = await checked(company.client.rpc("company_participant_history", {
        ...historyArgs,
        p_before_at: first.items[0].occurred_at,
        p_before_id: first.items[0].id,
    }));
    assertRpcResponse("company_participant_history", after);
    assert.equal(after.has_more, false);
    assert.equal(after.items[0].kind, first.items[0].kind);
    assert.notEqual(after.items[0].id, first.items[0].id);
    assert.equal((await outsider.client.rpc("company_participant_history", historyArgs)).status, 403);
    assert.equal((await company.client.rpc("company_participant_history", {
        ...historyArgs,
        p_before_at: first.items[0].occurred_at,
    })).status, 400);
    const pending = await checked(learner.client.rpc("my_company_participant_invitations"));
    assert.equal(pending.length, 1);
    assert.equal(pending[0].organisation_id, org);
    assert.deepEqual(await checked(peer.client.rpc("my_company_participant_invitations")), []);
    assert.equal((await checked(learner.client.rpc("accept_company_participant_invitation", {
        p_organisation_id: org,
        p_expected_version: pending[0].version,
        p_request_id: randomUUID(),
    }))).status, "accepted");
    const confirmed = await checked(company.client.rpc("company_participant_history", {
        p_organisation_id: org,
    }));
    assertRpcResponse("company_participant_history", confirmed);
    assert.equal(confirmed.items.filter(({kind}) => kind === "association_confirmed").length, 1);
    const readRoster = () => checked(company.client.rpc("company_participants", {p_organisation_id: org}));
    const currentParticipant = (await readRoster()).find(({user_id}) => user_id === learner.id);
    const placement = {
        p_organisation_id: org, p_user_id: learner.id,
        p_class_id: classId, p_expected_version: currentParticipant.version,
    };
    assert.equal((await outsider.client.rpc("set_company_participant_class", placement)).status, 403);
    assert.equal((await company.client.rpc("set_company_participant_class", {
        ...placement, p_class_id: foreignClass,
    })).status, 403);
    const assigned = await company.client.rpc("set_company_participant_class", placement);
    assert.equal(assigned.status, 204);
    assert.equal(assigned.error, null);
    assert.equal((await readRoster()).find(({user_id}) => user_id === learner.id).class_name,
        "Fictional participant class");
    assert.equal((await company.client.rpc("set_company_participant_class", placement)).status, 409);

    // Exercise the live course enrolment form and participant withdrawal gate
    // over REST. Never seed these enrolments directly into PostgreSQL.
    const earlyArgs = {p_course_run_id: early};
    const candidates = {...earlyArgs, p_search: learnerId};
    assert.equal((await outsider.client.rpc("course_enrolment_candidates", candidates)).error?.code, "42501");
    assert.equal((await peer.client.rpc("course_enrolment_candidates", candidates)).error?.code, "42501");
    assert.deepEqual(
        (await checked(company.client.rpc("course_enrolment_candidates", candidates))).map(({user_id}) => user_id),
        [learner.id],
    );
    for (const courseId of [early, late]) {
        const response = await company.client.rpc("manage_course_enrolment", {
            p_course_run_id: courseId,
            p_user_id: learner.id,
            p_status: "enrolled",
        });
        await checked(Promise.resolve(response));
        assert.equal(response.status, 204);
    }
    assert.deepEqual(await checked(company.client.rpc("course_enrolment_candidates", candidates)), []);
    assert.equal(
        (await checked(learner.client.rpc("course_withdrawal_window", earlyArgs))).can_withdraw,
        true,
    );
    assert.equal(
        (await checked(learner.client.rpc("course_withdrawal_window", {p_course_run_id: late}))).can_withdraw,
        false,
    );
    assert.equal((await peer.client.rpc("course_withdrawal_window", earlyArgs)).error?.code, "42501");

    // Real JWTs must not allow foreign organisations or another participant to act.
    assert.equal(
        (await outsider.client.rpc("company_lecturer_decisions", {p_job_id: job}))
            .error?.code,
        "42501",
    );
    assert.equal(
        (
            await outsider.client.rpc("decide_company_lecturer", {
                p_claim_id: claim,
                p_decision: "rejected",
            })
        ).error?.code,
        "42501",
    );
    assert.equal(
        (
            await peer.client.rpc("cancel_own_course_enrolment", {
                p_course_run_id: early,
            })
        ).error?.code,
        "42501",
    );
    assert.equal(
        (
            await learner.client.rpc("cancel_own_course_enrolment", {
                p_course_run_id: late,
            })
        ).error?.code,
        "22023",
        "An active enrolled account is denied only when the cancellation deadline has passed",
    );
    assert.equal(
        await sql(
            `select status from public.course_enrolments where course_run_id=${q(late)} and user_id=${q(learner.id)}`,
        ),
        "enrolled",
    );
    const items = await checked(
        company.client.rpc("company_lecturer_decisions", {p_job_id: job}),
    );
    assert.equal(
        items.find((item) => item.claim_id === claim).status,
        "auto_accepted",
    );
    await checked(
        company.client.rpc("decide_company_lecturer", {
            p_claim_id: claim,
            p_decision: "accepted",
        }),
    );
    await checked(
        company.client.rpc("decide_company_lecturer", {
            p_claim_id: claim,
            p_decision: "rejected",
        }),
    );
    assert.equal(
        await sql(`select status from public.job_claims where id=${q(claim)}`),
        "cancelled",
    );
    assert.equal(
        await sql(`select status from public.jobs where id=${q(job)}`),
        "published",
    );
    assert.equal(
        await sql(
            `select count(*) from public.assignment_sessions where claim_id=${q(claim)} and released_at is null`,
        ),
        "0",
    );
    assert.equal(
        await sql(
            `select total_amount from public.job_claims where id=${q(claim)}`,
        ),
        "100.00",
    );
    const withdrawal = await learner.client.rpc("cancel_own_course_enrolment", earlyArgs);
    await checked(Promise.resolve(withdrawal));
    assert.equal(withdrawal.status, 204);
    assert.equal((await learner.client.rpc("course_withdrawal_window", earlyArgs)).error?.code, "42501");
    assert.equal(
        await sql(
            `select status from public.course_enrolments where course_run_id=${q(early)} and user_id=${q(learner.id)}`,
        ),
        "removed",
    );
    assert.equal(
        await sql(
            `select count(*) from public.course_sessions where course_run_id=${q(early)}`,
        ),
        "2",
    );
    console.log(
        "PASS actual REST: scoped and opaque company participant history, organisation isolation, 72-hour projection, accept/reject, released assignment and amount preservation, own course cancellation and deadline denial.",
    );
});
