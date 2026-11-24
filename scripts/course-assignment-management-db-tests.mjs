/** Exercise existing and new course/job paths under actual SQL actor permissions. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

await withTestDatabase(
  "course_assignment_management",
  async ({ actor, sql }) => {
    const [admin, manager, former, replacement, peer] = Array.from(
      { length: 5 },
      randomUUID,
    );
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
    ];
    await sql(`
    insert into auth.users(id,email) values ${roles.map(([id]) => `(${q(id)},${q(id + "@example.invalid")})`).join(",")};
    insert into public.user_roles(user_id,role) values ${roles.map(([id, role]) => `(${q(id)},${q(role)})`).join(",")};
    insert into public.organisations(id,name) values (${q(company)}, 'Fictional College'), (${q(otherCompany)}, 'Fictional Studio');
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

    const original = await rpc(former, "claim_job", job, randomUUID(), 1);
    assert.equal(original.status, "confirmed");
    assert.equal(
      (await briefing(former)).fallback_contact.name,
      "Selected coordinator",
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
