/** Real notification composition, grants and upgrade checks in a disposable
 * UUID database. PR17 remains optional in the normal automatically found suite;
 * the separate manual integration entry point requires its actual migrations. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { withTestDatabase, quoteSql as q } from "./testing/database.mjs";

const suffix = "_operational_module_notification_handover_integration.sql";
/** Find the actual owned forward migration without assuming sibling P2 version
 * numbers; their independent delivery stacks may regenerate unreleased files. */
async function migrationSources() {
  const files = (
    await readdir(new URL("../supabase/migrations/", import.meta.url))
  )
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const integration = files.filter((name) => name.endsWith(suffix));
  assert.equal(integration.length, 1);
  return { files, integration: integration[0] };
}

/** Exercise the real installed implementations; strict combined mode refuses
 * absent PR17 prerequisites instead of reporting a skipped integration success. */
export async function runOperationalForwardChecks({
  requirePr17 = false,
} = {}) {
  // Container validation and random database ownership use the same tested
  // helper as the canonical SQL gate; no developer-specific container is pinned.
  const { files, integration } = await migrationSources();
  let checks = 0;
  /** Only report completed assertions, keeping optional schema absence explicit. */
  const check = async (name, run) => {
    await run();
    checks++;
    console.log("PASS " + name);
  };
  for (const upgrade of [false, true]) {
    const before = files.filter((name) => name < integration).at(-1);
    await withTestDatabase(
      upgrade ? "operational_forward_upgrade" : "operational_forward_fresh",
      async ({ sql, actor }) => {
        const combined =
          (await sql(
            "select to_regprocedure('private.course_notification_target(text,uuid)') is not null",
          )) === "t";
        if (requirePr17)
          assert.equal(
            combined,
            true,
            "Actual PR17 migration overlay required",
          );
        const mode = `${upgrade ? "upgrade" : "fresh"}/${combined ? "combined-PR17" : "independent"}`;
        const [owner, target, outsider, admin] = Array.from(
          { length: 4 },
          randomUUID,
        );
        await sql(
          `insert into auth.users(id,email) values ${[owner, target, outsider, admin].map((id) => `(${q(id)},${q(id + "@example.invalid")})`).join(",")};insert into public.user_roles(user_id,role) values(${q(owner)},'lecturer'),(${q(target)},'lecturer'),(${q(outsider)},'participant'),(${q(admin)},'admin');`,
        );
        const [organisation, template, run, job, claim, session, allocation] =
          Array.from({ length: 7 }, randomUUID);
        // Explicit metadata fixtures isolate target ACLs. The handover API and
        // business mutations have their own SQL/HTTP regression suites.
        await sql(
          `insert into public.organisations(id,name) values(${q(organisation)},'Fictional notification organisation');insert into public.course_templates(id,title) values(${q(template)},'Fictional composed course');insert into public.course_runs(id,template_id,organisation_id,published,delivery_type,venue) values(${q(run)},${q(template)},${q(organisation)},true,'online','https://meeting.example.invalid/class');insert into public.jobs(id,course_run_id,title,customer_name,delivery_type,status,location,amount,total_amount,currency,rate_unit,terms) values(${q(job)},${q(run)},'Fictional composed assignment','Fictional notification organisation','online','filled','https://meeting.example.invalid/class',100.01,100.01,'EUR','fixed_total','Fictional accepted terms');insert into public.course_sessions(id,course_run_id,starts_at,ends_at) values(${q(session)},${q(run)},'2048-01-02T08:00Z','2048-01-02T09:00Z');insert into public.job_sessions(job_id,course_session_id,starts_at,ends_at) values(${q(job)},${q(session)},'2048-01-02T08:00Z','2048-01-02T09:00Z');insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,amount,total_amount,currency,rate_unit,terms,terms_version) values(${q(claim)},${q(job)},${q(owner)},${q(randomUUID())},100.01,100.01,'EUR','fixed_total','Fictional accepted terms',1);insert into public.assignment_sessions(id,claim_id,lecturer_id,starts_at,ends_at) values(${q(allocation)},${q(claim)},${q(owner)},'2048-01-02T08:00Z','2048-01-02T09:00Z');`,
        );
        const [task, ticket, event, submission, offer] = Array.from(
          { length: 5 },
          randomUUID,
        );
        await sql(
          `insert into private.course_readiness_tasks(id,course_run_id,title,responsible_user_id) values(${q(task)},${q(run)},'Fictional preparation task',${q(owner)});insert into private.support_tickets(id,requester_id,category,title,description) values(${q(ticket)},${q(owner)},'technical','Fictional support question','Fictional isolated support context');insert into private.delivery_records(session_id,status,version) values(${q(allocation)},'submitted',2);insert into private.delivery_submissions(id,session_id,revision,lecturer_id,outcome,time_zone,notes,correction_reason,scheduled_start,scheduled_end) values(${q(submission)},${q(allocation)},1,${q(owner)},'cancelled','Europe/Berlin','Fictional cancellation evidence','','2048-01-02T08:00Z','2048-01-02T09:00Z');update private.delivery_records set latest_submission_id=${q(submission)} where session_id=${q(allocation)};insert into private.delivery_events(id,session_id,submission_id,actor_id,action) values(${q(event)},${q(allocation)},${q(submission)},${q(owner)},'submitted');insert into private.replacement_offers(id,original_claim_id,requested_by,reason,mode,job_version) select ${q(offer)},${q(claim)},${q(owner)},'Fictional replacement request','open',lifecycle_version from public.jobs where id=${q(job)};`,
        );
        const targets = [
          ["readiness_task", task, "/readiness/" + run],
          ["support_update", ticket, "/support/" + ticket],
          ["delivery_submitted", event, "/delivery?session=" + allocation],
          ["replacement_available", offer, "/replacements"],
          ["claim_confirmed", claim, "/jobs/" + job],
        ];
        /** A real own notification reaches the resolver only through the public
         * inbox boundary, with current caller identity and permission. The implementation
         * helper itself remains owner-only, as in the accepted predecessor. */
        const resolve = async (who, kind, id, aal = "aal1") => {
          await sql(
            `insert into public.notifications(user_id,kind,resource_id) values(${q(who)},${q(kind)},${q(id)}) on conflict do nothing`,
          );
          const notice = await sql(
            `select id from public.notifications where user_id=${q(who)} and kind=${q(kind)} and resource_id=${q(id)}`,
          );
          const inbox = JSON.parse(
            await actor(
              who,
              "select public.notification_inbox(false,null,null,100)",
              aal,
            ),
          );
          const item = inbox.items.find((entry) => entry.id === notice);
          assert.ok(item, "The caller's actual inbox row must be returned");
          return { href: item.href, title: item.title };
        };
        let accepted;
        if (combined) {
          const replacement = randomUUID(),
            substitution = randomUUID();
          // This is the exact persisted post-accept state used to verify both
          // the new trigger and repair of already accepted historical transfers.
          await sql(
            `insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,amount,total_amount,currency,rate_unit,terms,terms_version,status) values(${q(replacement)},${q(job)},${q(target)},${q(randomUUID())},100.01,100.01,'EUR','fixed_total','Fictional accepted terms',1,'cancelled');insert into private.job_substitutions(id,original_claim_id,job_id,target_user_id,proposed_by,request_id,reason,quote,quote_hash,expires_at,status) values(${q(substitution)},${q(claim)},${q(job)},${q(target)},${q(owner)},${q(randomUUID())},'Fictional complete directed transfer',${q(JSON.stringify({ title: "Fictional composed assignment" }))}::jsonb,'fictional',now()+interval '1 day','pending');`,
          );
          accepted = { substitution, replacement };
          if (upgrade) {
            await sql(
              `update public.job_claims set status='cancelled' where id=${q(claim)};update private.job_substitutions set status='accepted',accepted_claim_id=${q(replacement)},resolved_at=clock_timestamp() where id=${q(substitution)};`,
            );
            assert.equal(
              await sql(
                `select status from private.replacement_offers where id=${q(offer)}`,
              ),
              "open",
              "The pre-integration mismatch must actually exist",
            );
          }
        }
        if (upgrade) {
          // P2 histories can be delivered after the independent root forward
          // migration. Apply all remaining actual files in chronological order.
          for (const file of files.filter((name) => name >= integration))
            await sql(
              await readFile(
                new URL("../supabase/migrations/" + file, import.meta.url),
                "utf8",
              ),
            );
        }
        await check(
          mode + ": all root targets and base fallback survive",
          async () => {
            for (const [kind, id, href] of targets) {
              const destination = await resolve(owner, kind, id);
              if (combined && upgrade && kind === "readiness_task")
                assert.deepEqual(destination, { href: null, title: "" });
              else {
                assert.equal(destination.href, href, kind);
                assert.ok(destination.title.length > 0, kind);
              }
              assert.deepEqual(await resolve(outsider, kind, id), {
                href: null,
                title: "",
              });
            }
            for (const [kind, id] of targets)
              await sql(
                `insert into public.notifications(user_id,kind,resource_id) values(${q(owner)},${q(kind)},${q(id)}) on conflict do nothing`,
              );
            const inbox = JSON.parse(
              await actor(owner, "select public.notification_inbox()"),
            );
            for (const [kind, , href] of targets.filter(
              ([kind]) => kind !== "claim_confirmed",
            ))
              assert.equal(
                inbox.items.find((n) => n.kind === kind).href,
                combined && upgrade && kind === "readiness_task" ? null : href,
              );
          },
        );
        await check(
          mode + ": optional P2 targets resolve or fail closed explicitly",
          async () => {
            for (const [table, kind] of [
              ["private.website_enquiries", "website_enquiry"],
              ["private.assignment_change_requests", "assignment_change"],
            ]) {
              const id = randomUUID(),
                installed =
                  (await sql(`select to_regclass(${q(table)}) is not null`)) ===
                  "t";
              if (!installed) {
                assert.deepEqual(await resolve(admin, kind, id, "aal1"), {
                  href: null,
                  title: "",
                });
                console.log(
                  `  ABSENT ${table}: exact-signature denial verified`,
                );
                continue;
              }
              if (kind === "website_enquiry")
                await sql(
                  `insert into private.website_enquiries(id,sender_hash,submission_id,payload) values(${q(id)},repeat('a',64),${q(randomUUID())},'{}'::jsonb)`,
                );
              else
                await sql(
                  `insert into private.assignment_change_requests(id,claim_id,requester_id,lecturer_id,reason,original,proposed,source_hash) values(${q(id)},${q(claim)},${q(admin)},${q(owner)},'Fictional formal request',${q(JSON.stringify({ title: "Fictional formal request" }))}::jsonb,'{}'::jsonb,'fictional')`,
                );
              assert.equal(
                (await resolve(admin, kind, id, "aal1")).href,
                (kind === "website_enquiry" ? "/enquiries/" : "/changes/") + id,
              );
              assert.deepEqual(await resolve(admin, kind, id), {
                href: null,
                title: "",
              });
              assert.deepEqual(await resolve(outsider, kind, id), {
                href: null,
                title: "",
              });
            }
          },
        );
        await check(
          mode +
            ": resolver, fallback and reconciliation helpers are owner-only and lint clean",
          async () => {
            const functions = [
              "private.notification_target(text,uuid)",
              "private.notification_target_integrated_fallback(text,uuid)",
              "private.reconcile_directed_marketplace_offer(uuid)",
            ];
            await sql("create extension plpgsql_check with schema extensions");
            for (const name of functions) {
              const diagnostics = JSON.parse(
                await sql(
                  `select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from extensions.plpgsql_check_function_tb(${q(name)}::regprocedure)t`,
                ),
              );
              assert.deepEqual(diagnostics, [], name);
            }
            for (const name of functions)
              for (const role of ["anon", "authenticated", "service_role"])
                assert.equal(
                  await sql(
                    `select has_function_privilege(${q(role)},${q(name)},'execute')`,
                  ),
                  "f",
                );
            if (combined) {
              const diagnostics = JSON.parse(
                await sql(
                  "select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from extensions.plpgsql_check_function_tb('private.reconcile_directed_marketplace_offer_trigger()'::regprocedure,relid=>'private.job_substitutions'::regclass)t",
                ),
              );
              assert.deepEqual(diagnostics, []);
            } else
              assert.equal(
                await sql(
                  "select count(*) from pg_trigger where tgname='reconcile_directed_marketplace_offer'",
                ),
                "0",
              );
          },
        );
        if (combined)
          await check(
            mode +
              ": smart targets and terminal directed reconciliation compose",
            async () => {
              const work = randomUUID(),
                preparation = randomUUID();
              await sql(
                `insert into private.work_tasks(id,creator_id,assignee_id,scope,title,client_id,request_payload) values(${q(work)},${q(owner)},${q(owner)},'private','Fictional smart task',${q(randomUUID())},'{}'::jsonb);insert into private.course_preparation_items(id,run_id,label,updated_by) values(${q(preparation)},${q(run)},'Fictional course preparation',${q(owner)});`,
              );
              assert.equal(
                (await resolve(owner, "task_assigned", work)).href,
                "/workbench?task=" + work,
              );
              assert.equal(
                (
                  await resolve(
                    admin,
                    "course_preparation_updated",
                    preparation,
                    "aal1",
                  )
                ).href,
                "/courses/" + run + "/workspace",
              );
              assert.deepEqual(await resolve(outsider, "task_assigned", work), {
                href: null,
                title: "",
              });
              if (!upgrade) {
                // A later transaction failure must undo both the terminal state
                // and its audit. Cancellation alone must not close an in-flight
                // marketplace transfer before that workflow commits its winner.
                await sql(
                  `begin;set local request.jwt.claims=${q(JSON.stringify({ sub: target, aal: "aal1", role: "authenticated" }))};update public.job_claims set status='cancelled' where id=${q(claim)};do $test$begin if (select status from private.replacement_offers where id=${q(offer)})<>'open' then raise exception 'Source cancellation prematurely closed marketplace';end if;end;$test$;update private.job_substitutions set status='accepted',accepted_claim_id=${q(accepted.replacement)},resolved_at=clock_timestamp() where id=${q(accepted.substitution)};rollback;`,
                );
                assert.equal(
                  await sql(
                    `select status||':'||version from private.replacement_offers where id=${q(offer)}`,
                  ),
                  "open:1",
                );
                assert.equal(
                  await sql(
                    `select count(*) from public.audit_events where action='replacement.superseded_by_directed_handover' and resource_id=${q(offer)}`,
                  ),
                  "0",
                );
                await sql(
                  `begin;set local request.jwt.claims=${q(JSON.stringify({ sub: target, aal: "aal1", role: "authenticated" }))};update public.job_claims set status='cancelled' where id=${q(claim)};update private.job_substitutions set status='accepted',accepted_claim_id=${q(accepted.replacement)},resolved_at=clock_timestamp() where id=${q(accepted.substitution)};commit;`,
                );
              }
              assert.equal(
                await sql(
                  `select status||':'||version from private.replacement_offers where id=${q(offer)}`,
                ),
                "cancelled:2",
              );
              const audit = JSON.parse(
                await sql(
                  `select jsonb_agg(to_jsonb(a)) from public.audit_events a where action='replacement.superseded_by_directed_handover' and resource_id=${q(offer)}`,
                ),
              );
              assert.equal(audit.length, 1);
              assert.equal(audit[0].actor_id, target);
              assert.equal(audit[0].details.migration_reconciliation, upgrade);
              await sql(
                `select private.reconcile_directed_marketplace_offer(${q(accepted.substitution)})`,
              );
              assert.equal(
                await sql(
                  `select count(*) from public.audit_events where action='replacement.superseded_by_directed_handover' and resource_id=${q(offer)}`,
                ),
                "1",
              );
            },
          );
        await check(
          mode +
            ": suspension denies inbox/title access and adds no new external channel categories",
          async () => {
            await sql(
              `update public.profiles set active=false where id=${q(owner)}`,
            );
            for (const [kind, id] of targets)
              await assert.rejects(resolve(owner, kind, id), /42501/);
            if (
              (await sql(
                "select to_regprocedure('private.email_category_enabled(uuid,text)') is not null",
              )) === "t"
            )
              for (const kind of [
                "readiness_task",
                "support_update",
                "delivery_submitted",
                "replacement_available",
                "website_enquiry",
                "assignment_change",
              ])
                assert.equal(
                  await sql(
                    `select private.email_category_enabled(${q(target)},${q(kind)})`,
                  ),
                  "f",
                );
          },
        );
      },
      upgrade ? { migrationsThrough: before.slice(0, 14) } : {},
    );
  }
  console.log(`\n${checks} operational forward-integration SQL groups passed.`);
}

// Importing this runner for the strict manual PR17 entry point must not start
// a separate independent database run or disguise missing combined prerequisites.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await runOperationalForwardChecks();
