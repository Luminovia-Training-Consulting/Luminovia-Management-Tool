/** Real Auth/MFA/REST publication, revision ACK, quiet attention and old-token isolation. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { withApiFixture } from "./testing/api.mjs";
import { quoteSql as q } from "./testing/database.mjs";

await withApiFixture(async ({ actor, mfa, sql, defer, checked, suffix }) => {
  const admin = await actor("announcement-admin", "admin"),
    manager = await actor("announcement-management", "management"),
    teacher = await actor("announcement-lecturer", "lecturer"),
    client = await actor("announcement-client", "client");
  const users = [admin, manager, teacher, client].map((user) => user.id);
  defer(async () => {
    const owned = users.map(q).join(",");
    await sql(
      `begin;delete from public.notifications where kind='portal_announcement' and resource_id in(select r.id from private.announcement_revisions r join private.portal_announcements a on a.id=r.announcement_id where a.created_by in(${owned}));update private.portal_announcements set draft_revision_id=null,published_revision_id=null where created_by in(${owned});delete from private.portal_announcements where created_by in(${owned});delete from private.announcement_requests where actor_id in(${owned});commit;`,
    );
  });
  const payload = (extra = {}) => ({
    title_de: `Fiktiver API-Hinweis ${suffix}`,
    title_en: `Fictional API notice ${suffix}`,
    body_de: "Fiktiver Inhalt <script> als Text.",
    body_en: "Fictional <script> content as text.",
    important: true,
    audience_roles: ["lecturer"],
    starts_at: new Date(Date.now() - 60000).toISOString(),
    ends_at: new Date(Date.now() + 7 * 86400000).toISOString(),
    time_zone: "Europe/Berlin",
    ...extra,
  });
  const args = (id, action, version, body = {}, key = randomUUID()) => ({
    p_id: id,
    p_action: action,
    p_expected_version: version,
    p_payload: body,
    p_request_id: key,
  });
  const manage = (request, who = admin) =>
    checked(
      who.client.rpc("manage_announcement", request),
      "Actual versioned management operation",
    );
  const list = (who = teacher, extra = {}) =>
    checked(
      who.client.rpc("announcements", { p_limit: 20, ...extra }),
      "Actual authorized publication page",
    );
  const inbox = (who = teacher) =>
    checked(
      who.client.rpc("notification_inbox", { p_limit: 100 }),
      "Actual current-authorized inbox",
    );
  const notice = (revision, who = teacher) =>
    checked(
      who.client
        .from("notifications")
        .select("*")
        .eq("kind", "portal_announcement")
        .eq("resource_id", revision)
        .maybeSingle(),
      "Own exact revision notice",
    );
  let checks = 0;
  const pass = (name) => {
    checks++;
    console.log("PASS " + name);
  };
  assert.equal(
    (
      await admin.client.rpc(
        "manage_announcement",
        args(null, "save", 0, payload()),
      )
    ).error?.code,
    "42501",
  );
  await mfa(admin.client);
  await mfa(manager.client);
  let draft = await manage(args(null, "save", 0, payload()));
  assert.equal((await list()).items.length, 0);
  assert.equal(
    (await teacher.client.rpc("admin_announcement", { p_id: draft.id })).error
      ?.code,
    "42501",
  );
  assert.equal(
    (
      await teacher.client.rpc("announcement", {
        p_revision_id: draft.draft.id,
      })
    ).error?.code,
    "42501",
  );
  const management = await manage(
    args(null, "save", 0, payload({ important: false })),
    manager,
  );
  assert.ok(management.draft.id);
  pass(
    "actual password/MFA roles gate management and draft IDs remain unavailable to ordinary accounts",
  );

  const publish = args(draft.id, "publish", draft.version),
    published = await manage(publish);
  assert.deepEqual(await manage(publish), published);
  assert.equal((await list()).items[0].id, published.published.id);
  assert.equal((await list(client)).items.length, 0);
  const first = await notice(published.published.id);
  assert.ok(first);
  assert.equal(
    (await inbox()).items.find((item) => item.id === first.id).href,
    `/announcements?revision=${published.published.id}`,
  );
  assert.equal(await notice(published.published.id, client), null);
  const original = (
    await checked(
      teacher.client.rpc("announcement", {
        p_revision_id: published.published.id,
      }),
      "Exact public revision",
    )
  ).body_de;
  draft = await manage(
    args(
      draft.id,
      "save",
      published.version,
      payload({
        body_de: "Fiktiver neuer vertraulicher Entwurf",
        title_de: `Fiktiver API-Hinweis v2 ${suffix}`,
      }),
    ),
  );
  assert.equal((await list()).items[0].body_de, original);
  assert.ok(!JSON.stringify(await list()).includes("vertraulicher"));
  pass(
    "important publish retries create one exact revision notice and a newer draft cannot overwrite the public snapshot",
  );

  const ack = await checked(
    teacher.client.rpc("acknowledge_announcement", {
      p_revision_id: published.published.id,
    }),
    "Actual revision acknowledgement",
  );
  assert.equal(
    await checked(
      teacher.client.rpc("acknowledge_announcement", {
        p_revision_id: published.published.id,
      }),
      "Idempotent ACK retry",
    ),
    ack,
  );
  assert.equal(
    (await list(teacher, { p_unacknowledged: true })).items.length,
    0,
  );
  assert.ok((await notice(published.published.id)).read_at);
  const now = new Date(),
    minute = now.getUTCHours() * 60 + now.getUTCMinutes(),
    clock = (value) =>
      `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
  await checked(
    teacher.client.rpc("save_attention_preferences", {
      p_payload: {
        enabled: true,
        start_time: clock((minute + 1439) % 1440),
        end_time: clock((minute + 1) % 1440),
        time_zone: "UTC",
      },
      p_expected_version: 0,
    }),
    "Enable actual current quiet window",
  );
  const v2 = await manage(args(draft.id, "publish", draft.version));
  assert.equal(
    (await list(teacher, { p_unacknowledged: true })).items[0].id,
    v2.published.id,
  );
  let currentInbox = await inbox();
  assert.equal(currentInbox.quiet_active, true);
  assert.equal(currentInbox.attention_count, 1);
  const old = currentInbox.items.find((item) => item.id === first.id);
  assert.equal(old.href, null);
  assert.equal(old.title, "");
  assert.equal(
    (
      await teacher.client.rpc("acknowledge_announcement", {
        p_revision_id: published.published.id,
      })
    ).error?.code,
    "42501",
  );
  pass(
    "actual per-revision ACK hides only v1, v2 resurfaces and important current notices bypass quiet suppression without stale critical counts",
  );

  const secondNotice = await notice(v2.published.id);
  const archived = await manage(args(v2.id, "archive", v2.version));
  assert.equal((await list()).items.length, 0);
  currentInbox = await inbox();
  assert.equal(currentInbox.attention_count, 0);
  const recovered = await manage(args(v2.id, "recover", archived.version));
  assert.equal(recovered.published.id, v2.published.id);
  assert.deepEqual(await notice(recovered.published.id), secondNotice);
  await checked(
    admin.client.rpc("set_account_roles", {
      p_user_id: teacher.id,
      p_roles: ["client"],
    }),
    "Revoke actual lecturer audience role",
  );
  assert.equal((await list()).items.length, 0);
  assert.equal(
    (
      await teacher.client.rpc("announcement", {
        p_revision_id: v2.published.id,
      })
    ).error?.code,
    "42501",
  );
  assert.equal(
    (
      await teacher.client.rpc("acknowledge_announcement", {
        p_revision_id: v2.published.id,
      })
    ).error?.code,
    "42501",
  );
  currentInbox = await inbox();
  assert.equal(currentInbox.attention_count, 0);
  await checked(
    teacher.client.auth.updateUser({
      data: { roles: ["admin"], role: "admin" },
    }),
    "Editable metadata cannot grant announcement authority",
  );
  assert.equal(
    (
      await teacher.client.rpc(
        "manage_announcement",
        args(null, "save", 0, payload()),
      )
    ).error?.code,
    "42501",
  );
  assert.equal((await list()).items.length, 0);
  pass(
    "archive/recover retains publication identity; current database roles and forged metadata cannot bypass old-token audience/ACK guards",
  );

  await checked(
    admin.client.rpc("set_account_roles", {
      p_user_id: teacher.id,
      p_roles: ["lecturer"],
    }),
    "Restore own fixture audience for paging",
  );
  let info = await manage(
    args(
      null,
      "save",
      0,
      payload({
        important: false,
        title_de: `Fiktiver API-Hinweis Info ${suffix}`,
      }),
    ),
  );
  info = await manage(args(info.id, "publish", info.version));
  assert.equal(await notice(info.published.id), null);
  const page = await checked(
    admin.client.rpc("admin_announcements", { p_search: suffix, p_limit: 1 }),
    "Actual bounded administration search",
  );
  assert.equal(page.items.length, 1);
  assert.equal(page.has_more, true);
  const next = await checked(
    admin.client.rpc("admin_announcements", {
      p_search: suffix,
      p_limit: 1,
      p_before_at: page.next_cursor.at,
      p_before_id: page.next_cursor.id,
    }),
    "Actual next tuple page",
  );
  assert.equal(next.items.length, 1);
  assert.notEqual(next.items[0].id, page.items[0].id);
  assert.ok(page.items.every((item) => !Object.hasOwn(item, "body_de")));
  const future = await manage(
    args(
      null,
      "save",
      0,
      payload({
        important: false,
        starts_at: new Date(Date.now() + 86400000).toISOString(),
      }),
    ),
  );
  assert.equal(
    (
      await admin.client.rpc(
        "manage_announcement",
        args(future.id, "publish", future.version),
      )
    ).error?.code,
    "22023",
  );
  assert.ok(
    (
      await teacher.client
        .schema("private")
        .from("announcement_revisions")
        .select("*")
    ).error,
  );
  pass(
    "information notices stay inbox-free; real administrative cursors are bounded and future starts remain explicitly manual",
  );
  console.log(`${checks} actual Auth/MFA/REST announcement groups passed.`);
});
