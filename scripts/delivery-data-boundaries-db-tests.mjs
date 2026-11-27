/** Check grants and index shape against the actual replayed PostgreSQL catalogue. */
import assert from "node:assert/strict";
import { withTestDatabase } from "./testing/database.mjs";

await withTestDatabase("delivery_data_boundaries", async ({ sql }) => {
  const leakedTables = await sql(`
    select c.oid::regclass from pg_class c
    where c.oid in ('private.assignment_removal_appeals'::regclass, 'private.chat_retention_default'::regclass)
      and (not c.relrowsecurity
        or has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
        or has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE'));
  `);
  assert.equal(leakedTables, "");

  const exposedDefiners = await sql(`
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where p.proname in ('assignment_removal_appeals', 'submit_assignment_removal_appeal',
      'review_assignment_removal_appeal', 'chat_retention_policy', 'set_chat_retention_policy',
      'prune_chat_messages', 'ensure_chat_retention_schedule')
      and ((n.nspname='public' and p.prosecdef)
        or (n.nspname in ('public','private') and (has_function_privilege('anon',p.oid,'EXECUTE')
          or not coalesce('search_path=""'=any(p.proconfig),false)))
        or (n.nspname='private' and p.proname='prune_chat_messages'
          and has_function_privilege('authenticated',p.oid,'EXECUTE')));
  `);
  assert.equal(exposedDefiners, "");

  // Compare exact definitions on the new private relations. Indexes sharing a
  // prefix may address different query orderings or partial predicates.
  const duplicateIndexes = await sql(`
    select string_agg(indexrelid::regclass::text, ', ' order by indexrelid::regclass::text)
    from pg_index
    where indrelid in ('private.assignment_removal_appeals'::regclass, 'private.chat_retention_default'::regclass)
    group by indrelid, indclass, indcollation, indoption, indkey, indnkeyatts, indisunique,
      pg_get_expr(indexprs,indrelid), pg_get_expr(indpred,indrelid)
    having count(*) > 1;
  `);
  assert.equal(duplicateIndexes, "");
});
