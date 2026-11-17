/** Message-only upload authorization on actual PostgreSQL in a UUID database. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";
await withTestDatabase("message_documents", async ({ sql, actor }) => {
  const owner = randomUUID(),
    peer = randomUUID(),
    outsider = randomUUID();
  await sql(`insert into auth.users(id,email) values (${q(owner)},'owner@example.invalid'),(${q(peer)},'peer@example.invalid'),(${q(outsider)},'outsider@example.invalid');
    insert into public.user_roles(user_id,role) values(${q(owner)},'lecturer'),(${q(peer)},'lecturer'),(${q(outsider)},'lecturer');`);
  const room = await actor(
    owner,
    `select public.create_chat_group('Fictional group',array[${q(peer)}]::uuid[],'topic')`,
  );
  const definition = await sql(
    "select pg_get_functiondef('private.reserve_message_document(text,text,bigint,uuid,uuid)'::regprocedure)",
  );
  assert.ok(
    definition.indexOf("documents-global-quota") <
      definition.indexOf("'documents:'"),
    "global quota lock must precede actor lock",
  );
  const reservations = await Promise.all(
    Array.from({ length: 4 }, (_, index) => {
      const unique = randomUUID();
      const call =
        index % 2 === 0
          ? `public.reserve_message_document('parallel.txt','text/plain',10,${q(room)},${q(unique)})`
          : `public.reserve_document('parallel.txt','text/plain',10,'room','chat',${q(room)},null,${q(unique)},null,null)`;
      return actor(
        owner,
        `set local statement_timeout='10s';select ${call}`,
      ).then(JSON.parse);
    }),
  );
  assert.equal(new Set(reservations.map((x) => x.document_id)).size, 4);
  const key = randomUUID();
  const reserve = () =>
    actor(
      owner,
      `select public.reserve_message_document('lesson.txt','text/plain',10,${q(room)},${q(key)})`,
    ).then(JSON.parse);
  const doc = await reserve();
  assert.deepEqual(await reserve(), doc);
  const visible = async (who, id) =>
    Number(
      await actor(
        who,
        `select count(*) from public.documents where id=${q(id)}`,
      ),
    );
  assert.equal(await visible(owner, doc.document_id), 1);
  assert.equal(await visible(peer, doc.document_id), 0);
  assert.equal(await visible(outsider, doc.document_id), 0);
  await sql(
    `update public.document_versions set status='clean',sha256=repeat('a',64) where id=${q(doc.version_id)};update public.documents set status='clean' where id=${q(doc.document_id)};`,
  );
  const send = () =>
    actor(
      owner,
      `select public.send_message(${q(room)},'Attachment',${q(randomUUID())},${q(doc.document_id)})`,
    );
  const one = await send(),
    two = await send();
  assert.equal(await visible(peer, doc.document_id), 1);
  assert.equal(
    await actor(
      peer,
      `select count(*) from public.document_versions where document_id=${q(doc.document_id)}`,
    ),
    "1",
  );
  await actor(owner, `select public.delete_message(${q(one)})`);
  assert.equal(
    await visible(peer, doc.document_id),
    1,
    "second live message must retain access",
  );
  await actor(owner, `select public.delete_message(${q(two)})`);
  assert.equal(
    await visible(peer, doc.document_id),
    0,
    "last deleted reference revokes peer",
  );
  assert.equal(
    await actor(
      peer,
      `select count(*) from public.document_versions where document_id=${q(doc.document_id)}`,
    ),
    "0",
  );
  assert.equal(
    await visible(owner, doc.document_id),
    1,
    "owner retains their file while a member",
  );
  const sharedKey = randomUUID();
  const shared = JSON.parse(
    await actor(
      owner,
      `select public.reserve_document('shared.txt','text/plain',10,'room','chat',${q(room)},null,${q(sharedKey)},null,null)`,
    ),
  );
  assert.equal(
    await visible(peer, shared.document_id),
    1,
    "legacy room sharing is unchanged",
  );
  await assert.rejects(
    actor(
      owner,
      `select public.reserve_message_document('shared.txt','text/plain',10,${q(room)},${q(sharedKey)})`,
    ),
    /scope conflict/,
  );
  const concurrentMessage = await send();
  const [, concurrentNew] = await Promise.all([
    actor(owner, `select public.delete_message(${q(concurrentMessage)})`),
    send(),
  ]);
  assert.ok(concurrentNew);
  assert.equal(
    await visible(peer, doc.document_id),
    1,
    "concurrent re-send remains a live reference",
  );
  await actor(owner, `select public.delete_message(${q(concurrentNew)})`);
  assert.equal(await visible(peer, doc.document_id), 0);
  const job = randomUUID();
  await sql(`insert into public.jobs(id,title,customer_name,delivery_type,status,amount,currency,rate_unit,total_amount,terms) values(${q(job)},'Fictional course','Fictional organisation','online','published',100,'EUR','fixed_total',100,'Fictional terms');
    update public.chat_rooms set kind='lecturer_course',job_id=${q(job)} where id=${q(room)};
    update public.document_versions set status='clean',sha256=repeat('b',64) where id=${q(shared.version_id)};
    update public.documents set status='clean' where id=${q(shared.document_id)};`);
  assert.equal(
    await sql(
      `select private.readiness_material_access_before_message_scope(${q(doc.document_id)},${q(owner)},${q(job)})`,
    ),
    "t",
  );
  assert.equal(
    await sql(
      `select private.readiness_material_access(${q(doc.document_id)},${q(owner)},${q(job)})`,
    ),
    "f",
  );
  assert.equal(
    await sql(
      `select private.readiness_material_access(${q(shared.document_id)},${q(owner)},${q(job)})`,
    ),
    "t",
  );
  await actor(
    owner,
    `select public.manage_chat_member(${q(room)},${q(peer)},true)`,
  );
  assert.equal(await visible(peer, shared.document_id), 0);
  assert.equal(await visible(peer, doc.document_id), 0);
  console.log(
    "PASS message-only drafts, idempotency, live reference, deleted reference, legacy sharing and revocation",
  );
});
