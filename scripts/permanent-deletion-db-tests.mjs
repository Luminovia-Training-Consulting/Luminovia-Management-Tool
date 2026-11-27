/** Real disposable PostgreSQL checks for permanent-deletion scope, authority and
 * fencing. Auth claims and Storage metadata are emulated; native byte/Auth/HTTP
 * deletion is checked separately by permanent-deletion-api-check.mjs. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {accountResponse} from "./testing/openapi-contract.mjs";
import {quoteSql as q, withTestDatabase} from "./testing/database.mjs";

let checks = 0;
await withTestDatabase("permanent_deletion", async ({sql, actor}) => {
    const admin = randomUUID(),
        owner = randomUUID(),
        other = randomUUID(),
        manager = randomUUID();
    await sql(`insert into auth.users(id, email)
               values
    (${q(admin)},'permanent-admin@example.invalid'),(${q(owner)},'permanent-owner@example.invalid'),
    (${q(other)},'permanent-other@example.invalid'),(${q(manager)},'permanent-manager@example.invalid');
    insert into public.user_roles(user_id,role) values (${q(admin)},'admin'),(${q(owner)},'lecturer'),(${q(other)},'lecturer'),(${q(manager)},'management');
    create schema storage;create table storage.objects(bucket_id text,name text,primary key(bucket_id,name));
    create trigger permanent_deletion_storage_fence before insert or update on storage.objects for each row execute function private.guard_deleted_storage_path();`);
    /** Every service call really runs under the restricted service database role. */
    const service = (statement) =>
        sql(
            `begin;set local role service_role;set local request.jwt.claims='{"role":"service_role"}';${statement};commit;`,
        );
    const deletionResponses = new Map([
        ["deletion_access", accountResponse("/v1/deletions/access", "get")],
        ["deletion_resources", accountResponse("/v1/deletions/resources", "get")],
        ["deletion_preview", accountResponse("/v1/deletions/preview", "post")],
        ["deletion_operations", accountResponse("/v1/deletions/operations", "get")],
        ["deletion_confirm", accountResponse("/v1/deletions/confirm", "post", "202")],
    ]);
    const completedResponse = accountResponse("/v1/deletions/operations/{id}", "post");
    const call = (who, name, args = "", aal = "aal1") =>
        actor(who, `select public.${name}(${args})`, aal).then((wire) => {
            const parse = deletionResponses.get(name);
            if (name === "deletion_confirm" && JSON.parse(wire).status === "completed")
                return completedResponse(wire);
            return (parse ?? JSON.parse)(wire);
        });
    const worker = (name, args) =>
        service(`select public._deletion_${name}(${args})`).then(
            name === "complete" ? completedResponse : JSON.parse,
        );
    const plan = (kind, id, who = admin) =>
        call(who, "deletion_preview", `${q(kind)},${q(id)}`);
    const confirm = (preview, who = admin, requestId = randomUUID()) =>
        call(
            who,
            "deletion_confirm",
            `${q(preview.plan_id)},${q(requestId)},'DELETE'`,
        );
    const permit = (operation, who = admin) =>
        call(who, "deletion_execution", q(operation.operation_id));
    const key = (operation, execution) =>
        `${q(operation.operation_id)},${q(execution.permit_id)}`;
    const expectCode = (promise, code) =>
        assert.rejects(promise, new RegExp(`\\b${code}\\b`));
    /** Report a group only after its real SQL assertions pass. */
    const check = async (name, run) => {
        await run();
        checks++;
        console.log(`PASS ${name}`);
    };
    const reserve = (who = owner, replace = null) =>
        call(
            who,
            "reserve_document",
            `'Fictional private deletion.pdf','application/pdf',100,'personal','material',null,null,${q(randomUUID())},${replace ? q(replace) : "null"},null`,
        );
    const document = await reserve();
    const second = await reserve(owner, document.document_id);

    await check("Organisation managers delete only the reviewed standalone contact and keep live references protected", async () => {
        const company = randomUUID(), standalone = randomUUID(), assigned = randomUUID();
        const template = randomUUID(), run = randomUUID();
        await sql(`insert into public.organisations(id,name) values(${q(company)},'Fictional contacts company');
          insert into public.organisation_contacts(id,organisation_id,name) values
            (${q(standalone)},${q(company)},'Fictional removable contact'),
            (${q(assigned)},${q(company)},'Fictional assigned contact');
          insert into public.course_templates(id,title) values(${q(template)},'Fictional contacts template');
          insert into public.course_runs(id,template_id,organisation_id) values(${q(run)},${q(template)},${q(company)});`);
        const access = await call(manager, "deletion_access");
        assert.ok(access.kinds.includes("organisation_contact"));
        assert.ok(!access.kinds.includes("organisation"));
        assert.ok(!(await call(owner, "deletion_access")).kinds.includes("organisation_contact"));
        await expectCode(plan("organisation", company, manager), "42501");
        await expectCode(plan("organisation_contact", standalone, owner), "42501");

        const previous = await plan("organisation_contact", assigned, manager);
        assert.equal(previous.can_confirm, true);
        await sql(`insert into private.company_dispatch_settings(organisation_id,contact_id)
            values(${q(company)},${q(assigned)});
          insert into private.course_workspace_settings(run_id,contact_id)
            values(${q(run)},${q(assigned)});`);
        await expectCode(confirm(previous, manager), "40001");
        const protectedContact = await plan("organisation_contact", assigned, manager);
        assert.equal(protectedContact.can_confirm, false);
        assert.deepEqual(
            protectedContact.blockers.map(({kind}) => kind).sort(),
            ["private.company_dispatch_settings", "private.course_workspace_settings"],
        );
        await expectCode(confirm(protectedContact, manager), "23503");

        const removable = await plan("organisation_contact", standalone, manager);
        assert.equal(removable.label, "Fictional removable contact");
        assert.equal(removable.can_confirm, true);
        assert.equal(removable.counts["public.organisation_contacts"], 1);
        const operation = await confirm(removable, manager);
        await sql(`delete from public.user_roles where user_id=${q(manager)} and role='management'`);
        await expectCode(permit(operation, manager), "42501");
        await sql(`insert into public.user_roles(user_id,role) values(${q(manager)},'management')`);
        const execution = await permit(operation, manager);
        await worker("apply", key(operation, execution));
        assert.equal((await worker("complete", `${key(operation, execution)},true,true`)).status, "completed");
        assert.equal(await sql(`select count(*) from public.organisation_contacts where id=${q(standalone)}`), "0");
        assert.equal(await sql(`select count(*) from public.organisations where id=${q(company)}`), "1");
        assert.equal(await sql(`select count(*) from public.organisation_contacts where id=${q(assigned)}`), "1");
        assert.equal(await sql(`select contact_id from private.company_dispatch_settings where organisation_id=${q(company)}`), assigned);
        assert.equal(await sql(`select contact_id from private.course_workspace_settings where run_id=${q(run)}`), assigned);
    });
    await check("Course management can delete an unused draft with dates without touching its template or another run", async () => {
        const template = randomUUID(), run = randomUUID(), sibling = randomUUID();
        const session = randomUUID(), siblingSession = randomUUID();
        await sql(`insert into public.course_templates(id,title) values(${q(template)},'Fictional deletion template');
          insert into public.course_runs(id,template_id) values(${q(run)},${q(template)}),(${q(sibling)},${q(template)});
          insert into public.course_sessions(id,course_run_id,starts_at,ends_at) values
            (${q(session)},${q(run)},'2044-01-05 09:00+00','2044-01-05 10:00+00'),
            (${q(siblingSession)},${q(sibling)},'2044-01-06 09:00+00','2044-01-06 10:00+00');`);
        assert.ok((await call(manager, "deletion_access")).kinds.includes("course_run"));
        await expectCode(plan("course_run", run, owner), "42501");
        const stale = await plan("course_run", run, manager);
        await sql(`update public.course_sessions set ends_at='2044-01-05 11:00+00' where id=${q(session)}`);
        await expectCode(confirm(stale, manager), "40001");
        const preview = await plan("course_run", run, manager);
        assert.equal(preview.can_confirm, true);
        assert.equal(preview.counts["public.course_sessions"], 1);
        const operation = await confirm(preview, manager);
        await expectCode(sql(`insert into private.course_attendance_evidence(
          session_id,version_id,attached_by,source
        ) values(${q(session)},${q(randomUUID())},${q(admin)},'academy_scan')`), "55000");
        await sql(`delete from public.user_roles where user_id=${q(manager)} and role='management'`);
        await expectCode(permit(operation, manager), "42501");
        await sql(`insert into public.user_roles(user_id,role) values(${q(manager)},'management')`);
        const execution = await permit(operation, manager);
        await worker("apply", key(operation, execution));
        assert.equal((await worker("complete", `${key(operation, execution)},true,true`)).status, "completed");
        assert.equal(await sql(`select count(*) from public.course_runs where id=${q(run)}`), "0");
        assert.equal(await sql(`select count(*) from public.course_sessions where id=${q(session)}`), "0");
        assert.equal(await sql(`select count(*) from public.course_sessions where id=${q(siblingSession)}`), "1");
        assert.equal(await sql(`select count(*) from public.course_templates where id=${q(template)}`), "1");
    });
    await check("Approved course deletion includes unused weighted grading policies and preserves used evidence", async () => {
        const [template, unused, sibling, reviewed, released, excused] = Array.from({length: 6}, randomUUID);
        const policy = (run, version = 1) => `insert into private.course_weighted_policies
          (run_id,version,threshold,missing_required,separate_reviewer,items,created_by)
          values(${q(run)},${version},60,'block',false,'[{"key":"quiz","weight":100,"treatment":"required"}]',${q(admin)})`;
        const review = (run) => `insert into private.course_weighted_reviews
          (run_id,user_id,revision,policy_version,prior_release,fingerprint,snapshot,reason,reviewed_by)
          values(${q(run)},${q(owner)},1,1,0,repeat('a',64),'{"percent":80,"passed":true}','Fictional review',${q(admin)})`;
        await sql(`insert into public.course_templates(id,title) values(${q(template)},'Fictional weighted grading template');
          insert into public.course_runs(id,template_id) values
            (${q(unused)},${q(template)}),(${q(sibling)},${q(template)}),(${q(reviewed)},${q(template)}),
            (${q(released)},${q(template)}),(${q(excused)},${q(template)});
          ${[unused, sibling, reviewed, released, excused].map((run) => policy(run)).join(';')};
          insert into public.course_enrolments(course_run_id,user_id,enrolled_by) values
            (${q(reviewed)},${q(owner)},${q(admin)}),(${q(released)},${q(owner)},${q(admin)}),(${q(excused)},${q(owner)},${q(admin)});
          ${review(reviewed)};
          ${review(released)};
          insert into private.course_weighted_releases(run_id,user_id,revision,review_revision,released_by)
            values(${q(released)},${q(owner)},1,1,${q(admin)});
          insert into private.course_weighted_exemptions(run_id,user_id,policy_version,item_key,revision,excused,reason,created_by)
            values(${q(excused)},${q(owner)},1,'quiz',1,true,'Fictional exemption',${q(admin)});`);

        for (const run of [reviewed, released, excused]) {
            const protectedPlan = await plan("course_run", run, manager);
            assert.equal(protectedPlan.can_confirm, false);
            assert.ok(protectedPlan.blockers.some(({kind}) => kind === "private.course_weighted_policies"));
            await expectCode(confirm(protectedPlan, manager), "23503");
        }
        await expectCode(sql(`delete from private.course_weighted_policies where run_id=${q(unused)}`), "42501");
        await expectCode(sql(`update private.course_weighted_policies set threshold=61 where run_id=${q(unused)}`), "42501");
        const stale = await plan("course_run", unused, manager);
        assert.equal(stale.can_confirm, true);
        assert.equal(stale.counts["private.course_weighted_policies"], 1);
        await sql(`${policy(unused, 2)};`);
        await expectCode(confirm(stale, manager), "40001");
        const reviewedPlan = await plan("course_run", unused, manager);
        assert.equal(reviewedPlan.counts["private.course_weighted_policies"], 2);
        const operation = await confirm(reviewedPlan, manager);
        await expectCode(sql(`${policy(unused, 3)};`), "55000");
        await expectCode(sql(`${review(unused)};`), "55000");
        const execution = await permit(operation, manager);
        await worker("apply", key(operation, execution));
        assert.equal((await worker("complete", `${key(operation, execution)},true,true`)).status, "completed");
        assert.equal(await sql(`select count(*) from public.course_runs where id=${q(unused)}`), "0");
        assert.equal(await sql(`select count(*) from private.course_weighted_policies where run_id=${q(unused)}`), "0");
        assert.equal(await sql(`select count(*) from private.course_weighted_policies where run_id in (${[sibling, reviewed, released, excused].map(q).join(',')})`), "4");
        assert.equal(await sql(`select count(*) from private.course_weighted_reviews where run_id in (${q(reviewed)},${q(released)})`), "2");
        assert.equal(await sql(`select count(*) from private.course_weighted_releases where run_id=${q(released)}`), "1");
        assert.equal(await sql(`select count(*) from private.course_weighted_exemptions where run_id=${q(excused)}`), "1");
    });
    await check("One confirmation deletes unused course dates and linked offers while retaining attended records", async () => {
        const template = randomUUID(), published = randomUUID(), linked = randomUUID(), attended = randomUUID(), session = randomUUID();
        const linkedSession = randomUUID(), jobs = [randomUUID(), randomUUID()];
        await sql(`insert into public.course_templates(id,title) values(${q(template)},'Fictional protected template');
          insert into public.course_runs(id,template_id,published) values
            (${q(published)},${q(template)},true),(${q(linked)},${q(template)},false),(${q(attended)},${q(template)},false);
          insert into public.course_sessions(course_run_id,starts_at,ends_at)
            values (${q(published)},'2044-01-05 09:00+00','2044-01-05 10:00+00');
          insert into public.course_sessions(id,course_run_id,starts_at,ends_at)
            values (${q(session)},${q(attended)},'2044-01-05 09:00+00','2044-01-05 10:00+00'),
                   (${q(linkedSession)},${q(linked)},'2044-01-05 09:00+00','2044-01-05 10:00+00');
          insert into public.jobs(id,course_run_id,title,customer_name,delivery_type,status,amount,total_amount,currency,rate_unit,terms)
            values ${jobs.map((job) => `(${q(job)},${q(linked)},'Fictional offer','Fictional organisation','online','published',50,50,'EUR','fixed_total','Fictional terms')`).join(",")};
          insert into public.job_sessions(job_id,course_session_id,starts_at,ends_at)
            select id,${q(linkedSession)},'2044-01-05 09:00+00','2044-01-05 10:00+00' from public.jobs where course_run_id=${q(linked)};
          insert into private.course_attendance(session_id,user_id,state) values(${q(session)},${q(owner)},'attended');`);
        const hidden = await plan("course_run", attended, manager);
        assert.equal(hidden.can_confirm, false);
        assert.ok(hidden.blockers.some((item) => item.kind === "private.course_attendance"));
        await expectCode(confirm(hidden, manager), "23503");
        for (const run of [published, linked]) {
            const preview = await plan("course_run", run, manager);
            assert.equal(preview.can_confirm, true);
            assert.equal(preview.counts["public.course_sessions"], 1);
            if (run === linked) {
                assert.equal(preview.counts["public.jobs"], 2);
                assert.equal(preview.counts["public.job_sessions"], 2);
            }
            const op = await confirm(preview, manager);
            const execution = await permit(op, manager);
            await worker("apply", key(op, execution));
            assert.equal((await worker("complete", `${key(op, execution)},true,true`)).status, "completed");
            assert.equal(await sql(`select count(*) from public.course_runs where id=${q(run)}`), "0");
        }
        assert.equal(await sql(`select count(*) from public.jobs where course_run_id=${q(linked)}`), "0");
        assert.equal(await sql(`select count(*) from public.course_sessions where id=${q(session)}`), "1");
        assert.equal(await sql(`select count(*) from public.course_templates where id=${q(template)}`), "1");
    });
    await check("A reviewed course cascade includes its accepted assignment, dedicated rooms and dispatch", async () => {
        const company = randomUUID(), template = randomUUID(), run = randomUUID();
        const sibling = randomUUID(), job = randomUUID(), claim = randomUUID(), room = randomUUID(), otherRoom = randomUUID();
        await sql(`insert into public.organisations(id,name) values(${q(company)},'Fictional dispatch customer');
          insert into public.course_templates(id,title) values(${q(template)},'Fictional shared template');
          insert into public.course_runs(id,template_id,organisation_id,published) values
            (${q(run)},${q(template)},${q(company)},true),(${q(sibling)},${q(template)},${q(company)},true);
          insert into public.jobs(id,course_run_id,title,customer_name,delivery_type,status,amount,total_amount,currency,rate_unit,terms)
            values(${q(job)},${q(run)},'Fictional accepted offer','Fictional dispatch customer','online','filled',50,50,'EUR','fixed_total','Fictional terms');
          insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,amount,total_amount,currency,rate_unit,terms,terms_version)
            values(${q(claim)},${q(job)},${q(owner)},${q(randomUUID())},50,50,'EUR','fixed_total','Fictional terms',1);
          insert into public.chat_rooms(id,job_id,owner_id) values(${q(room)},${q(job)},${q(owner)});
          insert into public.chat_rooms(id,kind,course_run_id) values(${q(otherRoom)},'participant_course',${q(sibling)});
          insert into public.chat_members(room_id,user_id) values(${q(room)},${q(owner)});
          insert into public.messages(room_id,sender_id,client_id,request_hash,body)
            values(${q(room)},${q(owner)},${q(randomUUID())},'fictional-hash','Fictional course message');
          insert into private.job_dispatch(job_id,organisation_id) values(${q(job)},${q(company)});`);
        const preview = await plan("course_run", run, manager);
        assert.equal(preview.can_confirm, true, JSON.stringify(preview.blockers));
        for (const relation of ["public.jobs", "public.job_claims", "public.chat_rooms", "public.messages", "private.job_dispatch"]) {
            assert.equal(preview.counts[relation], 1, relation);
        }
        const operation = await confirm(preview, manager), execution = await permit(operation, manager);
        await worker("apply", key(operation, execution));
        assert.equal((await worker("complete", `${key(operation, execution)},true,true`)).status, "completed");
        assert.equal(await sql(`select count(*) from public.course_runs where id=${q(run)}`), "0");
        assert.equal(await sql(`select count(*) from public.job_claims where id=${q(claim)}`), "0");
        assert.equal(await sql(`select count(*) from public.chat_rooms where id=${q(room)}`), "0");
        assert.equal(await sql(`select count(*) from public.chat_rooms where id=${q(otherRoom)}`), "1");
        assert.equal(await sql(`select count(*) from public.course_templates where id=${q(template)}`), "1");
    });
    await check(
        "A reviewed job purge includes its briefing and request records",
        async () => {
            const job = randomUUID();
            await sql(`insert into public.jobs(id,title,customer_name,delivery_type,status,amount,total_amount,currency,rate_unit,terms) values(${q(job)},'Fictional briefing job','Fictional organisation','online','archived',50,50,'EUR','fixed_total','Fictional terms');
      insert into private.job_briefings(job_id,version,contact_name) values(${q(job)},1,'Fictional contact');
      insert into private.job_briefing_requests(actor_id,request_id,job_id,expected_version,request_payload,saved_version) values(${q(admin)},${q(randomUUID())},${q(job)},0,'{}'::jsonb,1);`);
            const preview = await plan("job", job);
            assert.equal(preview.can_confirm, true);
            assert.equal(preview.counts["private.job_briefings"], 1);
            assert.equal(preview.counts["private.job_briefing_requests"], 1);
            const op = await confirm(preview),
                execution = await permit(op);
            await worker("apply", key(op, execution));
            await worker("complete", `${key(op, execution)},true,true`);
            assert.equal(
                await sql(
                    `select count(*) from private.job_briefings where job_id=${q(job)}`,
                ),
                "0",
            );
            assert.equal(
                await sql(
                    `select count(*) from private.job_briefing_requests where job_id=${q(job)}`,
                ),
                "0",
            );
            assert.equal(
                await sql(`select count(*) from public.jobs where id=${q(job)}`),
                "0",
            );
        },
    );
    await check(
        "A standalone job cascade removes its accepted work, discussion and files while keeping the course",
        async () => {
            const [
                company,
                template,
                run,
                courseDate,
                job,
                sibling,
                claim,
                allocation,
                room,
                participantRoom,
                message,
                comment,
                request,
                jobFile,
                roomFile,
                jobVersion,
                roomVersion,
                withdrawal,
                substitution,
                replacement,
                replacementRequest,
            ] = Array.from({ length: 21 }, randomUUID);
            const paths = [`fictional/job/${jobVersion}`, `fictional/room/${roomVersion}`];
            const notices = [
                ["claim_confirmed", claim],
                ["chat_message", message],
                ["session_reminder", allocation],
                ["course_offer_published", job],
                ["assignment_withdrawal_requested", withdrawal],
                ["substitution_proposed", substitution],
                ["replacement_available", replacement],
            ].map(([kind, resource]) => [randomUUID(), kind, resource]);
            const noticeIds = notices.map(([id]) => q(id)).join(",");
            await sql(`insert into public.organisations(id,name) values(${q(company)},'Fictional standalone job customer');
              insert into public.course_templates(id,title) values(${q(template)},'Fictional standalone job template');
              insert into public.course_runs(id,template_id,organisation_id,published) values(${q(run)},${q(template)},${q(company)},true);
              insert into public.course_sessions(id,course_run_id,starts_at,ends_at)
                values(${q(courseDate)},${q(run)},'2045-02-05 09:00+00','2045-02-05 10:00+00');
              insert into public.jobs(id,course_run_id,title,customer_name,delivery_type,status,amount,total_amount,currency,rate_unit,terms)
                values(${q(job)},${q(run)},'Fictional accepted job','Fictional company','online','filled',50,50,'EUR','fixed_total','Fictional terms'),
                  (${q(sibling)},${q(run)},'Fictional sibling job','Fictional company','online','draft',50,50,'EUR','fixed_total','Fictional terms');
              insert into public.job_sessions(job_id,course_session_id,starts_at,ends_at) values
                (${q(job)},${q(courseDate)},'2045-02-05 09:00+00','2045-02-05 10:00+00'),
                (${q(sibling)},${q(courseDate)},'2045-02-05 09:00+00','2045-02-05 10:00+00');
              insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,amount,total_amount,currency,rate_unit,terms,terms_version)
                values(${q(claim)},${q(job)},${q(owner)},${q(randomUUID())},50,50,'EUR','fixed_total','Fictional accepted terms',1);
              insert into public.assignment_sessions(id,claim_id,lecturer_id,starts_at,ends_at)
                values(${q(allocation)},${q(claim)},${q(owner)},'2045-02-05 09:00+00','2045-02-05 10:00+00');
              insert into public.claim_events(claim_id,actor_id,event_type) values(${q(claim)},${q(owner)},'confirmed');
              insert into private.claim_revenue_ledger(claim_id,job_id,organisation_id,lecturer_id,gross_amount,gross_total_amount,platform_percent,platform_total_amount,lecturer_net_amount,lecturer_net_total_amount,currency)
                values(${q(claim)},${q(job)},${q(company)},${q(owner)},100,100,50,50,50,50,'EUR');
              insert into public.chat_rooms(id,job_id,kind,course_run_id,owner_id) values
                (${q(room)},${q(job)},'lecturer_course',${q(run)},${q(owner)}),(${q(participantRoom)},null,'participant_course',${q(run)},null);
              insert into public.chat_members(room_id,user_id) values(${q(room)},${q(owner)});
              insert into public.messages(id,room_id,sender_id,client_id,request_hash,body)
                values(${q(message)},${q(room)},${q(owner)},${q(randomUUID())},'fictional-hash','Fictional lecturer message');
              insert into private.resource_comments(id,job_id,author_id,request_id,body)
                values(${q(comment)},${q(job)},${q(owner)},${q(randomUUID())},'Fictional job discussion');
              insert into private.resource_comment_revisions(comment_id,version,actor_id,previous_body,action)
                values(${q(comment)},1,${q(owner)},'Fictional previous comment','edit');
              insert into private.client_course_requests(id,organisation_id,requested_by,client_id,payload,job_id,status)
                values(${q(request)},${q(company)},${q(owner)},${q(randomUUID())},'{}',${q(job)},'published');
              insert into private.client_request_briefs(request_id,content) values(${q(request)},'{"description":"Fictional job brief"}');
              insert into private.course_offer_mail_publications(job_id) values(${q(job)});
              insert into private.assignment_withdrawals(id,claim_id,lecturer_id,status,reason)
                values(${q(withdrawal)},${q(claim)},${q(owner)},'pending','Fictional withdrawal');
              insert into private.assignment_withdrawal_commands(actor_id,request_id,payload,withdrawal_id)
                values(${q(owner)},${q(randomUUID())},'{}',${q(withdrawal)});
              insert into private.job_substitutions(id,original_claim_id,job_id,target_user_id,proposed_by,request_id,reason,quote,quote_hash,expires_at)
                values(${q(substitution)},${q(claim)},${q(job)},${q(other)},${q(owner)},${q(randomUUID())},'Fictional substitution','{}','fictional-hash',now()+interval '1 day');
              insert into private.replacement_offers(id,original_claim_id,requested_by,reason,mode,job_version)
                values(${q(replacement)},${q(claim)},${q(owner)},'Fictional replacement','open',1);
              insert into private.replacement_requests(actor_id,request_id,payload,result)
                values(${q(owner)},${q(replacementRequest)},jsonb_build_object('offer',${q(replacement)}::uuid),'{}');
              insert into public.documents(id,owner_id,uploaded_by,scope,kind,job_id,room_id,original_name,mime_type,size_bytes,status,client_id) values
                (${q(jobFile)},${q(owner)},${q(owner)},'job_before','material',${q(job)},null,'Fictional job material.txt','text/plain',100,'clean',${q(randomUUID())}),
                (${q(roomFile)},${q(owner)},${q(owner)},'room','chat',null,${q(room)},'Fictional room file.txt','text/plain',100,'clean',${q(randomUUID())});
              insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,status) values
                (${q(jobVersion)},${q(jobFile)},${q(owner)},${q(randomUUID())},1,${q(paths[0])},'Fictional job material.txt','text/plain',100,'clean'),
                (${q(roomVersion)},${q(roomFile)},${q(owner)},${q(randomUUID())},1,${q(paths[1])},'Fictional room file.txt','text/plain',100,'clean');
              update public.documents set current_version_id=${q(jobVersion)} where id=${q(jobFile)};
              update public.documents set current_version_id=${q(roomVersion)} where id=${q(roomFile)};`);

            const beforeNotice = await plan("job", job);
            assert.equal(beforeNotice.can_confirm, true, JSON.stringify(beforeNotice.blockers));
            await sql(`insert into public.notifications(id,user_id,kind,resource_id) values ${notices.map(([id, kind, resource]) => `(${q(id)},${q(owner)},${q(kind)},${q(resource)})`).join(",")};
              insert into private.notification_email_outbox(notification_id,occurrence_at)
                select id,created_at from public.notifications where id in (${noticeIds})
                on conflict do nothing;`);
            await expectCode(confirm(beforeNotice), "40001");
            await expectCode(plan("job", job, owner), "42501");
            const preview = await plan("job", job);
            assert.equal(preview.can_confirm, true, JSON.stringify(preview.blockers));
            const ownedRows = [
                ["public.jobs", `id=${q(job)}`],
                ["public.job_sessions", `job_id=${q(job)}`],
                ["public.job_claims", `id=${q(claim)}`],
                ["public.assignment_sessions", `id=${q(allocation)}`],
                ["public.claim_events", `claim_id=${q(claim)}`],
                ["private.claim_revenue_ledger", `claim_id=${q(claim)}`],
                ["public.chat_rooms", `id=${q(room)}`],
                ["public.chat_members", `room_id=${q(room)}`],
                ["public.messages", `id=${q(message)}`],
                ["private.resource_comments", `id=${q(comment)}`],
                ["private.resource_comment_revisions", `comment_id=${q(comment)}`],
                ["private.client_course_requests", `id=${q(request)}`],
                ["private.client_request_briefs", `request_id=${q(request)}`],
                ["private.course_offer_mail_publications", `job_id=${q(job)}`],
                ["private.assignment_withdrawals", `id=${q(withdrawal)}`],
                ["private.assignment_withdrawal_commands", `withdrawal_id=${q(withdrawal)}`],
                ["private.job_substitutions", `id=${q(substitution)}`],
                ["private.replacement_offers", `id=${q(replacement)}`],
                ["private.replacement_requests", `request_id=${q(replacementRequest)}`],
            ];
            for (const [relation] of ownedRows) assert.equal(preview.counts[relation], 1, relation);
            assert.equal(preview.counts["public.notifications"], notices.length);
            assert.equal(preview.counts["private.notification_email_outbox"], notices.length);
            assert.equal(preview.counts["public.documents"], 2);
            assert.equal(preview.counts["public.document_versions"], 2);
            assert.ok(preview.counts["private.client_request_revisions"] >= 2);
            assert.equal(preview.counts["public.course_runs"] ?? 0, 0);

            const op = await confirm(preview),
                execution = await permit(op);
            const work = await worker("work", key(op, execution));
            assert.equal(work.objects.length, 4);
            assert.deepEqual(new Set(work.objects.map(({ path }) => path)), new Set(paths));
            await expectCode(
                sql(`update private.resource_comments set body='Late edit' where id=${q(comment)}`),
                "55000",
            );
            await worker("apply", key(op, execution));
            assert.equal((await worker("complete", `${key(op, execution)},true,true`)).status, "completed");

            for (const [relation, selector] of [
                ...ownedRows,
                ["private.client_request_revisions", `request_id=${q(request)}`],
                ["public.documents", `id in (${q(jobFile)},${q(roomFile)})`],
                ["public.document_versions", `id in (${q(jobVersion)},${q(roomVersion)})`],
                ["public.notifications", `id in (${noticeIds})`],
                ["private.notification_email_outbox", `notification_id in (${noticeIds})`],
            ])
                assert.equal(await sql(`select count(*) from ${relation} where ${selector}`), "0", relation);
            for (const [relation, selector] of [
                ["public.organisations", `id=${q(company)}`],
                ["public.course_templates", `id=${q(template)}`],
                ["public.course_runs", `id=${q(run)}`],
                ["public.course_sessions", `id=${q(courseDate)}`],
                ["public.jobs", `id=${q(sibling)}`],
                ["public.job_sessions", `job_id=${q(sibling)} and course_session_id=${q(courseDate)}`],
                ["public.chat_rooms", `id=${q(participantRoom)}`],
            ])
                assert.equal(await sql(`select count(*) from ${relation} where ${selector}`), "1", relation);
        },
    );
    await check("An unreviewed single-job invoice is purged with its PDF and inbox while a shared invoice blocks", async () => {
        const [job, sibling, claim, siblingClaim, invoice, file, version] = Array.from({ length: 7 }, randomUUID);
        await sql(`insert into public.jobs(id,title,customer_name,delivery_type,status,amount,total_amount,currency,rate_unit,terms)
          values(${q(job)},'Fictional invoice job','Fictional company','online','filled',50,50,'EUR','fixed_total','Fictional terms'),
                (${q(sibling)},'Fictional sibling invoice job','Fictional company','online','filled',50,50,'EUR','fixed_total','Fictional terms');
          insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,amount,total_amount,currency,rate_unit,terms,terms_version)
            values(${q(claim)},${q(job)},${q(owner)},${q(randomUUID())},50,50,'EUR','fixed_total','Fictional invoiced terms',1),
                  (${q(siblingClaim)},${q(sibling)},${q(owner)},${q(randomUUID())},50,50,'EUR','fixed_total','Fictional invoiced terms',1);
          insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id)
            values(${q(file)},${q(owner)},${q(owner)},'personal','invoice','Fictional submitted invoice.pdf','application/pdf',100,'clean',${q(randomUUID())});
          insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,status,sha256)
            values(${q(version)},${q(file)},${q(owner)},${q(randomUUID())},1,${q(`fictional/invoice/${version}`)},'Fictional submitted invoice.pdf','application/pdf',100,'clean',repeat('a',64));
          update public.documents set current_version_id=${q(version)} where id=${q(file)};
          insert into public.invoices(id,user_id,number,issued_on,due_on,currency,total_amount,document_version_id,client_id,status)
            values(${q(invoice)},${q(owner)},'FICTIONAL-PURGE-SUBMITTED','2001-01-01','2001-02-01','EUR',50,${q(version)},${q(randomUUID())},'submitted');
          insert into public.invoice_items(invoice_id,claim_id) values(${q(invoice)},${q(claim)}),(${q(invoice)},${q(siblingClaim)});
          insert into private.document_organisation(user_id,document_id) values(${q(owner)},${q(file)});
          insert into private.job_matching_requirements(job_id,qualification_topics,teaching_languages)
            values(${q(job)},'{}','{de}');`);
        const shared = await plan("job", job);
        assert.equal(shared.can_confirm, false);
        assert.equal(shared.counts["public.invoices"] ?? 0, 0);
        assert.ok(shared.blockers.some(({ kind }) => kind === "public.invoice_items"));
        await expectCode(confirm(shared), "23503");

        await sql(`delete from public.invoice_items where invoice_id=${q(invoice)} and claim_id=${q(siblingClaim)}`);
        const preview = await plan("job", job);
        assert.deepEqual(preview.blockers, []);
        assert.equal(preview.can_confirm, true);
        const removed = [
            ["public.invoices", `id=${q(invoice)}`],
            ["public.invoice_items", `invoice_id=${q(invoice)}`],
            ["public.documents", `id=${q(file)}`],
            ["public.document_versions", `id=${q(version)}`],
            ["private.document_organisation", `document_id=${q(file)}`],
            ["public.notifications", `kind='invoice_submitted' and resource_id=${q(invoice)}`],
            ["private.job_matching_requirements", `job_id=${q(job)}`],
        ];
        for (const [relation] of removed) assert.equal(preview.counts[relation], 1, relation);
        const operation = await confirm(preview);
        await sql("delete from public.role_permissions where role = 'admin' and permission = 'finance.manage'");
        await expectCode(permit(operation), "42501");
        await sql("insert into public.role_permissions(role,permission) values('admin','finance.manage')");
        const execution = await permit(operation);
        const work = await worker("work", key(operation, execution));
        assert.ok(work.objects.some(({path}) => path === `fictional/invoice/${version}`));
        await expectCode(sql(`update private.job_matching_requirements set teaching_languages='{en}' where job_id=${q(job)}`), "55000");
        await worker("apply", key(operation, execution));
        assert.equal((await worker("complete", `${key(operation, execution)},true,true`)).status, "completed");
        for (const [relation, selector] of removed)
            assert.equal(await sql(`select count(*) from ${relation} where ${selector}`), "0", relation);
        assert.equal(await sql(`select count(*) from public.job_claims where id=${q(siblingClaim)}`), "1");
    });

    await check("A standalone job purge cannot remove the source of an approved invoice", async () => {
        const [job, claim, invoice, file, version] = Array.from({ length: 5 }, randomUUID);
        await sql(`insert into public.jobs(id,title,customer_name,delivery_type,status,amount,total_amount,currency,rate_unit,terms)
          values(${q(job)},'Fictional invoiced job','Fictional company','online','filled',50,50,'EUR','fixed_total','Fictional terms');
          insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,amount,total_amount,currency,rate_unit,terms,terms_version)
            values(${q(claim)},${q(job)},${q(owner)},${q(randomUUID())},50,50,'EUR','fixed_total','Fictional invoiced terms',1);
          insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id)
            values(${q(file)},${q(owner)},${q(owner)},'personal','invoice','Fictional approved invoice.pdf','application/pdf',100,'clean',${q(randomUUID())});
          insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,status,sha256)
            values(${q(version)},${q(file)},${q(owner)},${q(randomUUID())},1,${q(`fictional/invoice/${version}`)},'Fictional approved invoice.pdf','application/pdf',100,'clean',repeat('a',64));
          update public.documents set current_version_id=${q(version)} where id=${q(file)};
          insert into public.invoices(id,user_id,number,issued_on,due_on,currency,total_amount,document_version_id,client_id,status)
            values(${q(invoice)},${q(owner)},'FICTIONAL-PURGE-BLOCKER','2001-01-01','2001-02-01','EUR',50,${q(version)},${q(randomUUID())},'approved');
          insert into public.invoice_items(invoice_id,claim_id) values(${q(invoice)},${q(claim)});`);
        const preview = await plan("job", job);
        assert.equal(preview.can_confirm, false);
        assert.equal(preview.counts["public.job_claims"], 1);
        assert.ok(preview.blockers.some(({ kind }) => kind === "public.invoice_items"));
        await expectCode(confirm(preview), "23503");
        assert.equal(await sql(`select status from public.jobs where id=${q(job)}`), "filled");
        assert.equal(await sql(`select status from public.invoices where id=${q(invoice)}`), "approved");
        assert.equal(
            await sql(
                `select count(*) from public.invoice_items where invoice_id=${q(invoice)} and claim_id=${q(claim)}`,
            ),
            "1",
        );
    });
    await check(
        "Private registry and service work stay inaccessible; live permissions and exact ownership are authoritative",
        async () => {
            assert.ok(
                (await call(owner, "deletion_access")).kinds.includes("document"),
                "An active password session with the owning role sees its authorized deletion kinds",
            );
            await expectCode(plan("document", document.document_id, other), "42501");
            assert.equal(
                (
                    await call(
                        owner,
                        "deletion_preview",
                        `'document',${q(document.document_id)}`,
                        "aal1",
                    )
                ).can_confirm,
                true,
            );
            const retired = randomUUID();
            await sql(
                `insert into auth.users(id,email) values(${q(retired)},'retired-deletion@example.invalid');insert into public.user_roles(user_id,role) values(${q(retired)},'participant')`,
            );
            await expectCode(
                plan("document", document.document_id, retired),
                "42501",
            );
            await expectCode(
                actor(owner, "select * from private.deletion_operations"),
                "42501",
            );
            await expectCode(
                actor(
                    owner,
                    `select public._deletion_work(${q(randomUUID())},${q(randomUUID())})`,
                ),
                "42501",
            );
            await expectCode(
                sql(
                    "begin;set local role anon;select public.deletion_access();commit;",
                ),
                "42501",
            );
        },
    );
    await check(
        "Administrators cannot enumerate or purge another person's private or DM files but can manage authorised job material",
        async () => {
            const room = randomUUID(),
                dmFile = randomUUID(),
                job = randomUUID(),
                jobFile = randomUUID();
            await sql(`insert into public.chat_rooms(id,kind,dm_key) values(${q(room)},'dm',${q([owner, manager].sort().join(":"))});
      insert into public.chat_members(room_id,user_id) values(${q(room)},${q(owner)}),(${q(room)},${q(manager)}),(${q(room)},${q(admin)});
      insert into public.jobs(id,title,customer_name,delivery_type,status,amount,total_amount,currency,rate_unit,terms) values(${q(job)},'Fictional document job','Fictional organisation','online','archived',50,50,'EUR','fixed_total','Fictional terms');
      insert into public.documents(id,owner_id,uploaded_by,scope,kind,room_id,original_name,mime_type,size_bytes,status,client_id) values(${q(dmFile)},${q(owner)},${q(owner)},'room','chat',${q(room)},'Fictional DM attachment.txt','text/plain',100,'clean',${q(randomUUID())});
      insert into public.documents(id,owner_id,uploaded_by,scope,kind,job_id,original_name,mime_type,size_bytes,status,client_id) values(${q(jobFile)},${q(owner)},${q(owner)},'job_before','material',${q(job)},'Fictional job material.txt','text/plain',100,'clean',${q(randomUUID())})`);
            for (const id of [document.document_id, dmFile]) {
                await expectCode(plan("document", id), "42501");
                const listed = await call(
                    admin,
                    "deletion_resources",
                    `'document',${q(id)},null,30`,
                );
                assert.deepEqual(listed.items, []);
            }
            assert.equal(
                (await plan("document", document.document_id, owner)).can_confirm,
                true,
            );
            assert.equal((await plan("document", dmFile, owner)).can_confirm, true);
            assert.equal((await plan("document", jobFile, admin)).can_confirm, true);
        },
    );
    await check(
        "Preview changes nothing; wrong confirmation, target kind and actor are denied",
        async () => {
            const p = await plan("document", document.document_id, owner);
            assert.equal(p.can_confirm, true);
            assert.equal(p.counts["public.document_versions"], 2);
            assert.equal(
                await sql(
                    `select deleted_at is null from public.documents where id=${q(document.document_id)}`,
                ),
                "t",
            );
            await expectCode(
                call(
                    owner,
                    "deletion_confirm",
                    `${q(p.plan_id)},${q(randomUUID())},'delete'`,
                ),
                "22023",
            );
            await expectCode(confirm(p, other), "22023");
            await expectCode(plan("auth.users", owner), "42501");
        },
    );
    await check(
        "A changed preview cannot delete a newer document version or changed metadata",
        async () => {
            const p = await plan("document", document.document_id, owner);
            await actor(
                owner,
                `select public.rename_document(${q(document.document_id)},'Fictional revised.pdf',false)`,
            );
            await expectCode(confirm(p, owner), "40001");
            assert.equal(
                await sql(
                    `select deleted_at is null from public.documents where id=${q(document.document_id)}`,
                ),
                "t",
            );
        },
    );

    let operation, execution, originalPlan;
    const requestId = randomUUID();
    await sql(
        `insert into storage.objects values('portal-clean',${q(document.object_path)})`,
    );
    let lease = await service(
        `select public.deletion_upload_begin(${q(document.document_id)},${q(second.version_id)})`,
    );
    await check(
        "Only one active writer owns each immutable version; different versions and settled retries remain supported",
        async () => {
            await expectCode(
                service(
                    `select public.deletion_upload_begin(${q(document.document_id)},${q(second.version_id)})`,
                ),
                "55000",
            );
            const oldVersionLease = await service(
                `select public.deletion_upload_begin(${q(document.document_id)},${q(document.version_id)})`,
            );
            assert.equal(
                await sql(
                    `select count(*) from private.deletion_upload_leases where document_id=${q(document.document_id)}`,
                ),
                "2",
            );
            await service(
                `select public.deletion_upload_end(${q(oldVersionLease)});select public.deletion_upload_end(${q(lease)})`,
            );
            lease = await service(
                `select public.deletion_upload_begin(${q(document.document_id)},${q(second.version_id)})`,
            );
            assert.equal(
                await sql(
                    `select count(*) from private.deletion_upload_leases where document_id=${q(document.document_id)}`,
                ),
                "1",
            );
        },
    );
    await check(
        "Confirm fixes both-bucket all-version manifest and waits for an existing service-owned upload lease",
        async () => {
            originalPlan = await plan("document", document.document_id, owner);
            operation = await confirm(originalPlan, owner, requestId);
            execution = await permit(operation, owner);
            const work = await worker("work", key(operation, execution));
            assert.equal(work.pending_uploads, 1);
            assert.equal(work.objects.length, 4);
            assert.equal(new Set(work.objects.map((o) => o.path)).size, 2);
            assert.deepEqual(
                new Set(work.objects.map((o) => o.bucket)),
                new Set(["portal-clean", "portal-quarantine"]),
            );
            assert.equal(
                work.objects.some((o) => o.path === document.object_path),
                true,
            );
            await expectCode(worker("apply", key(operation, execution)), "55000");
            await expectCode(
                service(
                    `select public.deletion_upload_begin(${q(document.document_id)},${q(second.version_id)})`,
                ),
                "55000",
            );
            assert.equal(
                await actor(
                    owner,
                    `select count(*) from public.documents where id=${q(document.document_id)}`,
                ),
                "0",
            );
            // Definer callers also depend on this gate, independently of restrictive RLS.
            assert.equal(
                await actor(
                    owner,
                    `select private.can_access_document(${q(document.document_id)})`,
                ),
                "f",
            );
            await expectCode(
                service(
                    `update public.documents set status='clean' where id=${q(document.document_id)}`,
                ),
                "55000",
            );
            await expectCode(reserve(owner, document.document_id), "42501");
        },
    );
    await check(
        "An exact retry resumes one operation; changed request reuse and caller-service forgery fail",
        async () => {
            assert.equal(
                (await confirm(originalPlan, owner, requestId)).operation_id,
                operation.operation_id,
            );
            await expectCode(
                call(
                    owner,
                    "deletion_confirm",
                    `${q(randomUUID())},${q(requestId)},'DELETE'`,
                ),
                "22023",
            );
            await expectCode(
                call(other, "deletion_execution", q(operation.operation_id)),
                "42501",
            );
            await expectCode(
                worker("work", `${q(operation.operation_id)},${q(randomUUID())}`),
                "42501",
            );
            await expectCode(
                actor(
                    owner,
                    `select set_config('private.deletion_operation',${q(operation.operation_id)},true);select public.rename_document(${q(document.document_id)},'Forgery.pdf',false)`,
                ),
                "42501",
            );
        },
    );
    await check(
        "Released upload lease permits real relational deletion; missing external acknowledgement cannot complete",
        async () => {
            await service(`select public.deletion_upload_end(${q(lease)})`);
            await worker("apply", key(operation, execution));
            assert.equal(
                await sql(
                    `select count(*) from public.documents where id=${q(document.document_id)}`,
                ),
                "0",
            );
            assert.equal(
                await sql(
                    `select count(*) from public.document_versions where document_id=${q(document.document_id)}`,
                ),
                "0",
            );
            await expectCode(
                worker("complete", `${key(operation, execution)},false,true`),
                "55000",
            );
            await expectCode(
                worker("complete", `${key(operation, execution)},true,true`),
                "55000",
            );
            await sql(
                `delete from storage.objects where name=${q(document.object_path)}`,
            );
            assert.equal(
                (await worker("complete", `${key(operation, execution)},true,true`))
                    .status,
                "completed",
            );
            assert.equal(
                (await call(owner, "deletion_status", q(operation.operation_id)))
                    .status,
                "completed",
            );
        },
    );
    await check(
        "Completed old document IDs and exact clean/quarantine paths cannot be resurrected",
        async () => {
            for (const bucket of ["portal-clean", "portal-quarantine"])
                await expectCode(
                    sql(
                        `insert into storage.objects values(${q(bucket)},${q(second.object_path)})`,
                    ),
                    "55000",
                );
            await expectCode(
                sql(
                    `insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,client_id) values(${q(document.document_id)},${q(owner)},${q(owner)},'personal','material','Old identifier.pdf','application/pdf',100,${q(randomUUID())})`,
                ),
                "55000",
            );
            assert.equal(
                await sql(
                    `select count(*) from private.deletion_storage_fences where path=${q(document.object_path)}`,
                ),
                "2",
            );
        },
    );
    await check(
        "Management cannot purge unrelated business resources; admin self/equal account deletion is denied",
        async () => {
            const org = randomUUID();
            await sql(
                `insert into public.organisations(id,name) values(${q(org)},'Fictional deletion organisation')`,
            );
            await expectCode(plan("organisation", org, manager), "42501");
            await expectCode(plan("account", admin), "42501");
            assert.equal((await plan("organisation", org)).can_confirm, true);
            const rows = await call(
                admin,
                "deletion_resources",
                `'organisation','Fictional deletion organisation',null,30`,
            );
            assert.equal(
                rows.items.some(
                    (row) =>
                        row.id === org && row.label === "Fictional deletion organisation",
                ),
                true,
            );
            const event = randomUUID();
            await sql(
                `insert into public.personal_events(id,user_id,title,starts_at,ends_at) values(${q(event)},${q(owner)},'Private event must not leave owner',now()+interval '1 day',now()+interval '2 day')`,
            );
            await expectCode(plan("personal_event", event), "42501");
            const ops = await call(owner, "deletion_operations");
            assert.equal(Array.isArray(ops.items), true);
        },
    );
    await check(
        "Permanent deletion preserves private DM membership and author boundaries even for administrators",
        async () => {
            const room = randomUUID(),
                message = randomUUID();
            await sql(`insert into public.chat_rooms(id,kind,dm_key) values(${q(room)},'dm',${q([owner, other].sort().join(":"))});
      insert into public.chat_members(room_id,user_id) values(${q(room)},${q(owner)}),(${q(room)},${q(other)});
      insert into public.messages(id,room_id,sender_id,client_id,request_hash,body) values(${q(message)},${q(room)},${q(owner)},${q(randomUUID())},'fixture','Private authored DM must not enter an admin deletion list')`);
            await expectCode(plan("message", message), "42501");
            await sql(
                `insert into public.chat_members(room_id,user_id) values(${q(room)},${q(admin)})`,
            );
            await expectCode(plan("message", message), "42501");
            const p = await plan("message", message, owner);
            assert.equal(p.can_confirm, true);
            const op = await confirm(p, owner),
                ex = await permit(op, owner);
            await sql(
                `update public.chat_members set removed_at=now() where room_id=${q(room)} and user_id=${q(owner)}`,
            );
            await expectCode(worker("apply", key(op, ex)), "42501");
            await sql(
                `update public.chat_members set removed_at=null where room_id=${q(room)} and user_id=${q(owner)}`,
            );
            await worker("apply", key(op, ex));
            await worker("complete", `${key(op, ex)},true,true`);
            assert.equal(
                await sql(
                    `select count(*) from public.messages where id=${q(message)}`,
                ),
                "0",
            );
            assert.equal(
                await sql(
                    `select count(*) from public.chat_message_revisions where message_id=${q(message)}`,
                ),
                "0",
            );
        },
    );
    await check(
        "Commercial document references are explicit protected blockers, preserving exact snapshots",
        async () => {
            const d = await reserve();
            const contract = randomUUID();
            await sql(
                `insert into public.contracts(id,user_id,status,effective_from,version,document_version_id,document_sha256) values(${q(contract)},${q(owner)},'active',now()-interval '1 day',1,${q(d.version_id)},repeat('a',64))`,
            );
            const p = await plan("document", d.document_id, owner);
            assert.equal(p.can_confirm, false);
            assert.equal(
                p.blockers.some((b) => b.kind === "public.contracts"),
                true,
            );
            await expectCode(confirm(p, owner), "23503");
            assert.equal(
                await sql(
                    `select document_version_id from public.contracts where id=${q(contract)}`,
                ),
                d.version_id,
            );
        },
    );
    await check(
        "Own dependencies are planned while a shared externally owned job remains a protected blocker",
        async () => {
            // Planner scan choices must not reorder a reviewed graph or its blockers.
            // Otherwise identical data can intermittently produce a stale-plan error
            // instead of the exact protected-dependency refusal asserted below.
            const snapshotFor = (mode, scan) =>
                sql(`begin;set local plan_cache_mode=${q(mode)};
          set local enable_seqscan=${scan === "index" ? "off" : "on"};
          set local enable_indexscan=${scan === "index" ? "on" : "off"};
          set local enable_bitmapscan=off;
          select private.deletion_snapshot('account',${q(owner)});commit;`).then(
                    JSON.parse,
                );
            assert.deepEqual(
                await snapshotFor("force_custom_plan", "index"),
                await snapshotFor("force_generic_plan", "sequential"),
            );
            const ownPlan = await plan("account", owner);
            assert.equal(ownPlan.can_confirm, true);
            assert(ownPlan.counts["public.contracts"] > 0);
            const sharedJob = randomUUID();
            await sql(
                `insert into public.jobs(id,created_by,title,customer_name,delivery_type,status,amount,total_amount,currency,rate_unit,terms) values(${q(sharedJob)},${q(owner)},'Shared external ownership','Fictional organisation','online','draft',10,10,'EUR','fixed_total','Fictional terms')`,
            );
            const p = await plan("account", owner);
            assert.equal(p.can_confirm, false);
            assert.equal(p.blockers.length > 0, true);
            await expectCode(confirm(p), "23503");
            assert.equal(
                await sql(`select active from public.profiles where id=${q(owner)}`),
                "t",
            );
            await sql(`delete from public.jobs where id=${q(sharedJob)}`);
            assert.equal((await plan("account", owner)).can_confirm, true);
        },
    );
    await check(
        "Unused invited account is fenced immediately, then only completes after native Auth absence",
        async () => {
            const unused = randomUUID();
            await sql(`insert into auth.users(id,email) values(${q(unused)},'permanent-unused@example.invalid');insert into public.user_roles(user_id,role) values(${q(unused)},'lecturer');
      insert into public.invitation_requests(actor_id,idempotency_key,email,status,auth_user_id) values(${q(admin)},${q(randomUUID())},'permanent-unused@example.invalid','sent',${q(unused)})`);
            await call(
                unused,
                "save_account_profile",
                `'{"display_name":"Fictional profile edited before deletion","bio_de":"Private authored profile"}'`,
            );
            const audit = randomUUID();
            await sql(
                `insert into public.audit_events(id,actor_id,action,resource_id) values(${q(audit)},${q(unused)},'qualification.attested',${q(unused)})`,
            );
            const beforeAudit = await call(
                admin,
                "admin_audit_events",
                `null,null,'qualification.attested',${q(unused)}`,
            );
            assert.equal(
                beforeAudit.items.some(
                    (item) =>
                        item.id === audit &&
                        item.actor_name === "Fictional profile edited before deletion",
                ),
                true,
            );
            const p = await plan("account", unused);
            assert.equal(p.can_confirm, true);
            assert.equal(p.counts.audit_attributions, 1);
            const op = await confirm(p);
            const ex = await permit(op);
            assert.equal(
                await sql(`select active from public.profiles where id=${q(unused)}`),
                "f",
            );
            await expectCode(call(unused, "deletion_access"), "42501");
            await worker("apply", key(op, ex));
            await expectCode(worker("complete", `${key(op, ex)},true,true`), "55000");
            await sql(`delete from auth.users where id=${q(unused)}`);
            assert.equal(
                (await worker("complete", `${key(op, ex)},true,true`)).status,
                "completed",
            );
            assert.equal(
                await sql(
                    `select count(*) from public.invitation_requests where auth_user_id=${q(unused)}`,
                ),
                "0",
            );
            assert.equal(
                await sql(
                    `select actor_id is null from public.audit_events where id=${q(audit)}`,
                ),
                "t",
            );
            const afterAudit = await call(
                admin,
                "admin_audit_events",
                `null,null,'qualification.attested',${q(unused)}`,
            );
            assert.equal(
                afterAudit.items.some(
                    (item) => item.id === audit && item.actor_name === "",
                ),
                true,
            );
            assert.equal(
                JSON.stringify(afterAudit).includes("Private authored profile"),
                false,
            );
            assert.equal(
                (await call(admin, "deletion_status", q(op.operation_id))).status,
                "completed",
            );
        },
    );
    await check(
        "Revoked worker authority and expired permits cannot continue a confirmed operation",
        async () => {
            const org = randomUUID();
            await sql(
                `insert into public.organisations(id,name) values(${q(org)},'Fictional revoked deletion')`,
            );
            const op = await confirm(await plan("organisation", org));
            const ex = await permit(op);
            await sql(`update public.profiles set active=false where id=${q(admin)}`);
            await expectCode(worker("apply", key(op, ex)), "42501");
            await sql(
                `update public.profiles set active=true where id=${q(admin)};update private.deletion_permits set expires_at=now()-interval '1 second' where id=${q(ex.permit_id)}`,
            );
            await expectCode(worker("apply", key(op, ex)), "42501");
            const renewed = await permit(op);
            await worker("apply", key(op, renewed));
            assert.equal(
                (await worker("complete", `${key(op, renewed)},true,true`)).status,
                "completed",
            );
        },
    );
    await check(
        "Assignment purge revokes only the removed lecturer's room/files, preserves manual ownership and other accepted allocations",
        async () => {
            for (const manualOwner of [owner, admin]) {
                const job = randomUUID(),
                    claim = randomUUID(),
                    otherClaim = randomUUID(),
                    room = randomUUID(),
                    file = randomUUID();
                await sql(`insert into public.jobs(id,title,customer_name,delivery_type,status,amount,total_amount,currency,rate_unit,terms,capacity,capacity_basis) values(${q(job)},'Fictional two-position job','Fictional organisation','online','published',50,50,'EUR','fixed_total','Accepted terms',2,'per_position');
          insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,status,amount,total_amount,currency,rate_unit,terms,terms_version) values
          (${q(claim)},${q(job)},${q(owner)},${q(randomUUID())},'confirmed',50,50,'EUR','fixed_total','Accepted first snapshot',1),
          (${q(otherClaim)},${q(job)},${q(other)},${q(randomUUID())},'confirmed',50,50,'EUR','fixed_total','Accepted second snapshot',1);
          insert into public.chat_rooms(id,job_id,kind,owner_id) values(${q(room)},${q(job)},'lecturer_course',${q(manualOwner)});
          insert into public.chat_members(room_id,user_id) values(${q(room)},${q(owner)}),(${q(room)},${q(other)}),(${q(room)},${q(admin)});
          insert into public.documents(id,owner_id,uploaded_by,scope,kind,room_id,original_name,mime_type,size_bytes,status,client_id) values(${q(file)},${q(owner)},${q(owner)},'room','chat',${q(room)},'Fictional restricted room file.txt','text/plain',100,'clean',${q(randomUUID())})`);
                assert.equal(
                    await actor(
                        owner,
                        `select count(*) from public.documents where id=${q(file)}`,
                    ),
                    "1",
                );
                await sql(
                    `insert into private.teaching_preparation(claim_id,materials_ready) values(${q(claim)},true)`,
                );
                const assignmentPlan = await plan("assignment", claim);
                assert.equal(assignmentPlan.counts["private.teaching_preparation"], 1);
                const prior = await sql(
                    `select lifecycle_version from public.jobs where id=${q(job)}`,
                );
                const op = await confirm(assignmentPlan),
                    ex = await permit(op);
                await worker("apply", key(op, ex));
                await worker("complete", `${key(op, ex)},true,true`);
                assert.equal(
                    await sql(`select status from public.jobs where id=${q(job)}`),
                    "published",
                );
                assert.equal(
                    await sql(
                        `select count(*) from private.teaching_preparation where claim_id=${q(claim)}`,
                    ),
                    "0",
                );
                assert.equal(
                    await sql(
                        `select terms from public.job_claims where id=${q(otherClaim)}`,
                    ),
                    "Accepted second snapshot",
                );
                assert.equal(
                    Number(
                        await sql(
                            `select lifecycle_version from public.jobs where id=${q(job)}`,
                        ),
                    ) > Number(prior),
                    true,
                );
                assert.equal(
                    await actor(
                        owner,
                        `select count(*) from public.chat_rooms where id=${q(room)}`,
                    ),
                    "0",
                );
                assert.equal(
                    await actor(
                        owner,
                        `select count(*) from public.documents where id=${q(file)}`,
                    ),
                    "0",
                );
                assert.equal(
                    await actor(
                        other,
                        `select count(*) from public.chat_rooms where id=${q(room)}`,
                    ),
                    "1",
                );
                assert.equal(
                    await actor(
                        other,
                        `select count(*) from public.documents where id=${q(file)}`,
                    ),
                    "1",
                );
                assert.equal(
                    await sql(
                        `select owner_id from public.chat_rooms where id=${q(room)}`,
                    ),
                    manualOwner === owner ? other : admin,
                );
            }
        },
    );
    await check(
        "Concurrent exact confirmations share one operation; a different plan cannot take the fenced target",
        async () => {
            const org = randomUUID();
            await sql(
                `insert into public.organisations(id,name) values(${q(org)},'Fictional concurrent delete')`,
            );
            const p = await plan("organisation", org),
                otherPlan = await plan("organisation", org),
                request = randomUUID();
            const results = await Promise.all([
                confirm(p, admin, request),
                confirm(p, admin, request),
            ]);
            assert.equal(results[0].operation_id, results[1].operation_id);
            await expectCode(confirm(otherPlan), "40001");
            const ex = await permit(results[0]);
            await worker("apply", key(results[0], ex));
            await worker("complete", `${key(results[0], ex)},true,true`);
        },
    );
    await check(
        "An already-started incoming foreign-key writer changes the scope before the irreversible confirmation",
        async () => {
            const template = randomUUID(),
                run = randomUUID(),
                marker = `deletion_fk_${randomUUID()}`;
            await sql(
                `insert into public.course_templates(id,title) values(${q(template)},'Fictional concurrent template')`,
            );
            const p = await plan("course_template", template);
            const writer = sql(
                `set application_name=${q(marker)};begin;insert into public.course_runs(id,template_id) values(${q(run)},${q(template)});select pg_sleep(2);commit;`,
            );
            let waiting = false;
            for (let attempt = 0; attempt < 50; attempt++) {
                waiting =
                    (await sql(
                        `select exists(select 1 from pg_stat_activity where application_name=${q(marker)} and wait_event='PgSleep')`,
                    )) === "t";
                if (waiting) break;
            }
            assert.equal(
                waiting,
                true,
                "Writer must be inside the known uncommitted FK transaction",
            );
            const result = await Promise.allSettled([confirm(p), writer]);
            assert.equal(result[0].status, "rejected");
            assert.match(result[0].reason.message, /\b40001\b/);
            assert.equal(result[1].status, "fulfilled");
            assert.equal(
                await sql(
                    `select count(*) from public.course_templates where id=${q(template)}`,
                ),
                "1",
            );
            assert.equal(
                await sql(
                    `select count(*) from private.deletion_operations where target_id=${q(template)}`,
                ),
                "0",
            );
        },
    );
    await check(
        "Qualified business recovery binds a fresh executor after the initiating account is permanently deleted",
        async () => {
            const issuer = randomUUID(),
                rescuer = randomUUID(),
                org = randomUUID();
            await sql(`insert into auth.users(id,email) values(${q(issuer)},'permanent-issuer@example.invalid'),(${q(rescuer)},'permanent-rescuer@example.invalid');
      insert into public.user_roles(user_id,role) values(${q(issuer)},'admin'),(${q(rescuer)},'owner');
      insert into public.organisations(id,name) values(${q(org)},'Fictional recoverable business target')`);
            const op = await confirm(await plan("organisation", org, issuer), issuer),
                oldPermit = await permit(op, issuer);
            const accountPlan = await plan("account", issuer, rescuer);
            assert.equal(accountPlan.can_confirm, true);
            const accountOp = await confirm(accountPlan, rescuer),
                accountPermit = await permit(accountOp, rescuer);
            await worker("apply", key(accountOp, accountPermit));
            await sql(`delete from auth.users where id=${q(issuer)}`);
            await worker("complete", `${key(accountOp, accountPermit)},true,true`);
            await expectCode(worker("apply", key(op, oldPermit)), "42501");
            await expectCode(permit(op, manager), "42501");
            assert.equal(
                (await call(rescuer, "deletion_operations")).items.some(
                    (item) => item.operation_id === op.operation_id,
                ),
                true,
            );
            const recovery = await permit(op, rescuer);
            assert.equal(
                await sql(
                    `select actor_id from private.deletion_permits where id=${q(recovery.permit_id)}`,
                ),
                rescuer,
            );
            await worker("apply", key(op, recovery));
            await worker("complete", `${key(op, recovery)},true,true`);
            assert.equal(
                await sql(
                    `select actor_id from public.audit_events where action='resource.deletion.completed' and resource_id=${q(org)}`,
                ),
                rescuer,
            );
            assert.equal(
                await sql(`select count(*) from auth.users where id=${q(issuer)}`),
                "0",
            );
        },
    );
    await check(
        "Private owner operations stay private and prevent deleting their actor while unfinished",
        async () => {
            const personal = randomUUID(),
                event = randomUUID();
            await sql(`insert into auth.users(id,email) values(${q(personal)},'permanent-private-owner@example.invalid');insert into public.user_roles(user_id,role) values(${q(personal)},'lecturer');
      insert into public.personal_events(id,user_id,title,starts_at,ends_at) values(${q(event)},${q(personal)},'Private pending event',now()+interval '10 days',now()+interval '11 days')`);
            const op = await confirm(
                await plan("personal_event", event, personal),
                personal,
            );
            assert.equal(
                (await call(admin, "deletion_operations")).items.some(
                    (item) => item.operation_id === op.operation_id,
                ),
                false,
            );
            await expectCode(permit(op, admin), "42501");
            const accountPlan = await plan("account", personal);
            assert.equal(accountPlan.can_confirm, false);
            assert.equal(
                accountPlan.blockers.some(
                    (item) => item.kind === "pending_personal_deletions",
                ),
                true,
            );
            await expectCode(confirm(accountPlan), "23503");
            const ex = await permit(op, personal);
            await worker("apply", key(op, ex));
            await worker("complete", `${key(op, ex)},true,true`);
            assert.equal((await plan("account", personal)).can_confirm, true);
        },
    );
    await check(
        "Curated business deletion audit is visible without leaking private deletion activity or details",
        async () => {
            const target = randomUUID(),
                secret = "Private details are not searchable or projected";
            const business = [
                "account",
                "job",
                "assignment",
                "organisation",
                "organisation_contact",
                "course_template",
                "course_run",
                "course_session",
                "topic",
                "building_block",
                "announcement",
                "global_event",
            ];
            const privateKinds = [
                "document",
                "personal_event",
                "availability",
                "saved_job_view",
                "chat_room",
                "message",
                "contract",
                "invoice",
                "payment",
                "resource_comment",
                "wiki_page",
                "forum_thread",
                "forum_post",
                "course_review",
            ];
            const visible = [],
                hidden = [];
            for (const kind of [...business, ...privateKinds]) {
                for (const action of [
                    "resource.deletion.confirmed",
                    "resource.deletion.completed",
                ]) {
                    const id = randomUUID();
                    (business.includes(kind) ? visible : hidden).push(id);
                    await sql(
                        `insert into public.audit_events(id,actor_id,action,resource_id,details) values(${q(id)},${q(owner)},${q(action)},${q(target)},${q(JSON.stringify({kind, secret}))}::jsonb)`,
                    );
                }
            }
            const assignmentAudit = randomUUID();
            visible.push(assignmentAudit);
            await sql(
                `insert into public.audit_events(id,actor_id,action,resource_id) values(${q(assignmentAudit)},${q(admin)},'assignment.deletion.applied',${q(target)})`,
            );
            const result = await call(
                admin,
                "admin_audit_events",
                `null,null,'',${q(target)},null,null,100`,
            );
            assert.deepEqual(
                new Set(result.items.map((item) => item.id)),
                new Set(visible),
            );
            assert.equal(
                result.items.some((item) => hidden.includes(item.id)),
                false,
            );
            assert.equal(
                result.actions.includes("resource.deletion.completed"),
                true,
            );
            assert.equal(JSON.stringify(result).includes(secret), false);
            assert.equal(
                (
                    await call(
                        admin,
                        "admin_audit_events",
                        `null,null,'',${q(secret)},null,null,100`,
                    )
                ).items.length,
                0,
            );
            await expectCode(call(owner, "admin_audit_events"), "42501");
        },
    );
    await check(
        "Booked and voided payments cannot be purged or change invoice balances; audited void remains available",
        async () => {
            const invoice = randomUUID();
            const file = await call(
                owner,
                "reserve_document",
                `'Fictional payment invoice.pdf','application/pdf',100,'personal','invoice',null,null,${q(randomUUID())},null,null`,
            );
            await sql(`update public.document_versions set status='clean',sha256=repeat('b',64) where id=${q(file.version_id)};update public.documents set status='clean' where id=${q(file.document_id)};
      insert into public.invoices(id,user_id,number,issued_on,due_on,currency,total_amount,document_version_id,status,client_id) values(${q(invoice)},${q(owner)},${q("Fictional-" + invoice)},current_date,current_date+30,'EUR',100,${q(file.version_id)},'approved',${q(randomUUID())})`);
            const payment = await actor(
                admin,
                `select public.record_invoice_payment(${q(invoice)},40,now(),'Fictional partial payment',${q(randomUUID())})`,
                "aal1",
            );
            const financialState = () =>
                sql(
                    `select jsonb_build_object('paid_amount',coalesce((select sum(amount) from public.payment_records where invoice_id=i.id and voided_at is null),0),'balance',i.total_amount-coalesce((select sum(amount) from public.payment_records where invoice_id=i.id and voided_at is null),0),'status',i.status,'payments',(select jsonb_agg(to_jsonb(p) order by p.id) from public.payment_records p where p.invoice_id=i.id)) from public.invoices i where i.id=${q(invoice)}`,
                ).then(JSON.parse);
            const before = await financialState();
            assert.equal(Number(before.paid_amount), 40);
            assert.equal(Number(before.balance), 60);
            const p = await plan("payment", payment);
            assert.equal(p.can_confirm, false);
            assert.equal(
                p.blockers.some((item) => item.kind === "protected_payment_history"),
                true,
            );
            await expectCode(confirm(p), "23503");
            assert.deepEqual(await financialState(), before);
            await actor(
                admin,
                `select public.void_invoice_payment(${q(payment)},'Fictional corrected tracking entry')`,
                "aal1",
            );
            const after = await financialState();
            assert.equal(Number(after.paid_amount), 0);
            assert.equal(Number(after.balance), 100);
            assert.equal(after.payments.length, 1);
            assert.notEqual(after.payments[0].voided_at, null);
            const voided = await plan("payment", payment);
            assert.equal(voided.can_confirm, false);
            await expectCode(confirm(voided), "23503");
            assert.deepEqual(await financialState(), after);
        },
    );
    await check(
        "Accepted profile housekeeping and own notebooks purge without touching another user or shared file",
        async () => {
            const subject = randomUUID(),
                template = randomUUID(),
                run = randomUUID(),
                org = randomUUID(),
                job = randomUUID(),
                notification = randomUUID(),
                otherNotification = randomUUID(),
                subscription = randomUUID(),
                email = randomUUID(),
                push = randomUUID(),
                resource = randomUUID();
            await sql(`insert into auth.users(id,email) values(${q(subject)},'permanent-housekeeping@example.invalid');insert into public.user_roles(user_id,role) values(${q(subject)},'lecturer');
      insert into public.organisations(id,name) values(${q(org)},'Fictional housekeeping organisation');
      insert into public.course_templates(id,title) values(${q(template)},'Fictional housekeeping course');
      insert into public.course_runs(id,template_id,organisation_id) values(${q(run)},${q(template)},${q(org)});
      insert into public.jobs(id,title,customer_name,delivery_type,status,amount,total_amount,currency,rate_unit,terms) values(${q(job)},'Fictional unrelated interest','Fictional organisation','online','draft',10,10,'EUR','fixed_total','Fictional terms');
      insert into private.job_waitlist(job_id,user_id) values(${q(job)},${q(subject)}),(${q(job)},${q(other)});
      insert into private.dashboard_preferences(user_id) values(${q(subject)});
      insert into private.staff_contact_visibility(user_id) values(${q(subject)});
      insert into private.personal_favourites(user_id,kind,resource_id) values(${q(subject)},'organisation',${q(org)});
      insert into private.calendar_subscriptions(user_id,label,token_hash,client_id) values(${q(subject)},'Fictional private subscription',md5(${q(randomUUID())})||md5(${q(randomUUID())}),${q(randomUUID())});
      insert into private.course_notebooks(run_id,user_id,body) values(${q(run)},${q(subject)},'Target private notebook'),(${q(run)},${q(other)},'Other private notebook must remain');
      insert into public.notifications(id,user_id,kind,resource_id) values(${q(notification)},${q(subject)},'claim_confirmed',${q(randomUUID())}),(${q(otherNotification)},${q(other)},'claim_confirmed',${q(randomUUID())});
      insert into private.push_subscriptions(id,user_id,endpoint,p256dh,auth_secret,device_token,label) values(${q(subscription)},${q(subject)},${q("https://push.example.invalid/" + subscription)},'fictional-public-key','fictional-private-secret',${q(randomUUID())},'Fictional device');
      insert into private.notification_email_outbox(id,notification_id,occurrence_at) values(${q(email)},${q(notification)},now());
      insert into private.notification_push_outbox(id,notification_id,subscription_id,occurrence_at) values(${q(push)},${q(otherNotification)},${q(subscription)},now())`);
            const shared = await reserve(admin);
            await sql(`update public.document_versions set status='clean',sha256=repeat('c',64) where id=${q(shared.version_id)};update public.documents set status='clean' where id=${q(shared.document_id)};
      insert into private.course_resources(id,run_id,version_id,audience,category,created_by) values(${q(resource)},${q(run)},${q(shared.version_id)},'all','material',${q(admin)});
      insert into private.course_resource_acknowledgements(resource_id,user_id) values(${q(resource)},${q(subject)}),(${q(resource)},${q(other)})`);
            assert.equal(
                await sql(
                    `select count(*) from private.delivery_preferences where user_id=${q(subject)}`,
                ),
                "1",
                "Accepted initializer creates preferences for every new profile",
            );
            const p = await plan("account", subject);
            assert.equal(p.can_confirm, true);
            for (const table of [
                "delivery_preferences",
                "dashboard_preferences",
                "staff_contact_visibility",
                "calendar_subscriptions",
                "push_subscriptions",
                "personal_favourites",
                "job_waitlist",
                "course_notebooks",
                "course_resource_acknowledgements",
                "notification_email_outbox",
                "notification_push_outbox",
            ])
                assert.equal(p.counts["private." + table], 1, table);
            assert.equal(
                JSON.stringify(p).includes("Target private notebook"),
                false,
            );
            assert.equal(
                JSON.stringify(p).includes("fictional-private-secret"),
                false,
            );
            const op = await confirm(p),
                ex = await permit(op);
            await worker("apply", key(op, ex));
            await sql(`delete from auth.users where id=${q(subject)}`);
            await worker("complete", `${key(op, ex)},true,true`);
            for (const table of [
                "delivery_preferences",
                "dashboard_preferences",
                "staff_contact_visibility",
                "calendar_subscriptions",
                "push_subscriptions",
                "personal_favourites",
                "job_waitlist",
                "course_notebooks",
                "course_resource_acknowledgements",
            ])
                assert.equal(
                    await sql(
                        `select count(*) from private.${table} where user_id=${q(subject)}`,
                    ),
                    "0",
                    table,
                );
            assert.equal(
                await sql(
                    `select count(*) from private.notification_email_outbox where id=${q(email)}`,
                ),
                "0",
            );
            assert.equal(
                await sql(
                    `select count(*) from private.notification_push_outbox where id=${q(push)}`,
                ),
                "0",
            );
            assert.equal(
                await sql(
                    `select body from private.course_notebooks where run_id=${q(run)} and user_id=${q(other)}`,
                ),
                "Other private notebook must remain",
            );
            assert.equal(
                await sql(
                    `select count(*) from private.course_resource_acknowledgements where resource_id=${q(resource)} and user_id=${q(other)}`,
                ),
                "1",
            );
            assert.equal(
                await sql(
                    `select count(*) from public.notifications where id=${q(otherNotification)}`,
                ),
                "1",
            );
            const sharedPlan = await plan("document", shared.document_id);
            assert.equal(sharedPlan.can_confirm, false);
            assert.equal(
                sharedPlan.blockers.some(
                    (item) => item.kind === "private.course_resources",
                ),
                true,
            );
            await expectCode(confirm(sharedPlan), "23503");
        },
    );
    await check(
        "Leased, sending and uncertain external deliveries block account purge even after lease expiry",
        async () => {
            const subject = randomUUID(),
                notification = randomUUID(),
                subscription = randomUUID(),
                email = randomUUID(),
                push = randomUUID();
            await sql(`insert into auth.users(id,email) values(${q(subject)},'permanent-delivery-barrier@example.invalid');insert into public.user_roles(user_id,role) values(${q(subject)},'lecturer');
      insert into public.notifications(id,user_id,kind,resource_id) values(${q(notification)},${q(subject)},'claim_confirmed',${q(randomUUID())});
      insert into private.push_subscriptions(id,user_id,endpoint,p256dh,auth_secret,device_token,label) values(${q(subscription)},${q(subject)},${q("https://push.example.invalid/" + subscription)},'fictional-public-key','fictional-private-secret',${q(randomUUID())},'Fictional device');
      insert into private.notification_email_outbox(id,notification_id,occurrence_at) values(${q(email)},${q(notification)},now());
      insert into private.notification_push_outbox(id,notification_id,subscription_id,occurrence_at) values(${q(push)},${q(notification)},${q(subscription)},now())`);
            for (const state of ["leased", "sending", "uncertain"]) {
                await sql(`update private.notification_email_outbox set state=${q(state)},lease_until=now()-interval '1 day',lease_token=${q(randomUUID())} where id=${q(email)};
        update private.notification_push_outbox set state=${q(state)},lease_until=now()-interval '1 day',lease_token=${q(randomUUID())} where id=${q(push)}`);
                const p = await plan("account", subject);
                assert.equal(p.can_confirm, false);
                assert.equal(
                    p.blockers.find((item) => item.kind === "pending_external_deliveries")
                        ?.count,
                    2,
                );
                await expectCode(confirm(p), "23503");
                assert.equal(
                    await sql(
                        `select active from public.profiles where id=${q(subject)}`,
                    ),
                    "t",
                );
            }
            await sql(
                `update private.notification_email_outbox set state='accepted',lease_until=null where id=${q(email)};update private.notification_push_outbox set state='pending',lease_until=null where id=${q(push)}`,
            );
            const op = await confirm(await plan("account", subject)),
                ex = await permit(op);
            await expectCode(
                sql(
                    `update private.notification_push_outbox set state='leased' where id=${q(push)}`,
                ),
                "55000",
            );
            await worker("apply", key(op, ex));
            await sql(`delete from auth.users where id=${q(subject)}`);
            await worker("complete", `${key(op, ex)},true,true`);
            assert.equal(
                await sql(
                    `select count(*) from private.notification_push_outbox where id=${q(push)}`,
                ),
                "0",
            );
        },
    );
    await check(
        "Unaccepted jobs own waitlists, client brief history and exact inbox deliveries; active job delivery blocks confirmation",
        async () => {
            const job = randomUUID(),
                org = randomUUID(),
                request = randomUUID(),
                notification = randomUUID(),
                email = randomUUID();
            await sql(`insert into public.organisations(id,name) values(${q(org)},'Fictional request deletion organisation');
      insert into public.jobs(id,title,customer_name,delivery_type,status,amount,total_amount,currency,rate_unit,terms) values(${q(job)},'Fictional unaccepted job','Fictional organisation','online','draft',10,10,'EUR','fixed_total','Fictional terms');
      insert into private.job_waitlist(job_id,user_id) values(${q(job)},${q(owner)}),(${q(job)},${q(other)});
      insert into private.client_course_requests(id,organisation_id,requested_by,client_id,payload,job_id,status) values(${q(request)},${q(org)},${q(owner)},${q(randomUUID())},'{}',${q(job)},'published');
      insert into private.client_request_briefs(request_id,content) values(${q(request)},'{"description":"Fictional authored brief"}');
      insert into public.notifications(id,user_id,kind,resource_id) values(${q(notification)},${q(other)},'job_waitlist_available',${q(job)});
      insert into private.notification_email_outbox(id,notification_id,occurrence_at,state,lease_until) values(${q(email)},${q(notification)},now(),'sending',now()-interval '1 day')`);
            const blocked = await plan("job", job);
            assert.equal(blocked.can_confirm, false);
            assert.equal(
                blocked.blockers.some(
                    (item) => item.kind === "pending_external_deliveries",
                ),
                true,
            );
            await expectCode(confirm(blocked), "23503");
            await sql(
                `update private.notification_email_outbox set state='accepted',lease_until=null where id=${q(email)}`,
            );
            const p = await plan("job", job);
            assert.equal(p.can_confirm, true);
            assert.equal(p.counts["private.job_waitlist"], 2);
            assert.equal(p.counts["private.client_request_briefs"], 1);
            assert.equal(p.counts["private.client_request_revisions"] >= 2, true);
            assert.equal(p.counts["private.notification_email_outbox"], 1);
            const op = await confirm(p),
                ex = await permit(op);
            await worker("apply", key(op, ex));
            await worker("complete", `${key(op, ex)},true,true`);
            assert.equal(
                await sql(
                    `select count(*) from private.job_waitlist where job_id=${q(job)}`,
                ),
                "0",
            );
            assert.equal(
                await sql(
                    `select count(*) from private.client_request_briefs where request_id=${q(request)}`,
                ),
                "0",
            );
            assert.equal(
                await sql(
                    `select count(*) from private.client_request_revisions where request_id=${q(request)}`,
                ),
                "0",
            );
            assert.equal(
                await sql(
                    `select count(*) from private.notification_email_outbox where id=${q(email)}`,
                ),
                "0",
            );
        },
    );
    await check(
        "Timesheet evidence and shared operations tasks remain explicit blockers rather than cascading through claims or accounts",
        async () => {
            const job = randomUUID(),
                claim = randomUUID(),
                session = randomUUID(),
                timesheet = randomUUID(),
                creator = randomUUID(),
                task = randomUUID();
            await sql(`insert into public.jobs(id,title,customer_name,delivery_type,status,amount,total_amount,currency,rate_unit,terms) values(${q(job)},'Fictional evidenced job','Fictional organisation','online','filled',10,10,'EUR','fixed_total','Fictional terms');
      insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,status,amount,total_amount,currency,rate_unit,terms,terms_version) values(${q(claim)},${q(job)},${q(owner)},${q(randomUUID())},'confirmed',10,10,'EUR','fixed_total','Accepted evidenced work',1);
      insert into public.assignment_sessions(id,claim_id,lecturer_id,starts_at,ends_at) values(${q(session)},${q(claim)},${q(owner)},'2020-01-01T10:00:00Z','2020-01-01T11:00:00Z');
      insert into private.teaching_preparation(claim_id) values(${q(claim)});
      insert into private.teaching_timesheets(id,session_id,lecturer_id,starts_at,ends_at,state,note) values(${q(timesheet)},${q(session)},${q(owner)},'2020-01-01T10:00:00Z','2020-01-01T11:00:00Z','submitted','Fictional retained teaching evidence');
      insert into auth.users(id,email) values(${q(creator)},'permanent-shared-task-creator@example.invalid');insert into public.user_roles(user_id,role) values(${q(creator)},'management');
      insert into private.work_tasks(id,creator_id,assignee_id,scope,title,client_id,request_payload) values(${q(task)},${q(creator)},${q(other)},'operations','Fictional shared task',${q(randomUUID())},'{}')`);
            const before = await sql(
                `select to_jsonb(t) from private.teaching_timesheets t where id=${q(timesheet)}`,
            );
            const p = await plan("assignment", claim);
            assert.equal(p.can_confirm, false);
            assert.equal(
                p.blockers.some((item) => item.kind === "private.teaching_timesheets"),
                true,
            );
            await expectCode(confirm(p), "23503");
            assert.equal(
                await sql(
                    `select to_jsonb(t) from private.teaching_timesheets t where id=${q(timesheet)}`,
                ),
                before,
            );
            assert.equal(
                await sql(
                    `select count(*) from private.teaching_preparation where claim_id=${q(claim)}`,
                ),
                "1",
            );
            const account = await plan("account", creator);
            assert.equal(account.can_confirm, false);
            assert.equal(
                account.blockers.some((item) => item.kind === "private.work_tasks"),
                true,
            );
            await expectCode(confirm(account), "23503");
            assert.equal(
                await sql(`select title from private.work_tasks where id=${q(task)}`),
                "Fictional shared task",
            );
        },
    );
});
console.log(`PASS all ${checks} permanent-deletion database groups`);
