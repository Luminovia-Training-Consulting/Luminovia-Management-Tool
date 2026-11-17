begin;

-- MFA is intentionally absent from this portal. Identity activation and live role
-- permissions remain authoritative; only assurance gates are removed.
-- The onboarding route list no longer contains the MFA setup step. Move any
-- saved progress to the adjacent profile step and bump its optimistic version.
update private.welcome_progress
 set step='profile',version=version+1,updated_at=clock_timestamp()
 where step='security';

alter table private.welcome_progress drop constraint welcome_progress_step_check;
alter table private.welcome_progress add constraint welcome_progress_step_check
 check(step in ('welcome','profile','jobs','availability','client','calendar','collaboration','files','contracts','notifications','administration','finish'));

-- Reject the removed step explicitly instead of allowing it to fail later at the table constraint.
create or replace function private.save_welcome_progress(p_step text,p_status text,p_expected_version integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare saved integer;
begin
 if auth.uid() is null or not private.actor_active() then raise exception 'Active account required' using errcode='42501';end if;
 if p_expected_version is null or p_expected_version<0 or p_expected_version>=2147483647
 or p_step is null or p_step not in ('welcome','profile','jobs','availability','client','calendar','collaboration','files','contracts','notifications','administration','finish')
 or p_status is null or p_status not in ('active','paused','completed','skipped') then
  raise exception 'Invalid welcome progress' using errcode='22023';
 end if;
 if p_expected_version=0 then
  insert into private.welcome_progress(user_id,step,status,version) values(auth.uid(),p_step,p_status,1)
   on conflict(user_id) do nothing returning version into saved;
 else
  update private.welcome_progress set step=p_step,status=p_status,version=version+1,updated_at=now()
   where user_id=auth.uid() and version=p_expected_version returning version into saved;
 end if;
 if saved is null then raise exception 'Welcome progress changed; reload current version' using errcode='40001';end if;
 return private.get_welcome_progress();
end;$$;

create or replace function private.has_permission(p_permission text) returns boolean language sql stable security definer set search_path='' as $$
 select private.actor_active()
 and exists(select 1 from public.user_roles ur join public.role_permissions rp on rp.role=ur.role where ur.user_id=auth.uid() and rp.permission=p_permission);
$$;

create or replace function private.account_me() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not private.actor_active() then raise exception 'Active login required' using errcode='42501'; end if;
 select to_jsonb(p)||jsonb_build_object('email',(select u.email from auth.users u where u.id=auth.uid())) into result from public.profiles p where p.id=auth.uid();
 return jsonb_build_object('profile',result,'roles',coalesce((select jsonb_agg(role order by role) from public.user_roles where user_id=auth.uid()),'[]'::jsonb),'permissions',coalesce((select jsonb_agg(rp.permission order by rp.permission) from (select distinct permission from public.role_permissions rp join public.user_roles ur on ur.role=rp.role where ur.user_id=auth.uid()) rp),'[]'::jsonb));
end;$$;

create or replace function private.deletion_authorized(p_kind text,p_id uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
begin
 if not private.actor_active() or not (private.deletion_registry()?p_kind) then return false;end if;
 if p_kind='account' then return private.account_target_manageable(p_id);end if;
 if p_kind='personal_event' then return exists(select 1 from public.personal_events where id=p_id and user_id=auth.uid());end if;
 if p_kind='availability' then return exists(select 1 from public.lecturer_availability where id=p_id and user_id=auth.uid());end if;
 if p_kind='saved_job_view' then return exists(select 1 from private.saved_job_views where id=p_id and user_id=auth.uid());end if;
 if p_kind='contract' then return private.has_permission('contracts.manage') and exists(select 1 from public.contracts where id=p_id and (user_id=auth.uid() or private.has_permission('contracts.read')));end if;
 if p_kind='invoice' then return private.has_permission('finance.manage') and private.can_read_invoice(p_id);end if;
 if p_kind='payment' then return private.has_permission('finance.manage') and exists(select 1 from public.payment_records where id=p_id and private.can_read_invoice(invoice_id));end if;
 if p_kind='chat_room' then return exists(select 1 from public.chat_rooms r where r.id=p_id and private.can_access_chat_room(r.id) and (r.owner_id=auth.uid() or (r.kind in('participant_course','lecturer_course') and private.has_permission('courses.manage'))));end if;
 if p_kind='message' then return exists(select 1 from public.messages m join public.chat_rooms r on r.id=m.room_id where m.id=p_id and private.can_access_chat_room(r.id) and (m.sender_id=auth.uid() or (r.kind<>'dm' and (r.owner_id=auth.uid() or private.has_permission('chat.moderate')))));end if;
 -- Private documents and room attachments never inherit administrator-wide
 -- deletion rights. Owners retain their own control; administrators may
 -- manage only job-scoped materials they are currently authorised to read.
 if p_kind='document' then return exists(select 1 from public.documents d where d.id=p_id and (d.owner_id=auth.uid() or (d.scope in('job_before','job_after') and private.deletion_admin(auth.uid()) and private.has_permission('jobs.manage') and private.can_access_document(d.id))));end if;
 if private.deletion_admin(auth.uid()) then return true;end if;
 if p_kind='job' then return private.deletion_can_manage_job(p_id);end if;
 return false;
end;$$;

create or replace function private.deletion_access() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare kinds jsonb:='[]'::jsonb;manager boolean:=private.has_permission('users.manage') and private.deletion_admin(auth.uid());
begin
 if not private.actor_active() then raise exception 'Active login required' using errcode='42501';end if;
  if manager then select jsonb_agg(key order by key) into kinds from jsonb_object_keys(private.deletion_registry()) key;
 else
  kinds='["document","personal_event","availability","saved_job_view","message","chat_room"]'::jsonb;
  if private.has_permission('users.roles.manage') then kinds=kinds||'"account"'::jsonb;end if;
  if private.has_permission('contracts.manage') then kinds=kinds||'"contract"'::jsonb;end if;
  if private.has_permission('finance.manage') then kinds=kinds||'["invoice","payment"]'::jsonb;end if;
  if private.has_role(array['client']) then kinds=kinds||'"job"'::jsonb;end if;
 end if;
 return jsonb_build_object('can_admin',manager,'kinds',kinds);
end;$$;

create or replace function private.deletion_preview(p_kind text,p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare snapshot jsonb;plan private.deletion_plans;
begin
 if not private.deletion_authorized(p_kind,p_id) then raise exception 'Deletion permission required' using errcode='42501';end if;
 snapshot=private.deletion_snapshot(p_kind,p_id);
 insert into private.deletion_plans(actor_id,kind,target_id,snapshot) values(auth.uid(),p_kind,p_id,snapshot) returning * into plan;
 return jsonb_build_object('plan_id',plan.id,'kind',p_kind,'id',p_id,'label',private.deletion_label(p_kind,p_id),'counts',snapshot->'counts','blockers',snapshot->'blockers','can_confirm',jsonb_array_length(snapshot->'blockers')=0,'expires_at',plan.expires_at);
end;$$;

create or replace function private.deletion_confirm(p_plan_id uuid,p_request_id uuid,p_confirmation text) returns jsonb language plpgsql security definer set search_path='' as $$
declare plan private.deletion_plans;o private.deletion_operations;snapshot jsonb;objects jsonb:='[]'::jsonb;entry jsonb;part jsonb;mode text;org uuid;target_rank integer;context jsonb:='{}'::jsonb;
begin
 if not private.actor_active() then raise exception 'Active login required' using errcode='42501';end if;
 if p_confirmation is distinct from 'DELETE' or p_request_id is null then raise exception 'Explicit deletion confirmation required' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('permanent-deletion',0));
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('portal-user-activation',0));
 perform 1 from public.profiles where id=auth.uid() and active for share;
 perform 1 from public.user_roles where user_id=auth.uid() order by role for share;
 perform 1 from public.client_organisation_memberships where user_id=auth.uid() order by organisation_id for share;
 perform 1 from public.organisations where id in(select organisation_id from public.client_organisation_memberships where user_id=auth.uid()) order by id for share;
 select * into o from private.deletion_operations where actor_id=auth.uid() and request_id=p_request_id;
 if found then
  if o.plan_id<>p_plan_id then raise exception 'Deletion idempotency conflict' using errcode='22023';end if;
  if not private.deletion_operation_authorized(o.id,auth.uid()) then raise exception 'Deletion authority revoked' using errcode='42501';end if;
  return private.deletion_operation_view(o.id);
 end if;
 if exists(select 1 from private.deletion_operations where plan_id=p_plan_id) then raise exception 'Deletion plan already confirmed' using errcode='22023';end if;
 select * into plan from private.deletion_plans where id=p_plan_id and actor_id=auth.uid() for update;
 if not found or plan.expires_at<=clock_timestamp() then raise exception 'Deletion preview expired' using errcode='22023';end if;
 if exists(select 1 from private.deletion_operations where kind=plan.kind and target_id=plan.target_id and status<>'completed') then raise exception 'Deletion already pending' using errcode='40001';end if;
 if plan.kind='job' then
  perform 1 from public.jobs where id=plan.target_id for share;
  perform 1 from public.course_runs where id in(select course_run_id from public.jobs where id=plan.target_id) for share;
 elsif plan.kind in('message','chat_room') then
  perform 1 from public.chat_rooms where id=case when plan.kind='chat_room' then plan.target_id else (select room_id from public.messages where id=plan.target_id) end for share;
  perform 1 from public.chat_members where user_id=auth.uid() and room_id=case when plan.kind='chat_room' then plan.target_id else (select room_id from public.messages where id=plan.target_id) end for share;
 end if;
 if not private.deletion_authorized(plan.kind,plan.target_id) then raise exception 'Deletion authority revoked' using errcode='42501';end if;
 snapshot=private.deletion_snapshot(plan.kind,plan.target_id);
 if snapshot is distinct from plan.snapshot then raise exception 'Deletion scope changed; preview again' using errcode='40001';end if;
 if jsonb_array_length(snapshot->'blockers')>0 then raise exception 'Deletion has protected dependencies' using errcode='23503';end if;
 -- Serialize every affected relation with ordinary writers before installing
 -- the irreversible fence. Conflicting inserts must finish before revalidation.
 for entry in select jsonb_build_object('table',name) from (select value->>'table' name from jsonb_array_elements(snapshot->'scope') union select c.conrelid::regclass::text from pg_catalog.pg_constraint c where c.contype='f' and c.confrelid in(select (value->>'table')::regclass from jsonb_array_elements(snapshot->'scope'))) relations order by name loop
  execute format('lock table %s in share row exclusive mode',entry->>'table');
 end loop;
 if private.deletion_snapshot(plan.kind,plan.target_id) is distinct from snapshot then raise exception 'Deletion scope changed; preview again' using errcode='40001';end if;
 for entry in select value from jsonb_array_elements(snapshot->'scope') where value->>'table'='public.document_versions' loop
  execute format('select coalesce(jsonb_agg(jsonb_build_object(''bucket'',b.bucket,''path'',x.object_path)),''[]'') from public.document_versions x cross join (values(''portal-clean''),(''portal-quarantine'')) b(bucket) where %s',entry->>'predicate') into part;
  objects=objects||part;
 end loop;
 mode=case when plan.kind in('contract','invoice','payment','message','chat_room') then 'scoped' when plan.kind in('personal_event','availability','saved_job_view') then 'owner' when private.deletion_admin(auth.uid()) or plan.kind='account' then 'admin' when plan.kind='job' then 'company' else 'owner' end;
 if mode='scoped' then
  if plan.kind='contract' then context=jsonb_build_object('permission','contracts.manage','read_contracts',exists(select 1 from public.contracts where id=plan.target_id and user_id<>auth.uid()));
  elsif plan.kind in('invoice','payment') then context=jsonb_build_object('permission','finance.manage');
  elsif plan.kind='message' then select jsonb_build_object('room_id',r.id,'room_kind',r.kind,'is_author',m.sender_id=auth.uid(),'permission',case when m.sender_id<>auth.uid() and r.owner_id is distinct from auth.uid() then 'chat.moderate' end) into context from public.messages m join public.chat_rooms r on r.id=m.room_id where m.id=plan.target_id;
  else select jsonb_build_object('room_id',id,'room_kind',kind,'requires_owner',owner_id=auth.uid(),'permission',case when owner_id is distinct from auth.uid() then 'courses.manage' end) into context from public.chat_rooms where id=plan.target_id;end if;
 end if;
 if plan.kind='account' then select coalesce(max(private.account_role_rank(role)),0) into target_rank from public.user_roles where user_id=plan.target_id;end if;
 if mode='company' then select coalesce(r.organisation_id,c.organisation_id,f.organisation_id) into org from public.jobs j left join public.course_runs r on r.id=j.course_run_id left join private.client_course_requests c on c.job_id=j.id left join private.job_commission_offers f on f.job_id=j.id where j.id=plan.target_id;end if;
 insert into private.deletion_storage_fences(bucket,path) select obj->>'bucket',obj->>'path' from jsonb_array_elements(objects) obj on conflict do nothing;
 -- Existing avatar/evidence/download helpers also reject deleted_at. This is an
 -- irreversible execution fence, with no restore API or recoverable bin.
 for entry in select value from jsonb_array_elements(snapshot->'scope') where value->>'table'='public.documents' loop
  execute format('update public.documents x set deleted_at=coalesce(deleted_at,clock_timestamp()) where %s',entry->>'predicate');
 end loop;
 if plan.kind='account' then update public.profiles set active=false where id=plan.target_id;end if;
 insert into private.deletion_operations(actor_id,request_id,plan_id,kind,target_id,scope,objects,authority,target_rank,organisation_id,authorization_context)
 values(auth.uid(),p_request_id,plan.id,plan.kind,plan.target_id,snapshot->'scope',objects,mode,target_rank,org,context) returning * into o;
 insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),'resource.deletion.confirmed',plan.target_id,jsonb_build_object('kind',plan.kind,'operation_id',o.id));
 return private.deletion_operation_view(o.id);
end;$$;

create or replace function private.deletion_status(p_operation_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.deletion_operation_authorized(p_operation_id,auth.uid()) then raise exception 'Deletion authority revoked' using errcode='42501';end if;
 return private.deletion_operation_view(p_operation_id);
end;$$;

create or replace function private.deletion_operations() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.actor_active() then raise exception 'Active login required' using errcode='42501';end if;
 return jsonb_build_object('items',coalesce((select jsonb_agg(private.deletion_operation_view(id) order by created_at desc) from private.deletion_operations where status<>'completed' and private.deletion_operation_authorized(id,auth.uid())),'[]'::jsonb));
end;$$;

-- Existing enrolled factors are no longer supported by this product. Guard the
-- deletion for local SQL harnesses where Supabase Auth is represented minimally.
do $$ begin
 if to_regclass('auth.mfa_factors') is not null then
  execute 'delete from auth.mfa_factors';
 end if;
end $$;

commit;
