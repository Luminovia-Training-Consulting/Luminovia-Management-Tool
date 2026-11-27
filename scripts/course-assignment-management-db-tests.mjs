/** Exercise existing and new course/job paths under actual SQL actor permissions. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

await withTestDatabase(
  "course_assignment_management",
  async ({ actor, sql }) => {
    const [
      admin,
      manager,
      former,
      replacement,
      peer,
      companyLecturer,
      foreignCompanyLecturer,
    ] = Array.from({ length: 7 }, randomUUID);
    const company = randomUUID(),
      otherCompany = randomUUID();
    const selected = randomUUID(),
      newest = randomUUID(),
      archived = randomUUID(),
      foreign = randomUUID();
    const roles = [
      [admin, "admin"],
      [manager, "management"],
      [former, "lecturer"],
      [replacement, "lecturer"],
      [peer, "lecturer"],
      [companyLecturer, "lecturer"],
      [foreignCompanyLecturer, "lecturer"],
    ];
    await sql(`
    insert into auth.users(id,email) values ${roles.map(([id]) => `(${q(id)},${q(id + "@example.invalid")})`).join(",")};
    insert into public.user_roles(user_id,role) values ${roles.map(([id, role]) => `(${q(id)},${q(role)})`).join(",")};
    insert into public.organisations(id,name) values (${q(company)}, 'Fictional College'), (${q(otherCompany)}, 'Fictional Studio');
    insert into public.user_roles(user_id,role) values
      (${q(companyLecturer)},'client'),(${q(foreignCompanyLecturer)},'client');
    insert into public.client_organisation_memberships(organisation_id,user_id) values
      (${q(company)},${q(companyLecturer)}),(${q(otherCompany)},${q(foreignCompanyLecturer)});
    insert into public.organisation_contacts(id,organisation_id,name,created_at,archived_at) values
      (${q(selected)},${q(company)},'Selected coordinator','2025-01-01',null),
      (${q(newest)},${q(company)},'Newest coordinator','2025-02-01',null),
      (${q(archived)},${q(company)},'Archived coordinator','2025-03-01',now()),
      (${q(foreign)},${q(otherCompany)},'Another company coordinator','2025-04-01',null);
  `);
    const rpc = async (who, name, ...args) =>
      JSON.parse(
        await actor(
          who,
          `select to_jsonb(public.${name}(${args
            .map((arg) =>
              arg === null
                ? "null"
                : typeof arg === "number" || typeof arg === "boolean"
                  ? String(arg)
                  : typeof arg === "object"
                    ? q(JSON.stringify(arg)) + "::jsonb"
                    : q(arg),
            )
            .join(",")}))`,
        ),
      );
    const sessions = [
      { starts_at: "2042-03-04T09:00:00Z", ends_at: "2042-03-04T11:00:00Z" },
      { starts_at: "2042-03-05T09:00:00Z", ends_at: "2042-03-05T11:00:00Z" },
    ];
    const job = await rpc(
      manager,
      "create_capacity_job",
      {
        title: "Fictional assignment",
        customer_name: "Fictional College",
        delivery_type: "online",
        location: "https://private-facility.example.invalid/meeting",
        status: "published",
        currency: "EUR",
        rate_unit: "fixed_total",
        amount: 150,
        total_amount: 150,
        terms: "Accepted original terms",
        requires_contract: false,
        claim_deadline: "2042-03-03T09:00:00Z",
        sessions,
      },
      1,
      randomUUID(),
      company,
    );
    const run = await sql(
      `select course_run_id from public.jobs where id = ${q(job)}`,
    );
    const briefing = (who) => rpc(who, "job_briefing", job);
    const lifecycle = (who) => rpc(who, "job_lifecycle", job);

    assert.equal(
      (await briefing(manager)).fallback_contact.name,
      "Newest coordinator",
    );
    assert.equal((await briefing(peer)).fallback_contact, null);
    assert.equal((await lifecycle(peer)).dispatch_contact, null);
    await rpc(admin, "set_company_premium", company, true, 0, randomUUID());
    const workspace = await rpc(manager, "course_workspace", run);
    await assert.rejects(
      rpc(
        manager,
        "course_workspace_action",
        run,
        "contact_select",
        { contact_id: foreign },
        workspace.settings_version,
      ),
      /42501/,
    );
    await rpc(
      manager,
      "course_workspace_action",
      run,
      "contact_select",
      { contact_id: selected },
      workspace.settings_version,
    );
    const saved = await rpc(manager, "course_workspace", run);
    assert.equal(saved.selected_contact_id, selected);
    assert.equal(saved.contact.name, "Selected coordinator");
    assert.equal(
      (await briefing(manager)).fallback_contact.name,
      "Selected coordinator",
    );
    const explicit = await rpc(
      manager,
      "save_job_briefing",
      job,
      0,
      randomUUID(),
      {
        contact_name: "Assignment coordinator",
        reference_label: "Fictional source",
      },
    );
    assert.equal(explicit.contact_name, "Assignment coordinator");
    assert.equal(explicit.fallback_contact, null);
    assert.equal((await briefing(peer)).contact_name, "");
    assert.equal((await briefing(peer)).fallback_contact, null);
    await rpc(
      manager,
      "save_job_briefing",
      job,
      explicit.version,
      randomUUID(),
      {
        reference_label: "Updated fictional source",
      },
    );
    assert.equal(
      (await briefing(manager)).fallback_contact.name,
      "Selected coordinator",
    );
    console.log(
      "PASS contact precedence, read-back, authored reference and pre-claim privacy",
    );

    assert.equal(
      (await rpc(companyLecturer, "job_detail", job)).customer_name,
      "Fictional College",
    );
    assert.equal(
      (await rpc(foreignCompanyLecturer, "job_detail", job)).customer_name,
      "",
    );
    const marketplace = await rpc(peer, "job_detail", job);
    assert.equal(marketplace.customer_name, "");
    assert.equal(marketplace.customer_reveal_at, null);
    assert.ok(marketplace.job_sessions.length > 0);
    const searched = await rpc(
      peer,
      "job_discovery",
      { customer: "Fictional College" },
      null,
      20,
    );
    assert.deepEqual(searched.items, []);
    const original = await rpc(former, "claim_job", job, randomUUID(), 1);
    assert.equal(original.status, "confirmed");

    // Test current actor reads on both sides of the disclosure rule before
    // opting into immediate disclosure for the existing far-future fixture.
    const policy = await rpc(manager, "assignment_customer_settings");
    assert.deepEqual(policy, {
      mode: "scheduled",
      lead_hours: 168,
      revision: 0,
    });
    await assert.rejects(rpc(former, "assignment_customer_settings"), /42501/);
    await assert.rejects(
      rpc(
        former,
        "save_assignment_customer_settings",
        "on_confirmation",
        168,
        0,
      ),
      /42501/,
    );
    const redacted = await rpc(former, "job_detail", job);
    assert.equal(redacted.customer_name, "");
    assert.equal(redacted.customer_hidden, true);
    assert.equal(
      Date.parse(redacted.customer_reveal_at),
      Date.parse(sessions[0].starts_at) - 168 * 3_600_000,
    );
    assert.equal((await briefing(former)).fallback_contact, null);
    assert.equal((await lifecycle(former)).dispatch_contact, null);
    assert.equal((await rpc(former, "course_workspace", run)).contact, null);
    assert.equal(
      (await rpc(manager, "job_detail", job)).customer_name,
      "Fictional College",
    );
    assert.equal(
      await actor(
        former,
        `select
        (select count(*) from public.jobs where id=${q(job)}),
        (select count(*) from public.course_runs where id=${q(run)}),
        (select count(*) from public.organisations where id=${q(company)})`,
      ),
      "0|0|0",
    );
    assert.equal(
      (await rpc(former, "assignment_confirmation", original.claim_id)).data
        .customer_name,
      "",
    );

    const calendar = JSON.parse(
      await actor(
        former,
        `select public.assignment_calendar_metadata(array[${q(job)}::uuid])`,
      ),
    );
    assert.equal(calendar[0].organisation_name, "");
    assert.equal(calendar[0].organisation_id, null);
    assert.equal(
      (await rpc(former, "job_offers")).find(({ id }) => id === job)
        .customer_name,
      "",
    );

    // One statement timestamps both sides of the boundary. Roll back the
    // artificial allocation dates so legacy metadata/replacement checks still
    // use their own booked intervals.
    await sql(`
      begin;
      do $boundary$
      declare
        cutover timestamptz := statement_timestamp() + interval '168 hours';
        slot uuid := (select id from public.assignment_sessions where claim_id=${q(original.claim_id)} order by starts_at limit 1);
      begin
        update public.assignment_sessions set starts_at=cutover+interval '1 microsecond', ends_at=cutover+interval '1 hour' where id=slot;
        perform set_config('request.jwt.claims', ${q(JSON.stringify({ sub: former, role: "authenticated" }))}, true);
        set local role authenticated;
        assert (public.job_detail(${q(job)})->>'customer_hidden')::boolean;
        reset role;
        update public.assignment_sessions set starts_at=cutover where id=slot;
        set local role authenticated;
        assert public.job_detail(${q(job)})->>'customer_name' = 'Fictional College';
        reset role;
      end
      $boundary$;
      rollback;
    `);

    const currentChange = (await rpc(former, "changeable_assignments")).find(
      ({ claim_id }) => claim_id === original.claim_id,
    ).current;
    assert.equal(currentChange.location_hidden, true);
    assert.equal(currentChange.location, "");
    assert.equal(currentChange.readiness, null);
    await assert.rejects(
      rpc(
        former,
        "save_assignment_change",
        null,
        original.claim_id,
        {
          reason: "Fictional location amendment",
          changes: {
            location: "https://another-facility.example.invalid/meeting",
          },
        },
        0,
        randomUUID(),
      ),
      /42501/,
    );

    const settings = await rpc(
      manager,
      "save_assignment_customer_settings",
      "on_confirmation",
      168,
      0,
    );
    assert.deepEqual(settings, {
      mode: "on_confirmation",
      lead_hours: 168,
      revision: 1,
    });
    await assert.rejects(
      rpc(
        manager,
        "save_assignment_customer_settings",
        "management_only",
        168,
        0,
      ),
      /40001/,
    );
    assert.equal(
      (await rpc(former, "job_detail", job)).customer_name,
      "Fictional College",
    );
    assert.equal(
      await actor(
        former,
        `select customer_name from public.jobs where id=${q(job)}`,
      ),
      "Fictional College",
    );
    assert.equal(
      (await briefing(former)).fallback_contact.name,
      "Selected coordinator",
    );
    console.log(
      "PASS versioned disclosure policy, marketplace, confirmed job, raw RLS, workspace, PDF data and calendar",
    );
    const originalTerms =
      await sql(`select jsonb_build_array(amount,total_amount,terms,terms_version)
    from public.job_claims where id = ${q(original.claim_id)}`);
    let current = await lifecycle(manager);
    assert.equal(current.can_edit, false);
    assert.equal(current.can_edit_metadata, true);
    assert.deepEqual(current.replaceable_claim_ids, [original.claim_id]);
    assert.equal((await lifecycle(former)).can_edit_metadata, false);
    const metadata = {
      title: "Updated fictional listing",
      description: "Updated overview",
    };
    await assert.rejects(
      rpc(
        former,
        "manage_job_offer",
        job,
        "edit_metadata",
        current.version,
        randomUUID(),
        metadata,
      ),
      /42501/,
    );
    await assert.rejects(
      rpc(
        manager,
        "manage_job_offer",
        job,
        "edit_metadata",
        current.version,
        randomUUID(),
        { ...metadata, terms: "Unreviewed terms" },
      ),
      /22023/,
    );
    const metadataKey = randomUUID();
    assert.equal(
      await rpc(
        manager,
        "manage_job_offer",
        job,
        "edit_metadata",
        current.version,
        metadataKey,
        metadata,
      ),
      job,
    );
    assert.equal(
      await rpc(
        manager,
        "manage_job_offer",
        job,
        "edit_metadata",
        current.version,
        metadataKey,
        metadata,
      ),
      job,
    );
    assert.equal(
      await sql(`select title from public.jobs where id = ${q(job)}`),
      metadata.title,
    );
    console.log(
      "PASS versioned metadata editing on occupied work preserves contractual fields",
    );

    const candidates = await rpc(
      manager,
      "job_replacement_candidates",
      original.claim_id,
      "",
    );
    assert.equal(
      candidates.some(({ id }) => id === former),
      false,
    );
    const target = candidates.find(({ id }) => id === replacement);
    assert.equal(target.eligibility, "eligible");
    assert.equal(target.quote, null);
    await assert.rejects(
      rpc(former, "job_replacement_candidates", original.claim_id, ""),
      /42501/,
    );
    // The marketplace deadline has elapsed while the course is still in the future.
    const siblingDraft = randomUUID();
    await sql(`insert into public.jobs(id,course_run_id,title,customer_name,delivery_type,status,
      amount,total_amount,currency,rate_unit,terms)
      values(${q(siblingDraft)},${q(run)},'Parallel draft','Fictional College','online','draft',
        50,50,'EUR','fixed_total','Fictional parallel terms')`);
    const deadline = "2025-01-01 09:00:00+00";
    await sql(
      `update public.jobs set claim_deadline = ${q(deadline)} where id = ${q(job)}`,
    );
    current = await lifecycle(manager);
    const replace = (who, request, reason = "Fictional staffing change") =>
      rpc(
        who,
        "replace_job_lecturer",
        original.claim_id,
        replacement,
        target.terms_version,
        current.version,
        request,
        reason,
      );
    await assert.rejects(replace(former, randomUUID()), /42501/);
    const event = randomUUID();
    await sql(`insert into public.personal_events(id,user_id,title,starts_at,ends_at)
    values(${q(event)},${q(replacement)},'Fictional conflict',${q(sessions[1].starts_at)},${q(sessions[1].ends_at)})`);
    assert.equal((await replace(manager, randomUUID())).status, "conflict");
    assert.equal(
      await sql(
        `select status from public.job_claims where id = ${q(original.claim_id)}`,
      ),
      "confirmed",
    );
    assert.equal(
      await sql(`select count(*) from public.notifications
    where kind = 'claim_cancelled' and resource_id = ${q(original.claim_id)}`),
      "0",
    );
    await sql(`delete from public.personal_events where id = ${q(event)}`);
    const request = randomUUID();
    const result = await replace(manager, request);
    assert.equal(result.status, "confirmed");
    assert.deepEqual(await replace(manager, request), result);
    await assert.rejects(
      replace(manager, request, "Conflicting retry payload"),
      /22023/,
    );
    assert.equal(
      await sql(`select status from public.jobs where id = ${q(job)}`),
      "filled",
    );
    assert.equal(
      await sql(`select claim_deadline from public.jobs where id = ${q(job)}`),
      deadline,
    );
    assert.equal(
      await sql(`select jsonb_build_array(amount,total_amount,terms,terms_version)
    from public.job_claims where id = ${q(original.claim_id)}`),
      originalTerms,
    );
    assert.equal(
      await sql(`select count(*) from public.assignment_sessions
    where claim_id = ${q(original.claim_id)} and released_at is not null`),
      "2",
    );
    assert.equal(
      await sql(`select count(*) from public.assignment_sessions
    where claim_id = ${q(result.claim_id)} and lecturer_id = ${q(replacement)} and released_at is null`),
      "2",
    );
    assert.equal(
      await sql(`select count(*) from public.notifications where
    (user_id, kind, resource_id) in (
      (${q(former)}::uuid, 'claim_cancelled', ${q(original.claim_id)}::uuid),
      (${q(replacement)}::uuid, 'claim_confirmed', ${q(result.claim_id)}::uuid)
    )`),
      "2",
    );
    assert.equal(
      await sql(`select status from public.jobs where id = ${q(siblingDraft)}`),
      "draft",
    );
    const formerInbox = await rpc(former, "notification_inbox");
    const removal = formerInbox.items.find(
      ({ kind }) => kind === "claim_cancelled",
    );
    assert.equal(removal.assignment_removed, true);
    assert.equal(removal.removal_reason, "Fictional staffing change");
    const replacementInbox = await rpc(replacement, "notification_inbox");
    assert.equal(
      replacementInbox.items.some(
        ({ assignment_replaced, assignment_removed }) =>
          assignment_replaced || assignment_removed,
      ),
      false,
    );
    await assert.rejects(briefing(former), /42501/);
    assert.equal(
      (await briefing(replacement)).fallback_contact.name,
      "Selected coordinator",
    );
    console.log(
      "PASS atomic replacement, conflict rollback, expired marketplace deadline, idempotency and committed notices",
    );
  },
);
