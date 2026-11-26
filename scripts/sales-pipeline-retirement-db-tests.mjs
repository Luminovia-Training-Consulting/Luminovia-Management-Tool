/** Checks retirement against fictional records written with the previous application API. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

const retirement = new URL(
  "../supabase/migrations/20261126232000_retire_sales_pipeline.sql",
  import.meta.url,
);

await withTestDatabase(
  "sales_pipeline_retirement",
  async ({ actor, sql }) => {
    const manager = randomUUID();
    const company = randomUUID();
    await sql(`
      insert into auth.users (id, email, email_confirmed_at)
      values (${q(manager)}, ${q(`${manager}@example.invalid`)}, now());
      insert into public.user_roles (user_id, role) values (${q(manager)}, 'management');
      insert into public.organisations (id, name) values (${q(company)}, 'Fictional company');
    `);

    const opportunity = await actor(
      manager,
      `select public.create_crm_opportunity(${q(company)}, 'Fictional enquiry', 2500, 'EUR', ${q(randomUUID())})`,
    );
    await actor(
      manager,
      `select public.update_crm_opportunity_forecast(${q(company)}, ${q(opportunity)}, 42.5, '2026-12-31', 1, ${q(randomUUID())})`,
    );

    // Both snapshots retain the exact prior fields, versions and event values.
    const snapshot = (schema) =>
      sql(`
        select jsonb_build_object(
          'record', (select to_jsonb(o) from ${schema}.crm_opportunities o where id = ${q(opportunity)}),
          'events', (select jsonb_agg(to_jsonb(e) order by version) from ${schema}.crm_opportunity_events e where opportunity_id = ${q(opportunity)})
        )
      `).then(JSON.parse);
    const before = await snapshot("public");
    assert.equal(before.record.close_probability, 42.5);
    assert.deepEqual(before.events.map(({ event_type }) => event_type), [
      "created",
      "forecast_updated",
    ]);

    await sql(await readFile(retirement, "utf8"));
    assert.deepEqual(await snapshot("private"), before);
    assert.equal(
      await sql(`
        select to_regclass('public.crm_opportunities') is null
           and to_regclass('public.crm_opportunity_events') is null
           and not exists (
             select from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname in ('public', 'private') and p.proname in (
               'create_crm_opportunity', 'list_crm_opportunities', 'list_crm_opportunity_page',
               'list_crm_opportunity_events', 'move_crm_opportunity', 'update_crm_opportunity_forecast'
             )
           )
      `),
      "t",
    );
    assert.equal(
      await sql(`
        select bool_and(not has_table_privilege(role_name, relation, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'))
        from unnest(array['anon', 'authenticated', 'service_role']) as roles(role_name)
        cross join unnest(array['private.crm_opportunities', 'private.crm_opportunity_events']) as tables(relation)
      `),
      "t",
    );
    await assert.rejects(
      sql(`update private.crm_opportunity_events set to_stage = 'lost' where opportunity_id = ${q(opportunity)}`),
      /42501.*crm_opportunity_history_immutable/s,
    );

    // Current account and company deletion no longer has a hidden CRM dependency.
    await sql(`delete from public.organisations where id = ${q(company)}; delete from auth.users where id = ${q(manager)};`);
    assert.deepEqual(await snapshot("private"), before);
  },
  { migrationsThrough: "20261126223000" },
);

console.log("Sales pipeline retirement preserved archived rows and removed application access and deletion blockers.");
