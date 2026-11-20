/** Native REST self-declaration is sufficient for an atomic complete-block claim. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {withApiFixture} from "./testing/api.mjs";

await withApiFixture(async ({actor, service, checked, sql, defer}) => {
    const teacher = await actor("declared-expertise-teacher", "lecturer"),
        peer = await actor("declared-expertise-peer", "lecturer"),
        topic = randomUUID(),
        job = randomUUID();
    defer(() =>
        sql(
            `delete from public.notifications where user_id in('${teacher.id}','${peer.id}');delete from public.chat_members where room_id in(select id from public.chat_rooms where job_id='${job}');delete from public.chat_rooms where job_id='${job}';delete from public.claim_events where claim_id in(select id from public.job_claims where job_id='${job}');delete from public.assignment_sessions where claim_id in(select id from public.job_claims where job_id='${job}');delete from public.job_claims where job_id='${job}';delete from public.job_requirements where job_id='${job}';delete from public.job_sessions where job_id='${job}';delete from public.jobs where id='${job}';delete from public.lecturer_topics where topic_id='${topic}';delete from public.topics where id='${topic}';`,
        ),
    );
    await sql(
        `insert into public.topics(id,label_de,label_en,kind) values('${topic}','Fiktive eigene Expertise','Fictional own expertise','topic');insert into public.jobs(id,title,customer_name,delivery_type,status,amount,total_amount,currency,rate_unit,terms,requires_contract) values('${job}','Fictional self-declared claim','Fictional company','online','published',100,100,'EUR','fixed_total','Fictional accepted terms',false);insert into public.job_sessions(job_id,starts_at,ends_at) values('${job}',timestamptz '2040-10-01 09:00Z',timestamptz '2040-10-01 10:00Z'),('${job}',timestamptz '2040-10-02 09:00Z',timestamptz '2040-10-02 10:00Z');insert into public.job_requirements(job_id,topic_id) values('${job}','${topic}')`,
    );
    const missing = await checked(
        peer.client.rpc("claim_job", {
            p_job_id: job,
            p_idempotency_key: randomUUID(),
            p_terms_version: 1,
        }),
        "Missing declared expertise denial",
    );
    assert.equal(missing.status, "not_eligible");
    await checked(
        teacher.client
            .from("lecturer_topics")
            .insert({user_id: teacher.id, topic_id: topic}),
        "Declare own expertise without attestation",
    );
    const own = await checked(
        teacher.client
            .from("lecturer_topics")
            .select("verified,valid_until")
            .eq("user_id", teacher.id)
            .eq("topic_id", topic)
            .single(),
        "Read self-declaration",
    );
    assert.equal(own.verified, false);
    assert.equal(own.valid_until, null);
    const accepted = await checked(
        teacher.client.rpc("claim_job", {
            p_job_id: job,
            p_idempotency_key: randomUUID(),
            p_terms_version: 1,
        }),
        "Atomic complete-block self-declared claim",
    );
    assert.equal(accepted.status, "confirmed");
    const rows = await checked(
        service
            .from("assignment_sessions")
            .select("id")
            .eq("claim_id", accepted.claim_id)
            .is("released_at", null),
        "Every accepted session allocated",
    );
    assert.equal(rows.length, 2);
    console.log(
        "PASS native Auth/REST self-declared unverified expertise accepts the whole block; missing topic remains denied",
    );
});