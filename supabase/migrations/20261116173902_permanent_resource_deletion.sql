begin;

-- Audit attribution is metadata, not an account ownership relationship. Keep
-- the event after account deletion without retaining a restorable profile.
alter table public.audit_events alter column actor_id drop not null;
alter table public.audit_events drop constraint audit_events_actor_id_fkey;
alter table public.audit_events add constraint audit_events_actor_id_fkey foreign key(actor_id) references public.profiles(id) on delete set null;

-- Permanent deletion is an irreversible, caller-authorized operation. The
-- private journal contains identifiers, hashes and exact object paths, never
-- copies of deleted document bodies, messages or financial snapshots.
create table private.deletion_plans (
 id uuid primary key default gen_random_uuid(), actor_id uuid not null,
 kind text not null, target_id uuid not null, snapshot jsonb not null,
 expires_at timestamptz not null default clock_timestamp()+interval '10 minutes'
);
create table private.deletion_operations (
 id uuid primary key default gen_random_uuid(), actor_id uuid not null,
 request_id uuid not null, plan_id uuid not null unique,
 kind text not null,target_id uuid not null,scope jsonb not null,
 objects jsonb not null default '[]'::jsonb,authority text not null,
 target_rank integer,organisation_id uuid,authorization_context jsonb not null default '{}'::jsonb,
 status text not null default 'pending' check(status in('pending','failed','completed')),
 applied boolean not null default false,created_at timestamptz not null default clock_timestamp(),
 completed_at timestamptz,unique(actor_id,request_id)
);
create index deletion_completed_target on private.deletion_operations(kind,target_id) where status='completed';
create unique index deletion_one_target on private.deletion_operations(kind,target_id) where status<>'completed';
create table private.deletion_permits (
 id uuid primary key default gen_random_uuid(),operation_id uuid not null references private.deletion_operations(id) on delete cascade,
 actor_id uuid not null,expires_at timestamptz not null default clock_timestamp()+interval '2 minutes'
);
create table private.deletion_upload_leases (
 id uuid primary key default gen_random_uuid(),document_id uuid not null,version_id uuid not null unique,
 created_at timestamptz not null default clock_timestamp()
);
create table private.deletion_storage_fences(bucket text not null,path text not null,primary key(bucket,path));
do $$declare t text;begin
 foreach t in array array['deletion_plans','deletion_operations','deletion_permits','deletion_upload_leases','deletion_storage_fences'] loop
  execute format('alter table private.%I enable row level security',t);
  execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
 end loop;
end;$$;

-- Only this closed mapping supplies SQL identifiers. User input never supplies
-- a table name or a SQL predicate.
create function private.deletion_registry() returns jsonb language sql immutable set search_path='' as $$
 select '{"account":"public.profiles","document":"public.documents","job":"public.jobs","assignment":"public.job_claims","organisation":"public.organisations","organisation_contact":"public.organisation_contacts","course_template":"public.course_templates","course_run":"public.course_runs","course_session":"public.course_sessions","topic":"public.topics","wiki_page":"public.wiki_pages","forum_thread":"public.forum_threads","forum_post":"public.forum_posts","chat_room":"public.chat_rooms","message":"public.messages","resource_comment":"private.resource_comments","course_review":"public.course_reviews","announcement":"private.portal_announcements","global_event":"public.global_events","contract":"public.contracts","invoice":"public.invoices","payment":"public.payment_records","personal_event":"public.personal_events","availability":"public.lecturer_availability","building_block":"public.building_blocks","saved_job_view":"private.saved_job_views"}'::jsonb;
$$;
-- The later company-authority migration replaces this fail-closed helper.
create function private.deletion_can_manage_job(p_job_id uuid) returns boolean language sql stable security definer set search_path='' as $$select false;$$;
create function private.deletion_admin(p_actor uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p join public.user_roles r on r.user_id=p.id join public.role_permissions rp on rp.role=r.role where p.id=p_actor and p.active and r.role in('owner','admin') and rp.permission='users.manage');
$$;
create function private.deletion_authorized(p_kind text,p_id uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
begin
 if not private.actor_active() or coalesce(auth.jwt()->>'aal','')<>'aal2' or not (private.deletion_registry()?p_kind) then return false;end if;
 if p_kind='account' then return private.account_target_manageable(p_id);end if;
 if p_kind='personal_event' then return exists(select 1 from public.personal_events where id=p_id and user_id=auth.uid());end if;
 if p_kind='availability' then return exists(select 1 from public.lecturer_availability where id=p_id and user_id=auth.uid());end if;
 if p_kind='saved_job_view' then return exists(select 1 from private.saved_job_views where id=p_id and user_id=auth.uid());end if;
 if p_kind='contract' then return private.has_permission('contracts.manage') and exists(select 1 from public.contracts where id=p_id and (user_id=auth.uid() or private.has_permission('contracts.read')));end if;
 if p_kind='invoice' then return private.has_permission('finance.manage') and private.can_read_invoice(p_id);end if;
 if p_kind='payment' then return private.has_permission('finance.manage') and exists(select 1 from public.payment_records where id=p_id and private.can_read_invoice(invoice_id));end if;
 if p_kind='chat_room' then return exists(select 1 from public.chat_rooms r where r.id=p_id and private.can_access_chat_room(r.id) and (r.owner_id=auth.uid() or (r.kind in('participant_course','lecturer_course') and private.has_permission('courses.manage'))));end if;
 if p_kind='message' then return exists(select 1 from public.messages m join public.chat_rooms r on r.id=m.room_id where m.id=p_id and private.can_access_chat_room(r.id) and (m.sender_id=auth.uid() or (r.kind<>'dm' and (r.owner_id=auth.uid() or private.has_permission('chat.moderate')))));end if;
 if private.deletion_admin(auth.uid()) then return true;end if;
 if p_kind='job' then return private.deletion_can_manage_job(p_id);end if;
 if p_kind='document' then return exists(select 1 from public.documents where id=p_id and owner_id=auth.uid());end if;
 return false;
end;$$;

create function private.deletion_label(p_kind text,p_id uuid) returns text language plpgsql stable security definer set search_path='' as $$
declare label text;
begin
 case p_kind
 when 'account' then select display_name into label from public.profiles where id=p_id;
 when 'job' then select title into label from public.jobs where id=p_id;
 when 'organisation' then select name into label from public.organisations where id=p_id;
 when 'course_template' then select title into label from public.course_templates where id=p_id;
 when 'course_run' then select t.title into label from public.course_runs r join public.course_templates t on t.id=r.template_id where r.id=p_id;
 when 'topic' then select label_de into label from public.topics where id=p_id;
 when 'building_block' then select title into label from public.building_blocks where id=p_id;
 else label=null;
 end case;
 return coalesce(nullif(label,''),p_kind||' '||p_id::text);
end;$$;

create function private.deletion_selector(p_scope jsonb,p_table text) returns text language sql immutable set search_path='' as $$
 select string_agg('('||(entry->>'predicate')||')',' or ') from jsonb_array_elements(p_scope) entry where entry->>'table'=p_table;
$$;
create function private.deletion_add_scope(p_scope jsonb,p_table text,p_predicate text) returns jsonb language sql immutable set search_path='' as $$
 select p_scope||jsonb_build_array(jsonb_build_object('table',p_table,'predicate',p_predicate));
$$;

create function private.deletion_scope(p_kind text,p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb:='[]'::jsonb;root text:=private.deletion_registry()->>p_kind;entry jsonb;ref record;pred text;join_sql text;i integer:=0;
begin
 if root is null or p_id is null then raise exception 'Unknown deletion kind' using errcode='22023';end if;
 result=private.deletion_add_scope(result,root,format('x.id=%L::uuid',p_id));
 if p_kind='document' then
  result=private.deletion_add_scope(result,'public.document_versions',format('x.document_id=%L::uuid',p_id));
  result=private.deletion_add_scope(result,'public.profile_avatars',format('x.document_version_id in(select id from public.document_versions where document_id=%L::uuid)',p_id));
 elsif p_kind='account' then
  -- Shared commercial records and somebody else's uploaded documents are not
  -- owned children. Their foreign keys deliberately become explicit blockers.
  result=private.deletion_add_scope(result,'public.personal_events',format('x.user_id=%L::uuid',p_id));
  result=private.deletion_add_scope(result,'public.lecturer_availability',format('x.user_id=%L::uuid',p_id));
  result=private.deletion_add_scope(result,'public.notifications',format('x.user_id=%L::uuid',p_id));
  result=private.deletion_add_scope(result,'public.chat_members',format('x.user_id=%L::uuid',p_id));
  result=private.deletion_add_scope(result,'public.message_reactions',format('x.user_id=%L::uuid',p_id));
  result=private.deletion_add_scope(result,'public.client_organisation_memberships',format('x.user_id=%L::uuid',p_id));
  result=private.deletion_add_scope(result,'public.invitation_requests',format('x.auth_user_id=%L::uuid',p_id));
 elsif p_kind='assignment' then
  result=private.deletion_add_scope(result,'public.assignment_sessions',format('x.claim_id=%L::uuid',p_id));
  result=private.deletion_add_scope(result,'public.claim_events',format('x.claim_id=%L::uuid',p_id));
  result=private.deletion_add_scope(result,'private.job_lifecycle_requests',format('x.result=%L::uuid or x.payload->>''claim_id''=%L',p_id,p_id::text));
 elsif p_kind='job' then
  result=private.deletion_add_scope(result,'private.client_course_requests',format('x.job_id=%L::uuid',p_id));
  result=private.deletion_add_scope(result,'private.job_commission_offers',format('x.job_id=%L::uuid',p_id));
  result=private.deletion_add_scope(result,'private.course_run_job_requests',format('x.job_id=%L::uuid',p_id));
  result=private.deletion_add_scope(result,'private.job_lifecycle_requests',format('x.result=%L::uuid or x.payload->>''job_id''=%L',p_id,p_id::text));
 elsif p_kind='message' or p_kind='chat_room' then
  if p_kind='chat_room' then
   result=private.deletion_add_scope(result,'public.chat_members',format('x.room_id=%L::uuid',p_id));
   result=private.deletion_add_scope(result,'public.messages',format('x.room_id=%L::uuid',p_id));
  end if;
  pred=case when p_kind='message' then format('x.message_id=%L::uuid',p_id) else format('x.message_id in(select id from public.messages where room_id=%L::uuid)',p_id) end;
  result=private.deletion_add_scope(result,'public.message_reactions',pred);
  result=private.deletion_add_scope(result,'public.chat_message_revisions',pred);
 elsif p_kind='resource_comment' then
  result=private.deletion_add_scope(result,'private.resource_comment_revisions',format('x.comment_id=%L::uuid',p_id));
 end if;
 -- Follow only declared ownership cascades. Other inbound relationships are
 -- reported; they never silently grow the user's confirmed deletion scope.
 while i<jsonb_array_length(result) loop
  entry=result->i;i=i+1;
  for ref in select c.oid,c.conrelid::regclass::text child,c.conkey,c.confkey,c.confrelid
   from pg_catalog.pg_constraint c where c.contype='f' and c.confdeltype='c' and c.confrelid=(entry->>'table')::regclass
   and c.connamespace in('public'::regnamespace,'private'::regnamespace) loop
   if not ((ref.child||'->'||(entry->>'table'))=any(array['public.user_roles->public.profiles','public.lecturer_topics->public.profiles','public.profile_details->public.profiles','public.profile_avatars->public.profiles','public.job_sessions->public.jobs','public.job_requirements->public.jobs','public.organisation_private_details->public.organisations','public.organisation_contacts->public.organisations','public.course_template_topics->public.course_templates','public.wiki_revisions->public.wiki_pages','public.forum_posts->public.forum_threads','public.forum_post_revisions->public.forum_posts','public.forum_subscriptions->public.forum_threads','public.forum_reports->public.forum_posts','private.notification_preferences->public.profiles','private.welcome_progress->public.profiles','private.chat_content_versions->public.messages','private.chat_mention_versions->private.chat_content_versions','private.chat_mention_requests->public.profiles','private.document_organisation->public.profiles','private.document_organisation->public.documents','private.saved_job_views->public.profiles','private.attention_preferences->public.profiles','private.announcement_revisions->private.portal_announcements','private.announcement_publications->private.announcement_revisions','private.announcement_acknowledgements->public.profiles','private.announcement_acknowledgements->private.announcement_revisions','private.announcement_requests->public.profiles','private.global_event_requests->public.profiles','private.qualification_states->public.profiles','private.qualification_evidence->public.profiles','private.qualification_evidence->public.document_versions','private.qualification_events->public.profiles','private.qualification_events->private.qualification_evidence','private.qualification_requests->public.profiles'])) or private.deletion_selector(result,ref.child) is not null then continue;end if;
   select string_agg(format('x.%I=parent%s.%I',a.attname,i,b.attname),' and ' order by k.n) into join_sql
    from unnest(ref.conkey,ref.confkey) with ordinality k(a,b,n)
    join pg_catalog.pg_attribute a on a.attrelid=ref.child::regclass and a.attnum=k.a
    join pg_catalog.pg_attribute b on b.attrelid=ref.confrelid and b.attnum=k.b;
   pred=format('exists(select 1 from %s parent%s where (%s) and %s)',entry->>'table',i,replace(entry->>'predicate','x.','parent'||i::text||'.'),join_sql);
   result=private.deletion_add_scope(result,ref.child,pred);
  end loop;
 end loop;
 return result;
end;$$;

create function private.deletion_snapshot(p_kind text,p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare scope jsonb:=private.deletion_scope(p_kind,p_id);entry jsonb;ref record;counts jsonb:='{}'::jsonb;hashes jsonb:='{}'::jsonb;blockers jsonb:='[]'::jsonb;n bigint;digest text;join_sql text;excluded text;root text:=private.deletion_registry()->>p_kind;present boolean;
begin
 execute format('select exists(select 1 from %s x where x.id=$1)',root) into present using p_id;
 if not present then raise exception 'Deletion target unavailable' using errcode='22023';end if;
 for entry in select value from jsonb_array_elements(scope) loop
  execute format('select count(*),md5(coalesce(string_agg(md5(to_jsonb(x)::text),'''' order by md5(to_jsonb(x)::text)),'''')) from %s x where %s',entry->>'table',entry->>'predicate') into n,digest;
  counts=counts||jsonb_build_object(entry->>'table',n);hashes=hashes||jsonb_build_object(entry->>'table',digest);
  for ref in select c.oid,c.conrelid::regclass::text child,c.conkey,c.confkey,c.confrelid
   from pg_catalog.pg_constraint c where c.contype='f' and c.confrelid=(entry->>'table')::regclass and not(c.conrelid='public.audit_events'::regclass and c.conname='audit_events_actor_id_fkey') loop
   select string_agg(format('x.%I=y.%I',a.attname,b.attname),' and ' order by k.n) into join_sql
    from unnest(ref.conkey,ref.confkey) with ordinality k(a,b,n)
    join pg_catalog.pg_attribute a on a.attrelid=ref.child::regclass and a.attnum=k.a
    join pg_catalog.pg_attribute b on b.attrelid=ref.confrelid and b.attnum=k.b;
   excluded=private.deletion_selector(scope,ref.child);
   execute format('select count(*) from %s x where exists(select 1 from %s y where (%s) and %s)%s',ref.child,entry->>'table',replace(entry->>'predicate','x.','y.'),join_sql,case when excluded is null then '' else ' and not ('||excluded||')' end) into n;
   if n>0 then blockers=blockers||jsonb_build_array(jsonb_build_object('code','referenced','kind',ref.child,'count',n));end if;
  end loop;
 end loop;
 if p_kind='payment' then
  -- Booked and voided payment records are retained financial history. Corrections
  -- use the existing audited void operation, never physical removal.
  blockers=blockers||jsonb_build_array(jsonb_build_object('code','referenced','kind','protected_payment_history','count',1));
 end if;
 if p_kind='account' then
  select count(*),md5(coalesce(string_agg(md5(to_jsonb(a)::text),'' order by md5(to_jsonb(a)::text)),'')) into n,digest from public.audit_events a where a.actor_id=p_id;
  counts=counts||jsonb_build_object('audit_attributions',n);hashes=hashes||jsonb_build_object('audit_attributions',digest);
  select count(*) into n from private.deletion_operations where actor_id=p_id and authority in('owner','scoped') and status<>'completed';
  if n>0 then blockers=blockers||jsonb_build_array(jsonb_build_object('code','referenced','kind','pending_personal_deletions','count',n));end if;
 end if;
 return jsonb_build_object('scope',scope,'counts',counts,'hashes',hashes,'blockers',blockers);
end;$$;

create function private.deletion_operation_view(p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('operation_id',id,'status',status,'kind',kind,'id',target_id) from private.deletion_operations where id=p_id;
$$;
create function private.deletion_operation_authorized(p_operation_id uuid,p_actor uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
declare o private.deletion_operations;rank integer;manager boolean;
begin
 select * into o from private.deletion_operations where id=p_operation_id;
 if not found or not exists(select 1 from public.profiles where id=p_actor and active) then return false;end if;
 if o.actor_id<>p_actor then
  -- Qualified administrative recovery changes the executor, never the original
  -- author or personal-resource owner. Only reduced business metadata is shared.
  if o.authority not in('admin','company') or not private.deletion_admin(p_actor) then return false;end if;
  if o.kind='account' then
   select coalesce(max(private.account_role_rank(role)),0) into rank from public.user_roles where user_id=p_actor;
   return o.target_id<>p_actor and rank>o.target_rank and exists(select 1 from public.user_roles r join public.role_permissions p on p.role=r.role where r.user_id=p_actor and p.permission='users.roles.manage');
  end if;
  return true;
 end if;
 select private.deletion_admin(p_actor) into manager;
 if o.authority='admin' then
  if not manager and o.kind<>'account' then return false;end if;
  if o.kind='account' then
   select coalesce(max(private.account_role_rank(role)),0) into rank from public.user_roles where user_id=p_actor;
   return o.target_id<>p_actor and rank>o.target_rank and exists(select 1 from public.user_roles r join public.role_permissions p on p.role=r.role where r.user_id=p_actor and p.permission='users.roles.manage');
  end if;
  return true;
 end if;
 if o.authority='owner' then return true;end if;
 if o.authority='scoped' then
  if o.authorization_context->>'permission' is not null and not exists(select 1 from public.user_roles r join public.role_permissions p on p.role=r.role where r.user_id=p_actor and p.permission=o.authorization_context->>'permission') then return false;end if;
  if o.authorization_context->>'read_contracts'='true' and not exists(select 1 from public.user_roles r join public.role_permissions p on p.role=r.role where r.user_id=p_actor and p.permission='contracts.read') then return false;end if;
  if o.authorization_context->>'room_id' is not null and not (o.kind='chat_room' and o.applied) and not exists(select 1 from public.chat_members m where m.room_id=(o.authorization_context->>'room_id')::uuid and m.user_id=p_actor and m.removed_at is null) then return false;end if;
  if not o.applied and o.kind='chat_room' and o.authorization_context->>'requires_owner'='true' and not exists(select 1 from public.chat_rooms where id=(o.authorization_context->>'room_id')::uuid and owner_id=p_actor) then return false;end if;
  if o.kind='message' and o.authorization_context->>'is_author'='false' and not exists(select 1 from public.chat_rooms r where r.id=(o.authorization_context->>'room_id')::uuid and r.kind<>'dm' and (r.owner_id=p_actor or exists(select 1 from public.user_roles ur join public.role_permissions rp on rp.role=ur.role where ur.user_id=p_actor and rp.permission='chat.moderate'))) then return false;end if;
  if o.authorization_context->>'room_kind'='general' and not exists(select 1 from public.user_roles where user_id=p_actor and role in('owner','admin','lecturer','senior_lecturer')) then return false;end if;
  if o.authorization_context->>'room_kind' in('topic','lecturer_course') and not private.chat_staff(p_actor) then return false;end if;
  return true;
 end if;
 if o.authority='company' and not o.applied and exists(select 1 from public.jobs where id=o.target_id) then
  if not exists(select 1 from public.jobs j left join public.course_runs r on r.id=j.course_run_id left join private.client_course_requests c on c.job_id=j.id left join private.job_commission_offers f on f.job_id=j.id where j.id=o.target_id and coalesce(r.organisation_id,c.organisation_id,f.organisation_id)=o.organisation_id and (r.organisation_id is null or r.organisation_id=o.organisation_id) and (c.organisation_id is null or c.organisation_id=o.organisation_id) and (f.organisation_id is null or f.organisation_id=o.organisation_id)) then return false;end if;
 end if;
 return o.authority='company' and exists(select 1 from public.user_roles where user_id=p_actor and role='client')
  and exists(select 1 from public.client_organisation_memberships m join public.organisations g on g.id=m.organisation_id where m.user_id=p_actor and m.organisation_id=o.organisation_id and m.removed_at is null and g.archived_at is null);
end;$$;

create function private.deletion_access() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare kinds jsonb:='[]'::jsonb;manager boolean:=private.has_permission('users.manage') and private.deletion_admin(auth.uid());
begin
 if not private.actor_active() then raise exception 'Active login required' using errcode='42501';end if;
 if coalesce(auth.jwt()->>'aal','')='aal2' then
  if manager then select jsonb_agg(key order by key) into kinds from jsonb_object_keys(private.deletion_registry()) key;
  else
   kinds='["document","personal_event","availability","saved_job_view","message","chat_room"]'::jsonb;
   if private.has_permission('users.roles.manage') then kinds=kinds||'"account"'::jsonb;end if;
   if private.has_permission('contracts.manage') then kinds=kinds||'"contract"'::jsonb;end if;
   if private.has_permission('finance.manage') then kinds=kinds||'["invoice","payment"]'::jsonb;end if;
   if private.has_role(array['client']) then kinds=kinds||'"job"'::jsonb;end if;
  end if;
 end if;
 return jsonb_build_object('can_admin',manager,'kinds',kinds);
end;$$;
create function private.deletion_resources(p_kind text,p_query text default '',p_cursor text default null,p_limit integer default 30) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare root text:=private.deletion_registry()->>p_kind;items jsonb:='[]'::jsonb;resource_id uuid;last_id uuid;more boolean:=false;
begin
 if not private.actor_active() then raise exception 'Active login required' using errcode='42501';end if;
 if root is null or p_query is null or length(p_query)>120 or p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid deletion list' using errcode='22023';end if;
 if p_cursor is not null then last_id=p_cursor::uuid;end if;
 for resource_id in execute format('select x.id from %s x where ($1::uuid is null or x.id>$1) and private.deletion_authorized($2,x.id) and position(lower($3) in lower(private.deletion_label($2,x.id)||'' ''||x.id::text))>0 order by x.id limit $4',root) using last_id,p_kind,p_query,p_limit+1 loop
  if jsonb_array_length(items)=p_limit then more=true;exit;end if;
  items=items||jsonb_build_array(jsonb_build_object('id',resource_id,'kind',p_kind,'label',private.deletion_label(p_kind,resource_id),'owner_label','','can_delete',true));last_id=resource_id;
 end loop;
 return jsonb_build_object('items',items,'next_cursor',case when more then last_id::text end);
exception when invalid_text_representation then raise exception 'Invalid deletion cursor' using errcode='22023';
end;$$;
create function private.deletion_preview(p_kind text,p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare snapshot jsonb;plan private.deletion_plans;
begin
 if not private.deletion_authorized(p_kind,p_id) then raise exception 'Deletion permission and MFA required' using errcode='42501';end if;
 snapshot=private.deletion_snapshot(p_kind,p_id);
 insert into private.deletion_plans(actor_id,kind,target_id,snapshot) values(auth.uid(),p_kind,p_id,snapshot) returning * into plan;
 return jsonb_build_object('plan_id',plan.id,'kind',p_kind,'id',p_id,'label',private.deletion_label(p_kind,p_id),'counts',snapshot->'counts','blockers',snapshot->'blockers','can_confirm',jsonb_array_length(snapshot->'blockers')=0,'expires_at',plan.expires_at);
end;$$;

create function private.deletion_confirm(p_plan_id uuid,p_request_id uuid,p_confirmation text) returns jsonb language plpgsql security definer set search_path='' as $$
declare plan private.deletion_plans;o private.deletion_operations;snapshot jsonb;objects jsonb:='[]'::jsonb;entry jsonb;part jsonb;mode text;org uuid;target_rank integer;context jsonb:='{}'::jsonb;
begin
 if not private.actor_active() or coalesce(auth.jwt()->>'aal','')<>'aal2' then raise exception 'Active login and MFA required' using errcode='42501';end if;
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

create function private.deletion_status(p_operation_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if coalesce(auth.jwt()->>'aal','')<>'aal2' or not private.deletion_operation_authorized(p_operation_id,auth.uid()) then raise exception 'Deletion authority revoked' using errcode='42501';end if;
 return private.deletion_operation_view(p_operation_id);
end;$$;
create function private.deletion_operations() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.actor_active() or coalesce(auth.jwt()->>'aal','')<>'aal2' then raise exception 'Active login and MFA required' using errcode='42501';end if;
 return jsonb_build_object('items',coalesce((select jsonb_agg(private.deletion_operation_view(id) order by created_at desc) from private.deletion_operations where status<>'completed' and private.deletion_operation_authorized(id,auth.uid())),'[]'::jsonb));
end;$$;
create function private.deletion_execution(p_operation_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare permit private.deletion_permits;
begin
 perform private.deletion_status(p_operation_id);
 insert into private.deletion_permits(operation_id,actor_id) values(p_operation_id,auth.uid()) returning * into permit;
 return jsonb_build_object('permit_id',permit.id,'expires_at',permit.expires_at);
end;$$;

-- Fences are tested against both the row itself and incoming foreign keys.
-- A new attachment/claim/version cannot appear after the confirmed graph.
create function private.deletion_row_fenced(p_table text,p_row jsonb) returns boolean language plpgsql stable security definer set search_path='' as $$
declare o private.deletion_operations;entry jsonb;ref record;matched boolean;join_sql text;
begin
 if p_row->>'id' is not null and exists(select 1 from jsonb_each_text(private.deletion_registry()) r where r.value=p_table) then
  if exists(select 1 from private.deletion_operations op where op.status='completed' and op.target_id=(p_row->>'id')::uuid and op.kind in(select key from jsonb_each_text(private.deletion_registry()) r where r.value=p_table)) then return true;end if;
 end if;
 for o in select * from private.deletion_operations where status<>'completed' loop
  if current_setting('private.deletion_operation',true)=o.id::text and current_setting('role',true)='service_role' then continue;end if;
  for entry in select value from jsonb_array_elements(o.scope) loop
   if entry->>'table'=p_table then
    execute format('select (%s) from jsonb_populate_record(null::%s,$1) x',entry->>'predicate',p_table) into matched using p_row;
    if matched then return true;end if;
   end if;
   for ref in select c.conkey,c.confkey,c.confrelid from pg_catalog.pg_constraint c where c.contype='f' and c.conrelid=p_table::regclass and c.confrelid=(entry->>'table')::regclass loop
    select string_agg(format('x.%I=y.%I',a.attname,b.attname),' and ' order by k.n) into join_sql from unnest(ref.conkey,ref.confkey) with ordinality k(a,b,n)
     join pg_catalog.pg_attribute a on a.attrelid=p_table::regclass and a.attnum=k.a join pg_catalog.pg_attribute b on b.attrelid=ref.confrelid and b.attnum=k.b;
    execute format('select exists(select 1 from jsonb_populate_record(null::%s,$1) x join %s y on %s where %s)',p_table,entry->>'table',join_sql,replace(entry->>'predicate','x.','y.')) into matched using p_row;
    if matched then return true;end if;
   end loop;
  end loop;
 end loop;
 return false;
end;$$;
create function private.guard_permanent_deletion() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (tg_op<>'INSERT' and private.deletion_row_fenced(tg_table_schema||'.'||tg_table_name,to_jsonb(old))) or (tg_op<>'DELETE' and private.deletion_row_fenced(tg_table_schema||'.'||tg_table_name,to_jsonb(new))) then raise exception 'Resource is being permanently deleted' using errcode='55000';end if;
 if tg_op='DELETE' then return old;end if;return new;
end;$$;
create function private.deletion_document_fenced(p_document_id uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
declare d public.documents;
begin
 select * into d from public.documents where id=p_document_id;
 if not found then return true;end if;
 return private.deletion_row_fenced('public.documents',to_jsonb(d));
end;$$;
-- Restrictive policies preserve all existing private-content ACLs.
create policy permanent_deletion_documents_read on public.documents as restrictive for select to authenticated using(not private.deletion_document_fenced(id));
create policy permanent_deletion_versions_read on public.document_versions as restrictive for select to authenticated using(not private.deletion_document_fenced(document_id));

create function private.deletion_upload_begin(p_document_id uuid,p_version_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare lease uuid;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('permanent-deletion',0));
 perform 1 from public.documents where id=p_document_id for share;
 if not found or private.deletion_document_fenced(p_document_id) or not exists(select 1 from public.document_versions where id=p_version_id and document_id=p_document_id) then raise exception 'Upload target unavailable' using errcode='55000';end if;
 if exists(select 1 from private.deletion_upload_leases where version_id=p_version_id) then raise exception 'Upload version already has an active writer' using errcode='55000';end if;
 insert into private.deletion_upload_leases(document_id,version_id) values(p_document_id,p_version_id) returning id into lease;return lease;
end;$$;
create function public.deletion_upload_begin(p_document_id uuid,p_version_id uuid) returns uuid language sql security invoker set search_path='' as $$select private.deletion_upload_begin(p_document_id,p_version_id);$$;
create function private.deletion_upload_end(p_lease_id uuid) returns void language sql security definer set search_path='' as $$delete from private.deletion_upload_leases where id=p_lease_id;$$;
create function public.deletion_upload_end(p_lease_id uuid) returns void language sql security invoker set search_path='' as $$select private.deletion_upload_end(p_lease_id);$$;

create function private.deletion_require_permit(p_operation_id uuid,p_permit_id uuid) returns private.deletion_operations language plpgsql security definer set search_path='' as $$
declare o private.deletion_operations;executor uuid;
begin
 select actor_id into executor from private.deletion_permits where operation_id=p_operation_id and id=p_permit_id and expires_at>clock_timestamp();
 if not found then raise exception 'Deletion permit expired or unavailable' using errcode='42501';end if;
 select * into o from private.deletion_operations where id=p_operation_id;
 if not found then raise exception 'Deletion operation unavailable' using errcode='42501';end if;
 perform 1 from public.profiles where id=executor and active for share;
 perform 1 from public.user_roles where user_id=executor order by role for share;
 perform 1 from public.client_organisation_memberships where user_id=executor order by organisation_id for share;
 perform 1 from public.organisations where id=o.organisation_id for share;
 if o.authority='company' and not o.applied then
  perform 1 from public.course_runs where id in(select course_run_id from public.jobs where id=o.target_id) for share;
 end if;
 if o.authorization_context->>'room_id' is not null and not (o.applied and o.kind='chat_room') then
  perform 1 from public.chat_rooms where id=(o.authorization_context->>'room_id')::uuid for share;
  perform 1 from public.chat_members where room_id=(o.authorization_context->>'room_id')::uuid and user_id=executor for share;
 end if;
 select op.* into o from private.deletion_operations op join private.deletion_permits p on p.operation_id=op.id where op.id=p_operation_id and p.id=p_permit_id and p.expires_at>clock_timestamp() for update of op;
 if not found or not private.deletion_operation_authorized(o.id,executor) then raise exception 'Deletion permit expired or authority revoked' using errcode='42501';end if;
 return o;
end;$$;
create function private.deletion_pending_uploads(p_scope jsonb) returns bigint language plpgsql stable security definer set search_path='' as $$
declare pred text:=private.deletion_selector(p_scope,'public.documents');n bigint:=0;
begin
 if pred is not null then execute format('select count(*) from private.deletion_upload_leases l join public.documents x on x.id=l.document_id where %s',pred) into n;end if;
 return n;
end;$$;
create function private.deletion_work(p_operation_id uuid,p_permit_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare o private.deletion_operations:=private.deletion_require_permit(p_operation_id,p_permit_id);
begin
 return private.deletion_operation_view(o.id)||jsonb_build_object('objects',o.objects,'auth_user_id',case when o.kind='account' then o.target_id end,'pending_uploads',private.deletion_pending_uploads(o.scope));
end;$$;
create function private.deletion_apply(p_operation_id uuid,p_permit_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare o private.deletion_operations:=private.deletion_require_permit(p_operation_id,p_permit_id);remaining jsonb;next_remaining jsonb;entry jsonb;progress boolean;affected_job_id uuid;affected_lecturer_id uuid;job public.jobs;other_claims integer;
begin
 if o.applied or o.status='completed' then return private.deletion_operation_view(o.id);end if;
 if o.kind='payment' then raise exception 'Payment history must be corrected through audited voiding' using errcode='23503';end if;
 if private.deletion_pending_uploads(o.scope)>0 then raise exception 'Upload cleanup pending' using errcode='55000';end if;
 perform set_config('private.deletion_operation',o.id::text,true);
 if o.kind='assignment' then
  select c.job_id,c.lecturer_id into affected_job_id,affected_lecturer_id from public.job_claims c where c.id=o.target_id;
  select * into job from public.jobs where id=affected_job_id for update;
 end if;
 -- Resolve the document/version cycle without modifying retained commercial
 -- versions. The preview has already rejected contracts/invoices outside scope.
 for entry in select value from jsonb_array_elements(o.scope) where value->>'table'='public.documents' loop
  execute format('update public.documents x set current_version_id=null where %s',entry->>'predicate');
 end loop;
 remaining=o.scope;
 while jsonb_array_length(remaining)>0 loop
  progress=false;next_remaining='[]'::jsonb;
  for entry in select value from jsonb_array_elements(remaining) with ordinality e(value,n) order by n desc loop
   begin
    execute format('delete from %s x where %s',entry->>'table',entry->>'predicate');progress=true;
   exception when foreign_key_violation then next_remaining=next_remaining||jsonb_build_array(entry);
   end;
  end loop;
  if not progress then raise exception 'Protected deletion dependency changed' using errcode='23503';end if;
  remaining=next_remaining;
 end loop;
 if affected_job_id is not null then
  -- Match cancellation's room-before-member lock order. A historical claim
  -- deletion cannot revoke a newer confirmed allocation for the same lecturer.
  perform 1 from public.chat_rooms where job_id=affected_job_id and kind='lecturer_course' for update;
  if not exists(select 1 from public.job_claims where job_id=affected_job_id and lecturer_id=affected_lecturer_id and status='confirmed') then
   update public.chat_members m set removed_at=clock_timestamp() from public.chat_rooms r where r.job_id=affected_job_id and r.kind='lecturer_course' and m.room_id=r.id and m.user_id=affected_lecturer_id and m.removed_at is null;
   update public.chat_rooms r set owner_id=(select other.lecturer_id from public.job_claims other join public.chat_members member on member.room_id=r.id and member.user_id=other.lecturer_id and member.removed_at is null where other.job_id=affected_job_id and other.status='confirmed' and private.chat_staff(other.lecturer_id) order by other.created_at,other.id limit 1) where r.job_id=affected_job_id and r.kind='lecturer_course' and r.owner_id=affected_lecturer_id;
  end if;
 end if;
 if affected_job_id is not null and job.status<>'archived' then
  select count(*) into other_claims from public.job_claims where job_claims.job_id=affected_job_id and status='confirmed';
  update public.jobs set status=case when other_claims=0 then 'draft' when job.status in('published','filled') then case when other_claims>=job.capacity then 'filled' else 'published' end else job.status end where id=affected_job_id;
  insert into public.audit_events(actor_id,action,resource_id,details) values((select actor_id from private.deletion_permits where id=p_permit_id),'assignment.deletion.applied',affected_job_id,jsonb_build_object('operation_id',o.id,'remaining_confirmed',other_claims));
 end if;
 update private.deletion_operations set applied=true where id=o.id;
 return private.deletion_operation_view(o.id);
end;$$;
create function private.deletion_complete(p_operation_id uuid,p_permit_id uuid,p_storage_removed boolean,p_auth_removed boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare o private.deletion_operations:=private.deletion_require_permit(p_operation_id,p_permit_id);present boolean;
begin
 if o.status='completed' then return private.deletion_operation_view(o.id);end if;
 if not o.applied or private.deletion_pending_uploads(o.scope)>0 or p_storage_removed is distinct from true then raise exception 'Deletion cleanup pending' using errcode='55000';end if;
 execute format('select exists(select 1 from %s where id=$1)',private.deletion_registry()->>o.kind) into present using o.target_id;
 if present then raise exception 'Deletion target still present' using errcode='55000';end if;
 if o.kind='account' and (p_auth_removed is distinct from true or exists(select 1 from auth.users where id=o.target_id)) then raise exception 'Auth deletion pending' using errcode='55000';end if;
 if to_regclass('storage.objects') is not null then
  execute 'select exists(select 1 from storage.objects s join jsonb_array_elements($1) o on s.bucket_id=o->>''bucket'' and s.name=o->>''path'')' into present using o.objects;
  if present then raise exception 'Storage deletion pending' using errcode='55000';end if;
 end if;
 update private.deletion_operations set status='completed',completed_at=clock_timestamp(),objects='[]'::jsonb where id=o.id;
 delete from private.deletion_permits where operation_id=o.id and id<>p_permit_id;
 delete from private.deletion_plans where id=o.plan_id;
 insert into public.audit_events(actor_id,action,resource_id,details) values((select actor_id from private.deletion_permits where id=p_permit_id),'resource.deletion.completed',o.target_id,jsonb_build_object('kind',o.kind,'operation_id',o.id));
 return private.deletion_operation_view(o.id);
end;$$;

create function public.deletion_operations() returns jsonb language sql security invoker set search_path='' as $$select private.deletion_operations();$$;
create function public.deletion_access() returns jsonb language sql security invoker set search_path='' as $$select private.deletion_access();$$;
create function public.deletion_resources(p_kind text,p_query text default '',p_cursor text default null,p_limit integer default 30) returns jsonb language sql security invoker set search_path='' as $$select private.deletion_resources(p_kind,p_query,p_cursor,p_limit);$$;
create function public.deletion_preview(p_kind text,p_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.deletion_preview(p_kind,p_id);$$;
create function public.deletion_confirm(p_plan_id uuid,p_request_id uuid,p_confirmation text) returns jsonb language sql security invoker set search_path='' as $$select private.deletion_confirm(p_plan_id,p_request_id,p_confirmation);$$;
create function public.deletion_status(p_operation_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.deletion_status(p_operation_id);$$;
create function public.deletion_execution(p_operation_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.deletion_execution(p_operation_id);$$;
create function public._deletion_work(p_operation_id uuid,p_permit_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.deletion_work(p_operation_id,p_permit_id);$$;
create function public._deletion_apply(p_operation_id uuid,p_permit_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.deletion_apply(p_operation_id,p_permit_id);$$;
create function public._deletion_complete(p_operation_id uuid,p_permit_id uuid,p_storage_removed boolean,p_auth_removed boolean) returns jsonb language sql security invoker set search_path='' as $$select private.deletion_complete(p_operation_id,p_permit_id,p_storage_removed,p_auth_removed);$$;

create function private.guard_deleted_storage_path() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from private.deletion_storage_fences where bucket=new.bucket_id and path=new.name) then raise exception 'Permanently deleted object path' using errcode='55000';end if;return new;
end;$$;
revoke all on function private.guard_deleted_storage_path() from public,anon,authenticated,service_role;
do $$begin
 if to_regclass('storage.objects') is not null then execute 'create trigger permanent_deletion_storage_fence before insert or update on storage.objects for each row execute function private.guard_deleted_storage_path()';end if;
end;$$;

-- Current public/private business rows share this fence, including service
-- upload status writes and foreign-key children. Later tables must opt in.
do $$declare t record;f record;begin
 for t in select n.nspname,c.relname from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','private') and c.relkind='r' and c.relname not like 'deletion_%' loop
  execute format('create trigger permanent_deletion_fence before insert or update or delete on %I.%I for each row execute function private.guard_permanent_deletion()',t.nspname,t.relname);
 end loop;
 for f in select p.oid::regprocedure signature from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private') and (p.proname like 'deletion_%' or p.proname in('_deletion_work','_deletion_apply','_deletion_complete','guard_permanent_deletion')) loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 end loop;
end;$$;
grant execute on function private.deletion_document_fenced(uuid) to authenticated;
grant execute on function private.deletion_authorized(text,uuid) to authenticated;
grant execute on function public.deletion_operations(),private.deletion_operations(),public.deletion_access(),private.deletion_access(),public.deletion_resources(text,text,text,integer),private.deletion_resources(text,text,text,integer),public.deletion_preview(text,uuid),private.deletion_preview(text,uuid),public.deletion_confirm(uuid,uuid,text),private.deletion_confirm(uuid,uuid,text),public.deletion_status(uuid),private.deletion_status(uuid),public.deletion_execution(uuid),private.deletion_execution(uuid) to authenticated;
grant execute on function public.deletion_upload_begin(uuid,uuid),private.deletion_upload_begin(uuid,uuid),public.deletion_upload_end(uuid),private.deletion_upload_end(uuid),public._deletion_work(uuid,uuid),private.deletion_work(uuid,uuid),public._deletion_apply(uuid,uuid),private.deletion_apply(uuid,uuid),public._deletion_complete(uuid,uuid,boolean,boolean),private.deletion_complete(uuid,uuid,boolean,boolean) to service_role;

-- Retained business audit events remain visible after actor deletion. The
-- existing projection and filters expose no details or private content.
create or replace function private.admin_audit_actions() returns text[] language sql immutable set search_path='' as $$
 select array[
 'account.roles_changed','user.activated','user.deactivated','invitation.reserved','invitation.sent','invitation.failed','qualification.attested',
 'client.membership_added','client.membership_removed','client.request_submitted','client.request_published','client.request_cancelled','organisation.saved','organisation.contact.saved',
 'course.template.saved','course.template.duplicated','course.run.saved','course.run.duplicated','course.visibility.changed','course.run_offer_created','course.enrolment.changed',
 'job.created.draft','job.created.published','job.created.archived','job.status.draft','job.status.published','job.status.archived','job.commission_configured',
 'job.lifecycle.draft','job.lifecycle.published','job.lifecycle.archived','job.lifecycle.reopen','job.lifecycle.edit','job.lifecycle.duplicate','job.capacity_created','job.capacity_changed','claim.cancelled',
 'taxonomy.created','taxonomy.updated','taxonomy.archived','taxonomy.restored','announcement.draft_saved','announcement.published','announcement.archived','announcement.recovered','calendar.global_save','calendar.global_publish','calendar.global_unpublish','calendar.global_archive','calendar.global_recover','resource.deletion.confirmed','resource.deletion.completed','assignment.deletion.applied'
 ]::text[];
$$;

create or replace function private.admin_audit_events(p_from timestamptz default null,p_to timestamptz default null,
 p_action text default '',p_search text default '',p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 40)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare range_to timestamptz:=coalesce(p_to,now());range_from timestamptz;rows jsonb;more boolean;cursor jsonb;
begin
 if not private.has_permission('audit.read') then raise exception 'audit.read and verified MFA required' using errcode='42501';end if;
 range_from:=coalesce(p_from,range_to-interval '30 days');
 if not isfinite(range_from) or not isfinite(range_to) or range_from>=range_to
  or range_to-range_from>interval '93 days 2 hours'
  or p_action is null or (p_action<>'' and not(p_action=any(private.admin_audit_actions())))
  or p_search is null or length(p_search)>160
  or p_limit is null or p_limit not between 1 and 100
  or ((p_before_at is null)<>(p_before_id is null))
  or (p_before_at is not null and (not isfinite(p_before_at) or p_before_at<range_from or p_before_at>=range_to)) then
  raise exception 'Invalid audit range, filter or cursor' using errcode='22023';
 end if;
 with page as materialized(
  select e.id,coalesce(p.display_name,'') actor_name,e.action,e.resource_id,e.created_at
  from public.audit_events e left join public.profiles p on p.id=e.actor_id
  where e.created_at>=range_from and e.created_at<range_to
   and e.action=any(private.admin_audit_actions())
   -- Generic deletion events also cover private personal resources. Only the
   -- explicitly curated business kinds enter this company-wide projection.
   and (e.action not in('resource.deletion.confirmed','resource.deletion.completed') or e.details->>'kind'=any(array['account','job','assignment','organisation','organisation_contact','course_template','course_run','course_session','topic','building_block','announcement','global_event']))
   and (p_action='' or e.action=p_action)
   and (p_search='' or strpos(lower(e.action),lower(p_search))>0 or strpos(lower(coalesce(p.display_name,'')),lower(p_search))>0 or strpos(coalesce(e.resource_id::text,''),lower(p_search))>0)
   and (p_before_at is null or (e.created_at,e.id)<(p_before_at,p_before_id))
  order by e.created_at desc,e.id desc limit p_limit+1
 ),visible as(
  select * from page order by created_at desc,id desc limit p_limit
 )select coalesce((select jsonb_agg(to_jsonb(v) order by v.created_at desc,v.id desc) from visible v),'[]'::jsonb),
  (select count(*)>p_limit from page),
  (select jsonb_build_object('at',v.created_at,'id',v.id) from visible v order by v.created_at,v.id limit 1)
 into rows,more,cursor;
 return jsonb_build_object('items',rows,'has_more',more,'next_cursor',case when more then cursor else null end,
  'from',range_from,'to',range_to,'actions',private.admin_audit_actions());
end;$$;

commit;
