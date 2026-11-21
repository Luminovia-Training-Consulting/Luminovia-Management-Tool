/** Participant role fences and current scoped company and learner review authority. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import {portalOpenApi} from "../src/features/developer-api/contract.ts";
import {withTestDatabase} from "./testing/database.mjs";

await withTestDatabase("portal_membership", async ({sql, actor}) => {
    const participant = randomUUID(),
        lecturer = randomUUID(),
        company = randomUUID(),
        guest = randomUUID(),
        admin = randomUUID();
    await sql(
        `insert into auth.users(id,email) values('${participant}','participant@example.invalid'),('${lecturer}','lecturer@example.invalid'),('${company}','company@example.invalid'),('${guest}','guest@example.invalid'),('${admin}','admin@example.invalid');
         insert into public.user_roles(user_id,role) values('${participant}','participant'),('${lecturer}','lecturer'),('${company}','client'),('${guest}','guest'),('${admin}','admin');`,
    );
    assert.equal(await actor(participant, "select private.actor_active()"), "f");
    const visibleAccounts = async (who) =>
        JSON.parse(await actor(who, `select jsonb_build_object(
          'profiles',(select coalesce(jsonb_agg(id order by id),'[]') from public.profiles),
          'roles',(select coalesce(jsonb_agg(role order by role),'[]') from public.user_roles)
        )`));
    assert.deepEqual(await visibleAccounts(participant), {profiles: [], roles: []});
    assert.deepEqual(await visibleAccounts(guest), {profiles: [guest], roles: ["guest"]});
    assert.deepEqual(await visibleAccounts(lecturer), {profiles: [lecturer], roles: ["lecturer"]});
    assert.deepEqual(await visibleAccounts(admin), {
        profiles: [admin,company,guest,lecturer,participant].sort(),
        roles: ["admin"],
    });
    await assert.rejects(
        actor(participant, "select public.require_portal_access()"),
        /42501/,
    );
    assert.equal(await actor(lecturer, "select public.portal_access()"), "t");
    await actor(lecturer, "select public.require_portal_access()");
    await actor(company, "select public.require_portal_access()");
    await sql(
        `begin;set local role anon;select public.require_portal_access();rollback;`,
    );
    await sql(
        `begin;set local role service_role;select public.require_portal_access();rollback;`,
    );
    const org = randomUUID(),
        template = randomUUID(),
        run = randomUUID(),
        job = randomUUID(),
        claim = randomUUID();
    await sql(`insert into public.organisations(id,name) values('${org}','Fictional Academy');
    insert into private.company_premium_settings(organisation_id,enabled,version) values('${org}',true,1)
      on conflict(organisation_id) do update set enabled=true,version=1;
    insert into public.client_organisation_memberships(user_id,organisation_id) values('${company}','${org}');
    insert into public.course_templates(id,title) values('${template}','Completed course');
    insert into public.course_runs(id,template_id,organisation_id,published) values('${run}','${template}','${org}',false);
    insert into public.course_sessions(course_run_id,starts_at,ends_at) values('${run}',now()-interval '2 day',now()-interval '1 day');
    insert into public.jobs(id,course_run_id,title,customer_name,delivery_type,time_zone,status,amount,currency,rate_unit,total_amount,terms) values('${job}','${run}','Fictional assignment','Fictional Academy','online','Europe/Berlin','filled',100,'EUR','fixed_total',100,'Fictional terms');
    insert into public.job_sessions(job_id,starts_at,ends_at) values('${job}',now()-interval '2 day',now()-interval '1 day');
    insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,amount,currency,rate_unit,total_amount,terms,terms_version) values('${claim}','${job}','${lecturer}','${randomUUID()}',100,'EUR','fixed_total',100,'Fictional terms',1);`);
    assert.equal(
        JSON.parse(await actor(company, "select public.reviewable_courses()"))
            .length,
        1,
    );
    const room = randomUUID();
    await sql(`insert into public.chat_rooms(id, job_id, kind, title)
               values ('${room}', '${job}', 'lecturer_course', 'Course team') on conflict(job_id) do
               update
               set title=excluded.title;
    insert into public.chat_members(room_id,user_id) select id,'${lecturer}' from public.chat_rooms where job_id='${job}' on conflict(room_id,user_id) do update set removed_at=null;`);
    const destinations = JSON.parse(
        await actor(
            lecturer,
            `select public.course_operation_destinations('${run}')`,
        ),
    );
    assert.deepEqual(Object.keys(destinations).sort(), ["jobs", "lecturers", "organisation", "rooms"]);
    assert.equal(destinations.organisation.name, "Fictional Academy");
    assert.equal(destinations.lecturers.length, 1);
    assert.deepEqual(Object.keys(destinations.lecturers[0]).sort(), ["id", "name"]);
    assert.deepEqual(destinations.jobs, [{id: job, title: "Fictional assignment"}]);
    assert.equal(destinations.rooms.length, 1);
    assert.deepEqual(Object.keys(destinations.rooms[0]).sort(), ["id", "name"]);
    await sql(
        `update public.chat_members set removed_at=now() where user_id='${lecturer}' and room_id in (select id from public.chat_rooms where job_id='${job}')`,
    );
    assert.equal(
        JSON.parse(
            await actor(
                lecturer,
                `select public.course_operation_destinations('${run}')`,
            ),
        ).rooms.length,
        0,
    );
    await assert.rejects(
        actor(participant, `select public.course_operation_destinations('${run}')`),
        /Active course account required/,
    );
    console.log(
        "PASS course destinations use current course, job and exact chat membership",
    );
    const review = await actor(
        company,
        `select public.submit_course_review('${run}','${lecturer}',5,'Helpful instruction',0)`,
    );
    assert.match(review, /^[a-f0-9-]{36}$/);
    await assert.rejects(
        actor(
            lecturer,
            `select public.submit_course_review('${run}','${lecturer}',5,'Self review',0)`,
        ),
        /Invalid review/,
    );
    await assert.rejects(
        actor(
            participant,
            `select public.submit_course_review('${run}','${lecturer}',5,'Participant',0)`,
        ),
        /Active login required/,
    );
    await sql(
        `update public.client_organisation_memberships set removed_at=now() where user_id='${company}'`,
    );
    assert.equal(
        JSON.parse(await actor(company, "select public.reviewable_courses()"))
            .length,
        0,
    );
    await assert.rejects(
        actor(
            company,
            `select public.submit_course_review('${run}','${lecturer}',4,'Stale company membership',1)`,
        ),
        /Company membership/,
    );
    console.log(
        "PASS completed-course company lecturer reviews and revoked-membership denial",
    );
    // Verify a participant-only author through the same scoped request paths.
    // Seed an already accepted fictional association separately from onboarding.
    await sql(`update auth.users set email_confirmed_at=now() where id='${participant}'`);
    const ownParticipantAccount = {profiles: [participant], roles: ["participant"]};
    assert.deepEqual(await visibleAccounts(participant), ownParticipantAccount);
    for (const relation of ["profiles", "user_roles"]) {
        await actor(participant,
            `select set_config('request.path','/${relation}',true);select public.require_portal_access()`);
    }
    const changed = await actor(participant,
        `update public.profiles set display_name='Fictional denied participant edit' where id='${participant}' returning id`);
    assert.equal(changed, "");
    console.log("PASS profile and role visibility for verified and unverified participants, guests, lecturers and administrators");

    const link = randomUUID();
    await sql(`
        insert into private.company_participant_link_requests(
          id,organisation_id,requested_by,request_id,luminovia_user_id,target_user_id,status,expires_at
        ) select '${link}','${org}','${company}','${randomUUID()}',p.luminovia_user_id,p.id,'accepted',now()+interval '1 day'
          from public.profiles p where p.id='${participant}';
        insert into private.company_participant_memberships(organisation_id,user_id,status,link_request_id,invited_by,joined_at)
          values('${org}','${participant}','active','${link}','${company}',now());
        insert into public.course_enrolments(course_run_id,user_id,status,enrolled_by)
          values('${run}','${participant}','completed','${company}');
    `);
    for (const endpoint of ["reviewable_courses","submit_course_review","delete_course_review"]) {
        await actor(participant, `select set_config('request.path','/rpc/${endpoint}',true);select public.require_portal_access()`);
    }
    await assert.rejects(
        actor(participant, "select set_config('request.path','/rpc/people_directory',true);select public.require_portal_access()"),
        /42501/,
    );
    const reviewResponse = z.fromJSONSchema(
        portalOpenApi("https://portal.example.invalid").paths["/rest/v1/rpc/reviewable_courses"].post
            .responses["200"].content["application/json"].schema,
    );
    const reviewed = async () => reviewResponse.parse(
        JSON.parse(await actor(participant, "select public.reviewable_courses()")),
    );
    assert.equal((await reviewed())[0].review,null);
    const learnerReview = await actor(participant,
        `select public.submit_course_review('${run}','${lecturer}',4,'Helpful practice',0)`);
    assert.equal((await reviewed())[0].review.id,learnerReview);
    await assert.rejects(actor(participant, `select public.submit_course_review('${run}','${lecturer}',1,'Obsolete edit',0)`), /PT409/);
    await assert.rejects(actor(participant, `select public.delete_course_review('${review}',1)`), /42501/);
    await assert.rejects(actor(participant, `select public.delete_course_review('${learnerReview}',null)`), /PT409/);
    assert.equal((await reviewed())[0].review.comment,"Helpful practice");
    await sql(`update private.company_premium_settings set enabled=false,version=2 where organisation_id='${org}'`);
    assert.deepEqual(await visibleAccounts(participant), ownParticipantAccount);
    assert.deepEqual(await reviewed(), []);
    await assert.rejects(actor(participant, `select public.delete_course_review('${learnerReview}',1)`), /42501/);
    await sql(`update private.company_premium_settings set enabled=true,version=3 where organisation_id='${org}'`);
    await actor(participant, `select public.delete_course_review('${learnerReview}',1)`);
    assert.equal((await reviewed())[0].review.deleted,true);
    console.log("PASS participant-only authorship, current Premium and own-only withdrawal");

    await sql(`delete from public.user_roles where user_id='${lecturer}'`);
    await assert.rejects(
        actor(lecturer, "select public.require_portal_access()"),
        /Operational portal access required/,
    );
    assert.equal(
        await sql(
            `select count(*) from auth.users where id in ('${participant}','${lecturer}','${company}')`,
        ),
        "3",
    );
    console.log(
        "PASS participant/current-role REST guard, direct RLS, operational roles and account preservation",
    );
});
