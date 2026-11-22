/** Verify independent shared schedule consent and all-or-nothing application on the migrated database. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

await withTestDatabase("shared_schedule_amendments", async (database) => {
  const acrossMidnight = [
    { starts_at: "2045-01-01T12:00:00Z", ends_at: "2045-01-01T15:00:00Z" },
  ];
  const endsAtMidnight = [
    { ...acrossMidnight[0], ends_at: "2045-01-01T14:00:00Z" },
  ];
  for (const [sessions, unit, quantity] of [
    [acrossMidnight, "per_day", 2],
    [endsAtMidnight, "per_day", 1],
    [acrossMidnight, "per_hour", 10_800],
    [endsAtMidnight, "per_teaching_unit", 7_200],
    [acrossMidnight, "fixed_total", 0],
  ]) {
    assert.equal(
      Number(
        await database.sql(`select private.shared_schedule_quantity(
      ${q(JSON.stringify(sessions))}, 'Australia/Brisbane', ${q(unit)})`),
      ),
      quantity,
    );
  }
  console.log(
    "PASS billable days follow the course zone and duration follows actual elapsed time",
  );
  await verifySchedule(database, false);
  await verifySchedule(database, true);
});

async function verifySchedule({ sql, actor }, positionsInOneOffer) {
  const [manager, first, second, learner, outsider, company, template, run,
    customer, customerPeer, foreignCustomer, foreignCompany, operations] =
    Array.from({ length: 13 }, randomUUID);
  const accounts = [
    [manager, "admin"],
    [first, "lecturer"],
    [second, "lecturer"],
    [learner, "participant"],
    [outsider, "lecturer"],
    [customer, "client"],
    [customerPeer, "client"],
    [foreignCustomer, "client"],
    [operations, "management"],
  ];
  await sql(`
    insert into auth.users(id,email,email_confirmed_at) values
      ${accounts.map(([id]) => `(${q(id)},${q(id + "@example.invalid")},now())`).join(",")};
    insert into public.user_roles(user_id,role) values
      ${accounts.map(([id, role]) => `(${q(id)},${q(role)})`).join(",")};
    insert into public.organisations(id,name) values(${q(company)},'Fictional course organisation'),
      (${q(foreignCompany)},'Fictional different organisation');
    insert into public.client_organisation_memberships(user_id,organisation_id)
      values(${q(customer)},${q(company)}),(${q(customerPeer)},${q(company)}),
      (${q(foreignCustomer)},${q(foreignCompany)});
    insert into public.course_templates(id,title) values(${q(template)},'Fictional shared workshop');
    insert into public.course_runs(id,organisation_id,template_id,time_zone,published)
      values(${q(run)},${q(company)},${q(template)},'Australia/Brisbane',true);
    insert into public.course_sessions(course_run_id,starts_at,ends_at)
      select ${q(run)}, local_midnight + days * interval '1 day' + interval '9 hours',
        local_midnight + days * interval '1 day' + interval '10 hours'
      from (select date_trunc('day', now() at time zone 'Australia/Brisbane') at time zone 'Australia/Brisbane' local_midnight) today
      cross join (values (10), (11)) scheduled(days);
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

  async function job(lecturer, total, currency, rateUnit = "fixed_total") {
    const jobId = randomUUID();
    await sql(`
      insert into public.jobs(id,course_run_id,title,customer_name,delivery_type,status,
        amount,total_amount,currency,rate_unit,terms,created_by)
      values (${q(jobId)},${q(run)},'Fictional workshop offer','Fictional course organisation',
        'onsite','published',${total},${total},${q(currency)},${q(rateUnit)},'Retained fictional terms',${q(manager)});
      insert into public.job_sessions(job_id,course_session_id,starts_at,ends_at)
        select ${q(jobId)},id,starts_at,ends_at from public.course_sessions where course_run_id=${q(run)};
    `);
    const receipt = await rpc(lecturer, "claim_job", jobId, randomUUID(), 1);
    assert.equal(receipt.status, "confirmed");
    return receipt.claim_id;
  }
  const day = 86_400_000;
  let firstClaim, secondClaim, courseOfferReceipt, claimPosition;
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
      claim_deadline: new Date(
        Date.parse(defaults.sessions[0].starts_at) - day,
      ).toISOString(),
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
    claimPosition = async (lecturer) => {
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
    firstClaim = firstReceipt.claim_id;
  } else {
    firstClaim = await job(first, 150, "AUD", "per_day");
    secondClaim = await job(second, 120, "EUR");
  }
  const jobVersions = async () =>
    JSON.parse(
      await sql(`select jsonb_object_agg(id,lifecycle_version)
    from public.jobs where course_run_id=${q(run)}`),
    );
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
  const move = (rows, days) =>
    rows.map((slot) => ({
      starts_at: new Date(
        Date.parse(slot.starts_at) + days * day,
      ).toISOString(),
      ends_at: new Date(Date.parse(slot.ends_at) + days * day).toISOString(),
    }));
  const allocations = () =>
    sql(`select jsonb_agg(to_jsonb(session) order by id) from public.assignment_sessions session
    where claim_id in (${q(firstClaim)}, ${q(secondClaim)}) and released_at is null`).then(
      JSON.parse,
    );
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

  if (courseOfferReceipt) {
    const { offer } = courseOfferReceipt;
    const beforePartial = await schedule();
    await assert.rejects(
      draft(manager, firstClaim, { sessions: move(beforePartial, -2) }),
      /open claim deadline/,
    );
    const oldQuote = (await rpc(second, "job_detail", offer)).terms_version;
    const partial = await draft(manager, firstClaim, {
      sessions: move(beforePartial, 1),
    });
    await act(manager, partial, "submit");
    assert.equal((await read(partial)).shared_schedule.required, 1);
    await act(manager, partial, "accept");
    await act(first, partial, "accept");
    await act(manager, partial, "apply");
    assert.equal((await read(partial)).shared_schedule.state, "applied");
    const staleQuote = await rpc(
      second,
      "claim_job",
      offer,
      randomUUID(),
      oldQuote,
    );
    assert.equal(staleQuote.status, "terms_changed");

    const afterPartial = await schedule();
    const staleProposal = await draft(manager, firstClaim, {
      sessions: move(afterPartial, 1),
    });
    await act(manager, staleProposal, "submit");
    await act(manager, staleProposal, "accept");
    await act(first, staleProposal, "accept");
    const secondReceipt = await claimPosition(second);
    assert.equal(secondReceipt.status, "confirmed");
    secondClaim = secondReceipt.claim_id;
    const blocked = await read(staleProposal);
    assert.equal(blocked.shared_schedule.state, "blocked");
    assert.equal(blocked.can_apply, false);
    await assert.rejects(
      act(manager, staleProposal, "apply"),
      /linked offers changed/,
    );
    assert.deepEqual(await schedule(), afterPartial);
    await act(
      manager,
      staleProposal,
      "withdraw",
      "Fictional newly staffed position",
    );
    console.log(
      "PASS a partially staffed move refreshes outstanding quotes and a new claim invalidates prior consent",
    );
  }

  const initialJobVersions = await jobVersions();
  const base = await schedule();
  const originalAllocations = await allocations();
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
      location: "https://example.invalid/different-shared-venue",
    }),
    /original course scope/,
  );
  await assert.rejects(
    draft(manager, firstClaim, { sessions: [] }),
    /Invalid assignment change/,
  );
  if (!positionsInOneOffer) {
    await assert.rejects(
      draft(manager, firstClaim, { sessions: requested.slice(0, 1) }),
      /agreed billable quantity/,
    );
  }
  await assert.rejects(
    draft(manager, firstClaim, { sessions: move(base, -1) }),
    /withdrawal deadline/,
  );

  const customerChoice = (await rpc(customer, "changeable_assignments")).find(
    (item) => item.claim_id === firstClaim,
  );
  assert.equal(customerChoice.shared_schedule_only, true);
  assert.equal(customerChoice.current.amount, null);
  assert.equal(customerChoice.current.terms, null);
  assert(!((await rpc(foreignCustomer, "changeable_assignments")).some(
    (item) => item.claim_id === firstClaim,
  )));
  for (const changes of [{ terms: "Forbidden private terms" },
    { amount: 42 }, { location: "https://example.invalid/different-venue" }]) {
    await assert.rejects(draft(customer, firstClaim, {
      sessions: requested, ...changes,
    }), /42501/);
  }
  await assert.rejects(draft(foreignCustomer, firstClaim, {
    sessions: requested,
  }), /42501/);
  const rejected = await draft(customer, firstClaim, { sessions: requested });
  await assert.rejects(read(rejected, manager), /42501/);
  const submitKey = randomUUID();
  assert.equal(
    await act(customer, rejected, "submit", "", submitKey, 1),
    rejected,
  );
  assert.equal(
    await act(customer, rejected, "submit", "", submitKey, 1),
    rejected,
  );
  assert.equal((await read(rejected, customer)).awaiting_coordination, true);
  assert.equal((await read(rejected)).can_coordinate, true);
  assert.equal((await read(rejected)).can_respond, false);
  assert.equal((await read(rejected)).shared_schedule, null);
  assert.equal(await siblingOf(rejected), "");
  await assert.rejects(read(rejected, first), /42501/);
  await assert.rejects(read(rejected, customerPeer), /42501/);
  await assert.rejects(act(customer, rejected, "coordinate"), /42501/);
  await assert.rejects(act(manager, rejected, "accept"), /first coordinate/);
  const coordinateKey = randomUUID();
  assert.equal(await act(manager, rejected, "coordinate", "", coordinateKey, 2), rejected);
  assert.equal(await act(manager, rejected, "coordinate", "", coordinateKey, 2), rejected);
  assert.equal((await read(rejected, customer)).awaiting_coordination, false);
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

  const beforeEffective = (await read(rejected)).original;
  const nextCompensation = { amount: beforeEffective.amount + 1, total_amount: beforeEffective.total_amount + 2 };
  if (beforeEffective.rate_unit === "fixed_total") nextCompensation.total_amount = nextCompensation.amount;
  const privateTerms = "Fictional assignment-specific addendum";
  const root = await draft(manager, firstClaim, {
    sessions: requested, terms: privateTerms, ...nextCompensation,
  });
  await act(manager, root, "submit");
  const sibling = await siblingOf(root);
  assert.equal((await read(root, first)).proposed.terms, privateTerms);
  assert.notEqual((await read(sibling, second)).proposed.terms, privateTerms);
  await assert.rejects(read(root, second), /42501/);
  await assert.rejects(read(root, customer), /42501/);
  if (positionsInOneOffer) {
    await assert.rejects(act(operations, root, "accept"), /finance authority/);
  }
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
  if (positionsInOneOffer) {
    assert.equal((await read(sibling, operations)).can_apply, false);
    await assert.rejects(act(operations, sibling, "apply"), /Current finance authority/);
  }
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
      `select count(*) from private.assignment_amendments where change_id in (${q(root)},${q(sibling)})`,
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
    /40001|PT409/,
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
    join private.assignment_amendments amendment on amendment.id=superseded.amendment_id
    where amendment.change_id in (${q(root)},${q(sibling)}) and session.released_at is not null`),
    "2",
  );
  const unchangedAllocations = originalAllocations.filter(
    ({ starts_at, ends_at }) =>
      requested.some(
        (slot) =>
          Date.parse(slot.starts_at) === Date.parse(starts_at) &&
          Date.parse(slot.ends_at) === Date.parse(ends_at),
      ),
  );
  assert.equal(unchangedAllocations.length, 2);
  assert.deepEqual(
    (await allocations()).filter(({ id }) =>
      unchangedAllocations.some((slot) => slot.id === id),
    ),
    unchangedAllocations,
  );
  assert.deepEqual(await originalClaims(), retained);
  const effective = JSON.parse(await sql(`select private.effective_assignment(${q(firstClaim)})`));
  assert.equal(effective.terms, privateTerms);
  assert.equal(Number(effective.amount), nextCompensation.amount);
  assert.equal(Number(effective.total_amount), nextCompensation.total_amount);
  const siblingEffective = JSON.parse(await sql(`select private.effective_assignment(${q(secondClaim)})`));
  assert.notEqual(siblingEffective.terms, privateTerms);
  if (positionsInOneOffer) {
    const entry = JSON.parse(await sql(`select to_jsonb(amendment) from private.assignment_financial_amendments amendment
      where claim_id=${q(firstClaim)}`));
    assert.equal(entry.gross_total_amount, 300);
    assert.equal(entry.lecturer_net_total_amount, nextCompensation.total_amount);
    assert.equal(entry.platform_total_amount, 300 - nextCompensation.total_amount);
    assert.equal(await sql(`select count(*) from private.assignment_financial_amendments where claim_id=${q(secondClaim)}`), "0");
  }
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

  const pinnedSlot = moved[1];
  async function pinAttendance(slot) {
    return sql(`insert into private.course_attendance_audit(session_id,user_id,actor_id,new_state,reason)
      values(${q(slot.id)},${q(learner)},${q(manager)},'{"state":"absent"}','Fictional retained evidence')
      returning id`);
  }
  const attendanceReceipt = await pinAttendance(pinnedSlot);
  const oldAllocations = await allocations();
  const added = await draft(manager, firstClaim, {
    sessions: [...move(moved, 0), ...move(moved.slice(-1), 2 / 24)],
  });
  await act(manager, added, "submit");
  await approve(added, await siblingOf(added));
  await act(manager, added, "apply");
  const expanded = await schedule();
  assert.equal(expanded.length, 3);
  assert.deepEqual(expanded.slice(0, 2), moved);
  assert.equal(expanded[2].offer_ids.length, moved[0].offer_ids.length);
  const addedAllocations = await allocations();
  assert.deepEqual(
    addedAllocations.filter(({ id }) =>
      oldAllocations.some((item) => item.id === id),
    ),
    oldAllocations,
  );

  const retiredSlot = positionsInOneOffer ? expanded[0] : expanded[2];
  const keep = expanded.filter(({ id }) => id !== retiredSlot.id);
  const remove = await draft(manager, firstClaim, { sessions: move(keep, 0) });
  await act(manager, remove, "submit");
  await approve(remove, await siblingOf(remove));
  await act(manager, remove, "apply");
  assert.deepEqual(await schedule(), keep);
  const retirement = JSON.parse(
    await sql(`select to_jsonb(receipt)
    from private.shared_course_retired_sessions receipt where course_session_id=${q(retiredSlot.id)}`),
  );
  assert.equal(retirement.group_id, remove);
  assert.equal(retirement.course_session.id, retiredSlot.id);
  assert.equal(
    Date.parse(retirement.course_session.starts_at),
    Date.parse(retiredSlot.starts_at),
  );
  assert.deepEqual(
    retirement.offer_sessions.map(({ id }) => id),
    retiredSlot.offer_ids,
  );
  assert.equal(
    await sql(`select count(*) from public.assignment_sessions
    where claim_id in (${q(firstClaim)}, ${q(secondClaim)}) and released_at is null`),
    "4",
  );
  assert.deepEqual(
    await allocations(),
    addedAllocations.filter(
      (item) =>
        Date.parse(item.starts_at) !== Date.parse(retiredSlot.starts_at),
    ),
  );
  assert.equal(
    await sql(
      `select session_id from private.course_attendance_audit where id=${q(attendanceReceipt)}`,
    ),
    pinnedSlot.id,
  );
  assert.deepEqual(await originalClaims(), retained);
  console.log(
    "PASS add and remove sessions with retained identifiers, attendance, exact retirement receipts and contract values",
  );

  const unpinnedSlot = keep.find(({ id }) => id !== pinnedSlot.id);
  const later = await draft(manager, firstClaim, {
    sessions: [...move([pinnedSlot], 0), ...move([unpinnedSlot], 1 / 24)],
  });
  await act(manager, later, "submit");
  await approve(later, await siblingOf(later));
  await pinAttendance(unpinnedSlot);
  await assert.rejects(
    act(manager, later, "apply"),
    /changed session has retained attendance evidence/,
  );
  assert.deepEqual(await schedule(), keep);
  // Advance the first slot into teaching history without changing its IDs.
  // Both exact attendance receipts already exist when the amendment is drafted.
  await act(
    manager,
    later,
    "withdraw",
    "Fictional replacement of a blocked proposal.",
  );
  const firstSlot = keep[0];
  await sql(`
    update public.course_sessions set starts_at=date_trunc('second',now())-interval '2 days',
        ends_at=date_trunc('second',now())-interval '2 days'+interval '1 hour'
      where id=${q(firstSlot.id)};
    update public.job_sessions offer set starts_at=session.starts_at, ends_at=session.ends_at
      from public.course_sessions session where offer.course_session_id=session.id and session.id=${q(firstSlot.id)};
    update public.assignment_sessions allocation set starts_at=session.starts_at, ends_at=session.ends_at
      from public.course_sessions session where session.id=${q(firstSlot.id)}
        and allocation.claim_id in (${q(firstClaim)}, ${q(secondClaim)})
        and allocation.released_at is null and allocation.starts_at=${q(firstSlot.starts_at)}::timestamptz;
  `);
  const teachingHistory = await schedule();
  const historicalAllocations = (await allocations()).filter(
    ({ starts_at }) =>
      Date.parse(starts_at) === Date.parse(teachingHistory[0].starts_at),
  );
  assert.equal(historicalAllocations.length, 2);
  const historicalDelivery = historicalAllocations.find(
    ({ claim_id }) => claim_id === firstClaim,
  );
  assert(historicalDelivery);
  const evidence = {
    outcome: "completed",
    actual_start: new Date(
      Date.parse(teachingHistory[0].starts_at),
    ).toISOString(),
    actual_end: new Date(Date.parse(teachingHistory[0].ends_at)).toISOString(),
    time_zone: "Europe/Berlin",
    notes: "Fictional completed delivery",
    correction_reason: "",
  };
  await rpc(
    first,
    "save_delivery_draft",
    historicalDelivery.id,
    0,
    evidence,
    randomUUID(),
  );
  await rpc(first, "submit_delivery", historicalDelivery.id, 1, randomUUID());
  const deliveryReceipt =
    await sql(`select latest_submission_id from private.delivery_records
    where session_id=${q(historicalDelivery.id)}`);
  assert(deliveryReceipt);
  assert(
    (await rpc(manager, "changeable_assignments")).some(
      ({ claim_id }) => claim_id === firstClaim,
    ),
  );
  await assert.rejects(
    draft(manager, firstClaim, {
      sessions: [
        ...move(teachingHistory, 0),
        ...move(teachingHistory.slice(1), 2 / 24),
      ],
      terms: "Forbidden retroactive fictional terms",
    }),
    /require future delivery/,
  );
  await assert.rejects(
    draft(manager, firstClaim, {
      sessions: [
        ...move(teachingHistory.slice(1), 0),
        ...move(teachingHistory.slice(1), 2 / 24),
      ],
    }),
    /PT409|PT422/,
  );
  await assert.rejects(
    draft(manager, firstClaim, {
      sessions: [
        ...move(teachingHistory.slice(0, 1), -1),
        ...move(teachingHistory.slice(1), 0),
      ],
    }),
    /22023/,
  );

  const remainder = await draft(manager, firstClaim, {
    sessions: [
      ...move(teachingHistory, 0),
      ...move(teachingHistory.slice(1), 2 / 24),
    ],
  });
  await act(manager, remainder, "submit");
  await approve(remainder, await siblingOf(remainder));
  await act(manager, remainder, "apply");
  const extended = await schedule();
  assert.equal(extended.length, 3);
  assert.deepEqual(extended.slice(0, 2), teachingHistory);
  assert.deepEqual(
    (await allocations()).filter(({ id }) =>
      historicalAllocations.some((slot) => slot.id === id),
    ),
    historicalAllocations,
  );
  assert.deepEqual(await originalClaims(), retained);
  assert.equal(
    await sql(`select latest_submission_id from private.delivery_records
    where session_id=${q(historicalDelivery.id)}`),
    deliveryReceipt,
  );
  console.log(
    "PASS a started shared course can amend future sessions while retaining original allocations and attendance evidence",
  );
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
