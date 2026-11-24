/** Real isolated PostgreSQL checks for the reduced operational activity projection. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {setTimeout as delay} from "node:timers/promises";
import {quoteSql as q, withTestDatabase} from "./testing/database.mjs";
import {rpcResponse} from "./testing/openapi-contract.mjs";

const auditPage = rpcResponse("admin_audit_events");
const clearedActivity = rpcResponse("clear_administration_activity");

await withTestDatabase("admin_audit", async ({sql, actor}) => {
    const roles = [
            "admin",
            "owner",
            "management",
            "senior_lecturer",
            "lecturer",
            "client",
            "participant",
        ],
        users = Object.fromEntries(roles.map((role) => [role, randomUUID()]));
    await sql(
        `insert into auth.users(id, email)
         values ${roles.map((role) => `(${q(users[role])},${q(`audit-${role}@example.invalid`)})`).join(",")};
        insert into public.user_roles(user_id, role)
        values ${roles.map((role) => `(${q(users[role])},${q(role)})`).join(",")};
        update public.profiles
        set display_name='Fictional audit actor <script>literal</script>'
        where id = ${q(users.lecturer)}`,
    );
    let checks = 0;
    /** Counts and reports a case only after all of its assertions have completed successfully. */
    const check = async (name, run) => {
        await run();
        checks++;
        console.log(`PASS ${name}`);
    };
    /** Reads the business projection as a specific fixture identity to verify visibility and privacy. */
    const read = async (who = users.admin, args = "", aal = "aal1") =>
        auditPage(await actor(who, `select public.admin_audit_events(${args})`, aal));
    await check(
        "Current admin, owner and management can read in AAL1; other roles and anonymous access are denied",
        async () => {
            for (const role of ["admin", "owner"])
                assert.equal((await read(users[role])).can_clear, true);
            assert.equal((await read(users.management)).can_clear, false);
            for (const role of roles.slice(3))
                await assert.rejects(read(users[role]), /42501/);
            assert.equal(
                await sql(
                    "select has_function_privilege('anon','public.admin_audit_events(timestamptz,timestamptz,text,text,timestamptz,uuid,integer)','execute')",
                ),
                "f",
            );
            assert.equal(
                await sql(
                    "select has_function_privilege('authenticated','private.admin_audit_actions()','execute')",
                ),
                "f",
            );
        },
    );
    // The fixture's account and role creation can now generate activity itself.
    await sql("delete from private.administration_activity");
    const safe = randomUUID(),
        resource = randomUUID(),
        secret = "PRIVATE-CALENDAR-DM-CONTRACT-INVOICE-PAYLOAD-DO-NOT-EXPOSE";
    await check(
        "Exact reviewed actions project only safe metadata; private and unknown actions fail closed",
        async () => {
            await sql(
                `insert into public.audit_events(id, actor_id, action, resource_id, details)
                 values (${q(safe)}, ${q(users.lecturer)}, 'job.lifecycle.published', ${q(resource)}, ${q(JSON.stringify({
                    private_note: secret,
                    gross_amount: 1000,
                    user_metadata: {role: "owner"}
                }))}::jsonb);
                insert into public.audit_events(actor_id, action, resource_id, details)
                select ${q(users.lecturer)}, action, gen_random_uuid(), ${q(JSON.stringify({body: secret}))}::jsonb
                from unnest(array['availability.created', 'profile.details.saved', 'profile.avatar_selected', 'chat.member_added', 'document.quarantined', 'contract.executed_version_registered', 'invoice.private_draft_saved', 'course.review.saved', 'calendar.created', 'job.lifecycle.private_future_action']) action`,
            );
            const result = await read();
            assert.equal(result.items.length, 1);
            assert.equal(result.items[0].id, safe);
            assert.deepEqual(Object.keys(result.items[0]).sort(), [
                "action",
                "actor_name",
                "created_at",
                "id",
                "resource_id",
            ]);
            assert.equal(result.items[0].resource_id, resource);
            assert.equal(
                result.items[0].actor_name,
                "Fictional audit actor <script>literal</script>",
            );
            assert.ok(!JSON.stringify(result).includes(secret));
            assert.ok(!JSON.stringify(result).includes("user_metadata"));
            assert.equal(result.actions.includes("invoice.private_draft_saved"), false);
            assert.equal(
                result.actions.includes("job.lifecycle.private_future_action"),
                false,
            );
        },
    );
    await check(
        "Literal metadata search and exact action filters never search private details",
        async () => {
            assert.equal(
                (await read(users.admin, `null,null,'',${q(secret)}`)).items.length,
                0,
            );
            assert.equal(
                (await read(users.admin, `null,null,'',${q("%_")}`)).items.length,
                0,
            );
            assert.equal(
                (await read(users.admin, `null,null,'',${q(resource.toUpperCase())}`))
                    .items[0].id,
                safe,
            );
            assert.equal(
                (
                    await read(
                        users.admin,
                        "null,null,'job.lifecycle.published','AUDIT ACTOR'",
                    )
                ).items[0].id,
                safe,
            );
            assert.deepEqual(
                (await read(users.admin, "null,null,'taxonomy.archived'")).items,
                [],
            );
            await assert.rejects(
                read(users.admin, "null,null,'invoice.private_draft_saved'"),
                /22023/,
            );
            await assert.rejects(
                read(users.admin, "null,null,'job.lifecycle'"),
                /22023/,
            );
        },
    );
    await check(
        "Default last 30 days and validated finite 93-day windows bound all pages and cursors",
        async () => {
            const result = await read();
            assert.equal(
                Date.parse(result.to) - Date.parse(result.from),
                30 * 86400000,
            );
            await sql(
                `insert into public.audit_events(actor_id, action, created_at)
                 values (${q(users.admin)}, 'taxonomy.created', now() - interval '31 days')`,
            );
            assert.equal((await read()).items.length, 1);
            for (const args of [
                "'infinity',now()",
                "now(),'infinity'",
                "now(),now()",
                "now()-interval '94 days',now()",
                "null,null,null",
                "null,null,'',null",
                `null,null,'',${q("a".repeat(161))}`,
                "null,null,'','',null,null,0",
                "null,null,'','',null,null,101",
                "null,null,'','',now(),null",
                `null,null,'','',null,${q(safe)}`,
                `null,null,'','',now()-interval '40 days',${q(safe)}`,
                `null,null,'','',now()+interval '1 day',${q(safe)}`,
            ])
                await assert.rejects(read(users.admin, args), /22023/);
            assert.ok(
                Array.isArray(
                    (await read(users.admin, "now()-interval '93 days 1 hour',now()"))
                        .items,
                ),
            );
        },
    );
    await check(
        "The operational projection expires after exactly 30 days while source receipts are preserved",
        async () => {
            const expired = randomUUID(), recent = randomUUID(), target = randomUUID();
            await sql(`
                insert into private.administration_activity(id,actor_id,action,resource_id,created_at)
                values (${q(expired)},${q(users.admin)},'document.file_downloaded',${q(target)}, now()-interval '720 hours'),
                       (${q(recent)},${q(users.admin)},'document.uploaded',${q(target)},now()-interval '719 hours');
            `);
            const range = "now()-interval '31 days',now()";
            const before = (await read(users.admin, range)).items;
            assert.equal(before.some(({id}) => id === expired), false);
            assert.equal(before.some(({id}) => id === recent), true);
            assert.equal(await sql("select private.prune_administration_activity()"), "1");
            assert.equal(await sql(`select count(*) from private.administration_activity where id=${q(expired)}`), "0");
            assert.equal(await sql(`select count(*) from public.audit_events where action='taxonomy.created'`), "1");
            assert.equal(await sql("select has_function_privilege('authenticated','private.prune_administration_activity()','execute')"), "f");
            await assert.rejects(actor(users.admin, "select private.write_admin_activity(auth.uid(),'document.uploaded',gen_random_uuid(),'{}')"), /42501/);
            await sql(`delete from private.administration_activity where id=${q(recent)}`);
        },
    );
    await check(
        "White Label audit entries publish only reviewed field names, never submitted values",
        async () => {
            const id = randomUUID();
            await sql(`
                insert into public.audit_events(id,actor_id,action,details)
                values (${q(id)},${q(users.admin)},'academy.white_label.changed',
                        ${q(JSON.stringify({fields: ["name", "short_name", secret], new_name: secret}))}::jsonb);
            `);
            const record = (await read(users.admin, "null,null,'academy.white_label.changed'")).items[0];
            assert.equal(record.id, id);
            assert.deepEqual(record.changed_fields, ["name", "short_name"]);
            assert.ok(!JSON.stringify(record).includes(secret));
            await sql(`delete from private.administration_activity where id=${q(id)}`);
        },
    );
    await check(
        "Concurrent equal-timestamp events page by timestamp plus UUID without duplicates or gaps",
        async () => {
            const at = await sql("select now()-interval '1 hour'"),
                ids = Array.from({length: 45}, randomUUID);
            await Promise.all(
                [ids.slice(0, 22), ids.slice(22)].map((part) =>
                    sql(
                        `insert into public.audit_events(id, actor_id, action, created_at)
                         values ${part.map((id) => `(${q(id)},${q(users.admin)},'taxonomy.created',${q(at)})`).join(",")}`,
                    ),
                ),
            );
            let page = await read(
                users.admin,
                "null,null,'taxonomy.created','',null,null,20",
            );
            const seen = [...page.items.map((item) => item.id)],
                from = page.from,
                to = page.to;
            assert.equal(page.has_more, true);
            // A genuinely later transaction is beyond the frozen first-page upper bound.
            const late = randomUUID();
            await sql(
                `insert into public.audit_events(id, actor_id, action)
                 values (${q(late)}, ${q(users.admin)}, 'taxonomy.created')`,
            );
            while (page.has_more) {
                page = await read(
                    users.admin,
                    `${q(from)},${q(to)},'taxonomy.created','',${q(page.next_cursor.at)},${q(page.next_cursor.id)},20`,
                );
                seen.push(...page.items.map((item) => item.id));
            }
            assert.deepEqual(seen, [...ids].sort().reverse());
            assert.equal(new Set(seen).size, 45);
            assert.equal(seen.includes(late), false);
            assert.equal(page.next_cursor, null);
        },
    );
    await check(
        "The raw audit receipt table is outside browser access and remains immutable to users",
        async () => {
            for (const statement of [
                `select details from public.audit_events where id=${q(safe)}`,
                `insert into public.audit_events(actor_id, action)
                 values (${q(users.admin)}, 'taxonomy.created')`,
                `update public.audit_events
                 set action='taxonomy.archived'
                 where id = ${q(safe)}`,
                `delete
                 from public.audit_events
                 where id = ${q(safe)}`,
            ])
                await assert.rejects(
                    actor(users.admin, statement, "aal1"),
                    /permission denied/,
                );
            assert.equal(
                await sql(`select action
                           from public.audit_events
                           where id=${q(safe)}`),
                "job.lifecycle.published",
            );
            assert.equal(
                await sql(
                    "select prosecdef from pg_proc where oid='public.admin_audit_events(timestamptz,timestamptz,text,text,timestamptz,uuid,integer)'::regprocedure",
                ),
                "f",
            );
        },
    );
    await check(
        "Committed customer and course writes appear for management without copying customer values",
        async () => {
            const payload = {name: "Fictional audit organisation", private_notes: secret};
            const organisation = await actor(users.admin,
                `select public.save_organisation(null,${q(JSON.stringify(payload))}::jsonb)`);
            await actor(users.admin,
                `select public.save_organisation(${q(organisation)},${q(JSON.stringify({...payload, city: "Fictional city"}))}::jsonb)`);
            await sql(`update public.organisations set city=city where id=${q(organisation)}`);
            const template = await actor(users.admin,
                `select public.save_course_template(null,${q(JSON.stringify({title: "Fictional audit course", description: secret}))}::jsonb)`);
            const run = await actor(users.admin,
                `select public.save_course_run(null,${q(JSON.stringify({
                    template_id: template,
                    organisation_id: organisation,
                    venue: secret,
                    sessions: [{starts_at: "2030-09-02T09:00:00Z", ends_at: "2030-09-02T10:00:00Z"}],
                }))}::jsonb)`);
            for (const [action, id] of [
                ["activity.organisations.created", organisation],
                ["activity.organisations.updated", organisation],
                ["activity.course_runs.created", run],
            ]) {
                const result = await read(users.management, `null,null,${q(action)},${q(id)}`);
                assert.equal(result.items.length, 1, action);
                assert.equal(result.items[0].resource_id, id);
                assert.ok(!JSON.stringify(result).includes(secret));
            }
            const rolledBack = randomUUID();
            await sql(`begin;
                insert into public.organisations(id,name) values (${q(rolledBack)},'Fictional rollback');
                rollback;`);
            assert.deepEqual((await read(users.management,
                `null,null,'activity.organisations.created',${q(rolledBack)}`)).items, []);
            const removed = randomUUID();
            await sql(`
                insert into public.organisations(id,name) values (${q(removed)},'Fictional removed');
                delete from public.organisations where id=${q(removed)};
            `);
            const result = await read(users.management, `null,null,'activity.organisations.deleted',${q(removed)}`);
            assert.equal(result.items.length, 1);
            assert.equal(result.items[0].resource_id, removed);
        },
    );
    await check(
        "Native Auth receipts retain status and safe account attribution without sensitive payloads",
        async () => {
            await sql(`insert into auth.audit_log_entries(id,payload,created_at,ip_address)
                select gen_random_uuid(), json_build_object('action', event, 'actor_id', ${q(users.lecturer)},
                    'actor_username', 'audit-lecturer@example.invalid', 'traits', json_build_object('secret',${q(secret)})),
                    now(),'192.0.2.10'
                from unnest(array['user_recovery_requested','user_updated_password','login']) event;`);
            const recovery = (await read(users.management, "null,null,'mail.auth.recovery_requested'")).items;
            const password = (await read(users.management, "null,null,'account.auth.password_updated'")).items;
            assert.equal(recovery.length, 1);
            assert.equal(recovery[0].actor_name, "");
            assert.equal(password.length, 1);
            assert.match(password[0].actor_name, /Fictional audit actor/);
            for (const value of [secret, "192.0.2.10", "audit-lecturer@example.invalid"])
                assert.ok(!JSON.stringify([...recovery, ...password]).includes(value));
            assert.equal(await sql("select count(*) from private.administration_activity where action in ('account.auth.login','login')"), "0");
        },
    );
    await check(
        "Invoice submissions are visible as workflow metadata without copying their values",
        async () => {
            const invoiceId = randomUUID();
            await sql(`insert into public.audit_events(actor_id,action,resource_id,details)
                values (${q(users.admin)}, 'invoice.submitted', ${q(invoiceId)},
                jsonb_build_object('gross_amount',9001,'note',${q(secret)}));`);
            const {items} = await read(users.management, `null,null,'invoice.submitted',${q(invoiceId)}`);
            assert.equal(items.length, 1);
            assert.equal(items[0].resource_id, invoiceId);
            assert.equal(Object.hasOwn(items[0], "payment"), false);
            assert.ok(!JSON.stringify(items).includes(secret));
            assert.ok(!JSON.stringify(items).includes("gross_amount"));
        },
    );
    await check(
        "Terminal mail states are recorded once without exposing recipients or diagnostic values",
        async () => {
            const notification = randomUUID();
            const outbox = randomUUID();
            await sql(`
                insert into public.notifications(id,user_id,kind)
                values (${q(notification)},${q(users.lecturer)},'claim_confirmed');
                insert into private.notification_email_outbox(id,notification_id,occurrence_at)
                values (${q(outbox)},${q(notification)},clock_timestamp());
                update private.notification_email_outbox set state='sending' where id=${q(outbox)};
                update private.notification_email_outbox set state='accepted',last_outcome=${q(secret)},finished_at=clock_timestamp() where id=${q(outbox)};
                update private.notification_email_outbox set state='accepted' where id=${q(outbox)};
            `);
            const accepted = await read(users.management, `null,null,'mail.delivery_accepted',${q(outbox)}`);
            assert.equal(accepted.items.length, 1);
            assert.equal(accepted.items[0].resource_id, outbox);
            assert.ok(!JSON.stringify(accepted).includes(secret));
            assert.ok(!JSON.stringify(accepted).includes("example.invalid"));
            const all = (await read(users.management, `null,null,'',${q(outbox)}`)).items;
            assert.deepEqual(all.map(({action}) => action), ["mail.delivery_accepted"]);
        },
    );
    await check(
        "A permission withdrawn while an administrator waits to clear leaves existing activity intact",
        async () => {
            const holder = `activity_gate_${randomUUID().slice(0,8)}`;
            const waiter = `activity_clear_${randomUUID().slice(0,8)}`;
            const before = await sql("select count(*) from private.administration_activity");
            const observe = async (name, query) => {
                const deadline = Date.now() + 2500;
                while (Date.now() < deadline) {
                    if (await sql(`select exists(select 1 from pg_stat_activity
                        where application_name=${q(name)} and ${query})`) === "t") return;
                    await delay(20);
                }
                assert.fail(`PostgreSQL did not reach the expected ${name} wait`);
            };
            const revoke = sql(`begin; set local application_name=${q(holder)};
                lock table private.administration_activity in share row exclusive mode;
                select pg_sleep(3);
                delete from public.role_permissions where role='admin' and permission='audit.clear';
                commit;`);
            let denied;
            try {
                await observe(holder, "wait_event = 'PgSleep'");
                denied = assert.rejects(actor(users.admin, `set local application_name=${q(waiter)};
                    select public.clear_administration_activity(true)`), /42501/);
                void denied.catch(() => {});
                await observe(waiter, "wait_event_type = 'Lock'");
                await Promise.all([revoke, denied]);
                assert.equal(await sql("select count(*) from private.administration_activity"), before);
            } finally {
                await Promise.allSettled([revoke, denied]);
                await sql("insert into public.role_permissions(role, permission) values ('admin','audit.clear') on conflict do nothing");
            }
        },
    );
    await check("Additional course, financial and failed-account events retain safe operational metadata", async () => {
        const target = randomUUID(), request = randomUUID();
        await sql(`
            insert into public.audit_events(actor_id,action,resource_id,details)
            values (${q(users.admin)},'course.meeting_link.updated',${q(target)},jsonb_build_object('private_url',${q(secret)})),
                   (${q(users.admin)},'invoice.submitted',${q(target)},jsonb_build_object('recipient',${q(secret)}));
            insert into private.account_creation_requests(id,actor_id,request_id,email,display_name,requested_role)
            values (${q(request)},${q(users.admin)},gen_random_uuid(),'fictional@example.invalid','Fictional account','lecturer');
            update private.account_creation_requests set status='failed' where id=${q(request)};
        `);
        const page = await read(users.management);
        for (const action of ["course.meeting_link.updated", "invoice.submitted", "account.creation_failed"])
            assert.ok(page.items.some((entry) => entry.action === action));
        assert.ok(!JSON.stringify(page).includes(secret));
        assert.ok(!JSON.stringify(page).includes("fictional@example.invalid"));
        const receipt = randomUUID();
        await sql(`insert into private.account_creation_requests
          (id,actor_id,request_id,email,display_name,requested_role,status,auth_user_id)
          values (${q(receipt)},${q(users.admin)},gen_random_uuid(),'test@example.invalid','Test','lecturer','created',${q(users.lecturer)})`);
        const mailFunctions = JSON.parse(await sql(`
          select json_agg(
            json_build_object('schema', n.nspname, 'definer', p.prosecdef,
              'returns_void', p.prorettype = 'void'::regtype,
              'service', has_function_privilege('service_role', p.oid, 'execute'),
              'authenticated', has_function_privilege('authenticated', p.oid, 'execute'),
              'anonymous', has_function_privilege('anon', p.oid, 'execute'))
            order by n.nspname)
          from pg_proc p join pg_namespace n on p.pronamespace = n.oid
          where p.oid in (to_regprocedure('private._record_account_access_mail(uuid,boolean)'),
                         to_regprocedure('public._record_account_access_mail(uuid,boolean)'))`));
        assert.deepEqual(mailFunctions, [
            {schema: "private", definer: true, returns_void: true, service: true, authenticated: false, anonymous: false},
            {schema: "public", definer: false, returns_void: true, service: true, authenticated: false, anonymous: false},
        ]);
        await assert.rejects(actor(users.admin, `select public._record_account_access_mail(${q(receipt)}, true)`), /42501/);
        await sql(`begin;set local role service_role;
          set local request.jwt.claims='{"role":"service_role"}';
          select public._record_account_access_mail(${q(receipt)}, false);commit;`);
        assert.equal((await read(users.management, "null,null,'account.access_mail_failed'")).items[0]?.resource_id, users.lecturer);
    });
    await check("Committed imports appear once; denied and rolled-back rows leave no operational entry", async () => {
        const key = randomUUID(), invalid = randomUUID();
        const submit = (who, id, payload) =>
            actor(who, `select public.import_table_row(${q(id)},'course-template',null,${q(payload)}::jsonb)`);
        const payload = JSON.stringify({title: secret});
        await Promise.all([submit(users.admin, key, payload), submit(users.admin, key, payload)]);
        await assert.rejects(submit(users.admin, invalid, "{}"), /22023/);
        await assert.rejects(submit(users.lecturer, randomUUID(), payload), /42501/);
        const page = await read(users.management, "null,null,'import.row_applied'");
        assert.deepEqual(page.items.map((entry) => entry.resource_id), [key]);
        assert.ok(!JSON.stringify(page).includes(secret));
    });
    await check("Attendance receipts, ticket changes and terminal push/webhook outcomes expose only safe metadata", async () => {
        const ids = Object.fromEntries(["org","key","webhook","delivery","device","notification","push","template","run","session","support"]
            .map((name) => [name,q(randomUUID())]));
        await sql(`
            insert into public.organisations(id,name) values (${ids.org},'Fictional organisation');
            insert into public.course_templates(id,title) values (${ids.template},'Fictional course');
            insert into public.course_runs(id,template_id,organisation_id) values (${ids.run},${ids.template},${ids.org});
            insert into public.course_sessions(id,course_run_id,starts_at,ends_at)
              values (${ids.session},${ids.run},now(),now()+interval '1 hour');
            insert into private.course_attendance_audit(session_id,user_id,actor_id,new_state,reason)
              values (${ids.session},${q(users.participant)},${q(users.admin)},jsonb_build_object('staff_note',${q(secret)}),${q(secret)});
            insert into public.audit_events(actor_id,action,resource_id,details)
              values (${q(users.admin)},'support.status',${ids.support},jsonb_build_object('body',${q(secret)})),
                     (${q(users.admin)},'support.internal_note',${ids.support},jsonb_build_object('body',${q(secret)}));
            insert into private.push_subscriptions(id,user_id,endpoint,p256dh,auth_secret,device_token,label)
              values (${ids.device},${q(users.participant)},${q(secret)},'fictional',${q(secret)},gen_random_uuid(),'Fictional');
            insert into public.notifications(id,user_id,kind) values (${ids.notification},${q(users.participant)},'audit_test');
            insert into private.notification_push_outbox(id,notification_id,subscription_id,occurrence_at)
              values (${ids.push},${ids.notification},${ids.device},now());
            insert into private.company_integration_keys(id,organisation_id,label,secret_hash,expires_at)
              values (${ids.key},${ids.org},'Fictional key',sha256(convert_to(${q(secret)},'UTF8')),now()+interval '1 day');
            insert into private.company_course_webhooks(id,integration_id,integration_version,destination,signing_secret)
              values (${ids.webhook},${ids.key},1,'fictional',repeat('0',64));
            insert into private.company_course_webhook_deliveries(id,event_id,subscription_id,course_id,event_type)
              values (${ids.delivery},gen_random_uuid(),${ids.webhook},${ids.run},'course.published');
            update private.notification_push_outbox set state='leased' where id=${ids.push};
            update private.notification_push_outbox set state='failed' where id=${ids.push};
            update private.notification_push_outbox set state='failed' where id=${ids.push};
            update private.company_course_webhook_deliveries set state='pending', attempts=1 where id=${ids.delivery};
            update private.company_course_webhook_deliveries set state='delivered' where id=${ids.delivery};
        `);
        for (const [action, target] of Object.entries({
            "course.attendance_recorded": ids.session,
            "support.status": ids.support,
            "push.delivery_failed": ids.push,
            "webhook.delivery_delivered": ids.delivery,
        })) {
            const page = await read(users.management, `null,null,${q(action)}`);
            assert.deepEqual(page.items.map((entry) => q(entry.resource_id)), [target]);
            assert.ok(!JSON.stringify(page).includes(secret));
        }
        assert.equal((await read(users.management)).items.some((entry) => entry.action === "support.internal_note"), false);
        assert.equal(await sql(`select count(*) from private.administration_activity
            where resource_id in (${ids.push},${ids.delivery})`), "2");
    });
    await check(
        "Only an active administrator or owner can clear the activity journal; business receipts survive",
        async () => {
            const clear = async (who) => clearedActivity(await actor(who,
                "select public.clear_administration_activity(true)"));
            assert.equal(await sql("select has_function_privilege('anon','public.clear_administration_activity(boolean)','execute')"), "f");
            for (const who of [users.management, users.lecturer, users.participant])
                await assert.rejects(clear(who), /42501/);
            await assert.rejects(actor(users.admin,"select public.clear_administration_activity(false)"), /22023/);
            const expected = Number(await sql("select count(*) from private.administration_activity"));
            assert.ok(expected > 0);
            const attempts = await Promise.all([clear(users.admin), clear(users.owner)]);
            assert.deepEqual(attempts.map(({removed}) => removed).sort((a,b) => a-b), [0, expected]);
            assert.deepEqual((await read(users.management)).items, []);
            assert.equal(await sql(`select count(*) from public.audit_events where id=${q(safe)}`), "1");
            assert.deepEqual(await clear(users.owner), {removed: 0});
            await sql(`insert into public.audit_events(actor_id, action)
                values (${q(users.admin)}, 'taxonomy.created')`);
            assert.equal((await read(users.management)).items[0].action, "taxonomy.created");
        },
    );
    await check(
        "Revoking current permissions and suspending an account blocks existing sessions",
        async () => {
            assert.ok((await read(users.management)).items.length > 0);
            await sql(
                "delete from public.role_permissions where role='management' and permission='audit.activity.read'",
            );
            await assert.rejects(read(users.management), /42501/);
            await sql(
                `delete
                 from public.user_roles
                 where user_id = ${q(users.owner)}`,
            );
            await assert.rejects(read(users.owner), /42501/);
            await assert.rejects(actor(users.owner, "select public.clear_administration_activity(true)"), /42501/);
            await sql(
                `update public.profiles
                 set active= false
                 where id = ${q(users.admin)}`,
            );
            await assert.rejects(read(users.admin), /42501/);
            await assert.rejects(actor(users.admin, "select public.clear_administration_activity(true)"), /42501/);
        },
    );
    console.log(`${checks} admin audit PostgreSQL checks passed.`);
});
