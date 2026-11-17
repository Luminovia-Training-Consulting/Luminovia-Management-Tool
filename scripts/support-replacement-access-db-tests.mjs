/** Exercise real document/message/file projection ACLs in owned UUID databases.
 * Default runs preserve current main policy and a stricter predecessor fixture.
 * PORTAL_REVIEW_PR17_COMMIT additionally replays that exact local Git object's
 * real migrations in chronological order; it never fetches or edits a branch.
 * Clean file metadata represents scanner output. Native HTTP/Storage byte tests
 * remain separate; these are the exact RLS rows read by the download gateway.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { promisify } from "node:util";
import {
  applyPasswordOnlyPermissionPolicy,
  withMigrationReplayLock,
  withTestDatabase,
  quoteSql as q,
} from "./testing/database.mjs";

const git = promisify(execFile);
const sourceRoot = new URL("../", import.meta.url);
// Replay the actual complete predecessor, including published qualification
// privacy, before applying the still-pending operational modules in order.
const replayFiles = (await readdir(new URL("supabase/migrations/", sourceRoot)))
  .filter((name) => name.endsWith(".sql"))
  .sort();
const readinessFile = replayFiles.find((name) =>
  name.endsWith("_course_readiness.sql"),
);
assert.ok(readinessFile, "The real readiness migration must be present.");
const baseVersion = replayFiles
  .filter((name) => name < readinessFile)
  .at(-1)
  ?.slice(0, 14);
assert.ok(baseVersion, "A complete accepted predecessor must be present.");
const supportFile = "20261116121556_internal_support_desk.sql";
const combinedCommit = process.env.PORTAL_REVIEW_PR17_COMMIT;
if (combinedCommit !== undefined && !/^[a-f0-9]{40}$/.test(combinedCommit))
  throw new Error(
    "Combined review requires one exact local 40-character commit.",
  );

/** Read immutable local Git data without running a shell or contacting a remote. */
async function gitText(args) {
  const { stdout } = await git("git", args, {
    cwd: sourceRoot,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}

/** Assemble real history without renaming versions or silently choosing a hash. */
async function migrationSources(commit) {
  const sources = new Map();
  for (const file of (
    await readdir(new URL("supabase/migrations/", sourceRoot))
  )
    .filter((name) => name.endsWith(".sql") && name.slice(0, 14) > baseVersion)
    .sort())
    sources.set(
      file,
      await readFile(
        new URL("supabase/migrations/" + file, sourceRoot),
        "utf8",
      ),
    );
  if (commit) {
    const paths = (
      await gitText([
        "ls-tree",
        "-r",
        "--name-only",
        commit,
        "supabase/migrations",
      ])
    )
      .trim()
      .split("\n")
      .filter((path) =>
        /^supabase\/migrations\/\d{14}_[a-z0-9_]+\.sql$/.test(path),
      );
    // Inspect every independent Git read and fail before applying any SQL if a
    // pinned object is absent. Common immutable sources must be byte-identical.
    const reads = await Promise.allSettled(
      paths.map(async (path) => ({
        path,
        body: await gitText(["show", `${commit}:${path}`]),
      })),
    );
    for (const read of reads) {
      if (read.status === "rejected") throw read.reason;
      const { path, body } = read.value;
      const file = path.split("/").at(-1);
      if (file.slice(0, 14) <= baseVersion) {
        assert.equal(
          body,
          await readFile(new URL(path, sourceRoot), "utf8"),
          "Accepted common migration differs: " + file,
        );
        continue;
      }
      if (sources.has(file))
        assert.equal(
          sources.get(file),
          body,
          "Shared migration differs: " + file,
        );
      else sources.set(file, body);
    }
    assert.ok(
      [...sources.keys()].some((file) =>
        file.includes("assignment_waitlist_and_substitution"),
      ),
      "The combined source must contain the real directed substitution module.",
    );
  }
  return [...sources].sort(([left], [right]) => left.localeCompare(right));
}

const modes = ["main", "strict", ...(combinedCommit ? ["pr17"] : [])];
for (const mode of modes) {
  const sources = await migrationSources(
    mode === "pr17" ? combinedCommit : null,
  );
  await withTestDatabase(
    "support_replacement_access",
    async ({ sql, actor, container }) => {
      let originalOid,
        originalBody,
        checks = 0;
      await withMigrationReplayLock(container, async () => {
        for (const [file, body] of sources) {
          if (file === supportFile) {
            if (mode === "strict") {
              // Published qualification evidence is already stricter than the
              // old blanket certificate permission. Strengthen the independent
              // contract branch only in this disposable predecessor instead;
              // no historical migration or installed policy is edited.
              const previous = await sql(
                "select pg_get_functiondef('private.can_access_document(uuid)'::regprocedure)",
              );
              const stronger = previous.replace(
                /\s*or\s*\(d\.kind='contract' and private\.has_permission\('contracts\.read'\)\)/,
                "",
              );
              assert.notEqual(
                stronger,
                previous,
                "Stricter predecessor fixture must apply.",
              );
              await sql(stronger);
            }
            originalOid = await sql(
              "select 'private.can_access_document(uuid)'::regprocedure::oid",
            );
            originalBody = await sql(
              "select prosrc from pg_proc where oid='private.can_access_document(uuid)'::regprocedure",
            );
          }
          await sql(body);
        }
      });
      await applyPasswordOnlyPermissionPolicy(sql);
      /** Count meaningful permission groups independently from their assertions. */
      const check = async (name, run) => {
        await run();
        checks++;
        console.log(`PASS ${mode}: ${name}`);
      };
      const [manager, source, target, outsider, support] = Array.from(
        { length: 5 },
        randomUUID,
      );
      await sql(`insert into auth.users(id,email)values${[manager, source, target, outsider, support].map((id) => `(${q(id)},${q(id + "@example.invalid")})`).join(",")};
insert into public.user_roles(user_id,role)values(${q(manager)},'admin'),(${q(source)},'lecturer'),(${q(target)},'lecturer'),(${q(outsider)},'lecturer'),(${q(support)},'senior_lecturer');
insert into public.role_permissions(role,permission)values('senior_lecturer','support.manage');
update public.profiles set display_name='Fictional private access fixture',time_zone='UTC';`);
      /** Execute with the real SQL actor/assurance boundary, never fixture superuser rights. */
      const call = (who, expression, aal = "aal1") =>
        actor(who, "select " + expression, aal);
      /** Parse a committed RPC projection without fabricating successful business state. */
      const json = async (...args) => JSON.parse(await call(...args));
      /** Create only fictional scanner-result rows; no Storage object is forged. */
      const file = async (
        owner,
        { scope = "personal", kind = "material", room = null } = {},
      ) => {
        const document = randomUUID(),
          version = randomUUID(),
          path = `${owner}/${document}/${version}`;
        await sql(`insert into public.documents(id,owner_id,uploaded_by,scope,kind,room_id,original_name,mime_type,size_bytes,status,client_id)
values(${q(document)},${q(owner)},${q(owner)},${q(scope)},${q(kind)},${room ? q(room) : "null"},'Fictional private material.txt','text/plain',17,'clean',${q(randomUUID())});
insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,status,sha256)
values(${q(version)},${q(document)},${q(owner)},${q(randomUUID())},1,${q(path)},'Fictional private material.txt','text/plain',17,'clean',repeat('a',64));
update public.documents set current_version_id=${q(version)}where id=${q(document)}`);
        return { document, version, path };
      };
      /** Match both metadata reads the authenticated file gateway performs. */
      const fileAccess = async (who, item, allowed, aal = "aal1") => {
        assert.equal(
          await call(
            who,
            `count(*)from public.documents where id=${q(item.document)}`,
            aal,
          ),
          allowed ? "1" : "0",
        );
        assert.equal(
          await call(
            who,
            `count(*)from public.document_versions where id=${q(item.version)}and document_id=${q(item.document)}and status='clean'`,
            aal,
          ),
          allowed ? "1" : "0",
        );
        assert.equal(
          await call(
            who,
            `private.can_access_document(${q(item.document)})`,
            aal,
          ),
          allowed ? "t" : "f",
        );
      };
      await check(
        "predecessor body/OID and all private-clone execution boundaries survive composition",
        async () => {
          assert.equal(
            await sql(
              "select 'private.can_access_document(uuid)'::regprocedure::oid",
            ),
            originalOid,
          );
          assert.equal(
            await sql(
              "select prosrc from pg_proc where oid='private.can_access_document_before_support(uuid)'::regprocedure",
            ),
            originalBody,
          );
          for (const role of ["anon", "authenticated", "service_role"])
            assert.equal(
              await sql(
                `select has_function_privilege(${q(role)},'private.can_access_document_before_support(uuid)','EXECUTE')`,
              ),
              "f",
            );
          await assert.rejects(
            call(
              source,
              `private.can_access_document_before_support(${q(randomUUID())})`,
            ),
            /permission denied/,
          );
        },
      );
      await check(
        "certificate privacy follows the actual predecessor rather than a copied broader policy",
        async () => {
          const certificate = await file(source, { kind: "certificate" });
          await fileAccess(source, certificate, true);
          await fileAccess(outsider, certificate, false);
          // Current main requires exact contextual qualification grants; the
          // support wrapper must never restore a generic manager certificate read.
          await fileAccess(manager, certificate, false, "aal1");
          const contract = await file(source, { kind: "contract" });
          await fileAccess(source, contract, true);
          await fileAccess(outsider, contract, false);
          // Prove an independently stricter installed predecessor survives,
          // rather than merely asserting the already-strict certificate rule.
          await fileAccess(manager, contract, false, "aal1");
        },
      );
      await check(
        "support interception denies internal evidence after staff/permission loss even to its uploader",
        async () => {
          const ticket = await call(
            source,
            `public.create_support_ticket(${q(JSON.stringify({ title: "Fictional access question", category: "technical", description: "Fictional private access regression" }))},${q(randomUUID())})`,
          );
          const ordinary = await file(source),
            internal = await file(support);
          await call(
            source,
            `public.update_support_ticket(${q(ticket)},'attach',${q(JSON.stringify({ document_id: ordinary.document, internal: false }))},1,${q(randomUUID())})`,
          );
          await call(
            support,
            `public.update_support_ticket(${q(ticket)},'attach',${q(JSON.stringify({ document_id: internal.document, internal: true }))},2,${q(randomUUID())})`,
            "aal1",
          );
          await fileAccess(source, ordinary, true);
          await fileAccess(support, ordinary, true, "aal1");
          await fileAccess(outsider, ordinary, false);
          await fileAccess(source, internal, false);
          await fileAccess(support, internal, true, "aal1");
          await fileAccess(support, internal, false);
          await sql(
            "delete from public.role_permissions where role='participant'and permission='support.manage'",
          );
          await fileAccess(support, internal, false, "aal1");
          assert.equal(
            await sql(
              `select count(*)from public.document_versions where id=${q(internal.version)}`,
            ),
            "1",
          );
        },
      );
      let sequence = 0;
      /** Use the real management/claim/chat APIs; only scan results and an
       * independent same-run assignment are assembled as administrative fixtures. */
      const make = async () => {
        const begins = Date.UTC(2048, 0, 1) + ++sequence * 7 * 86400000;
        const payload = {
          title: "Fictional complete access transfer",
          customer_name: "Fictional private academy",
          delivery_type: "online",
          time_zone: "UTC",
          location: "https://example.invalid/class",
          status: "published",
          amount: 120,
          total_amount: 240,
          currency: "EUR",
          rate_unit: "fixed_total",
          terms: "Fictional immutable accepted terms",
          requires_contract: false,
          sessions: [0, 1].map((offset) => ({
            starts_at: new Date(begins + offset * 86400000).toISOString(),
            ends_at: new Date(
              begins + offset * 86400000 + 3600000,
            ).toISOString(),
          })),
        };
        const job = await call(
          manager,
          `public.create_job(${q(JSON.stringify(payload))})`,
          "aal1",
        );
        const terms = Number(
          await sql(`select terms_version from public.jobs where id=${q(job)}`),
        );
        const claimed = await json(
          source,
          `public.claim_job(${q(job)},${q(randomUUID())},${terms})`,
        );
        assert.equal(claimed.status, "confirmed");
        const run = await sql(
          `select course_run_id from public.jobs where id=${q(job)}`,
        );
        const lecturerRoom = await sql(
          `select id from public.chat_rooms where job_id=${q(job)}and kind='lecturer_course'`,
        );
        const participantRoom = await call(
          manager,
          `public.create_chat_group('Fictional participant room',array[]::uuid[],'participant_course',${q(job)})`,
          "aal1",
        );
        assert.equal(
          await sql(
            `select job_id is null from public.chat_rooms where id=${q(participantRoom)}`,
          ),
          "t",
        );
        // The room was created after the claim. Reconstruct its assignment-
        // derived membership without inventing an independent manual grant.
        await sql(`select private.participant_chat_assignment_grant(${q(participantRoom)},${q(source)});
insert into public.chat_members(room_id,user_id)values(${q(participantRoom)},${q(source)})`);
        return {
          job,
          terms,
          run,
          claim: claimed.claim_id,
          lecturerRoom,
          participantRoom,
        };
      };
      /** A second independent confirmed block in this run retains participant
       * rights; its non-overlapping calendar stays outside the transferred job. */
      const otherAssignment = async (fixture) => {
        const other = randomUUID();
        await sql(`insert into public.jobs(id,course_run_id,title,customer_name,delivery_type,location,status,amount,currency,rate_unit,total_amount,terms,requires_contract)
select ${q(other)},course_run_id,title,customer_name,delivery_type,location,'published',amount,currency,rate_unit,total_amount,terms,requires_contract from public.jobs where id=${q(fixture.job)};
insert into public.job_sessions(job_id,starts_at,ends_at)select ${q(other)},starts_at+interval '2 days',ends_at+interval '2 days'from public.job_sessions where job_id=${q(fixture.job)}`);
        assert.equal(
          (
            await json(
              source,
              `public.claim_job(${q(other)},${q(randomUUID())},1)`,
            )
          ).status,
          "confirmed",
        );
      };
      /** Test raw RLS, protected history RPC and both file gateway projections. */
      const roomAccess = async (who, room, material, allowed) => {
        assert.equal(
          await call(who, `count(*)from public.chat_rooms where id=${q(room)}`),
          allowed ? "1" : "0",
        );
        assert.equal(
          await call(
            who,
            `count(*)from public.messages where room_id=${q(room)}`,
          ),
          allowed ? "1" : "0",
        );
        if (allowed)
          assert.equal(
            await call(who, `count(*)from public.chat_messages(${q(room)})`),
            "1",
          );
        else
          await assert.rejects(
            call(who, `count(*)from public.chat_messages(${q(room)})`),
            /Room access denied/,
          );
        await fileAccess(who, material, allowed);
      };
      for (const retention of [
        "sole",
        "other_assignment",
        "enrolled",
        "completed",
        "removed",
      ])
        await check(
          `participant messages/files transfer; independent basis=${retention}`,
          async () => {
            const fixture = await make();
            if (retention === "other_assignment")
              await otherAssignment(fixture);
            if (["enrolled", "completed", "removed"].includes(retention))
              await sql(`insert into public.user_roles(user_id,role)values(${q(source)},'participant')on conflict do nothing;
insert into public.course_enrolments(course_run_id,user_id,status,enrolled_by)values(${q(fixture.run)},${q(source)},${q(retention)},${q(manager)})`);
            // Sole case also checks owner transfer. Other cases preserve the
            // independent manager owner rather than replacing an unrelated owner.
            if (retention === "sole")
              await sql(
                `update public.chat_rooms set owner_id=${q(source)}where id=${q(fixture.participantRoom)}`,
              );
            const materials = [];
            for (const room of [
              fixture.lecturerRoom,
              fixture.participantRoom,
            ]) {
              const material = await file(source, {
                scope: "room",
                kind: "chat",
                room,
              });
              materials.push(material);
              await call(
                source,
                `public.send_message(${q(room)},'Fictional private course material',${q(randomUUID())},${q(material.document)})`,
              );
              await roomAccess(source, room, material, true);
              await roomAccess(target, room, material, false);
            }
            const before = await sql(
              `select to_jsonb(c)-'status'from public.job_claims c where id=${q(fixture.claim)}`,
            );
            const offer = await call(
              source,
              `public.request_replacement(${q(fixture.claim)},'Fictional complete transfer','selected',array[${q(target)}]::uuid[],false,${q(randomUUID())})`,
            );
            const request = randomUUID();
            const receipt = await json(
              target,
              `public.claim_replacement(${q(offer)},1,${fixture.terms},${q(request)})`,
            );
            assert.equal(receipt.status, "confirmed");
            assert.deepEqual(
              await json(
                target,
                `public.claim_replacement(${q(offer)},1,${fixture.terms},${q(request)})`,
              ),
              receipt,
            );
            await roomAccess(source, fixture.lecturerRoom, materials[0], false);
            await roomAccess(target, fixture.lecturerRoom, materials[0], true);
            await roomAccess(
              source,
              fixture.participantRoom,
              materials[1],
              ["other_assignment", "enrolled", "completed"].includes(retention),
            );
            await roomAccess(
              target,
              fixture.participantRoom,
              materials[1],
              true,
            );
            for (let index = 0; index < 2; index++)
              await roomAccess(
                outsider,
                [fixture.lecturerRoom, fixture.participantRoom][index],
                materials[index],
                false,
              );
            assert.equal(
              await sql(
                `select owner_id from public.chat_rooms where id=${q(fixture.participantRoom)}`,
              ),
              retention === "sole" ? target : manager,
            );
            assert.equal(
              await sql(
                `select to_jsonb(c)-'status'from public.job_claims c where id=${q(fixture.claim)}`,
              ),
              before,
            );
            assert.equal(
              await sql(
                `select count(*)from public.assignment_sessions where claim_id=${q(fixture.claim)}and released_at is null`,
              ),
              "0",
            );
            assert.equal(
              await sql(
                `select count(*)from public.assignment_sessions where claim_id=${q(receipt.claim_id)}and released_at is null`,
              ),
              "2",
            );
          },
        );
      console.log(
        `PASS ${mode}: ${checks} actual SQL access groups; exact predecessor OID retained${mode === "pr17" ? `; PR17=${combinedCommit}` : ""}`,
      );
    },
    { migrationsThrough: baseVersion },
  );
}
