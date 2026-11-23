/** Job attachment removal retains versions and enforces current document and job rights. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

await withTestDatabase("job_material_archive", async ({ sql, actor }) => {
  const [creator, manager, lecturer, company, job, otherJob] = Array.from(
    { length: 6 },
    () => randomUUID(),
  );
  await sql(`
    insert into auth.users(id, email) values
      ${[creator, manager, lecturer, company]
        .map((user) => `(${q(user)}, ${q(user + "@example.invalid")})`)
        .join(",")};
    insert into public.user_roles(user_id, role) values
      (${q(creator)}, 'admin'), (${q(manager)}, 'management'),
      (${q(lecturer)}, 'lecturer'), (${q(company)}, 'client');
    insert into public.jobs (
      id, title, customer_name, delivery_type, status, amount, total_amount,
      currency, rate_unit, terms, created_by
    )
    select id, 'Fictional teaching offer', 'Fictional Academy', 'onsite',
      'published', 100, 100, 'EUR', 'fixed_total', 'Fictional terms', ${q(creator)}
    from unnest(array[${q(job)}::uuid, ${q(otherJob)}::uuid]) ids(id);
  `);
  async function reserve(scope, jobId) {
    return JSON.parse(
      await actor(
        creator,
        `select public.reserve_document(
          'Fictional handout.txt', 'text/plain', 32, ${q(scope)}, 'material',
          null, ${jobId ? q(jobId) : "null"}, ${q(randomUUID())}, null, null
        )`,
      ),
    );
  }
  const before = await reserve("job_before", job);
  const after = await reserve("job_after", job);
  const unrelatedOffer = await reserve("job_before", otherJob);
  const personal = await reserve("personal");
  const edit = (user, file, archive, name = "Different name.txt") =>
    actor(
      user,
      `select public.rename_document(
        ${q(file.document_id)}, ${q(name)}, ${archive}
      )`,
    );
  const canRead = (user, file) =>
    actor(user, `select private.can_access_document(${q(file.document_id)})`);
  assert.equal(await canRead(lecturer, before), "t");
  assert.equal(await canRead(lecturer, after), "f");

  await assert.rejects(edit(lecturer, before, true), /42501/);
  await assert.rejects(edit(company, before, true), /42501/);
  await assert.rejects(edit(manager, personal, true), /42501/);
  await assert.rejects(edit(manager, before, false), /42501/);
  await assert.rejects(edit(manager, before, "null"), /42501/);

  for (const file of [before, after]) {
    await edit(manager, file, true);
    assert.equal(
      await sql(`select original_name, deleted_at is not null
        from public.documents where id = ${q(file.document_id)}`),
      "Fictional handout.txt|t",
    );
    assert.equal(
      await sql(
        `select count(*) from public.document_versions where id = ${q(file.version_id)}`,
      ),
      "1",
    );
    assert.equal(await canRead(lecturer, file), "f");
    assert.equal(await canRead(manager, file), "f");
    assert.equal(
      await sql(`select count(*) from public.audit_events
        where action = 'document.deleted' and resource_id = ${q(file.document_id)}
          and actor_id = ${q(manager)}`),
      "1",
    );
  }
  assert.equal(await canRead(lecturer, unrelatedOffer), "t");
  await edit(creator, personal, false, "Updated handout.txt");
  assert.equal(
    await sql(
      `select original_name from public.documents where id = ${q(personal.document_id)}`,
    ),
    "Updated handout.txt",
  );
  console.log(
    "PASS authorised job attachment archive, audit, retained versions and personal isolation",
  );
});
