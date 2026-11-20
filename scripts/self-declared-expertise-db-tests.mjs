/** Real atomic allocations and replacement handovers accept self-declared expertise. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {withTestDatabase} from "./testing/database.mjs";

await withTestDatabase("declared_expertise", async ({sql, actor}) => {
    const teacher = randomUUID(),
        candidate = randomUUID(),
        missing = randomUUID(),
        expired = randomUUID(),
        topic = randomUUID();
    await sql(
        `insert into auth.users(id) values('${teacher}'),('${candidate}'),('${missing}'),('${expired}');insert into public.user_roles(user_id,role) values('${teacher}','lecturer'),('${candidate}','lecturer'),('${missing}','lecturer'),('${expired}','lecturer');insert into public.topics(id,label_de,label_en,kind) values('${topic}','Fiktive Expertise','Fictional expertise','topic');`,
    );
    for (const user of [teacher, candidate])
        await actor(
            user,
            `insert into public.lecturer_topics(user_id,topic_id) values('${user}','${topic}')`,
        );
    await sql(
        `insert into public.lecturer_topics(user_id,topic_id,verified,valid_until) values('${expired}','${topic}',true,now()-interval '1 day')`,
    );
    let day = 0;
    const create = async ({contract = false, overlap = false} = {}) => {
        const job = randomUUID();
        if (!overlap) day += 4;
        const offset = overlap ? 4 : day;
        await sql(
            `insert into public.jobs(id,title,customer_name,delivery_type,status,amount,total_amount,currency,rate_unit,terms,requires_contract) values('${job}','Fictional declared expertise','Fictional company','online','published',100,100,'EUR','fixed_total','Original accepted terms',${contract});insert into public.job_sessions(job_id,starts_at,ends_at) values('${job}',timestamptz '2040-01-01 09:00Z'+interval '${offset} day',timestamptz '2040-01-01 10:00Z'+interval '${offset} day'),('${job}',timestamptz '2040-01-02 09:00Z'+interval '${offset} day',timestamptz '2040-01-02 10:00Z'+interval '${offset} day');insert into public.job_requirements(job_id,topic_id) values('${job}','${topic}')`,
        );
        return job;
    };
    const claim = async (user, job) =>
        JSON.parse(
            await actor(
                user,
                `select public.claim_job('${job}','${randomUUID()}',1)`,
            ),
        );
    const job = await create();
    assert.equal((await claim(missing, job)).status, "not_eligible");
    const accepted = await claim(teacher, job);
    assert.equal(accepted.status, "confirmed");
    assert.equal(
        await sql(
            `select count(*) from public.assignment_sessions where claim_id='${accepted.claim_id}' and released_at is null`,
        ),
        "2",
    );
    assert.equal(
        await sql(
            `select verified from public.lecturer_topics where user_id='${teacher}'`,
        ),
        "f",
    );
    assert.equal((await claim(candidate, job)).status, "filled");
    const contract = await create({contract: true});
    assert.equal(
        (await claim(candidate, contract)).status,
        "prerequisite_missing",
    );
    const offer = await actor(
        teacher,
        `select public.request_replacement('${accepted.claim_id}','Fictional handover','open','{}'::uuid[],false,'${randomUUID()}')`,
    );
    const taken = JSON.parse(
        await actor(
            candidate,
            `select public.claim_replacement('${offer}',1,1,'${randomUUID()}')`,
        ),
    );
    assert.equal(taken.status, "confirmed");
    assert.equal(
        await sql(
            `select count(*) from public.assignment_sessions where lecturer_id='${candidate}' and released_at is null`,
        ),
        "2",
    );
    console.log(
        "PASS self-declared expertise allocates every session and permits atomic marketplace handover without management verification",
    );
    const conflict = await create({overlap: true});
    assert.equal((await claim(candidate, conflict)).status, "conflict");
    const legacy = await create();
    assert.equal((await claim(expired, legacy)).status, "confirmed");

    const transferJob = await create();
    const transferSource = await claim(teacher, transferJob);
    assert.equal(transferSource.status, "confirmed");
    const proposal = await actor(
        teacher,
        `select public.propose_job_substitution('${transferSource.claim_id}','${candidate}','Fictional declared-expertise substitution','${randomUUID()}')`,
    );
    const proposals = JSON.parse(
        await actor(candidate, `select public.job_substitutions()`),
    );
    const receipt = proposals.find((x) => x.id === proposal);
    assert.ok(receipt?.quote_hash);
    const transferred = JSON.parse(
        await actor(
            candidate,
            `select public.respond_job_substitution('${proposal}','accept','${receipt.quote_hash}','${randomUUID()}',true)`,
        ),
    );
    assert.equal(transferred.status, "confirmed");
    assert.equal(
        await sql(
            `select count(*)
             from public.assignment_sessions
             where claim_id = '${transferred.claim_id}'
               and released_at is null`,
        ),
        "2",
    );
    console.log(
        "PASS direct substitution proposal and atomic full-block acceptance use declared expertise",
    );
    await sql(`delete
               from public.user_roles
               where user_id = '${missing}'`);
    await assert.rejects(
        claim(missing, await create()),
        /Active lecturer|required|inactive/i,
    );
    assert.equal(
        await sql(
            `select terms
             from public.job_claims
             where id = '${accepted.claim_id}'`,
        ),
        "Original accepted terms",
    );
    console.log(
        "PASS missing expertise, contracts, capacity, overlap, active role and immutable snapshots remain enforced; old attestation expiry is optional metadata",
    );
});