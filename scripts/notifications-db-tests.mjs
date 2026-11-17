/** Real isolated PostgreSQL: notification ownership, current links and preferences. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { withTestDatabase, quoteSql as q } from "./testing/database.mjs";

await withTestDatabase("notification_test", async ({ sql, actor }) => {
  const [teacher, peer, admin] = Array.from({ length: 3 }, randomUUID);
  /** Calls the business database API under the fixture's controlled identity/permission claims. */
  const rpc = async (who, name, args = []) => {
    const value = await actor(who, `select public.${name}(${args.join(",")})`);
    return JSON.parse(value);
  };
  let checks = 0;
  /** Counts and reports a case only after all of its assertions have completed successfully. */
  const check = async (name, run) => {
    await run();
    console.log(`PASS ${name}`);
    checks++;
  };
  await sql(`insert into auth.users(id,email) values ${[teacher, peer, admin].map((id) => `(${q(id)},${q(id + "@example.invalid")})`).join(",")};
    insert into public.user_roles(user_id,role) values(${q(teacher)},'lecturer'),(${q(peer)},'lecturer'),(${q(admin)},'admin');`);
  await check(
    "Existing and new profiles have independent enabled defaults",
    async () => {
      for (const id of [teacher, peer, admin])
        assert.deepEqual(await rpc(id, "notification_preferences"), {
          chat: true,
          forum: true,
          job_updates: true,
          reminders: true,
          version: 1,
        });
      assert.equal(
        await actor(
          teacher,
          `select count(*) from public.notifications where user_id=${q(peer)}`,
        ),
        "0",
      );
      await assert.rejects(
        actor(teacher, `select * from private.notification_preferences`),
        /permission denied/,
      );
    },
  );
  const own = randomUUID(),
    foreign = randomUUID();
  await sql(
    `insert into public.notifications(id,user_id,kind,resource_id) values(${q(own)},${q(teacher)},'activity',${q(randomUUID())}),(${q(foreign)},${q(peer)},'activity',${q(randomUUID())});`,
  );
  await check(
    "Inbox and administrator stay scoped to the current account",
    async () => {
      const inbox = await rpc(teacher, "notification_inbox");
      assert.equal(inbox.items.length, 1);
      assert.equal(inbox.items[0].id, own);
      assert.equal(inbox.items[0].href, null);
      assert.equal(inbox.unread_count, 1);
      assert.equal((await rpc(admin, "notification_inbox")).items.length, 0);
      await assert.rejects(
        actor(
          teacher,
          `select public.notification_inbox(false,'infinity',${q(own)},40)`,
        ),
        /22023/,
      );
    },
  );
  await check(
    "A mixed own/foreign read-state batch rolls back entirely",
    async () => {
      await assert.rejects(
        actor(
          teacher,
          `select public.mark_notifications(array[${q(own)}::uuid,${q(foreign)}::uuid],null,true)`,
        ),
        /42501/,
      );
      assert.equal((await rpc(teacher, "notification_inbox")).unread_count, 1);
      await rpc(teacher, "mark_notifications", [
        `array[${q(own)}::uuid]`,
        "null",
        "true",
      ]);
      assert.equal((await rpc(teacher, "notification_inbox")).unread_count, 0);
      await rpc(teacher, "mark_notifications", [
        `array[${q(own)}::uuid]`,
        "null",
        "false",
      ]);
      assert.equal((await rpc(teacher, "notification_inbox")).unread_count, 1);
    },
  );
  await check(
    "Snapshot mark-all never acknowledges a later arrival",
    async () => {
      const snapshot = await rpc(teacher, "notification_inbox");
      const later = randomUUID();
      await sql(
        `insert into public.notifications(id,user_id,kind,resource_id) values(${q(later)},${q(teacher)},'activity',${q(randomUUID())});`,
      );
      await rpc(teacher, "mark_notifications", [
        "null",
        q(snapshot.as_of),
        "true",
      ]);
      const unread = await rpc(teacher, "notification_inbox", ["true"]);
      assert.deepEqual(
        unread.items.map((item) => item.id),
        [later],
      );
    },
  );
  await check(
    "Concurrent preference updates have one winner and a stale-write error",
    async () => {
      const payload =
        q(
          JSON.stringify({
            chat: false,
            forum: false,
            job_updates: false,
            reminders: false,
          }),
        ) + "::jsonb";
      const results = await Promise.allSettled([
        actor(
          teacher,
          `select public.save_notification_preferences(${payload},1)`,
        ),
        actor(
          teacher,
          `select public.save_notification_preferences(${payload},1)`,
        ),
      ]);
      assert.equal(
        results.filter((result) => result.status === "fulfilled").length,
        1,
      );
      assert.match(
        results.find((result) => result.status === "rejected").reason.message,
        /40001/,
      );
      assert.equal((await rpc(teacher, "notification_preferences")).version, 2);
      assert.equal((await rpc(peer, "notification_preferences")).chat, true);
      await assert.rejects(
        actor(
          teacher,
          `select public.save_notification_preferences('{"chat":"false","forum":true,"job_updates":true,"reminders":true}',2)`,
        ),
        /22023/,
      );
    },
  );
  await check(
    "Disabled optional notifications stop future inserts while receipts remain",
    async () => {
      for (const kind of [
        "chat_message",
        "forum_reply",
        "job_reopened",
        "session_reminder",
        "contract_expiring",
        "claim_confirmed",
        "claim_cancelled",
      ])
        await sql(
          `insert into public.notifications(user_id,kind,resource_id) values(${q(teacher)},${q(kind)},${q(randomUUID())})`,
        );
      const kinds = (await rpc(teacher, "notification_inbox")).items.map(
        (item) => item.kind,
      );
      assert.ok(kinds.includes("claim_confirmed"));
      assert.ok(kinds.includes("claim_cancelled"));
      for (const kind of [
        "chat_message",
        "forum_reply",
        "job_reopened",
        "session_reminder",
        "contract_expiring",
      ])
        assert.ok(!kinds.includes(kind));
    },
  );
  await check(
    "Available-contract receipts stay mandatory and resolve only the recipient's own contract",
    async () => {
      const ownContract = randomUUID(),
        foreignContract = randomUUID();
      await sql(
        `insert into public.contracts(id,user_id,status,effective_from,version,title) values(${q(ownContract)},${q(teacher)},'active',now(),900,'Fictional newly available agreement'),(${q(foreignContract)},${q(peer)},'active',now(),900,'Fictional foreign private agreement');insert into public.notifications(user_id,kind,resource_id) values(${q(teacher)},'contract_available',${q(ownContract)}),(${q(teacher)},'contract_available',${q(foreignContract)})`,
      );
      // The preceding test disabled every optional category. A real contract
      // receipt must still be delivered; a forged resource never gains access.
      const preferences = await rpc(teacher, "notification_preferences");
      assert.equal(preferences.reminders, false);
      assert.equal(preferences.job_updates, false);
      const inbox = await rpc(teacher, "notification_inbox"),
        notices = inbox.items.filter(
          (item) => item.kind === "contract_available",
        );
      assert.equal(notices.length, 2);
      const actual = notices.find(
        (item) => item.title === "Fictional newly available agreement",
      );
      assert.equal(actual?.href, "/contracts");
      const foreign = notices.find((item) => item.id !== actual.id);
      assert.equal(foreign.href, null);
      assert.equal(foreign.title, "");
      assert.equal((await rpc(admin, "notification_inbox")).items.length, 0);
    },
  );
  await check(
    "Current chat authorization removes stale target links and titles",
    async () => {
      const room = await actor(teacher, `select public.create_dm(${q(peer)})`);
      await actor(
        teacher,
        `select public.send_message(${q(room)},'Fictional private message',${q(randomUUID())},null)`,
      );
      const before = await rpc(peer, "notification_inbox");
      const notice = before.items.find((item) => item.kind === "chat_message");
      assert.equal(notice.href, `/chats?room=${room}`);
      await sql(
        `update public.chat_members set removed_at=now() where room_id=${q(room)} and user_id=${q(peer)}`,
      );
      const revoked = (await rpc(peer, "notification_inbox")).items.find(
        (item) => item.id === notice.id,
      );
      assert.equal(revoked.href, null);
      assert.equal(revoked.title, "");
    },
  );
  await check(
    "Total unread count and stable cursors cover more than the displayed page",
    async () => {
      await sql(
        `insert into public.notifications(user_id,kind,resource_id) select ${q(admin)},'activity',gen_random_uuid() from generate_series(1,45);`,
      );
      const first = await rpc(admin, "notification_inbox", [
        "false",
        "null",
        "null",
        "20",
      ]);
      assert.equal(first.unread_count, 45);
      assert.equal(first.items.length, 20);
      const last = first.items.at(-1);
      const second = await rpc(admin, "notification_inbox", [
        "false",
        q(last.created_at),
        q(last.id),
        "20",
      ]);
      assert.equal(
        new Set([...first.items, ...second.items].map((item) => item.id)).size,
        40,
      );
      await assert.rejects(
        actor(admin, "select public.notification_inbox(false,null,null,1000)"),
        /22023/,
      );
    },
  );

  await check(
    "Actual reminder refresh respects 24-hour/30-day horizons, released history, ownership and dedup",
    async () => {
      await actor(
        teacher,
        `select public.save_notification_preferences('{"chat":true,"forum":true,"job_updates":true,"reminders":true}',2)`,
      );
      const dueSession = randomUUID(),
        releasedSession = randomUUID(),
        dueContract = randomUUID();
      /** Creates controlled confirmed or released allocations for notification/reminder checks. */
      const seedSession = async (id, who, start, end, released = false) => {
        const job = randomUUID(),
          claim = randomUUID();
        await sql(
          `insert into public.jobs(id,title,customer_name,delivery_type,status,amount,currency,rate_unit,total_amount,terms) values(${q(job)},'Fictional reminder course','Fictional reminder client','online','filled',100,'EUR','fixed_total',100,'Fictional reminder terms');insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,amount,currency,rate_unit,total_amount,terms,terms_version) values(${q(claim)},${q(job)},${q(who)},${q(randomUUID())},100,'EUR','fixed_total',100,'Fictional reminder terms',1);insert into public.assignment_sessions(id,claim_id,lecturer_id,starts_at,ends_at,released_at) values(${q(id)},${q(claim)},${q(who)},${start},${end},${released ? "now()" : "null"})`,
        );
      };
      await seedSession(
        dueSession,
        teacher,
        "now()+interval '2 hours'",
        "now()+interval '3 hours'",
      );
      await seedSession(
        randomUUID(),
        teacher,
        "now()+interval '26 hours'",
        "now()+interval '27 hours'",
      );
      await seedSession(
        randomUUID(),
        teacher,
        "now()-interval '2 hours'",
        "now()-interval '1 hour'",
      );
      await seedSession(
        releasedSession,
        teacher,
        "now()+interval '4 hours'",
        "now()+interval '5 hours'",
        true,
      );
      await seedSession(
        randomUUID(),
        peer,
        "now()+interval '2 hours'",
        "now()+interval '3 hours'",
      );
      await sql(
        `insert into public.contracts(id,user_id,status,effective_from,expires_at,version,title,revoked_at) values(${q(dueContract)},${q(teacher)},'active',now()-interval '1 day',now()+interval '29 days',1,'PRIVATE fictional expiring agreement',null),(${q(randomUUID())},${q(teacher)},'active',now()-interval '1 day',now()+interval '31 days',2,'Outside horizon',null),(${q(randomUUID())},${q(teacher)},'active',now()-interval '1 day',now()+interval '10 days',3,'Revoked agreement',now()),(${q(randomUUID())},${q(teacher)},'active',now()+interval '1 day',now()+interval '10 days',4,'Future agreement',null),(${q(randomUUID())},${q(peer)},'active',now()-interval '1 day',now()+interval '5 days',1,'Peer private agreement',null)`,
      );
      assert.equal(await rpc(teacher, "refresh_my_notifications"), 2);
      const reminders = (await rpc(teacher, "notification_inbox")).items.filter(
        (item) => ["session_reminder", "contract_expiring"].includes(item.kind),
      );
      assert.deepEqual(
        JSON.parse(
          await sql(
            `select jsonb_agg(resource_id order by resource_id) from public.notifications where user_id=${q(teacher)} and kind in('session_reminder','contract_expiring')`,
          ),
        ).sort(),
        [dueSession, dueContract].sort(),
      );
      assert.ok(reminders.every((item) => item.href));
      assert.equal(reminders.length, 2);
      assert.equal(await rpc(teacher, "refresh_my_notifications"), 0);
      await sql(
        `update private.notification_preferences set last_refresh_at=now()-interval '2 minutes' where user_id=${q(teacher)}`,
      );
      assert.equal(await rpc(teacher, "refresh_my_notifications"), 0);
      const foreignNotice = randomUUID(),
        releasedNotice = randomUUID();
      await sql(
        `insert into public.notifications(id,user_id,kind,resource_id) values(${q(foreignNotice)},${q(peer)},'contract_expiring',${q(dueContract)}),(${q(releasedNotice)},${q(teacher)},'session_reminder',${q(releasedSession)})`,
      );
      const staleLink = (await rpc(teacher, "notification_inbox")).items.find(
        (item) => item.id === releasedNotice,
      );
      assert.equal(staleLink.href, null);
      assert.equal(staleLink.title, "");
      const foreignLink = (await rpc(peer, "notification_inbox")).items.find(
        (item) => item.id === foreignNotice,
      );
      assert.equal(foreignLink.href, null);
      assert.equal(foreignLink.title, "");
    },
  );
  const matchingTopicA = randomUUID(),
    matchingTopicB = randomUUID(),
    matchingOwner = randomUUID(),
    matchingAdmin = randomUUID(),
    expiringLecturer = randomUUID();
  await check(
    "Deferred publication observes final requirements, course-end expiry and committed lecturer-capable roles",
    async () => {
      await sql(
        `insert into public.topics(id,label_de,label_en,kind) values(${q(matchingTopicA)},'Fictional matching A','Fictional matching A','topic'),(${q(matchingTopicB)},'Fictional matching B','Fictional matching B','topic');insert into public.lecturer_topics(user_id,topic_id,verified,valid_until) values(${q(teacher)},${q(matchingTopicA)},true,null),(${q(teacher)},${q(matchingTopicB)},true,now()+interval '1 year'),(${q(peer)},${q(matchingTopicA)},true,null),(${q(peer)},${q(matchingTopicB)},false,null)`,
      );
      await sql(
        `insert into auth.users(id,email) values(${q(matchingOwner)},'matching-owner@example.invalid'),(${q(matchingAdmin)},'matching-admin@example.invalid'),(${q(expiringLecturer)},'matching-expiring@example.invalid');insert into public.user_roles(user_id,role) values(${q(matchingOwner)},'owner'),(${q(matchingAdmin)},'admin'),(${q(expiringLecturer)},'lecturer');insert into public.lecturer_topics(user_id,topic_id,verified,valid_until) select people.id,topic.id,true,case when people.id=${q(expiringLecturer)}::uuid then now()+interval '1 day' else null end from (values(${q(matchingOwner)}::uuid),(${q(matchingAdmin)}::uuid),(${q(expiringLecturer)}::uuid))people(id) cross join (values(${q(matchingTopicA)}::uuid),(${q(matchingTopicB)}::uuid))topic(id)`,
      );
      const job = randomUUID();
      await sql(
        `begin;insert into public.jobs(id,title,customer_name,delivery_type,status,amount,currency,rate_unit,total_amount,terms,created_by) values(${q(job)},'Final requirements job','Fictional matching client','online','published',100,'EUR','fixed_total',100,'Fictional matching terms',${q(admin)});insert into public.job_sessions(job_id,starts_at,ends_at) values(${q(job)},now()+interval '30 days',now()+interval '30 days 1 hour');insert into public.job_requirements(job_id,topic_id) values(${q(job)},${q(matchingTopicA)}),(${q(job)},${q(matchingTopicB)});commit`,
      );
      assert.deepEqual(
        JSON.parse(
          await sql(
            `select jsonb_agg(user_id order by user_id) from public.notifications where kind='job_matching' and resource_id=${q(job)}`,
          ),
        ),
        [teacher, matchingOwner, matchingAdmin].sort(),
      );
      await sql(
        `update public.jobs set status='draft' where id=${q(job)};update public.jobs set status='published' where id=${q(job)}`,
      );
      assert.equal(
        await sql(
          `select count(*) from public.notifications where kind='job_matching' and resource_id=${q(job)}`,
        ),
        "3",
      );
    },
  );
  await check(
    "Partial claims and semantic no-op updates do not repeat matching-notification fanout",
    async () => {
      // Test-only instrumentation counts real INSERT attempts BEFORE preference
      // filtering and ON CONFLICT. Counting stored rows would hide wasted scans.
      await sql(
        `create table public.test_matching_attempts(n integer not null);insert into public.test_matching_attempts values(0);create function public.test_count_matching_attempt() returns trigger language plpgsql security definer set search_path='' as $$begin if new.kind='job_matching' then update public.test_matching_attempts set n=n+1;end if;return new;end$$;create trigger aaa_test_matching_attempt before insert on public.notifications for each row execute function public.test_count_matching_attempt()`,
      );
      try {
        const job = await actor(
          admin,
          `select public.create_capacity_job(${q(JSON.stringify({ title: "Fictional fanout instrumentation", customer_name: "Fictional fanout client", delivery_type: "online", status: "published", amount: 100, total_amount: 100, currency: "EUR", rate_unit: "fixed_total", terms: "Fictional per-position terms", topic_ids: [matchingTopicA], sessions: [{ starts_at: "2068-02-01T08:00:00Z", ends_at: "2068-02-01T09:00:00Z" }] }))}::jsonb,3,${q(randomUUID())})`,
          "aal1",
        );
        assert.ok(
          Number(await sql("select n from public.test_matching_attempts")) > 0,
          "Initial deferred publication still fans out using final requirements",
        );
        await sql("update public.test_matching_attempts set n=0");
        const confirmed = await rpc(matchingOwner, "claim_job", [
          q(job),
          q(randomUUID()),
          "1",
        ]);
        assert.equal(confirmed.status, "confirmed");
        assert.equal(
          await sql(`select status from public.jobs where id=${q(job)}`),
          "published",
        );
        assert.equal(
          await sql("select n from public.test_matching_attempts"),
          "0",
          "A committed partial claim does not retry a publication broadcast",
        );
        await sql(
          `update public.jobs set capacity=capacity,status=status where id=${q(job)};update public.job_requirements set topic_id=topic_id where job_id=${q(job)}`,
        );
        assert.equal(
          await sql("select n from public.test_matching_attempts"),
          "0",
          "No-op job/requirement writes do not fan out",
        );
        await sql(
          `update public.jobs set claim_deadline='2068-01-31T08:00:00Z' where id=${q(job)}`,
        );
        assert.ok(
          Number(await sql("select n from public.test_matching_attempts")) > 0,
          "Meaningful deadline changes still re-evaluate matching",
        );
        await sql("update public.test_matching_attempts set n=0");
        await sql(
          `insert into public.job_requirements(job_id,topic_id)values(${q(job)},${q(matchingTopicB)})`,
        );
        assert.ok(
          Number(await sql("select n from public.test_matching_attempts")) > 0,
          "Meaningful qualification changes still re-evaluate matching",
        );
      } finally {
        await sql(
          "drop trigger aaa_test_matching_attempt on public.notifications;drop function public.test_count_matching_attempt();drop table public.test_matching_attempts",
        );
      }
    },
  );
  await check(
    "A later failure rolls back even matching notices already fired by an immediate constraint check",
    async () => {
      const job = randomUUID();
      await assert.rejects(
        sql(
          `begin;insert into public.jobs(id,title,customer_name,delivery_type,status,amount,currency,rate_unit,total_amount,terms,created_by) values(${q(job)},'Rollback matching job','Fictional matching client','online','published',100,'EUR','fixed_total',100,'Fictional matching terms',${q(admin)});insert into public.job_sessions(job_id,starts_at,ends_at) values(${q(job)},now()+interval '40 days',now()+interval '40 days 1 hour');insert into public.job_requirements(job_id,topic_id) values(${q(job)},${q(matchingTopicA)}),(${q(job)},${q(matchingTopicB)});set constraints all immediate;do $$begin if not exists(select 1 from public.notifications where kind='job_matching' and resource_id=${q(job)} and user_id=${q(teacher)})then raise exception 'Expected an actual in-transaction notice';end if;end$$;select 1/0;commit`,
        ),
        /division by zero/,
      );
      assert.equal(
        await sql(`select count(*) from public.jobs where id=${q(job)}`),
        "0",
      );
      assert.equal(
        await sql(
          `select count(*) from public.notifications where resource_id=${q(job)}`,
        ),
        "0",
      );
    },
  );
  await check(
    "Disabled optional delivery still retains a real committed claim receipt",
    async () => {
      await actor(
        teacher,
        `select public.save_notification_preferences('{"chat":false,"forum":false,"job_updates":false,"reminders":false}',3)`,
      );
      const job = await actor(
        admin,
        `select public.create_job(${q(JSON.stringify({ title: "Critical receipt course", customer_name: "Fictional receipt client", delivery_type: "online", status: "published", amount: 100, total_amount: 100, currency: "EUR", rate_unit: "fixed_total", terms: "Immutable receipt terms", sessions: [{ starts_at: "2069-01-01T08:00:00Z", ends_at: "2069-01-01T09:00:00Z" }] }))}::jsonb)`,
        "aal1",
      );
      const accepted = await rpc(teacher, "claim_job", [
        q(job),
        q(randomUUID()),
        "1",
      ]);
      assert.equal(accepted.status, "confirmed");
      assert.equal(
        await sql(
          `select count(*) from public.notifications where user_id=${q(teacher)} and kind='claim_confirmed' and resource_id=${q(accepted.claim_id)}`,
        ),
        "1",
      );
      assert.equal(
        await sql(
          `select count(*) from public.notifications where user_id=${q(teacher)} and kind='job_matching' and resource_id=${q(job)}`,
        ),
        "0",
      );
      assert.equal(await rpc(teacher, "refresh_my_notifications"), 0);
    },
  );
  await check(
    "Inactive actors and anonymous calls cannot read or mutate preferences",
    async () => {
      await sql(
        `update public.profiles set active=false where id=${q(teacher)}`,
      );
      for (const statement of [
        "select public.notification_preferences()",
        "select public.notification_inbox()",
        "select public.refresh_my_notifications()",
      ])
        await assert.rejects(actor(teacher, statement), /42501/);
      assert.equal(
        await sql(
          "select has_function_privilege('anon','public.notification_inbox(boolean,timestamptz,uuid,integer)','execute')",
        ),
        "f",
      );
    },
  );
  console.log(`${checks} notification PostgreSQL checks passed.`);
});
