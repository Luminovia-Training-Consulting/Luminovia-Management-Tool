/** Real immutable-publication, role, ACK, quiet-attention and rollback transactions. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";
let checks = 0;
await withTestDatabase("announcements", async ({ sql, actor }) => {
  const admin = randomUUID(),
    owner = randomUUID(),
    manager = randomUUID(),
    teacher = randomUUID(),
    peer = randomUUID(),
    client = randomUUID(),
    learner = randomUUID();
  const fixtures = [
    [admin, "admin"],
    [owner, "owner"],
    [manager, "management"],
    [teacher, "lecturer"],
    [peer, "lecturer"],
    [client, "client"],
    [learner, "participant"],
  ];
  await sql(
    `insert into auth.users(id,email) values ${fixtures.map(([id], i) => `(${q(id)},'announcement-${i}@example.invalid')`).join(",")};insert into public.user_roles(user_id,role) values ${fixtures.map(([id, role]) => `(${q(id)},${q(role)})`).join(",")}`,
  );
  const payload = (extra = {}) => ({
    title_de: "Fiktive Ankündigung",
    title_en: "Fictional announcement",
    body_de: "Fiktiver Hinweis <script> als Text.",
    body_en: "Fictional <script> content as text.",
    important: true,
    audience_roles: ["lecturer"],
    starts_at: new Date(Date.now() - 60000).toISOString(),
    ends_at: new Date(Date.now() + 7 * 86400000).toISOString(),
    time_zone: "Europe/Berlin",
    ...extra,
  });
  const operate = async (
    id,
    action,
    version,
    body = {},
    key = randomUUID(),
    who = admin,
    aal = "aal1",
  ) =>
    JSON.parse(
      await actor(
        who,
        `select public.manage_announcement(${id ? q(id) : "null"},${q(action)},${version},${q(key)},${q(JSON.stringify(body))}::jsonb)`,
        aal,
      ),
    );
  const detail = async (id) =>
    JSON.parse(
      await actor(admin, `select public.admin_announcement(${q(id)})`, "aal1"),
    );
  const read = async (
    who = teacher,
    search = "",
    unack = false,
    cursor = null,
    limit = 20,
  ) =>
    JSON.parse(
      await actor(
        who,
        `select public.announcements(${q(search)},${unack},${cursor ? q(cursor.at) : "null"},${cursor ? q(cursor.id) : "null"},${limit})`,
      ),
    );
  const notices = async (revision, who = teacher) =>
    JSON.parse(
      await sql(
        `select coalesce(jsonb_agg(to_jsonb(n)),'[]') from public.notifications n where resource_id=${q(revision)} and user_id=${q(who)} and kind='portal_announcement'`,
      ),
    );
  const inbox = async (who) =>
    JSON.parse(await actor(who, "select public.notification_inbox()"));
  const acknowledge = (revision, who = teacher) =>
    actor(who, `select public.acknowledge_announcement(${q(revision)})`);
  const check = async (name, run) => {
    await run();
    checks++;
    console.log("PASS " + name);
  };
  let announcement, published;
  await check(
    "Only current permission owner/admin/management may create or inspect management data",
    async () => {
      for (const who of [admin, owner, manager]) {
        await assert.rejects(
          operate(null, "save", 0, payload(), randomUUID(), who, "aal1"),
          /42501/,
        );
        const created = await operate(
          null,
          "save",
          0,
          payload({ important: false }),
          randomUUID(),
          who,
        );
        assert.equal(created.version, 1);
      }
      for (const who of [teacher, client, learner])
        await assert.rejects(
          operate(null, "save", 0, payload(), randomUUID(), who),
          /42501/,
        );
      announcement = await operate(null, "save", 0, payload());
      await assert.rejects(
        actor(
          teacher,
          `select public.admin_announcement(${q(announcement.id)})`,
        ),
        /42501/,
      );
    },
  );
  await check(
    "Drafts stay private and revisions reject updates even before publication",
    async () => {
      assert.equal((await read()).items.length, 0);
      await assert.rejects(acknowledge(announcement.draft.id), /42501/);
      await assert.rejects(
        actor(
          teacher,
          `select public.announcement(${q(announcement.draft.id)})`,
        ),
        /42501/,
      );
      await assert.rejects(
        sql(
          `update private.announcement_revisions set body_de='Forbidden' where id=${q(announcement.draft.id)}`,
        ),
        /immutable/,
      );
      await assert.rejects(
        actor(teacher, "select * from private.announcement_revisions"),
        /permission denied/,
      );
    },
  );
  await check(
    "Publication and request retries deliver exactly once to actual current roles",
    async () => {
      const key = randomUUID();
      published = await operate(
        announcement.id,
        "publish",
        announcement.version,
        {},
        key,
      );
      assert.deepEqual(
        await operate(
          announcement.id,
          "publish",
          announcement.version,
          {},
          key,
        ),
        published,
      );
      const items = (await read()).items;
      assert.equal(items.length, 1);
      assert.equal(items[0].id, published.published.id);
      assert.equal(items[0].body_de, payload().body_de);
      const exact = JSON.parse(
        await actor(
          teacher,
          `select public.announcement(${q(published.published.id)})`,
        ),
      );
      assert.deepEqual(exact, items[0]);
      assert.ok(!Object.hasOwn(items[0], "draft_revision_id"));
      for (const who of [teacher, peer])
        assert.equal((await notices(published.published.id, who)).length, 1);
      for (const who of [client, learner]) {
        assert.equal((await read(who)).items.length, 0);
        assert.equal((await notices(published.published.id, who)).length, 0);
      }
      await assert.rejects(
        operate(announcement.id, "archive", announcement.version, {}, key),
        /idempotency conflict/,
      );
    },
  );
  await check(
    "Saving a new draft cannot mutate or expose the active published snapshot",
    async () => {
      const previous = (await read()).items[0];
      announcement = await operate(
        published.id,
        "save",
        published.version,
        payload({
          title_de: "Vertraulicher neuer Entwurf",
          body_de: "Unveröffentlichtes Geheimnis",
        }),
      );
      assert.notEqual(announcement.draft.id, published.published.id);
      assert.deepEqual((await read()).items[0], previous);
      assert.equal(JSON.stringify(await read()).includes("Geheimnis"), false);
      await assert.rejects(acknowledge(announcement.draft.id), /42501/);
      const fixtureNotice = randomUUID();
      await sql(
        `insert into public.notifications(id,user_id,kind,resource_id) values(${q(fixtureNotice)},${q(teacher)},'portal_announcement',${q(announcement.draft.id)})`,
      );
      const target = (await inbox(teacher)).items.find(
        (item) => item.id === fixtureNotice,
      );
      assert.equal(target.href, null);
      assert.equal(target.title, "");
      await sql(
        `delete from public.notifications where id=${q(fixtureNotice)}`,
      );
    },
  );
  await check(
    "ACK is own, server-confirmed and idempotent; a newly published revision resurfaces",
    async () => {
      const old = published.published.id,
        first = await acknowledge(old);
      assert.equal(await acknowledge(old), first);
      assert.equal((await read(teacher, "", true)).items.length, 0);
      assert.equal((await read(peer, "", true)).items.length, 1);
      assert.ok((await notices(old))[0].read_at);
      published = await operate(
        announcement.id,
        "publish",
        announcement.version,
      );
      assert.equal(
        (await read(teacher, "", true)).items[0].id,
        published.published.id,
      );
      assert.equal(
        await sql(
          `select count(*) from private.announcement_acknowledgements where user_id=${q(teacher)} and revision_id=${q(old)}`,
        ),
        "1",
      );
      const oldId = (await notices(old))[0].id,
        oldNotice = (await inbox(teacher)).items.find(
          (item) => item.id === oldId,
        );
      assert.equal(oldNotice.href, null);
      assert.equal(oldNotice.title, "");
    },
  );
  await check(
    "Concurrent saves with the same revision have one committed winner and one exact stale error",
    async () => {
      const current = await detail(published.id);
      const results = await Promise.allSettled([
        operate(
          current.id,
          "save",
          current.version,
          payload({ title_de: "Fiktiver Entwurf A" }),
        ),
        operate(
          current.id,
          "save",
          current.version,
          payload({ title_de: "Fiktiver Entwurf B" }),
        ),
      ]);
      assert.equal(
        results.filter((result) => result.status === "fulfilled").length,
        1,
      );
      const denied = results.find((result) => result.status === "rejected");
      assert.ok(denied);
      assert.match(denied.reason.message, /40001/);
      assert.equal((await detail(current.id)).version, current.version + 1);
      assert.equal((await read()).items[0].id, published.published.id);
    },
  );
  await check(
    "Archive/recover hides and restores the same publication without rebroadcasting or losing ACKs",
    async () => {
      let current = await detail(published.id);
      const revision = current.published.id,
        before = await notices(revision);
      const key = randomUUID();
      const archived = await operate(
        current.id,
        "archive",
        current.version,
        {},
        key,
      );
      assert.deepEqual(
        await operate(current.id, "archive", current.version, {}, key),
        archived,
      );
      assert.equal((await read()).items.length, 0);
      await assert.rejects(acknowledge(revision), /42501/);
      current = await operate(current.id, "recover", archived.version);
      assert.equal(current.published.id, revision);
      assert.equal((await read()).items[0].id, revision);
      assert.deepEqual(await notices(revision), before);
    },
  );
  await check(
    "Future publication is explicitly manual and a failed draft transaction leaves no parent or request",
    async () => {
      const future = await operate(
        null,
        "save",
        0,
        payload({
          important: false,
          starts_at: new Date(Date.now() + 86400000).toISOString(),
        }),
      );
      await assert.rejects(
        operate(future.id, "publish", future.version),
        /no scheduler is active/,
      );
      assert.deepEqual(await detail(future.id), future);
      const before = await sql(
          "select count(*) from private.portal_announcements",
        ),
        key = randomUUID();
      await assert.rejects(
        operate(null, "save", 0, payload({ body_de: "" }), key),
        /check constraint/,
      );
      assert.equal(
        await sql("select count(*) from private.portal_announcements"),
        before,
      );
      assert.equal(
        await sql(
          `select count(*) from private.announcement_requests where request_id=${q(key)}`,
        ),
        "0",
      );
      await assert.rejects(
        operate(null, "save", 0, payload({ audience_roles: ["superuser"] })),
        /22023/,
      );
      await assert.rejects(
        operate(null, "save", 0, payload({ time_zone: "Moon/Crater" })),
        /22023/,
      );
    },
  );
  await check(
    "A failing publication side effect rolls back state, history, notifications and audit, then the same key can retry",
    async () => {
      const draft = await operate(null, "save", 0, payload()),
        key = randomUUID();
      await sql(
        `create function private.fixture_reject_announcement() returns trigger language plpgsql as $$begin if new.kind='portal_announcement' and new.resource_id=${q(draft.draft.id)}::uuid then raise exception 'Fictional publication failure';end if;return new;end;$$;create trigger fixture_reject_announcement before insert on public.notifications for each row execute function private.fixture_reject_announcement()`,
      );
      try {
        await assert.rejects(
          operate(draft.id, "publish", draft.version, {}, key),
          /Fictional publication failure/,
        );
      } finally {
        await sql(
          "drop trigger fixture_reject_announcement on public.notifications;drop function private.fixture_reject_announcement()",
        );
      }
      assert.deepEqual(await detail(draft.id), draft);
      assert.equal(
        await sql(
          `select count(*) from private.announcement_publications where revision_id=${q(draft.draft.id)}`,
        ),
        "0",
      );
      assert.equal(
        await sql(
          `select count(*) from public.audit_events where action='announcement.published' and resource_id=${q(draft.id)}`,
        ),
        "0",
      );
      assert.deepEqual(await notices(draft.draft.id), []);
      const retried = await operate(
        draft.id,
        "publish",
        draft.version,
        {},
        key,
      );
      assert.equal(retried.published.id, draft.draft.id);
    },
  );
  await check(
    "Current database role loss and suspension revoke old-token read/ACK/notification destinations",
    async () => {
      const revision = published.published.id;
      await sql(
        `delete from public.user_roles where user_id=${q(teacher)};insert into public.user_roles(user_id,role) values(${q(teacher)},'client')`,
      );
      assert.ok(!(await read()).items.some((item) => item.id === revision));
      await assert.rejects(acknowledge(revision), /42501/);
      const noticeId = (await notices(revision))[0].id,
        target = (await inbox(teacher)).items.find(
          (item) => item.id === noticeId,
        );
      assert.equal(target.href, null);
      assert.equal(target.title, "");
      await sql(
        `delete from public.user_roles where user_id=${q(teacher)};insert into public.user_roles(user_id,role) values(${q(teacher)},'lecturer');update public.profiles set active=false where id=${q(teacher)}`,
      );
      await assert.rejects(read(), /42501/);
      await assert.rejects(acknowledge(revision), /42501/);
      await sql(
        `update public.profiles set active=true where id=${q(teacher)}`,
      );
    },
  );
  await check(
    "Quiet attention preserves important current publications and existing mandatory receipts without altering old category preferences",
    async () => {
      const now = new Date(),
        minute = now.getUTCHours() * 60 + now.getUTCMinutes(),
        clock = (value) =>
          `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
      const quiet = {
        enabled: true,
        // Keep the excluded minute roughly twelve hours away so a slow CI run
        // cannot cross the quiet-window boundary during this assertion.
        start_time: clock((minute + 720) % 1440),
        end_time: clock((minute + 719) % 1440),
        time_zone: "UTC",
      };
      await actor(
        client,
        `select public.save_attention_preferences(${q(JSON.stringify(quiet))}::jsonb,0)`,
      );
      await actor(
        client,
        `select public.save_notification_preferences('{"chat":false,"forum":false,"job_updates":false,"reminders":false}',1)`,
      );
      let draft = await operate(
        null,
        "save",
        0,
        payload({ audience_roles: ["client"] }),
      );
      draft = await operate(draft.id, "publish", draft.version);
      let page = await inbox(client);
      assert.equal(page.quiet_active, true);
      assert.equal(page.attention_count, 1);
      assert.equal(page.unread_count, 1);
      await acknowledge(draft.published.id, client);
      page = await inbox(client);
      assert.equal(page.attention_count, 0);
      assert.equal(page.items.length, 1);
      await sql(
        `insert into public.notifications(user_id,kind,resource_id) values(${q(client)},'contract_available',${q(randomUUID())})`,
      );
      page = await inbox(client);
      assert.equal(page.attention_count, 1);
      await operate(draft.id, "archive", draft.version);
      page = await inbox(client);
      assert.equal(page.attention_count, 1);
      assert.equal(
        JSON.parse(
          await actor(client, "select public.notification_preferences()"),
        ).chat,
        false,
      );
    },
  );
  await check(
    "Admin and ordinary pages use bounded stable tuple cursors and literal search",
    async () => {
      for (let i = 0; i < 5; i++) {
        let draft = await operate(
          null,
          "save",
          0,
          payload({
            title_de: `Fictional page ${i}`,
            title_en: `Fictional page ${i}`,
            important: false,
          }),
        );
        await operate(draft.id, "publish", draft.version);
      }
      let cursor = null;
      const found = [];
      do {
        const page = await read(teacher, "Fictional page", false, cursor, 2);
        assert.ok(page.items.length <= 2);
        found.push(...page.items.map((item) => item.id));
        cursor = page.next_cursor;
      } while (cursor);
      assert.equal(found.length, 5);
      assert.equal(new Set(found).size, 5);
      assert.equal((await read(teacher, "%")).items.length, 0);
      const adminPage = JSON.parse(
        await actor(
          admin,
          "select public.admin_announcements('Fictional page','published',null,null,2)",
          "aal1",
        ),
      );
      assert.equal(adminPage.items.length, 2);
      assert.equal(adminPage.has_more, true);
      assert.ok(adminPage.next_cursor);
      assert.ok(
        adminPage.items.every((item) => !Object.hasOwn(item, "body_de")),
      );
      await assert.rejects(
        actor(
          admin,
          "select public.admin_announcements('','',null,null,51)",
          "aal1",
        ),
        /22023/,
      );
    },
  );
  await check(
    "Actual display expiry hides publication and redacts its notice without deleting retained history",
    async () => {
      let draft = await operate(
        null,
        "save",
        0,
        payload({
          starts_at: new Date(Date.now() - 2000).toISOString(),
          ends_at: new Date(Date.now() + 1500).toISOString(),
        }),
      );
      draft = await operate(draft.id, "publish", draft.version);
      assert.ok(
        (await read()).items.some((item) => item.id === draft.published.id),
      );
      await sql("select pg_sleep(2)");
      assert.ok(
        !(await read()).items.some((item) => item.id === draft.published.id),
      );
      await assert.rejects(acknowledge(draft.published.id), /42501/);
      const noticeId = (await notices(draft.published.id))[0].id,
        notice = (await inbox(teacher)).items.find(
          (item) => item.id === noticeId,
        );
      assert.equal(notice.href, null);
      assert.equal(notice.title, "");
      assert.equal(
        await sql(
          `select count(*) from private.announcement_publications where revision_id=${q(draft.published.id)}`,
        ),
        "1",
      );
    },
  );
  await check(
    "A management write blocked behind a committed role withdrawal rechecks current permission before any resource mutation",
    async () => {
      const tag = `ann_revoke_${randomUUID().replaceAll("-", "")}`,
        writeTag = `ann_write_${randomUUID().replaceAll("-", "")}`;
      const before = await sql(
          "select count(*) from private.portal_announcements",
        ),
        key = randomUUID();
      const revoked = sql(
        `set application_name=${q(tag)};begin;select 1 from public.profiles where id=${q(manager)} for update;delete from public.user_roles where user_id=${q(manager)};insert into public.user_roles(user_id,role) values(${q(manager)},'lecturer');select pg_sleep(3);commit;`,
      );
      const barrier = async (name, event) => {
        for (let i = 0; i < 40; i++) {
          if (
            (await sql(
              `select count(*) from pg_stat_activity where application_name=${q(name)} and ${event}`,
            )) === "1"
          )
            return;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        throw new Error("Expected actual PostgreSQL barrier was not observed");
      };
      let writer;
      try {
        await barrier(tag, "wait_event='PgSleep'");
        writer = actor(
          manager,
          `set local application_name=${q(writeTag)};select public.manage_announcement(null,'save',0,${q(key)},${q(JSON.stringify(payload()))}::jsonb)`,
          "aal1",
        );
        // Attach a rejection handler before sampling the lock, preventing an
        // unhandled promise if the barrier transaction unexpectedly ends early.
        const settled = Promise.allSettled([revoked, writer]);
        await barrier(writeTag, "wait_event_type='Lock'");
        const results = await settled;
        assert.equal(results[0].status, "fulfilled");
        assert.equal(results[1].status, "rejected");
        assert.match(results[1].reason.message, /42501/);
      } finally {
        await Promise.allSettled([revoked, ...(writer ? [writer] : [])]);
      }
      assert.equal(
        await sql("select count(*) from private.portal_announcements"),
        before,
      );
      assert.equal(
        await sql(
          `select count(*) from private.announcement_requests where request_id=${q(key)}`,
        ),
        "0",
      );
      await sql(
        `delete from public.user_roles where user_id=${q(manager)};insert into public.user_roles(user_id,role) values(${q(manager)},'management')`,
      );
    },
  );
  await check(
    "An ACK blocked behind audience-role withdrawal cannot acknowledge or mark a private publication read afterward",
    async () => {
      const tag = `ann_ack_revoke_${randomUUID().replaceAll("-", "")}`,
        writeTag = `ann_ack_${randomUUID().replaceAll("-", "")}`,
        revision = published.published.id,
        before = await notices(revision);
      const revoked = sql(
        `set application_name=${q(tag)};begin;select 1 from public.profiles where id=${q(teacher)} for update;delete from public.user_roles where user_id=${q(teacher)};insert into public.user_roles(user_id,role) values(${q(teacher)},'client');select pg_sleep(3);commit;`,
      );
      const wait = async (name, event) => {
        for (let i = 0; i < 40; i++) {
          if (
            (await sql(
              `select count(*) from pg_stat_activity where application_name=${q(name)} and ${event}`,
            )) === "1"
          )
            return;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        throw new Error("Expected actual ACK barrier was not observed");
      };
      let writer;
      try {
        await wait(tag, "wait_event='PgSleep'");
        writer = actor(
          teacher,
          `set local application_name=${q(writeTag)};select public.acknowledge_announcement(${q(revision)})`,
        );
        const settled = Promise.allSettled([revoked, writer]);
        await wait(writeTag, "wait_event_type='Lock'");
        const results = await settled;
        assert.equal(results[0].status, "fulfilled");
        assert.equal(results[1].status, "rejected");
        assert.match(results[1].reason.message, /42501/);
      } finally {
        await Promise.allSettled([revoked, ...(writer ? [writer] : [])]);
      }
      assert.deepEqual(await notices(revision), before);
      assert.equal(
        await sql(
          `select count(*) from private.announcement_acknowledgements where user_id=${q(teacher)} and revision_id=${q(revision)}`,
        ),
        "0",
      );
      await sql(
        `delete from public.user_roles where user_id=${q(teacher)};insert into public.user_roles(user_id,role) values(${q(teacher)},'lecturer')`,
      );
    },
  );
  await check(
    "Anonymous execution, mutable private tables and internal helper invocation remain denied",
    async () => {
      for (const signature of [
        "private.immutable_announcement_snapshot()",
        "private.can_read_announcement_revision(uuid)",
        "private.announcement_admin_record(uuid)",
      ])
        assert.equal(
          await sql(
            `select has_function_privilege('authenticated',${q(signature)},'EXECUTE')`,
          ),
          "f",
        );
      assert.equal(
        await sql(
          "select has_function_privilege('anon','public.announcements(text,boolean,timestamptz,uuid,integer)','EXECUTE')",
        ),
        "f",
      );
      await assert.rejects(
        actor(teacher, "select * from private.portal_announcements"),
        /permission denied/,
      );
      const actions = JSON.parse(
        await actor(admin, "select public.admin_audit_events()", "aal1"),
      );
      assert.ok(actions.actions.includes("announcement.published"));
      assert.ok(
        actions.items
          .filter((item) => item.action.startsWith("announcement."))
          .every((item) => !Object.hasOwn(item, "details")),
      );
    },
  );
});
console.log(`${checks} announcement PostgreSQL groups passed.`);
