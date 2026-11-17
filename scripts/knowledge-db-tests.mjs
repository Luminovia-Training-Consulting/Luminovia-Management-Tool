/** Knowledge permission and revision tests on actual PostgreSQL, in a disposable DB.
 * Auth helpers are compatible stubs here; the separate chat-api-check uses real JWTs/realtime.
 */
import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const container =
  process.env.PORTAL_DB_CONTAINER ?? "supabase_db_luminovia-portal";
if (
  !/^supabase_db_luminovia-portal(?:-test(?:-[a-zA-Z0-9_-]+)?)?$/.test(
    container,
  )
)
  throw new Error(
    "Only the named local portal database container is permitted.",
  );
const database = `knowledge_test_${randomUUID().replaceAll("-", "")}`;
/** Starts the test program with explicit arguments and preserves its failure status. */
function command(args, input = "") {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "",
      err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve(out.trim()) : reject(new Error(err || out)),
    );
    child.stdin.end(input);
  });
}
/** Sends SQL to the owned test database and makes every psql error fail the run. */
const sql = (text, name = database) =>
  command(
    [
      "exec",
      "-i",
      container,
      "psql",
      "-U",
      "postgres",
      "-d",
      name,
      "-X",
      "-qAt",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    text,
  );
/** Quotes controlled fixture SQL literals; identifiers have separate validation. */
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
/** Executes the check as a specific identity so administrative fixture privileges cannot mask the tested access. */
const actor = (id, statement, aal = "aal1") =>
  sql(
    `begin;set local role authenticated;set local request.jwt.claims=${quote(JSON.stringify({ sub: id, aal, role: "authenticated" }))};${statement};commit;`,
  );
/** Calls the public RPC as the test identity and returns its scalar database value. */
const value = (id, fn, args = [], aal) =>
  actor(
    id,
    `select public.${fn}(${args.map((x) => (x === null ? "null" : typeof x === "boolean" ? String(x) : quote(x))).join(",")})`,
    aal,
  );
/** Aggregates public RPC rows into JSON under the checked caller identity. */
const rows = (id, fn, args = [], aal) =>
  actor(
    id,
    `select coalesce(json_agg(x),'[]') from public.${fn}(${args.map((x) => (x === null ? "null" : typeof x === "number" || typeof x === "boolean" ? String(x) : quote(x))).join(",")}) x`,
    aal,
  ).then(JSON.parse);
const a = randomUUID(),
  b = randomUUID(),
  admin = randomUUID(),
  participant = randomUUID();
let checks = 0;
/** Counts and reports a case only after all of its assertions have completed successfully. */
const check = async (name, fn) => {
  await fn();
  checks++;
  console.log(`PASS ${name}`);
};
/** Creates a minimal allowed editor tree containing literal fixture text rather than executable HTML. */
const doc = (text) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
const rich = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Code example" }],
    },
    {
      type: "codeBlock",
      attrs: { language: "typescript" },
      content: [
        {
          type: "text",
          text: 'const literal = "<script>alert(1)</script>";\nconsole.log(literal);',
        },
      ],
    },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "Official docs",
          marks: [
            {
              type: "link",
              attrs: {
                href: "https://example.invalid/docs",
                target: "_blank",
                rel: "noopener noreferrer nofollow",
              },
            },
          ],
        },
      ],
    },
  ],
};
/** Sends the checked draft with its version and identity context to the owning API. */
const save = (who, id, title, content, state, expected = null, aal) =>
  value(
    who,
    "save_wiki_page",
    [id, title, "de", wikiCategory, JSON.stringify(content), state, expected],
    aal,
  ).then(JSON.parse);
let wikiCategory, forumCategory, page, thread, reply;
try {
  await sql(`create database ${database}`, "postgres");
  await sql(`create schema auth;create schema extensions;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
 grant usage on schema auth to authenticated,anon,service_role;grant execute on all functions in schema auth to authenticated,anon,service_role;`);
  for (const file of (
    await readdir(new URL("../supabase/migrations/", import.meta.url))
  )
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await sql(
      await readFile(
        new URL(`../supabase/migrations/${file}`, import.meta.url),
        "utf8",
      ),
    );
  await sql(
    `insert into auth.users(id) values('${a}'),('${b}'),('${admin}'),('${participant}');insert into public.user_roles(user_id,role) values('${a}','lecturer'),('${b}','senior_lecturer'),('${admin}','admin'),('${participant}','participant');update public.profiles set display_name='Fictional knowledge user'`,
  );
  wikiCategory = (await rows(a, "knowledge_categories", ["wiki"]))[0].id;
  forumCategory = (await rows(a, "knowledge_categories", ["forum"]))[0].id;
  await check(
    "Participants and anonymous identities have no knowledge access or write capability",
    async () => {
      assert.deepEqual(
        JSON.parse(await value(participant, "knowledge_access")),
        {
          can_author: false,
          can_publish_wiki: false,
          can_moderate_forum: false,
        },
      );
      assert.deepEqual(
        await rows(participant, "knowledge_categories", ["wiki"]),
        [],
      );
      assert.deepEqual(await rows(participant, "wiki_pages_list"), []);
      assert.deepEqual(await rows(participant, "forum_threads_list"), []);
      await assert.rejects(
        value(participant, "create_forum_thread", [
          forumCategory,
          "Forbidden",
          JSON.stringify(doc("No")),
        ]),
        /Staff forum access/,
      );
      await assert.rejects(
        sql("set role anon;select public.knowledge_access()"),
        /permission denied/,
      );
    },
  );
  await check(
    "Staff authors save private wiki drafts; staff peers are denied while permitted admins can review them",
    async () => {
      page = (await save(a, null, "Draft wiki", rich, "draft")).page_id;
      assert.deepEqual(await rows(b, "wiki_pages_list"), []);
      await assert.rejects(value(b, "wiki_page", [page]), /access denied/);
      const adminReview = JSON.parse(await value(admin, "wiki_page", [page]));
      assert.equal(adminReview.title, "Draft wiki");
      assert.equal(adminReview.status, "draft");
      assert.equal((await rows(a, "wiki_pages_list"))[0].has_draft, true);
      assert.equal(
        await actor(
          b,
          `select count(*) from public.wiki_revisions where page_id='${page}'`,
        ),
        "0",
      );
    },
  );
  await check(
    "Publishing requires the distinct manager capability and permission; code stays exact authored text",
    async () => {
      await assert.rejects(
        save(a, page, "Published wiki", rich, "published", 1, "aal1"),
        /publishing.*required/i,
      );
      const result = await save(
        admin,
        page,
        "Published wiki",
        rich,
        "published",
        1,
        "aal1",
      );
      assert.equal(result.version, 2);
      assert.equal(result.published_version, 2);
      const published = JSON.parse(await value(b, "wiki_page", [page]));
      assert.deepEqual(published.content, rich);
      assert.equal(published.version, 2);
      assert.equal(published.has_draft, false);
      assert.equal(
        (await rows(b, "wiki_pages_list", ["console.log"]))[0].id,
        page,
      );
    },
  );
  await check(
    "Unpublished corrections never replace or leak into the authoritative published snapshot",
    async () => {
      await save(
        a,
        page,
        "Secret unpublished title",
        doc("Unpublished corrected body"),
        "draft",
        2,
      );
      const visible = JSON.parse(await value(b, "wiki_page", [page]));
      assert.equal(visible.title, "Published wiki");
      assert.equal(visible.version, 2);
      assert.ok(
        !JSON.stringify(visible).includes("Unpublished corrected body"),
      );
      assert.deepEqual(
        (await rows(b, "wiki_page_history", [page])).map((r) => r.version),
        [2],
      );
      assert.equal((await rows(a, "wiki_page_history", [page])).length, 3);
      assert.equal(
        await actor(
          b,
          `select count(*) from public.wiki_revisions where page_id='${page}' and version=3`,
        ),
        "0",
      );
    },
  );
  await check(
    "Concurrent saves with the same wiki version yield one revision and one clear conflict",
    async () => {
      const results = await Promise.allSettled([
        save(a, page, "Version A", doc("A"), "draft", 3),
        save(a, page, "Version B", doc("B"), "draft", 3),
      ]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(results.filter((r) => r.status === "rejected").length, 1);
      assert.match(
        results.find((r) => r.status === "rejected").reason.message,
        /version conflict/,
      );
    },
  );
  await check(
    "Unsafe HTML nodes, links, attributes, invalid headings and excessive trees are rejected server-side",
    async () => {
      const malicious = [
        {
          type: "doc",
          content: [{ type: "html", attrs: { html: "<script/>" } }],
        },
        doc("safe"),
        doc("safe"),
        doc("safe"),
        {
          type: "doc",
          content: [{ type: "heading", attrs: { level: 6 }, content: [] }],
        },
      ];
      malicious[1].content[0].content[0].marks = [
        { type: "link", attrs: { href: "javascript:alert(1)" } },
      ];
      malicious[2].content[0].attrs = { onclick: "alert(1)" };
      malicious[3].content[0].content[0].marks = [
        { type: "link", attrs: { href: "//untrusted.invalid" } },
      ];
      for (const content of malicious)
        await assert.rejects(
          save(a, null, "Invalid", content, "draft"),
          /Unsupported|Unsafe|Invalid/,
        );
      await assert.rejects(
        save(a, null, "Oversize", doc("x".repeat(40001)), "draft"),
        /too long|limit/,
      );
      let nested = { type: "paragraph", content: [] };
      for (let i = 0; i < 17; i++)
        nested = { type: "blockquote", content: [nested] };
      await assert.rejects(
        save(a, null, "Deep", { type: "doc", content: [nested] }, "draft"),
        /Unsupported/,
      );
    },
  );
  await check(
    "Category management is capability/permission scoped; staff cannot forge table writes",
    async () => {
      await assert.rejects(
        value(
          a,
          "save_knowledge_category",
          [null, "wiki", "forged", "Falsch", "Forged", false],
          "aal1",
        ),
        /management permission/,
      );
      await assert.rejects(
        actor(a, `insert into public.wiki_pages(owner_id) values('${a}')`),
        /permission denied/,
      );
      const category = await value(
        admin,
        "save_knowledge_category",
        [null, "wiki", "approved-category", "Geprüft", "Approved", false],
        "aal1",
      );
      assert.ok(
        (await rows(a, "knowledge_categories", ["wiki"])).some(
          (c) => c.id === category,
        ),
      );
    },
  );
  await check(
    "Forum threads and idempotent replies persist, search and notify only subscribers",
    async () => {
      thread = await value(a, "create_forum_thread", [
        forumCategory,
        "Safe teaching question",
        JSON.stringify(doc("Question code?")),
      ]);
      const key = randomUUID();
      reply = await value(b, "add_forum_post", [
        thread,
        JSON.stringify(rich),
        key,
      ]);
      assert.equal(
        await value(b, "add_forum_post", [thread, JSON.stringify(rich), key]),
        reply,
      );
      assert.equal((await rows(a, "forum_posts", [thread])).length, 2);
      assert.equal(
        (await rows(a, "forum_threads_list", ["console.log"]))[0].id,
        thread,
      );
      assert.equal(
        await sql(
          `select count(*) from public.notifications where kind='forum_reply' and resource_id='${thread}' and user_id='${a}'`,
        ),
        "1",
      );
      await value(b, "subscribe_forum_thread", [thread, true]);
      await value(a, "add_forum_post", [
        thread,
        JSON.stringify(doc("Followup")),
        randomUUID(),
      ]);
      assert.equal(
        await sql(
          `select count(*) from public.notifications where resource_id='${thread}' and user_id='${b}'`,
        ),
        "1",
      );
      await assert.rejects(
        value(b, "add_forum_post", [
          thread,
          JSON.stringify(doc("Altered")),
          key,
        ]),
        /idempotency conflict/,
      );
    },
  );
  await check(
    "Only the question owner or moderator accepts an undeleted reply in the same thread",
    async () => {
      await assert.rejects(
        value(b, "accept_forum_answer", [thread, reply]),
        /selection denied/,
      );
      await value(a, "accept_forum_answer", [thread, reply]);
      assert.equal(
        JSON.parse(await value(b, "forum_thread", [thread])).accepted_post_id,
        reply,
      );
      const other = await value(b, "create_forum_thread", [
        forumCategory,
        "Another thread",
        JSON.stringify(doc("Other")),
      ]);
      const post = (await rows(b, "forum_posts", [other]))[0];
      await assert.rejects(
        value(a, "accept_forum_answer", [thread, post.id]),
        /reply in this thread/,
      );
    },
  );
  await check(
    "Moderator permission gates pin/lock/archive and locked discussions reject ordinary posting/editing",
    async () => {
      await value(
        admin,
        "moderate_forum_thread",
        [thread, true, true, null],
        "aal1",
      );
      await assert.rejects(
        value(b, "add_forum_post", [
          thread,
          JSON.stringify(doc("Locked")),
          randomUUID(),
        ]),
        /locked or archived/,
      );
      await assert.rejects(
        value(b, "edit_forum_post", [
          reply,
          JSON.stringify(doc("Locked edit")),
          1,
        ]),
        /locked or archived/,
      );
      await value(
        admin,
        "moderate_forum_thread",
        [thread, false, null, null],
        "aal1",
      );
    },
  );
  await check(
    "Post edits require own authorship and exact version; deletion clears accepted answer and preserves restricted audit",
    async () => {
      await assert.rejects(
        value(a, "edit_forum_post", [
          reply,
          JSON.stringify(doc("Other author")),
          1,
        ]),
        /edit denied/,
      );
      await value(b, "edit_forum_post", [
        reply,
        JSON.stringify(doc("Corrected answer")),
        1,
      ]);
      await assert.rejects(
        value(b, "edit_forum_post", [reply, JSON.stringify(doc("Stale")), 1]),
        /version conflict/,
      );
      await value(b, "delete_forum_post", [reply]);
      const tombstone = (await rows(a, "forum_posts", [thread])).find(
        (p) => p.id === reply,
      );
      assert.ok(tombstone.deleted_at);
      assert.deepEqual(tombstone.content, {
        type: "doc",
        content: [{ type: "paragraph" }],
      });
      assert.equal(
        JSON.parse(await value(a, "forum_thread", [thread])).accepted_post_id,
        null,
      );
      assert.equal(
        await actor(
          a,
          `select count(*) from public.forum_post_revisions where post_id='${reply}'`,
        ),
        "0",
      );
      assert.equal(
        await actor(
          b,
          `select count(*) from public.forum_post_revisions where post_id='${reply}'`,
        ),
        "2",
      );
    },
  );
  await check(
    "Reports are private to reporter/moderator, idempotent and resolvable only with permission",
    async () => {
      const post = (await rows(b, "forum_posts", [thread])).find(
        (p) => p.author_id === a,
      );
      const report = await value(b, "report_forum_post", [
        post.id,
        "Please review this discussion",
      ]);
      assert.equal(
        await value(b, "report_forum_post", [
          post.id,
          "Please review this discussion",
        ]),
        report,
      );
      assert.deepEqual(await rows(a, "forum_reports"), []);
      assert.equal((await rows(admin, "forum_reports", [], "aal1")).length, 1);
      await value(admin, "resolve_forum_report", [report, true], "aal1");
      assert.equal((await rows(b, "forum_reports"))[0].status, "resolved");
    },
  );
  await check(
    "Archived wiki/discussions are hidden from peers and reversible by authorised management",
    async () => {
      const current = JSON.parse(
        await value(admin, "wiki_page", [page], "aal1"),
      );
      await save(
        admin,
        page,
        "Archived",
        doc("Archive body"),
        "archived",
        current.version,
        "aal1",
      );
      await assert.rejects(value(b, "wiki_page", [page]), /access denied/);
      assert.equal(
        JSON.parse(await value(a, "wiki_page", [page])).status,
        "archived",
      );
      await value(
        admin,
        "moderate_forum_thread",
        [thread, null, null, true],
        "aal1",
      );
      await assert.rejects(value(b, "forum_thread", [thread]), /access denied/);
      await value(
        admin,
        "moderate_forum_thread",
        [thread, null, null, false],
        "aal1",
      );
      assert.equal(
        JSON.parse(await value(b, "forum_thread", [thread])).archived,
        false,
      );
    },
  );
  await check(
    "Suspended staff tokens immediately lose knowledge access and all exposed tables retain RLS",
    async () => {
      await sql(`update public.profiles set active=false where id='${b}'`);
      assert.deepEqual(await rows(b, "forum_threads_list"), []);
      assert.deepEqual(await rows(b, "knowledge_categories", ["wiki"]), []);
      assert.equal(
        await actor(b, "select count(*) from public.forum_posts"),
        "0",
      );
      assert.equal(
        await sql(
          `select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity`,
        ),
        "0",
      );
    },
  );
  console.log(
    `\n${checks} knowledge PostgreSQL checks passed (wiki publication/revision isolation and moderated forum workflows).`,
  );
} finally {
  await sql(`drop database if exists ${database} with(force)`, "postgres");
}
