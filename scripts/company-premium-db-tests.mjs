/** Isolated SQL/RLS/API checks for the admin-only company Premium flag and retained course data. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {quoteSql as q, withTestDatabase} from "./testing/database.mjs";

let checks = 0;

/** Count one test gate only after all its permission and retained-data assertions pass. */
async function check(name, run) {
    await run();
    checks++;
    console.log(`PASS ${name}`);
}

await withTestDatabase("company_premium_test", async ({sql, actor}) => {
    const admin = randomUUID(), secondAdmin = randomUUID(), manager = randomUUID(),
        lecturer = randomUUID(), participant = randomUUID(), client = randomUUID(),
        owner = randomUUID();
    const companyA = randomUUID(), companyB = randomUUID(),
        template = randomUUID(), runA = randomUUID(), runB = randomUUID(),
        sessionA = randomUUID(), sessionB = randomUUID(),
        roomA = randomUUID(), roomB = randomUUID(),
        membershipA = randomUUID(), membershipB = randomUUID();
    await sql(
        `insert into auth.users(id,email) values${[admin, secondAdmin, manager, lecturer, participant, client, owner].map((id) => `(${q(id)},${q(`${id}@example.invalid`)})`).join(",")};update auth.users set email_confirmed_at=now() where id=${q(participant)};
     insert into public.user_roles(user_id,role) values(${q(admin)},'admin'),(${q(secondAdmin)},'admin'),(${q(manager)},'management'),(${q(lecturer)},'lecturer'),(${q(participant)},'participant'),(${q(client)},'client'),(${q(owner)},'owner');
     insert into public.organisations(id,name) values(${q(companyA)},'Fictional Premium Academy A'),(${q(companyB)},'Fictional Premium Academy B');
     insert into public.client_organisation_memberships(user_id,organisation_id) values(${q(client)},${q(companyA)});
     insert into public.course_templates(id,title,syllabus) values(${q(template)},'Fictional retained LMS course','Fictional course syllabus');
     insert into public.course_runs(id,template_id,organisation_id) values(${q(runA)},${q(template)},${q(companyA)}),(${q(runB)},${q(template)},${q(companyB)});
     insert into public.course_sessions(id,course_run_id,starts_at,ends_at) values(${q(sessionA)},${q(runA)},now()+interval '2 days',now()+interval '2 days 1 hour'),(${q(sessionB)},${q(runB)},now()+interval '3 days',now()+interval '3 days 1 hour');
     insert into public.course_enrolments(course_run_id,user_id,status,enrolled_by) values(${q(runA)},${q(participant)},'enrolled',${q(admin)}),(${q(runB)},${q(participant)},'enrolled',${q(admin)});
     insert into public.chat_rooms(id,kind,title,owner_id,course_run_id) values(${q(roomA)},'participant_course','Fictional company A room',${q(admin)},${q(runA)}),(${q(roomB)},'participant_course','Fictional company B room',${q(admin)},${q(runB)});
     insert into public.chat_members(room_id,user_id) values(${q(roomA)},${q(participant)}),(${q(roomB)},${q(participant)});
     insert into private.company_participant_link_requests(id,organisation_id,requested_by,request_id,luminovia_user_id,target_user_id,status,expires_at) values('${membershipA}','${companyA}','${admin}','${randomUUID()}',(select luminovia_user_id from public.profiles where id='${participant}'),'${participant}','accepted',now()+interval '14 days'),('${membershipB}','${companyB}','${admin}','${randomUUID()}',(select luminovia_user_id from public.profiles where id='${participant}'),'${participant}','accepted',now()+interval '14 days');
     insert into private.company_participant_memberships(organisation_id,user_id,status,link_request_id,invited_by,joined_at,version) values('${companyA}','${participant}','active','${membershipA}','${admin}',now(),1),('${companyB}','${participant}','active','${membershipB}','${admin}',now(),1);`,
    );
    /** Invoke one public RPC with an authenticated fixture identity. */
    const rpc = (who, name, args = []) =>
        actor(
            who,
            `select to_jsonb(public.${name}(${args
                .map((value) =>
                    value === null
                        ? "null"
                        : Array.isArray(value)
                            ? q(`{${value.join(",")}}`)
                            : typeof value === "boolean" || typeof value === "number"
                                ? String(value)
                                : q(typeof value === "object" ? JSON.stringify(value) : value),
                )
                .join(",")}))`,
        ).then((value) => JSON.parse(value));
    const toggle = (who, org, enabled, version, requestId = randomUUID()) =>
        rpc(who, "set_company_premium", [org, enabled, version, requestId]);

    await check(
        "Existing and new company entitlements default OFF; management may inspect but not change them",
        async () => {
            const settings = await rpc(admin, "company_premium_settings");
            assert.deepEqual(
                settings.map((item) => [item.organisation_id, item.enabled, item.version]).sort(),
                [
                    [companyA, false, 0],
                    [companyB, false, 0],
                ].sort(),
            );
            await assert.rejects(toggle(manager, companyA, true, 0), /42501/);
            await assert.rejects(toggle(lecturer, companyA, true, 0), /42501/);
            await assert.rejects(toggle(participant, companyA, true, 0), /42501/);
            await assert.rejects(toggle(client, companyA, true, 0), /42501/);
            await assert.rejects(toggle(owner, companyA, true, 0), /42501/);
        },
    );

    await check(
        "Admin toggles are idempotent, audited and reject stale concurrent versions",
        async () => {
            const requestId = randomUUID();
            const updated = await toggle(admin, companyB, true, 0, requestId);
            assert.deepEqual(updated, {status: "updated", enabled: true, version: 1});
            assert.deepEqual(await toggle(admin, companyB, true, 0, requestId), updated);
            const stale = await toggle(admin, companyB, false, 0);
            assert.deepEqual(stale, {status: "conflict", enabled: true, version: 1});
            const concurrent = await Promise.all([
                toggle(admin, companyA, true, 0),
                toggle(secondAdmin, companyA, true, 0),
            ]);
            assert.deepEqual(
                concurrent.map((result) => result.status).sort(),
                ["conflict", "updated"],
            );
            const audit = await sql(
                `select count(*) from private.company_premium_audit where organisation_id in ('${companyA}','${companyB}')`,
            );
            assert.equal(audit, "4");
        },
    );

    await check(
        "A OFF blocks participant roster/workspace and direct LMS actions while B ON still works",
        async () => {
            const statusA = (await rpc(admin, "company_premium_settings")).find(
                (item) => item.organisation_id === companyA,
            );
            assert.equal(statusA.enabled, true);
            const off = await toggle(admin, companyA, false, statusA.version);
            assert.equal(off.enabled, false);
            await assert.rejects(rpc(participant, "course_workspace", [runA]), /42501/);
            await assert.rejects(
                rpc(participant, "course_workspace_action", [runA, "quiz_submit", {answer: "fictional"}, 0]),
                /42501/,
            );
            await assert.rejects(rpc(manager, "course_enrolments", [runA]), /42501/);
            await assert.rejects(
                rpc(manager, "manage_course_enrolment", [runA, participant, "removed"]),
                /42501/,
            );
            await assert.rejects(
                rpc(participant, "course_document_access", ["attendance", runA]),
                /42501/,
            );
            assert.equal(
                await actor(
                    participant,
                    `select count(*) from public.chat_rooms where id='${roomA}'`,
                ),
                "0",
            );
            assert.equal(
                await actor(
                    participant,
                    `select count(*) from public.chat_rooms where id='${roomB}'`,
                ),
                "1",
            );
            const search = await rpc(participant, "unified_search", [
                "Fictional retained LMS course",
                "courses",
                null,
                null,
                null,
                40,
            ]);
            assert.deepEqual(search.items.map((item) => item.id), [runB]);
            const bWorkspace = await rpc(participant, "course_workspace", [runB]);
            assert.equal(bWorkspace.lms_enabled, true);
            assert.equal(bWorkspace.access.learner, true);
            const visible = await rpc(participant, "my_course_workspaces");
            assert.deepEqual(visible.map((course) => course.id), [runB]);
            await assert.rejects(
                rpc(manager, "course_workspace", [runA]),
                /company_premium_lms_off/,
            );
            await assert.rejects(
                rpc(manager, "course_workspace_action", [runA, "contact_select", {}, 0]),
                /42501/,
            );
            const baseCourses = await rpc(manager, "my_course_workspaces"),
                companyRun = baseCourses.find((course) => course.id === runA);
            assert.equal(companyRun.lms_enabled, false);
            assert.equal(companyRun.title, "Fictional retained LMS course");
        },
    );

    await check(
        "Re-enable restores only current memberships; retained-data access is admin-only and audited",
        async () => {
            const version = (await rpc(admin, "company_premium_settings")).find(
                (item) => item.organisation_id === companyA,
            ).version;
            await rpc(admin, "set_company_premium", [companyA, true, version, randomUUID()]);
            assert.deepEqual(
                (await rpc(participant, "my_course_workspaces")).map((course) => course.id).sort(),
                [runA, runB].sort(),
            );
            await rpc(admin, "remove_company_participant", [
                companyA,
                participant,
                1,
                randomUUID(),
            ]);
            let current = (await rpc(admin, "company_premium_settings")).find(
                (item) => item.organisation_id === companyA,
            ).version;
            await rpc(admin, "set_company_premium", [companyA, false, current, randomUUID()]);
            current = (await rpc(admin, "company_premium_settings")).find(
                (item) => item.organisation_id === companyA,
            ).version;
            await rpc(admin, "set_company_premium", [companyA, true, current, randomUUID()]);
            assert.deepEqual(
                (await rpc(participant, "my_course_workspaces")).map((course) => course.id),
                [runB],
            );
            const retained = await rpc(admin, "retained_company_lms", [companyA]);
            assert.equal(retained.premium_enabled, true);
            assert.equal(retained.course_count, 1);
            assert.equal(retained.courses[0].title, "Fictional retained LMS course");
            assert.equal("notebook" in retained.courses[0], false);
            await assert.rejects(rpc(manager, "retained_company_lms", [companyA]), /42501/);
            assert.equal(
                await sql(
                    `select count(*) from public.audit_events where actor_id='${admin}' and action='company.premium_retained_data_viewed' and resource_id='${companyA}'`,
                ),
                "1",
            );
            assert.equal(
                await sql(
                    `select count(*) from public.course_enrolments where course_run_id='${runA}' and user_id='${participant}' and status='removed'`,
                ),
                "1",
            );
        },
    );
});

console.log(`PASS: ${checks} isolated company Premium database groups.`);