/** Disposable queue/event regressions, including real Supabase legacy-GUC semantics. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { withTestDatabase, quoteSql as q } from "./testing/database.mjs";
await withTestDatabase("smart_notifications", async ({ sql, actor }) => {
  const [owner, peer, learner, client, admin] = Array.from(
    { length: 5 },
    randomUUID,
  );
  await sql(
    `insert into auth.users(id,email)values${[owner, peer, learner, client, admin].map((id) => `(${q(id)},${q(id + "@example.invalid")})`).join(",")};insert into public.user_roles(user_id,role)values(${q(owner)},'lecturer'),(${q(peer)},'lecturer'),(${q(learner)},'participant'),(${q(client)},'client'),(${q(admin)},'admin');`,
  );
  const [
    task,
    room,
    message,
    organisation,
    template,
    run,
    session,
    claim,
    job,
    question,
    prep,
  ] = Array.from({ length: 11 }, randomUUID);
  await sql(
    `insert into public.chat_rooms(id,kind,owner_id,dm_key)values(${q(room)},'dm',${q(owner)},${q([owner, peer].sort().join(":"))});insert into public.chat_members(room_id,user_id)values(${q(room)},${q(owner)}),(${q(room)},${q(peer)});insert into public.messages(id,room_id,sender_id,body,client_id,request_hash)values(${q(message)},${q(room)},${q(owner)},'Private message never in external payload',${q(randomUUID())},'fictional');insert into private.work_tasks(id,creator_id,assignee_id,scope,title,due_at,source_message_id,client_id,request_payload)values(${q(task)},${q(owner)},${q(owner)},'private','Private task title',now()+interval '1 hour',${q(message)},${q(randomUUID())},'{}');`,
  );
  const helper = (who, kind, id) =>
    sql(
      `select private.notification_delivery_allowed(${q(who)},${q(kind)},${q(id)})`,
    );
  assert.equal(await helper(owner, "task_due", task), "t");
  assert.equal(await helper(peer, "task_due", task), "f");
  assert.equal(await helper(admin, "task_due", task), "f");
  // Match the actual Supabase helper, which may prefer a legacy sub GUC.
  await sql(
    `create or replace function auth.uid() returns uuid language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub'))::uuid$$;`,
  );
  const claims = JSON.stringify({
    sub: peer,
    role: "authenticated",
    aal: "aal2",
    custom: "preserved",
  });
  assert.equal(
    await sql(
      `begin;set local request.jwt.claim.sub=${q(peer)};set local request.jwt.claims=${q(claims)};select private.notification_delivery_allowed(${q(owner)},'task_due',${q(task)})||':'||private.notification_delivery_allowed(${q(peer)},'task_due',${q(task)})||':'||auth.uid()||':'||(current_setting('request.jwt.claims')=${q(claims)});rollback;`,
    ),
    `true:false:${peer}:true`,
  );
  await sql(
    `begin;create or replace function private.notification_target(p_kind text,p_resource uuid)returns jsonb language plpgsql stable security definer set search_path='' as $test$begin raise exception 'Fictional target failure';end;$test$;set local request.jwt.claim.sub=${q(peer)};set local request.jwt.claims=${q(claims)};do $test$begin begin perform private.notification_delivery_allowed(${q(owner)},'task_due',${q(task)});raise exception 'Expected failure';exception when raise_exception then if auth.uid()<>${q(peer)}::uuid or current_setting('request.jwt.claims')<>${q(claims)} then raise exception 'Claims escaped exception';end if;end;end;$test$;rollback;`,
  );
  assert.equal(
    await sql(
      "select has_function_privilege('authenticated','private.notification_delivery_allowed(uuid,text,uuid)','execute')",
    ),
    "f",
  );
  assert.equal(
    await sql(
      "select has_function_privilege('service_role','private.notification_delivery_allowed(uuid,text,uuid)','execute')",
    ),
    "f",
  );
  console.log(
    "PASS Queue-recipient ACL checks isolate two identities and administrators, retain exact caller claims after success/denial/error, and expose no helper",
  );
  await sql(
    `update private.delivery_preferences set email_enabled=true where user_id=${q(owner)};`,
  );
  assert.equal(
    await sql(`select private.generate_due_work_notifications(${q(owner)})`),
    "1",
  );
  assert.equal(
    await sql(`select private.generate_due_work_notifications(${q(owner)})`),
    "0",
  );
  const notice = await sql(
    `select id from public.notifications where user_id=${q(owner)} and kind='task_due'`,
  );
  assert.equal(
    await sql(
      `select count(*) from private.notification_email_outbox where notification_id=${q(notice)}`,
    ),
    "1",
  );
  const lease = JSON.parse(
    await sql(
      "begin;set local role service_role;select public.lease_notification_emails(1);commit;",
    ),
  )[0];
  await sql(
    `update public.chat_members set removed_at=now() where user_id=${q(owner)} and room_id=${q(room)}`,
  );
  assert.equal(await helper(owner, "task_due", task), "f");
  assert.equal(
    await sql(
      `begin;set local role service_role;select public.prepare_notification_email(${q(lease.id)},${q(lease.lease_token)}) is null;commit;`,
    ),
    "t",
  );
  assert.equal(
    await sql(
      `select state from private.notification_email_outbox where id=${q(lease.id)}`,
    ),
    "suppressed",
  );
  await sql(
    `update private.notification_preferences set reminders=false where user_id=${q(owner)};delete from public.notifications where id=${q(notice)};`,
  );
  assert.equal(
    await sql(`select private.generate_due_work_notifications(${q(owner)})`),
    "0",
  );
  console.log(
    "PASS Idempotent due source, opt-out, email queue and current private-message revocation before actual dispatch",
  );
  await sql(
    `insert into public.organisations(id,name)values(${q(organisation)},'Fictional academy');insert into public.client_organisation_memberships(user_id,organisation_id)values(${q(client)},${q(organisation)});insert into public.course_templates(id,title)values(${q(template)},'Fictional notified course');insert into public.course_runs(id,template_id,organisation_id)values(${q(run)},${q(template)},${q(organisation)});insert into public.course_sessions(id,course_run_id,starts_at,ends_at)values(${q(session)},${q(run)},now(),now()+interval '1 hour');insert into public.course_enrolments(course_run_id,user_id,status,enrolled_by)values(${q(run)},${q(learner)},'enrolled',${q(admin)});insert into public.jobs(id,course_run_id,title,customer_name,delivery_type,status,amount,currency,rate_unit,total_amount,terms)values(${q(job)},${q(run)},'Fictional job','Fictional academy','online','filled',100,'EUR','fixed_total',100,'Fictional');insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,amount,currency,rate_unit,total_amount,terms,terms_version)values(${q(claim)},${q(job)},${q(owner)},${q(randomUUID())},100,'EUR','fixed_total',100,'Fictional',1);`,
  );
  await assert.rejects(
    actor(
      learner,
      `insert into private.course_questions(id,run_id,author_id,body)values(${q(question)},${q(run)},${q(learner)},'Fictional question')`,
    ),
    /42501/,
  );
  await actor(
    learner,
    `select public.course_workspace_action(${q(run)},'question',jsonb_build_object('body','Fictional question'),0)`,
  );
  const qid = await sql(
    `select id from private.course_questions where run_id=${q(run)} limit 1`,
  );
  assert.equal(
    await sql(
      `select count(*) from public.notifications where resource_id=${q(qid)} and kind='course_question' and user_id=${q(owner)}`,
    ),
    "1",
  );
  assert.equal(
    await sql(
      `select count(*) from public.notifications where resource_id=${q(qid)} and user_id in(${q(peer)},${q(client)})`,
    ),
    "0",
  );
  assert.equal(await helper(owner, "course_question", qid), "t");
  assert.equal(await helper(client, "course_question", qid), "f");
  await sql(
    `insert into private.course_preparation_items(id,run_id,label,client_visible)values(${q(prep)},${q(run)},'Private staff preparation',false);update private.course_preparation_items set done=true where id=${q(prep)};`,
  );
  assert.equal(
    await sql(
      `select count(*) from public.notifications where resource_id=${q(prep)} and user_id=${q(client)}`,
    ),
    "0",
  );
  await sql(
    `update private.course_preparation_items set done=false,client_visible=true where id=${q(prep)}`,
  );
  assert.equal(
    await sql(
      `select count(*) from public.notifications where resource_id=${q(prep)} and user_id=${q(client)}`,
    ),
    "1",
  );
  assert.equal(await helper(client, "course_preparation_updated", prep), "t");
  await sql(
    `update public.client_organisation_memberships set removed_at=now() where user_id=${q(client)}`,
  );
  assert.equal(await helper(client, "course_preparation_updated", prep), "f");
  assert.equal(
    await actor(
      peer,
      `select private.notification_target('course_preparation_updated',${q(prep)})->>'title'`,
    ).catch(() => "denied"),
    "denied",
  );
  console.log(
    "PASS Committed course Q&A/preparation events have exact staff/client audiences; current membership revocation hides target",
  );
  const quiz = {
    questions: [
      {
        prompt: "Fictional directory command?",
        options: ["ls", "rm"],
        correct: 0,
      },
    ],
    pass_percent: 80,
    max_attempts: 2,
    published: true,
  };
  await actor(
    owner,
    `select public.course_workspace_action(${q(run)},'quiz_config',${q(JSON.stringify(quiz))},0)`,
  );
  assert.equal(
    await sql(
      `select count(*) from public.notifications where user_id=${q(learner)} and kind='course_quiz_published' and resource_id=${q(run)}`,
    ),
    "1",
  );
  assert.equal(await helper(learner, "course_quiz_published", run), "t");
  const [document, version] = Array.from({ length: 2 }, randomUUID);
  await sql(
    `insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id)values(${q(document)},${q(admin)},${q(admin)},'personal','material','Fictional exact shared file.pdf','application/pdf',1,'clean',${q(randomUUID())});insert into public.document_versions(id,document_id,version,object_path,original_name,sha256,size_bytes,mime_type,status,uploaded_by,client_id)values(${q(version)},${q(document)},1,${q("fictional/" + randomUUID())},'Fictional exact shared file.pdf',repeat('a',64),1,'application/pdf','clean',${q(admin)},${q(randomUUID())});update public.documents set current_version_id=${q(version)} where id=${q(document)};`,
  );
  const sharePayload = {
    version_id: version,
    audience: "participants",
    category: "material",
  };
  const share = () =>
    actor(
      admin,
      `select public.course_workspace_action(${q(run)},'resource_share',${q(JSON.stringify(sharePayload))},0)`,
      "aal2",
    );
  const resource = JSON.parse(await share()).id;
  assert.equal(
    await sql(
      `select count(*) from public.notifications where user_id=${q(learner)} and kind='course_resource_shared' and resource_id=${q(resource)}`,
    ),
    "1",
  );
  await sql(
    `update public.notifications set read_at=now() where user_id=${q(learner)} and kind='course_resource_shared' and resource_id=${q(resource)};`,
  );
  await share();
  assert.equal(
    await sql(
      `select read_at is not null from public.notifications where user_id=${q(learner)} and kind='course_resource_shared' and resource_id=${q(resource)}`,
    ),
    "t",
  );
  await actor(
    admin,
    `select public.course_workspace_action(${q(run)},'resource_remove',jsonb_build_object('id',${q(resource)}),0)`,
    "aal2",
  );
  await share();
  assert.equal(
    await sql(
      `select read_at is null from public.notifications where user_id=${q(learner)} and kind='course_resource_shared' and resource_id=${q(resource)}`,
    ),
    "t",
  );
  console.log(
    "PASS Actual quiz-config action notifies after its committed revision; exact resource restoration renews notice while idempotent sharing does not",
  );
  await sql(`update public.profiles set active=false where id=${q(owner)}`);
  assert.equal(await helper(owner, "claim_cancelled", randomUUID()), "f");
  console.log(
    "PASS Existing-identity suspension suppresses even mandatory external receipts",
  );
  console.log("5 smart notification PostgreSQL groups passed");
});
