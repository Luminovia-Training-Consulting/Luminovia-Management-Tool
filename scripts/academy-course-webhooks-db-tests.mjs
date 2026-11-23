/** Exercise both licensed academy editions against the shared queue and real signed receiver. */
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import {
  configureAcademyCourseAccess,
  prepareAcademyInstallation,
} from "./academy-installation.mjs";
import { signAcademyLicence } from "./academy-licence.mjs";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";
import { verifyWebhookDeliveryHttp } from "./testing/company-course-webhook-http.mjs";

for (const edition of ["customer-managed", "customer-self-hosted"]) {
  await withTestDatabase("academy_course_webhooks", async ({ actor, sql }) => {
    const [
      admin,
      manager,
      participant,
      company,
      foreign,
      course,
      next,
      afterRevocation,
      rotatedCourse,
      outside,
      template,
    ] = Array.from({ length: 11 }, randomUUID);
    const now = Date.now();
    const date = (days) => new Date(now + days * 86_400_000).toISOString();
    const terms = {
      installation_id: randomUUID(),
      edition,
      release_commit: "ca".repeat(20),
      issued_at: date(-4),
      starts_at: date(-3),
      expires_at: date(2),
      grace_until: date(4),
      modules: ["lms"],
      limits: {
        seat_count: 10,
        storage_bytes: 4_000_000,
        api_requests_per_minute: 100,
      },
    };
    const keys = generateKeyPairSync("ed25519");
    const options = {
      envelope: signAcademyLicence(terms, keys.privateKey),
      publicKey: keys.publicKey,
      expected: terms,
      now,
    };
    await prepareAcademyInstallation(options, sql);
    await configureAcademyCourseAccess({ ...options, enabled: true }, sql);
    await sql(`
      insert into auth.users(id,email,email_confirmed_at) values
        (${q(admin)},'webhook-admin@example.invalid',now()),
        (${q(manager)},'webhook-manager@example.invalid',now()),
        (${q(participant)},'webhook-participant@example.invalid',now());
      insert into public.user_roles(user_id,role) values
        (${q(admin)},'admin'),(${q(manager)},'management'),(${q(participant)},'participant');
      insert into public.organisations(id,name) values (${q(company)},'Example academy organisation'),(${q(foreign)},'Unrelated organisation');
      insert into public.course_templates(id,title) values (${q(template)},'Fictional private course');
      insert into public.course_runs(id,template_id,organisation_id) values
        (${q(course)},${q(template)},${q(company)}),(${q(next)},${q(template)},${q(company)}),
        (${q(afterRevocation)},${q(template)},${q(company)}),(${q(rotatedCourse)},${q(template)},${q(company)}),
        (${q(outside)},${q(template)},${q(foreign)});`);

    const request = (name, method = "POST", profile = "public") =>
      "set local request.method=" +
      q(method) +
      "; set local request.path=" +
      q("/rpc/" + name) +
      "; set local request.headers=" +
      q(JSON.stringify({ "content-profile": profile })) +
      "; select public.require_portal_access(); ";
    const rpc = (who, name, args = "", method) =>
      actor(
        who,
        request(name, method) + "select public." + name + "(" + args + ")",
      );
    const subscribe = (who, organisation, alias) =>
      rpc(
        who,
        "academy_subscribe_course_webhook",
        q(organisation) + "," + q(alias),
      ).then(JSON.parse);
    const list = (who, organisation) =>
      rpc(who, "company_course_webhook_list", q(organisation)).then(JSON.parse);
    const revoke = (who, organisation, subscription) =>
      rpc(
        who,
        "academy_revoke_course_webhook",
        q(organisation) + "," + q(subscription),
      );
    const readService = (name, args, withGate = true) =>
      sql(
        "begin; set local role service_role; " +
          (withGate ? request(name) : "") +
          "select coalesce(public." +
          name +
          "(" +
          args +
          "),'null'); commit;",
      ).then(JSON.parse);
    const lease = (alias, organisation = company, withGate = true) =>
      readService(
        "lease_company_course_webhook",
        "array[" + q(organisation + "/" + alias) + "]",
        withGate,
      );
    const prepare = (receipt, withGate = true) =>
      readService(
        "prepare_company_course_webhook",
        q(receipt.id) + "," + q(receipt.token),
        withGate,
      );
    const publish = (id) =>
      sql("update public.course_runs set published=true where id=" + q(id));

    for (const who of [manager, participant]) {
      await assert.rejects(subscribe(who, company, "timing"), /42501/);
      await assert.rejects(list(who, company), /42501/);
    }
    await assert.rejects(
      rpc(
        admin,
        "academy_subscribe_course_webhook",
        q(company) + ",'timing'",
        "GET",
      ),
      /42501/,
    );
    await assert.rejects(
      rpc(admin, "lease_company_course_webhook", "array['unknown']"),
      /42501/,
    );
    const courseIndexKeys = (who) =>
      rpc(who, "company_integration_keys", q(company)).then(JSON.parse);
    await assert.rejects(courseIndexKeys(manager), /42501/);
    assert.deepEqual(await courseIndexKeys(admin), []);
    await assert.rejects(
      subscribe(admin, company, "https://example.invalid"),
      /22023/,
    );
    await assert.rejects(subscribe(admin, randomUUID(), "unknown"), /42501/);

    // Concurrent duplicate aliases may expose a signing secret only once.
    const subscriptionsRace = await Promise.allSettled([
      subscribe(admin, company, "timing"),
      subscribe(admin, company, "timing"),
    ]);
    const [successful] = subscriptionsRace.filter(
      ({ status }) => status === "fulfilled",
    );
    const [duplicate] = subscriptionsRace.filter(
      ({ status }) => status === "rejected",
    );
    assert.ok(successful && duplicate);
    assert.match(duplicate.reason.message, /23505/);
    const signing = successful.value;
    assert.match(signing.signing_secret, /^[0-9a-f]{64}$/);
    await assert.rejects(subscribe(admin, company, "timing"), /23505/);
    assert.equal((await list(admin, company)).length, 1);
    assert.deepEqual(await courseIndexKeys(admin), []);
    assert.doesNotMatch(
      JSON.stringify(await list(admin, company)),
      /secret|credential/,
    );
    assert.deepEqual(await list(admin, foreign), []);
    await assert.rejects(revoke(admin, foreign, signing.id), /42501/);
    await sql(
      "begin; update public.course_runs set published=true where id=" +
        q(course) +
        "; rollback;",
    );
    assert.equal(await lease("timing"), null);
    await publish(outside);
    assert.equal(await lease("timing"), null);
    assert.equal(await lease("timing", foreign), null);
    await publish(course);

    const subscriptions = await verifyWebhookDeliveryHttp({
      sql,
      course,
      subscription: signing,
      destination: company + "/timing",
      publishNext: () => publish(next),
      revoke: () => revoke(admin, company, signing.id),
      readHistory: () => list(admin, company),
      replaceSubscription: async (dispatch) => {
        await publish(afterRevocation);
        assert.equal(
          await dispatch(),
          0,
          "Revoked subscriptions cannot receive future events",
        );
        return {
          subscription: await subscribe(admin, company, "timing"),
          resource: rotatedCourse,
          publish: () => publish(rotatedCourse),
        };
      },
      enforcePortalGate: true,
    });
    const afterRevoke = await list(admin, company);
    const old = afterRevoke.find(({ id }) => id === subscriptions.retired);
    assert.equal(old.active, false);
    assert.deepEqual(old.deliveries.map(({ state }) => state).sort(), [
      "cancelled",
      "delivered",
    ]);
    assert.equal(
      afterRevoke.find(({ id }) => id === subscriptions.active).active,
      true,
    );
    await revoke(admin, company, subscriptions.active);
    assert.equal(
      await sql(
        "select count(*) from private.company_integration_keys where purpose='academy-webhook' and revoked_at is null",
      ),
      "0",
    );

    await subscribe(admin, company, "licence-sync");
    await sql(`
      insert into public.course_sessions(id,course_run_id,starts_at,ends_at)
        values(gen_random_uuid(),${q(course)},now()+interval '1 day',now()+interval '25 hours');`);
    const queued = await lease("licence-sync");
    assert.ok(queued);
    assert.equal((await prepare(queued)).event.type, "course.schedule_changed");
    await assert.rejects(
      sql(
        "begin; set local role service_role; " +
          request("prepare_company_course_webhook", "POST", "private") +
          "commit;",
      ),
      /42501/,
    );
    await assert.rejects(
      sql(
        "begin; set local role service_role; " +
          request("integration_course_index", "GET") +
          "commit;",
      ),
      /42501/,
    );
    await sql(
      "delete from public.user_roles where role='admin' and user_id=" +
        q(admin),
    );
    assert.equal(await prepare(queued), null);
    await assert.rejects(subscribe(admin, company, "denied"), /42501/);
    await sql(
      "insert into public.user_roles(user_id,role) values (" +
        q(admin) +
        ",'admin')",
    );

    const dormant = {
      ...terms,
      issued_at: date(-2),
      starts_at: date(-1.5),
      expires_at: date(-0.5),
    };
    await sql(
      "select private.apply_verified_installation_licence(" +
        q(JSON.stringify(dormant)) +
        "::jsonb);",
    );
    await assert.rejects(prepare(queued), /42501/);
    assert.equal(await prepare(queued, false), null);
    await assert.rejects(subscribe(admin, company, "grace-denied"), /42501/);

    const upgrade = {
      ...terms,
      issued_at: date(-1),
      starts_at: date(-0.75),
      release_commit: "bd".repeat(20),
    };
    await sql(
      "select private.apply_verified_installation_licence(" +
        q(JSON.stringify(upgrade)) +
        "::jsonb);",
    );
    await sql(
      `select private.configure_academy_course_access(${q(upgrade.installation_id)},${q(upgrade.release_commit)},true)`,
    );
    assert.equal(await prepare(queued), null);
    await sql(
      `update private.company_course_webhook_deliveries set available_at=now()-interval '1 second' where id=${q(queued.id)}`,
    );
    assert.equal(await lease("licence-sync"), null);
    await sql(`
      insert into public.course_sessions(id,course_run_id,starts_at,ends_at)
        values(gen_random_uuid(),${q(course)},now()+interval '2 days',now()+interval '49 hours');`);
    const newLease = await lease("licence-sync");
    assert.notEqual(newLease.id, queued.id);
    assert.equal((await prepare(newLease)).event.course_id, course);
    assert.equal(
      await sql(
        `select academy_release_commit from private.company_course_webhook_deliveries where id=${q(newLease.id)}`,
      ),
      upgrade.release_commit,
    );
    await sql(`begin; set local role service_role; ${request("finish_company_course_webhook")}
      select public.finish_company_course_webhook(${q(newLease.id)},${q(newLease.token)},'delivered'); commit;`);
    const material = randomUUID();
    const version = randomUUID();
    await sql(`
      insert into public.documents(id,owner_id,uploaded_by,client_id,scope,kind,original_name,mime_type,size_bytes,status)
        values (${q(material)},${q(admin)},${q(admin)},gen_random_uuid(),'personal','material','Fictional lesson.pdf','application/pdf',10,'clean');
      insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,status,sha256)
        values (${q(version)},${q(material)},${q(admin)},gen_random_uuid(),1,'fixture/lesson','Fictional lesson.pdf','application/pdf',10,'clean',repeat('a',64));
      insert into private.course_resources(run_id,version_id,audience,category,created_by)
        values (${q(course)},${q(version)},'staff','material',${q(admin)});`);
    assert.equal(await lease("licence-sync"), null);
    await sql(`insert into private.course_resources(run_id,version_id,audience,category,created_by)
      values (${q(course)},${q(version)},'participants','material',${q(admin)});`);
    const shared = await lease("licence-sync");
    assert.equal(
      (await prepare(shared)).event.type,
      "course.material_published",
    );
    console.log(
      "PASS",
      edition,
      "signed HTTP receipt, attempt history, deduplication, rotation, organisation scope, revocation, and exact release binding",
    );
  });
}
