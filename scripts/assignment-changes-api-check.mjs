/** Exercise shared proposals with real Auth identities and the documented REST contract. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { withApiFixture } from "./testing/api.mjs";
import { quoteSql as q } from "./testing/database.mjs";
import { documentedRpc } from "./testing/openapi-contract.mjs";

await withApiFixture(async ({ actor, defer, sql, url }) => {
  const staff = await actor("amendment-admin", "admin");
  const first = await actor("amendment-lecturer-a", "lecturer");
  const second = await actor("amendment-lecturer-b", "lecturer");
  const customer = await actor("amendment-customer", "client");
  const foreign = await actor("amendment-foreign", "client");
  const participant = await actor("amendment-participant", "participant");
  const anonymous = createClient(url, process.env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const [
    company,
    otherCompany,
    template,
    run,
    firstJob,
    secondJob,
    claimA,
    claimB,
  ] = Array.from({ length: 8 }, randomUUID);
  const users = [staff, first, second, customer, foreign, participant]
    .map(({ id }) => q(id))
    .join(",");
  const claims = [claimA, claimB].map(q).join(",");
  const jobs = [firstJob, secondJob].map(q).join(",");
  const changes = `select id from private.assignment_change_requests where claim_id in (${claims})`;
  const amendments = `select id from private.assignment_amendments where claim_id in (${claims})`;
  defer(() =>
    sql(`
    begin;
    set local session_replication_role=replica;
    delete from private.assignment_financial_amendments where amendment_id in (${amendments});
    delete from private.assignment_session_supersessions where amendment_id in (${amendments});
    delete from private.assignment_amendments where claim_id in (${claims});
    delete from private.assignment_change_operations where actor_id in (${users});
    delete from private.assignment_change_events where change_id in (${changes});
    delete from private.assignment_change_requests where claim_id in (${claims});
    delete from public.notifications where user_id in (${users});
    delete from public.assignment_sessions where claim_id in (${claims});
    delete from public.claim_events where claim_id in (${claims});
    delete from public.job_claims where id in (${claims});
    delete from public.job_sessions where job_id in (${jobs});
    delete from public.jobs where id in (${jobs});
    delete from public.course_sessions where course_run_id=${q(run)};
    delete from public.course_runs where id=${q(run)};
    delete from public.course_templates where id=${q(template)};
    delete from public.client_organisation_memberships where user_id in (${users});
    delete from public.organisations where id in (${q(company)},${q(otherCompany)});
    commit;
  `),
  );
  await sql(`
    insert into public.organisations(id,name) values
      (${q(company)},'Fictional shared course customer'),(${q(otherCompany)},'Fictional foreign customer');
    insert into public.client_organisation_memberships(user_id,organisation_id) values
      (${q(customer.id)},${q(company)}),(${q(foreign.id)},${q(otherCompany)});
    insert into public.course_templates(id,title) values (${q(template)},'Fictional shared course');
    insert into public.course_runs(id,template_id,organisation_id,time_zone,published)
      values (${q(run)},${q(template)},${q(company)},'Australia/Brisbane',true);
    insert into public.course_sessions(course_run_id,starts_at,ends_at)
      select ${q(run)}, date_trunc('day',now()) + d * interval '1 day',
        date_trunc('day',now()) + d * interval '1 day' + interval '2 hours'
      from (values(12),(13)) days(d);
    insert into public.jobs(id,course_run_id,title,customer_name,delivery_type,status,amount,total_amount,currency,rate_unit,terms)
      values (${q(firstJob)},${q(run)},'Fictional shared course','Fictional shared course customer','online','filled',150,150,'AUD','fixed_total','Fictional original terms A'),
        (${q(secondJob)},${q(run)},'Fictional shared course','Fictional shared course customer','online','filled',90,90,'EUR','fixed_total','Fictional original terms B');
    insert into public.job_sessions(job_id,course_session_id,starts_at,ends_at)
      select job,id,starts_at,ends_at from public.course_sessions
      cross join (values(${q(firstJob)}::uuid),(${q(secondJob)}::uuid)) jobs(job)
      where course_run_id=${q(run)};
    insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,amount,total_amount,currency,rate_unit,terms,terms_version)
      values (${q(claimA)},${q(firstJob)},${q(first.id)},gen_random_uuid(),150,150,'AUD','fixed_total','Fictional original terms A',1),
        (${q(claimB)},${q(secondJob)},${q(second.id)},gen_random_uuid(),90,90,'EUR','fixed_total','Fictional original terms B',1);
    insert into public.assignment_sessions(claim_id,lecturer_id,starts_at,ends_at)
      select claim.id,claim.lecturer_id,slot.starts_at,slot.ends_at from public.job_claims claim
      join public.job_sessions slot on slot.job_id=claim.job_id where claim.id in (${claims});
  `);
  const schedule = () =>
    sql(`select jsonb_agg(jsonb_build_object(
    'id',id,'starts_at',starts_at,'ends_at',ends_at) order by starts_at)
    from public.course_sessions where course_run_id=${q(run)}`).then(
      JSON.parse,
    );
  const original = await schedule();
  const originalClaims = () =>
    sql(`select jsonb_agg(to_jsonb(c) order by id)
    from public.job_claims c where id in (${claims})`);
  const acceptedOriginals = await originalClaims();
  const move = (rows, days) =>
    rows.map(({ starts_at, ends_at }) => ({
      starts_at: new Date(
        Date.parse(starts_at) + days * 86_400_000,
      ).toISOString(),
      ends_at: new Date(Date.parse(ends_at) + days * 86_400_000).toISOString(),
    }));
  const sessions = move(original, 2);
  const proposal = {
    p_id: null,
    p_claim_id: claimA,
    p_expected_version: 0,
    p_request_id: randomUUID(),
    p_payload: {
      reason: "Fictional company rescheduling request",
      changes: { sessions },
    },
  };
  const save = (who, args, status, code) =>
    documentedRpc(who.client, "save_assignment_change", args, status, code);
  const read = (who, id) =>
    documentedRpc(who.client, "assignment_changes", { p_id: id });
  const act = (
    who,
    id,
    action,
    version,
    status,
    code,
    request = randomUUID(),
  ) =>
    documentedRpc(
      who.client,
      "assignment_change_action",
      {
        p_id: id,
        p_action: action,
        p_expected_version: version,
        p_note: "",
        p_request_id: request,
      },
      status,
      code,
    );
  const version = async (id) => (await read(staff, id))[0].version;
  const siblingOf = (id) =>
    sql(`select id from private.assignment_change_requests
    where shared_schedule_group_id=${q(id)} and claim_id=${q(claimB)}`);
  const approveGroup = async (id, sibling) => {
    for (const [changeId, lecturer] of [
      [id, first],
      [sibling, second],
    ]) {
      await act(staff, changeId, "accept", await version(changeId));
      await act(lecturer, changeId, "accept", await version(changeId));
    }
  };
  const candidates = await documentedRpc(
    customer.client,
    "changeable_assignments",
  );
  assert.ok(
    candidates.some(
      (row) => row.claim_id === claimA && row.shared_schedule_only,
    ),
  );
  await save({ client: anonymous }, proposal, 401, "42501");
  await save(participant, proposal, 403, "42501");
  await save(foreign, proposal, 403, "42501");
  await save(
    customer,
    {
      ...proposal,
      p_payload: {
        ...proposal.p_payload,
        changes: { sessions, amount: 180, total_amount: 180 },
      },
    },
    403,
    "42501",
  );
  await save(
    customer,
    { ...proposal, p_payload: { reason: "bad", changes: { sessions } } },
    400,
    "22023",
  );
  const id = await save(customer, proposal);
  assert.equal(await save(customer, proposal), id);
  await save(
    customer,
    {
      ...proposal,
      p_payload: {
        ...proposal.p_payload,
        reason: "Fictional request UUID mismatch",
      },
    },
    400,
    "22023",
  );
  assert.deepEqual(
    await documentedRpc(foreign.client, "assignment_changes"),
    [],
  );
  await documentedRpc(
    foreign.client,
    "assignment_changes",
    { p_id: id },
    403,
    "42501",
  );
  const submit = randomUUID();
  assert.equal(
    await act(customer, id, "submit", 1, 200, undefined, submit),
    id,
  );
  assert.equal(
    await act(customer, id, "submit", 1, 200, undefined, submit),
    id,
  );
  const companyRow = (await read(customer, id))[0];
  assert.equal(companyRow.original.amount, null);
  assert.equal(companyRow.proposed.terms, null);
  assert.equal((await read(staff, id))[0].can_coordinate, true);
  await act(customer, id, "coordinate", companyRow.version, 403, "42501");
  await act(staff, id, "coordinate", 1, 409, "40001");
  await act(staff, id, "coordinate", companyRow.version);
  const sibling = await siblingOf(id);
  assert.ok(sibling);
  const current = await version(id);
  await act(participant, id, "accept", current, 403, "42501");
  await act(second, id, "accept", current, 403, "42501");
  await act(staff, id, "apply", current, 409, "PT409");
  assert.deepEqual(await schedule(), original);
  await approveGroup(id, sibling);
  const apply = randomUUID();
  const beforeApply = await version(id);
  assert.deepEqual(
    await Promise.all([
      act(staff, id, "apply", beforeApply, 200, undefined, apply),
      act(staff, id, "apply", beforeApply, 200, undefined, apply),
    ]),
    [id, id],
  );
  assert.deepEqual(move(await schedule(), 0), sessions);
  assert.equal(await originalClaims(), acceptedOriginals);
  assert.equal(
    await sql(`select count(*) from private.assignment_amendments
    where claim_id in (${claims})`),
    "2",
  );

  const newTerms = "Fictional approved lecturer-specific terms";
  const commercialDates = move(await schedule(), 2);
  const financeId = await save(staff, {
    ...proposal,
    p_request_id: randomUUID(),
    p_payload: {
      reason: "Fictional finance and schedule review",
      changes: {
        sessions: commercialDates,
        amount: 175,
        total_amount: 175,
        terms: newTerms,
      },
    },
  });
  await act(staff, financeId, "submit", 1);
  const financeSibling = await siblingOf(financeId);
  assert.ok(financeSibling);
  const proposedFinance = (await read(first, financeId))[0];
  const proposedSibling = (await read(second, financeSibling))[0];
  assert.equal(proposedFinance.proposed.amount, 175);
  assert.equal(proposedFinance.proposed.terms, newTerms);
  assert.equal(proposedSibling.proposed.amount, 90);
  assert.equal(proposedSibling.proposed.terms, "Fictional original terms B");
  await documentedRpc(
    second.client,
    "assignment_changes",
    { p_id: financeId },
    403,
    "42501",
  );
  await documentedRpc(
    customer.client,
    "assignment_changes",
    { p_id: financeId },
    403,
    "42501",
  );
  await approveGroup(financeId, financeSibling);
  await act(staff, financeId, "apply", await version(financeId));
  assert.deepEqual(move(await schedule(), 0), commercialDates);
  assert.equal(await originalClaims(), acceptedOriginals);
  const applied = (await read(staff, financeId))[0];
  assert.equal(applied.status, "applied");
  assert.equal(applied.proposed.amount, 175);
  assert.equal((await read(second, financeSibling))[0].proposed.amount, 90);
  console.log(
    "PASS real HTTP shared proposals and targeted compensation, company and role scope, invalid and conflicting requests, atomic consent, exact retries and immutable original agreements",
  );
});
