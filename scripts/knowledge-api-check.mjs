/**
 * Real Auth/HTTP checks for published knowledge revisions and separate forum discussions.
 * Separate fictional identities verify actual API results and denied access; responses are not browser mocks.
 */
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
process.loadEnvFile(".env.test.local");
const url = process.env.SUPABASE_URL;
assert.ok(
  url && ["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname),
  "Knowledge checks only permit loopback test projects.",
);
/** Creates a separate SDK client without persistent sessions or automatic session refresh. */
const make = (key) =>
  createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
const service = make(process.env.SUPABASE_SERVICE_ROLE_KEY),
  users = [],
  clients = [],
  pages = [],
  threads = [],
  resources = [];
const suffix = randomUUID();
/** Requires actual SDK success before returning the response data. */
async function checked(request, label) {
  const { data, error } = await request;
  assert.equal(error, null, `${label}: ${error?.message}`);
  return data;
}
/** Creates separate fictional accounts and signs them in through Auth; their IDs belong only to the fixture. */
async function fixture(name, role) {
  const email = `knowledge-${name}-${suffix}@example.invalid`;
  const auth = await checked(
    service.auth.admin.createUser({
      email,
      password: process.env.E2E_PASSWORD,
      email_confirm: true,
    }),
    "Create fictional knowledge account",
  );
  users.push(auth.user.id);
  await checked(
    service.from("user_roles").insert({ user_id: auth.user.id, role }),
    "Assign known local fixture role",
  );
  await checked(
    service
      .from("profiles")
      .update({ display_name: `Knowledge QA ${name}` })
      .eq("id", auth.user.id),
    "Set fictional display name",
  );
  const client = make(process.env.SUPABASE_ANON_KEY);
  clients.push(client);
  await checked(
    client.auth.signInWithPassword({
      email,
      password: process.env.E2E_PASSWORD,
    }),
    "Actual Auth sign-in",
  );
  return { client, id: auth.user.id };
}
/** Computes the current six-digit TOTP from the fictional MFA secret; never log the code or secret. */
function totp(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret.replace(/=+$/, "").toUpperCase()]
    .map((char) => alphabet.indexOf(char).toString(2).padStart(5, "0"))
    .join("");
  const key = Buffer.from(
    bits.match(/.{8}/g).map((byte) => Number.parseInt(byte, 2)),
  );
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", key).update(counter).digest();
  return (
    (digest.readUInt32BE(digest[digest.length - 1] & 15) & 0x7fffffff) %
    1_000_000
  )
    .toString()
    .padStart(6, "0");
}
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
      content: [{ type: "text", text: "Authored code" }],
    },
    {
      type: "codeBlock",
      attrs: { language: "javascript" },
      content: [
        { type: "text", text: 'console.log("<script>literal text</script>");' },
      ],
    },
  ],
};
try {
  const a = await fixture("author", "lecturer"),
    b = await fixture("reader", "senior_lecturer"),
    manager = await fixture("manager", "admin"),
    participant = await fixture("participant", "participant");
  const wiki = (
    await checked(
      a.client.rpc("knowledge_categories", { p_kind: "wiki" }),
      "Wiki categories",
    )
  )[0].id;
  const forum = (
    await checked(
      a.client.rpc("knowledge_categories", { p_kind: "forum" }),
      "Forum categories",
    )
  )[0].id;
  const base = {
    p_title: `Knowledge test ${suffix}`,
    p_locale: "de",
    p_category_id: wiki,
    p_content: rich,
    p_status: "draft",
    p_expected_version: null,
  };
  const created = await checked(
    a.client.rpc("save_wiki_page", { ...base, p_id: null }),
    "Persist private wiki draft",
  );
  pages.push(created.page_id);
  const page = created.page_id;
  assert.ok((await b.client.rpc("wiki_page", { p_id: page })).error);
  assert.equal(
    (
      await checked(
        b.client.from("wiki_revisions").select("id").eq("page_id", page),
        "Raw draft RLS",
      )
    ).length,
    0,
  );
  assert.ok(
    (
      await manager.client.rpc("save_wiki_page", {
        ...base,
        p_id: page,
        p_status: "published",
        p_expected_version: 1,
      })
    ).error,
    "Password-only manager cannot publish",
  );
  const enrollment = await checked(
    manager.client.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Disposable knowledge QA",
    }),
    "Enroll actual manager TOTP",
  );
  await checked(
    manager.client.auth.mfa.challengeAndVerify({
      factorId: enrollment.id,
      code: totp(enrollment.totp.secret),
    }),
    "Verify actual manager TOTP",
  );
  assert.equal(
    (
      await checked(
        manager.client.auth.mfa.getAuthenticatorAssuranceLevel(),
        "Actual manager assurance",
      )
    ).currentLevel,
    "aal2",
  );
  const published = await checked(
    manager.client.rpc("save_wiki_page", {
      ...base,
      p_id: page,
      p_status: "published",
      p_expected_version: 1,
    }),
    "Publish with actual AAL2",
  );
  assert.equal(published.published_version, 2);
  const visible = await checked(
    b.client.rpc("wiki_page", { p_id: page }),
    "Read authoritative published page",
  );
  assert.deepEqual(visible.content, rich);
  const draft = await checked(
    a.client.rpc("save_wiki_page", {
      ...base,
      p_id: page,
      p_title: "Private correction",
      p_content: doc("Not published yet"),
      p_expected_version: 2,
    }),
    "Save correction without replacing live snapshot",
  );
  assert.equal(draft.version, 3);
  const reader = await checked(
    b.client.rpc("wiki_page", { p_id: page }),
    "Reader still receives published snapshot",
  );
  assert.equal(reader.version, 2);
  assert.deepEqual(reader.content, rich);
  assert.equal(
    (
      await checked(
        b.client.rpc("wiki_page_history", { p_id: page }),
        "Published-only revision history",
      )
    ).length,
    1,
  );
  assert.ok(
    (
      await a.client.rpc("save_wiki_page", {
        ...base,
        p_id: page,
        p_expected_version: 2,
      })
    ).error,
    "Stale author revision is rejected",
  );
  const unsafe = doc("Unsafe link");
  unsafe.content[0].content[0].marks = [
    { type: "link", attrs: { href: "javascript:alert(1)" } },
  ];
  assert.ok(
    (
      await a.client.rpc("save_wiki_page", {
        ...base,
        p_id: null,
        p_content: unsafe,
      })
    ).error,
    "Unsafe rich text is rejected at the actual API",
  );
  const thread = await checked(
    a.client.rpc("create_forum_thread", {
      p_category_id: forum,
      p_title: `Real API question ${suffix}`,
      p_content: doc("How does the teaching exercise work?"),
    }),
    "Persist forum thread",
  );
  threads.push(thread);
  const key = randomUUID();
  const reply = await checked(
    b.client.rpc("add_forum_post", {
      p_thread_id: thread,
      p_content: rich,
      p_client_id: key,
    }),
    "Persist forum answer",
  );
  resources.push(reply);
  assert.equal(
    await checked(
      b.client.rpc("add_forum_post", {
        p_thread_id: thread,
        p_content: rich,
        p_client_id: key,
      }),
      "Idempotent forum retry",
    ),
    reply,
  );
  await checked(
    a.client.rpc("accept_forum_answer", {
      p_thread_id: thread,
      p_post_id: reply,
    }),
    "Author accepts actual reply",
  );
  assert.equal(
    (
      await checked(
        b.client.rpc("forum_thread", { p_id: thread }),
        "Read accepted answer",
      )
    ).accepted_post_id,
    reply,
  );
  await checked(
    manager.client.rpc("moderate_forum_thread", {
      p_thread_id: thread,
      p_locked: true,
      p_pinned: true,
    }),
    "Actual MFA moderator locks/pins",
  );
  assert.ok(
    (
      await b.client.rpc("add_forum_post", {
        p_thread_id: thread,
        p_content: doc("Cannot bypass lock"),
        p_client_id: randomUUID(),
      })
    ).error,
  );
  await checked(
    manager.client.rpc("moderate_forum_thread", {
      p_thread_id: thread,
      p_locked: false,
    }),
    "Unlock actual discussion",
  );
  const report = await checked(
    a.client.rpc("report_forum_post", {
      p_post_id: reply,
      p_reason: "Fictional review request for QA",
    }),
    "Create private forum report",
  );
  resources.push(report);
  assert.equal(
    (
      await checked(
        b.client.rpc("forum_reports"),
        "Nonreporter cannot inspect report",
      )
    ).filter((r) => r.id === report).length,
    0,
  );
  await checked(
    manager.client.rpc("resolve_forum_report", {
      p_report_id: report,
      p_resolved: true,
    }),
    "Resolve report with actual MFA",
  );
  await checked(
    b.client.rpc("delete_forum_post", { p_post_id: reply }),
    "Delete own answer by tombstone",
  );
  assert.equal(
    (
      await checked(
        a.client.rpc("forum_thread", { p_id: thread }),
        "Deleted answer clears accepted pointer",
      )
    ).accepted_post_id,
    null,
  );
  for (const rpc of ["wiki_pages_list", "forum_threads_list"])
    assert.deepEqual(
      await checked(
        participant.client.rpc(rpc),
        "Participant knowledge exclusion",
      ),
      [],
    );
  assert.ok(
    (await participant.client.rpc("forum_posts", { p_thread_id: thread }))
      .error,
  );
  assert.ok(
    (
      await b.client
        .from("forum_threads")
        .update({ pinned: true })
        .eq("id", thread)
    ).error,
    "Raw table bypass is denied",
  );
  await checked(
    service.from("profiles").update({ active: false }).eq("id", b.id),
    "Suspend temporary QA reader",
  );
  assert.ok((await b.client.rpc("wiki_page", { p_id: page })).error);
  assert.deepEqual(
    await checked(
      b.client.rpc("forum_threads_list"),
      "Suspended token loses forum access",
    ),
    [],
  );
  console.log(
    "PASS: actual Auth/REST plus real manager TOTP: private drafts, published code preservation, independent unpublished corrections/history RLS, version conflicts and unsafe-content rejection, durable/idempotent forum replies, accepted answers, MFA pin/lock/report moderation, tombstones, participant and suspended-token denial.",
  );
} finally {
  for (const client of clients) await client.removeAllChannels();
  if (threads.length) {
    await checked(
      service.from("notifications").delete().in("resource_id", threads),
      "Remove scoped QA notifications",
    );
    await checked(
      service.from("forum_threads").delete().in("id", threads),
      "Remove scoped QA threads/posts/reports",
    );
  }
  if (pages.length)
    await checked(
      service.from("wiki_pages").delete().in("id", pages),
      "Remove scoped QA wiki revisions",
    );
  if ([...pages, ...threads, ...resources].length)
    await checked(
      service
        .from("audit_events")
        .delete()
        .in("resource_id", [...pages, ...threads, ...resources]),
      "Remove scoped QA audit metadata",
    );
  for (const id of users)
    await checked(
      service.auth.admin.deleteUser(id),
      "Remove temporary knowledge account",
    );
}
