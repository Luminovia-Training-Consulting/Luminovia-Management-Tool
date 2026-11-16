/** Real disposable PostgreSQL checks for permanent-deletion scope, authority and
 * fencing. Auth claims and Storage metadata are emulated; native byte/Auth/HTTP
 * deletion is checked separately by permanent-deletion-api-check.mjs. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

let checks = 0;
await withTestDatabase("permanent_deletion", async ({ sql, actor }) => {
  const admin = randomUUID(),
    owner = randomUUID(),
    other = randomUUID(),
    manager = randomUUID();
  await sql(`insert into auth.users(id,email) values
    (${q(admin)},'permanent-admin@example.invalid'),(${q(owner)},'permanent-owner@example.invalid'),
    (${q(other)},'permanent-other@example.invalid'),(${q(manager)},'permanent-manager@example.invalid');
    insert into public.user_roles(user_id,role) values (${q(admin)},'admin'),(${q(owner)},'lecturer'),(${q(other)},'lecturer'),(${q(manager)},'management');
    create schema storage;create table storage.objects(bucket_id text,name text,primary key(bucket_id,name));
    create trigger permanent_deletion_storage_fence before insert or update on storage.objects for each row execute function private.guard_deleted_storage_path();`);
  /** Every service call really runs under the restricted service database role. */
  const service = (statement) =>
    sql(
      `begin;set local role service_role;set local request.jwt.claims='{"role":"service_role"}';${statement};commit;`,
    );
  const call = (who, name, args = "", aal = "aal2") =>
    actor(who, `select public.${name}(${args})`, aal).then(JSON.parse);
  const worker = (name, args) =>
    service(`select public._deletion_${name}(${args})`).then(JSON.parse);
  const plan = (kind, id, who = admin) =>
    call(who, "deletion_preview", `${q(kind)},${q(id)}`);
  const confirm = (preview, who = admin, requestId = randomUUID()) =>
    call(
      who,
      "deletion_confirm",
      `${q(preview.plan_id)},${q(requestId)},'DELETE'`,
    );
  const permit = (operation, who = admin) =>
    call(who, "deletion_execution", q(operation.operation_id));
  const key = (operation, execution) =>
    `${q(operation.operation_id)},${q(execution.permit_id)}`;
  const expectCode = (promise, code) =>
    assert.rejects(promise, new RegExp(`\\b${code}\\b`));
  /** Report a group only after its real SQL assertions pass. */
  const check = async (name, run) => {
    await run();
    checks++;
    console.log(`PASS ${name}`);
  };
  const reserve = (who = owner, replace = null) =>
    call(
      who,
      "reserve_document",
      `'Fictional private deletion.pdf','application/pdf',100,'personal','material',null,null,${q(randomUUID())},${replace ? q(replace) : "null"},null`,
    );
  const document = await reserve();
  const second = await reserve(owner, document.document_id);

  await check(
    "Private registry and service work stay inaccessible; AAL2 and exact ownership are authoritative",
    async () => {
      assert.deepEqual(
        (await call(owner, "deletion_access", "", "aal1")).kinds,
        [],
      );
      await expectCode(plan("document", document.document_id, other), "42501");
      await expectCode(
        call(
          owner,
          "deletion_preview",
          `'document',${q(document.document_id)}`,
          "aal1",
        ),
        "42501",
      );
      await expectCode(
        actor(owner, "select * from private.deletion_operations"),
        "42501",
      );
      await expectCode(
        actor(
          owner,
          `select public._deletion_work(${q(randomUUID())},${q(randomUUID())})`,
        ),
        "42501",
      );
      await expectCode(
        sql(
          "begin;set local role anon;select public.deletion_access();commit;",
        ),
        "42501",
      );
    },
  );
  await check(
    "Preview changes nothing; wrong confirmation, target kind and actor are denied",
    async () => {
      const p = await plan("document", document.document_id, owner);
      assert.equal(p.can_confirm, true);
      assert.equal(p.counts["public.document_versions"], 2);
      assert.equal(
        await sql(
          `select deleted_at is null from public.documents where id=${q(document.document_id)}`,
        ),
        "t",
      );
      await expectCode(
        call(
          owner,
          "deletion_confirm",
          `${q(p.plan_id)},${q(randomUUID())},'delete'`,
        ),
        "22023",
      );
      await expectCode(confirm(p, other), "22023");
      await expectCode(plan("auth.users", owner), "42501");
    },
  );
  await check(
    "A changed preview cannot delete a newer document version or changed metadata",
    async () => {
      const p = await plan("document", document.document_id, owner);
      await actor(
        owner,
        `select public.rename_document(${q(document.document_id)},'Fictional revised.pdf',false)`,
      );
      await expectCode(confirm(p, owner), "40001");
      assert.equal(
        await sql(
          `select deleted_at is null from public.documents where id=${q(document.document_id)}`,
        ),
        "t",
      );
    },
  );

  let operation, execution, originalPlan;
  const requestId = randomUUID();
  await sql(
    `insert into storage.objects values('portal-clean',${q(document.object_path)})`,
  );
  const lease = await service(
    `select public.deletion_upload_begin(${q(document.document_id)},${q(second.version_id)})`,
  );
  await check(
    "Confirm fixes both-bucket all-version manifest and waits for an existing service-owned upload lease",
    async () => {
      originalPlan = await plan("document", document.document_id, owner);
      operation = await confirm(originalPlan, owner, requestId);
      execution = await permit(operation, owner);
      const work = await worker("work", key(operation, execution));
      assert.equal(work.pending_uploads, 1);
      assert.equal(work.objects.length, 4);
      assert.equal(new Set(work.objects.map((o) => o.path)).size, 2);
      assert.deepEqual(
        new Set(work.objects.map((o) => o.bucket)),
        new Set(["portal-clean", "portal-quarantine"]),
      );
      assert.equal(
        work.objects.some((o) => o.path === document.object_path),
        true,
      );
      await expectCode(worker("apply", key(operation, execution)), "55000");
      await expectCode(
        service(
          `select public.deletion_upload_begin(${q(document.document_id)},${q(second.version_id)})`,
        ),
        "55000",
      );
      assert.equal(
        await actor(
          owner,
          `select count(*) from public.documents where id=${q(document.document_id)}`,
        ),
        "0",
      );
      await expectCode(
        service(
          `update public.documents set status='clean' where id=${q(document.document_id)}`,
        ),
        "55000",
      );
      await expectCode(reserve(owner, document.document_id), "42501");
    },
  );
  await check(
    "An exact retry resumes one operation; changed request reuse and caller-service forgery fail",
    async () => {
      assert.equal(
        (await confirm(originalPlan, owner, requestId)).operation_id,
        operation.operation_id,
      );
      await expectCode(
        call(
          owner,
          "deletion_confirm",
          `${q(randomUUID())},${q(requestId)},'DELETE'`,
        ),
        "22023",
      );
      await expectCode(
        call(other, "deletion_execution", q(operation.operation_id)),
        "42501",
      );
      await expectCode(
        worker("work", `${q(operation.operation_id)},${q(randomUUID())}`),
        "42501",
      );
      await expectCode(
        actor(
          owner,
          `select set_config('private.deletion_operation',${q(operation.operation_id)},true);select public.rename_document(${q(document.document_id)},'Forgery.pdf',false)`,
        ),
        "42501",
      );
    },
  );
  await check(
    "Released upload lease permits real relational deletion; missing external acknowledgement cannot complete",
    async () => {
      await service(`select public.deletion_upload_end(${q(lease)})`);
      await worker("apply", key(operation, execution));
      assert.equal(
        await sql(
          `select count(*) from public.documents where id=${q(document.document_id)}`,
        ),
        "0",
      );
      assert.equal(
        await sql(
          `select count(*) from public.document_versions where document_id=${q(document.document_id)}`,
        ),
        "0",
      );
      await expectCode(
        worker("complete", `${key(operation, execution)},false,true`),
        "55000",
      );
      await expectCode(
        worker("complete", `${key(operation, execution)},true,true`),
        "55000",
      );
      await sql(
        `delete from storage.objects where name=${q(document.object_path)}`,
      );
      assert.equal(
        (await worker("complete", `${key(operation, execution)},true,true`))
          .status,
        "completed",
      );
      assert.equal(
        (await call(owner, "deletion_status", q(operation.operation_id)))
          .status,
        "completed",
      );
    },
  );
  await check(
    "Completed old document IDs and exact clean/quarantine paths cannot be resurrected",
    async () => {
      for (const bucket of ["portal-clean", "portal-quarantine"])
        await expectCode(
          sql(
            `insert into storage.objects values(${q(bucket)},${q(second.object_path)})`,
          ),
          "55000",
        );
      await expectCode(
        sql(
          `insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,client_id) values(${q(document.document_id)},${q(owner)},${q(owner)},'personal','material','Old identifier.pdf','application/pdf',100,${q(randomUUID())})`,
        ),
        "55000",
      );
      assert.equal(
        await sql(
          `select count(*) from private.deletion_storage_fences where path=${q(document.object_path)}`,
        ),
        "2",
      );
    },
  );
  await check(
    "Management cannot purge unrelated business resources; admin self/equal account deletion is denied",
    async () => {
      const org = randomUUID();
      await sql(
        `insert into public.organisations(id,name) values(${q(org)},'Fictional deletion organisation')`,
      );
      await expectCode(plan("organisation", org, manager), "42501");
      await expectCode(plan("account", admin), "42501");
      assert.equal((await plan("organisation", org)).can_confirm, true);
      const rows = await call(
        admin,
        "deletion_resources",
        `'organisation','Fictional deletion organisation',null,30`,
      );
      assert.equal(
        rows.items.some(
          (row) =>
            row.id === org && row.label === "Fictional deletion organisation",
        ),
        true,
      );
      const event = randomUUID();
      await sql(
        `insert into public.personal_events(id,user_id,title,starts_at,ends_at) values(${q(event)},${q(owner)},'Private event must not leave owner',now()+interval '1 day',now()+interval '2 day')`,
      );
      await expectCode(plan("personal_event", event), "42501");
      const ops = await call(owner, "deletion_operations");
      assert.equal(Array.isArray(ops.items), true);
    },
  );
  await check(
    "Permanent deletion preserves private DM membership and author boundaries even for administrators",
    async () => {
      const room = randomUUID(),
        message = randomUUID();
      await sql(`insert into public.chat_rooms(id,kind,dm_key) values(${q(room)},'dm',${q([owner, other].sort().join(":"))});
      insert into public.chat_members(room_id,user_id) values(${q(room)},${q(owner)}),(${q(room)},${q(other)});
      insert into public.messages(id,room_id,sender_id,client_id,request_hash,body) values(${q(message)},${q(room)},${q(owner)},${q(randomUUID())},'fixture','Private authored DM must not enter an admin deletion list')`);
      await expectCode(plan("message", message), "42501");
      await sql(
        `insert into public.chat_members(room_id,user_id) values(${q(room)},${q(admin)})`,
      );
      await expectCode(plan("message", message), "42501");
      const p = await plan("message", message, owner);
      assert.equal(p.can_confirm, true);
      const op = await confirm(p, owner),
        ex = await permit(op, owner);
      await sql(
        `update public.chat_members set removed_at=now() where room_id=${q(room)} and user_id=${q(owner)}`,
      );
      await expectCode(worker("apply", key(op, ex)), "42501");
      await sql(
        `update public.chat_members set removed_at=null where room_id=${q(room)} and user_id=${q(owner)}`,
      );
      await worker("apply", key(op, ex));
      await worker("complete", `${key(op, ex)},true,true`);
      assert.equal(
        await sql(
          `select count(*) from public.messages where id=${q(message)}`,
        ),
        "0",
      );
      assert.equal(
        await sql(
          `select count(*) from public.chat_message_revisions where message_id=${q(message)}`,
        ),
        "0",
      );
    },
  );
  await check(
    "Commercial document references are explicit protected blockers, preserving exact snapshots",
    async () => {
      const d = await reserve();
      const contract = randomUUID();
      await sql(
        `insert into public.contracts(id,user_id,status,effective_from,version,document_version_id,document_sha256) values(${q(contract)},${q(owner)},'active',now()-interval '1 day',1,${q(d.version_id)},repeat('a',64))`,
      );
      const p = await plan("document", d.document_id, owner);
      assert.equal(p.can_confirm, false);
      assert.equal(
        p.blockers.some((b) => b.kind === "public.contracts"),
        true,
      );
      await expectCode(confirm(p, owner), "23503");
      assert.equal(
        await sql(
          `select document_version_id from public.contracts where id=${q(contract)}`,
        ),
        d.version_id,
      );
    },
  );
  await check(
    "Referenced used accounts remain active and intact after dependency refusal",
    async () => {
      const p = await plan("account", owner);
      assert.equal(p.can_confirm, false);
      assert.equal(p.blockers.length > 0, true);
      await expectCode(confirm(p), "23503");
      assert.equal(
        await sql(`select active from public.profiles where id=${q(owner)}`),
        "t",
      );
    },
  );
  await check(
    "Unused invited account is fenced immediately, then only completes after native Auth absence",
    async () => {
      const unused = randomUUID();
      await sql(`insert into auth.users(id,email) values(${q(unused)},'permanent-unused@example.invalid');insert into public.user_roles(user_id,role) values(${q(unused)},'lecturer');
      insert into public.invitation_requests(actor_id,idempotency_key,email,status,auth_user_id) values(${q(admin)},${q(randomUUID())},'permanent-unused@example.invalid','sent',${q(unused)})`);
      await call(
        unused,
        "save_account_profile",
        `'{"display_name":"Fictional profile edited before deletion","bio_de":"Private authored profile"}'`,
      );
      const audit = randomUUID();
      await sql(
        `insert into public.audit_events(id,actor_id,action,resource_id) values(${q(audit)},${q(unused)},'profile.updated',${q(unused)})`,
      );
      const p = await plan("account", unused);
      assert.equal(p.can_confirm, true);
      assert.equal(p.counts.audit_attributions, 1);
      const op = await confirm(p);
      const ex = await permit(op);
      assert.equal(
        await sql(`select active from public.profiles where id=${q(unused)}`),
        "f",
      );
      await expectCode(call(unused, "deletion_access"), "42501");
      await worker("apply", key(op, ex));
      await expectCode(worker("complete", `${key(op, ex)},true,true`), "55000");
      await sql(`delete from auth.users where id=${q(unused)}`);
      assert.equal(
        (await worker("complete", `${key(op, ex)},true,true`)).status,
        "completed",
      );
      assert.equal(
        await sql(
          `select count(*) from public.invitation_requests where auth_user_id=${q(unused)}`,
        ),
        "0",
      );
      assert.equal(
        await sql(
          `select actor_id is null from public.audit_events where id=${q(audit)}`,
        ),
        "t",
      );
      assert.equal(
        (await call(admin, "deletion_status", q(op.operation_id))).status,
        "completed",
      );
    },
  );
  await check(
    "Revoked worker authority and expired permits cannot continue a confirmed operation",
    async () => {
      const org = randomUUID();
      await sql(
        `insert into public.organisations(id,name) values(${q(org)},'Fictional revoked deletion')`,
      );
      const op = await confirm(await plan("organisation", org));
      const ex = await permit(op);
      await sql(`update public.profiles set active=false where id=${q(admin)}`);
      await expectCode(worker("apply", key(op, ex)), "42501");
      await sql(
        `update public.profiles set active=true where id=${q(admin)};update private.deletion_permits set expires_at=now()-interval '1 second' where id=${q(ex.permit_id)}`,
      );
      await expectCode(worker("apply", key(op, ex)), "42501");
      const renewed = await permit(op);
      await worker("apply", key(op, renewed));
      assert.equal(
        (await worker("complete", `${key(op, renewed)},true,true`)).status,
        "completed",
      );
    },
  );
  await check(
    "Deleting one unbilled assignment preserves other complete confirmed allocations and bumps lifecycle",
    async () => {
      const job = randomUUID(),
        claim = randomUUID(),
        otherClaim = randomUUID();
      await sql(`insert into public.jobs(id,title,customer_name,delivery_type,status,amount,total_amount,currency,rate_unit,terms,capacity,capacity_basis) values(${q(job)},'Fictional two-position job','Fictional organisation','online','published',50,50,'EUR','fixed_total','Accepted terms',2,'per_position');
      insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,status,amount,total_amount,currency,rate_unit,terms,terms_version) values
      (${q(claim)},${q(job)},${q(owner)},${q(randomUUID())},'confirmed',50,50,'EUR','fixed_total','Accepted first snapshot',1),
      (${q(otherClaim)},${q(job)},${q(other)},${q(randomUUID())},'confirmed',50,50,'EUR','fixed_total','Accepted second snapshot',1)`);
      const prior = await sql(
        `select lifecycle_version from public.jobs where id=${q(job)}`,
      );
      const op = await confirm(await plan("assignment", claim));
      const ex = await permit(op);
      await worker("apply", key(op, ex));
      assert.equal(
        (await worker("complete", `${key(op, ex)},true,true`)).status,
        "completed",
      );
      assert.equal(
        await sql(`select status from public.jobs where id=${q(job)}`),
        "published",
      );
      assert.equal(
        await sql(
          `select terms from public.job_claims where id=${q(otherClaim)}`,
        ),
        "Accepted second snapshot",
      );
      assert.equal(
        Number(
          await sql(
            `select lifecycle_version from public.jobs where id=${q(job)}`,
          ),
        ) > Number(prior),
        true,
      );
    },
  );
  await check(
    "Concurrent exact confirmations share one operation; a different plan cannot take the fenced target",
    async () => {
      const org = randomUUID();
      await sql(
        `insert into public.organisations(id,name) values(${q(org)},'Fictional concurrent delete')`,
      );
      const p = await plan("organisation", org),
        otherPlan = await plan("organisation", org),
        request = randomUUID();
      const results = await Promise.all([
        confirm(p, admin, request),
        confirm(p, admin, request),
      ]);
      assert.equal(results[0].operation_id, results[1].operation_id);
      await expectCode(confirm(otherPlan), "40001");
      const ex = await permit(results[0]);
      await worker("apply", key(results[0], ex));
      await worker("complete", `${key(results[0], ex)},true,true`);
    },
  );
  await check(
    "An already-started incoming foreign-key writer changes the scope before the irreversible confirmation",
    async () => {
      const template = randomUUID(),
        run = randomUUID(),
        marker = `deletion_fk_${randomUUID()}`;
      await sql(
        `insert into public.course_templates(id,title) values(${q(template)},'Fictional concurrent template')`,
      );
      const p = await plan("course_template", template);
      const writer = sql(
        `set application_name=${q(marker)};begin;insert into public.course_runs(id,template_id) values(${q(run)},${q(template)});select pg_sleep(2);commit;`,
      );
      let waiting = false;
      for (let attempt = 0; attempt < 50; attempt++) {
        waiting =
          (await sql(
            `select exists(select 1 from pg_stat_activity where application_name=${q(marker)} and wait_event='PgSleep')`,
          )) === "t";
        if (waiting) break;
      }
      assert.equal(
        waiting,
        true,
        "Writer must be inside the known uncommitted FK transaction",
      );
      const result = await Promise.allSettled([confirm(p), writer]);
      assert.equal(result[0].status, "rejected");
      assert.match(result[0].reason.message, /\b40001\b/);
      assert.equal(result[1].status, "fulfilled");
      assert.equal(
        await sql(
          `select count(*) from public.course_templates where id=${q(template)}`,
        ),
        "1",
      );
      assert.equal(
        await sql(
          `select count(*) from private.deletion_operations where target_id=${q(template)}`,
        ),
        "0",
      );
    },
  );
  await check(
    "Qualified business recovery binds a fresh executor after the initiating account is permanently deleted",
    async () => {
      const issuer = randomUUID(),
        rescuer = randomUUID(),
        org = randomUUID();
      await sql(`insert into auth.users(id,email) values(${q(issuer)},'permanent-issuer@example.invalid'),(${q(rescuer)},'permanent-rescuer@example.invalid');
      insert into public.user_roles(user_id,role) values(${q(issuer)},'admin'),(${q(rescuer)},'owner');
      insert into public.organisations(id,name) values(${q(org)},'Fictional recoverable business target')`);
      const op = await confirm(await plan("organisation", org, issuer), issuer),
        oldPermit = await permit(op, issuer);
      const accountPlan = await plan("account", issuer, rescuer);
      assert.equal(accountPlan.can_confirm, true);
      const accountOp = await confirm(accountPlan, rescuer),
        accountPermit = await permit(accountOp, rescuer);
      await worker("apply", key(accountOp, accountPermit));
      await sql(`delete from auth.users where id=${q(issuer)}`);
      await worker("complete", `${key(accountOp, accountPermit)},true,true`);
      await expectCode(worker("apply", key(op, oldPermit)), "42501");
      await expectCode(permit(op, manager), "42501");
      assert.equal(
        (await call(rescuer, "deletion_operations")).items.some(
          (item) => item.operation_id === op.operation_id,
        ),
        true,
      );
      const recovery = await permit(op, rescuer);
      assert.equal(
        await sql(
          `select actor_id from private.deletion_permits where id=${q(recovery.permit_id)}`,
        ),
        rescuer,
      );
      await worker("apply", key(op, recovery));
      await worker("complete", `${key(op, recovery)},true,true`);
      assert.equal(
        await sql(
          `select actor_id from public.audit_events where action='resource.deletion.completed' and resource_id=${q(org)}`,
        ),
        rescuer,
      );
      assert.equal(
        await sql(`select count(*) from auth.users where id=${q(issuer)}`),
        "0",
      );
    },
  );
  await check(
    "Private owner operations stay private and prevent deleting their actor while unfinished",
    async () => {
      const personal = randomUUID(),
        event = randomUUID();
      await sql(`insert into auth.users(id,email) values(${q(personal)},'permanent-private-owner@example.invalid');insert into public.user_roles(user_id,role) values(${q(personal)},'lecturer');
      insert into public.personal_events(id,user_id,title,starts_at,ends_at) values(${q(event)},${q(personal)},'Private pending event',now()+interval '10 days',now()+interval '11 days')`);
      const op = await confirm(
        await plan("personal_event", event, personal),
        personal,
      );
      assert.equal(
        (await call(admin, "deletion_operations")).items.some(
          (item) => item.operation_id === op.operation_id,
        ),
        false,
      );
      await expectCode(permit(op, admin), "42501");
      const accountPlan = await plan("account", personal);
      assert.equal(accountPlan.can_confirm, false);
      assert.equal(
        accountPlan.blockers.some(
          (item) => item.kind === "pending_personal_deletions",
        ),
        true,
      );
      await expectCode(confirm(accountPlan), "23503");
      const ex = await permit(op, personal);
      await worker("apply", key(op, ex));
      await worker("complete", `${key(op, ex)},true,true`);
      assert.equal((await plan("account", personal)).can_confirm, true);
    },
  );
});
console.log(`PASS all ${checks} permanent-deletion database groups`);
