/** Real PostgreSQL global publication/CAS/paging/current-role transactions. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { withTestDatabase, quoteSql as q } from "./testing/database.mjs";
let groups = 0;
await withTestDatabase("calendar_global", async ({ sql, actor }) => {
  const admin = randomUUID(),
    manager = randomUUID(),
    teacher = randomUUID(),
    peer = randomUUID(),
    learner = randomUUID(),
    client = randomUUID();
  await sql(
    `insert into auth.users(id,email)values${[admin, manager, teacher, peer, learner, client].map((id, i) => `(${q(id)},'global-${i}@example.invalid')`).join(",")};insert into public.user_roles(user_id,role)values('${admin}','admin'),('${manager}','management'),('${teacher}','lecturer'),('${peer}','lecturer'),('${learner}','participant'),('${client}','client')`,
  );
  const body = {
    title: "Fictional publication %_",
    description: "Fictional <script> plain description",
    link_url: "https://example.invalid/course?q=1#part",
    starts_at: "2060-03-28T00:30:00Z",
    ends_at: "2060-03-28T02:30:00Z",
    time_zone: "Europe/Berlin",
  };
  const mutate = (
    id,
    action,
    version,
    payload = {},
    key = randomUUID(),
    who = admin,
    aal = "aal1",
  ) =>
    actor(
      who,
      `select public.manage_global_event(${id ? q(id) : "null"},${q(action)},${version},${q(key)},${q(JSON.stringify(payload))}::jsonb)`,
      aal,
    ).then(JSON.parse);
  const list = (
    who = teacher,
    manage = false,
    from = "2060-03-01T00:00Z",
    to = "2060-04-10T00:00Z",
    extra = "",
  ) =>
    actor(
      who,
      `select public.global_calendar_events(${q(from)},${q(to)},${manage}${extra})`,
      "aal1",
    ).then(JSON.parse);
  const check = async (name, run) => {
    await run();
    groups++;
    console.log("PASS " + name);
  };
  let event;
  await check(
    "Current courses.manage permission authorizes password-only admins; active ordinary accounts receive only explicit publications",
    async () => {
      for (const who of [teacher, peer, learner, client])
        await assert.rejects(
          mutate(null, "save", 0, body, randomUUID(), who),
          /42501/,
        );
      event = await mutate(null, "save", 0, body);
      for (const who of [teacher, client])
        assert.equal((await list(who)).items.length, 0);
      await assert.rejects(list(learner), /Calendar access denied/);
      assert.equal((await list(admin, true)).items[0].id, event.id);
      assert.equal(
        await actor(
          teacher,
          `select count(*) from public.global_events where id='${event.id}'`,
        ),
        "0",
      );
      await assert.rejects(list(teacher, true), /42501/);
    },
  );
  await check(
    "Idempotency binds content, preserves one audit and exact CAS blocks stale operations",
    async () => {
      const key = randomUUID();
      const saved = await mutate(
        null,
        "save",
        0,
        { ...body, title: "Fictional idempotent draft" },
        key,
      );
      assert.deepEqual(
        await mutate(
          null,
          "save",
          0,
          { ...body, title: "Fictional idempotent draft" },
          key,
        ),
        saved,
      );
      await assert.rejects(
        mutate(null, "save", 0, { ...body, title: "Changed" }, key),
        /22023/,
      );
      assert.equal(
        await sql(
          `select count(*) from public.audit_events where resource_id='${saved.id}'`,
        ),
        "1",
      );
      event = await mutate(event.id, "publish", event.version);
      assert.equal((await list()).items[0].description, body.description);
      await assert.rejects(mutate(event.id, "archive", 1), /40001/);
      assert.equal((await list()).items[0].id, event.id);
    },
  );
  await check(
    "Edit withdraws publication; archives retain identity and recover only as draft",
    async () => {
      event = await mutate(event.id, "save", event.version, {
        ...body,
        description: "Fictional unpublished replacement",
      });
      assert.equal(event.published, false);
      assert.equal((await list()).items.length, 0);
      event = await mutate(event.id, "publish", event.version);
      assert.equal(
        (await list()).items[0].description,
        "Fictional unpublished replacement",
      );
      event = await mutate(event.id, "unpublish", event.version);
      assert.equal((await list()).items.length, 0);
      event = await mutate(event.id, "archive", event.version);
      await assert.rejects(mutate(event.id, "publish", event.version), /22023/);
      event = await mutate(event.id, "recover", event.version);
      assert.equal(event.archived_at, null);
      assert.equal(event.published, false);
    },
  );
  await check(
    "Closed payloads, finite intervals, explicit offsets, IANA zones and HTTPS links reject invalid writes atomically",
    async () => {
      for (const patch of [
        { title: "" },
        { time_zone: "Fake/Zone" },
        { starts_at: "infinity" },
        { ends_at: body.starts_at },
        { starts_at: "2060-03-28T00:30:00" },
        { user_id: peer },
        { link_url: "javascript:alert(1)" },
        { link_url: "http://example.invalid" },
        { link_url: "https://name:secret@example.invalid" },
        { link_url: "https://example.invalid\\@evil.invalid" },
        { link_url: "https://example.invalid:99999/" },
        { link_url: "https://999.999.999.999/" },
        { link_url: "https://example..invalid/" },
        { link_url: "https://example.invalid/\nsecret" },
      ])
        await assert.rejects(
          mutate(event.id, "save", event.version, { ...body, ...patch }),
          /22023/,
        );
      assert.equal(
        (await list(admin, true)).items.find((x) => x.id === event.id).version,
        event.version,
      );
      assert.equal(
        await sql(
          `select bool_and(details='{}'::jsonb) from public.audit_events where action like 'calendar.global_%'`,
        ),
        "t",
      );
    },
  );
  await check(
    "More than1000 same-timestamp events page completely, literally and with bounded validated ranges",
    async () => {
      await sql(
        `insert into public.global_events(id,title,starts_at,ends_at,published,updated_at)select('c8000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Fictional page %_ '||n,'2060-03-28T08:00Z','2060-03-28T09:00Z',true,'2040-01-01T00:00Z' from generate_series(1,1005)n`,
      );
      const seen = [];
      let cursor = null;
      do {
        const page = await list(
          teacher,
          false,
          undefined,
          undefined,
          `, 'page %_',${cursor ? q(cursor.at) : "null"},${cursor ? q(cursor.id) : "null"},100`,
        );
        seen.push(...page.items.map((x) => x.id));
        assert.ok(page.items.length <= 100);
        assert.equal(page.has_more, Boolean(page.next_cursor));
        cursor = page.next_cursor;
      } while (cursor);
      assert.equal(seen.length, 1005);
      assert.equal(new Set(seen).size, 1005);
      assert.deepEqual(seen, [...seen].sort().reverse());
      assert.equal(
        (await list(teacher, false, undefined, undefined, `, 'page %X_'`)).items
          .length,
        0,
      );
      for (const [from, to, extra] of [
        ["infinity", "2060-04-01T00:00Z", ""],
        ["2060-01-01", "2061-01-01", ""],
        ["2060-04-01", "2060-03-01", ""],
        ["2060-03-01", "2060-04-01", `, '',null,null,101`],
        ["2060-03-01", "2060-04-01", `, '',null,'${randomUUID()}',50`],
      ])
        await assert.rejects(list(teacher, false, from, to, extra), /22023/);
      assert.equal(
        (await list(teacher, false, "2060-03-28T09:00Z", "2060-03-28T10:00Z"))
          .items.length,
        0,
        "End is exclusive",
      );
    },
  );
  await check(
    "Competing managers commit exactly one CAS update without overwriting accepted version",
    async () => {
      const result = await Promise.allSettled([
        mutate(event.id, "save", event.version, {
          ...body,
          title: "Manager A",
        }),
        mutate(
          event.id,
          "save",
          event.version,
          { ...body, title: "Manager B" },
          randomUUID(),
          manager,
        ),
      ]);
      assert.equal(result.filter((r) => r.status === "fulfilled").length, 1);
      assert.match(
        result.find((r) => r.status === "rejected").reason.message,
        /40001/,
      );
    },
  );
  await check(
    "Role withdrawal wins before a waiting write; fresh authorization follows profile lock",
    async () => {
      const label = "global_event_role_revocation";
      const revoke = Promise.allSettled([
        actor(
          admin,
          `select set_config('application_name','${label}',true);select public.set_account_roles('${manager}',array['participant']);select pg_sleep(2)`,
          "aal1",
        ),
      ]);
      const wait = async (condition) => {
        for (let n = 0; n < 70; n++) {
          if ((await sql(condition)) === "t") return;
          await new Promise((r) => setTimeout(r, 20));
        }
        assert.fail("Controlled barrier not reached");
      };
      await wait(
        `select exists(select 1 from pg_stat_activity where datname=current_database()and application_name='${label}'and wait_event='PgSleep')`,
      );
      const save = Promise.allSettled([
        actor(
          manager,
          `select set_config('application_name','${label}_waiting',true);select public.manage_global_event(null,'save',0,'${randomUUID()}',${q(JSON.stringify({ ...body, title: "Forbidden after revocation" }))})`,
          "aal1",
        ),
      ]);
      await wait(
        `select exists(select 1 from pg_stat_activity where datname=current_database()and application_name='${label}_waiting'and wait_event_type='Lock')`,
      );
      assert.equal((await revoke)[0].status, "fulfilled");
      const result = (await save)[0];
      assert.equal(result.status, "rejected");
      assert.match(result.reason.message, /42501/);
      assert.equal(
        await sql(
          "select count(*)from public.global_events where title='Forbidden after revocation'",
        ),
        "0",
      );
    },
  );
  await check(
    "Audit projection preserves prior actions and exposes only five safe calendar action metadata families",
    async () => {
      const actions = [
        "calendar.global_save",
        "calendar.global_publish",
        "calendar.global_unpublish",
        "calendar.global_archive",
        "calendar.global_recover",
      ];
      for (const action of actions) {
        const result = JSON.parse(
          await actor(
            admin,
            `select public.admin_audit_events(p_action=>${q(action)})`,
            "aal1",
          ),
        );
        assert.ok(result.items.length > 0);
        assert.ok(
          result.items.every(
            (item) =>
              item.action === action &&
              !("details" in item) &&
              !("description" in item) &&
              !("link_url" in item),
          ),
        );
        for (const prior of [
          "announcement.draft_saved",
          "announcement.published",
          "announcement.archived",
          "announcement.recovered",
          "qualification.attested",
          "taxonomy.created",
        ])
          assert.ok(result.actions.includes(prior));
      }
      assert.equal(
        await sql(
          "select has_function_privilege('authenticated','private.admin_audit_actions()','execute')",
        ),
        "f",
      );
    },
  );
  await check(
    "Personal events remain private, old suspended sessions deny reads and internal helper has no EXECUTE",
    async () => {
      await actor(
        teacher,
        "insert into public.personal_events(user_id,title,starts_at,ends_at)values(auth.uid(),'PRIVATE calendar marker','2060-03-28T08:00Z','2060-03-28T09:00Z')",
      );
      assert.equal(
        await actor(
          admin,
          `select count(*)from public.personal_events where user_id='${teacher}'`,
          "aal1",
        ),
        "0",
      );
      assert.ok(
        !(await list(admin, true)).items.some((x) =>
          x.title.includes("PRIVATE"),
        ),
      );
      await sql(`update public.profiles set active=false where id='${peer}'`);
      await assert.rejects(list(peer), /42501/);
      assert.equal(
        await sql(
          "select has_function_privilege('authenticated','private.valid_global_event_link(text)','execute')",
        ),
        "f",
      );
      assert.equal(
        await sql(
          "select has_function_privilege('anon','public.manage_global_event(uuid,text,int,uuid,jsonb)','execute')",
        ),
        "f",
      );
      await assert.rejects(
        actor(teacher, "select *from private.global_event_requests"),
        /permission denied/,
      );
    },
  );
});
console.log(`${groups} global-calendar PostgreSQL groups passed.`);
