/** Verify active-only H5P import and scoped attribution in both dedicated Academy editions. */
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import {
  configureAcademyCourseAccess,
  prepareAcademyInstallation,
} from "./academy-installation.mjs";
import { signAcademyLicence } from "./academy-licence.mjs";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

for (const edition of ["customer-self-hosted", "customer-managed"]) {
  await withTestDatabase("academy_hfivep_import", async ({ sql, actor }) => {
    const [
      installation,
      admin,
      absentTeacher,
      learner,
      company,
      template,
      run,
      linkRequest,
    ] = Array.from({ length: 8 }, randomUUID);
    const now = Date.now();
    const date = (offset) => new Date(now + offset * 86_400_000).toISOString();
    const terms = {
      installation_id: installation,
      edition,
      release_commit: "bb".repeat(20),
      issued_at: date(-3),
      starts_at: date(-2),
      expires_at: date(2),
      grace_until: date(5),
      modules: ["lms"],
      limits: {
        seat_count: 10,
        storage_bytes: 10_000_000,
        api_requests_per_minute: 60,
      },
    };
    const key = generateKeyPairSync("ed25519");
    const licence = {
      envelope: signAcademyLicence(terms, key.privateKey),
      publicKey: key.publicKey,
      expected: terms,
      now,
    };
    await prepareAcademyInstallation(licence, sql);
    await configureAcademyCourseAccess({ ...licence, enabled: true }, sql);
    await sql(`
      insert into auth.users(id,email,email_confirmed_at) values
        (${q(admin)},'manager@example.invalid',now()), (${q(absentTeacher)},'lecturer@example.invalid',now()),
        (${q(learner)},'participant@example.invalid',now());
      insert into public.user_roles(user_id,role) values
        (${q(admin)},'admin'), (${q(absentTeacher)},'lecturer'), (${q(learner)},'participant');
      insert into public.organisations(id,name) values (${q(company)},'Fictional Academy');
      insert into public.course_templates(id,title) values (${q(template)},'Fictional Academy course');
      insert into public.course_runs(id,template_id,organisation_id,published)
        values (${q(run)},${q(template)},${q(company)},true);
      insert into public.course_sessions(course_run_id,starts_at,ends_at)
        values (${q(run)},now()-interval '2 hours',now()-interval '1 hour');
      insert into private.company_participant_link_requests
        (id,organisation_id,requested_by,request_id,luminovia_user_id,target_user_id,status,expires_at)
        select ${q(linkRequest)},${q(company)},${q(admin)},${q(randomUUID())},luminovia_user_id,id,'accepted',now()+interval '1 day'
        from public.profiles where id=${q(learner)};
      insert into private.company_participant_memberships(organisation_id,user_id,status,link_request_id,invited_by,joined_at)
        values (${q(company)},${q(learner)},'active',${q(linkRequest)},${q(admin)},now());
      insert into public.course_enrolments(course_run_id,user_id,status,enrolled_by)
        values (${q(run)},${q(learner)},'enrolled',${q(admin)});
    `);
    const gate = (path, method) =>
      `set local request.path=${q("/rpc/" + path)};
       set local request.method=${q(method)};
       set local request.headers='{"accept-profile":"public","content-profile":"public"}';
       select public.require_portal_access();`;
    const payload = {
      package_sha256: "ab".repeat(32),
      attribution: {
        title: "Fictional Academy true/false",
        language: "en",
        library: "H5P.TrueFalse 1.8",
        license: "CC0-1.0",
        authors: [],
        source_url: null,
        license_notice: null,
        changes: [],
      },
      question: {
        prompt: "The sample is synthetic.",
        options: ["True", "False"],
        correct: 0,
      },
    };
    const command = `select public.course_h5p_question_import(${q(run)},${q(JSON.stringify(payload))})`;
    const submit = (who) =>
      actor(who, gate("course_h5p_question_import", "POST") + command);
    const bank = async () =>
      JSON.parse(
        (
          await actor(
            admin,
            gate("course_question_bank", "GET") +
              `select public.course_question_bank(${q(run)})`,
          )
        ).trim(),
      );
    await assert.rejects(submit(learner), /42501/);
    await assert.rejects(submit(absentTeacher), /42501/);
    const imported = JSON.parse((await submit(admin)).trim());
    assert.equal(imported.revision, 1);
    assert.deepEqual(imported.h5p_attribution, payload.attribution);
    const collection = {
      package_sha256: "ac".repeat(32),
      attribution: {
        ...payload.attribution,
        title: "Fictional collection",
        library: "H5P.SingleChoiceSet 1.11",
      },
      questions: [
        {
          question: { ...payload.question, prompt: "Item one" },
          library: "H5P.SingleChoiceSet 1.11",
          subcontent: null,
        },
        {
          question: { ...payload.question, prompt: "Item two" },
          library: "H5P.SingleChoiceSet 1.11",
          subcontent: null,
        },
      ],
    };
    const collectionCommand = `select public.course_h5p_collection_import(${q(run)},${q(JSON.stringify(collection))})`;
    const submitCollection = (who) =>
      actor(
        who,
        gate("course_h5p_collection_import", "POST") + collectionCommand,
      );
    await assert.rejects(submitCollection(learner), /42501/);
    await assert.rejects(submitCollection(absentTeacher), /42501/);
    const collectionReceipt = JSON.parse(
      (await submitCollection(admin)).trim(),
    );
    assert.equal(collectionReceipt.questions.length, 2);
    assert.deepEqual(
      JSON.parse((await submitCollection(admin)).trim()),
      collectionReceipt,
    );
    await sql(`update private.installation_verified_licence set expires_at=now()-interval '1 second'
      where installation_id=${q(installation)}`);
    assert.equal((await bank()).items[0].can_edit, false);
    assert.deepEqual(
      (await bank()).items.find(({ id }) => id === imported.id).h5p_attribution,
      payload.attribution,
    );
    await assert.rejects(submit(admin), /42501/);
    await assert.rejects(actor(admin, command), /42501/);
    await assert.rejects(submitCollection(admin), /42501/);
    await assert.rejects(actor(admin, collectionCommand), /42501/);
    const graceItems = (await bank()).items;
    assert.deepEqual(
      graceItems
        .filter(({ id }) =>
          collectionReceipt.questions.some((question) => question.id === id),
        )
        .map(({ h5p_attribution }) => h5p_attribution),
      [collection.attribution, collection.attribution],
    );
    await sql(`update private.installation_verified_licence set grace_until=now()-interval '1 second'
      where installation_id=${q(installation)}`);
    await assert.rejects(bank(), /42501/);
    console.log(
      `PASS ${edition} H5P attribution during active/grace and denied writes after expiry`,
    );
  });
}
