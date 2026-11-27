/** Real PostgreSQL checks for component pricing, tenant-scoped presets and immutable claim evidence. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql, withTestDatabase } from "./testing/database.mjs";

await withTestDatabase("training_commercial", async ({ sql, actor }) => {
  const [
    admin,
    management,
    lecturer,
    peer,
    customer,
    organisation,
    otherOrganisation,
    template,
    run,
    job,
  ] = Array.from({ length: 10 }, () => randomUUID());
  await sql(`
    insert into auth.users(id) values ('${admin}'),('${management}'),('${lecturer}'),('${peer}'),('${customer}');
    insert into public.user_roles(user_id, role) values ('${admin}','admin'),('${management}','management'),
      ('${lecturer}','lecturer'),('${peer}','lecturer'),('${customer}','client');
    insert into public.organisations(id,name) values ('${organisation}','Fictional training customer'),
      ('${otherOrganisation}','Second fictional customer');
    insert into public.client_organisation_memberships(user_id,organisation_id) values ('${customer}','${organisation}');
    insert into public.course_templates(id,title) values ('${template}','Fictional course');
    insert into public.course_runs(id,template_id,organisation_id) values ('${run}','${template}','${organisation}');
    insert into public.jobs(id,course_run_id,title,customer_name,delivery_type,time_zone,status,amount,total_amount,
      currency,rate_unit,terms,requires_contract) values (
      '${job}','${run}','Fictional commissioned training','Fictional training customer','onsite',
      'Australia/Brisbane','published',0,0,'EUR','fixed_total','Fixture agreement',false);
    insert into public.job_sessions(job_id,starts_at,ends_at) values
      ('${job}','2040-01-01 00:00Z','2040-01-01 03:00Z'),
      ('${job}','2040-01-01 04:00Z','2040-01-01 06:00Z'),
      ('${job}','2040-01-02 01:00Z','2040-01-02 03:00Z');
  `);
  await actor(admin, `select public.set_job_commission('${job}',2000,2000,20)`);
  const readOffers = async (user) =>
    JSON.parse(await actor(user, "select public.job_offers()"));
  const readQuote = async (user) =>
    (await readOffers(user)).find(({ id }) => id === job);
  const original = await readQuote(lecturer);
  assert.equal(original.total_amount, 1600);
  const call = async (id, action, version = null, payload = null) =>
    JSON.parse(
      await actor(
        id,
        `select public.training_offer_compensation('${job}','${action}',${version ?? "null"},${payload ? quoteSql(JSON.stringify(payload)) : "null"})`,
      ),
    );
  const existing = await call(admin, "read");
  assert.equal(existing.plan, null);
  assert.equal(existing.editable, true);

  const component = (kind, basis, customer_rate, extra = {}) => ({
    kind,
    basis,
    customer_rate,
    label: "",
    treatment: "pass_through",
    reason: "",
    ...extra,
  });
  const configuration = {
    unit_minutes: 60,
    components: [
      component("on_site", "physical_day", "75.00"),
      component("travel", "fixed_total", "150.00"),
    ],
  };
  const unpaid_breaks = { [existing.sessions[0].id]: 30 };
  const payload = { configuration, unpaid_breaks };
  const before = await call(admin, "preview", existing.terms_version, payload);
  assert.equal(before.preview.paid_teaching_minutes, 390);
  assert.equal(before.preview.teaching_days, 2);
  assert.equal(before.preview.physical_days, 2);
  assert.deepEqual(
    before.preview.components.map(({ units, lecturer_amount }) => [
      units,
      lecturer_amount,
    ]),
    [
      [2, 150],
      [1, 150],
    ],
  );
  assert.equal(before.preview.customer_total, 2300);
  assert.equal(before.preview.lecturer_total, 1900);
  assert.equal(before.preview.platform_total, 400);
  assert.deepEqual(await readQuote(lecturer), original);
  await assert.rejects(call(lecturer, "read"), /Gross finance access required/);
  await assert.rejects(
    call(management, "preview", existing.terms_version, payload),
    /Gross finance access required/,
  );
  await assert.rejects(
    call(admin, "preview", existing.terms_version, {
      ...payload,
      unpaid_breaks: { [existing.sessions[0].id]: 181 },
    }),
    /Invalid unpaid session break/,
  );
  await assert.rejects(
    call(admin, "preview", existing.terms_version, {
      ...payload,
      configuration: {
        ...configuration,
        components: [...configuration.components, configuration.components[0]],
      },
    }),
    /One on-site allowance/,
  );
  const override = await call(admin, "preview", existing.terms_version, {
    ...payload,
    configuration: {
      unit_minutes: 60,
      components: [
        component("on_site", "physical_session", "75.00", {
          session_rates: { [existing.sessions[0].id]: "125.00" },
          reason: "Fixture session rate agreement",
        }),
      ],
    },
  });
  assert.equal(override.preview.components[0].lecturer_amount, 275);
  await assert.rejects(
    call(admin, "preview", existing.terms_version, {
      ...payload,
      configuration: {
        ...configuration,
        components: [
          component("on_site", "physical_session", "75", {
            session_rates: { [randomUUID()]: "125.00" },
            reason: "Another session",
          }),
        ],
      },
    }),
    /Only physical sessions of this offer/,
  );
  const rounding = await call(admin, "preview", existing.terms_version, {
    ...payload,
    configuration: {
      ...configuration,
      components: [
        component("preparation", "teaching_hour", "0.15", {
          treatment: "commission",
        }),
        component("accommodation", "night", "12.31", {
          quantity: "2",
          treatment: "fixed_platform",
          agreed_rate: "0.21",
          reason: "Fixture agreement",
        }),
        component("mileage", "kilometre", "0.21", {
          quantity: "0.25",
          treatment: "custom",
          agreed_rate: "0.15",
          reason: "Fixture agreement",
        }),
      ],
    },
  });
  assert.deepEqual(
    rounding.preview.components.map((x) => [
      x.customer_amount,
      x.lecturer_amount,
      x.platform_amount,
    ]),
    [
      [0.98, 0.78, 0.2],
      [24.62, 24.2, 0.42],
      [0.05, 0.04, 0.01],
    ],
  );
  console.log(
    "PASS Finance-only preview, local on-site day deduplication, unpaid breaks and exact component rounding",
  );

  const presetCall = async (
    user,
    organisationId,
    action,
    presetId = null,
    revision = null,
    presetPayload = null,
  ) => {
    const args = [
      quoteSql(organisationId),
      quoteSql(action),
      presetId ? quoteSql(presetId) : "null",
      revision ?? "null",
      presetPayload ? quoteSql(JSON.stringify(presetPayload)) : "null",
    ];
    return JSON.parse(
      await actor(
        user,
        `select public.training_commercial_presets(${args.join(",")})`,
      ),
    );
  };
  const presetPayload = {
    name: "Classroom terms",
    currency: "EUR",
    configuration,
  };
  const preset = await presetCall(
    admin,
    organisation,
    "save",
    null,
    0,
    presetPayload,
  );
  assert.equal(preset.revision, 1);
  assert.deepEqual(await presetCall(admin, otherOrganisation, "list"), []);
  await assert.rejects(
    presetCall(customer, organisation, "list"),
    /Gross finance access required/,
  );
  await assert.rejects(
    presetCall(admin, otherOrganisation, "save", preset.id, 1, presetPayload),
    /changed or is unavailable/,
  );
  await assert.rejects(
    presetCall(admin, organisation, "save", preset.id, 0, presetPayload),
    /changed or is unavailable/,
  );
  const saved = await call(admin, "save", existing.terms_version, payload);
  assert.equal(saved.terms_version, existing.terms_version + 1);
  assert.deepEqual(saved.plan.configuration, preset.configuration);
  await presetCall(admin, organisation, "save", preset.id, 1, {
    ...presetPayload,
    configuration: { unit_minutes: 45, components: [] },
  });
  await presetCall(admin, organisation, "archive", preset.id, 2);
  assert.deepEqual(await presetCall(admin, organisation, "list"), []);
  assert.deepEqual((await call(admin, "read")).plan, saved.plan);
  assert.ok(
    (
      await sql(
        `select private.deletion_selector(private.deletion_scope('organisation','${organisation}'),'private.training_commercial_presets')`,
      )
    ).includes(`x.organisation_id='${organisation}'::uuid`),
  );
  console.log(
    "PASS Organisation isolation, stale revisions, archive and value-copy inheritance",
  );

  const revised = await readQuote(lecturer);
  assert.equal(revised.amount, 1900);
  assert.equal(revised.total_amount, 1900);
  const claimKey = randomUUID();
  const claim = (version) =>
    actor(
      lecturer,
      `select public.claim_job('${job}','${claimKey}',${version})`,
    ).then(JSON.parse);
  assert.equal((await claim(original.terms_version)).status, "terms_changed");
  const accepted = await claim(revised.terms_version);
  assert.equal(accepted.status, "confirmed");
  assert.equal(
    (await claim(revised.terms_version)).claim_id,
    accepted.claim_id,
  );
  const financeHistory = await call(admin, "read");
  assert.equal(financeHistory.editable, false);
  assert.equal(financeHistory.accepted[0].snapshot.customer_total, 2300);
  await assert.rejects(
    call(admin, "save", saved.terms_version, payload),
    /reload before configuring/,
  );
  const ownReceipt = async (user) =>
    JSON.parse(
      await actor(
        user,
        `select coalesce(public.training_assignment_compensation('${accepted.claim_id}'),'null'::jsonb)`,
      ),
    );
  assert.deepEqual(await ownReceipt(lecturer), {
    currency: "EUR",
    base_amount: 1600,
    total_amount: 1900,
    components: [
      {
        kind: "on_site",
        label: "",
        basis: "physical_day",
        units: 2,
        amount: 150,
      },
      {
        kind: "travel",
        label: "",
        basis: "fixed_total",
        units: 1,
        amount: 150,
      },
    ],
  });
  assert.equal(await ownReceipt(peer), null);
  assert.equal(await ownReceipt(customer), null);
  assert.equal(
    await sql(`select gross_total_amount||':'||lecturer_net_total_amount||':'||platform_total_amount
    from private.claim_revenue_ledger where claim_id='${accepted.claim_id}'`),
    "2300.00:1900.00:400.00",
  );
  console.log(
    "PASS Stale consent rejection, real acceptance, idempotence, settlement totals and own-only immutable evidence",
  );

  const newRun = randomUUID();
  await sql(`
    insert into public.course_runs(id,template_id,organisation_id,delivery_type,time_zone,published)
    values ('${newRun}','${template}','${organisation}','onsite','Australia/Brisbane',false);
    insert into public.course_sessions(course_run_id,starts_at,ends_at)
    values ('${newRun}','2040-02-01 00:00Z','2040-02-01 04:00Z');
  `);
  const source = JSON.parse(
    await actor(admin, `select public.course_run_job_defaults('${newRun}')`),
  );
  const stagePayload = {
    source_revision: source.source_revision,
    currency: "EUR",
    rate_unit: "fixed_total",
    gross_amount: 350,
    gross_total_amount: 350,
    terms: "Fixture scheduled terms",
    requires_contract: false,
    claim_deadline: null,
    status: "draft",
  };
  const active = await presetCall(admin, organisation, "save", null, 0, {
    ...presetPayload,
    name: "Certified classroom",
    base_rate: "350.00",
    rate_unit: "fixed_total",
  });
  assert.equal(active.base_rate, "350.00");
  const usePreset = (ref, revision, key, body = stagePayload) =>
    actor(
      admin,
      `select public.create_training_offer_from_preset('${newRun}',${quoteSql(JSON.stringify(body))},20,'${key}','${ref}',${revision})`,
    );
  const stageKey = randomUUID();
  await assert.rejects(
    usePreset(preset.id, preset.revision, stageKey),
    /matching customer preset required/,
  );
  assert.equal(
    await sql(
      `select count(*) from public.jobs where course_run_id='${newRun}'`,
    ),
    "0",
  );
  const staged = await usePreset(active.id, active.revision, stageKey);
  assert.equal(
    await sql(
      `select training_creation_preset->>'id' from private.job_commission_offers where job_id='${staged}'`,
    ),
    active.id,
  );
  assert.equal(
    await sql(
      `select training_components->'configuration'->>'unit_minutes' from private.job_commission_offers where job_id='${staged}'`,
    ),
    "60",
  );
  await presetCall(admin, organisation, "archive", active.id, active.revision);
  assert.equal(await usePreset(active.id, active.revision, stageKey), staged);
  await assert.rejects(
    usePreset(active.id, active.revision, stageKey, {
      ...stagePayload,
      gross_amount: 351,
      gross_total_amount: 351,
    }),
    /idempotency conflict/,
  );
  console.log(
    "PASS Atomic course offer plus preset and safe retry after preset archival",
  );
});
