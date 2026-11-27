/** Real Auth/password-only authentication/REST lifecycle proof; scoped to the canonical disposable stack. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {withApiFixture} from "./testing/api.mjs";

await withApiFixture(async ({service, actor, passwordOnly, sql, defer, checked}) => {
    const manager = await actor("lifecycle-manager", "admin"),
        teacher = await actor("lifecycle-teacher", "lecturer"),
        peer = await actor("lifecycle-peer", "lecturer"),
        learner = await actor("lifecycle-learner", "participant");
    const users = [manager, teacher, peer, learner].map((x) => x.id),
        jobs = [],
        runs = [],
        templates = [],
        organisations = [],
        topic = randomUUID();
    defer(async () => {
        const ids = users.map((x) => `'${x}'`).join(",");
        await sql(
            `delete from private.job_lifecycle_requests where actor_id in(${ids});delete from public.notifications where user_id in(${ids});`,
        );
        if (jobs.length) {
            const j = jobs.map((x) => `'${x}'`).join(",");
            await sql(
                `delete from public.chat_members where room_id in(select id from public.chat_rooms where job_id in(${j}));delete from public.chat_rooms where job_id in(${j});delete from public.claim_events where claim_id in(select id from public.job_claims where job_id in(${j}));delete from public.assignment_sessions where claim_id in(select id from public.job_claims where job_id in(${j}));delete from public.job_claims where job_id in(${j});delete from public.job_sessions where job_id in(${j});delete from public.job_requirements where job_id in(${j});delete from public.jobs where id in(${j});`,
            );
        }
        if (runs.length)
            await checked(
                service.from("course_sessions").delete().in("course_run_id", runs),
                "Clean own lifecycle sessions",
            );
        if (runs.length)
            await checked(
                service.from("course_runs").delete().in("id", runs),
                "Clean own lifecycle runs",
            );
        if (templates.length)
            await checked(
                service.from("course_templates").delete().in("id", templates),
                "Clean own lifecycle templates",
            );
        if (organisations.length)
            await checked(
                service.from("organisations").delete().in("id", organisations),
                "Clean own lifecycle organisations",
            );
        await sql(`delete from public.lecturer_topics where topic_id='${topic}';
          delete from public.topics where id='${topic}';`);
    });
    // Both fixture lecturers satisfy the reopened job's topic requirement.
    await checked(service.from("topics").insert({
        id: topic,
        kind: "topic",
        label_de: `Fiktives Auftragsthema ${topic}`,
        label_en: `Fictional lifecycle topic ${topic}`,
    }));
    await checked(service.from("lecturer_topics").insert(
        [teacher.id, peer.id].map((user_id) => ({user_id, topic_id: topic})),
    ));
    /** Binds the requested lifecycle action to the job, expected version and retry identity. */
    const req = (job, action, version, payload = {}, key = randomUUID()) => ({
        p_job_id: job,
        p_action: action,
        p_expected_version: version,
        p_request_id: key,
        p_payload: payload,
    });
    await passwordOnly(manager.client);
    const payload = {
        title: "Fictional actual lifecycle API",
        customer_name: "Fictional lifecycle API customer",
        delivery_type: "online",
        time_zone: "Europe/Berlin",
        status: "published",
        amount: 100,
        total_amount: 200,
        currency: "EUR",
        rate_unit: "per_day",
        terms: "Actual accepted fictional terms",
        topic_ids: [topic],
        sessions: [
            {starts_at: "2048-01-10T08:00:00Z", ends_at: "2048-01-10T09:00:00Z"},
            {starts_at: "2048-01-11T08:00:00Z", ends_at: "2048-01-11T09:00:00Z"},
        ],
    };
    const job = await checked(
        manager.client.rpc("create_job", {p_payload: payload}),
        "Create real lifecycle offer",
    );
    jobs.push(job);
    /** Records the fixture job's run, template and organisation IDs for later scoped cleanup. */
    const track = async (id) => {
        const j = await checked(
            service.from("jobs").select("course_run_id").eq("id", id).single(),
            "Read own fixture run",
        );
        runs.push(j.course_run_id);
        const r = await checked(
            service
                .from("course_runs")
                .select("template_id,organisation_id")
                .eq("id", j.course_run_id)
                .single(),
            "Read own fixture source",
        );
        if (!templates.includes(r.template_id)) templates.push(r.template_id);
        if (r.organisation_id && !organisations.includes(r.organisation_id))
            organisations.push(r.organisation_id);
    };
    await track(job);
    const original = (
        await checked(teacher.client.rpc("job_offers"), "Read scoped lecturer offers")
    ).find((offer) => offer.id === job);
    assert.ok(original, "Published offer is available through the scoped lecturer API");
    assert.equal(original.customer_name, "", "Customer identity stays hidden before its reveal window");
    assert.equal("course_run_id" in original, false, "Hidden customer linkage is omitted");
    const claim = await checked(
        teacher.client.rpc("claim_job", {
            p_job_id: job,
            p_idempotency_key: randomUUID(),
            p_terms_version: original.terms_version,
        }),
        "Claim entire block",
    );
    assert.equal(claim.status, "confirmed");
    const snapshot = await checked(
        teacher.client
            .from("job_claims")
            .select("*")
            .eq("id", claim.claim_id)
            .single(),
        "Read own accepted snapshot",
    );
    assert.equal(
        (
            await peer.client.rpc("cancel_job_assignment", {
                p_claim_id: claim.claim_id,
                p_reason: "Forbidden foreign cancellation",
                p_request_id: randomUUID(),
            })
        ).error?.code,
        "42501",
    );
    assert.equal(
        (await learner.client.rpc("job_lifecycle", {p_job_id: job})).error?.code,
        "42501",
    );
    const room = await checked(
        service.from("chat_rooms").select("id").eq("job_id", job).single(),
        "Read own room fixture",
    );
    assert.ok(
        (
            await checked(
                teacher.client.rpc("chat_rooms_list"),
                "Before cancellation course membership",
            )
        ).some((r) => r.id === room.id),
    );
    const cancellation = {
        p_claim_id: claim.claim_id,
        p_reason: "Fictional lecturer availability changed",
        p_request_id: randomUUID(),
    };
    assert.equal(
        await checked(
            teacher.client.rpc("cancel_job_assignment", cancellation),
            "Actually cancel future block",
        ),
        claim.claim_id,
    );
    assert.equal(
        await checked(
            teacher.client.rpc("cancel_job_assignment", cancellation),
            "Retry exact cancellation",
        ),
        claim.claim_id,
    );
    assert.deepEqual(
        await checked(
            teacher.client
                .from("job_claims")
                .select("*")
                .eq("id", claim.claim_id)
                .single(),
            "Retained accepted snapshot",
        ),
        {...snapshot, status: "cancelled"},
    );
    assert.ok(
        !(
            await checked(
                teacher.client.rpc("chat_rooms_list"),
                "Removed course room",
            )
        ).some((r) => r.id === room.id),
    );
    assert.equal(
        (await teacher.client.rpc("chat_messages", {p_room_id: room.id})).error
            ?.code,
        "42501",
        "Old valid token loses course messages",
    );
    const oldAllocations = await checked(
        teacher.client
            .from("assignment_sessions")
            .select("*")
            .eq("claim_id", claim.claim_id),
        "Exact released allocation bytes",
    );
    assert.equal(oldAllocations.length, 2);
    assert.ok(oldAllocations.every((s) => s.released_at));
    const meta = await checked(
        manager.client.rpc("job_lifecycle", {p_job_id: job}),
        "Manager sees audited cancellation",
    );
    assert.equal(
        meta.claims[0].events.find((e) => e.type === "cancelled").reason,
        cancellation.p_reason,
    );
    assert.ok(
        (
            await manager.client.rpc("set_job_status", {
                p_job_id: job,
                p_status: "published",
            })
        ).error,
        "Legacy API cannot silently reopen accepted history",
    );
    const releasedJob = await checked(
        service.from("jobs").select("status").eq("id", job).single(),
        "Eligible released offer returns to the marketplace",
    );
    assert.equal(releasedJob.status, "published");
    const reopenedNotices = await checked(
        service
            .from("notifications")
            .select("user_id")
            .eq("kind", "job_reopened")
            .eq("resource_id", job)
            // Retained accounts may also qualify through the same subject area.
            .in("user_id", users),
        "Only eligible fixture actors receive the release notice",
    );
    assert.deepEqual(
        reopenedNotices.map((notice) => notice.user_id).sort(),
        [peer.id, teacher.id].sort(),
    );
    assert.deepEqual(
        (
            await checked(
                peer.client.rpc("job_lifecycle", {p_job_id: job}),
                "Published job does not leak peer history",
            )
        ).claims,
        [],
    );
    const replacement = await checked(
        peer.client.rpc("claim_job", {
            p_job_id: job,
            p_idempotency_key: randomUUID(),
            p_terms_version: original.terms_version,
        }),
        "Replace with real second lecturer",
    );
    assert.equal(replacement.status, "confirmed");
    assert.equal(
        (
            await checked(
                peer.client
                    .from("assignment_sessions")
                    .select("id")
                    .eq("claim_id", replacement.claim_id),
                "Entire replacement block",
            )
        ).length,
        2,
    );
    const current = await checked(
        manager.client.rpc("job_lifecycle", {p_job_id: job}),
        "Refresh current lifecycle revision",
    );
    const copyArgs = req(job, "duplicate", current.version, {
            title: "Fictional actual copied lifecycle offer",
        }),
        copy = await checked(
            manager.client.rpc("manage_job_offer", copyArgs),
            "Duplicate to safe new draft",
        );
    jobs.push(copy);
    await track(copy);
    assert.equal(
        await checked(
            manager.client.rpc("manage_job_offer", copyArgs),
            "Retry same copy",
        ),
        copy,
    );
    const copied = await checked(
        service.from("jobs").select("status").eq("id", copy).single(),
        "Copied publication boundary",
    );
    assert.equal(copied.status, "draft");
    assert.equal(
        (
            await checked(
                service.from("job_claims").select("id").eq("job_id", copy),
                "No copied assignment",
            )
        ).length,
        0,
    );
    const copyState = await checked(
        manager.client.rpc("job_lifecycle", {p_job_id: copy}),
        "Copied revision",
    );
    await checked(
        manager.client.rpc(
            "manage_job_offer",
            req(copy, "edit", copyState.version, {
                title: "Edited actual draft",
                claim_deadline: "2047-12-01T12:00:00Z",
            }),
        ),
        "Edit deadline and title",
    );
    assert.equal(
        (
            await manager.client.rpc(
                "manage_job_offer",
                req(copy, "edit", copyState.version, {title: "Stale overwrite"}),
            )
        ).error?.code,
        "40001",
    );
    await checked(
        service.from("profiles").update({active: false}).eq("id", teacher.id),
        "Suspend actual existing actor",
    );
    assert.equal(
        (await teacher.client.rpc("job_lifecycle", {p_job_id: job})).error?.code,
        "42501",
    );
    console.log(
        "PASS: actual Auth/password-only authentication/REST job lifecycle: complete-block cancellation/reopen/reclaim, exact immutable snapshots/released intervals, foreign/learner/stale/suspended denial, old-token chat revocation, reasoned history and safe idempotent draft copy.",
    );
});
