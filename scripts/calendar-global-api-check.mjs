/** Native Auth/password-only authentication/REST contract. Discovered only by the canonical disposable gate. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { withApiFixture } from "./testing/api.mjs";
import { quoteSql as q } from "./testing/database.mjs";
await withApiFixture(
  async ({ actor, passwordOnly, service, checked, sql, defer, url, suffix }) => {
    const admin = await actor("calendar-global-admin", "admin"),
      manager = await actor("calendar-global-manager", "management"),
      teacher = await actor("calendar-global-teacher", "lecturer"),
      client = await actor("calendar-global-client", "client");
    const ids = new Set();
    defer(async () => {
      if (ids.size)
        await sql(
          `delete from public.global_events where id in(${[...ids].map(q).join(",")})`,
        );
      await checked(
        service.from("personal_events").delete().eq("user_id", teacher.id),
        "Remove own private fixture",
      );
    });
    const body = {
      title: `Fictional calendar ${suffix}`,
      description: "Fictional <script> plain text",
      link_url: "https://example.invalid/lesson",
      starts_at: "2060-03-28T00:30:45Z",
      ends_at: "2060-03-28T02:30:45Z",
      time_zone: "Europe/Berlin",
    };
    const args = (id, action, version, payload = {}, key = randomUUID()) => ({
      p_id: id,
      p_action: action,
      p_expected_version: version,
      p_request_id: key,
      p_payload: payload,
    });
    const list = (who = teacher, extra = {}) =>
      checked(
        who.client.rpc("global_calendar_events", {
          p_from: "2060-03-01T00:00Z",
          p_to: "2060-04-10T00:00Z",
          p_search: suffix,
          ...extra,
        }),
        "Current authorized calendar range",
      );
    const mutate = (request, who = admin) =>
      checked(
        who.client.rpc("manage_global_event", request),
        "Actual global calendar operation",
      );
    // The current admin permission works on the password-only session below;
    // no MFA assurance gate is part of this API boundary.
    assert.equal(
      (
        await teacher.client.rpc(
          "manage_global_event",
          args(null, "save", 0, body),
        )
      ).error?.code,
      "42501",
    );
    await passwordOnly(admin.client);
    await passwordOnly(manager.client);
    const create = args(null, "save", 0, body);
    let event = await mutate(create);
    ids.add(event.id);
    assert.deepEqual(await mutate(create), event);
    assert.equal(event.version, 1);
    assert.equal(event.published, false);
    assert.equal((await list()).items.length, 0);
    assert.equal((await list(client)).items.length, 0);
    assert.equal((await list(admin, { p_manage: true })).items[0].id, event.id);
    assert.equal(
      (
        await teacher.client.rpc("global_calendar_events", {
          p_from: body.starts_at,
          p_to: body.ends_at,
          p_manage: true,
        })
      ).error?.code,
      "42501",
    );
    assert.equal(
      (
        await checked(
          teacher.client.from("global_events").select("id").eq("id", event.id),
          "Direct RLS draft read",
        )
      ).length,
      0,
    );
    for (const link of [
      "http://example.invalid",
      "javascript:alert(1)",
      "https://secret@example.invalid",
      "https://example.invalid\\@evil.invalid",
      "https://example.invalid:99999",
      "https://example..invalid",
      "https://999.999.999.999",
    ])
      assert.equal(
        (
          await admin.client.rpc(
            "manage_global_event",
            args(event.id, "save", 1, { ...body, link_url: link }),
          )
        ).error?.code,
        "22023",
      );
    const publication = args(event.id, "publish", event.version);
    event = await mutate(publication);
    assert.deepEqual(await mutate(publication), event);
    assert.equal((await list()).items[0].description, body.description);
    assert.equal((await list(client)).items[0].id, event.id);
    const competing = await Promise.all([
      admin.client.rpc(
        "manage_global_event",
        args(event.id, "save", event.version, {
          ...body,
          description: "Fictional competing A",
        }),
      ),
      manager.client.rpc(
        "manage_global_event",
        args(event.id, "save", event.version, {
          ...body,
          description: "Fictional competing B",
        }),
      ),
    ]);
    assert.equal(competing.filter((r) => !r.error).length, 1);
    assert.equal(competing.find((r) => r.error).error.code, "40001");
    event = competing.find((r) => !r.error).data;
    assert.equal(
      (await list()).items.length,
      0,
      "Edits explicitly withdraw publication",
    );
    event = await mutate(args(event.id, "publish", event.version));
    event = await mutate(args(event.id, "unpublish", event.version));
    assert.equal((await list()).items.length, 0);
    event = await mutate(args(event.id, "archive", event.version));
    assert.ok(event.archived_at);
    assert.equal(
      (
        await admin.client.rpc(
          "manage_global_event",
          args(event.id, "publish", event.version),
        )
      ).error?.code,
      "22023",
    );
    event = await mutate(args(event.id, "recover", event.version));
    assert.equal(event.published, false);
    assert.equal(event.archived_at, null);
    const rows = Array.from({ length: 105 }, (_, n) => ({
      id: randomUUID(),
      title: `Page ${suffix} ${n}`,
      starts_at: body.starts_at,
      ends_at: body.ends_at,
      time_zone: "Europe/Berlin",
      published: true,
      updated_at: "2040-01-01T00:00Z",
    }));
    for (const row of rows) ids.add(row.id);
    await checked(
      service.from("global_events").insert(rows),
      "Seed own same-time native pages",
    );
    const seen = [];
    let cursor = null;
    do {
      const page = await list(teacher, {
        p_search: `Page ${suffix}`,
        p_limit: 50,
        p_before_at: cursor?.at ?? null,
        p_before_id: cursor?.id ?? null,
      });
      assert.ok(page.items.length <= 50);
      seen.push(...page.items.map((row) => row.id));
      assert.equal(page.has_more, Boolean(page.next_cursor));
      cursor = page.next_cursor;
    } while (cursor);
    assert.deepEqual(
      seen,
      rows
        .map((row) => row.id)
        .sort()
        .reverse(),
    );
    assert.equal(
      (
        await teacher.client.rpc("global_calendar_events", {
          p_from: "2060-01-01T00:00Z",
          p_to: "2061-01-01T00:00Z",
        })
      ).error?.code,
      "22023",
    );
    await checked(
      teacher.client.from("personal_events").insert({
        user_id: teacher.id,
        title: `PRIVATE ${suffix}`,
        starts_at: body.starts_at,
        ends_at: body.ends_at,
      }),
      "Own private appointment",
    );
    assert.deepEqual(
      await checked(
        admin.client
          .from("personal_events")
          .select("id")
          .eq("user_id", teacher.id),
        "password-only authentication admin cannot read foreign personal event",
      ),
      [],
    );
    assert.ok(
      !(await list(admin, { p_manage: true })).items.some((row) =>
        row.title.startsWith("PRIVATE"),
      ),
    );
    await checked(
      admin.client.rpc("set_account_roles", {
        p_user_id: manager.id,
        p_roles: ["participant"],
      }),
      "Revoke own manager role",
    );
    assert.equal(
      (
        await manager.client.rpc(
          "manage_global_event",
          args(event.id, "publish", event.version),
        )
      ).error?.code,
      "42501",
    );
    await checked(
      teacher.client.auth.updateUser({
        data: { role: "admin", roles: ["admin"] },
      }),
      "Forge editable metadata",
    );
    assert.equal(
      (
        await teacher.client.rpc(
          "manage_global_event",
          args(event.id, "publish", event.version),
        )
      ).error?.code,
      "42501",
    );
    await checked(
      service.from("profiles").update({ active: false }).eq("id", client.id),
      "Suspend own active session",
    );
    assert.equal(
      (
        await client.client.rpc("global_calendar_events", {
          p_from: body.starts_at,
          p_to: body.ends_at,
        })
      ).error?.code,
      "42501",
    );
    const anonymous = createClient(url, process.env.SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    assert.ok(
      (
        await anonymous.rpc("global_calendar_events", {
          p_from: body.starts_at,
          p_to: body.ends_at,
        })
      ).error,
    );
    assert.ok((await anonymous.rpc("manage_global_event", create)).error);
    assert.ok(
      (
        await teacher.client
          .schema("private")
          .from("global_event_requests")
          .select("*")
      ).error,
    );
    console.log(
      "PASS actual Auth/password-only authentication/REST global calendar: private drafts/current publication, idempotent operations, CAS,105same-time paged rows, HTTPS/range validation, explicit edit withdrawal, archive/recover, old-token role/suspension/metadata/anonymous guards and no foreign private calendar bypass.",
    );
  },
);
