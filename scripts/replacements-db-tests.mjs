/** Real transaction/permission/rollback tests; all data is fictional and disposable. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { withTestDatabase, quoteSql as q } from "./testing/database.mjs";
await withTestDatabase("replacement_test", async ({ sql, actor }) => {
  const [manager, original, first, second, outsider, inactive] = Array.from(
    { length: 6 },
    () => randomUUID(),
  );
  await sql(
    `insert into auth.users(id,email) values ${[manager, original, first, second, outsider, inactive].map((id) => `('${id}','${id}@example.invalid')`).join(",")};insert into public.user_roles(user_id,role) values('${manager}','admin'),('${original}','lecturer'),('${first}','lecturer'),('${second}','senior_lecturer'),('${outsider}','participant'),('${inactive}','lecturer');update public.profiles set active=false where id='${inactive}'`,
  );
  let day = 0,
    checks = 0;
  const create = async (capacity = 1) => {
    day += 4;
    const payload = {
      title: "Fictional complete replacement block",
      customer_name: "Fictional organisation",
      delivery_type: "online",
      location: "https://example.invalid/classroom",
      status: "published",
      amount: 120,
      total_amount: 240,
      currency: "EUR",
      rate_unit: "per_day",
      terms: "Fictional immutable accepted terms",
      requires_contract: false,
      sessions: [1, 2].map((offset) => ({
        starts_at: new Date(Date.UTC(2040, 0, day + offset, 8)).toISOString(),
        ends_at: new Date(Date.UTC(2040, 0, day + offset, 10)).toISOString(),
      })),
    };
    const job = await actor(
      manager,
      capacity === 1
        ? `select public.create_job(${q(JSON.stringify(payload))}::jsonb)`
        : `select public.create_capacity_job(${q(JSON.stringify(payload))}::jsonb,${capacity},'${randomUUID()}')`,
      "aal2",
    );
    const terms = await sql(
      `select terms_version from public.jobs where id='${job}'`,
    );
    const claim = JSON.parse(
      await actor(
        original,
        `select public.claim_job('${job}','${randomUUID()}',${terms})`,
      ),
    );
    assert.equal(claim.status, "confirmed");
    return { job, claim: claim.claim_id, terms: Number(terms) };
  };
  const request = (
    c,
    who = original,
    key = randomUUID(),
    mode = "open",
    invited = [],
  ) =>
    actor(
      who,
      `select public.request_replacement('${c}', 'Fictional scheduling conflict',${q(mode)},array[${invited.map(q).join(",")}]::uuid[],false,'${key}')`,
      who === manager ? "aal2" : "aal1",
    );
  const list = async (who = first, aal = "aal1") =>
    JSON.parse(
      await actor(who, "select public.replacement_marketplace()", aal),
    );
  const take = async (
    offer,
    terms,
    who = first,
    key = randomUUID(),
    version = 1,
  ) =>
    JSON.parse(
      await actor(
        who,
        `select public.claim_replacement('${offer}',${version},${terms},'${key}')`,
      ),
    );
  const check = async (name, fn) => {
    await fn();
    checks++;
    console.log(`PASS ${name}`);
  };
  await check(
    "Only original or MFA job management may open an offer; private tables, unauthenticated and suspended deny",
    async () => {
      const c = await create();
      for (const who of [first, outsider, inactive])
        await assert.rejects(request(c.claim, who), /42501/);
      await assert.rejects(
        actor(
          manager,
          `select public.request_replacement('${c.claim}','Fictional request','open','{}',false,'${randomUUID()}')`,
        ),
        /42501/,
      );
      for (const who of [manager, first])
        await assert.rejects(
          actor(who, "select * from private.replacement_offers", "aal2"),
          /permission denied/,
        );
      await assert.rejects(
        sql("set role anon;select public.replacement_marketplace()"),
        /permission denied/,
      );
      await assert.rejects(list(inactive), /42501/);
      assert.equal((await list(outsider)).length, 0);
    },
  );
  await check(
    "Opening/retrying does not release original allocation or expose private cancellation reason",
    async () => {
      const c = await create(),
        key = randomUUID(),
        offer = await request(c.claim, original, key);
      assert.equal(await request(c.claim, original, key), offer);
      assert.equal(
        await sql(`select status from public.job_claims where id='${c.claim}'`),
        "confirmed",
      );
      assert.equal(
        await sql(
          `select count(*) from public.assignment_sessions where claim_id='${c.claim}' and released_at is null`,
        ),
        "2",
      );
      const visible = (await list()).find((o) => o.id === offer);
      assert.equal(visible.reason, null);
      assert.equal(visible.quote.total_amount, 240);
      assert.equal(visible.can_claim, true);
      assert.equal(
        (await list(original)).find((o) => o.id === offer).reason,
        "Fictional scheduling conflict",
      );
      await assert.rejects(request(c.claim), /already open/);
      await assert.rejects(
        request(c.claim, original, key, "selected", [first]),
        /idempotency conflict/,
      );
    },
  );
  await check(
    "Two concurrent claimants yield one complete winner, immutable old terms, access transfer and idempotent retry",
    async () => {
      const c = await create(),
        offer = await request(c.claim),
        keys = [randomUUID(), randomUUID()];
      const before = JSON.parse(
        await sql(
          `select to_jsonb(c) from public.job_claims c where id='${c.claim}'`,
        ),
      );
      const outcomes = await Promise.all([
        take(offer, c.terms, first, keys[0]),
        take(offer, c.terms, second, keys[1]),
      ]);
      assert.equal(outcomes.filter((r) => r.status === "confirmed").length, 1);
      assert.equal(outcomes.filter((r) => r.status !== "confirmed").length, 1);
      const index = outcomes.findIndex((r) => r.status === "confirmed"),
        winner = [first, second][index],
        result = outcomes[index];
      assert.deepEqual(await take(offer, c.terms, winner, keys[index]), result);
      const after = JSON.parse(
        await sql(
          `select to_jsonb(c) from public.job_claims c where id='${c.claim}'`,
        ),
      );
      assert.deepEqual(after, { ...before, status: "cancelled" });
      assert.equal(
        await sql(
          `select count(*) from public.job_claims where job_id='${c.job}' and status='confirmed'`,
        ),
        "1",
      );
      assert.equal(
        await sql(
          `select count(*) from public.assignment_sessions where claim_id='${result.claim_id}' and released_at is null`,
        ),
        "2",
      );
      assert.equal(
        await sql(
          `select count(*) from public.assignment_sessions where claim_id='${c.claim}' and released_at is not null`,
        ),
        "2",
      );
      assert.equal(
        await sql(
          `select count(*) from public.chat_members m join public.chat_rooms r on r.id=m.room_id where r.job_id='${c.job}' and m.user_id='${original}' and removed_at is null`,
        ),
        "0",
      );
      assert.equal(
        await sql(
          `select count(*) from public.chat_members m join public.chat_rooms r on r.id=m.room_id where r.job_id='${c.job}' and m.user_id='${winner}' and removed_at is null`,
        ),
        "1",
      );
      assert.equal(
        await sql(
          `select count(*) from public.claim_events where claim_id='${result.claim_id}' and event_type='confirmed'`,
        ),
        "1",
      );
      assert.equal(
        await sql(
          `select count(*) from public.notifications where user_id='${original}' and kind='replacement_completed' and resource_id='${offer}'`,
        ),
        "1",
      );
    },
  );
  await check(
    "Current schedule conflicts, expired/revoked qualifications and contract prerequisites are rechecked",
    async () => {
      const c = await create(),
        offer = await request(c.claim);
      const interval = JSON.parse(
        await sql(
          `select jsonb_build_object('start',min(starts_at),'end',max(ends_at)) from public.job_sessions where job_id='${c.job}'`,
        ),
      );
      await actor(
        first,
        `insert into public.personal_events(user_id,title,starts_at,ends_at,time_zone) values('${first}','Private fictional conflict','${interval.start}','${interval.end}','Europe/Berlin')`,
      );
      assert.equal((await take(offer, c.terms)).status, "not_eligible");
      await sql(`delete from public.personal_events where user_id='${first}'`);
      const topic = randomUUID();
      await sql(
        `insert into public.topics(id,label_de,label_en,kind) values('${topic}','Fiktive Ersatzqualifikation','Fictional replacement qualification','topic')`,
      );
      await sql(
        `insert into public.job_requirements(job_id,topic_id) values('${c.job}','${topic}');insert into public.lecturer_topics(user_id,topic_id,verified,valid_until) values('${first}','${topic}',true,now()-interval '1 day')`,
      );
      assert.equal((await take(offer, c.terms)).status, "not_eligible");
      await sql(
        `update public.lecturer_topics set valid_until=null,verified=false where user_id='${first}'`,
      );
      assert.equal((await take(offer, c.terms)).status, "not_eligible");
      await sql(
        `update public.lecturer_topics set verified=true where user_id='${first}';update public.jobs set requires_contract=true where id='${c.job}'`,
      );
      assert.equal((await take(offer, c.terms)).status, "not_eligible");
      assert.equal(
        await sql(`select status from public.job_claims where id='${c.claim}'`),
        "confirmed",
      );
    },
  );
  await check(
    "Selected invitations exclude other lecturers; cancel is CAS/idempotent and preserves the original",
    async () => {
      const c = await create(),
        offer = await request(c.claim, original, randomUUID(), "selected", [
          first,
        ]);
      assert.ok((await list(first)).some((o) => o.id === offer));
      assert.ok(!(await list(second)).some((o) => o.id === offer));
      assert.equal((await take(offer, c.terms, second)).status, "not_eligible");
      const key = randomUUID(),
        cancel = () =>
          actor(
            original,
            `select public.cancel_replacement('${offer}',1,'${key}')`,
          );
      assert.equal(await cancel(), offer);
      assert.equal(await cancel(), offer);
      assert.equal((await take(offer, c.terms)).status, "unavailable");
      await assert.rejects(
        actor(
          original,
          `select public.cancel_replacement('${offer}',1,'${randomUUID()}')`,
        ),
        /40001/,
      );
      assert.equal(
        await sql(`select status from public.job_claims where id='${c.claim}'`),
        "confirmed",
      );
    },
  );
  await check(
    "Failed handover rolls back original release, calendar, chat and new claim",
    async () => {
      const c = await create(),
        offer = await request(c.claim);
      await sql(
        `create function private.fail_replacement_test() returns trigger language plpgsql as $$begin if new.job_id='${c.job}'::uuid then raise exception 'Fictional handover failure';end if;return new;end;$$;create trigger fail_replacement_test before insert on public.job_claims for each row execute function private.fail_replacement_test()`,
      );
      await assert.rejects(take(offer, c.terms), /Fictional handover failure/);
      await sql(
        "drop trigger fail_replacement_test on public.job_claims;drop function private.fail_replacement_test()",
      );
      assert.equal(
        await sql(`select status from public.job_claims where id='${c.claim}'`),
        "confirmed",
      );
      assert.equal(
        await sql(
          `select count(*) from public.assignment_sessions where claim_id='${c.claim}' and released_at is null`,
        ),
        "2",
      );
      assert.equal(
        await sql(
          `select status from private.replacement_offers where id='${offer}'`,
        ),
        "open",
      );
      assert.equal(
        await sql(
          `select count(*) from public.job_claims where job_id='${c.job}'`,
        ),
        "1",
      );
      assert.equal(
        await sql(
          `select count(*) from public.chat_members m join public.chat_rooms r on r.id=m.room_id where r.job_id='${c.job}' and m.user_id='${original}' and removed_at is null`,
        ),
        "1",
      );
    },
  );
  await check(
    "Stale terms, original cancellation and partially started courses never silently hand over",
    async () => {
      const c = await create(),
        offer = await request(c.claim);
      assert.equal((await take(offer, c.terms + 1)).status, "terms_changed");
      await actor(
        original,
        `select public.cancel_job_assignment('${c.claim}','Fictional explicit cancellation','${randomUUID()}')`,
      );
      assert.equal((await take(offer, c.terms)).status, "not_eligible");
      const started = await create();
      await sql(
        `update public.job_sessions set starts_at=now()-interval '1 day',ends_at=now()-interval '23 hours' where id=(select id from public.job_sessions where job_id='${started.job}' order by starts_at limit 1)`,
      );
      await assert.rejects(request(started.claim), /Started or invoiced work/);
    },
  );
  await check(
    "Old vacancy deadlines do not prevent an authorised new replacement, and original metadata is retained",
    async () => {
      const c = await create();
      await sql(
        `update public.jobs set claim_deadline=now()-interval '1 minute' where id='${c.job}'`,
      );
      const deadline = await sql(
          `select claim_deadline::text from public.jobs where id='${c.job}'`,
        ),
        offer = await request(c.claim);
      assert.equal((await take(offer, c.terms)).status, "confirmed");
      assert.equal(
        await sql(
          `select claim_deadline::text from public.jobs where id='${c.job}'`,
        ),
        deadline,
      );
    },
  );
  await check(
    "Concurrent original cancellation and replacement claim serialize without double assignment or partial allocations",
    async () => {
      const c = await create(),
        offer = await request(c.claim);
      const outcomes = await Promise.allSettled([
        take(offer, c.terms),
        actor(
          original,
          `select public.cancel_job_assignment('${c.claim}','Fictional competing cancellation','${randomUUID()}')`,
        ),
      ]);
      assert.ok(outcomes.some((result) => result.status === "fulfilled"));
      const winners = Number(
        await sql(
          `select count(*) from public.job_claims where job_id='${c.job}' and status='confirmed'`,
        ),
      );
      assert.ok(winners === 0 || winners === 1);
      assert.equal(
        Number(
          await sql(
            `select count(*) from public.assignment_sessions s join public.job_claims c on c.id=s.claim_id where c.job_id='${c.job}' and s.released_at is null`,
          ),
        ),
        winners * 2,
      );
    },
  );
  await check(
    "Replacing one position cannot reopen another position paused by an independent cancellation",
    async () => {
      const c = await create(2),
        other = JSON.parse(
          await actor(
            second,
            `select public.claim_job('${c.job}','${randomUUID()}',${c.terms})`,
          ),
        );
      assert.equal(other.status, "confirmed");
      await actor(
        second,
        `select public.cancel_job_assignment('${other.claim_id}','Fictional paused second position','${randomUUID()}')`,
      );
      assert.equal(
        await sql(`select status from public.jobs where id='${c.job}'`),
        "draft",
      );
      const offer = await request(c.claim);
      assert.equal((await take(offer, c.terms)).status, "confirmed");
      assert.equal(
        await sql(`select status from public.jobs where id='${c.job}'`),
        "draft",
      );
      assert.equal(
        await sql(
          `select count(*) from public.job_claims where job_id='${c.job}' and status='confirmed'`,
        ),
        "1",
      );
    },
  );
  await check(
    "A nested P0002 after new-claim success never reports a rolled-back confirmation",
    async () => {
      const c = await create(),
        offer = await request(c.claim);
      await sql(
        `create function private.fail_completion_test() returns trigger language plpgsql as $$begin if new.id='${offer}'::uuid and new.status='completed' then raise exception using errcode='P0002',message='Fictional missing handover dependency';end if;return new;end;$$;create trigger fail_completion_test before update on private.replacement_offers for each row execute function private.fail_completion_test()`,
      );
      await assert.rejects(take(offer, c.terms), /P0002/);
      await sql(
        "drop trigger fail_completion_test on private.replacement_offers;drop function private.fail_completion_test()",
      );
      assert.equal(
        await sql(`select status from public.job_claims where id='${c.claim}'`),
        "confirmed",
      );
      assert.equal(
        await sql(
          `select status from private.replacement_offers where id='${offer}'`,
        ),
        "open",
      );
      assert.equal(
        await sql(
          `select count(*) from public.job_claims where job_id='${c.job}'`,
        ),
        "1",
      );
      assert.equal(
        await sql(
          `select count(*) from public.assignment_sessions where claim_id='${c.claim}' and released_at is null`,
        ),
        "2",
      );
    },
  );
  await check(
    "Teaching cannot start while a claimant waits on the job lock and still be transferred",
    async () => {
      const c = await create(),
        old = await sql(
          `select min(starts_at)::text from public.job_sessions where job_id='${c.job}'`,
        ),
        start = await sql(
          "select (clock_timestamp()+interval '2 seconds')::text",
        );
      await sql(
        `update public.job_sessions set starts_at=${q(start)},ends_at=${q(start)}::timestamptz+interval '1 hour' where job_id='${c.job}' and starts_at=${q(old)};update public.assignment_sessions set starts_at=${q(start)},ends_at=${q(start)}::timestamptz+interval '1 hour' where claim_id='${c.claim}' and starts_at=${q(old)};update public.course_sessions set starts_at=${q(start)},ends_at=${q(start)}::timestamptz+interval '1 hour' where course_run_id=(select course_run_id from public.jobs where id='${c.job}') and starts_at=${q(old)}`,
      );
      // Short-notice replacement needs an independent management decision;
      // the post-lock teaching-start refusal remains the behavior under test.
      const offer = await request(c.claim, manager),
        name = "replacement-lock-" + randomUUID();
      const blocker = sql(
        `begin;set local application_name=${q(name)};select id from public.jobs where id='${c.job}' for update;select pg_sleep(3);commit;`,
      );
      try {
        let locked = false;
        for (let attempt = 0; attempt < 80; attempt++) {
          if (
            (await sql(
              `select exists(select 1 from pg_stat_activity where application_name=${q(name)} and wait_event='PgSleep')`,
            )) === "t"
          ) {
            locked = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        assert.ok(locked, "The independent job lock must actually be held");
        assert.equal(
          await sql(`select clock_timestamp()<${q(start)}::timestamptz`),
          "t",
          "Claim must begin before the teaching boundary",
        );
        assert.equal((await take(offer, c.terms)).status, "unavailable");
      } finally {
        await blocker;
      }
      assert.equal(
        await sql(`select status from public.job_claims where id='${c.claim}'`),
        "confirmed",
      );
      assert.equal(
        await sql(
          `select count(*) from public.assignment_sessions where claim_id='${c.claim}' and released_at is null`,
        ),
        "2",
      );
    },
  );
  await check(
    "A replay after later cancellation never reports a live confirmation, and revoked roles cannot reuse receipts",
    async () => {
      const c = await create(),
        offer = await request(c.claim),
        key = randomUUID();
      const result = await take(offer, c.terms, first, key);
      assert.equal(result.status, "confirmed");
      await actor(
        first,
        `select public.cancel_job_assignment('${result.claim_id}','Fictional later cancellation','${randomUUID()}')`,
      );
      assert.equal(
        (await take(offer, c.terms, first, key)).status,
        "cancelled",
      );
      await sql(`delete from public.user_roles where user_id='${first}'`);
      assert.equal(
        (await take(offer, c.terms, first, key)).status,
        "not_eligible",
      );
      const other = await create(),
        managerKey = randomUUID();
      await request(other.claim, manager, managerKey);
      await sql(`delete from public.user_roles where user_id='${manager}'`);
      await assert.rejects(request(other.claim, manager, managerKey), /42501/);
      await sql(`delete from public.user_roles where user_id='${original}'`);
      const ownOffer = (await list(original)).find(
        (item) => item.job_id === other.job,
      );
      assert.equal(ownOffer.can_cancel, false);
      await assert.rejects(
        actor(
          original,
          `select public.cancel_replacement('${ownOffer.id}',1,'${randomUUID()}')`,
        ),
        /42501/,
      );
    },
  );
  console.log(`\n${checks} replacement PostgreSQL groups passed.`);
});
