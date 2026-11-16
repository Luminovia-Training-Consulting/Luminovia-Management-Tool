begin;
-- Forward-only integration: no historical notification replay or copied content.
-- Recheck current course membership/audience before resolving any title or link.
create function private.course_notification_target(p_kind text,p_resource uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare run_id uuid; heading text; context jsonb; item private.course_preparation_items; question private.course_questions; completion private.course_completion_records;
begin
 if not private.actor_active() then return jsonb_build_object('href',null,'title','');end if;
 if p_kind='course_preparation_updated' then
  select * into item from private.course_preparation_items where id=p_resource;
  run_id=item.run_id;
 elsif p_kind in('course_question','course_answer') then
  select * into question from private.course_questions where id=p_resource;run_id=question.run_id;
 elsif p_kind='course_resource_shared' then
  select r.run_id into run_id from private.course_resources r where r.id=p_resource and private.course_resource_allowed(r.id);
 elsif p_kind='course_quiz_published' then
  select q.run_id into run_id from private.course_quizzes q join private.course_quiz_versions v on v.run_id=q.run_id and v.version=q.version where q.run_id=p_resource and v.published;
 elsif p_kind in('course_completion_issued','course_completion_revoked') then
  select * into completion from private.course_completion_records r where r.id=p_resource and r.user_id=auth.uid();run_id=completion.run_id;
 elsif p_kind='course_attendance_updated' then
  select s.course_run_id into run_id from public.course_sessions s join private.course_attendance a on a.session_id=s.id and a.user_id=auth.uid() where s.id=p_resource;
 end if;
 if run_id is null then return jsonb_build_object('href',null,'title','');end if;
 begin context=private.course_workspace_context(run_id);exception when insufficient_privilege then return jsonb_build_object('href',null,'title','');end;
 if (p_kind='course_preparation_updated' and not ((context->>'staff')::boolean or item.client_visible and (context->>'client')::boolean))
 or(p_kind='course_question' and not(context->>'staff')::boolean)
 or(p_kind='course_answer' and question.author_id<>auth.uid())
 or(p_kind='course_quiz_published' and not(context->>'learner')::boolean) then return jsonb_build_object('href',null,'title','');end if;
 select t.title into heading from public.course_runs r join public.course_templates t on t.id=r.template_id where r.id=run_id;
 return jsonb_build_object('title',coalesce(heading,''),'href','/courses/'||run_id||'/workspace');
end;$$;
-- Combine existing claim/chat/contract routes with current course/task/time rights.
create or replace function private.notification_target(p_kind text,p_resource uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare target uuid; heading text; path text;
begin
 if p_kind in('task_assigned','task_due') then
  select t.id,t.title into target,heading from private.work_tasks t where t.id=p_resource and private.can_read_work_task(t.id);
  if found then path='/workbench?task='||target;end if;
 elsif p_kind='timesheet_reviewed' then
  return coalesce(private.timesheet_notification_target(p_resource),jsonb_build_object('href',null,'title',''));
 elsif p_kind like 'course_%' then
  return private.course_notification_target(p_kind,p_resource);
 elsif p_kind='qualification_expiring' then
  select t.id,case when p.locale='en' then t.label_en else t.label_de end into target,heading
   from public.lecturer_topics l join public.topics t on t.id=l.topic_id join public.profiles p on p.id=l.user_id
   where l.user_id=auth.uid() and t.id=p_resource and l.verified and l.valid_until>now() and l.valid_until<=now()+interval '30 days';
  if found then path='/people/'||auth.uid();end if;
 elsif p_kind='job_waitlist_available' then
  select j.id,j.title into target,heading from public.jobs j join private.job_waitlist w on w.job_id=j.id
   where j.id=p_resource and w.user_id=auth.uid() and j.status='published' and private.can_read_job(j.id);
  if found then path='/jobs/'||target;end if;
 elsif p_kind in('substitution_proposed','substitution_closed') then
  select s.id,s.quote->>'title' into target,heading from private.job_substitutions s join public.job_claims c on c.id=s.original_claim_id
   where s.id=p_resource and (s.target_user_id=auth.uid() or s.proposed_by=auth.uid() or c.lecturer_id=auth.uid() or private.has_permission('jobs.manage'))
   and (p_kind='substitution_closed' or (s.status='pending' and s.expires_at>now()));
  if found then path='/jobs?substitution='||target;end if;
 elsif p_kind in ('claim_confirmed','claim_cancelled') then
  select j.id,j.title into target,heading from public.job_claims c join public.jobs j on j.id=c.job_id
   where c.id=p_resource and c.lecturer_id=auth.uid() and private.can_read_job(j.id);
  if found then path='/jobs/'||target; end if;
 elsif p_kind in ('job_reopened','job_matching') then
  select j.id,j.title into target,heading from public.jobs j where j.id=p_resource and private.can_read_job(j.id);
  if found then path='/jobs/'||target; end if;
 elsif p_kind='chat_message' then
  select r.id,r.title into target,heading from public.messages m join public.chat_rooms r on r.id=m.room_id
   where m.id=p_resource and m.deleted_at is null and private.can_access_chat_room(r.id);
  if found then path='/chats?room='||target; end if;
 elsif p_kind='forum_reply' then
  select t.id,t.title into target,heading from public.forum_threads t where t.id=p_resource and private.can_read_forum(t.id);
  if found then path='/forum?thread='||target; end if;
 elsif p_kind='session_reminder' then
  select j.id,j.title into target,heading from public.assignment_sessions s join public.job_claims c on c.id=s.claim_id
   join public.jobs j on j.id=c.job_id where s.id=p_resource and c.lecturer_id=auth.uid()
   and c.status='confirmed' and s.released_at is null and private.can_read_job(j.id);
  if found then path='/jobs/'||target; end if;
 elsif p_kind in ('contract_available','contract_expiring') then
  select c.id,c.title into target,heading from public.contracts c where c.id=p_resource and c.user_id=auth.uid();
  if found then path='/contracts'; end if;
 end if;
 return jsonb_build_object('href',path,'title',coalesce(heading,''));
end;$$;

-- External channel categories also recheck optional preferences at dispatch.
create or replace function private.email_category_enabled(p_user uuid,p_kind text) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select case
 when p_kind in('chat_message','course_question','course_answer') then p.chat
 when p_kind='forum_reply' then p.forum
 when p_kind in('job_reopened','job_matching','job_waitlist_available','course_preparation_updated','course_resource_shared','course_quiz_published') then p.job_updates
 when p_kind in('session_reminder','contract_expiring','qualification_expiring','task_assigned','task_due','timesheet_reviewed','course_attendance_updated','course_completion_issued','course_completion_revoked') then p.reminders
 else p_kind in('claim_confirmed','claim_cancelled','contract_available','substitution_proposed','substitution_closed') end
 from private.notification_preferences p where p.user_id=p_user),false);
$$;
create or replace function private.filter_optional_notification() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 -- Receipts survive opt-out in the inbox; optional external channels still
 -- apply their category at both queue and dispatch time.
 if new.kind in('claim_confirmed','claim_cancelled','contract_available','substitution_proposed','substitution_closed','task_assigned','timesheet_reviewed','course_attendance_updated','course_completion_issued','course_completion_revoked') then return new;end if;
 if new.kind in('chat_message','forum_reply','job_reopened','job_matching','job_waitlist_available','session_reminder','contract_expiring','qualification_expiring','task_due','course_preparation_updated','course_resource_shared','course_quiz_published','course_question','course_answer') and not private.email_category_enabled(new.user_id,new.kind) then return null;end if;
 return new;
end;$$;

-- Only fixed server workflows call this inaccessible helper. Recipient IDs
-- originate in the committed queue, never browser claims/payloads. Use aal1 so
-- an email worker cannot manufacture the recipient's MFA or manager access.
create function private.notification_delivery_allowed(p_user uuid,p_kind text,p_resource uuid) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare previous_claims text:=current_setting('request.jwt.claims',true);
 previous_sub text:=current_setting('request.jwt.claim.sub',true);result boolean:=false;
begin
 if not exists(select 1 from public.profiles where id=p_user and active) then return false;end if;
 if p_kind in('claim_confirmed','claim_cancelled','contract_available') then return true;end if;
 if p_kind='substitution_closed' then return exists(select 1 from private.job_substitutions s join public.job_claims c on c.id=s.original_claim_id where s.id=p_resource and p_user in(s.target_user_id,s.proposed_by,c.lecturer_id));end if;
 -- Supabase auth.uid() can prefer the legacy per-claim GUC. Bind both
 -- forms to this exact queued recipient and restore both before returning.
 perform set_config('request.jwt.claim.sub',p_user::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_user,'role','authenticated','aal','aal1')::text,true);
 begin
  result=(private.notification_target(p_kind,p_resource)->>'href') is not null;
 exception when insufficient_privilege then result=false;
 end;
 perform set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
 perform set_config('request.jwt.claims',coalesce(previous_claims,''),true);
 return result;
exception when others then
 perform set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
 perform set_config('request.jwt.claims',coalesce(previous_claims,''),true);
 raise;
end;$$;

-- Fresh own reminders are deduplicated by notification identity. Limit all
-- scheduled sources together to at most 1,000 inserts/account/scan.
create function private.generate_due_work_notifications(p_user uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare added integer;total integer:=0;
begin
 if not exists(select 1 from public.profiles p join private.notification_preferences n on n.user_id=p.id where p.id=p_user and p.active and n.reminders) then return 0;end if;
 insert into public.notifications(user_id,kind,resource_id)
 select p_user,'task_due',t.id from private.work_tasks t where t.assignee_id=p_user and t.state in('open','doing')
  and t.due_at>=now()-interval '7 days' and t.due_at<=now()+interval '24 hours'
  and private.notification_delivery_allowed(p_user,'task_due',t.id)
 order by t.due_at,t.id limit 500 on conflict do nothing;
 get diagnostics added=row_count;total=total+added;
 insert into public.notifications(user_id,kind,resource_id)
 select p_user,'qualification_expiring',l.topic_id from public.lecturer_topics l where l.user_id=p_user and l.verified and l.valid_until>now() and l.valid_until<=now()+interval '30 days'
 order by l.valid_until,l.topic_id limit 100 on conflict do nothing;
 get diagnostics added=row_count;return total+added;
end;$$;
create or replace function private.refresh_notification_reminders(p_limit integer default 100) returns integer
language plpgsql security definer set search_path='' as $$
declare account_id uuid; added integer; total integer:=0;
begin
 perform private.require_email_worker();
 if p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid reminder batch size' using errcode='22023'; end if;
 for account_id in select d.user_id from private.delivery_preferences d
  join public.profiles p on p.id=d.user_id join private.notification_preferences n on n.user_id=d.user_id
  where d.email_enabled and p.active and n.reminders
   and (d.last_reminder_scan_at is null or d.last_reminder_scan_at<=now()-interval '15 minutes')
  order by d.last_reminder_scan_at nulls first,d.user_id for update of d skip locked limit p_limit
 loop
  insert into public.notifications(user_id,kind,resource_id)
  select account_id,'session_reminder',s.id from public.assignment_sessions s join public.job_claims c on c.id=s.claim_id
   where c.lecturer_id=account_id and c.status='confirmed' and s.released_at is null
    and s.starts_at>now() and s.starts_at<=now()+interval '24 hours'
   order by s.starts_at limit 200 on conflict do nothing;
  get diagnostics added=row_count;total=total+added;
  insert into public.notifications(user_id,kind,resource_id)
  select account_id,'contract_expiring',c.id from public.contracts c
   where c.user_id=account_id and c.status='active' and c.revoked_at is null
    and c.effective_from<=now() and c.expires_at>now() and c.expires_at<=now()+interval '30 days'
   order by c.expires_at limit 200 on conflict do nothing;
  get diagnostics added=row_count;total=total+added;
  total=total+private.generate_due_work_notifications(account_id);
  update private.delivery_preferences set last_reminder_scan_at=now() where user_id=account_id;
 end loop;
 return total;
end;$$;
create or replace function private.prepare_notification_email(p_id uuid,p_lease_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o private.notification_email_outbox; n public.notifications; d private.delivery_preferences;
 recipient text; lang text; active_account boolean; defer_until timestamptz;
begin
 perform private.require_email_worker();
 select * into o from private.notification_email_outbox where id=p_id for update;
 if not found or o.state<>'leased' or o.lease_token is distinct from p_lease_token or o.lease_until<=now() then return null; end if;
 select * into n from public.notifications where id=o.notification_id;
 select * into d from private.delivery_preferences where user_id=n.user_id;
 select u.email,p.locale,p.active into recipient,lang,active_account from public.profiles p
  join auth.users u on u.id=p.id where p.id=n.user_id;
 if not coalesce(active_account,false) or not coalesce(d.email_enabled,false)
 or not private.email_category_enabled(n.user_id,n.kind) or not private.notification_delivery_allowed(n.user_id,n.kind,n.resource_id) or recipient is null
 or recipient!~'^[^[:space:]<>@,;]+@[^[:space:]<>@,;]+\.[^[:space:]<>@,;]+$'
 or length(recipient)>254
 or (n.kind='session_reminder' and not exists(select 1 from public.assignment_sessions s
  join public.job_claims c on c.id=s.claim_id where s.id=n.resource_id and c.lecturer_id=n.user_id
   and c.status='confirmed' and s.released_at is null and s.starts_at>now()))
 or (n.kind='contract_expiring' and not exists(select 1 from public.contracts c
  where c.id=n.resource_id and c.user_id=n.user_id and c.status='active' and c.revoked_at is null
   and c.effective_from<=now() and c.expires_at>now() and c.expires_at<=now()+interval '30 days'))
 or (n.kind='chat_message' and not exists(select 1 from public.messages m
  join public.chat_members member on member.room_id=m.room_id and member.user_id=n.user_id
  where m.id=n.resource_id and m.deleted_at is null and member.removed_at is null and not member.muted))
 or (n.kind in ('job_matching','job_reopened') and not exists(select 1 from public.jobs j
  where j.id=n.resource_id and j.status='published' and (j.claim_deadline is null or j.claim_deadline>now()))) then
  update private.notification_email_outbox set state='suppressed',finished_at=now(),lease_until=null,
   error_code='recipient_or_preferences_changed' where id=o.id;
  return null;
 end if;
 defer_until=private.email_quiet_until(d.time_zone,d.quiet_start,d.quiet_end,now());
 if defer_until is not null then
  update private.notification_email_outbox set state='pending',available_at=defer_until,lease_until=null,
   attempts=greatest(0,attempts-1),error_code='quiet_hours' where id=o.id;
  return null;
 end if;
 update private.notification_email_outbox set state='sending',lease_until=now()+interval '5 minutes',error_code=null where id=o.id;
 return jsonb_build_object('id',o.id,'lease_token',o.lease_token,'recipient',recipient,'locale',lang,'kind',n.kind,
  'message_id','<luminovia-notification.'||o.id||'@luminovia.org>');
end;$$;
create or replace function private.refresh_push_reminders(p_limit integer default 100) returns integer language plpgsql security definer set search_path='' as $$
declare account_id uuid;added integer;total integer:=0;
begin
 perform private.require_email_worker();
 if p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid reminder batch' using errcode='22023';end if;
 if not (select enabled from private.push_configuration) then return 0;end if;
 for account_id in select p.id from public.profiles p join private.notification_preferences n on n.user_id=p.id
 where p.active and n.reminders and exists(select 1 from private.push_subscriptions s where s.user_id=p.id and s.active and s.expires_at>now() and (s.last_reminder_scan_at is null or s.last_reminder_scan_at<=now()-interval '15 minutes')) order by p.id limit p_limit
 loop
  perform 1 from private.push_subscriptions s where s.user_id=account_id and s.active for update skip locked;
  insert into public.notifications(user_id,kind,resource_id)
  select account_id,'session_reminder',s.id from public.assignment_sessions s join public.job_claims c on c.id=s.claim_id
  where c.lecturer_id=account_id and c.status='confirmed' and s.released_at is null and s.starts_at>now() and s.starts_at<=now()+interval '24 hours'
  order by s.starts_at limit 200 on conflict do nothing;
  get diagnostics added=row_count;total=total+added;
  insert into public.notifications(user_id,kind,resource_id)
  select account_id,'contract_expiring',c.id from public.contracts c where c.user_id=account_id and c.status='active' and c.revoked_at is null and c.effective_from<=now() and c.expires_at>now() and c.expires_at<=now()+interval '30 days'
  order by c.expires_at limit 200 on conflict do nothing;
  get diagnostics added=row_count;total=total+added;
  total=total+private.generate_due_work_notifications(account_id);
  update private.push_subscriptions set last_reminder_scan_at=now() where user_id=account_id;
 end loop;return total;
end;$$;
create or replace function private.prepare_notification_push(p_id uuid,p_lease_token uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare o private.notification_push_outbox;s private.push_subscriptions;n public.notifications;d private.delivery_preferences;lang text;defer_until timestamptz;
begin
 perform private.require_email_worker();select * into o from private.notification_push_outbox where id=p_id for update;
 if not found or o.state<>'leased' or o.lease_token is distinct from p_lease_token or o.lease_until<=now() then return null;end if;
 select * into s from private.push_subscriptions where id=o.subscription_id;select * into n from public.notifications where id=o.notification_id;
 select * into d from private.delivery_preferences where user_id=s.user_id;select locale into lang from public.profiles where id=s.user_id and active;
 if lang is null or not s.active or s.expires_at<=now() or not (select enabled from private.push_configuration)
 or not private.email_category_enabled(s.user_id,n.kind) or not private.valid_push_endpoint(s.endpoint) or not private.notification_delivery_allowed(n.user_id,n.kind,n.resource_id)
 or (n.kind='session_reminder' and not exists(select 1 from public.assignment_sessions a join public.job_claims c on c.id=a.claim_id where a.id=n.resource_id and c.lecturer_id=n.user_id and c.status='confirmed' and a.released_at is null and a.starts_at>now()))
 or (n.kind='contract_expiring' and not exists(select 1 from public.contracts c where c.id=n.resource_id and c.user_id=n.user_id and c.status='active' and c.revoked_at is null and c.effective_from<=now() and c.expires_at>now() and c.expires_at<=now()+interval '30 days'))
 or (n.kind='chat_message' and not exists(select 1 from public.messages m join public.chat_members member on member.room_id=m.room_id and member.user_id=n.user_id where m.id=n.resource_id and m.deleted_at is null and member.removed_at is null and not member.muted))
 or (n.kind in('job_matching','job_reopened') and not exists(select 1 from public.jobs j where j.id=n.resource_id and j.status='published' and (j.claim_deadline is null or j.claim_deadline>now()))) then
 update private.notification_push_outbox set state='suppressed',finished_at=now(),lease_until=null where id=o.id;return null;end if;
 defer_until=private.email_quiet_until(d.time_zone,d.quiet_start,d.quiet_end,now());
 if defer_until is not null then update private.notification_push_outbox set state='pending',available_at=defer_until,lease_until=null,attempts=greatest(0,attempts-1) where id=o.id;return null;end if;
 update private.notification_push_outbox set state='sending',lease_until=now()+interval '5 minutes' where id=o.id;
 return jsonb_build_object('id',o.id,'lease_token',o.lease_token,'device_token',s.device_token,'locale',lang,
 'subscription',jsonb_build_object('endpoint',s.endpoint,'keys',jsonb_build_object('p256dh',s.p256dh,'auth',s.auth_secret)));
end;$$;
create or replace function private.refresh_my_notifications() returns integer
language plpgsql security definer set search_path='' as $$
declare p private.notification_preferences; added integer; total integer:=0;
begin
 if not private.actor_active() then raise exception 'Account inactive' using errcode='42501'; end if;
 select * into p from private.notification_preferences where user_id=auth.uid() for update;
 if p.last_refresh_at>now()-interval '1 minute' then return 0; end if;
 insert into public.notifications(user_id,kind,resource_id)
 select auth.uid(),'session_reminder',s.id from public.assignment_sessions s join public.job_claims c on c.id=s.claim_id
 where c.lecturer_id=auth.uid() and c.status='confirmed' and s.released_at is null and s.starts_at>now() and s.starts_at<=now()+interval '24 hours'
 order by s.starts_at limit 200 on conflict do nothing;
 get diagnostics added=row_count;total=total+added;
 insert into public.notifications(user_id,kind,resource_id)
 select auth.uid(),'contract_expiring',c.id from public.contracts c where c.user_id=auth.uid() and c.status='active'
  and c.revoked_at is null and c.effective_from<=now() and c.expires_at>now() and c.expires_at<=now()+interval '30 days'
 order by c.expires_at limit 200 on conflict do nothing;
 get diagnostics added=row_count;total=total+added;
 total=total+private.generate_due_work_notifications(auth.uid());
 update private.notification_preferences set last_refresh_at=now() where user_id=auth.uid();
 return total;
end;$$;
-- Only real committed table changes fan out. Notebook/feedback bodies never
-- create notifications, and existing course history is deliberately untouched.
create function private.notify_course_workspace_change() returns trigger
language plpgsql security definer set search_path='' as $$
declare run_id uuid;event_kind text;resource uuid;recipient uuid;only_user uuid;allow_clients boolean:=false;allow_learners boolean:=false;allow_staff boolean:=false;
begin
 if tg_table_name='course_preparation_items' then
  if tg_op='INSERT' or new.done is not distinct from old.done then return new;end if;
  run_id=new.run_id;event_kind='course_preparation_updated';resource=new.id;allow_clients=new.client_visible;allow_staff=true;
 elsif tg_table_name='course_questions' then
  if tg_op='UPDATE' and new.answer is not distinct from old.answer then return new;end if;
  run_id=new.run_id;resource=new.id;
  if tg_op='INSERT' then event_kind='course_question';allow_staff=true;else event_kind='course_answer';only_user=new.author_id;end if;
 elsif tg_table_name='course_resources' then
  if new.removed_at is not null or (tg_op='UPDATE' and old.removed_at is null) then return new;end if;
  run_id=new.run_id;event_kind='course_resource_shared';resource=new.id;allow_staff=true;
  allow_clients=new.audience in('client','all');allow_learners=new.audience in('participants','all');
 elsif tg_table_name='course_quiz_versions' then
  -- The public action advances the header BEFORE inserting this immutable
  -- revision. A header trigger would observe no version and lose the event.
  if not new.published or not exists(select 1 from private.course_quizzes q where q.run_id=new.run_id and q.version=new.version) then return new;end if;
  run_id=new.run_id;event_kind='course_quiz_published';resource=new.run_id;allow_learners=true;
 elsif tg_table_name='course_attendance' then
  if tg_op='UPDATE' and new.state is not distinct from old.state and new.minutes is not distinct from old.minutes then return new;end if;
  select s.course_run_id into run_id from public.course_sessions s where s.id=new.session_id;
  event_kind='course_attendance_updated';resource=new.session_id;only_user=new.user_id;
 elsif tg_table_name='course_completion_records' then
  if tg_op='UPDATE' and new.revoked_at is not distinct from old.revoked_at then return new;end if;
  run_id=new.run_id;event_kind=case when new.revoked_at is null then 'course_completion_issued' else 'course_completion_revoked' end;resource=new.id;only_user=new.user_id;
 end if;
 if run_id is null then return new;end if;
 for recipient in
 select p.id from (
  select only_user user_id where only_user is not null
  union select e.user_id from public.course_enrolments e where allow_learners and e.course_run_id=run_id and e.status in('enrolled','completed')
  union select c.lecturer_id from public.job_claims c join public.jobs j on j.id=c.job_id where allow_staff and j.course_run_id=run_id and c.status='confirmed' and private.lecturer_user(c.lecturer_id)
  union select m.user_id from public.course_runs r join public.client_organisation_memberships m on m.organisation_id=r.organisation_id join public.user_roles role on role.user_id=m.user_id and role.role='client' where allow_clients and r.id=run_id and m.removed_at is null
 ) candidates join public.profiles p on p.id=candidates.user_id
 where p.active and p.id is distinct from auth.uid()
 loop
  insert into public.notifications(user_id,kind,resource_id) values(recipient,event_kind,resource)
  on conflict(user_id,kind,resource_id) do update set created_at=clock_timestamp(),read_at=null;
 end loop;return new;
end;$$;
create trigger notify_preparation_change after update on private.course_preparation_items for each row execute function private.notify_course_workspace_change();
create trigger notify_question_change after insert or update on private.course_questions for each row execute function private.notify_course_workspace_change();
create trigger notify_course_resource after insert or update of removed_at on private.course_resources for each row execute function private.notify_course_workspace_change();
create trigger notify_course_quiz after insert on private.course_quiz_versions for each row execute function private.notify_course_workspace_change();
create trigger notify_course_attendance after insert or update on private.course_attendance for each row execute function private.notify_course_workspace_change();
create trigger notify_course_completion after insert or update on private.course_completion_records for each row execute function private.notify_course_workspace_change();
revoke all on function private.course_notification_target(text,uuid),private.notification_delivery_allowed(uuid,text,uuid),private.generate_due_work_notifications(uuid),private.notify_course_workspace_change() from public,anon,authenticated,service_role;
commit;
