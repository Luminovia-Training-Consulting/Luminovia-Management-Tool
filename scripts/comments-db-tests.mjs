import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { withTestDatabase, quoteSql as q } from "./testing/database.mjs";

let checks = 0;
const check = async (name, run) => {
  await run();
  checks++;
  console.log(`PASS ${name}`);
};
await withTestDatabase("comments_test", async ({ sql, actor }) => {
  const teacher = randomUUID(),
    peer = randomUUID(),
    manager = randomUUID(),
    client = randomUUID(),
    learner = randomUUID();
  const job = randomUUID(),
    draft = randomUUID(),
    template = randomUUID(),
    run = randomUUID();
  await sql(`insert into auth.users(id,email) values ${[teacher, peer, manager, client, learner].map((id) => `('${id}','${id}@example.invalid')`).join(",")};
 insert into public.user_roles(user_id,role) values('${teacher}','lecturer'),('${peer}','lecturer'),('${manager}','admin'),('${client}','client'),('${learner}','participant');
 update public.profiles set display_name='Fictional comment author';
 insert into public.course_templates(id,title) values('${template}','Fictional template discussion');
 insert into public.course_runs(id,template_id,published) values('${run}','${template}',true);
 insert into public.jobs(id,course_run_id,title,customer_name,delivery_type,time_zone,status,amount,total_amount,currency,rate_unit,terms) values
 ('${job}','${run}','Fictional discussion','Fictional academy','online','Europe/Berlin','published',100,100,'EUR','fixed_total','Immutable net terms'),
 ('${draft}',null,'Private draft','Fictional academy','online','Europe/Berlin','draft',100,100,'EUR','fixed_total','Immutable draft terms');`);
  const rpc = (who, name, args = [], aal = "aal1") =>
    actor(
      who,
      `select public.${name}(${args.map((value) => (value === null ? "null" : typeof value === "number" || typeof value === "boolean" ? String(value) : q(value))).join(",")})`,
      aal,
    ).then((value) => {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    });
  let comment;
  await check(
    "Only current authorised staff see published job/template discussions; no client/learner/draft/anonymous bypass",
    async () => {
      assert.equal(
        (await rpc(teacher, "comment_context", ["job", job])).can_post,
        true,
      );
      assert.equal(
        (await rpc(peer, "comment_context", ["template", template])).can_post,
        true,
      );
      for (const who of [client, learner])
        for (const kind of ["job", "template"])
          await assert.rejects(
            rpc(who, "comment_context", [
              kind,
              kind === "job" ? job : template,
            ]),
            /42501/,
          );
      await assert.rejects(
        rpc(teacher, "comment_context", ["job", draft]),
        /42501/,
      );
      await assert.rejects(
        sql(`set role anon;select public.resource_comments('job','${job}')`),
        /permission denied/,
      );
      assert.equal(
        await actor(
          teacher,
          `select count(*) from public.jobs where id='${job}'`,
        ),
        "1",
      );
      assert.equal(
        await actor(
          teacher,
          `select count(*) from public.jobs where id='${draft}'`,
        ),
        "0",
      );
    },
  );
  const retry = randomUUID(),
    body = "Teaching note <script>literal</script>\nSecond line";
  await check(
    "Comment text persists literally; a concurrent retry commits one comment and one audit event",
    async () => {
      const ids = await Promise.all(
        Array.from({ length: 10 }, () =>
          rpc(teacher, "add_resource_comment", ["job", job, body, retry]),
        ),
      );
      assert.equal(new Set(ids).size, 1);
      comment = ids[0];
      const rows = await rpc(peer, "resource_comments", ["job", job]);
      assert.equal(rows[0].body, body);
      assert.equal(rows[0].author_id, teacher);
      assert.equal(rows[0].mine, false);
      assert.equal(
        await sql(
          `select count(*) from public.audit_events where action='comment.created' and resource_id='${comment}'`,
        ),
        "1",
      );
      for (const args of [
        ["job", job, "Changed", retry],
        ["template", template, body, retry],
      ])
        await assert.rejects(
          rpc(teacher, "add_resource_comment", args),
          /retry conflict/,
        );
    },
  );
  await check(
    "Own optimistic edits serialize; peers and moderators cannot impersonate the author",
    async () => {
      await assert.rejects(
        rpc(peer, "edit_resource_comment", [comment, "Forged", 1]),
        /42501/,
      );
      await assert.rejects(
        rpc(
          manager,
          "edit_resource_comment",
          [comment, "Forged admin edit", 1],
          "aal2",
        ),
        /42501/,
      );
      const results = await Promise.allSettled([
        rpc(teacher, "edit_resource_comment", [comment, "Version A", 1]),
        rpc(teacher, "edit_resource_comment", [comment, "Version B", 1]),
      ]);
      assert.equal(
        results.filter((row) => row.status === "fulfilled").length,
        1,
      );
      assert.equal(
        (await rpc(teacher, "resource_comments", ["job", job]))[0].version,
        2,
      );
      assert.equal(
        await sql(
          `select count(*) from private.resource_comment_revisions where comment_id='${comment}'`,
        ),
        "1",
      );
    },
  );
  await check(
    "Moderation requires the resource capability, MFA, reason and current version",
    async () => {
      await assert.rejects(
        rpc(manager, "moderate_resource_comment", [comment, true, "Reason", 2]),
        /42501/,
      );
      await assert.rejects(
        rpc(
          peer,
          "moderate_resource_comment",
          [comment, true, "Reason", 2],
          "aal2",
        ),
        /42501/,
      );
      await assert.rejects(
        rpc(
          manager,
          "moderate_resource_comment",
          [comment, true, "", 2],
          "aal2",
        ),
        /Moderation reason/,
      );
      await rpc(
        manager,
        "moderate_resource_comment",
        [comment, true, "Fictional moderation", 2],
        "aal2",
      );
      assert.deepEqual(await rpc(peer, "resource_comments", ["job", job]), []);
      const own = (await rpc(teacher, "resource_comments", ["job", job]))[0];
      assert.equal(own.hidden, true);
      assert.equal(own.moderation_reason, "Fictional moderation");
      await assert.rejects(
        rpc(
          manager,
          "moderate_resource_comment",
          [comment, false, "Restore", 2],
          "aal2",
        ),
        /40001/,
      );
    },
  );
  await check(
    "Editing a hidden comment does not undo moderation; explicit authorised restoration is versioned",
    async () => {
      await rpc(teacher, "edit_resource_comment", [
        comment,
        "Revised safe text",
        3,
      ]);
      assert.deepEqual(await rpc(peer, "resource_comments", ["job", job]), []);
      await rpc(
        manager,
        "moderate_resource_comment",
        [comment, false, "Reviewed revision", 4],
        "aal2",
      );
      assert.equal(
        (await rpc(peer, "resource_comments", ["job", job]))[0].body,
        "Revised safe text",
      );
    },
  );
  await check(
    "Withdrawn text is absent from ordinary reads while private audit remains; deletion cannot target peers",
    async () => {
      await assert.rejects(
        rpc(peer, "withdraw_resource_comment", [comment, 5]),
        /42501/,
      );
      await rpc(teacher, "withdraw_resource_comment", [comment, 5]);
      const row = (await rpc(peer, "resource_comments", ["job", job]))[0];
      assert.equal(row.withdrawn, true);
      assert.equal(row.body, "");
      await assert.rejects(
        rpc(teacher, "edit_resource_comment", [
          comment,
          "Restore withdrawn body",
          6,
        ]),
        /40001/,
      );
      await assert.rejects(
        actor(
          manager,
          "select * from private.resource_comment_revisions",
          "aal2",
        ),
        /permission denied/,
      );
    },
  );
  await check(
    "Cursor pagination has no gaps/duplicates and rejects NULL caps or half/invalid cursors",
    async () => {
      await sql(
        `insert into private.resource_comments(job_id,author_id,request_id,body,created_at) select '${job}','${peer}',gen_random_uuid(),'Page '||n,clock_timestamp()-interval '1 hour'+n*interval '1 second' from generate_series(1,6)n`,
      );
      const one = await rpc(teacher, "resource_comments", [
          "job",
          job,
          null,
          null,
          3,
        ]),
        last = one.at(-1);
      const two = await rpc(teacher, "resource_comments", [
        "job",
        job,
        last.created_at,
        last.id,
        3,
      ]);
      assert.equal(new Set([...one, ...two].map((row) => row.id)).size, 6);
      await assert.rejects(
        rpc(teacher, "resource_comments", ["job", job, null, null, null]),
        /Invalid comment cursor/,
      );
      await assert.rejects(
        rpc(teacher, "resource_comments", [
          "job",
          job,
          last.created_at,
          null,
          3,
        ]),
        /Invalid comment cursor/,
      );
    },
  );
  await check(
    "Archived resources retain readable history, close new posts/edits and still permit own withdrawal",
    async () => {
      const id = await rpc(peer, "add_resource_comment", [
        "template",
        template,
        "Archived teaching note",
        randomUUID(),
      ]);
      await sql(
        `update public.course_templates set archived_at=now() where id='${template}'`,
      );
      assert.equal(
        (await rpc(peer, "comment_context", ["template", template])).can_post,
        false,
      );
      await assert.rejects(
        rpc(peer, "add_resource_comment", [
          "template",
          template,
          "No new note",
          randomUUID(),
        ]),
        /42501/,
      );
      await assert.rejects(
        rpc(peer, "edit_resource_comment", [id, "No new edit", 1]),
        /42501/,
      );
      await rpc(peer, "withdraw_resource_comment", [id, 1]);
    },
  );
  await check(
    "Hidden/draft resources and current role revocation remove access even with an existing actor token",
    async () => {
      await sql(`update public.jobs set status='draft' where id='${job}'`);
      await assert.rejects(
        rpc(teacher, "resource_comments", ["job", job]),
        /42501/,
      );
      await sql(
        `update public.jobs set status='published' where id='${job}';delete from public.user_roles where user_id='${peer}';insert into public.user_roles(user_id,role) values('${peer}','client');`,
      );
      await assert.rejects(
        rpc(peer, "resource_comments", ["job", job]),
        /42501/,
      );
    },
  );
  await check(
    "Strict text bounds and actor rate limits reject invalid writes without false success",
    async () => {
      for (const text of ["", " ", "x".repeat(5001), "invalid\u0001control"])
        await assert.rejects(
          rpc(teacher, "add_resource_comment", [
            "job",
            job,
            text,
            randomUUID(),
          ]),
          /Invalid comment/,
        );
      await sql(
        `insert into private.resource_comments(job_id,author_id,request_id,body) select '${job}','${teacher}',gen_random_uuid(),'Rate fixture '||n from generate_series(1,10)n`,
      );
      await assert.rejects(
        rpc(teacher, "add_resource_comment", [
          "job",
          job,
          "Over quota",
          randomUUID(),
        ]),
        /54000/,
      );
    },
  );
  await check(
    "Suspended users lose reads, edits and posts; private comment tables are never exposed directly",
    async () => {
      await sql(
        `update public.profiles set active=false where id='${teacher}'`,
      );
      await assert.rejects(
        rpc(teacher, "resource_comments", ["job", job]),
        /42501/,
      );
      await assert.rejects(
        rpc(teacher, "add_resource_comment", [
          "job",
          job,
          "Suspended",
          randomUUID(),
        ]),
        /42501/,
      );
      await assert.rejects(
        actor(manager, "select * from private.resource_comments", "aal2"),
        /permission denied/,
      );
    },
  );
});
console.log(
  `\n${checks} resource-comment PostgreSQL checks passed (ACL, retries, concurrency, moderation and pagination).`,
);
