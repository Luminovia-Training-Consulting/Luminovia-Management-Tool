/** Real PostgreSQL/RLS tests for owner-scoped archived material recovery; all fixtures are disposable. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

await withTestDatabase("personal_material_restore", async ({ sql, actor }) => {
  const owner = randomUUID(),
    peer = randomUUID(),
    admin = randomUUID();
  const material = randomUUID(),
    version = randomUUID(),
    quarantined = randomUUID(),
    quarantineVersion = randomUUID();
  const cv = randomUUID(),
    cvVersion = randomUUID();
  await sql(`insert into auth.users(id,email) values(${q(owner)},'owner@example.invalid'),(${q(peer)},'peer@example.invalid'),(${q(admin)},'admin@example.invalid');
    insert into public.user_roles(user_id,role) values(${q(owner)},'lecturer'),(${q(peer)},'lecturer'),(${q(admin)},'admin');
    insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id,deleted_at) values
    (${q(material)},${q(owner)},${q(owner)},'personal','material','Fictional material.txt','text/plain',5,'clean',${q(randomUUID())},now()),
    (${q(quarantined)},${q(owner)},${q(owner)},'personal','material','Fictional pending.txt','text/plain',5,'quarantined',${q(randomUUID())},now()),
    (${q(cv)},${q(owner)},${q(owner)},'personal','cv','Fictional CV.txt','text/plain',5,'clean',${q(randomUUID())},now());
    insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,status,sha256) values
    (${q(version)},${q(material)},${q(owner)},${q(randomUUID())},1,'fixture/material','Fictional material.txt','text/plain',5,'clean',repeat('a',64)),
    (${q(quarantineVersion)},${q(quarantined)},${q(owner)},${q(randomUUID())},1,'fixture/pending','Fictional pending.txt','text/plain',5,'quarantined',null),
    (${q(cvVersion)},${q(cv)},${q(owner)},${q(randomUUID())},1,'fixture/cv','Fictional CV.txt','text/plain',5,'clean',repeat('b',64));
    update public.documents set current_version_id=case id when ${q(material)} then ${q(version)}::uuid when ${q(quarantined)} then ${q(quarantineVersion)}::uuid else ${q(cvVersion)}::uuid end;`);
  const dedicated = randomUUID(),
    dedicatedVersion = randomUUID(),
    ticket = randomUUID();
  // A personal material in a dedicated support registry must not be exposed
  // merely because the archive belongs to its uploader.
  await sql(`insert into private.support_tickets(id,requester_id,category,title,description) values(${q(ticket)},${q(owner)},'documents','Fictional ticket','Fictional evidence');
    insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id)
      values(${q(dedicated)},${q(owner)},${q(owner)},'personal','material','Fictional evidence.txt','text/plain',5,'clean',${q(randomUUID())});
    insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,status,sha256)
      values(${q(dedicatedVersion)},${q(dedicated)},${q(owner)},${q(randomUUID())},1,'fixture/dedicated','Fictional evidence.txt','text/plain',5,'clean',repeat('c',64));
    update public.documents set current_version_id=${q(dedicatedVersion)},deleted_at=now() where id=${q(dedicated)};
    insert into private.support_attachments(ticket_id,document_id,version_id,attached_by,internal) values(${q(ticket)},${q(dedicated)},${q(dedicatedVersion)},${q(owner)},true);`);
  const list = (who, aal = "aal1") =>
    actor(
      who,
      "select coalesce(jsonb_agg(x),'[]') from public.archived_personal_materials() x",
      aal,
    ).then(JSON.parse);
  const restore = (who, id, aal = "aal1") =>
    actor(who, `select public.restore_personal_material(${q(id)})`, aal);
  assert.deepEqual(
    (await list(owner)).map((x) => x.id),
    [material],
  );
  assert.deepEqual(await list(peer), []);
  assert.deepEqual(await list(admin, "aal2"), []);
  await assert.rejects(restore(peer, material), /42501|Material unavailable/);
  await assert.rejects(
    restore(admin, material, "aal2"),
    /42501|Material unavailable/,
  );
  await assert.rejects(
    restore(owner, quarantined),
    /42501|Material unavailable/,
  );
  await assert.rejects(restore(owner, cv), /42501|Material unavailable/);
  await assert.rejects(restore(owner, dedicated), /42501|Material unavailable/);
  await assert.rejects(
    actor(owner, "select public.archived_personal_materials(null,null,51)"),
    /22023|Invalid cursor/,
  );
  console.log(
    "PASS own material list; foreign/admin, unclean, dedicated kinds and invalid pagination denied",
  );
  const operation = randomUUID();
  // A real pending fence in the disposable database must hide and block this item.
  await sql(`insert into private.deletion_operations(id,actor_id,request_id,plan_id,kind,target_id,scope,authority)
    values(${q(operation)},${q(owner)},${q(randomUUID())},${q(randomUUID())},'document',${q(material)},
      jsonb_build_array(jsonb_build_object('table','public.documents','predicate',format('x.id=%L::uuid',${q(material)}))),'owner')`);
  assert.deepEqual(await list(owner), []);
  await assert.rejects(restore(owner, material), /42501|Material unavailable/);
  await sql(`delete from private.deletion_operations where id=${q(operation)}`);
  console.log(
    "PASS pending permanent-deletion fence hides and blocks restoration",
  );
  await Promise.all([restore(owner, material), restore(owner, material)]);
  assert.deepEqual(await list(owner), []);
  assert.equal(
    await actor(owner, `select private.can_access_document(${q(material)})`),
    "t",
  );
  assert.equal(
    await actor(peer, `select private.can_access_document(${q(material)})`),
    "f",
  );
  assert.equal(
    await sql(
      `select count(*) from public.audit_events where actor_id=${q(owner)} and resource_id=${q(material)} and action='document.restored'`,
    ),
    "1",
  );
  console.log(
    "PASS server-confirmed idempotent restore keeps original version, privacy and one audit event",
  );
  await sql(
    `update public.documents set deleted_at=now() where id=${q(material)};update public.profiles set active=false where id=${q(owner)}`,
  );
  await assert.rejects(list(owner), /42501|Active account required/);
  await assert.rejects(restore(owner, material), /42501|Material unavailable/);
  await assert.rejects(
    sql(
      `begin;set local role anon;select public.restore_personal_material(${q(material)});commit`,
    ),
    /42501|permission denied/,
  );
  console.log("PASS suspension and anonymous access fail closed");
});
