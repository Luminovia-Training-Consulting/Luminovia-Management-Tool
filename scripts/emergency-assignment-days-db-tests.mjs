/** Exercise the native emergency roster transaction through ordinary job discovery and claim. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

await withTestDatabase("emergency_assignment_days", async ({ actor, sql }) => {
  const [
    owner,
    first,
    second,
    blocked,
    finance,
    company,
    learner,
    org,
    course,
    template,
    sourceJob,
    normalJob,
    sourceClaim,
    topic,
  ] = Array.from({ length: 14 }, randomUUID);
  const identities = [
    [owner, "lecturer"],
    [first, "lecturer"],
    [second, "lecturer"],
    [blocked, "lecturer"],
    [finance, "admin"],
    [company, "client"],
    [learner, "participant"],
  ];
  const dates = [
    ["2020-01-01T02:00:00Z", "2020-01-01T04:00:00Z"],
    ["2090-04-11T15:00:00Z", "2090-04-11T16:00:00Z"],
    ["2090-04-12T01:00:00Z", "2090-04-12T02:00:00Z"],
    ["2090-04-13T01:00:00Z", "2090-04-13T03:00:00Z"],
  ].map(([start, end]) => ({
    id: randomUUID(),
    courseSession: randomUUID(),
    start,
    end,
  }));
  await sql(`
      insert into auth.users(id,email,email_confirmed_at) values
        ${identities.map(([id]) => `(${q(id)},${q(id + "@example.invalid")},now())`).join(",")};
      insert into public.user_roles(user_id,role) values
        ${identities.map(([id, role]) => `(${q(id)},${q(role)})`).join(",")};
      insert into public.organisations(id,name) values(${q(org)},'Fictional Emergency Training');
      insert into public.client_organisation_memberships(user_id,organisation_id) values(${q(company)},${q(org)});
      insert into public.course_templates(id,title) values(${q(template)},'Fictional Emergency Course');
      insert into public.course_runs(id,template_id,organisation_id,published,time_zone)
        values(${q(course)},${q(template)},${q(org)},true,'Asia/Tokyo');
      insert into public.course_sessions(id,course_run_id,starts_at,ends_at) values
        ${dates.map(({ courseSession, start, end }) => `(${q(courseSession)},${q(course)},${q(start)},${q(end)})`).join(",")};
      insert into public.jobs(id,course_run_id,title,customer_name,delivery_type,time_zone,status,amount,currency,rate_unit,total_amount,terms)
        values(${q(sourceJob)},${q(course)},'Zebra Fictional Course','Fictional Emergency Training','online','Asia/Tokyo','filled',420,'EUR','fixed_total',420,'Original fixture terms'),
              (${q(normalJob)},${q(course)},'Alpha Ordinary Offer','Fictional Emergency Training','online','Asia/Tokyo','published',100,'EUR','fixed_total',100,'Ordinary fixture terms');
      insert into public.job_sessions(job_id,course_session_id,starts_at,ends_at) values
        ${dates.map(({ courseSession, start, end }) => `(${q(sourceJob)},${q(courseSession)},${q(start)},${q(end)})`).join(",")};
      insert into public.job_sessions(job_id,starts_at,ends_at)
        values(${q(normalJob)},'2090-04-10T08:00:00Z','2090-04-10T10:00:00Z');
      insert into private.job_commission_offers(
        job_id,organisation_id,gross_amount,gross_total_amount,platform_percent,platform_total_amount,
        lecturer_net_amount,lecturer_net_total_amount,currency,pricing_mode)
        values(${q(sourceJob)},${q(org)},600,600,30,180,420,420,'EUR','legacy');
      insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,status,amount,currency,rate_unit,total_amount,terms,terms_version)
        values(${q(sourceClaim)},${q(sourceJob)},${q(owner)},${q(randomUUID())},'confirmed',420,'EUR','fixed_total',420,'Original fixture terms',1);
      insert into public.assignment_sessions(id,claim_id,lecturer_id,starts_at,ends_at) values
        ${dates.map(({ id, start, end }) => `(${q(id)},${q(sourceClaim)},${q(owner)},${q(start)},${q(end)})`).join(",")};
      insert into public.topics(id,label_de,label_en,kind) values(${q(topic)},'Emergency fixture topic','Emergency fixture topic','topic');
      insert into public.job_requirements(job_id,topic_id) values(${q(sourceJob)},${q(topic)}),(${q(normalJob)},${q(topic)});
      insert into public.lecturer_topics(user_id,topic_id)
        values(${q(owner)},${q(topic)}),(${q(second)},${q(topic)}),(${q(blocked)},${q(topic)});
      insert into private.company_lecturer_blocks(organisation_id,lecturer_id,blocked,version)
        values(${q(org)},${q(blocked)},true,1);
    `);

  const rpc = (who, call) =>
    actor(who, `select to_jsonb(public.${call});`).then(JSON.parse);
  const report = (who, session, key = randomUUID()) =>
    rpc(
      who,
      `report_assignment_sick_day(${q(sourceClaim)},${q(session)},${q(key)})`,
    );
  const discover = (who, sort, cursor = null) =>
    rpc(
      who,
      `job_discovery(${q(JSON.stringify({ sort }))},${cursor ? q(JSON.stringify(cursor)) : "null"},1)`,
    );
  const detail = (who, id) => rpc(who, `job_detail(${q(id)})`);
  const claim = (who, id) =>
    rpc(who, `claim_job(${q(id)},${q(randomUUID())},1)`);

  const key = randomUUID();
  await assert.rejects(report(first, dates[1].id), /42501/);
  await assert.rejects(report(learner, dates[1].id), /42501/);
  await assert.rejects(report(owner, dates[0].id), /No future sessions/);
  const [published, retry] = await Promise.all([
    report(owner, dates[1].id, key),
    report(owner, dates[2].id, key),
  ]);
  assert.deepEqual(retry, published);
  assert.deepEqual(await report(owner, dates[2].id), published);
  await assert.rejects(report(owner, dates[3].id, key), /idempotency conflict/);
  assert.equal(published.released_sessions, 2);
  assert.equal(published.teaching_date, "2090-04-12");

  const urgent = published.job_id;
  assert.equal((await discover(blocked, "title")).items.length, 0);
  assert.equal((await discover(owner, "title")).items[0].id, normalJob);
  await assert.rejects(detail(blocked, urgent), /42501/);
  await assert.rejects(detail(owner, urgent), /42501/);
  assert.equal((await claim(blocked, urgent)).status, "not_eligible");
  assert.equal((await claim(owner, urgent)).status, "not_eligible");
  assert.equal((await claim(first, normalJob)).status, "not_eligible");

  const unmatched = await discover(first, "title");
  assert.deepEqual(unmatched.items.map(({ id }) => id), [urgent]);
  assert.equal(unmatched.next_cursor, null);

  for (const sort of ["title", "soonest", "newest"]) {
    const firstPage = await discover(second, sort);
    assert.equal(firstPage.items[0].id, urgent);
    assert.ok(firstPage.items[0].urgent_reopened_at);
    assert.equal(firstPage.next_cursor.urgent, true);
    const secondPage = await discover(second, sort, firstPage.next_cursor);
    assert.equal(secondPage.items[0].id, normalJob);
    assert.equal(secondPage.items[0].urgent_reopened_at, null);
  }
  const publicOffer = await detail(first, urgent);
  assert.equal(publicOffer.terms, "Original fixture terms");
  assert.equal(publicOffer.total_amount, 140);
  assert.deepEqual(publicOffer.job_requirements, [{ topic_id: topic }]);
  assert.equal(publicOffer.job_sessions.length, 2);
  assert.ok(!JSON.stringify(publicOffer).includes(owner));
  assert.ok(!JSON.stringify(publicOffer).includes(sourceClaim));
  const state = JSON.parse(
    await sql(`select jsonb_build_object(
      'original', (select row_to_json(c) from (select c.status, c.total_amount, l.gross_total_amount
        from public.job_claims c join private.claim_revenue_ledger l on l.claim_id = c.id where c.id = ${q(sourceClaim)}) c),
      'released', (select jsonb_agg(s.id order by s.starts_at) from public.assignment_sessions s
        where s.claim_id = ${q(sourceClaim)} and s.released_at is not null),
      'course', (select j.course_run_id from public.jobs j where j.id = ${q(urgent)}),
      'course_sessions', (select jsonb_agg(s.course_session_id order by s.starts_at)
        from public.job_sessions s where s.job_id = ${q(urgent)})
    );`),
  );
  assert.deepEqual(state.original, {
    status: "confirmed",
    total_amount: 420,
    gross_total_amount: 600,
  });
  assert.deepEqual(
    state.released,
    dates.slice(1, 3).map(({ id }) => id),
  );
  assert.deepEqual(
    state.course_sessions,
    dates.slice(1, 3).map(({ courseSession }) => courseSession),
  );
  assert.equal(state.course, course);

  const competing = await Promise.all([
    claim(first, urgent),
    claim(second, urgent),
  ]);
  assert.deepEqual(competing.map(({ status }) => status).sort(), [
    "confirmed",
    "filled",
  ]);
  const accepted = competing.find(({ status }) => status === "confirmed");
  assert.equal(
    await sql(
      `select count(*) from public.assignment_sessions where claim_id = ${q(accepted.claim_id)}`,
    ),
    "2",
  );
  assert.ok(
    await rpc(
      owner,
      `request_invoice_review(${q(sourceClaim)},${q(randomUUID())})`,
    ),
  );
  const fullCustomerBill = {
    claim_ids: [sourceClaim],
    number: "QA emergency invoice",
    issued_on: "2090-04-15",
    due_on: "2090-05-15",
    currency: "EUR",
    total_amount: "600.00",
    document_version_id: randomUUID(),
    difference_reason: "Fictional correction",
  };
  await assert.rejects(
    rpc(
      finance,
      `register_customer_invoice(${q(JSON.stringify(fullCustomerBill))},${q(randomUUID())})`,
    ),
    /emergency_financial_review_required/,
  );
  console.log(
    "PASS Local-day emergency publication, idempotent retries, urgency pagination, lecturer blocks, ordinary atomic claim and invoice review.",
  );

  const [legacyJob, legacyClaim, legacyDay, remainingDay, withdrawal] =
    Array.from({ length: 5 }, randomUUID);
  await sql(`
    insert into public.jobs(id,title,customer_name,delivery_type,time_zone,status,amount,currency,rate_unit,total_amount,terms)
    values (${q(legacyJob)},'Fictional request-only offer','Fictional Emergency Training','online','UTC','filled',100,'EUR','fixed_total',100,'Fixture terms');
    insert into private.client_course_requests(organisation_id,requested_by,client_id,payload,status,job_id)
    values (${q(org)},${q(company)},${q(randomUUID())},'{}','published',${q(legacyJob)});
    insert into public.job_sessions(job_id,starts_at,ends_at)
    values (${q(legacyJob)},'2090-06-01T09:00Z','2090-06-01T10:00Z'),
      (${q(legacyJob)},'2090-06-02T09:00Z','2090-06-02T10:00Z');
    insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,status,amount,currency,rate_unit,total_amount,terms,terms_version)
    values (${q(legacyClaim)},${q(legacyJob)},${q(owner)},${q(randomUUID())},'confirmed',100,'EUR','fixed_total',100,'Fixture terms',1);
    insert into public.assignment_sessions(id,claim_id,lecturer_id,starts_at,ends_at)
    values (${q(legacyDay)},${q(legacyClaim)},${q(owner)},'2090-06-01T09:00Z','2090-06-01T10:00Z'),
      (${q(remainingDay)},${q(legacyClaim)},${q(owner)},'2090-06-02T09:00Z','2090-06-02T10:00Z');
    insert into private.assignment_withdrawals(id,claim_id,lecturer_id,status,reason)
    values (${q(withdrawal)},${q(legacyClaim)},${q(owner)},'pending','Earlier fixture withdrawal');
  `);
  const requestReplacement = (requestId) =>
    rpc(
      owner,
      `request_replacement(${q(legacyClaim)},'Earlier fixture replacement','open','{}',false,${q(requestId)})`,
    );
  const partialReport = (session) =>
    rpc(
      owner,
      `report_assignment_sick_day(${q(legacyClaim)},${q(session)},${q(randomUUID())})`,
    );
  const legacyRequest = randomUUID();
  const replacement = await requestReplacement(legacyRequest);
  const substitution = await rpc(
    owner,
    `propose_job_substitution(${q(legacyClaim)},${q(first)},'Earlier fixture substitution',${q(randomUUID())})`,
  );
  const previous = (await rpc(first, "replacement_marketplace()")).find(
    ({ id }) => id === replacement,
  );
  assert.equal(previous.can_claim, true);
  await assert.rejects(detail(blocked, legacyJob), /42501/);

  const reopened = (await partialReport(legacyDay)).job_id;
  await assert.rejects(detail(blocked, reopened), /42501/);
  assert.equal((await claim(blocked, reopened)).status, "not_eligible");
  assert.equal((await detail(first, reopened)).job_sessions.length, 1);
  assert.equal(await requestReplacement(legacyRequest), replacement);
  await assert.rejects(
    requestReplacement(randomUUID()),
    /emergency_whole_block_unavailable/,
  );
  await assert.rejects(
    rpc(
      owner,
      `request_assignment_withdrawal(${q(legacyClaim)},'Legacy whole block',${q(randomUUID())})`,
    ),
    /emergency_whole_block_unavailable/,
  );
  const statuses = JSON.parse(
    await sql(`select jsonb_build_object(
      'replacement',(select status from private.replacement_offers where id=${q(replacement)}),
      'substitution',(select status from private.job_substitutions where id=${q(substitution)}),
      'withdrawal',(select status from private.assignment_withdrawals where id=${q(withdrawal)}),
      'retained',(select released_at is null from public.assignment_sessions where id=${q(remainingDay)})
    );`),
  );
  assert.deepEqual(statuses, {
    replacement: "cancelled",
    substitution: "superseded",
    withdrawal: "superseded",
    retained: true,
  });
  const staleClaim = (version) =>
    rpc(
      first,
      `claim_replacement(${q(replacement)},${version},${previous.quote.terms_version},${q(randomUUID())})`,
    );
  assert.equal((await staleClaim(previous.version)).status, "unavailable");

  // Even a legacy row retained as open cannot bypass the new eligibility check.
  await sql(
    `update private.replacement_offers set status='open' where id=${q(replacement)};`,
  );
  assert.equal((await staleClaim(previous.version + 1)).status, "not_eligible");
  await assert.rejects(
    actor(
      finance,
      `select public.cancel_job_assignment(${q(legacyClaim)},'Legacy whole block',${q(randomUUID())})`,
      "aal2",
    ),
    /emergency_whole_block_unavailable/,
  );
  assert.equal(
    await sql(
      `select released_at is null from public.assignment_sessions where id=${q(remainingDay)};`,
    ),
    "t",
  );
  assert.equal((await claim(first, reopened)).status, "confirmed");

  const secondDayOffer = (await partialReport(remainingDay)).job_id;
  assert.equal((await detail(second, secondDayOffer)).job_sessions.length, 1);
  const oldVersion = Number(
    await sql(`select lifecycle_version from public.jobs where id=${q(legacyJob)};`),
  );
  await assert.rejects(
    actor(
      finance,
      `select public.manage_job_offer(${q(legacyJob)},'reopen',${oldVersion},${q(randomUUID())},'{"reason":"Legacy whole block"}')`,
      "aal2",
    ),
    /emergency_whole_block_unavailable/,
  );
  console.log(
    "PASS Partial emergency days fence stale whole-block offers, preserve remaining sessions and inherit request-only company blocks.",
  );
});
