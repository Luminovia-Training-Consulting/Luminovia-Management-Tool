/** Real PostgreSQL job-to-course/chat projection and revocation boundaries. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import {portalOpenApi} from "../src/features/developer-api/contract.ts";
import {quoteSql as q, withTestDatabase} from "./testing/database.mjs";

await withTestDatabase("job_navigation", async ({sql, actor}) => {
    const teacher = randomUUID(),
        peer = randomUUID(),
        admin = randomUUID(),
        participant = randomUUID(),
        template = randomUUID(),
        run = randomUUID(),
        job = randomUUID(),
        room = randomUUID(),
        hiddenRoom = randomUUID();
    await sql(`insert into auth.users(id,email) values ${[teacher, peer, admin, participant].map((id) => `(${q(id)},${q(id + "@example.invalid")})`).join(",")};
   insert into public.user_roles(user_id,role) values(${q(teacher)},'lecturer'),(${q(peer)},'lecturer'),(${q(admin)},'admin'),(${q(participant)},'participant');
   insert into public.course_templates(id,title) values(${q(template)},'Fictional course');
   insert into public.course_runs(id,template_id,time_zone) values(${q(run)},${q(template)},'Europe/Berlin');
   insert into public.jobs(id,course_run_id,title,customer_name,delivery_type,status,amount,total_amount,currency,rate_unit,terms) values(${q(job)},${q(run)},'Fictional job','Fictional organisation','online','published',100,100,'EUR','fixed_total','Fictional terms');
   insert into public.job_claims(job_id,lecturer_id,idempotency_key,status,amount,total_amount,currency,rate_unit,terms,terms_version) values(${q(job)},${q(teacher)},${q(randomUUID())},'confirmed',100,100,'EUR','fixed_total','Fictional terms',1);
   insert into public.chat_rooms(id,job_id,kind,title) values(${q(room)},${q(job)},'lecturer_course','Fictional lecturer room');
   insert into public.chat_rooms(id,course_run_id,kind,title) values(${q(hiddenRoom)},${q(run)},'participant_course','Fictional hidden room');
   insert into public.chat_members(room_id,user_id) values(${q(room)},${q(teacher)});`);
    const response = z.fromJSONSchema(
        portalOpenApi("https://portal.example.invalid").paths["/rest/v1/rpc/job_related_navigation"].post
            .responses["200"].content["application/json"].schema,
    );
    const get = async (who, aal = "aal1") =>
        response.parse(JSON.parse(
            await actor(who, `select public.job_related_navigation(${q(job)})`, aal),
        ));
    assert.deepEqual(await get(teacher), {
        course_id: run,
        rooms: [{id: room, kind: "lecturer_course"}],
    });
    assert.deepEqual(await get(peer), {course_id: null, rooms: []});
    assert.deepEqual(await get(admin, "aal2"), {course_id: run, rooms: []});
    await assert.rejects(get(participant), /42501/);
    await sql(
        `update public.chat_members
         set removed_at=now()
         where room_id = ${q(room)}
           and user_id = ${q(teacher)};
        update public.job_claims
        set status='cancelled'
        where job_id = ${q(job)}
          and lecturer_id = ${q(teacher)};`,
    );
    assert.deepEqual(await get(teacher), {course_id: null, rooms: []});
    await sql(`update public.profiles
               set active= false
               where id = ${q(teacher)}`);
    await assert.rejects(get(teacher), /42501/);
    await assert.rejects(
        sql(`set role anon; select public.job_related_navigation(${q(job)})`),
        /42501/,
    );
    console.log(
        "PASS exact job navigation, authorized workspace and member-only chat, revocation, suspension and anonymous denial",
    );
});