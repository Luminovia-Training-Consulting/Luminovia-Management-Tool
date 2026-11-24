/** Current company ownership and deletion-only projections on a disposable PostgreSQL
 * database. Auth claims are emulated here; native Auth/Edge/Storage acceptance is separate. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {quoteSql as q, withTestDatabase} from "./testing/database.mjs";

let checks = 0;
await withTestDatabase("company_job_deletion", async ({sql, actor}) => {
    const company = randomUUID(),
        otherCompany = randomUUID(),
        teacher = randomUUID(),
        outsider = randomUUID();
    const org = randomUUID(),
        otherOrg = randomUUID(),
        template = randomUUID();
    await sql(`insert into auth.users(id, email)
               values
    (${q(company)},'company-deletion-a@example.invalid'),
    (${q(otherCompany)},'company-deletion-b@example.invalid'),
    (${q(teacher)},'company-deletion-teacher@example.invalid'),
    (${q(outsider)},'company-deletion-outsider@example.invalid');
    insert into public.user_roles(user_id,role) values
    (${q(company)},'client'),(${q(otherCompany)},'client'),(${q(teacher)},'lecturer'),(${q(outsider)},'lecturer');
    insert into public.organisations(id,name) values (${q(org)},'Fictional company A'),(${q(otherOrg)},'Fictional company B');
    insert into public.client_organisation_memberships(user_id,organisation_id) values (${q(company)},${q(org)}),(${q(otherCompany)},${q(otherOrg)});
    insert into public.course_templates(id,title) values (${q(template)},'Fictional company deletion curriculum');`);

    /** Keep fixture variants explicit: each ownership source is independently optional. */
    const job = async ({
                           runOrg,
                           requestOrg,
                           commissionOrg,
                           historical = false,
                       } = {}) => {
        const id = randomUUID(),
            run = runOrg ? randomUUID() : null;
        if (run)
            await sql(
                `insert into public.course_runs(id,template_id,organisation_id) values(${q(run)},${q(template)},${q(runOrg)});`,
            );
        await sql(`insert into public.jobs(id,course_run_id,title,customer_name,created_by,delivery_type,status,amount,total_amount,currency,rate_unit,terms)
      values(${q(id)},${run ? q(run) : "null"},'Fictional deletion target','Fictional company A',${q(company)},'online',${q(historical ? "archived" : "draft")},50,50,'EUR','fixed_total','Private lecturer terms must not leave selector');`);
        if (requestOrg)
            await sql(`insert into private.client_course_requests(organisation_id,requested_by,client_id,payload,job_id,status)
      values(${q(requestOrg)},${q(otherCompany)},${q(randomUUID())},'{}',${q(id)},'published');`);
        if (commissionOrg)
            await sql(`insert into private.job_commission_offers(job_id,organisation_id,gross_amount,gross_total_amount,platform_percent,platform_total_amount,lecturer_net_amount,lecturer_net_total_amount,currency,pricing_mode)
      values(${q(id)},${q(commissionOrg)},100,100,50,50,50,50,'EUR','legacy');`);
        if (historical)
            await sql(`insert into public.job_claims(job_id,lecturer_id,idempotency_key,status,amount,total_amount,currency,rate_unit,terms,terms_version)
      values(${q(id)},${q(teacher)},${q(randomUUID())},'confirmed',50,50,'EUR','fixed_total','Private accepted lecturer terms',1);`);
        return id;
    };
    /** Reads the real public invoker wrapper as the chosen identity and assurance. */
    const list = (who = company, aal = "aal1") =>
        actor(
            who,
            "select coalesce(jsonb_agg(row),'[]') from public.company_jobs_for_deletion() row",
            aal,
        ).then(JSON.parse);
    /** Every successful group is reported only after all its assertions complete. */
    const check = async (name, run) => {
        await run();
        checks++;
        console.log(`PASS ${name}`);
    };

    const runOnly = await job({runOrg: org});
    const requestOnly = await job({requestOrg: org});
    const commissionOnly = await job({commissionOrg: org});
    const consistent = await job({
        runOrg: org,
        requestOrg: org,
        commissionOrg: org,
    });
    const foreign = await job({runOrg: otherOrg});
    const unowned = await job();
    const conflict = await job({
        runOrg: org,
        requestOrg: otherOrg,
        commissionOrg: org,
    });
    const accepted = await job({runOrg: otherOrg, historical: true});
    const ownAccepted = await job({runOrg: org, historical: true});
    const attachment = randomUUID();
    await sql(`insert into public.documents(id,owner_id,uploaded_by,scope,kind,job_id,original_name,mime_type,size_bytes,status,client_id)
    values(${q(attachment)},${q(otherCompany)},${q(otherCompany)},'job_after','material',${q(accepted)},'Fictional restricted teaching notes.pdf','application/pdf',100,'clean',${q(randomUUID())});
    insert into public.chat_rooms(job_id,kind,title) values(${q(accepted)},'lecturer_course','Fictional private lecturer room') on conflict(job_id) do nothing;
    insert into public.chat_members(room_id,user_id) select id,${q(teacher)} from public.chat_rooms where job_id=${q(accepted)} on conflict do nothing;`);

    const acceptedClaim = await sql(
        `select id from public.job_claims where job_id=${q(accepted)}`,
    );
    const acceptedRun = await sql(
        `select course_run_id from public.jobs where id=${q(accepted)}`,
    );
    const foreignRun = await sql(
        `select course_run_id from public.jobs where id=${q(foreign)}`,
    );
    const courseSession = randomUUID();
    await sql(`update public.course_runs set published=true where id=${q(acceptedRun)};
    insert into public.course_sessions(id,course_run_id,starts_at,ends_at) values(${q(courseSession)},${q(acceptedRun)},now()+interval '60 days',now()+interval '60 days 1 hour');`);
    const allocation = randomUUID(),
        foreignClaim = randomUUID(),
        foreignAllocation = randomUUID();
    const claimEvent = randomUUID(),
        foreignClaimEvent = randomUUID(),
        privateEvent = randomUUID();
    await sql(`insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,status,amount,total_amount,currency,rate_unit,terms,terms_version)
    values(${q(foreignClaim)},${q(foreign)},${q(outsider)},${q(randomUUID())},'confirmed',50,50,'EUR','fixed_total','Unrelated lecturer accepted snapshot',1);
    insert into public.assignment_sessions(id,claim_id,lecturer_id,starts_at,ends_at) values
    (${q(allocation)},${q(acceptedClaim)},${q(teacher)},now()+interval '60 days',now()+interval '60 days 1 hour'),
    (${q(foreignAllocation)},${q(foreignClaim)},${q(outsider)},now()+interval '60 days',now()+interval '60 days 1 hour');
    insert into public.claim_events(id,claim_id,actor_id,event_type) values(${q(claimEvent)},${q(acceptedClaim)},${q(teacher)},'confirmed'),(${q(foreignClaimEvent)},${q(foreignClaim)},${q(outsider)},'confirmed');
    insert into public.personal_events(id,user_id,title,starts_at,ends_at) values(${q(privateEvent)},${q(teacher)},'Fictional personal appointment remains private',now()+interval '70 days',now()+interval '70 days 1 hour');`);
    /** Real REST-facing RLS paths are exercised as the current role, including
     * nested claim-event policies and forged known identifiers from another actor. */
    const history = (who) =>
        actor(
            who,
            `select jsonb_build_object(
    'claims',(select count(*) from public.job_claims where id=${q(acceptedClaim)}),
    'sessions',(select count(*) from public.assignment_sessions where id=${q(allocation)}),
    'events',(select count(*) from public.claim_events where id=${q(claimEvent)}),
    'courses',(select count(*) from public.course_runs where id=${q(acceptedRun)}),
    'course_sessions',(select count(*) from public.course_sessions where id=${q(courseSession)}),
    'templates',(select count(*) from public.course_templates where id=${q(template)}),
    'foreign_courses',(select count(*) from public.course_runs where id=${q(foreignRun)}),
    'foreign_claims',(select count(*) from public.job_claims where id=${q(foreignClaim)}),
    'foreign_sessions',(select count(*) from public.assignment_sessions where id=${q(foreignAllocation)}),
    'foreign_events',(select count(*) from public.claim_events where id=${q(foreignClaimEvent)}),
    'private_events',(select count(*) from public.personal_events where id=${q(privateEvent)}))`,
        ).then(JSON.parse);
    const readableHistory = {
        claims: 1,
        sessions: 1,
        events: 1,
        courses: 1,
        course_sessions: 1,
        templates: 1,
        foreign_courses: 0,
        foreign_claims: 0,
        foreign_sessions: 0,
        foreign_events: 0,
        private_events: 1,
    };
    const titles = (who) =>
        actor(
            who,
            `select public.assignment_job_titles(array[${q(accepted)},${q(foreign)},${q(randomUUID())}]::uuid[])`,
        ).then(JSON.parse);
    const earnings = (who, all = "false", aal = "aal1") =>
        actor(
            who,
            `select coalesce(jsonb_agg(row),'[]') from public.finance_earnings(${all}) row`,
            aal,
        ).then(JSON.parse);

    await check(
        "Only consistent current company ownership appears; creator and display names grant no rights",
        async () => {
            const rows = await list();
            assert.deepEqual(
                rows.map((x) => x.id).sort(),
                [runOnly, requestOnly, commissionOnly, consistent, ownAccepted].sort(),
            );
            for (const row of rows) {
                assert.deepEqual(
                    Object.keys(row).sort(),
                    [
                        "id",
                        "title",
                        "organisation_id",
                        "organisation_name",
                        "can_delete",
                    ].sort(),
                );
                assert.equal(row.organisation_id, org);
                assert.equal(row.can_delete, true);
            }
            const other = await list(otherCompany);
            assert.deepEqual(
                other.map((x) => x.id).sort(),
                [foreign, accepted].sort(),
            );
            assert(!JSON.stringify(rows).includes("Private"));
            assert(
                !(
                    await actor(company, "select public.get_my_permissions()", "aal1")
                ).includes("jobs.manage"),
            );
        },
    );

    await check(
        "Forged, missing and conflicting job IDs cannot obtain company deletion previews",
        async () => {
            for (const id of [foreign, accepted, unowned, conflict, randomUUID()])
                await assert.rejects(
                    actor(
                        company,
                        `select public.deletion_preview('job',${q(id)})`,
                        "aal1",
                    ),
                    /42501|denied|authori[sz]|unavailable/i,
                );
            const rows = await list(company, "aal1");
            assert.equal(rows.length, 5);
            assert(rows.every((row) => row.can_delete === true));
            const runOnlyPreview = JSON.parse(
                await actor(
                    company,
                    `select public.deletion_preview('job',${q(runOnly)})`,
                    "aal1",
                ),
            );
            assert.equal(runOnlyPreview.can_confirm, true);
        },
    );

    await check(
        "Own unclaimed request/commission job can be previewed; accepted history remains protected",
        async () => {
            const allowed = JSON.parse(
                await actor(
                    company,
                    `select public.deletion_preview('job',${q(consistent)})`,
                    "aal1",
                ),
            );
            assert.equal(allowed.can_confirm, true);
            assert.deepEqual(allowed.blockers, []);
            // Accepted request triggers create revision rows. They belong to this
            // reviewed request, while accepted teaching history stays protected below.
            assert(allowed.counts["private.client_request_revisions"] > 0);
            const blocked = JSON.parse(
                await actor(
                    company,
                    `select public.deletion_preview('job',${q(ownAccepted)})`,
                    "aal1",
                ),
            );
            assert.equal(blocked.can_confirm, false);
            assert(blocked.blockers.length > 0);
            await assert.rejects(
                actor(
                    company,
                    `select public.deletion_confirm(${q(blocked.plan_id)},${q(randomUUID())},'DELETE')`,
                    "aal1",
                ),
                /23503|protected dependencies/i,
            );
            assert.equal(
                await sql(
                    `select count(*) from public.jobs where id=${q(ownAccepted)}`,
                ),
                "1",
            );
            assert.equal(
                await sql(
                    `select count(*) from public.job_claims where job_id=${q(ownAccepted)}`,
                ),
                "1",
            );
        },
    );

    await check(
        "Existing tokens lose deletion targets after membership, role, activation or organisation revocation",
        async () => {
            await sql(
                `update public.client_organisation_memberships set removed_at=now() where user_id=${q(company)};`,
            );
            assert.deepEqual(await list(), []);
            await assert.rejects(
                actor(
                    company,
                    `select public.deletion_preview('job',${q(runOnly)})`,
                    "aal1",
                ),
                /42501|denied|authori[sz]|unavailable/i,
            );
            await sql(
                `update public.client_organisation_memberships set removed_at=null where user_id=${q(company)};update public.profiles set active=false where id=${q(company)};`,
            );
            assert.deepEqual(await list(), []);
            await sql(
                `update public.profiles set active=true where id=${q(company)};update public.organisations set archived_at=now() where id=${q(org)};`,
            );
            assert.deepEqual(await list(), []);
            await sql(
                `update public.organisations set archived_at=null where id=${q(org)};delete from public.user_roles where user_id=${q(company)};insert into public.user_roles(user_id,role) values(${q(company)},'guest');`,
            );
            assert.deepEqual(await list(), []);
            await sql(
                `delete from public.user_roles where user_id=${q(company)};insert into public.user_roles(user_id,role) values(${q(company)},'client');update public.client_organisation_memberships set removed_at=null where user_id=${q(company)};`,
            );
            assert.equal((await list()).length, 5);
        },
    );

    await check(
        "Current lecturers retain accepted history; switching to company removes historical staff/net read routes",
        async () => {
            assert.deepEqual(await history(teacher), readableHistory);
            assert.deepEqual(
                (await titles(teacher)).map((row) => row.id),
                [accepted],
            );
            const priorEarnings = (await earnings(teacher)).find(
                (row) => row.claim_id === acceptedClaim,
            );
            assert.equal(priorEarnings.amount, 50);
            assert.equal(priorEarnings.total_amount, 50);
            const dashboardBefore = JSON.parse(
                await actor(teacher, "select public.job_dashboard()"),
            );
            assert.equal(dashboardBefore.next_assignments.length, 1);
            assert.equal(dashboardBefore.next_assignments[0].job.id, accepted);

            assert.equal(
                await actor(
                    teacher,
                    `select count(*) from public.jobs where id=${q(accepted)}`,
                ),
                "1",
            );
            assert.equal(
                await actor(
                    teacher,
                    `select count(*) from public.documents where id=${q(attachment)}`,
                ),
                "1",
            );
            assert.equal(
                await actor(
                    teacher,
                    `select count(*) from public.chat_rooms where job_id=${q(accepted)}`,
                ),
                "1",
            );
            assert(
                JSON.parse(await actor(teacher, "select public.job_offers()")).some(
                    (x) => x.id === accepted,
                ),
            );
            assert.equal(
                JSON.parse(
                    await actor(teacher, `select public.job_lifecycle(${q(accepted)})`),
                ).can_manage,
                false,
            );
            await sql(
                `delete from public.user_roles where user_id=${q(teacher)};insert into public.user_roles(user_id,role) values(${q(teacher)},'client');insert into public.client_organisation_memberships(user_id,organisation_id) values(${q(teacher)},${q(org)});`,
            );
            assert.equal(
                await actor(
                    teacher,
                    `select count(*) from public.jobs where id=${q(accepted)}`,
                ),
                "0",
            );
            assert.equal(
                await actor(
                    teacher,
                    `select count(*) from public.documents where id=${q(attachment)}`,
                ),
                "0",
            );
            // The existing staff-room ACL already requires a current staff role even
            // with retained explicit membership; no broader chat policy change is needed.
            assert.equal(
                await actor(
                    teacher,
                    `select count(*) from public.chat_rooms where job_id=${q(accepted)}`,
                ),
                "0",
            );
            assert(
                !JSON.parse(await actor(teacher, "select public.job_offers()")).some(
                    (x) => x.id === accepted,
                ),
            );
            await assert.rejects(
                actor(teacher, `select public.job_lifecycle(${q(accepted)})`),
                /42501|denied/i,
            );
            assert(!JSON.stringify(await list(teacher)).includes(accepted));
            assert.deepEqual(await history(teacher), {
                ...readableHistory,
                claims: 0,
                sessions: 0,
                events: 0,
                courses: 0,
                course_sessions: 0,
                templates: 0,
            });
            assert.deepEqual(await titles(teacher), []);
            assert.equal(
                await actor(
                    teacher,
                    `select count(*) from public.job_claims where job_id=${q(ownAccepted)}`,
                ),
                "0",
            );
            await assert.rejects(
                actor(teacher, "select public.job_dashboard()"),
                /42501|denied/i,
            );
            for (const all of ["false", "true", "null"])
                await assert.rejects(earnings(teacher, all), /42501/);
            assert.equal(
                await actor(
                    teacher,
                    `select count(*) from public.job_claims where id=${q(randomUUID())}`,
                ),
                "0",
            );
            // Revocation is projection-only: the accepted business record and personal
            // appointment remain stored; no historical values or event ownership change.
            assert.equal(
                await sql(
                    `select count(*) from public.job_claims where id=${q(acceptedClaim)} and amount=50 and total_amount=50`,
                ),
                "1",
            );

            await assert.rejects(
                actor(teacher, `select public.job_detail(${q(accepted)})`),
                /42501|denied/i,
            );
            // These remain company-only deletion metadata, not an alternate staff job view.
            assert.equal(
                await actor(
                    company,
                    `select count(*) from public.jobs where id=${q(runOnly)}`,
                ),
                "0",
            );
            await sql(
                `delete from public.user_roles where user_id=${q(teacher)};insert into public.user_roles(user_id,role) values(${q(teacher)},'lecturer');`,
            );
            assert.equal(
                await actor(
                    teacher,
                    `select count(*) from public.jobs where id=${q(accepted)}`,
                ),
                "1",
            );
            assert.deepEqual(await history(teacher), readableHistory);
            assert.deepEqual(
                (await titles(teacher)).map((row) => row.id),
                [accepted],
            );
            assert.deepEqual(
                (await earnings(teacher)).find((row) => row.claim_id === acceptedClaim),
                priorEarnings,
            );
        },
    );

    await check(
        "Projection uses invoker wrappers and never grants direct job mutations or helper execution",
        async () => {
            const flags = JSON.parse(
                await sql(`select jsonb_build_object(
      'wrapper_definer',(select prosecdef from pg_proc where oid='public.company_jobs_for_deletion()'::regprocedure),
      'anon_execute',has_function_privilege('anon','public.company_jobs_for_deletion()','EXECUTE'),
      'helper_execute',has_function_privilege('authenticated','private.deletion_can_manage_job(uuid)','EXECUTE'),
      'insert',has_table_privilege('authenticated','public.jobs','INSERT'),
      'update',has_table_privilege('authenticated','public.jobs','UPDATE'),
      'delete',has_table_privilege('authenticated','public.jobs','DELETE'));`),
            );
            assert(Object.values(flags).every((value) => value === false));
            await assert.rejects(
                actor(company, `delete from public.jobs where id=${q(runOnly)}`),
                /42501|permission denied/i,
            );
            assert.equal(
                await sql(`select count(*) from public.jobs where id=${q(runOnly)}`),
                "1",
            );
        },
    );

    await check(
        "Confirmed company deletion physically removes only its own unclaimed job and operational links",
        async () => {
            const preview = JSON.parse(
                await actor(
                    company,
                    `select public.deletion_preview('job',${q(consistent)})`,
                    "aal1",
                ),
            );
            assert.equal(preview.can_confirm, true);
            const operation = JSON.parse(
                await actor(
                    company,
                    `select public.deletion_confirm(${q(preview.plan_id)},${q(randomUUID())},'DELETE')`,
                    "aal1",
                ),
            );
            const permit = JSON.parse(
                await actor(
                    company,
                    `select public.deletion_execution(${q(operation.operation_id)})`,
                    "aal1",
                ),
            );
            // Only the service-granted worker can perform the already caller-authorized
            // operation. This SQL proof has no Storage bytes and does not claim native Auth.
            const worker = (statement) =>
                sql(
                    `begin;set local role service_role;set local request.jwt.claims='{"role":"service_role"}';${statement};commit;`,
                );
            const work = JSON.parse(
                await worker(
                    `select public._deletion_work(${q(operation.operation_id)},${q(permit.permit_id)})`,
                ),
            );
            assert.deepEqual(work.objects, []);
            assert.equal(work.pending_uploads, 0);
            await worker(
                `select public._deletion_apply(${q(operation.operation_id)},${q(permit.permit_id)})`,
            );
            const done = JSON.parse(
                await worker(
                    `select public._deletion_complete(${q(operation.operation_id)},${q(permit.permit_id)},true,true)`,
                ),
            );
            assert.equal(done.status, "completed");
            assert.equal(
                await sql(`select count(*) from public.jobs where id=${q(consistent)}`),
                "0",
            );
            assert.equal(
                await sql(
                    `select count(*) from private.client_course_requests where job_id=${q(consistent)}`,
                ),
                "0",
            );
            assert.equal(
                await sql(
                    `select count(*) from private.job_commission_offers where job_id=${q(consistent)}`,
                ),
                "0",
            );
            assert.equal(
                await sql(
                    `select count(*) from public.jobs where id in(${q(foreign)},${q(accepted)},${q(ownAccepted)})`,
                ),
                "3",
            );
        },
    );

    await check(
        "Current lifecycle retains captured maximum-net budgets and exact role redaction",
        async () => {
            const admin = randomUUID(),
                owner = randomUUID(),
                manager = randomUUID(),
                senior = randomUUID();
            await sql(`insert into auth.users(id,email) values
      (${q(admin)},'company-budget-admin@example.invalid'),(${q(owner)},'company-budget-owner@example.invalid'),
      (${q(manager)},'company-budget-management@example.invalid'),(${q(senior)},'company-budget-senior@example.invalid');
      insert into public.user_roles(user_id,role) values(${q(admin)},'admin'),(${q(owner)},'owner'),(${q(manager)},'management'),(${q(senior)},'senior_lecturer');`);
            const rolePriced = await job({runOrg: org, commissionOrg: org}),
                legacy = await job();
            // These deliberately fictional captured tiers differ from every global or
            // requesting user's quote. Personal compensation can reach the full gross
            // amount, so that is the current per-position maximum-net ceiling.
            await sql(`update public.jobs set status='published',capacity=3,capacity_basis='per_position' where id in(${q(rolePriced)},${q(legacy)});
      update public.jobs set amount=91.37,total_amount=91.37 where id=${q(legacy)};
      update private.job_commission_offers set pricing_mode='role_split',gross_amount=100.01,gross_total_amount=100.01,
      regular_percent=37,senior_percent=73,policy_version=1 where job_id=${q(rolePriced)};`);
            const read = (who, id, aal) =>
                actor(who, `select public.job_lifecycle(${q(id)})`, aal).then(
                    JSON.parse,
                );
            const fields = [
                "version",
                "capacity",
                "capacity_basis",
                "confirmed_count",
                "open_positions",
                "can_set_capacity",
                "gross_budget",
                "max_net_budget",
                "can_manage",
                "can_edit",
                "can_duplicate",
                "can_edit_course_details",
                "can_edit_metadata",
                "replaceable_claim_ids",
                "can_edit_dispatch",
                "can_edit_schedule",
                "can_reassign_company",
                "class_id",
                "class_name",
                "dispatch_contact",
                "meeting_url",
                "organisation_id",
                "claims",
            ].sort();
            for (const [who, aal, privileged] of [
                [admin, "aal1", true],
                [owner, "aal1", true],
                [manager, "aal1", false],
                [teacher, "aal1", false],
                [senior, "aal1", false],
            ]) {
                const current = await read(who, rolePriced, aal);
                assert.deepEqual(Object.keys(current).sort(), fields);
                assert.equal(current.capacity, 3);
                assert.equal(current.gross_budget, privileged ? 300.03 : null);
                assert.equal(current.max_net_budget, privileged ? 300.03 : null);
                assert.deepEqual(current.claims, []);
                assert.equal(current.organisation_id, [admin, owner, manager].includes(who) ? org : null);
                for (const field of ["class_id", "class_name", "dispatch_contact", "meeting_url"])
                    assert.equal(current[field], null, field);
                // Exact legacy net totals already belong to this authorized offer's
                // commercial contract; adding company isolation must not reinterpret them.
                const old = await read(who, legacy, aal);
                assert.deepEqual(Object.keys(old).sort(), fields);
                assert.equal(old.max_net_budget, 274.11);
                assert.equal(old.gross_budget, null);
            }
            // Keep the existing privileged claims and finance RPC authority without
            // granting a manager somebody else's private calendar allocation rows.
            assert.equal(
                await actor(
                    manager,
                    `select count(*) from public.job_claims where id=${q(acceptedClaim)}`,
                    "aal1",
                ),
                "1",
            );
            assert.equal(
                await actor(
                    manager,
                    `select count(*) from public.assignment_sessions where id=${q(allocation)}`,
                    "aal1",
                ),
                "0",
            );
            assert.equal(
                (await earnings(manager, "true", "aal1")).some(
                    (row) => row.claim_id === acceptedClaim,
                ),
                true,
            );
            assert.deepEqual(await earnings(manager, "false", "aal1"), []);

            const ownDispatch = await read(company, rolePriced, "aal1");
            assert.deepEqual(Object.keys(ownDispatch).sort(), fields);
            assert.equal(ownDispatch.organisation_id, org);
            assert.equal(ownDispatch.can_edit_dispatch, true);
            assert.equal(ownDispatch.can_manage, false);
            assert.equal(ownDispatch.gross_budget, null);
            assert.equal(ownDispatch.max_net_budget, null);
            assert.deepEqual(ownDispatch.claims, []);
            await assert.rejects(read(otherCompany, rolePriced, "aal1"), /42501|denied/i);
            const publicRate = JSON.parse(
                await sql(
                    `select jsonb_build_object('amount',amount,'total_amount',total_amount) from public.jobs where id=${q(rolePriced)}`,
                ),
            );
            assert.deepEqual(publicRate, {amount: 0, total_amount: 0});
            const projected = (await list()).find((row) => row.id === rolePriced);
            assert(projected);
            assert.deepEqual(
                Object.keys(projected).sort(),
                [
                    "id",
                    "title",
                    "organisation_id",
                    "organisation_name",
                    "can_delete",
                ].sort(),
            );
        },
    );
});
console.log(`\n${checks} company deletion isolation PostgreSQL groups passed.`);