/** Verify all-or-none archive and restore against the production RPC. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

await withTestDatabase("course_bulk_archive", async ({ sql, actor }) => {
  const [manager, customer, company, template, first, second, session] =
    Array.from({ length: 7 }, randomUUID);
  await sql(`insert into auth.users(id,email,email_confirmed_at) values
    (${q(manager)},'bulk-manager@example.invalid',now()),
    (${q(customer)},'bulk-company@example.invalid',now());
    insert into public.user_roles(user_id,role) values
    (${q(manager)},'management'),(${q(customer)},'client');
    insert into public.organisations(id,name) values (${q(company)},'Fictional bulk company');
    insert into public.client_organisation_memberships(user_id,organisation_id)
    values (${q(customer)},${q(company)});
    insert into public.course_templates(id,title) values (${q(template)},'Fictional archive template');
    insert into public.course_runs(id,template_id,organisation_id,time_zone,published) values
    (${q(first)},${q(template)},${q(company)},'Europe/Berlin',true),
    (${q(second)},${q(template)},${q(company)},'Australia/Brisbane',false);
    insert into public.course_sessions(id,course_run_id,starts_at,ends_at) values
    (${q(session)},${q(first)},'2030-10-28 08:00:00+00','2030-10-28 16:00:00+00');`);
  const snapshot = async () => JSON.parse(await sql(`
    select jsonb_agg(jsonb_build_object('id', id, 'published', published,
      'archived_at', archived_at, 'organisation_id', organisation_id) order by id)
    from public.course_runs where id in (${q(first)},${q(second)})`));
  const apply = (who, items, archive) =>
    actor(who, `select public.archive_course_runs(${q(JSON.stringify(items))},${archive})`);
  const initial = await snapshot();
  await assert.rejects(apply(customer, initial, true), /42501/);
  await assert.rejects(apply(manager, [initial[0], initial[0]], true), /22023/);
  await assert.rejects(apply(manager, [
    initial[0], { ...initial[1], published: !initial[1].published },
  ], true), /PT409/);
  assert.deepEqual(await snapshot(), initial);
  assert.equal(await apply(manager, initial, true), "2");
  const archived = await snapshot();
  assert.ok(archived.every(({ archived_at }) => archived_at));
  await assert.rejects(apply(manager, initial, true), /PT409/);
  assert.equal(await apply(manager, archived, false), "2");
  assert.deepEqual(await snapshot(), initial);
  assert.equal(await sql(`select count(*) from public.course_sessions where id=${q(session)}
    and starts_at='2030-10-28 08:00:00+00' and ends_at='2030-10-28 16:00:00+00'`), "1");
  assert.equal(await sql(`select count(*) from public.audit_events
    where action='course.visibility.changed' and resource_id in (${q(first)},${q(second)})`), "4");
  console.log("PASS exact reviewed state, permissions, rollback and preserved publication and sessions");
});
