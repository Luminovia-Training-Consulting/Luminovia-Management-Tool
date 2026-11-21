import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { portalOpenApi } from "../src/features/developer-api/contract.ts";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

const release = "a".repeat(40);
const gate = (endpoint, method = "POST") =>
  `set local request.path = ${q("/rpc/" + endpoint)}; set local request.method = ${q(method)}; select public.require_portal_access();`;

for (const edition of [
  "internal",
  "customer-self-hosted",
  "customer-managed",
]) {
  await withTestDatabase("course_chat_guards", async ({ sql, actor }) => {
    const [
      installation,
      admin,
      client,
      foreign,
      learner,
      company,
      other,
      template,
      course,
      sibling,
      separate,
      room,
      linkedRoom,
      separateRoom,
      directRoom,
    ] = Array.from({ length: 15 }, randomUUID);
    const api = portalOpenApi("https://example.invalid", true, {
      name: "Practice Academy",
      edition,
      installationId: installation,
    });
    const result = (endpoint) => z.fromJSONSchema(
      api.paths["/rest/v1/rpc/" + endpoint].post.responses["200"]
        .content["application/json"].schema,
    );
    const protectionSettings = result("course_chat_protection");
    const protectionUpdate = result("set_course_chat_protection");
    if (edition !== "internal") {
      const now = Date.now();
      const day = (offset) => new Date(now + offset * 86_400_000).toISOString();
      const terms = {
        installation_id: installation,
        edition,
        release_commit: release,
        issued_at: day(-2),
        starts_at: day(-1),
        expires_at: day(3),
        grace_until: day(5),
        modules: ["lms"],
        limits: {
          seat_count: 10,
          storage_bytes: 100000,
          api_requests_per_minute: 30,
        },
      };
      await sql(`
        select private.provision_customer_installation(${q(installation)},${q(edition)});
        select private.apply_verified_installation_licence(${q(JSON.stringify(terms))}::jsonb);
        select private.configure_academy_course_access(${q(installation)},${q(release)},true);
      `);
    }
    await sql(`
      insert into auth.users(id,email,email_confirmed_at) values
        (${q(admin)},'chat-admin@example.invalid',now()),
        (${q(client)},'chat-client@example.invalid',now()),
        (${q(foreign)},'chat-foreign@example.invalid',now()),
        (${q(learner)},'chat-learner@example.invalid',now());
      insert into public.user_roles(user_id,role) values
        (${q(admin)},'admin'),(${q(client)},'client'),(${q(foreign)},'client'),(${q(learner)},'participant');
      insert into public.organisations(id,name) values (${q(company)},'Fictional company'),(${q(other)},'Other fictional company');
      insert into public.client_organisation_memberships(user_id,organisation_id)
        values (${q(client)},${q(company)}),(${q(foreign)},${q(other)});
      insert into public.course_templates(id,title) values (${q(template)},'Fictional course');
      insert into public.course_runs(id,template_id,organisation_id) values
        (${q(course)},${q(template)},${q(company)}),(${q(sibling)},${q(template)},${q(company)}),(${q(separate)},${q(template)},${q(other)});
      insert into private.company_premium_settings(organisation_id,enabled)
        values (${q(company)},true),(${q(other)},true) on conflict(organisation_id) do update set enabled = true;
      insert into public.chat_rooms(id,kind,course_run_id,title) values
        (${q(room)},'participant_course',${q(course)},'Fictional room'),
        (${q(linkedRoom)},'participant_course',${q(sibling)},'Linked room'),
        (${q(separateRoom)},'participant_course',${q(separate)},'Independent room');
      insert into public.chat_rooms(id,kind,dm_key) values (${q(directRoom)},'dm',${q(randomUUID())});
      insert into public.chat_members(room_id,user_id) values
        (${q(room)},${q(admin)}),(${q(linkedRoom)},${q(admin)}),(${q(separateRoom)},${q(admin)}),(${q(directRoom)},${q(admin)});
    `);

    const read = (who, target = course) =>
      actor(
        who,
        gate("course_chat_protection") +
          `select public.course_chat_protection(${target === null ? "null" : q(target)})`,
      ).then((data) => protectionSettings.parse(JSON.parse(data)));
    const toggle = (who, global, enabled, revision, target = course) =>
      actor(
        who,
        gate("set_course_chat_protection") +
          `select public.set_course_chat_protection(${target === null ? "null" : q(target)},${global},${enabled},${revision})`,
      ).then((data) => protectionUpdate.parse(JSON.parse(data)));
    const send = (
      target,
      request = randomUUID(),
      content = "Fictional course message",
      raw = false,
    ) => {
      const endpoint =
        raw || target === directRoom
          ? "send_message"
          : "send_course_chat_message";
      return actor(
        admin,
        gate(endpoint) +
          `select public.${endpoint}(${q(target)},${q(content)},${q(request)})`,
      );
    };

    const off = { enabled: false, version: 0 };
    const on = { enabled: true, version: 1 };
    assert.deepEqual(await read(admin), {
      global: off,
      company: off,
      global_enforced: false,
      can_write: true,
    });
    assert.deepEqual(await read(client), {
      global: null,
      company: off,
      global_enforced: false,
      can_write: true,
    });
    await assert.rejects(read(learner), /42501/);
    await assert.rejects(read(foreign), /42501/);
    await assert.rejects(read(client, null), /42501/);
    await assert.rejects(toggle(client, true, true, 0), /42501/);
    await assert.rejects(toggle(foreign, false, true, 0), /42501/);
    for (const role of ["anon", "service_role"])
      await assert.rejects(
        sql(
          `begin; set local role ${role}; select public.course_chat_protection(); commit;`,
        ),
        /42501/,
      );
    assert.equal((await toggle(client, false, true, 0)).company.version, 1);
    assert.deepEqual((await toggle(client, false, true, 0)).company, on);
    await assert.rejects(toggle(client, false, false, 0), /PT409/);
    assert.deepEqual((await read(client, sibling)).company, on);
    assert.deepEqual((await read(foreign, separate)).company, off);

    const firstRequest = randomUUID();
    const first = await send(room, firstRequest);
    for (let i = 0; i < 6; i++) await send(i % 2 ? linkedRoom : room);
    const competing = await Promise.allSettled([
      send(room),
      send(linkedRoom, randomUUID(), "Parallel send", edition === "internal"),
    ]);
    assert.equal(
      competing.filter((result) => result.status === "fulfilled").length,
      1,
    );
    assert.match(
      competing.find((result) => result.status === "rejected").reason.message,
      /PT429/,
    );
    assert.equal(await send(room, firstRequest), first);
    await assert.rejects(send(room, firstRequest, "Changed retry"), /22023/);
    await assert.rejects(send(linkedRoom), /PT429/);
    assert.ok(await send(separateRoom));
    if (edition === "internal") assert.ok(await send(directRoom));
    else {
      const digest = "a".repeat(64);
      const draft = JSON.parse(
        await actor(
          admin,
          gate("reserve_academy_course_chat_file") +
            `select public.reserve_academy_course_chat_file(${q(room)},'fixture.txt','text/plain',8,${q(randomUUID())},${q(digest)})`,
        ),
      );
      const scan = (action, lease = null) =>
        sql(
          "begin; set local role service_role; " +
            gate("academy_course_material_scan") +
            `select public.academy_course_material_scan(${q(draft.document_id)},${q(draft.version_id)},${q(action)},${lease ? q(lease) : "null"},${action === "end" ? "null" : q(digest)},${action === "clean" ? "'ClamAV fixture'" : "null"}); commit;`,
        );
      const lease = await scan("begin");
      await scan("clean", lease);
      await scan("end", lease);
      await assert.rejects(
        actor(
          admin,
          gate("send_course_chat_attachment") +
            `select public.send_course_chat_attachment(${q(room)},'',${q(randomUUID())},${q(draft.document_id)},${q(draft.version_id)})`,
        ),
        /PT429/,
      );
    }

    assert.deepEqual((await toggle(admin, true, true, 0, null)).global, on);
    assert.equal((await read(foreign, separate)).global_enforced, true);
    assert.equal((await toggle(client, false, false, 1)).global_enforced, true);
    await assert.rejects(send(room), /PT429/);
    await sql(
      `update public.messages set created_at=clock_timestamp()-interval '61 seconds' where id=${q(first)}`,
    );
    assert.ok(await send(room));
    await assert.rejects(send(room), /PT429/);

    await sql(
      `update public.client_organisation_memberships set removed_at=now() where user_id=${q(client)}`,
    );
    await assert.rejects(read(client), /42501/);
    await assert.rejects(toggle(client, false, true, 2), /42501/);
    if (edition !== "internal") {
      await sql(
        `update private.installation_verified_licence set expires_at=now()-interval '1 minute'`,
      );
      assert.equal((await read(admin)).can_write, false);
      await assert.rejects(toggle(admin, true, false, 1), /42501/);
      await assert.rejects(send(room), /42501/);
      await sql(
        `select private.configure_academy_course_access(${q(installation)},${q(release)},false)`,
      );
      await assert.rejects(read(admin), /42501/);
    }
    assert.equal(
      await sql(
        "select count(*) from public.audit_events where action = 'course_chat.protection_changed'",
      ),
      "3",
    );
    assert.equal(
      await sql(
        "select has_table_privilege('authenticated','private.course_chat_protection_settings','select')",
      ),
      "f",
    );
    console.log(
      `PASS ${edition} selective chat protection, company isolation, global precedence, concurrency, retries, retention and revocation`,
    );
  });
}
