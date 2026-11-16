begin;
-- Keep the strict native PL/pgSQL warning gate: explicitly type empty values
-- rather than depending on PL/pgSQL assignment conversion from text. Remove
-- one unused row variable and use a separate automatic quiz loop index so it
-- cannot shadow the retained quiz configuration version. Business statements,
-- actor/MFA/resource checks, locks, retries and existing EXECUTE grants remain
-- unchanged. Every earlier migration stays byte-identical.

create or replace function private.course_workspace_action(p_run_id uuid,p_action text,p_payload jsonb,p_expected_version integer default 0) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c jsonb;target uuid;item private.course_preparation_items;setting private.course_workspace_settings;note private.course_notebooks;
 feedback private.course_feedback;attendance private.course_attendance;session public.course_sessions;
 quiz private.course_quiz_versions;attempt private.course_quiz_attempts;v integer;answers jsonb;correct integer:=0;score integer;
 rowitem jsonb;record private.course_completion_records;facts jsonb;v_document_version uuid;user_target uuid;state text;minutes integer;reason text;
begin
 c:=private.course_workspace_context(p_run_id);
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or p_action is null then raise exception 'Invalid course action' using errcode='22023';end if;
 if p_action='preparation_create' then
  if not(c->>'manager')::boolean then raise exception 'Course management required' using errcode='42501';end if;
  if length(trim(coalesce(p_payload->>'label',''))) not between 1 and 300 or jsonb_typeof(p_payload->'client_visible') is distinct from 'boolean' then raise exception 'Invalid preparation' using errcode='22023';end if;
  insert into private.course_preparation_items(run_id,label,client_visible,updated_by) values(p_run_id,trim(p_payload->>'label'),(p_payload->>'client_visible')::boolean,auth.uid()) returning id into target;
 elsif p_action='preparation_toggle' then
  if not(c->>'staff')::boolean then raise exception 'Assigned teaching staff required' using errcode='42501';end if;
  select * into item from private.course_preparation_items where id=(p_payload->>'id')::uuid and run_id=p_run_id for update;
  if not found or item.version is distinct from p_expected_version then raise exception 'Preparation changed' using errcode='40001';end if;
  if jsonb_typeof(p_payload->'done') is distinct from 'boolean' then raise exception 'Boolean required' using errcode='22023';end if;
  update private.course_preparation_items set done=(p_payload->>'done')::boolean,version=version+1,updated_by=auth.uid(),updated_at=now() where id=item.id returning id into target;
 elsif p_action='contact_select' then
  if not(c->>'manager')::boolean then raise exception 'Course management required' using errcode='42501';end if;
  target:=nullif(p_payload->>'contact_id','')::uuid;
  if target is not null and not exists(select 1 from public.organisation_contacts oc join public.course_runs r on r.organisation_id=oc.organisation_id where r.id=p_run_id and oc.id=target and oc.archived_at is null) then raise exception 'Contact must belong to this course customer' using errcode='42501';end if;
  insert into private.course_workspace_settings(run_id) values(p_run_id) on conflict do nothing;
  select * into setting from private.course_workspace_settings where run_id=p_run_id for update;
  if setting.version is distinct from p_expected_version then raise exception 'Course settings changed' using errcode='40001';end if;
  update private.course_workspace_settings set contact_id=target,version=version+1 where run_id=p_run_id;
 elsif p_action='resource_share' then
  if not(c->>'manager')::boolean then raise exception 'Course management required' using errcode='42501';end if;
  v_document_version:=(p_payload->>'version_id')::uuid;
  if not exists(select 1 from public.document_versions v join public.documents d on d.id=v.document_id where v.id=v_document_version and v.status='clean' and v.sha256 is not null and d.deleted_at is null and d.kind='material' and ((d.scope='personal' and d.owner_id=auth.uid()) or exists(select 1 from public.jobs j where j.id=d.job_id and j.course_run_id=p_run_id))) then raise exception 'Own clean material or this course job material required' using errcode='42501';end if;
  insert into private.course_resources(run_id,version_id,audience,category,created_by) values(p_run_id,v_document_version,p_payload->>'audience',p_payload->>'category',auth.uid()) on conflict(run_id,version_id,audience) do update set removed_at=null,category=excluded.category returning id into target;
 elsif p_action='resource_remove' then
  if not(c->>'manager')::boolean then raise exception 'Course management required' using errcode='42501';end if;
  update private.course_resources set removed_at=now() where id=(p_payload->>'id')::uuid and run_id=p_run_id returning id into target;
  if target is null then raise exception 'Course resource unavailable' using errcode='42501';end if;
 elsif p_action='resource_acknowledge' then
  target:=(p_payload->>'id')::uuid;
  if not exists(select 1 from private.course_resources r join public.document_versions v on v.id=r.version_id join public.documents d on d.id=v.document_id where r.id=target and r.run_id=p_run_id and private.course_resource_allowed(r.id) and v.status='clean' and d.deleted_at is null) then raise exception 'Resource unavailable' using errcode='42501';end if;
  insert into private.course_resource_acknowledgements(resource_id,user_id) values(target,auth.uid()) on conflict do nothing;
 elsif p_action='notebook' then
  if length(coalesce(p_payload->>'body',''))>12000 then raise exception 'Notebook too long' using errcode='22023';end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('course-note:'||p_run_id||':'||auth.uid(),0));
  select * into note from private.course_notebooks where run_id=p_run_id and user_id=auth.uid();
  if coalesce(note.version,0) is distinct from p_expected_version then raise exception 'Notebook changed' using errcode='40001';end if;
  insert into private.course_notebooks(run_id,user_id,body) values(p_run_id,auth.uid(),coalesce(p_payload->>'body','')) on conflict(run_id,user_id) do update set body=excluded.body,version=course_notebooks.version+1;
 elsif p_action='question' then
  if not((c->>'staff')::boolean or (c->>'learner')::boolean) then raise exception 'Learner or teaching staff required' using errcode='42501';end if;
  if length(trim(coalesce(p_payload->>'body',''))) not between 1 and 2000 then raise exception 'Question required' using errcode='22023';end if;
  insert into private.course_questions(run_id,author_id,body) values(p_run_id,auth.uid(),trim(p_payload->>'body')) returning id into target;
 elsif p_action='answer' then
  if not(c->>'staff')::boolean then raise exception 'Teaching staff required' using errcode='42501';end if;
  if length(trim(coalesce(p_payload->>'answer',''))) not between 1 and 4000 then raise exception 'Answer required' using errcode='22023';end if;
  update private.course_questions set answer=trim(p_payload->>'answer'),answered_by=auth.uid(),version=version+1 where id=(p_payload->>'id')::uuid and run_id=p_run_id and version=p_expected_version returning id into target;
  if target is null then raise exception 'Question changed' using errcode='40001';end if;
 elsif p_action='feedback' then
  if not((c->>'learner')::boolean or (c->>'client')::boolean) or not exists(select 1 from public.course_sessions where course_run_id=p_run_id) or exists(select 1 from public.course_sessions where course_run_id=p_run_id and ends_at>now()) then raise exception 'Completed course and eligible account required' using errcode='42501';end if;
  if length(coalesce(p_payload->>'comment',''))>2000 then raise exception 'Feedback too long' using errcode='22023';end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('course-feedback:'||p_run_id||':'||auth.uid(),0));
  select * into feedback from private.course_feedback where run_id=p_run_id and user_id=auth.uid();
  if coalesce(feedback.version,0) is distinct from p_expected_version then raise exception 'Feedback changed' using errcode='40001';end if;
  insert into private.course_feedback(run_id,user_id,kind,rating,comment) values(p_run_id,auth.uid(),case when (c->>'learner')::boolean then 'participant' else 'client' end,(p_payload->>'rating')::integer,coalesce(p_payload->>'comment','')) on conflict(run_id,user_id) do update set rating=excluded.rating,comment=excluded.comment,version=course_feedback.version+1;
 elsif p_action='attendance_report' then
  if not(c->>'learner')::boolean then raise exception 'Active enrolment required' using errcode='42501';end if;
  select * into session from public.course_sessions where id=(p_payload->>'session_id')::uuid and course_run_id=p_run_id;
  if not found or now()<session.starts_at-interval '15 minutes' or now()>session.ends_at+interval '15 minutes' then raise exception 'Check-in outside session window' using errcode='22023';end if;
  insert into private.course_attendance(session_id,user_id,state) values(session.id,auth.uid(),'reported') on conflict do nothing;
 elsif p_action='attendance_verify' then
  if not(c->>'staff')::boolean then raise exception 'Assigned teaching staff required' using errcode='42501';end if;
  target:=(p_payload->>'session_id')::uuid;user_target:=(p_payload->>'user_id')::uuid;state:=p_payload->>'state';reason:=trim(coalesce(p_payload->>'reason',''));minutes:=(p_payload->>'minutes')::integer;
  select * into session from public.course_sessions where id=target and course_run_id=p_run_id;
  if not found or session.ends_at>now() or not exists(select 1 from public.course_enrolments where course_run_id=p_run_id and user_id=user_target and status in('enrolled','completed')) then raise exception 'Ended session and current enrolment required' using errcode='42501';end if;
  if state is null or state not in('attended','absent') or minutes is null or minutes<0 or minutes>ceil(extract(epoch from(session.ends_at-session.starts_at))/60) or (state='absent' and minutes<>0) or length(reason) not between 3 and 500 then raise exception 'Valid attendance correction reason and minutes required' using errcode='22023';end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('attendance:'||target||':'||user_target,0));
  select * into attendance from private.course_attendance where session_id=target and user_id=user_target;
  if coalesce(attendance.version,0) is distinct from p_expected_version then raise exception 'Attendance changed' using errcode='40001';end if;
  if exists(select 1 from private.course_completion_records where run_id=p_run_id and user_id=user_target and revoked_at is null) then raise exception 'Revoke active completion before correcting its attendance evidence' using errcode='22023';end if;
  insert into private.course_attendance_audit(session_id,user_id,actor_id,old_state,new_state,reason) values(target,user_target,auth.uid(),to_jsonb(attendance),jsonb_build_object('state',state,'minutes',minutes),reason);
  insert into private.course_attendance(session_id,user_id,state,minutes) values(target,user_target,state,minutes) on conflict(session_id,user_id) do update set state=excluded.state,minutes=excluded.minutes,version=course_attendance.version+1,updated_at=now();
 elsif p_action='quiz_config' then
  if not(c->>'staff')::boolean then raise exception 'Teaching staff required' using errcode='42501';end if;
  if jsonb_typeof(p_payload->'questions') is distinct from 'array' or jsonb_array_length(p_payload->'questions') not between 1 and 20 or jsonb_typeof(p_payload->'published') is distinct from 'boolean' then raise exception 'One to twenty questions required' using errcode='22023';end if;
  for rowitem in select value from jsonb_array_elements(p_payload->'questions') loop
   if length(trim(coalesce(rowitem->>'prompt',''))) not between 1 and 500 or jsonb_typeof(rowitem->'options') is distinct from 'array' or jsonb_array_length(rowitem->'options') not between 2 and 6 or (rowitem->>'correct') is null or (rowitem->>'correct')::integer not between 0 and jsonb_array_length(rowitem->'options')-1 or exists(select 1 from jsonb_array_elements(rowitem->'options')o where jsonb_typeof(o)<>'string' or length(o#>>'{}') not between 1 and 300) then raise exception 'Invalid quiz question' using errcode='22023';end if;
  end loop;
  insert into private.course_quizzes(run_id) values(p_run_id) on conflict do nothing;
  select version into v from private.course_quizzes where run_id=p_run_id for update;
  if v is distinct from p_expected_version then raise exception 'Quiz changed' using errcode='40001';end if;
  update private.course_quizzes set version=version+1 where run_id=p_run_id returning version into v;
  insert into private.course_quiz_versions(run_id,version,questions,pass_percent,max_attempts,published) values(p_run_id,v,p_payload->'questions',(p_payload->>'pass_percent')::integer,(p_payload->>'max_attempts')::integer,(p_payload->>'published')::boolean);
 elsif p_action='quiz_attempt' then
  if not(c->>'learner')::boolean then raise exception 'Current enrolled learner required' using errcode='42501';end if;
  if not exists(select 1 from public.course_sessions where course_run_id=p_run_id and starts_at<=now()) then raise exception 'Course must have started' using errcode='22023';end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('quiz-attempt:'||p_run_id||':'||auth.uid(),0));
  select a.* into attempt from private.course_quiz_attempts a where a.user_id=auth.uid() and a.request_id=(p_payload->>'request_id')::uuid;
  if found then
   if attempt.run_id<>p_run_id or attempt.answers is distinct from p_payload->'answers' then raise exception 'Attempt idempotency conflict' using errcode='22023';end if;
   return jsonb_build_object('id',attempt.id,'score',attempt.score,'passed',attempt.passed);
  end if;
  select q.* into quiz from private.course_quiz_versions q join private.course_quizzes h on h.run_id=q.run_id and h.version=q.version where q.run_id=p_run_id and q.published;
  if not found or quiz.version is distinct from p_expected_version or (select count(*) from private.course_quiz_attempts where run_id=p_run_id and user_id=auth.uid() and quiz_version=quiz.version)>=quiz.max_attempts then raise exception 'Quiz unavailable, changed or attempts exhausted' using errcode='22023';end if;
  answers:=p_payload->'answers';
  if (p_payload->>'request_id') is null or jsonb_typeof(answers) is distinct from 'array' or jsonb_array_length(answers)<>jsonb_array_length(quiz.questions) or exists(select 1 from jsonb_array_elements(answers)a where jsonb_typeof(a)<>'number' or (a#>>'{}')!~'^[0-9]+$') then raise exception 'Complete numeric answers and request ID required' using errcode='22023';end if;
  for answer_index in 0..jsonb_array_length(answers)-1 loop
   if (answers->>answer_index)::integer not between 0 and jsonb_array_length(quiz.questions->answer_index->'options')-1 then raise exception 'Answer out of range' using errcode='22023';end if;
   if (answers->>answer_index)::integer=(quiz.questions->answer_index->>'correct')::integer then correct:=correct+1;end if;
  end loop;
  score:=floor(100.0*correct/jsonb_array_length(answers));
  insert into private.course_quiz_attempts(run_id,quiz_version,user_id,request_id,answers,score,passed) values(p_run_id,quiz.version,auth.uid(),(p_payload->>'request_id')::uuid,answers,score,score>=quiz.pass_percent) returning id into target;
  return jsonb_build_object('id',target,'score',score,'passed',score>=quiz.pass_percent);
 elsif p_action='completion_issue' then
  if not(c->>'learner')::boolean then raise exception 'Own current enrolled learner required' using errcode='42501';end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('completion:'||p_run_id||':'||auth.uid(),0));
  select * into record from private.course_completion_records where run_id=p_run_id and user_id=auth.uid() and revoked_at is null;
  if found then return jsonb_build_object('id',record.id);end if;
  if exists(select 1 from private.course_completion_records old where old.run_id=p_run_id and old.user_id=auth.uid() and old.revoked_at is not null
   and not exists(select 1 from private.course_attendance reviewed join public.course_sessions reviewed_session on reviewed_session.id=reviewed.session_id where reviewed_session.course_run_id=p_run_id and reviewed.user_id=auth.uid() and reviewed.updated_at>old.revoked_at)) then raise exception 'Teaching staff must reverify attendance after revocation before reissue' using errcode='22023';end if;
  if not exists(select 1 from public.course_enrolments where course_run_id=p_run_id and user_id=auth.uid() and status='completed') or not exists(select 1 from public.course_sessions where course_run_id=p_run_id) or exists(select 1 from public.course_sessions s left join private.course_attendance a on a.session_id=s.id and a.user_id=auth.uid() where s.course_run_id=p_run_id and (s.ends_at>now() or a.state is distinct from 'attended' or a.minutes<ceil(extract(epoch from(s.ends_at-s.starts_at))/60*0.8))) then raise exception 'Completed enrolment and verified 80 percent attendance in every ended session required' using errcode='22023';end if;
  select q.* into quiz from private.course_quiz_versions q join private.course_quizzes h on h.run_id=q.run_id and h.version=q.version where q.run_id=p_run_id and q.published;
  if quiz.version is not null and not exists(select 1 from private.course_quiz_attempts a where a.run_id=p_run_id and a.quiz_version=quiz.version and a.user_id=auth.uid() and a.passed) then raise exception 'Pass current published quiz first' using errcode='22023';end if;
  select jsonb_build_object('participant',p.display_name,'course',t.title,'time_zone',r.time_zone,'starts_at',min(s.starts_at),'ends_at',max(s.ends_at),'verified_minutes',sum(a.minutes),'quiz_passed',quiz.version is not null,'quiz_version',quiz.version) into facts
   from public.profiles p cross join public.course_runs r join public.course_templates t on t.id=r.template_id join public.course_sessions s on s.course_run_id=r.id join private.course_attendance a on a.session_id=s.id and a.user_id=p.id where p.id=auth.uid() and r.id=p_run_id group by p.display_name,t.title,r.time_zone;
  insert into private.course_completion_records(run_id,user_id,snapshot) values(p_run_id,auth.uid(),facts) returning id into target;
 elsif p_action='completion_revoke' then
  if not(c->>'staff')::boolean then raise exception 'Teaching staff required' using errcode='42501';end if;
  reason:=trim(coalesce(p_payload->>'reason',''));
  if length(reason) not between 3 and 500 then raise exception 'Revocation reason required' using errcode='22023';end if;
  select user_id into user_target from private.course_completion_records where id=(p_payload->>'id')::uuid and run_id=p_run_id;
  if user_target is null then raise exception 'Completion unavailable' using errcode='42501';end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('completion:'||p_run_id||':'||user_target,0));
  update private.course_completion_records set revoked_at=now(),revoked_by=auth.uid(),revocation_reason=reason where id=(p_payload->>'id')::uuid and run_id=p_run_id and revoked_at is null returning id into target;
  if target is null then raise exception 'Active completion unavailable' using errcode='22023';end if;
  insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),'course.completion_revoked',target,jsonb_build_object('course_run_id',p_run_id,'reason',reason));
 else raise exception 'Unknown course action' using errcode='22023';end if;
 return jsonb_build_object('id',target,'saved',true);
end;$$;

create or replace function private.apply_work_template(p_id uuid,p_expected_version integer,p_client_id uuid) returns uuid[] language plpgsql security definer set search_path='' as $$
declare w private.work_task_templates;r private.work_template_runs;item jsonb;result uuid[]:='{}'::uuid[];task jsonb;zone text;
begin
 if not private.actor_active() or p_client_id is null then raise exception 'Active identity and request required' using errcode='42501';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('template-run:'||auth.uid()::text,0));
 select * into r from private.work_template_runs where user_id=auth.uid() and client_id=p_client_id;
 if found then if r.template_id<>p_id or r.template_version is distinct from p_expected_version then raise exception 'Workflow retry changed' using errcode='22023';end if;return r.task_ids;end if;
 select * into w from private.work_task_templates where id=p_id for share;
 if not found or w.archived or not(w.creator_id=auth.uid() or w.shared and private.chat_staff(auth.uid())) then raise exception 'Workflow unavailable' using errcode='42501';end if;
 if w.version is distinct from p_expected_version then raise exception 'Workflow changed' using errcode='40001';end if;
 select time_zone into zone from public.profiles where id=auth.uid();
 for item in select x from jsonb_array_elements(w.items) x loop
  task=private.save_work_task(null,jsonb_build_object('title',item->>'title','description','','state','open','due_at',now()+make_interval(days=>(item->>'days')::integer),'time_zone',zone,'scope','private','assignee_id',auth.uid(),'source_message_id',null),0,gen_random_uuid());
  result=array_append(result,(task->>'id')::uuid);
 end loop;
 insert into private.work_template_runs(user_id,client_id,template_id,template_version,task_ids) values(auth.uid(),p_client_id,w.id,w.version,result);
 return result;
end;$$;

create or replace function private.normalise_client_request_brief(p_request_id uuid,p_brief jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.client_course_requests; old_content jsonb; units integer; unit_minutes integer; planned numeric; required jsonb:='[]'::jsonb; docs jsonb:='[]'::jsonb; item jsonb; label text; v public.document_versions; d public.documents; category text;
begin
 select * into r from private.client_course_requests where id=p_request_id;
 if not found or not private.client_request_access(p_request_id) then raise exception 'Client request access required' using errcode='42501';end if;
 select content into old_content from private.client_request_briefs where request_id=p_request_id;
 if jsonb_typeof(p_brief) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_brief) k where k not in('teaching_units','unit_minutes','instructions','required_documents','documents')) then raise exception 'Invalid request brief' using errcode='22023';end if;
 if jsonb_typeof(p_brief->'teaching_units') is distinct from 'number' or (p_brief->>'teaching_units') !~ '^[1-9][0-9]{0,3}$' or jsonb_typeof(p_brief->'unit_minutes') is distinct from 'number' or (p_brief->>'unit_minutes') not in('45','60') then raise exception 'Whole teaching units and 45/60 minute unit required' using errcode='22023';end if;
 units:=(p_brief->>'teaching_units')::integer;unit_minutes:=(p_brief->>'unit_minutes')::integer;
 select sum(extract(epoch from ((s->>'ends_at')::timestamptz-(s->>'starts_at')::timestamptz))/60) into planned from jsonb_array_elements(r.payload->'sessions') s;
 if units*unit_minutes>coalesce(planned,0) then raise exception 'Required teaching minutes exceed planned session duration' using errcode='22023';end if;
 if jsonb_typeof(coalesce(p_brief->'instructions','""'))<>'string' or length(coalesce(p_brief->>'instructions',''))>4000 or jsonb_typeof(coalesce(p_brief->'required_documents','[]'))<>'array' or jsonb_array_length(coalesce(p_brief->'required_documents','[]'))>30 or jsonb_typeof(coalesce(p_brief->'documents','[]'))<>'array' or jsonb_array_length(coalesce(p_brief->'documents','[]'))>20 then raise exception 'Invalid request requirements' using errcode='22023';end if;
 for item in select value from jsonb_array_elements(coalesce(p_brief->'required_documents','[]')) loop
  label:=trim(item#>>'{}');
  if jsonb_typeof(item)<>'string' or length(label) not between 1 and 300 then raise exception 'Required document description invalid' using errcode='22023';end if;
  required:=required||jsonb_build_array(label);
 end loop;
 for item in select value from jsonb_array_elements(coalesce(p_brief->'documents','[]')) loop
  if jsonb_typeof(item)<>'object' or exists(select 1 from jsonb_object_keys(item) k where k not in('version_id','category')) or coalesce(item->>'category','') not in('material','report') then raise exception 'Explicit material/report sharing required' using errcode='22023';end if;
  select * into v from public.document_versions where id=(item->>'version_id')::uuid and status='clean' and sha256 ~ '^[0-9a-f]{64}$';
  if not found then raise exception 'Scanned exact version required' using errcode='42501';end if;
  select * into d from public.documents where id=v.document_id and deleted_at is null and kind='material' and scope='personal';
  if not found or (d.owner_id<>auth.uid() and not exists(select 1 from jsonb_array_elements(coalesce(old_content->'documents','[]')) old where old->>'version_id'=v.id::text)) then raise exception 'Own material or an already shared request version required' using errcode='42501';end if;
  category:=item->>'category';
  if exists(select 1 from jsonb_array_elements(docs) previous where previous->>'version_id'=v.id::text) then raise exception 'Duplicate request version' using errcode='22023';end if;
  docs:=docs||jsonb_build_array(jsonb_build_object('version_id',v.id,'category',category));
 end loop;
 return jsonb_build_object('teaching_units',units,'unit_minutes',unit_minutes,'instructions',coalesce(p_brief->>'instructions',''),'required_documents',required,'documents',docs);
end;$$;

commit;
