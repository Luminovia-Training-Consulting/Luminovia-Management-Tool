/** Isolated Premium LMS notification recipient and current-delivery checks. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {quoteSql as q, withTestDatabase} from "./testing/database.mjs";

let checks = 0;
const check = async (name, run) => {
    await run();
    checks++;
    console.log(`PASS ${name}`);
};

await withTestDatabase("premium_notification_test", async ({sql, actor}) => {
    const [admin, participant, companyA, companyB, template, runA, runB,
        roomA, roomB, messageA, messageB, questionA, questionB,
        membershipA, membershipB] = Array.from({length: 15}, randomUUID);
    const notificationA = randomUUID(), notificationB = randomUUID(),
        chatNoticeA = randomUUID(), chatNoticeB = randomUUID(),
        operationalNotice = randomUUID();
    let emailNoticeB;
    const rpc = async (user, name, args = []) => {
        const value = await actor(user,
            `select to_jsonb(public.${name}(${args.join(",")}))`);
        return JSON.parse(value || "null");
    };
    const delivered = (who, kind, resource) => sql(
        `select private.notification_delivery_allowed(${q(who)},${q(kind)},${q(resource)})`,
    );
    const service = async (name, args = []) => JSON.parse(await sql(
        `begin;set local role service_role;select coalesce(to_jsonb(public.${name}(${args.join(",")})),'null'::jsonb);commit;`,
    ));
    await sql(`insert into auth.users(id,email,email_confirmed_at)
      values (${q(admin)},'fixture-admin@example.invalid',now()),
             (${q(participant)},'fixture-participant@example.invalid',now());
      insert into public.user_roles(user_id,role)
      values (${q(admin)},'admin'),(${q(participant)},'participant');
      insert into public.organisations(id,name)
      values (${q(companyA)},'Fictional Company A'),(${q(companyB)},'Fictional Company B');
      insert into public.course_templates(id,title,syllabus)
      values (${q(template)},'Fictional Premium Course','Fictional syllabus');
      insert into public.course_runs(id,template_id,organisation_id)
      values (${q(runA)},${q(template)},${q(companyA)}),
             (${q(runB)},${q(template)},${q(companyB)});
      insert into public.course_enrolments(course_run_id,user_id,status,enrolled_by)
      values (${q(runA)},${q(participant)},'enrolled',${q(admin)}),
             (${q(runB)},${q(participant)},'enrolled',${q(admin)});
      insert into private.company_participant_link_requests(
        id,organisation_id,requested_by,request_id,luminovia_user_id,target_user_id,status,expires_at
      ) values (${q(membershipA)},${q(companyA)},${q(admin)},${q(randomUUID())},
        (select luminovia_user_id from public.profiles where id=${q(participant)}),
        ${q(participant)},'accepted',now()+interval '14 days'),
        (${q(membershipB)},${q(companyB)},${q(admin)},${q(randomUUID())},
        (select luminovia_user_id from public.profiles where id=${q(participant)}),
        ${q(participant)},'accepted',now()+interval '14 days');
      insert into private.company_participant_memberships(
        organisation_id,user_id,status,link_request_id,invited_by,joined_at
      ) values (${q(companyA)},${q(participant)},'active',${q(membershipA)},${q(admin)},now()),
        (${q(companyB)},${q(participant)},'active',${q(membershipB)},${q(admin)},now());
      insert into public.chat_rooms(id,kind,title,owner_id,course_run_id)
      values (${q(roomA)},'participant_course','Fictional A chat',${q(admin)},${q(runA)}),
        (${q(roomB)},'participant_course','Fictional B chat',${q(admin)},${q(runB)});
      insert into public.chat_members(room_id,user_id)
      values (${q(roomA)},${q(admin)}),(${q(roomA)},${q(participant)}),
        (${q(roomB)},${q(admin)}),(${q(roomB)},${q(participant)});
      insert into public.messages(id,room_id,sender_id,client_id,request_hash,body)
      values (${q(messageA)},${q(roomA)},${q(admin)},${q(randomUUID())},'fixture-a','Fictional A text'),
        (${q(messageB)},${q(roomB)},${q(admin)},${q(randomUUID())},'fixture-b','Fictional B text');
      insert into private.course_questions(id,run_id,author_id,body,answer)
      values (${q(questionA)},${q(runA)},${q(participant)},'Fictional A question','Fictional answer'),
        (${q(questionB)},${q(runB)},${q(participant)},'Fictional B question','Fictional answer');`);
    await rpc(admin, "set_company_premium", [q(companyA), "true", "0", q(randomUUID())]);
    await rpc(admin, "set_company_premium", [q(companyB), "true", "0", q(randomUUID())]);
    await sql(`insert into public.notifications(id,user_id,kind,resource_id)
      values (${q(notificationA)},${q(participant)},'course_answer',${q(questionA)}),
        (${q(notificationB)},${q(participant)},'course_answer',${q(questionB)}),
        (${q(chatNoticeA)},${q(participant)},'chat_message',${q(messageA)}),
        (${q(chatNoticeB)},${q(participant)},'chat_message',${q(messageB)}),
        (${q(operationalNotice)},${q(participant)},'claim_confirmed',${q(randomUUID())});`);

    await check("Participant inbox and both external delivery gates use current course scope", async () => {
        const inbox = await rpc(participant, "notification_inbox", ["false", "null", "null", "40"]);
        assert.deepEqual(inbox.items.map((item) => item.id).sort(),
            [notificationA, notificationB, chatNoticeA, chatNoticeB].sort());
        assert.equal(inbox.unread_count, 4);
        assert.equal(inbox.items.find((item) => item.id === chatNoticeA).href,
            `/courses/${runA}/workspace#course-chat`);
        assert.equal(await delivered(participant, "course_answer", questionA), "t");
        assert.equal(await delivered(participant, "chat_message", messageA), "t");
        assert.equal(await delivered(participant, "claim_confirmed", randomUUID()), "f");
        assert.equal(await actor(participant,
            "set local request.path='/rpc/notification_inbox';select private.require_portal_access();select 1"), "1");
        await assert.rejects(actor(participant,
            "set local request.path='/rpc/notification_preferences';select private.require_portal_access()"), /42501/);
    });

    await check("A leased email is suppressed after OFF while B remains preparable", async () => {
        const [emailQuestionA, emailQuestionB, emailNoticeA, noticeB] =
            Array.from({length: 4}, randomUUID);
        emailNoticeB = noticeB;
        await sql(`update private.delivery_preferences set email_enabled=true
          where user_id=${q(participant)};
          insert into private.course_questions(id,run_id,author_id,body,answer)
          values (${q(emailQuestionA)},${q(runA)},${q(participant)},'Fictional queued A','Answer A'),
            (${q(emailQuestionB)},${q(runB)},${q(participant)},'Fictional queued B','Answer B');
          insert into public.notifications(id,user_id,kind,resource_id)
          values (${q(emailNoticeA)},${q(participant)},'course_answer',${q(emailQuestionA)}),
            (${q(emailNoticeB)},${q(participant)},'course_answer',${q(emailQuestionB)});`);
        const leases = await service("lease_notification_emails", [10]);
        assert.equal(leases.length, 2);
        await rpc(admin, "set_company_premium", [q(companyA), "false", "1", q(randomUUID())]);
        const prepared = [];
        for (const lease of leases) prepared.push(await service("prepare_notification_email", [
            q(lease.id), q(lease.lease_token),
        ]));
        assert.equal(prepared.filter(Boolean).length, 1);
        assert.equal(prepared.find(Boolean).recipient, "fixture-participant@example.invalid");
        assert.equal(await sql(`select count(*) from private.notification_email_outbox
          where notification_id=${q(emailNoticeA)} and state='suppressed'`), "1");
        assert.equal(await sql(`select count(*) from private.notification_email_outbox
          where notification_id=${q(emailNoticeB)} and state='sending'`), "1");
    });

    await check("A OFF retains receipts but removes A inbox, direct rows and email/push eligibility", async () => {
        const inbox = await rpc(participant, "notification_inbox", ["false", "null", "null", "40"]);
        assert.deepEqual(inbox.items.map((item) => item.id).sort(),
            [notificationB, chatNoticeB, emailNoticeB].sort());
        assert.equal(inbox.unread_count, 3);
        assert.equal(await actor(participant, "select count(*) from public.notifications"), "3");
        assert.equal(await delivered(participant, "course_answer", questionA), "f");
        assert.equal(await delivered(participant, "chat_message", messageA), "f");
        assert.equal(await delivered(participant, "course_answer", questionB), "t");
        assert.equal(await delivered(participant, "chat_message", messageB), "t");
        await assert.rejects(rpc(participant, "mark_notifications", [
            `${q(`{${notificationA}}`)}::uuid[]`, "null", "true",
        ]), /42501/);
        assert.equal(await rpc(participant, "mark_notifications", [
            `${q(`{${notificationB}}`)}::uuid[]`, "null", "true",
        ]), 1);
        assert.equal(await sql(`select count(*) from public.notifications
          where user_id=${q(participant)}`), "7");
    });

    await check("Removing B association stops all remaining Premium notification delivery", async () => {
        await rpc(admin, "remove_company_participant", [
            q(companyB), q(participant), "1", q(randomUUID()),
        ]);
        const inbox = await rpc(participant, "notification_inbox", ["false", "null", "null", "40"]);
        assert.deepEqual(inbox.items, []);
        assert.equal(await delivered(participant, "course_answer", questionB), "f");
        assert.equal(await delivered(participant, "chat_message", messageB), "f");
        assert.equal(await actor(participant, "select count(*) from public.notifications"), "0");
    });
});

console.log(`PASS: ${checks} isolated Premium notification groups.`);
