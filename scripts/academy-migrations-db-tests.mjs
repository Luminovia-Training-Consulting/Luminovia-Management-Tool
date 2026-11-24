import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import {
  configureAcademyCourseAccess,
  prepareAcademyInstallation,
  readAcademyInstallationStatus,
} from "./academy-installation.mjs";
import { signAcademyLicence } from "./academy-licence.mjs";
import {
  academyMigrationInventory,
  academyMigrationsScript,
  loadAcademyMigrations,
} from "./academy-migrations.mjs";
import {
  quoteSql as q,
  withMigrationReplayLock,
  withTestDatabase,
} from "./testing/database.mjs";

await withTestDatabase(
  "academy_migration",
  async ({ sql }) => {
    const installationId = randomUUID();
    const edition = "customer-self-hosted";
    const original = {
      version: "20700101000001",
      name: "fictional_initial",
      source:
        "begin; create table public.fictional_academy(id text primary key); commit;\n",
    };
    const upgrade = {
      version: "20700101000002",
      name: "fictional_upgrade",
      source:
        "begin; alter table public.fictional_academy add column active boolean not null default true; select false; commit;\n",
    };
    const apply = (...migrations) =>
      sql(academyMigrationsScript({ installationId, edition, migrations }));
    await assert.rejects(
      apply(original),
      /Native Auth, Storage and Realtime are not ready/,
    );
    await sql(`create schema storage;
    create table storage.objects(id uuid);
    create table storage.buckets(id text);
    create publication supabase_realtime;`);
    await sql(`insert into storage.objects values (${q(randomUUID())});`);
    await assert.rejects(apply(original), /populated internal database/);
    await sql("delete from storage.objects;");
    const failed = {
      ...original,
      source:
        "begin; create table public.fictional_academy(id text primary key); select 1/0; commit;\n",
    };
    await assert.rejects(apply(failed), /22012/);
    assert.equal(
      await sql("select to_regclass('public.fictional_academy') is null;"),
      "t",
    );
    assert.equal(
      await sql("select count(*) from supabase_migrations.schema_migrations"),
      "0",
    );
    assert.equal(JSON.parse(await apply(original)).migration_count, 1);
    await sql(`create schema private;
    create table private.installation_identity(installation_id uuid, edition text, singleton boolean);
    insert into private.installation_identity values (${q(installationId)}, ${q(edition)}, true);
    insert into auth.users(id,email) values (${q(randomUUID())},'retained@example.invalid');
    insert into public.fictional_academy values ('retained');`);
    await assert.rejects(
      sql(
        academyMigrationsScript({
          installationId: randomUUID(),
          edition,
          migrations: [original, upgrade],
        }),
      ),
      /dedicated database identity does not match/,
    );
    await assert.rejects(
      apply({ ...original, source: original.source + "\n" }, upgrade),
      /not an exact prefix/,
    );
    await assert.rejects(apply(upgrade), /not an exact prefix/);
    for (const receipt of await Promise.all([
      apply(original, upgrade),
      apply(original, upgrade),
    ])) {
      assert.deepEqual(JSON.parse(receipt), {
        migration_count: 2,
        last_version: upgrade.version,
      });
    }
    assert.equal(
      await sql("select id || ':' || active from public.fictional_academy"),
      "retained:true",
    );
    assert.equal(
      await sql(
        "select count(*) from auth.users where email='retained@example.invalid'",
      ),
      "1",
    );
    await assert.rejects(apply(original), /not an exact prefix/);
    console.log(
      "PASS native migration readiness, rollback, source prefix protection, independent target, concurrent retry and retained data",
    );
  },
  { migrationsThrough: "00000000000000" },
);

const installedRelease = "ef8a724fb0b8c71897cc7e22470bfad6bd2cf75f";
const ledger = await loadAcademyMigrations();
const legacy = ledger.find(({ version }) => version === "20261123021230");
assert.ok(legacy);
const baseline = ledger.filter(({ version }) => version <= "20261122030050");
const sha256 = (source) => createHash("sha256").update(source).digest("hex");
assert.equal(baseline.length, 259);
assert.equal(
  sha256(baseline.map(({ source }) => sha256(source)).join("\n") + "\n"),
  "5ed2235e57863c472c72b2c2dc425f7ca2d6394af3876e5157f2a765f1861b0f",
  "The Academy upgrade fixture must start with the exact ef8a724f migration inventory",
);

for (const edition of ["customer-self-hosted", "customer-managed"]) {
  await withTestDatabase(
    "academy_upgrade_retention",
    async ({ sql, actor, container }) => {
      const [
        installationId,
        manager,
        learner,
        outsider,
        organisation,
        template,
        course,
        link,
        document,
        version,
        resource,
        storageObject,
        messageRequest,
      ] = Array.from({ length: 13 }, randomUUID);
      await sql(`
        create schema storage;
        create table storage.buckets (id text primary key, name text, public boolean,
          file_size_limit bigint, allowed_mime_types text[]);
        create table storage.objects (id uuid primary key, bucket_id text references storage.buckets, name text);
        alter table storage.buckets enable row level security;
        alter table storage.objects enable row level security;
        grant usage on schema storage to authenticated;
        grant select on storage.objects to authenticated;
        create policy fictional_storage_access on storage.objects for select to authenticated using (true);
        create publication supabase_realtime;
      `);
      const apply = (migrations) =>
        withMigrationReplayLock(container, async () => {
          const receipt = JSON.parse(
            await sql(
              academyMigrationsScript({ installationId, edition, migrations }),
            ),
          );
          assert.deepEqual(receipt, {
            migration_count: migrations.length,
            last_version: migrations.at(-1).version,
          });
        });
      assert.throws(
        () =>
          academyMigrationsScript({
            installationId,
            edition,
            migrations: [{ ...legacy, source: legacy.source + "\n-- changed" }],
          }),
        /academy_migration_source/,
      );
      await apply(baseline);

      const now = Date.now();
      const date = (days) => new Date(now + days * 86_400_000).toISOString();
      const { privateKey, publicKey } = generateKeyPairSync("ed25519");
      const licence = (release_commit, issued) => {
        const expected = {
          installation_id: installationId,
          edition,
          release_commit,
          issued_at: date(issued),
          starts_at: date(-2),
          expires_at: date(15),
          grace_until: date(16),
          modules: ["lms"],
          limits: {
            seat_count: 10,
            storage_bytes: 500_000,
            api_requests_per_minute: 60,
          },
        };
        return {
          envelope: signAcademyLicence(expected, privateKey),
          publicKey,
          expected,
          now,
        };
      };
      const installed = licence(installedRelease, -5);
      const candidate = licence("ab".repeat(20), -3);
      const setAccess = (release, enabled) =>
        configureAcademyCourseAccess({ ...release, enabled }, sql);
      await prepareAcademyInstallation(installed, sql);
      await setAccess(installed, true);

      const rpc = (id, endpoint, input) =>
        actor(
          id,
          `set local request.path=${q("/rpc/" + endpoint)}; set local request.method='POST';
          select public.require_portal_access(); select public.${endpoint}(${input});`,
        );
      const accounts = [manager, learner, outsider];
      const body = "Fictional retained Academy message 🧑‍🏫";
      const objectPath = "fictional/retained-handbook.pdf";
      const digest = sha256("Fictional retained handbook");
      await sql(`
        insert into auth.users(id,email,email_confirmed_at) values
          ${accounts.map((id) => `(${q(id)},${q(id + "@example.invalid")},now())`).join(",")};
        insert into public.user_roles(user_id,role) values
          (${q(manager)},'admin'),(${q(learner)},'participant'),(${q(outsider)},'participant');
        insert into public.organisations(id,name) values (${q(organisation)},'Fictional Academy');
        insert into public.course_templates(id,title) values (${q(template)},'Fictional course');
        insert into public.course_runs(id,organisation_id,template_id,published)
          values (${q(course)},${q(organisation)},${q(template)},true);
        insert into private.company_participant_link_requests(id,organisation_id,requested_by,
          request_id,luminovia_user_id,target_user_id,status,expires_at)
          select ${q(link)},${q(organisation)},${q(manager)},${q(randomUUID())},luminovia_user_id,id,'accepted',now()+interval '2 days'
          from public.profiles where id=${q(learner)};
        insert into private.company_participant_memberships(organisation_id,user_id,status,link_request_id,invited_by,joined_at)
          values (${q(organisation)},${q(learner)},'active',${q(link)},${q(manager)},now());
        insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id)
          values (${q(document)},${q(manager)},${q(manager)},'personal','material','retained-handbook.pdf','application/pdf',27,'clean',${q(randomUUID())});
        insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,status,sha256,scanner_version)
          values (${q(version)},${q(document)},${q(manager)},${q(randomUUID())},1,${q(objectPath)},'retained-handbook.pdf','application/pdf',27,'clean',${q(digest)},'ClamAV fictional');
        insert into private.course_resources(id,run_id,version_id,audience,category,created_by)
          values (${q(resource)},${q(course)},${q(version)},'participants','material',${q(manager)});
        insert into storage.objects values (${q(storageObject)},'portal-clean',${q(objectPath)});
      `);
      await rpc(
        manager,
        "manage_course_enrolment",
        `${q(course)},${q(learner)},'enrolled'`,
      );
      // Keep a real learner result in the historical migration fixture. Changes
      // to current role checks or quiz projections must preserve the saved attempt.
      await sql(`insert into public.course_sessions(course_run_id,starts_at,ends_at)
        values (${q(course)},now()-interval '2 hours',now()-interval '1 hour')`);
      const activity = (actorId, action, payload, version = 0) =>
        rpc(
          actorId,
          "academy_learning_action",
          `${q(course)},${q(action)},${q(JSON.stringify(payload))},${version}`,
        ).then(JSON.parse);
      await activity(manager, "quiz_config", {
        questions: [
          {
            prompt: "Choose the fictional answer",
            options: ["A", "B"],
            correct: 1,
          },
        ],
        published: true,
        pass_percent: 80,
        max_attempts: 2,
      });
      const quizRequest = randomUUID();
      const savedQuiz = () =>
        activity(
          learner,
          "quiz_attempt",
          {
            answers: [1],
            request_id: quizRequest,
          },
          1,
        );
      const quizAttempt = await savedQuiz();
      assert.equal(quizAttempt.score, 100);
      assert.equal(quizAttempt.passed, true);
      const room = await rpc(manager, "academy_ensure_course_chat", q(course));
      const submit = () =>
        rpc(
          learner,
          "send_course_chat_message",
          `${q(room)},${q(body)},${q(messageRequest)}`,
        );
      const message = await submit();
      const history = (id) =>
        rpc(id, "course_chat_messages", q(room)).then(JSON.parse);
      const file = (id) =>
        rpc(id, "course_document_access", `'resource',${q(resource)}`).then(
          JSON.parse,
        );
      const readRetained = async () => {
        const auth = JSON.parse(
          await sql(`select jsonb_agg(row(id,email,email_confirmed_at) order by id)
          from auth.users where id in (${accounts.map(q).join(",")})`),
        );
        const object = await sql(
          `select concat_ws(':',id,bucket_id,name) from storage.objects where id=${q(storageObject)}`,
        );
        const workspace = JSON.parse(
          await rpc(learner, "course_workspace", q(course)),
        );
        const enrolment =
          await sql(`select concat_ws(':',course_run_id,user_id,status)
          from public.course_enrolments where course_run_id=${q(course)} and user_id=${q(learner)}`);
        const chat = await history(learner);
        const attachment = await file(learner);
        assert.equal(auth.length, accounts.length);
        assert.equal(
          object,
          [storageObject, "portal-clean", objectPath].join(":"),
        );
        assert.equal(workspace.id, course);
        assert.equal(workspace.quiz.attempts, 1);
        assert.equal(workspace.quiz.passed, true);
        assert.equal(workspace.quiz.last_score, 100);
        assert.equal(
          Object.hasOwn(workspace.quiz.questions[0], "correct"),
          false,
        );
        assert.equal(enrolment, [course, learner, "enrolled"].join(":"));
        assert.equal(
          await actor(
            learner,
            `select count(*) from storage.objects where id=${q(storageObject)}`,
          ),
          "0",
        );
        assert.equal(chat.length, 1);
        assert.equal(chat[0].id, message);
        assert.equal(chat[0].body, body);
        assert.equal(attachment.id, version);
        assert.equal(attachment.sha256, digest);
        await assert.rejects(
          rpc(outsider, "course_workspace", q(course)),
          /42501/,
        );
        await assert.rejects(history(outsider), /42501/);
        await assert.rejects(file(outsider), /42501/);
        return {
          auth,
          chat,
          attachment,
          object,
          enrolment,
          quiz: workspace.quiz,
        };
      };

      const before = await readRetained();
      await setAccess(installed, false);
      await assert.rejects(history(learner), /42501/);
      await assert.rejects(file(learner), /42501/);
      await apply(ledger);
      assert.equal(
        await sql(
          `select encode(sha256(convert_to(statements[1], 'UTF8')), 'hex')
           from supabase_migrations.schema_migrations where version = ${q(legacy.version)}`,
        ),
        sha256(legacy.source),
      );
      await prepareAcademyInstallation(candidate, sql);
      await setAccess(candidate, true);
      const status = await readAcademyInstallationStatus(
        { ...candidate, operationalInventory: true },
        sql,
      );
      assert.deepEqual(
        status.migration_ledger,
        academyMigrationInventory(ledger),
      );
      assert.deepEqual(status.quota_usage, {
        occupied_seats: 3,
        used_storage_bytes: 27,
      });
      assert.deepEqual(await readRetained(), before);
      assert.equal(await submit(), message);
      assert.deepEqual(await savedQuiz(), quizAttempt);
      await apply(ledger);
      assert.deepEqual(await readRetained(), before);
      console.log(
        `PASS ${edition} upgrade from ef8a724f: retained accounts, enrolment, quiz progress, course chat and exact clean-file metadata; role and idempotency checks`,
      );
    },
    { migrationsThrough: "00000000000000" },
  );
}
