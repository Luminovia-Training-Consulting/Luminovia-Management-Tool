import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { z } from "zod";
import { academyOpenApi } from "../src/features/developer-api/academy-contract.ts";
import { prepareAcademyInstallation } from "./academy-installation.mjs";
import { signAcademyLicence } from "./academy-licence.mjs";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

for (const edition of ["customer-managed", "customer-self-hosted"]) {
  await withTestDatabase("academy_notifications", async ({ sql, actor }) => {
    const [
      installation,
      org,
      template,
      course,
      session,
      manager,
      teacher,
      learner,
      peer,
    ] = Array.from({ length: 9 }, randomUUID);
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const time = (days) => new Date(Date.now() + days * 86400000).toISOString();
    const terms = {
      installation_id: installation,
      edition,
      release_commit: "ab".repeat(20),
      issued_at: time(-7),
      starts_at: time(-6),
      expires_at: time(3),
      grace_until: time(4),
      modules: ["lms"],
      limits: {
        seat_count: 20,
        storage_bytes: 2000000,
        api_requests_per_minute: 60,
      },
    };
    await prepareAcademyInstallation(
      {
        envelope: signAcademyLicence(terms, privateKey),
        publicKey,
        expected: terms,
        now: Date.now(),
      },
      sql,
    );
    const configure = (active) =>
      sql(
        `select private.configure_academy_course_access(${q(installation)},${q(terms.release_commit)},${active})`,
      );
    await configure(true);
    const accounts = [
      [manager, "admin"],
      [teacher, "lecturer"],
      [learner, "participant"],
      [peer, "participant"],
    ];
    await sql(`
      insert into auth.users(id,email,email_confirmed_at) values ${accounts.map(([id]) => `(${q(id)},${q(id + "@example.invalid")},now())`).join(",")};
      insert into public.user_roles(user_id,role) values ${accounts.map(([id, role]) => `(${q(id)},${q(role)})`).join(",")};
      insert into public.organisations(id,name) values(${q(org)},'Fictional Academy');
      insert into public.course_templates(id,title) values(${q(template)},'Fictional private workshop');
      insert into public.course_runs(id,template_id,organisation_id) values(${q(course)},${q(template)},${q(org)});
      insert into public.course_sessions(id,course_run_id,starts_at,ends_at) values(${q(session)},${q(course)},now()+interval '1 day',now()+interval '25 hours');
      update private.delivery_preferences set email_enabled=true where user_id in (${q(learner)},${q(peer)});
    `);
    for (const student of [learner, peer]) {
      const link = randomUUID();
      await sql(`insert into private.company_participant_link_requests(id,organisation_id,requested_by,request_id,luminovia_user_id,target_user_id,status,expires_at)
          select ${q(link)},${q(org)},${q(manager)},${q(randomUUID())},luminovia_user_id,id,'accepted',now()+interval '1 day' from public.profiles where id=${q(student)};
        insert into private.company_participant_memberships(organisation_id,user_id,status,link_request_id,invited_by,joined_at)
          values(${q(org)},${q(student)},'active',${q(link)},${q(manager)},now());`);
    }
    const request = (who, endpoint, args = "", method = "POST") =>
      actor(
        who,
        `set local request.path=${q("/rpc/" + endpoint)};
      set local request.method=${q(method)}; select public.require_portal_access();
      select public.${endpoint}(${args});`,
      );
    const load = (who, args = "") =>
      request(who, "notification_inbox", args).then(JSON.parse);
    const mark = (who, ids, read = true) =>
      request(
        who,
        "mark_notifications",
        `array[${ids.map(q).join(",")}]::uuid[],null,${read}`,
      );
    await request(
      manager,
      "academy_assign_course_instructor",
      `${q(course)},${q(teacher)},${q(randomUUID())}`,
    );
    await request(
      manager,
      "manage_course_enrolment",
      `${q(course)},${q(learner)},'enrolled'`,
    );
    const room = await request(
      manager,
      "academy_ensure_course_chat",
      q(course),
    );
    const message = await request(
      teacher,
      "send_course_chat_message",
      `${q(room)},'Fictional private message content',${q(randomUUID())}`,
    );
    const file = randomUUID(),
      version = randomUUID();
    const bytes = "Fictional exact course handout";
    const digest = createHash("sha256").update(bytes).digest("hex");
    await sql(`insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id)
      values(${q(file)},${q(teacher)},${q(teacher)},'personal','material','fictional-handout.txt','text/plain',${bytes.length},'clean',${q(randomUUID())});
      insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,status,sha256,scanner_version)
      values(${q(version)},${q(file)},${q(teacher)},${q(randomUUID())},1,${q("fictional/" + version)},'fictional-handout.txt','text/plain',${bytes.length},'clean',${q(digest)},'Fictional scanner receipt');
      update public.documents set current_version_id=${q(version)} where id=${q(file)};`);
    const published = JSON.parse(
      await request(
        teacher,
        "academy_course_material_action",
        `${q(course)},'resource_share',${q(version)},'participants','material'`,
      ),
    );
    await sql(
      `update public.course_sessions set starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour' where id=${q(session)};`,
    );
    await request(
      teacher,
      "save_course_session_attendance",
      `${q(course)},${q(session)},${q(learner)},'present',null,null,'Fictional private register note','',0`,
    );
    const hidden = randomUUID();
    await sql(
      `insert into public.notifications(id,user_id,kind,resource_id) values(${q(hidden)},${q(learner)},'claim_confirmed',${q(randomUUID())});`,
    );

    const inbox = await load(learner);
    const api = academyOpenApi("https://fictional.example.invalid", {
      name: "Fictional Academy",
      installationId: installation,
      edition,
    });
    assert.equal(
      z
        .fromJSONSchema(
          api.paths["/rest/v1/rpc/notification_inbox"].post.responses["200"]
            .content["application/json"].schema,
        )
        .safeParse(inbox).success,
      true,
    );
    assert.equal(inbox.unread_count, 4);
    assert.deepEqual(inbox.items.map(({ kind }) => kind).sort(), [
      "academy_course_enrolled",
      "chat_message",
      "course_attendance_updated",
      "course_resource_shared",
    ]);
    assert.equal(
      inbox.items.find(({ kind }) => kind === "academy_course_enrolled").href,
      `/courses/${course}/workspace`,
    );
    assert.equal(
      inbox.items.find(({ kind }) => kind === "chat_message").href,
      `/courses/${course}/workspace#course-chat`,
    );
    assert.equal(
      inbox.items.find(({ kind }) => kind === "course_resource_shared").href,
      `/courses/${course}/workspace#course-materials`,
    );
    for (const secret of [
      "Fictional private message content",
      "fictional-handout.txt",
      "Fictional private register note",
      hidden,
    ])
      assert.ok(!JSON.stringify(inbox).includes(secret));
    assert.deepEqual((await load(peer)).items, []);
    assert.equal(
      await sql("select count(*) from private.notification_email_outbox"),
      "0",
    );
    assert.equal(
      await sql("select count(*) from private.notification_push_outbox"),
      "0",
    );
    assert.equal(
      await sql(
        `select private.notification_delivery_allowed(${q(learner)},'chat_message',${q(message)})`,
      ),
      "f",
    );
    const page = await load(learner, "false,null,null,1");
    assert.equal(page.items.length, 1);
    const cursor = page.items[0];
    assert.equal(
      (await load(learner, `false,${q(cursor.created_at)},${q(cursor.id)},1`))
        .items.length,
      1,
    );
    await assert.rejects(mark(peer, [cursor.id]), /42501/);
    await assert.rejects(mark(learner, [cursor.id, hidden]), /42501/);
    assert.equal((await load(learner)).unread_count, 4);
    assert.equal(await mark(learner, [cursor.id]), "1");
    assert.equal((await load(learner, "true")).unread_count, 3);
    await assert.rejects(
      request(learner, "mark_notifications", "", "GET"),
      /42501/,
    );
    await assert.rejects(
      actor(
        learner,
        "set local request.path='/notifications'; set local request.method='GET'; select public.require_portal_access()",
      ),
      /42501/,
    );

    const acknowledgement = `${q(course)},'resource_acknowledge',${q(JSON.stringify({ id: published.id }))}`;
    await assert.rejects(
      request(peer, "academy_learning_action", acknowledgement),
      /42501/,
    );
    assert.equal(
      JSON.parse(
        await request(learner, "academy_learning_action", acknowledgement),
      ).id,
      published.id,
    );
    await request(learner, "academy_learning_action", acknowledgement);
    assert.equal(
      await sql(
        `select count(*) from private.course_resource_acknowledgements where resource_id=${q(published.id)}`,
      ),
      "1",
    );
    await request(
      teacher,
      "academy_course_material_action",
      `${q(course)},'resource_remove',${q(published.id)}`,
    );
    await assert.rejects(
      request(learner, "academy_learning_action", acknowledgement),
      /42501/,
    );
    assert.ok(
      !(await load(learner)).items.some(
        ({ kind }) => kind === "course_resource_shared",
      ),
    );
    await configure(false);
    await assert.rejects(load(learner), /42501/);
    await configure(true);
    await sql(
      `select private.apply_verified_installation_licence(${q(JSON.stringify({ ...terms, issued_at: time(-5), starts_at: time(-4), expires_at: time(-1) }))})`,
    );
    assert.equal((await load(learner)).items.length, 3);
    await assert.rejects(mark(learner, [cursor.id]), /42501/);
    await sql(
      `select private.apply_verified_installation_licence(${q(JSON.stringify({ ...terms, issued_at: time(-3), starts_at: time(-2) }))})`,
    );
    await request(
      manager,
      "manage_course_enrolment",
      `${q(course)},${q(learner)},'removed'`,
    );
    assert.deepEqual((await load(learner)).items, []);
    assert.equal(
      await sql(
        `select count(*) from public.notifications where user_id=${q(learner)}`,
      ),
      "5",
    );
    console.log(
      `PASS ${edition}: committed course inbox, paging/mark, current scope and no external queues`,
    );
  });
}
