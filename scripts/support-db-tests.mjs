/** Real isolated PostgreSQL support lifecycle, privacy, file and race checks. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { withTestDatabase, quoteSql as q } from "./testing/database.mjs";
await withTestDatabase("support_test", async ({ sql, actor }) => {
  const owner = randomUUID(),
    peer = randomUUID(),
    admin = randomUUID(),
    support = randomUUID(),
    inactive = randomUUID();
  await sql(`insert into auth.users(id,email) values ${[owner, peer, admin, support, inactive].map((id) => `('${id}','${id}@example.invalid')`).join(",")};
    insert into public.user_roles values('${owner}','lecturer'),('${peer}','lecturer'),('${admin}','admin'),('${support}','lecturer');
    insert into public.role_permissions values('lecturer','support.manage');update public.profiles set active=false where id='${inactive}'`);
  const payload = {
    title: "Fictional support question %_",
    category: "technical",
    description: "Expected a readable fictional course page.",
  };
  const create = async (
    who,
    body = payload,
    key = randomUUID(),
    aal = "aal1",
  ) =>
    actor(
      who,
      `select public.create_support_ticket(${q(JSON.stringify(body))}::jsonb,'${key}')`,
      aal,
    );
  const get = async (who, id, aal = "aal1") =>
    JSON.parse(await actor(who, `select public.support_ticket('${id}')`, aal));
  const list = async (who, search = "", aal = "aal1") =>
    JSON.parse(
      await actor(who, `select public.support_tickets(${q(search)})`, aal),
    );
  const change = async (
    who,
    id,
    action,
    body,
    version,
    key = randomUUID(),
    aal = "aal1",
  ) =>
    actor(
      who,
      `select public.update_support_ticket('${id}',${q(action)},${q(JSON.stringify(body))}::jsonb,${version},'${key}')`,
      aal,
    );
  let checks = 0;
  const check = async (name, fn) => {
    await fn();
    checks++;
    console.log(`PASS ${name}`);
  };
  let ticket;
  await check(
    "Create is actor-owned, literal search is scoped, and concurrent retries create exactly one ticket",
    async () => {
      const request = randomUUID();
      const results = await Promise.all([
        create(owner, payload, request),
        create(owner, payload, request),
      ]);
      assert.equal(results[0], results[1]);
      ticket = results[0];
      assert.equal(
        await sql(
          `select count(*) from private.support_tickets where requester_id='${owner}'`,
        ),
        "1",
      );
      assert.equal((await list(owner, "%_")).items[0].id, ticket);
      assert.equal((await list(peer)).items.length, 0);
      await assert.rejects(
        create(owner, { ...payload, title: "Changed retry" }, request),
        /retry conflict/,
      );
    },
  );
  await check(
    "Peer/forged IDs and anonymous/inactive actors cannot access tickets or private ledgers",
    async () => {
      await assert.rejects(get(peer, ticket), /Support access denied/);
      await assert.rejects(get(peer, randomUUID()), /Support access denied/);
      await assert.rejects(get(inactive, ticket), /Active account required/);
      await assert.rejects(
        sql("set role anon;select public.support_context()"),
        /permission denied/,
      );
      await assert.rejects(
        sql("set role authenticated;select public.support_context()"),
        /Support access denied/,
      );
      for (const who of [owner, admin, support])
        await assert.rejects(
          actor(who, "select * from private.support_tickets", "aal1"),
          /permission denied/,
        );
    },
  );
  await check(
    "Support requires its explicit capability and permission, with no commercial or private-message bypass",
    async () => {
      assert.equal((await get(support, ticket)).can_manage, true);
      assert.equal(
        await actor(
          support,
          "select private.has_permission('contracts.read') or private.has_permission('finance.manage')",
          "aal1",
        ),
        "f",
      );
      assert.equal(
        JSON.parse(await actor(owner, "select public.support_context()")).staff
          .length,
        0,
      );
      assert.equal((await list(admin, "", "aal1")).items.length, 1);
    },
  );
  await check(
    "Malformed payloads, role-like fields and foreign resource references are rejected",
    async () => {
      for (const body of [
        { ...payload, title: "" },
        { ...payload, category: "sql" },
        { ...payload, requester_id: peer },
        { ...payload, title: [] },
        { ...payload, description: null },
      ])
        await assert.rejects(create(owner, body), /Invalid support ticket/);
      await assert.rejects(
        create(owner, { ...payload, claim_id: randomUUID() }),
        /Related resource access denied/,
      );
      await assert.rejects(
        create(owner, { ...payload, organisation_id: randomUUID() }),
        /Related resource access denied/,
      );
      await assert.rejects(
        actor(owner, "select public.support_tickets('', 'unknown')"),
        /Invalid support filter/,
      );
    },
  );
  await check(
    "Replies are append-only and retries do not duplicate messages, history or notifications",
    async () => {
      const key = randomUUID();
      await change(
        owner,
        ticket,
        "reply",
        { body: "A fictional update <script>safe text</script>" },
        1,
        key,
      );
      await change(
        owner,
        ticket,
        "reply",
        { body: "A fictional update <script>safe text</script>" },
        1,
        key,
      );
      assert.equal((await get(owner, ticket)).messages.length, 1);
      assert.equal((await get(owner, ticket)).version, 2);
      assert.equal(
        await sql(
          `select count(*) from private.support_events where ticket_id='${ticket}' and action='reply'`,
        ),
        "1",
      );
      assert.equal(
        await sql(
          `select count(*) from public.notifications where user_id='${support}' and resource_id='${ticket}'`,
        ),
        "1",
      );
      await assert.rejects(
        change(owner, ticket, "reply", { body: "Different retry" }, 1, key),
        /retry conflict/,
      );
      await assert.rejects(
        actor(owner, "update private.support_messages set body='overwrite'"),
        /permission denied/,
      );
    },
  );
  await check(
    "Internal messages and internal history never appear in requester projections or notifications",
    async () => {
      const before = await sql(
        `select coalesce(max(created_at)::text,'') from public.notifications where user_id='${owner}' and resource_id='${ticket}'`,
      );
      await change(
        support,
        ticket,
        "internal_note",
        { body: "Restricted fictional internal note" },
        2,
        randomUUID(),
        "aal1",
      );
      const own = await get(owner, ticket),
        staff = await get(support, ticket, "aal1");
      assert.equal(own.messages.length, 1);
      assert.equal(staff.messages.length, 2);
      assert.equal(JSON.stringify(own).includes("Restricted fictional"), false);
      assert.equal(
        own.events.some((e) => e.action === "internal_note"),
        false,
      );
      assert.equal(
        await sql(
          `select coalesce(max(created_at)::text,'') from public.notifications where user_id='${owner}' and resource_id='${ticket}'`,
        ),
        before,
      );
      await assert.rejects(
        change(
          owner,
          ticket,
          "internal_note",
          { body: "Attempted internal note" },
          3,
        ),
        /Support management required/,
      );
    },
  );
  await check(
    "Versioned status transitions preserve reasons; requester cannot approve or silently close",
    async () => {
      await assert.rejects(
        change(
          owner,
          ticket,
          "status",
          { status: "in_progress", reason: "Start" },
          3,
        ),
        /Support management required/,
      );
      await assert.rejects(
        change(
          support,
          ticket,
          "status",
          { status: "closed", reason: "Skip" },
          3,
          randomUUID(),
          "aal1",
        ),
        /Invalid support status transition/,
      );
      await change(
        support,
        ticket,
        "status",
        { status: "in_progress", reason: "Investigating fictional problem" },
        3,
        randomUUID(),
        "aal1",
      );
      await change(
        support,
        ticket,
        "status",
        { status: "waiting_for_user", reason: "Need a reproduction" },
        4,
        randomUUID(),
        "aal1",
      );
      await change(
        owner,
        ticket,
        "reply",
        { body: "Reproduction supplied" },
        5,
      );
      await change(
        support,
        ticket,
        "status",
        { status: "resolved", reason: "Fictional fix verified" },
        6,
        randomUUID(),
        "aal1",
      );
      await assert.rejects(
        change(
          owner,
          ticket,
          "reply",
          { body: "Cannot reply while resolved" },
          7,
        ),
        /Reopen ticket/,
      );
      await change(
        support,
        ticket,
        "status",
        { status: "closed", reason: "Resolution accepted" },
        7,
        randomUUID(),
        "aal1",
      );
      assert.equal((await get(owner, ticket)).status, "closed");
      await change(
        owner,
        ticket,
        "reopen",
        { reason: "A fictional regression remains" },
        8,
      );
      assert.equal((await get(owner, ticket)).status, "open");
      assert.equal(
        (await get(owner, ticket)).events.filter((e) => e.action === "status")
          .length,
        4,
      );
    },
  );
  await check(
    "Two concurrent management changes cannot overwrite the same reviewed version",
    async () => {
      const outcomes = await Promise.allSettled([
        change(
          support,
          ticket,
          "priority",
          { priority: "high" },
          9,
          randomUUID(),
          "aal1",
        ),
        change(
          admin,
          ticket,
          "priority",
          { priority: "urgent" },
          9,
          randomUUID(),
          "aal1",
        ),
      ]);
      assert.equal(outcomes.filter((o) => o.status === "fulfilled").length, 1);
      assert.equal(
        outcomes.filter(
          (o) =>
            o.status === "rejected" &&
            /Support ticket changed/.test(o.reason.message),
        ).length,
        1,
      );
      assert.equal((await get(owner, ticket)).version, 10);
    },
  );
  await check(
    "Assignments validate current active support capability and preserve ordinary user isolation",
    async () => {
      await assert.rejects(
        change(
          support,
          ticket,
          "assign",
          { user_id: peer },
          10,
          randomUUID(),
          "aal1",
        ),
        /assignee unavailable/,
      );
      await change(
        support,
        ticket,
        "assign",
        { user_id: support },
        10,
        randomUUID(),
        "aal1",
      );
      assert.equal((await get(owner, ticket)).assigned_to, support);
      await assert.rejects(
        change(peer, ticket, "reply", { body: "Cross-user attempt" }, 11),
        /Support access denied/,
      );
    },
  );
  const makeFile = async (who, kind = "material", status = "clean") => {
    const document = randomUUID(),
      version = randomUUID();
    await sql(`insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id) values('${document}','${who}','${who}','personal',${q(kind)},'fictional.txt','text/plain',10,${q(status)},'${randomUUID()}');
      insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,status,sha256) values('${version}','${document}','${who}','${randomUUID()}',1,'${randomUUID()}','fictional.txt','text/plain',10,${q(status)},repeat('a',64));update public.documents set current_version_id='${version}' where id='${document}'`);
    return { document, version };
  };
  let attachment, internalAttachment;
  await check(
    "Only dedicated own clean material uploads can be attached; contracts and foreign/quarantined files reject",
    async () => {
      for (const file of [
        await makeFile(owner, "contract"),
        await makeFile(peer),
        await makeFile(owner, "material", "quarantined"),
      ])
        await assert.rejects(
          change(
            owner,
            ticket,
            "attach",
            { document_id: file.document, internal: false },
            11,
          ),
          /Dedicated clean attachment required/,
        );
      attachment = await makeFile(owner);
      await change(
        owner,
        ticket,
        "attach",
        { document_id: attachment.document, internal: false },
        11,
      );
      assert.equal((await get(owner, ticket)).attachments.length, 1);
      assert.equal(
        await actor(
          support,
          `select private.can_access_document('${attachment.document}')`,
          "aal1",
        ),
        "t",
      );
      assert.equal(
        await actor(
          peer,
          `select private.can_access_document('${attachment.document}')`,
        ),
        "f",
      );
      assert.equal(
        await actor(
          support,
          `select private.can_access_document('${attachment.document}')`,
        ),
        "f",
      );
      await assert.rejects(
        actor(
          owner,
          `select public.rename_document('${attachment.document}','hide.txt',true)`,
        ),
        /immutable/,
      );
      await assert.rejects(
        sql(
          `update public.document_versions set sha256=repeat('b',64) where id='${attachment.version}'`,
        ),
        /immutable/,
      );
      const unrelated = await makeFile(peer);
      await assert.rejects(
        sql(
          `update public.document_versions set document_id='${attachment.document}',version=2 where id='${unrelated.version}'`,
        ),
        /immutable/,
      );
    },
  );
  await check(
    "Restricted attachments remain hidden from requester and ordinary support tokens",
    async () => {
      const file = await makeFile(support);
      internalAttachment = file;
      await change(
        support,
        ticket,
        "attach",
        { document_id: file.document, internal: true },
        12,
        randomUUID(),
        "aal1",
      );
      assert.equal((await get(owner, ticket)).attachments.length, 1);
      assert.equal((await get(support, ticket, "aal1")).attachments.length, 2);
      assert.equal(
        await actor(
          owner,
          `select private.can_access_document('${file.document}')`,
        ),
        "f",
      );
      assert.equal(
        await actor(
          admin,
          `select private.can_access_document('${file.document}')`,
          "aal1",
        ),
        "t",
      );
      assert.equal(
        await actor(
          support,
          `select private.can_access_document('${file.document}')`,
        ),
        "f",
        "Uploader ownership does not bypass restricted-ticket permission",
      );
    },
  );
  await check(
    "Current permission revocation and suspended owners remove ticket and attachment reads",
    async () => {
      await sql(
        `delete from public.role_permissions where role='lecturer' and permission='support.manage'`,
      );
      await assert.rejects(
        get(support, ticket, "aal1"),
        /Support access denied/,
      );
      assert.equal(
        await actor(
          support,
          `select private.can_access_document('${attachment.document}')`,
          "aal1",
        ),
        "f",
      );
      assert.equal(
        await actor(
          support,
          `select private.can_access_document('${internalAttachment.document}')`,
          "aal1",
        ),
        "f",
        "Former support uploader loses its own attached restricted evidence too",
      );
      await sql(`update public.profiles set active=false where id='${owner}'`);
      await assert.rejects(get(owner, ticket), /Support access denied/);
      assert.equal(
        await actor(
          owner,
          `select private.can_access_document('${attachment.document}')`,
        ),
        "f",
      );
    },
  );
  console.log(`\n${checks} support-desk PostgreSQL groups passed.`);
});
