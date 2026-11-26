/** Exercises the CRM pipeline RPCs, tenant binding and immutable history in a disposable migrated database. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

await withTestDatabase("crm_pipeline", async ({ sql, actor }) => {
  const manager = randomUUID();
  const companyMember = randomUUID();
  const activeOrganisation = randomUUID();
  const foreignOrganisation = randomUUID();
  const archivedOrganisation = randomUUID();
  const createRequest = randomUUID();

  await sql(`
    insert into auth.users(id,email,email_confirmed_at) values
      (${q(manager)},${q(`${manager}@example.invalid`)},now()),
      (${q(companyMember)},${q(`${companyMember}@example.invalid`)},now());
    update public.profiles set display_name = case id
      when ${q(manager)} then 'Fictional CRM Manager'
      when ${q(companyMember)} then 'Fictional Company Member'
      else display_name end
    where id in (${q(manager)},${q(companyMember)});
    insert into public.user_roles(user_id,role) values
      (${q(manager)},'management'),
      (${q(companyMember)},'client');
    insert into public.organisations(id,name,archived_at) values
      (${q(activeOrganisation)},'Fictional CRM Current Company',null),
      (${q(foreignOrganisation)},'Fictional CRM Other Company',null),
      (${q(archivedOrganisation)},'Fictional CRM Archived Company',now());
    insert into public.client_organisation_memberships(user_id,organisation_id) values
      (${q(companyMember)},${q(activeOrganisation)});
  `);

  const call = (userId, name, args = []) =>
    actor(
      userId,
      `select public.${name}(${args.map((value) => (value === null ? "null" : q(value))).join(",")})`,
    );
  const rows = (userId, name, args = []) =>
    actor(
      userId,
      `select coalesce(jsonb_agg(to_jsonb(item)), '[]'::jsonb) from public.${name}(${args.map((value) => (value === null ? "null" : q(value))).join(",")}) item`,
    ).then(JSON.parse);

  const createArgs = [
    activeOrganisation,
    "Fictional LMS renewal",
    "25000.00",
    "EUR",
    createRequest,
  ];
  const opportunityId = await call(
    manager,
    "create_crm_opportunity",
    createArgs,
  );
  assert.match(opportunityId, /^[0-9a-f-]{36}$/i);
  assert.equal(
    await call(manager, "create_crm_opportunity", createArgs),
    opportunityId,
    "an identical retry returns the first persisted opportunity",
  );
  await assert.rejects(
    call(manager, "create_crm_opportunity", [
      activeOrganisation,
      "Different payload",
      "25000.00",
      "EUR",
      createRequest,
    ]),
    /crm_idempotency_key_conflict/,
  );

  const initial = await rows(manager, "list_crm_opportunities", [
    activeOrganisation,
    100,
  ]);
  assert.equal(initial.length, 1);
  assert.equal(initial[0].id, opportunityId);
  assert.equal(initial[0].stage, "identified");
  assert.equal(
    initial[0].close_probability,
    null,
    "probability starts unknown",
  );
  assert.equal(
    initial[0].expected_close_date,
    null,
    "closing date starts unknown",
  );
  assert.equal(initial[0].version, 1);

  const moveRequest = randomUUID();
  const moveArgs = [
    activeOrganisation,
    opportunityId,
    "contacted",
    1,
    moveRequest,
  ];
  await call(manager, "move_crm_opportunity", moveArgs);
  await call(manager, "move_crm_opportunity", moveArgs);
  await assert.rejects(
    call(manager, "create_crm_opportunity", [
      activeOrganisation,
      "Cross-operation idempotency conflict",
      "25000.00",
      "EUR",
      moveRequest,
    ]),
    /crm_idempotency_key_conflict/,
  );
  await assert.rejects(
    call(manager, "move_crm_opportunity", [
      activeOrganisation,
      opportunityId,
      "proposal_submitted",
      1,
      randomUUID(),
    ]),
    /40001|crm_opportunity_version_conflict/,
  );
  await assert.rejects(
    call(manager, "move_crm_opportunity", [
      foreignOrganisation,
      opportunityId,
      "proposal_submitted",
      2,
      randomUUID(),
    ]),
    /P0002|CRM opportunity not found/,
  );
  await assert.rejects(
    call(manager, "move_crm_opportunity", [
      activeOrganisation,
      opportunityId,
      "not-a-stage",
      2,
      randomUUID(),
    ]),
    /22023|Invalid CRM stage change/,
  );

  const updated = await rows(manager, "list_crm_opportunities", [
    activeOrganisation,
    100,
  ]);
  assert.equal(updated[0].stage, "contacted");
  assert.equal(updated[0].version, 2);
  assert.deepEqual(
    (
      await rows(manager, "list_crm_opportunity_events", [
        activeOrganisation,
        opportunityId,
        50,
      ])
    ).map(({ version, event_type, from_stage, to_stage }) => ({
      version,
      event_type,
      from_stage,
      to_stage,
    })),
    [
      {
        version: 1,
        event_type: "created",
        from_stage: null,
        to_stage: "identified",
      },
      {
        version: 2,
        event_type: "stage_changed",
        from_stage: "identified",
        to_stage: "contacted",
      },
    ],
  );

  const forecastRequest = randomUUID();
  const forecastArgs = [
    activeOrganisation,
    opportunityId,
    "0",
    "2026-12-15",
    2,
    forecastRequest,
  ];
  await call(manager, "update_crm_opportunity_forecast", forecastArgs);
  await call(manager, "update_crm_opportunity_forecast", forecastArgs);
  await assert.rejects(
    call(manager, "update_crm_opportunity_forecast", [
      activeOrganisation,
      opportunityId,
      "50",
      "2026-12-15",
      2,
      forecastRequest,
    ]),
    /crm_idempotency_key_conflict/,
    "a request ID cannot be replayed with another forecast payload",
  );
  let forecastRows = await rows(manager, "list_crm_opportunities", [
    activeOrganisation,
    100,
  ]);
  assert.equal(
    forecastRows[0].close_probability,
    0,
    "zero is not treated as unknown",
  );
  assert.equal(forecastRows[0].expected_close_date, "2026-12-15");
  assert.equal(forecastRows[0].version, 3);
  await assert.rejects(
    call(manager, "move_crm_opportunity", [
      activeOrganisation,
      opportunityId,
      "proposal_submitted",
      2,
      randomUUID(),
    ]),
    /40001|crm_opportunity_version_conflict/,
    "a forecast edit invalidates a competing stage write at the old version",
  );
  await assert.rejects(
    call(manager, "update_crm_opportunity_forecast", [
      activeOrganisation,
      opportunityId,
      "75",
      "2026-12-15",
      2,
      randomUUID(),
    ]),
    /40001|crm_opportunity_version_conflict/,
    "a competing forecast write cannot overwrite a newer version",
  );
  for (const invalidProbability of ["100.001", "12.345", "-0.01"]) {
    await assert.rejects(
      call(manager, "update_crm_opportunity_forecast", [
        activeOrganisation,
        opportunityId,
        invalidProbability,
        "2026-12-15",
        3,
        randomUUID(),
      ]),
      /22023|Invalid CRM opportunity forecast/,
    );
  }

  const clearProbabilityRequest = randomUUID();
  await call(manager, "update_crm_opportunity_forecast", [
    activeOrganisation,
    opportunityId,
    null,
    "2026-12-15",
    3,
    clearProbabilityRequest,
  ]);
  forecastRows = await rows(manager, "list_crm_opportunities", [
    activeOrganisation,
    100,
  ]);
  assert.equal(forecastRows[0].close_probability, null);
  assert.equal(forecastRows[0].expected_close_date, "2026-12-15");
  await call(manager, "update_crm_opportunity_forecast", [
    activeOrganisation,
    opportunityId,
    null,
    null,
    4,
    randomUUID(),
  ]);
  forecastRows = await rows(manager, "list_crm_opportunities", [
    activeOrganisation,
    100,
  ]);
  assert.equal(forecastRows[0].close_probability, null);
  assert.equal(forecastRows[0].expected_close_date, null);
  assert.equal(forecastRows[0].version, 5);
  const forecastHistory = await rows(manager, "list_crm_opportunity_events", [
    activeOrganisation,
    opportunityId,
    50,
  ]);
  assert.deepEqual(
    forecastHistory.slice(2).map((event) => ({
      version: event.version,
      event_type: event.event_type,
      from_close_probability: event.from_close_probability,
      to_close_probability: event.to_close_probability,
      from_expected_close_date: event.from_expected_close_date,
      to_expected_close_date: event.to_expected_close_date,
    })),
    [
      {
        version: 3,
        event_type: "forecast_updated",
        from_close_probability: null,
        to_close_probability: 0,
        from_expected_close_date: null,
        to_expected_close_date: "2026-12-15",
      },
      {
        version: 4,
        event_type: "forecast_updated",
        from_close_probability: 0,
        to_close_probability: null,
        from_expected_close_date: "2026-12-15",
        to_expected_close_date: "2026-12-15",
      },
      {
        version: 5,
        event_type: "forecast_updated",
        from_close_probability: null,
        to_close_probability: null,
        from_expected_close_date: "2026-12-15",
        to_expected_close_date: null,
      },
    ],
  );

  const campusId = await call(manager, "create_crm_opportunity", [
    activeOrganisation,
    "Fictional campus launch",
    null,
    "EUR",
    randomUUID(),
  ]);
  const proposalId = await call(manager, "create_crm_opportunity", [
    activeOrganisation,
    "Fictional renewal proposal",
    "4200.00",
    "EUR",
    randomUUID(),
  ]);
  await call(manager, "move_crm_opportunity", [
    activeOrganisation,
    proposalId,
    "proposal_submitted",
    1,
    randomUUID(),
  ]);

  const firstPage = await rows(manager, "list_crm_opportunity_page", [
    activeOrganisation,
    null,
    null,
    2,
    0,
  ]);
  const secondPage = await rows(manager, "list_crm_opportunity_page", [
    activeOrganisation,
    null,
    null,
    2,
    2,
  ]);
  assert.equal(firstPage.length, 2);
  assert.equal(secondPage.length, 1);
  assert.equal(
    new Set([...firstPage, ...secondPage].map(({ id }) => id)).size,
    3,
    "adjacent pages are bounded and contain no duplicate opportunity",
  );
  assert.deepEqual(
    (
      await rows(manager, "list_crm_opportunity_page", [
        activeOrganisation,
        "  CAMPUS ",
        null,
        10,
        0,
      ])
    ).map(({ id }) => id),
    [campusId],
    "title search trims whitespace and ignores case before pagination",
  );
  assert.deepEqual(
    (
      await rows(manager, "list_crm_opportunity_page", [
        activeOrganisation,
        null,
        "contacted",
        10,
        0,
      ])
    ).map(({ id }) => id),
    [opportunityId],
    "stage filtering returns only the selected stage",
  );
  assert.deepEqual(
    await rows(manager, "list_crm_opportunity_page", [
      activeOrganisation,
      "campus",
      "contacted",
      10,
      0,
    ]),
    [],
    "search and stage filters are combined before pagination",
  );
  for (const args of [
    [activeOrganisation, null, null, null, 0],
    [activeOrganisation, null, null, 2, null],
    [activeOrganisation, null, null, 52, 0],
    [activeOrganisation, null, null, 2, 10001],
    [activeOrganisation, null, "not-a-stage", 2, 0],
    [activeOrganisation, "x".repeat(201), null, 2, 0],
  ]) {
    await assert.rejects(
      rows(manager, "list_crm_opportunity_page", args),
      /22023|Invalid CRM page request/,
    );
  }

  const concurrentUpdates = await Promise.allSettled([
    call(manager, "update_crm_opportunity_forecast", [
      activeOrganisation,
      campusId,
      "25",
      "2027-02-01",
      1,
      randomUUID(),
    ]),
    call(manager, "move_crm_opportunity", [
      activeOrganisation,
      campusId,
      "lost",
      1,
      randomUUID(),
    ]),
  ]);
  assert.equal(
    concurrentUpdates.filter(({ status }) => status === "fulfilled").length,
    1,
    "one of a simultaneous stage move and forecast update commits",
  );
  const rejectedUpdate = concurrentUpdates.find(
    ({ status }) => status === "rejected",
  );
  assert.equal(rejectedUpdate?.status, "rejected");
  assert.match(
    String(rejectedUpdate.reason),
    /40001|crm_opportunity_version_conflict/,
    "the losing concurrent update observes a stale version",
  );
  const racedOpportunity = (
    await rows(manager, "list_crm_opportunity_page", [
      activeOrganisation,
      "campus",
      null,
      10,
      0,
    ])
  ).find((row) => row.id === campusId);
  assert.equal(racedOpportunity?.version, 2);
  assert.equal(
    (
      await rows(manager, "list_crm_opportunity_events", [
        activeOrganisation,
        campusId,
        50,
      ])
    ).length,
    2,
    "the race leaves one immutable event and no duplicate version",
  );

  assert.deepEqual(
    await rows(manager, "list_crm_opportunity_page", [
      archivedOrganisation,
      null,
      null,
      10,
      0,
    ]),
    [],
    "an archived organisation remains readable without making write changes",
  );
  assert.deepEqual(
    await rows(manager, "list_crm_opportunities", [foreignOrganisation, 100]),
    [],
    "a different company board contains no foreign opportunity rows",
  );
  await assert.rejects(
    rows(manager, "list_crm_opportunity_events", [
      foreignOrganisation,
      opportunityId,
      50,
    ]),
    /P0002|CRM opportunity not found/,
  );

  await assert.rejects(
    call(companyMember, "list_crm_opportunities", [activeOrganisation, 100]),
    /42501|organisations.manage required/,
    "company membership does not confer internal CRM authority",
  );
  await assert.rejects(
    call(companyMember, "list_crm_opportunity_page", [
      activeOrganisation,
      null,
      null,
      25,
      0,
    ]),
    /42501|organisations.manage required/,
    "company membership does not confer access to the CRM page RPC",
  );
  await assert.rejects(
    call(companyMember, "update_crm_opportunity_forecast", [
      activeOrganisation,
      opportunityId,
      0,
      "2026-12-15",
      5,
      randomUUID(),
    ]),
    /42501|organisations.manage required/,
    "company membership does not confer forecast write access",
  );
  assert.equal(
    await actor(
      companyMember,
      `select count(*) from public.crm_opportunities where organisation_id=${q(activeOrganisation)}`,
    ),
    "0",
    "RLS hides CRM rows from a member account",
  );
  await assert.rejects(
    call(companyMember, "create_crm_opportunity", [
      activeOrganisation,
      "Unauthorized opportunity",
      null,
      "EUR",
      randomUUID(),
    ]),
    /42501|organisations.manage required/,
  );
  await assert.rejects(
    actor(
      manager,
      `insert into public.crm_opportunities(organisation_id,title,created_by,creation_request_id) values (${q(activeOrganisation)},'Direct write',${q(manager)},${q(randomUUID())})`,
    ),
    /42501|permission denied/,
    "authenticated clients cannot bypass the RPC validation boundary",
  );
  await assert.rejects(
    sql(
      `set role service_role; select count(*) from public.crm_opportunities where organisation_id=${q(activeOrganisation)}`,
    ),
    /42501|permission denied/,
    "the privileged API role has no direct CRM table read bypass",
  );
  await assert.rejects(
    sql(
      `set role service_role; update public.crm_opportunities set stage='lost' where id=${q(opportunityId)}`,
    ),
    /42501|permission denied/,
    "the privileged API role cannot bypass the versioned stage RPC",
  );
  await assert.rejects(
    sql("set role service_role; truncate public.crm_opportunity_events"),
    /42501|permission denied/,
    "the privileged API role cannot truncate immutable stage history",
  );

  await sql(
    `update public.organisations set archived_at=clock_timestamp() where id=${q(activeOrganisation)}`,
  );
  const archivedRows = await rows(manager, "list_crm_opportunities", [
    activeOrganisation,
    100,
  ]);
  assert.equal(
    archivedRows.find((row) => row.id === opportunityId)?.stage,
    "contacted",
    "archiving retains read access to the organisation's sales history",
  );
  await assert.rejects(
    call(manager, "move_crm_opportunity", [
      activeOrganisation,
      opportunityId,
      "proposal_submitted",
      2,
      randomUUID(),
    ]),
    /42501|Archived organisations are read only/,
  );
  await assert.rejects(
    call(manager, "update_crm_opportunity_forecast", [
      activeOrganisation,
      opportunityId,
      20,
      "2027-01-01",
      5,
      randomUUID(),
    ]),
    /42501|Archived organisations are read only/,
    "archived company forecasts remain read-only",
  );
  await assert.rejects(
    call(manager, "create_crm_opportunity", [
      archivedOrganisation,
      "No archived-company write",
      null,
      "EUR",
      randomUUID(),
    ]),
    /P0002|Active organisation not found/,
  );

  await assert.rejects(
    sql(
      `update public.crm_opportunity_events set to_stage='lost' where opportunity_id=${q(opportunityId)} and version=2`,
    ),
    /42501|crm_opportunity_history_immutable/,
    "the database trigger rejects edits to the immutable audit trail",
  );
  assert.equal(
    (
      await rows(manager, "list_crm_opportunity_events", [
        activeOrganisation,
        opportunityId,
        50,
      ])
    ).length,
    5,
  );
});

console.log(
  "CRM pipeline database authorization, idempotency, versioning and archive checks passed.",
);
