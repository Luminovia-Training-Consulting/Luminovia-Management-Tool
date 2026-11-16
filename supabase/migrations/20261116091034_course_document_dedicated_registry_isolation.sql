begin;
-- Optional private document domains retain their own authority even when a
-- historic course association exists. No earlier migration or generic file ACL
-- is changed; ordinary exact-version course shares remain independent of a
-- learner's permission to read the owner's personal document row.
create function private.course_document_is_dedicated(p_document uuid) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare name text; registry regclass; present boolean;
begin
 if p_document is null then return true;end if;
 foreach name in array array['private.support_attachments','private.website_enquiry_attachments','private.accounting_customer_invoices'] loop
  registry=to_regclass(name);
  if registry is not null then
   execute format('select exists(select 1 from %s where document_id=$1)',registry) into present using p_document;
   if present then return true;end if;
  end if;
 end loop;
 return false;
end;$$;

-- Always install this course-side boundary. Dynamic domain lookup works whether
-- each optional registry was installed before this migration or afterwards.
-- A document lock and a separate fresh lookup serialize with domain registration
-- RPCs/triggers that use the same document row. Removed course rows are retained.
create function private.guard_course_dedicated_document() returns trigger
language plpgsql security definer set search_path='' as $$
declare document uuid;
begin
 -- Permit withdrawing a legacy invalid share, while retaining its history.
 if tg_op='UPDATE' and new.version_id=old.version_id and new.removed_at is not null then return new;end if;
 select v.document_id into document from public.document_versions v where v.id=new.version_id;
 perform 1 from public.documents d where d.id=document for update;
 if not found then raise exception 'Course document unavailable' using errcode='42501';end if;
 perform 1 from public.document_versions v where v.id=new.version_id and v.document_id=document for share;
 if not found or private.course_document_is_dedicated(document) then
  raise exception 'Dedicated private document cannot be shared as a course resource' using errcode='42501';
 end if;
 return new;
end;$$;
create trigger guard_course_dedicated_document before insert or update of version_id,removed_at on private.course_resources
 for each row execute function private.guard_course_dedicated_document();
revoke all on function private.course_document_is_dedicated(uuid),private.guard_course_dedicated_document() from public,anon,authenticated,service_role;

-- Existing function OIDs, invoker wrappers and execute grants are preserved.
create or replace function private.course_resource_allowed(p_resource_id uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
declare r private.course_resources;c jsonb;
begin
 select * into r from private.course_resources where id=p_resource_id and removed_at is null;
 if not found then return false;end if;
 if private.course_document_is_dedicated((select v.document_id from public.document_versions v where v.id=r.version_id)) then return false;end if;
 begin c:=private.course_workspace_context(r.run_id);exception when insufficient_privilege then return false;end;
 return (c->>'staff')::boolean or r.audience='all' or (r.audience='client' and (c->>'client')::boolean) or (r.audience='participants' and (c->>'learner')::boolean);
end;$$;

create or replace function private.course_workspace(p_run_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c jsonb;r public.course_runs;quiz private.course_quiz_versions;ownfeedback private.course_feedback;notebook private.course_notebooks;completion private.course_completion_records;result jsonb;
begin
 c:=private.course_workspace_context(p_run_id);select * into r from public.course_runs where id=p_run_id;
 select v.* into quiz from private.course_quiz_versions v join private.course_quizzes q on q.run_id=v.run_id and q.version=v.version where v.run_id=p_run_id;
 select * into ownfeedback from private.course_feedback where run_id=p_run_id and user_id=auth.uid();
 select * into notebook from private.course_notebooks where run_id=p_run_id and user_id=auth.uid();
 select * into completion from private.course_completion_records where run_id=p_run_id and user_id=auth.uid() and revoked_at is null;
 select jsonb_build_object('id',r.id,'title',t.title,'description',t.description,'syllabus',t.syllabus,'time_zone',r.time_zone,'venue',r.venue,
 'delivery_type',r.delivery_type,'access',c,'settings_version',coalesce(settings.version,0),
 'ended',coalesce((select max(s.ends_at)<now() from public.course_sessions s where s.course_run_id=r.id),false),
 'contact',(select jsonb_build_object('name',oc.name,'email',oc.email,'phone',oc.phone) from public.organisation_contacts oc where oc.id=settings.contact_id and oc.organisation_id=r.organisation_id and oc.archived_at is null),
 'contact_options',case when (c->>'manager')::boolean then coalesce((select jsonb_agg(jsonb_build_object('id',oc.id,'name',oc.name)) from public.organisation_contacts oc where oc.organisation_id=r.organisation_id and oc.archived_at is null),'[]'::jsonb) else '[]'::jsonb end,
 'sessions',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'starts_at',s.starts_at,'ends_at',s.ends_at,'attendance',a.state,'minutes',a.minutes,'version',coalesce(a.version,0),'can_check_in',(c->>'learner')::boolean and a.state is null and now()>=s.starts_at-interval '15 minutes' and now()<=s.ends_at+interval '15 minutes','can_verify',(c->>'staff')::boolean and s.ends_at<=now()) order by s.starts_at),'[]') from public.course_sessions s left join private.course_attendance a on a.session_id=s.id and a.user_id=auth.uid() where s.course_run_id=r.id),
 'preparation',(select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'label',i.label,'done',i.done,'client_visible',i.client_visible,'version',i.version) order by i.id),'[]') from private.course_preparation_items i where i.run_id=r.id and ((c->>'staff')::boolean or ((c->>'client')::boolean and i.client_visible))),
 'resources',(select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'name',v.original_name,'version_id',v.id,'version',v.version,'sha256',v.sha256,'category',l.category,'audience',l.audience,'acknowledged',exists(select 1 from private.course_resource_acknowledgements a where a.resource_id=l.id and a.user_id=auth.uid())) order by l.created_at),'[]') from private.course_resources l join public.document_versions v on v.id=l.version_id join public.documents d on d.id=v.document_id where l.run_id=r.id and private.course_resource_allowed(l.id) and d.deleted_at is null and v.status='clean'),
 'share_options',case when (c->>'manager')::boolean then coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'name',v.original_name,'version',v.version)) from public.document_versions v join public.documents d on d.id=v.document_id where v.status='clean' and d.deleted_at is null and d.kind='material' and not private.course_document_is_dedicated(d.id) and ((d.scope='personal' and d.owner_id=auth.uid()) or exists(select 1 from public.jobs j where j.id=d.job_id and j.course_run_id=r.id))),'[]') else '[]'::jsonb end,
 'questions',(select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'body',q.body,'answer',q.answer,'version',q.version,'mine',q.author_id=auth.uid()) order by q.created_at),'[]') from private.course_questions q where q.run_id=r.id and ((c->>'staff')::boolean or (c->>'learner')::boolean)),
 'notebook',jsonb_build_object('body',coalesce(notebook.body,''),'version',coalesce(notebook.version,0)),
 'feedback',case when ownfeedback.user_id is null then null else jsonb_build_object('rating',ownfeedback.rating,'comment',ownfeedback.comment,'version',ownfeedback.version) end,
 'feedback_summary',case when (c->>'staff')::boolean or (c->>'client')::boolean then (select jsonb_build_object('count',count(*),'average',case when count(*)>=3 then round(avg(f.rating),2) end,'comments',case when count(*)>=3 then jsonb_agg(f.comment) filter(where f.comment<>'') else '[]'::jsonb end) from private.course_feedback f where f.run_id=r.id) end,
 'quiz',case when quiz.version is null or (not quiz.published and not (c->>'staff')::boolean) then null else jsonb_build_object('version',quiz.version,'published',quiz.published,'pass_percent',quiz.pass_percent,'max_attempts',quiz.max_attempts,
 'questions',case when (c->>'staff')::boolean then quiz.questions else (select jsonb_agg(q-'correct') from jsonb_array_elements(quiz.questions)q) end,
 'attempts',(select count(*) from private.course_quiz_attempts a where a.run_id=r.id and a.quiz_version=quiz.version and a.user_id=auth.uid()),
 'passed',exists(select 1 from private.course_quiz_attempts a where a.run_id=r.id and a.quiz_version=quiz.version and a.user_id=auth.uid() and a.passed),
 'last_score',(select a.score from private.course_quiz_attempts a where a.run_id=r.id and a.quiz_version=quiz.version and a.user_id=auth.uid() order by a.created_at desc limit 1)) end,
 'completion',case when completion.id is null then null else jsonb_build_object('id',completion.id,'created_at',completion.created_at) end,
 'repeat_request',case when (c->>'client')::boolean then (select jsonb_build_object('id',request.id,'sessions',request.payload->'sessions') from private.client_course_requests request join public.jobs j on j.id=request.job_id where j.course_run_id=r.id and request.organisation_id=r.organisation_id order by request.created_at limit 1) end,
 'attendance_history',case when (c->>'staff')::boolean then coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'user_id',a.user_id,'session_id',a.session_id,'reason',a.reason,'old_state',a.old_state,'new_state',a.new_state,'created_at',a.created_at) order by a.created_at desc) from private.course_attendance_audit a join public.course_sessions s on s.id=a.session_id where s.course_run_id=r.id),'[]') else '[]'::jsonb end,
 'roster',case when (c->>'staff')::boolean or (c->>'client')::boolean then coalesce((select jsonb_agg(jsonb_build_object('user_id',e.user_id,'name',p.display_name,'status',e.status,'completion_id',(select cr.id from private.course_completion_records cr where cr.run_id=r.id and cr.user_id=e.user_id and cr.revoked_at is null),'sessions',(select coalesce(jsonb_agg(jsonb_build_object('session_id',s.id,'state',a.state,'minutes',a.minutes,'version',coalesce(a.version,0)) order by s.starts_at),'[]') from public.course_sessions s left join private.course_attendance a on a.session_id=s.id and a.user_id=e.user_id where s.course_run_id=r.id))) from public.course_enrolments e join public.profiles p on p.id=e.user_id where e.course_run_id=r.id and e.status in('enrolled','completed')),'[]') else '[]'::jsonb end)
 into result from public.course_templates t left join private.course_workspace_settings settings on settings.run_id=r.id where t.id=r.template_id;
 return result;
end;$$;

-- The action body below retains the latest strict-lint fixes from55929.
create or replace function private.course_workspace_action(p_run_id uuid,p_action text,p_payload jsonb,p_expected_version integer default 0) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c jsonb;target uuid;item private.course_preparation_items;setting private.course_workspace_settings;note private.course_notebooks;
 feedback private.course_feedback;attendance private.course_attendance;session public.course_sessions;
 quiz private.course_quiz_versions;attempt private.course_quiz_attempts;v integer;answers jsonb;correct integer:=0;score integer;
 rowitem jsonb;record private.course_completion_records;facts jsonb;v_document_version uuid;resource_document uuid;user_target uuid;state text;minutes integer;reason text;
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
  -- Lock current role authority before the shared document/then-version order.
  perform 1 from public.profiles where id=auth.uid() and active for share;
  if not found or not private.has_permission('courses.manage') then raise exception 'Course management required' using errcode='42501';end if;
  v_document_version:=(p_payload->>'version_id')::uuid;
  select v.document_id into resource_document from public.document_versions v where v.id=v_document_version;
  perform 1 from public.documents d where d.id=resource_document for update;
  if not found then raise exception 'Course document unavailable' using errcode='42501';end if;
  perform 1 from public.document_versions v where v.id=v_document_version and v.document_id=resource_document for share;
  if not found then raise exception 'Course document unavailable' using errcode='42501';end if;
  -- This fresh statement follows any document-lock wait; a committed private
  -- registration must be visible before creating or renewing a course share.
  c=private.course_workspace_context(p_run_id);
  if not private.has_permission('courses.manage') or private.course_document_is_dedicated(resource_document) then
   raise exception 'Dedicated private document cannot be shared as a course resource' using errcode='42501';end if;
  if not exists(select 1 from public.document_versions v join public.documents d on d.id=v.document_id where v.id=v_document_version and v.document_id=resource_document and v.status='clean' and v.sha256 is not null and d.deleted_at is null and d.kind='material' and ((d.scope='personal' and d.owner_id=auth.uid()) or exists(select 1 from public.jobs j where j.id=d.job_id and j.course_run_id=p_run_id))) then raise exception 'Own clean material or this course job material required' using errcode='42501';end if;
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

create or replace function private.course_document_access(p_kind text,p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare link private.course_resources;record private.course_completion_records;c jsonb;
begin
 if not private.actor_active() then raise exception 'Active account required' using errcode='42501';end if;
 if p_kind='resource' then
  select * into link from private.course_resources where id=p_id;
  if not found or not private.course_resource_allowed(p_id) then raise exception 'Course resource unavailable' using errcode='42501';end if;
  return (select jsonb_build_object('id',v.id,'document_id',d.id,'object_path',v.object_path,'name',v.original_name,'mime_type',v.mime_type,'sha256',v.sha256) from public.document_versions v join public.documents d on d.id=v.document_id where v.id=link.version_id and v.status='clean' and d.deleted_at is null and not private.course_document_is_dedicated(d.id));
 elsif p_kind='completion' then
  select * into record from private.course_completion_records where id=p_id and revoked_at is null;
  if not found then raise exception 'Completion unavailable' using errcode='42501';end if;
  c:=private.course_workspace_context(record.run_id);
  if record.user_id<>auth.uid() and not(c->>'staff')::boolean and not(c->>'client')::boolean then raise exception 'Completion unavailable' using errcode='42501';end if;
  return record.snapshot||jsonb_build_object('id',record.id,'issued_at',record.created_at);
 elsif p_kind='attendance' then
  c:=private.course_workspace_context(p_id);
  if not(c->>'staff')::boolean and not(c->>'client')::boolean then raise exception 'Course attendance report unavailable' using errcode='42501';end if;
  return jsonb_build_object('id',p_id,'course',(select t.title from public.course_runs r join public.course_templates t on t.id=r.template_id where r.id=p_id),'roster',private.course_workspace(p_id)->'roster','sessions',private.course_workspace(p_id)->'sessions');
 end if;
 raise exception 'Unknown document kind' using errcode='22023';
end;$$;
commit;
