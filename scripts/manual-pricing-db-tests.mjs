/** Actual personal-price allocation with immutable accepted snapshots. */
import {rpcResponse} from "./testing/openapi-contract.mjs";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {withTestDatabase} from "./testing/database.mjs";

await withTestDatabase("manual_pricing", async ({sql, actor}) => {
    const senior = randomUUID(),
        admin = randomUUID(),
        manager = randomUUID(),
        teacher = randomUUID(),
        peer = randomUUID();
    await sql(
        `insert into auth.users(id) values('${admin}'),('${manager}'),('${teacher}'),('${peer}'),('${senior}');insert into public.user_roles(user_id,role) values('${admin}','admin'),('${manager}','management'),('${teacher}','lecturer'),('${peer}','lecturer'),('${senior}','senior_lecturer')`,
    );
    const config = async (user = teacher) =>
        JSON.parse(
            await actor(admin, `select public.lecturer_compensation('${user}')`),
        );
    const defaults = await config();
    assert.deepEqual(defaults, {
        mode: "percent",
        percent: 50,
        daily_rate: 200,
        currency: "EUR",
        version: 1,
        is_customized: false,
    });
    await assert.rejects(
        actor(teacher, `select public.lecturer_compensation('${teacher}')`),
        /Compensation administration required/,
    );
    const org = randomUUID();
    await sql(
        `insert into public.organisations(id,name) values('${org}','Fictional pricing company')`,
    );
    let day = 0;
    const create = async () => {
        day += 4;
        const template = randomUUID(),
            run = randomUUID(),
            job = randomUUID();
        await sql(
            `insert into public.course_templates(id,title) values('${template}','Fictional priced teaching');insert into public.course_runs(id,template_id,organisation_id) values('${run}','${template}','${org}');insert into public.jobs(id,course_run_id,title,customer_name,delivery_type,status,amount,total_amount,currency,rate_unit,terms,requires_contract) values('${job}','${run}','Fictional priced teaching','Fictional pricing company','online','published',0,0,'EUR','per_day','Immutable priced terms',false);insert into public.job_sessions(job_id,starts_at,ends_at) values('${job}',timestamptz '2040-01-01 09:00Z'+interval '${day} day',timestamptz '2040-01-01 12:00Z'+interval '${day} day'),('${job}',timestamptz '2040-01-02 09:00Z'+interval '${day} day',timestamptz '2040-01-02 12:00Z'+interval '${day} day')`,
        );
        await actor(
            admin,
            `select public.set_job_commission('${job}',1000,2000,null)`,
        );
        return job;
    };
    const offers = async (user) =>
        JSON.parse(await actor(user, "select public.job_offers()"));
    const job = await create();
    const quote = (await offers(teacher)).find((x) => x.id === job);
    assert.equal(quote.amount, 500);
    assert.equal(quote.total_amount, 1000);
    const accepted = JSON.parse(
        await actor(
            teacher,
            `select public.claim_job('${job}','${randomUUID()}',${quote.terms_version})`,
        ),
    );
    assert.equal(accepted.status, "confirmed");
    const saved = JSON.parse(
        await actor(
            admin,
            `select public.save_lecturer_compensation('${teacher}','daily',50,200,'EUR',1)`,
        ),
    );
    assert.equal(saved.version, 2);
    assert.equal(saved.is_customized, true);
    const untouched = await sql(
        `select amount||':'||total_amount from public.job_claims where id='${accepted.claim_id}'`,
    );
    assert.equal(untouched, "500.00:1000.00");
    const second = await create();
    const daily = (await offers(teacher)).find((x) => x.id === second);
    assert.equal(daily.amount, 200);
    assert.equal(daily.total_amount, 400);
    const candidateResponse = rpcResponse("manual_assignment_candidates");
    const assignmentResponse = rpcResponse("manual_assign_job");
    const candidates = candidateResponse(
        await actor(
            admin,
            `select public.manual_assignment_candidates('${second}')`,
        ),
    );
    assert.ok(
        candidateResponse(await actor(manager, `select public.manual_assignment_candidates('${second}')`))
            .every(({quote}) => quote === null),
    );
    const target = candidates.find((x) => x.id === teacher);
    assert.equal(target.eligibility, "eligible");
    assert.equal(target.quote.total_amount, 400);
    const lifecycle = JSON.parse(
        await actor(admin, `select public.job_lifecycle('${second}')`),
    );
    assert.equal(lifecycle.max_net_budget, 2000);
    const key = randomUUID();
    await assert.rejects(
        actor(
            peer,
            `select public.manual_assign_job('${second}','${teacher}',${target.terms_version},${lifecycle.version},'${key}')`,
        ),
        /Job management required/,
    );
    const assigned = assignmentResponse(
        await actor(
            admin,
            `select public.manual_assign_job('${second}','${teacher}',${target.terms_version},${lifecycle.version},'${key}')`,
        ),
    );
    assert.equal(assigned.status, "confirmed");
    const repeated = assignmentResponse(
        await actor(
            admin,
            `select public.manual_assign_job('${second}','${teacher}',${target.terms_version},${lifecycle.version},'${key}')`,
        ),
    );
    assert.equal(repeated.claim_id, assigned.claim_id);
    assert.equal(
        await sql(
            `select count(*) from public.assignment_sessions where claim_id='${assigned.claim_id}' and released_at is null`,
        ),
        "2",
    );
    assert.equal(
        await sql(
            `select lecturer_net_total_amount||':'||platform_total_amount from private.claim_revenue_ledger where claim_id='${assigned.claim_id}'`,
        ),
        "400.00:1600.00",
    );
    console.log(
        "PASS default percentage, fixed daily rate, real self/manual complete-block claims and immutable earlier snapshots",
    );
    const third = await create();
    const old = (await offers(teacher)).find((x) => x.id === third);
    await actor(
        admin,
        `select public.save_lecturer_compensation('${teacher}','percent',60,200,'EUR',2)`,
    );
    assert.equal(
        JSON.parse(
            await actor(
                teacher,
                `select public.claim_job('${third}','${randomUUID()}',${old.terms_version})`,
            ),
        ).status,
        "terms_changed",
    );
    await assert.rejects(
        actor(
            admin,
            `select public.save_lecturer_compensation('${teacher}','percent',70,200,'EUR',2)`,
        ),
        /Compensation changed/,
    );
    const management = JSON.parse(
        await actor(
            manager,
            `select public.manual_assignment_candidates('${third}')`,
        ),
    );
    assert.equal(management.find((x) => x.id === teacher).quote, null);
    // An old global rank-policy edit must never override a person's configured pay.
    const personal = (await offers(teacher)).find((x) => x.id === third);
    await actor(admin, "select public.configure_compensation_policy(31,73,0)");
    assert.deepEqual(await config(peer), {...defaults, percent: 31});
    assert.deepEqual(await config(senior), {...defaults, percent: 73});
    assert.deepEqual(
        (await offers(teacher)).find((x) => x.id === third),
        personal,
    );
    assert.equal(personal.total_amount, 1200);
    assert.equal(
        (await offers(peer)).find((x) => x.id === third).total_amount,
        1000,
    );
    await actor(
        admin,
        `select public.save_lecturer_compensation('${teacher}','daily',60,1200,'EUR',3)`,
    );
    assert.equal(
        (await offers(teacher)).find((x) => x.id === third).total_amount,
        null,
    );
    assert.equal(
        JSON.parse(
            await actor(
                teacher,
                `select public.claim_job('${third}','${randomUUID()}',${personal.terms_version})`,
            ),
        ).status,
        "quote_unavailable",
    );
    await assert.rejects(
        actor(
            admin,
            `select public.save_lecturer_compensation('${teacher}','daily',60,'NaN','EUR',4)`,
        ),
        /Invalid/,
    );
    console.log(
        "PASS current pricing version invalidates stale consent; stale settings and unauthorized private rates denied",
    );
});
