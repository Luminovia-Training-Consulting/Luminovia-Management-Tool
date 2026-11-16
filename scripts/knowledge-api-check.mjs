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
  resources = [],
  categories = [];
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
  // Capabilities reflect the actual current actor and MFA level, never an editable role hint.
  assert.deepEqual(
    await checked(
      a.client.rpc("knowledge_access"),
      "Actual staff author capabilities",
    ),
    { can_author: true, can_publish_wiki: false, can_moderate_forum: false },
  );
  assert.deepEqual(
    await checked(
      participant.client.rpc("knowledge_access"),
      "Actual participant has no knowledge capabilities",
    ),
    { can_author: false, can_publish_wiki: false, can_moderate_forum: false },
  );
  assert.deepEqual(
    await checked(
      manager.client.rpc("knowledge_access"),
      "Password-only manager has no publishing or moderation capabilities",
    ),
    { can_author: true, can_publish_wiki: false, can_moderate_forum: false },
  );
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
  assert.equal(
    (
      await manager.client.rpc("save_knowledge_category", {
        p_id: null,
        p_kind: "wiki",
        p_slug: `qa-denied-${suffix}`,
        p_label_de: "Fiktiv",
        p_label_en: "Fictional",
        p_archived: false,
      })
    ).error?.code,
    "42501",
    "Password-only manager cannot create a category",
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
  assert.deepEqual(
    await checked(
      manager.client.rpc("knowledge_access"),
      "Current MFA enables only authorised publishing and moderation",
    ),
    { can_author: true, can_publish_wiki: true, can_moderate_forum: true },
  );
  // Exercise the same category mutation used by management, including current MFA
  // and staff visibility, rather than seeding this state through service-role SQL.
  const categoryPayload = {
    p_id: null,
    p_kind: "wiki",
    p_slug: `qa-${suffix}`,
    p_label_de: "Fiktive API-Lehrpraxis",
    p_label_en: "Fictional API teaching",
    p_archived: false,
  };
  assert.equal(
    (await a.client.rpc("save_knowledge_category", categoryPayload)).error
      ?.code,
    "42501",
    "Ordinary staff cannot create categories",
  );
  const category = await checked(
    manager.client.rpc("save_knowledge_category", categoryPayload),
    "MFA manager creates bilingual wiki category",
  );
  categories.push(category);
  resources.push(category);
  const categoryRow = (
    await checked(
      b.client.rpc("knowledge_categories", { p_kind: "wiki" }),
      "Staff receives approved category",
    )
  ).find((item) => item.id === category);
  assert.equal(categoryRow.label_de, categoryPayload.p_label_de);
  assert.equal(categoryRow.label_en, categoryPayload.p_label_en);
  await checked(
    manager.client.rpc("save_knowledge_category", {
      ...categoryPayload,
      p_id: category,
      p_archived: true,
    }),
    "MFA manager archives category",
  );
  assert.ok(
    !(
      await checked(
        b.client.rpc("knowledge_categories", { p_kind: "wiki" }),
        "Archived category hidden from staff",
      )
    ).some((item) => item.id === category),
  );
  assert.equal(
    (
      await checked(
        manager.client.rpc("knowledge_categories", { p_kind: "wiki" }),
        "Manager can recover archived category",
      )
    ).find((item) => item.id === category).archived,
    true,
  );
  await checked(
    manager.client.rpc("save_knowledge_category", {
      ...categoryPayload,
      p_id: category,
    }),
    "MFA manager restores category",
  );
  base.p_category_id = category;

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
  // Search the actor's authorised revision: an unpublished correction must not leak through filters.
  const publishedSearch = await checked(
    b.client.rpc("wiki_pages_list", {
      p_search: suffix,
      p_locale: "de",
      p_category_id: category,
    }),
    "Combine actual title, language and category filters",
  );
  assert.deepEqual(
    publishedSearch.map((item) => item.id),
    [page],
  );
  assert.equal(publishedSearch[0].version, 2);
  assert.equal(publishedSearch[0].has_draft, false);
  assert.deepEqual(
    await checked(
      b.client.rpc("wiki_pages_list", {
        p_search: suffix,
        p_locale: "en",
        p_category_id: category,
      }),
      "Language filter excludes German authored content",
    ),
    [],
  );
  assert.deepEqual(
    await checked(
      b.client.rpc("wiki_pages_list", {
        p_search: "Not published yet",
        p_category_id: category,
      }),
      "Search cannot leak unpublished correction",
    ),
    [],
  );
  assert.equal(
    (
      await checked(
        a.client.rpc("wiki_pages_list", {
          p_search: "Not published yet",
          p_category_id: category,
        }),
        "Author can find own unpublished correction",
      )
    )[0].id,
    page,
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
  // A committed reply notifies its subscribers once; retrying it cannot renew a read notice.
  const firstNotice = await checked(
    a.client
      .from("notifications")
      .select("id,created_at,read_at")
      .eq("kind", "forum_reply")
      .eq("resource_id", thread)
      .single(),
    "Committed reply creates exactly one subscriber notice",
  );
  assert.equal(
    (
      await checked(
        b.client
          .from("notifications")
          .select("id")
          .eq("kind", "forum_reply")
          .eq("resource_id", thread),
        "Author receives no self notification",
      )
    ).length,
    0,
  );
  await checked(
    a.client.rpc("mark_notifications", {
      p_ids: [firstNotice.id],
      p_read: true,
    }),
    "Read actual forum reply notice",
  );
  const readNotice = await checked(
    a.client
      .from("notifications")
      .select("id,created_at,read_at")
      .eq("id", firstNotice.id)
      .single(),
    "Read persisted notice state",
  );
  assert.ok(readNotice.read_at);
  assert.equal(
    await checked(
      b.client.rpc("add_forum_post", {
        p_thread_id: thread,
        p_content: rich,
        p_client_id: key,
      }),
      "Retry after subscriber read",
    ),
    reply,
  );
  assert.deepEqual(
    await checked(
      a.client
        .from("notifications")
        .select("id,created_at,read_at")
        .eq("id", firstNotice.id)
        .single(),
      "Idempotent retry cannot reannounce already read post",
    ),
    readNotice,
  );
  assert.equal(
    (
      await b.client.rpc("add_forum_post", {
        p_thread_id: thread,
        p_content: doc("Changed retry content"),
        p_client_id: key,
      })
    ).error?.code,
    "22023",
    "Changed idempotent content is explicitly rejected",
  );
  // Subscription rows remain personal; unsubscribe must stop later fanout without deleting old history.
  await checked(
    b.client.rpc("subscribe_forum_thread", {
      p_thread_id: thread,
      p_subscribed: true,
    }),
    "Subscribe reader to actual thread",
  );
  await checked(
    b.client.rpc("subscribe_forum_thread", {
      p_thread_id: thread,
      p_subscribed: true,
    }),
    "Retry subscription without duplicate row",
  );
  assert.equal(
    (
      await checked(
        b.client
          .from("forum_subscriptions")
          .select("user_id")
          .eq("thread_id", thread),
        "Read only own subscription",
      )
    ).length,
    1,
  );
  assert.ok(
    (
      await checked(
        a.client
          .from("forum_subscriptions")
          .select("user_id")
          .eq("thread_id", thread),
        "Thread owner cannot enumerate other subscriptions",
      )
    ).every((item) => item.user_id === a.id),
  );
  assert.equal(
    (
      await checked(
        b.client.rpc("forum_thread", { p_id: thread }),
        "Thread projection reflects subscription",
      )
    ).subscribed,
    true,
  );
  await checked(
    a.client.rpc("add_forum_post", {
      p_thread_id: thread,
      p_content: doc("Actual subscription follow-up"),
      p_client_id: randomUUID(),
    }),
    "Create subscribed follow-up",
  );
  const subscriptionNotice = await checked(
    b.client
      .from("notifications")
      .select("id,created_at,read_at")
      .eq("kind", "forum_reply")
      .eq("resource_id", thread)
      .single(),
    "Subscribed reader receives one actual notice",
  );
  const linkedNotice = (
    await checked(
      b.client.rpc("notification_inbox"),
      "Authorised forum notification projection",
    )
  ).items.find((item) => item.id === subscriptionNotice.id);
  assert.equal(linkedNotice.href, `/forum?thread=${thread}`);
  await checked(
    b.client.rpc("subscribe_forum_thread", {
      p_thread_id: thread,
      p_subscribed: false,
    }),
    "Unsubscribe actual reader",
  );
  await checked(
    b.client.rpc("mark_notifications", {
      p_ids: [subscriptionNotice.id],
      p_read: true,
    }),
    "Mark previous subscribed notice read",
  );
  const unsubscribedNotice = await checked(
    b.client
      .from("notifications")
      .select("id,created_at,read_at")
      .eq("id", subscriptionNotice.id)
      .single(),
    "Read old notice after unsubscribe",
  );
  await checked(
    a.client.rpc("add_forum_post", {
      p_thread_id: thread,
      p_content: doc("Actual unsubscribed follow-up"),
      p_client_id: randomUUID(),
    }),
    "Post after reader unsubscribes",
  );
  assert.deepEqual(
    await checked(
      b.client
        .from("notifications")
        .select("id,created_at,read_at")
        .eq("id", subscriptionNotice.id)
        .single(),
      "Unsubscribed reader receives no renewed notice",
    ),
    unsubscribedNotice,
  );
  assert.equal(
    (
      await checked(
        b.client.rpc("forum_thread", { p_id: thread }),
        "Thread projection reflects unsubscribe",
      )
    ).subscribed,
    false,
  );
  // The author alone can revise a post, with exact version checking and a private previous-content record.
  const corrected = doc(`searchable-correction-${suffix}`);
  assert.equal(
    (
      await a.client.rpc("edit_forum_post", {
        p_post_id: reply,
        p_content: corrected,
        p_expected_version: 1,
      })
    ).error?.code,
    "42501",
    "Thread owner cannot rewrite another author",
  );
  await checked(
    b.client.rpc("edit_forum_post", {
      p_post_id: reply,
      p_content: corrected,
      p_expected_version: 1,
    }),
    "Edit actual authored reply with expected version",
  );
  assert.equal(
    (
      await b.client.rpc("edit_forum_post", {
        p_post_id: reply,
        p_content: doc("Stale edit"),
        p_expected_version: 1,
      })
    ).error?.code,
    "40001",
    "Stale API edit cannot overwrite committed correction",
  );
  const edited = (
    await checked(
      a.client.rpc("forum_posts", { p_thread_id: thread }),
      "Read committed edited reply",
    )
  ).find((item) => item.id === reply);
  assert.equal(edited.version, 2);
  assert.deepEqual(edited.content, corrected);
  assert.ok(edited.edited_at);
  const revision = await checked(
    b.client
      .from("forum_post_revisions")
      .select("version,previous_content")
      .eq("post_id", reply)
      .single(),
    "Author can inspect exact prior revision",
  );
  assert.equal(revision.version, 1);
  assert.deepEqual(revision.previous_content, rich);
  assert.deepEqual(
    await checked(
      a.client.from("forum_post_revisions").select("id").eq("post_id", reply),
      "Thread owner has no private revision bypass",
    ),
    [],
  );
  assert.deepEqual(
    (
      await checked(
        b.client.rpc("forum_threads_list", {
          p_search: `searchable-correction-${suffix}`,
          p_category_id: forum,
        }),
        "Search current edited body and category",
      )
    ).map((item) => item.id),
    [thread],
  );
  assert.ok(
    !(
      await checked(
        b.client.rpc("forum_threads_list", {
          p_search: "console.log",
          p_category_id: forum,
        }),
        "Historical reply body is absent from current search",
      )
    ).some((item) => item.id === thread),
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
  // Archiving revokes both current reads and old notification links; explicit recovery restores access.
  await checked(
    manager.client.rpc("moderate_forum_thread", {
      p_thread_id: thread,
      p_archived: true,
    }),
    "Archive actual discussion",
  );
  assert.equal(
    (await b.client.rpc("forum_thread", { p_id: thread })).error?.code,
    "42501",
    "Archived discussion is no longer readable by peer",
  );
  const archivedNotice = (
    await checked(
      b.client.rpc("notification_inbox"),
      "Archived discussion revalidates stored notification",
    )
  ).items.find((item) => item.id === subscriptionNotice.id);
  assert.equal(archivedNotice.href, null);
  assert.equal(archivedNotice.title, "");
  assert.equal(
    (
      await b.client.rpc("subscribe_forum_thread", {
        p_thread_id: thread,
        p_subscribed: true,
      })
    ).error?.code,
    "42501",
    "Archived discussion cannot be subscribed through stale ID",
  );
  await checked(
    manager.client.rpc("moderate_forum_thread", {
      p_thread_id: thread,
      p_archived: false,
    }),
    "Recover archived discussion",
  );
  assert.equal(
    (
      await checked(
        b.client.rpc("forum_thread", { p_id: thread }),
        "Restored discussion is readable",
      )
    ).archived,
    false,
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
  assert.deepEqual(
    await checked(
      b.client.rpc("knowledge_access"),
      "Suspension removes existing-session knowledge capabilities",
    ),
    { can_author: false, can_publish_wiki: false, can_moderate_forum: false },
  );
  console.log(
    "PASS: actual Auth/REST plus real manager TOTP: private drafts, bilingual category archive/recovery, combined permission-aware wiki filters, published code preservation, independent unpublished corrections/history RLS, version conflicts and unsafe-content rejection, durable/idempotent forum replies and notices, subscription/unsubscription and current links, own versioned edits/restricted revisions/current-body search, accepted answers, MFA pin/lock/report moderation and archive recovery, tombstones, participant and suspended-token denial.",
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
  if (categories.length)
    await checked(
      service.from("knowledge_categories").delete().in("id", categories),
      "Remove scoped QA categories after dependent content",
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
