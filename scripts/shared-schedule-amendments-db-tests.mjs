/** Verify independent shared schedule consent and all-or-nothing application on the migrated database. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

await withTestDatabase("shared_schedule_amendments", async (database) => {
  await verifySchedule(database, false);
  await verifySchedule(database, true);
});

async function verifySchedule({ sql, actor }, positionsInOneOffer) {
  const [manager, first, second, learner, outsider, company, template, run] =
    Array.from({ length: 8 }, randomUUID);
  const accounts = [
    [manager, "admin"],
    [first, "lecturer"],
    [second, "lecturer"],
    [learner, "participant"],
    [outsider, "lecturer"],
  ];
  await sql(`
    insert into auth.users(id,email,email_confirmed_at) values
      ${accounts.map(([id]) => `(${q(id)},${q(id + "@example.invalid")},now())`).join(",")};
    insert into public.user_roles(user_id,role) values
      ${accounts.map(([id, role]) => `(${q(id)},${q(role)})`).join(",")};
    insert into public.organisations(id,name) values(${q(company)},'Fictional course organisation');
    insert into public.course_templates(id,title) values(${q(template)},'Fictional shared workshop');
    insert into public.course_runs(id,organisation_id,template_id,time_zone,published)
      values(${q(run)},${q(company)},${q(template)},'Australia/Brisbane',true);
    insert into public.course_sessions(course_run_id,starts_at,ends_at)
      values(${q(run)},now()+interval '10 days',now()+interval '10 days 1 hour'),
            (${q(run)},now()+interval '11 days',now()+interval '11 days 1 hour');
  `);

  const rpc = async (who, functionName, ...args) => {
    const values = args.map((value) =>
      value === null
        ? "null"
        : typeof value === "number" || typeof value === "boolean"
          ? String(value)
          : q(typeof value === "object" ? JSON.stringify(value) : value),
    );
    return JSON.parse(
      await actor(
        who,
        `select to_jsonb(public.${functionName}(${values.join(",")}))`,
      ),
    );
  };
  await rpc(manager, "set_company_premium", company, true, 0, randomUUID());
  const userId = await sql(
    `select luminovia_user_id from public.profiles where id=${q(learner)}`,
  );
  await rpc(
    manager,
    "request_company_participant_link",
    company,
    userId,
    randomUUID(),
  );
  await rpc(
    learner,
    "accept_company_participant_invitation",
    company,
    1,
    randomUUID(),
  );
  await actor(
    manager,
    `select public.manage_course_enrolment(${q(run)},${q(learner)},'enrolled')`,
  );

  async function job(lecturer, total, currency) {
    const jobId = randomUUID();
    await sql(`
      insert into public.jobs(id,course_run_id,title,customer_name,delivery_type,status,
        amount,total_amount,currency,rate_unit,terms,created_by)
      values (${q(jobId)},${q(run)},'Fictional workshop offer','Fictional course organisation',
        'onsite','published',${total},${total},${q(currency)},'fixed_total','Retained fictional terms',${q(manager)});
      insert into public.job_sessions(job_id,course_session_id,starts_at,ends_at)
        select ${q(jobId)},id,starts_at,ends_at from public.course_sessions where course_run_id=${q(run)};
    `);
    const receipt = await rpc(lecturer, "claim_job", jobId, randomUUID(), 1);
    assert.equal(receipt.status, "confirmed");
    return receipt.claim_id;
  }
  let firstClaim, secondClaim, courseOfferReceipt;
  if (positionsInOneOffer) {
    const defaults = await rpc(manager, "course_run_job_defaults", run);
    const payload = {
      source_revision: defaults.source_revision,
      gross_amount: 300,
      gross_total_amount: 300,
      currency: "AUD",
      rate_unit: "fixed_total",
      status: "published",
      terms: "Retained fictional capacity terms",
      requires_contract: false,
      capacity: 2,
    };
    for (const capacity of [0, 21, 1.5, "2", null]) {
      await assert.rejects(
        rpc(
          manager,
          "create_course_run_job",
          run,
          { ...payload, capacity },
          null,
          randomUUID(),
        ),
        /1 to 20 positions/,
      );
    }
    const issueKey = randomUUID();
    const offer = await rpc(
      manager,
      "create_course_run_job",
      run,
      payload,
      null,
      issueKey,
    );
    courseOfferReceipt = { offer, payload, issueKey };
    assert.equal(
      await sql(
        `select capacity || ':' || capacity_basis from public.jobs where id=${q(offer)}`,
      ),
      "2:per_position",
    );
    const claimPosition = async (lecturer) => {
      const { terms_version } = await rpc(lecturer, "job_detail", offer);
      return await rpc(
        lecturer,
        "claim_job",
        offer,
        randomUUID(),
        terms_version,
      );
    };
    const firstReceipt = await claimPosition(first);
    assert.equal(firstReceipt.status, "confirmed");
    assert.equal(
      (await rpc(manager, "changeable_assignments")).some(
        (item) => item.claim_id === firstReceipt.claim_id,
      ),
      false,
    );
    const secondReceipt = await claimPosition(second);
    assert.equal(secondReceipt.status, "confirmed");
    firstClaim = firstReceipt.claim_id;
    secondClaim = secondReceipt.claim_id;
  } else {
    firstClaim = await job(first, 150, "AUD");
    secondClaim = await job(second, 120, "EUR");
  }
  const jobVersions = async () =>
    JSON.parse(
      await sql(`select jsonb_object_agg(id,lifecycle_version)
    from public.jobs where course_run_id=${q(run)}`),
    );
  const initialJobVersions = await jobVersions();
  const issuanceReceipts = async () =>
    await sql(`select jsonb_build_array(to_jsonb(issuance),to_jsonb(request),to_jsonb(fee))
    from private.course_run_job_requests issuance
    join private.client_course_requests request on request.job_id=issuance.job_id
    join private.job_commission_offers fee on fee.job_id=issuance.job_id
    where issuance.course_run_id=${q(run)}`);
  const initialIssuanceReceipts = await issuanceReceipts();
  const originalClaims = () =>
    sql(`select jsonb_agg(to_jsonb(claim) order by id)
    from public.job_claims claim where id in (${q(firstClaim)},${q(secondClaim)})`).then(
      JSON.parse,
    );
  const schedule = () =>
    sql(`select jsonb_agg(jsonb_build_object('id',session.id,'starts_at',session.starts_at,'ends_at',session.ends_at,
    'offer_ids',(select jsonb_agg(offer.id order by offer.id) from public.job_sessions offer where offer.course_session_id=session.id))
    order by session.starts_at,session.id)
    from public.course_sessions session where session.course_run_id=${q(run)}`).then(
      JSON.parse,
    );
  const day = 86_400_000;
  const move = (rows, days) =>
    rows.map((slot) => ({
      starts_at: new Date(
        Date.parse(slot.starts_at) + days * day,
      ).toISOString(),
      ends_at: new Date(Date.parse(slot.ends_at) + days * day).toISOString(),
    }));
  const draft = (who, claim, changes) =>
    rpc(
      who,
      "save_assignment_change",
      null,
      claim,
      { reason: "Fictional shared schedule request", changes },
      0,
      randomUUID(),
    );
  const read = async (id, who = manager) =>
    (await rpc(who, "assignment_changes", id))[0];
  const act = async (
    who,
    id,
    action,
    note = "",
    key = randomUUID(),
    version = null,
  ) =>
    rpc(
      who,
      "assignment_change_action",
      id,
      action,
      version ?? (await read(id)).version,
      note,
      key,
    );
  const siblingOf = (root) =>
    sql(`select id from private.assignment_change_requests
    where shared_schedule_group_id=${q(root)} and claim_id=${q(secondClaim)}`);
  async function approve(root, sibling) {
    await act(manager, root, "accept");
    await act(first, root, "accept");
    await act(manager, sibling, "accept");
    await act(second, sibling, "accept");
  }

  const base = await schedule();
  const retained = await originalClaims();
  const requested = move(base, 1);
  const options = await rpc(manager, "changeable_assignments");
  assert.equal(
    options.find((item) => item.claim_id === firstClaim).shared_schedule_only,
    true,
  );
  assert.equal(
    options.find((item) => item.claim_id === secondClaim).schedule_editable,
    true,
  );
  assert.equal(
    (await rpc(first, "changeable_assignments")).some(
      (item) => item.claim_id === firstClaim,
    ),
    false,
  );
  await assert.rejects(
    draft(first, firstClaim, { sessions: requested }),
    /42501/,
  );
  await assert.rejects(
    draft(manager, firstClaim, {
      sessions: requested,
      amount: 151,
      total_amount: 151,
    }),
    /only change the schedule/,
  );
  await assert.rejects(
    draft(manager, firstClaim, { sessions: requested.slice(0, 1) }),
    /keep its session count/,
  );
  await assert.rejects(
    draft(manager, firstClaim, { sessions: move(base, -1) }),
    /withdrawal deadline/,
  );

  const rejected = await draft(manager, firstClaim, { sessions: requested });
  const submitKey = randomUUID();
  assert.equal(
    await act(manager, rejected, "submit", "", submitKey, 1),
    rejected,
  );
  assert.equal(
    await act(manager, rejected, "submit", "", submitKey, 1),
    rejected,
  );
  const rejectedSibling = await siblingOf(rejected);
  assert.match(rejectedSibling, /^[a-f0-9-]{36}$/);
  await assert.rejects(read(rejectedSibling, first), /42501/);
  await assert.rejects(read(rejected, outsider), /42501/);
  const waiting = (await read(rejected, first)).shared_schedule;
  assert.deepEqual(waiting, {
    required: 2,
    accepted: 0,
    state: "awaiting_consent",
  });
  const duplicate = await draft(manager, secondClaim, { sessions: requested });
  await assert.rejects(
    act(manager, duplicate, "submit"),
    /already open for this course/,
  );
  await act(
    second,
    rejectedSibling,
    "reject",
    "Fictional lecturer could not attend.",
  );
  assert.equal((await read(rejected, first)).shared_schedule.state, "blocked");
  await assert.rejects(
    act(first, rejected, "accept"),
    /no longer awaits consent/,
  );
  assert.deepEqual(await schedule(), base);
  console.log(
    "PASS shared scope, retained withdrawal deadline, single proposal and scoped individual rejection",
  );

  const root = await draft(manager, firstClaim, { sessions: requested });
  await act(manager, root, "submit");
  const sibling = await siblingOf(root);
  await act(manager, root, "accept");
  await act(first, root, "accept");
  assert.equal((await read(root)).can_apply, false);
  await assert.rejects(
    act(manager, root, "apply"),
    /requires consent to the same shared schedule/,
  );
  assert.deepEqual(await schedule(), base);
  await act(manager, sibling, "accept");
  await act(second, sibling, "accept");
  assert.deepEqual((await read(sibling, second)).shared_schedule, {
    required: 2,
    accepted: 2,
    state: "ready",
  });
  await assert.rejects(act(second, sibling, "apply"), /42501/);
  const privateCommitment = randomUUID();
  await sql(`insert into public.personal_events(id,user_id,title,starts_at,ends_at,time_zone)
    values(${q(privateCommitment)},${q(second)},'Fictional private calendar block',
      ${q(requested[1].starts_at)},${q(requested[1].ends_at)},'Europe/Berlin')`);
  await assert.rejects(
    act(manager, root, "apply"),
    /conflict with current commitments/,
  );
  assert.deepEqual(await schedule(), base);
  assert.equal(
    await sql(
      `select count(*) from private.assignment_amendments where claim_id in (${q(firstClaim)},${q(secondClaim)})`,
    ),
    "0",
  );
  await sql(
    `delete from public.personal_events where id=${q(privateCommitment)}`,
  );

  const applyKey = randomUUID();
  const rootVersion = (await read(root)).version;
  const siblingVersion = (await read(sibling)).version;
  const applications = await Promise.allSettled([
    act(manager, root, "apply", "", applyKey, rootVersion),
    act(manager, sibling, "apply", "", randomUUID(), siblingVersion),
  ]);
  assert.equal(
    applications.filter(({ status }) => status === "fulfilled").length,
    1,
  );
  assert.match(
    applications.find(({ status }) => status === "rejected").reason.message,
    /40001/,
  );
  if (applications[0].status === "fulfilled")
    assert.equal(
      await act(manager, root, "apply", "", applyKey, rootVersion),
      root,
    );
  assert.deepEqual((await read(root)).shared_schedule, {
    required: 2,
    accepted: 2,
    state: "applied",
  });
  assert.equal((await read(sibling, second)).status, "applied");
  const moved = await schedule();
  assert.deepEqual(
    moved.map(({ id, offer_ids }) => [id, offer_ids]),
    base.map(({ id, offer_ids }) => [id, offer_ids]),
  );
  assert.deepEqual(
    moved.map(({ starts_at, ends_at }) => [
      Date.parse(starts_at),
      Date.parse(ends_at),
    ]),
    requested.map(({ starts_at, ends_at }) => [
      Date.parse(starts_at),
      Date.parse(ends_at),
    ]),
  );
  assert.equal(
    await sql(`select count(*) from private.assignment_session_supersessions superseded
    join public.assignment_sessions session on session.id=superseded.session_id
    where session.claim_id in (${q(firstClaim)},${q(secondClaim)}) and session.released_at is not null`),
    "4",
  );
  assert.deepEqual(await originalClaims(), retained);
  assert.deepEqual(
    await jobVersions(),
    Object.fromEntries(
      Object.entries(initialJobVersions).map(([id, version]) => [
        id,
        version + 1,
      ]),
    ),
  );
  if (courseOfferReceipt) {
    assert(initialIssuanceReceipts);
    assert.equal(await issuanceReceipts(), initialIssuanceReceipts);
    assert.equal(
      await rpc(
        manager,
        "create_course_run_job",
        run,
        courseOfferReceipt.payload,
        null,
        courseOfferReceipt.issueKey,
      ),
      courseOfferReceipt.offer,
    );
    console.log(
      "PASS course-linked offer creation and idempotent issuance receipt after a two-position amendment",
    );
  }
  assert.equal(
    await sql(
      `select status from public.course_enrolments where course_run_id=${q(run)} and user_id=${q(learner)}`,
    ),
    "enrolled",
  );
  const inbox = await rpc(learner, "notification_inbox", false, null, null, 20);
  assert(
    inbox.items.some(
      (notice) =>
        notice.kind === "course_schedule_changed" &&
        notice.href === `/courses/${run}/workspace`,
    ),
  );
  console.log(
    "PASS joint consent, calendar conflict rollback, concurrent apply, retained IDs, compensation and enrolment notice",
  );

  const later = await draft(manager, firstClaim, { sessions: move(moved, 1) });
  await act(manager, later, "submit");
  await approve(later, await siblingOf(later));
  await sql(`insert into private.course_attendance_audit(session_id,user_id,actor_id,new_state,reason)
      values(${q(moved[0].id)},${q(learner)},${q(manager)},'{"state":"absent"}','Fictional retained evidence')`);
  await assert.rejects(
    act(manager, later, "apply"),
    /linked assignments changed/,
  );
  assert.deepEqual(await schedule(), moved);
  await rpc(manager, "set_company_premium", company, false, 1, randomUUID());
  assert.equal(
    (
      await rpc(learner, "notification_inbox", false, null, null, 20)
    ).items.some((notice) => notice.kind === "course_schedule_changed"),
    false,
  );
  console.log(
    "PASS retained attendance blocks the move and paused access hides the course notice",
  );
}
