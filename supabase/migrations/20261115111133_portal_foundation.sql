-- M1: invitation-only portal with atomic single-slot assignment claims.
-- Privileged routines are deliberately isolated from the exposed API schema.
begin;
create extension if not exists btree_gist with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;
alter default privileges in schema private revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from public;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 120),
  bio_de text not null default '' check (char_length(bio_de) <= 4000),
  bio_en text not null default '' check (char_length(bio_en) <= 4000),
  phone text check (char_length(phone) <= 50),
  time_zone text not null default 'Europe/Berlin',
  locale text not null default 'de' check (locale in ('de','en')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.user_roles (
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('admin','management','senior_lecturer','lecturer','participant')),
  primary key (user_id, role)
);
create table public.role_permissions (
  role text not null,
  permission text not null,
  primary key(role,permission)
);
insert into public.role_permissions(role,permission)
select r, p from unnest(array['admin','management']) r
cross join unnest(array['jobs.manage','courses.manage','organisations.manage','qualifications.verify','contracts.read','users.manage']) p;
insert into public.role_permissions values ('admin','permissions.manage');
create table public.topics (
  id uuid primary key default gen_random_uuid(),
  label_de text not null check (length(label_de) between 1 and 120),
  label_en text not null check (length(label_en) between 1 and 120),
  kind text not null check (kind in ('topic','tool','language')),
  parent_id uuid references public.topics(id),
  aliases text[] not null default '{}',
  unique(kind,label_de)
);
create table public.lecturer_topics (
  user_id uuid not null references public.profiles(id) on delete cascade,
  topic_id uuid not null references public.topics(id),
  verified boolean not null default false,
  valid_until timestamptz,
  primary key (user_id,topic_id)
);
create table public.organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 200),
  country text,
  time_zone text not null default 'Europe/Berlin',
  created_at timestamptz not null default now()
);
create table public.course_templates (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(title) between 1 and 200),
  description text not null default '',
  created_at timestamptz not null default now()
);
create table public.course_runs (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.course_templates(id),
  organisation_id uuid references public.organisations(id),
  time_zone text not null default 'Europe/Berlin',
  created_at timestamptz not null default now()
);
create table public.course_sessions (
  id uuid primary key default gen_random_uuid(),
  course_run_id uuid not null references public.course_runs(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at)
);
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  course_run_id uuid references public.course_runs(id),
  title text not null check (length(title) between 1 and 200),
  description text not null default '' check (length(description)<=12000),
  customer_name text not null check (length(customer_name) between 1 and 200),
  delivery_type text not null check (delivery_type in ('online','onsite')),
  location text not null default '' check (length(location)<=500),
  time_zone text not null default 'Europe/Berlin',
  status text not null default 'draft' check (status in ('draft','published','filled','archived')),
  capacity integer not null default 1 check (capacity = 1), -- multi-slot jobs deferred explicitly
  amount numeric(12,2) not null check (amount >= 0),
  currency text not null check (currency in ('EUR','AUD')),
  rate_unit text not null check (rate_unit in ('per_day','per_teaching_unit','per_hour','fixed_total')),
  total_amount numeric(12,2) not null check (total_amount >= 0),
  terms text not null check (length(terms) between 1 and 12000),
  terms_version integer not null default 1 check (terms_version > 0),
  requires_contract boolean not null default false,
  claim_deadline timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create table public.job_sessions (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  course_session_id uuid references public.course_sessions(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  unique(job_id,starts_at,ends_at),
  exclude using gist (job_id with =, tstzrange(starts_at,ends_at,'[)') with &&)
);
create table public.job_requirements (
  job_id uuid not null references public.jobs(id) on delete cascade,
  topic_id uuid not null references public.topics(id),
  primary key(job_id,topic_id)
);
create table public.contracts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  status text not null check (status in ('draft','active','expired')),
  effective_from timestamptz not null,
  expires_at timestamptz,
  version integer not null check(version > 0),
  check(expires_at is null or expires_at > effective_from),
  unique(user_id,version)
);
create table public.job_claims (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id),
  lecturer_id uuid not null references public.profiles(id),
  idempotency_key uuid not null,
  status text not null default 'confirmed' check(status in ('confirmed','cancelled')),
  amount numeric(12,2) not null,
  currency text not null,
  rate_unit text not null,
  total_amount numeric(12,2) not null,
  terms text not null,
  terms_version integer not null,
  contract_id uuid references public.contracts(id),
  created_at timestamptz not null default now(),
  unique(lecturer_id,idempotency_key)
);
create unique index one_confirmed_claim_per_job on public.job_claims(job_id) where status = 'confirmed';
create table public.assignment_sessions (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.job_claims(id),
  lecturer_id uuid not null references public.profiles(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null check(ends_at > starts_at),
  exclude using gist (lecturer_id with =, tstzrange(starts_at,ends_at,'[)') with &&)
);
create table public.personal_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) default auth.uid(),
  title text not null check(length(title) between 1 and 200),
  starts_at timestamptz not null,
  ends_at timestamptz not null check(ends_at > starts_at),
  time_zone text not null default 'Europe/Berlin',
  created_at timestamptz not null default now()
);
create table public.global_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null check(ends_at > starts_at),
  time_zone text not null default 'Europe/Berlin',
  published boolean not null default false
);
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  kind text not null,
  resource_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique(user_id,kind,resource_id)
);
create table public.claim_events (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.job_claims(id),
  actor_id uuid not null references public.profiles(id),
  event_type text not null,
  created_at timestamptz not null default now()
);
create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles(id),
  action text not null,
  resource_id uuid,
  created_at timestamptz not null default now()
);
-- Room membership is transactional with claiming; messaging is a later slice.
create table public.chat_rooms (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references public.jobs(id),
  kind text not null default 'lecturer_course' check(kind='lecturer_course')
);
create table public.chat_members (
  room_id uuid not null references public.chat_rooms(id),
  user_id uuid not null references public.profiles(id),
  primary key(room_id,user_id)
);
create index jobs_status_created on public.jobs(status,created_at desc);
create index job_sessions_job_id on public.job_sessions(job_id);
create index job_requirements_topic_id on public.job_requirements(topic_id,job_id);
create index claims_lecturer on public.job_claims(lecturer_id,created_at desc);
create index assignments_claim on public.assignment_sessions(claim_id);
create index personal_events_user_start on public.personal_events(user_id,starts_at);
create index notifications_user_created on public.notifications(user_id,created_at desc);
create index course_sessions_run on public.course_sessions(course_run_id);
create index contracts_user on public.contracts(user_id);
create index chat_members_user on public.chat_members(user_id);

create function private.actor_active() returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists(select 1 from public.profiles where id=auth.uid() and active);
$$;
create function private.has_role(p_roles text[]) returns boolean language sql stable security definer set search_path='' as $$
 select private.actor_active() and exists(select 1 from public.user_roles where user_id=auth.uid() and role=any(p_roles));
$$;
create function private.has_permission(p_permission text) returns boolean language sql stable security definer set search_path='' as $$
 select private.actor_active() and coalesce(auth.jwt()->>'aal','')='aal2'
 and exists(select 1 from public.user_roles ur join public.role_permissions rp on rp.role=ur.role where ur.user_id=auth.uid() and rp.permission=p_permission);
$$;
create function public.get_my_permissions() returns text[] language sql stable security invoker set search_path='' as $$
 select coalesce(array_agg(distinct permission),'{}') from public.role_permissions where private.has_permission(permission);
$$;
create function private.on_auth_user_created() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.profiles(id) values(new.id);
 -- No role comes from editable user_metadata or automatically from authentication.
 return new;
end;$$;
create trigger portal_profile_after_signup after insert on auth.users for each row execute function private.on_auth_user_created();
create function private.validate_time_zone() returns trigger language plpgsql set search_path='' as $$
begin
 if not exists(select 1 from pg_catalog.pg_timezone_names where name=new.time_zone) then raise exception 'Invalid IANA time zone' using errcode='22023'; end if;
 return new;
end;$$;
create trigger profiles_time_zone before insert or update of time_zone on public.profiles for each row execute function private.validate_time_zone();
create trigger personal_time_zone before insert or update of time_zone on public.personal_events for each row execute function private.validate_time_zone();
create trigger jobs_time_zone before insert or update of time_zone on public.jobs for each row execute function private.validate_time_zone();

-- Calendar edits serialize with claims. Personal entries remain private, including to admins.
create function private.check_personal_event() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is not null and (auth.uid()<>new.user_id or not private.actor_active()) then raise exception 'Calendar owner mismatch' using errcode='42501'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.user_id::text,0));
 if exists(select 1 from public.assignment_sessions a where a.lecturer_id=new.user_id and tstzrange(a.starts_at,a.ends_at,'[)') && tstzrange(new.starts_at,new.ends_at,'[)')) then
  raise exception 'Private appointment conflicts with a confirmed assignment' using errcode='23P01';
 end if;
 return new;
end;$$;
create trigger personal_assignment_conflict before insert or update on public.personal_events for each row execute function private.check_personal_event();

-- ALL API-visible tables deny by default, including tables currently used only by privileged RPCs.
do $$declare t text; begin
 foreach t in array array['profiles','user_roles','role_permissions','topics','lecturer_topics','organisations','course_templates','course_runs','course_sessions','jobs','job_sessions','job_requirements','contracts','job_claims','assignment_sessions','personal_events','global_events','notifications','claim_events','audit_events','chat_rooms','chat_members'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon, authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 execute format('grant select on public.%I to authenticated',t);
 end loop;
end;$$;
-- Column grants prevent changing identity, activation, qualification verification, or accepted deals.
grant update(display_name,bio_de,bio_en,phone,time_zone,locale) on public.profiles to authenticated;
grant insert(user_id,topic_id), delete on public.lecturer_topics to authenticated;
grant insert(user_id,title,starts_at,ends_at,time_zone),update(title,starts_at,ends_at,time_zone),delete on public.personal_events to authenticated;
grant update(read_at) on public.notifications to authenticated;
create policy profile_read on public.profiles for select to authenticated using((select private.actor_active()) and (id=(select auth.uid()) or (select private.has_permission('users.manage'))));
create policy profile_edit on public.profiles for update to authenticated using((select private.actor_active()) and id=(select auth.uid())) with check((select private.actor_active()) and id=(select auth.uid()));
create policy own_roles on public.user_roles for select to authenticated using((select private.actor_active()) and user_id=(select auth.uid()));
create policy roles_catalogue on public.role_permissions for select to authenticated using((select private.actor_active()));
create policy topics_read on public.topics for select to authenticated using((select private.actor_active()));
create policy expertise_read on public.lecturer_topics for select to authenticated using((select private.actor_active()) and (user_id=(select auth.uid()) or (select private.has_permission('qualifications.verify'))));
create policy expertise_add on public.lecturer_topics for insert to authenticated with check((select private.actor_active()) and user_id=(select auth.uid()) and not verified and valid_until is null);
create policy expertise_remove on public.lecturer_topics for delete to authenticated using((select private.actor_active()) and user_id=(select auth.uid()));
create policy organisations_read on public.organisations for select to authenticated using((select private.has_permission('organisations.manage')));
create policy templates_read on public.course_templates for select to authenticated using((select private.has_permission('courses.manage')));
create policy runs_read on public.course_runs for select to authenticated using((select private.has_permission('courses.manage')));
create policy course_sessions_read on public.course_sessions for select to authenticated using((select private.has_permission('courses.manage')));
create policy jobs_read on public.jobs for select to authenticated using((select private.actor_active()) and ((select private.has_permission('jobs.manage')) or (status='published' and (select private.has_role(array['lecturer','senior_lecturer']))) or exists(select 1 from public.job_claims c where c.job_id=jobs.id and c.lecturer_id=(select auth.uid()))));
create policy sessions_read on public.job_sessions for select to authenticated using(exists(select 1 from public.jobs j where j.id=job_sessions.job_id));
create policy requirements_read on public.job_requirements for select to authenticated using(exists(select 1 from public.jobs j where j.id=job_requirements.job_id));
create policy own_contracts on public.contracts for select to authenticated using((select private.actor_active()) and (user_id=(select auth.uid()) or (select private.has_permission('contracts.read'))));
create policy claims_read on public.job_claims for select to authenticated using((select private.actor_active()) and (lecturer_id=(select auth.uid()) or (select private.has_permission('jobs.manage'))));
create policy allocations_read on public.assignment_sessions for select to authenticated using((select private.actor_active()) and lecturer_id=(select auth.uid()));
create policy personal_read on public.personal_events for select to authenticated using((select private.actor_active()) and user_id=(select auth.uid()));
create policy personal_insert on public.personal_events for insert to authenticated with check((select private.actor_active()) and user_id=(select auth.uid()));
create policy personal_edit on public.personal_events for update to authenticated using((select private.actor_active()) and user_id=(select auth.uid())) with check((select private.actor_active()) and user_id=(select auth.uid()));
create policy personal_delete on public.personal_events for delete to authenticated using((select private.actor_active()) and user_id=(select auth.uid()));
create policy global_read on public.global_events for select to authenticated using((select private.actor_active()) and (published or (select private.has_permission('courses.manage'))));
create policy notification_read on public.notifications for select to authenticated using((select private.actor_active()) and user_id=(select auth.uid()));
create policy notification_edit on public.notifications for update to authenticated using((select private.actor_active()) and user_id=(select auth.uid())) with check((select private.actor_active()) and user_id=(select auth.uid()));
create policy claim_event_read on public.claim_events for select to authenticated using((select private.actor_active()) and exists(select 1 from public.job_claims c where c.id=claim_events.claim_id));
create policy audit_read on public.audit_events for select to authenticated using((select private.has_permission('permissions.manage')));
create policy membership_read on public.chat_members for select to authenticated using((select private.actor_active()) and user_id=(select auth.uid()));
create policy room_read on public.chat_rooms for select to authenticated using((select private.actor_active()) and exists(select 1 from public.chat_members m where m.room_id=chat_rooms.id and m.user_id=(select auth.uid())));

-- Server-owned snapshots cannot be changed via API. Even service mutations must explicitly cancel
-- (a separate audited workflow, not provided in this milestone) instead of editing accepted terms.
create function private.immutable_claim() returns trigger language plpgsql set search_path='' as $$
begin
 if (to_jsonb(new)-'status') is distinct from (to_jsonb(old)-'status') then raise exception 'Accepted assignment snapshots are immutable' using errcode='23514'; end if;
 return new;
end;$$;
create trigger immutable_claim before update on public.job_claims for each row execute function private.immutable_claim();
create function private.bump_terms_version() returns trigger language plpgsql set search_path='' as $$
begin
 if row(new.amount,new.currency,new.rate_unit,new.total_amount,new.terms,new.requires_contract) is distinct from row(old.amount,old.currency,old.rate_unit,old.total_amount,old.terms,old.requires_contract) then new.terms_version=old.terms_version+1; end if;
 return new;
end;$$;
create trigger bump_job_terms before update on public.jobs for each row execute function private.bump_terms_version();

create function private.claim_job(p_job_id uuid,p_idempotency_key uuid,p_terms_version integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 actor uuid:=auth.uid(); j public.jobs; c public.job_claims; v_contract uuid; v_claim uuid; v_room uuid;
begin
 if not private.actor_active() then raise exception 'Authentication required' using errcode='42501'; end if;
 if p_idempotency_key is null or p_terms_version is null then raise exception 'Missing claim data' using errcode='22023'; end if;
 if not private.has_role(array['lecturer','senior_lecturer']) then return jsonb_build_object('status','not_eligible'); end if;
 -- Serialize requests per actor BEFORE per-job locking, protecting across distinct jobs and
 -- idempotency keys. Exclusion constraints provide a second independent conflict guard.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,0));
 select * into c from public.job_claims where lecturer_id=actor and idempotency_key=p_idempotency_key;
 if found then
  if c.job_id<>p_job_id then return jsonb_build_object('status','idempotency_conflict'); end if;
  return jsonb_build_object('status',c.status,'claim_id',c.id);
 end if;
 select * into j from public.jobs where id=p_job_id for update;
 if not found then return jsonb_build_object('status','unavailable'); end if;
 if j.status='filled' then return jsonb_build_object('status','filled'); end if;
 if j.status<>'published' or (j.claim_deadline is not null and j.claim_deadline<=now()) then return jsonb_build_object('status','unavailable'); end if;
 if j.terms_version<>p_terms_version then return jsonb_build_object('status','terms_changed'); end if;
 if not exists(select 1 from public.job_sessions where job_id=j.id) or exists(select 1 from public.job_sessions where job_id=j.id and starts_at<=now()) then return jsonb_build_object('status','unavailable'); end if;
 if exists(select 1 from public.job_requirements r where r.job_id=j.id and not exists(select 1 from public.lecturer_topics lt where lt.user_id=actor and lt.topic_id=r.topic_id and lt.verified and (lt.valid_until is null or lt.valid_until>=(select max(ends_at) from public.job_sessions where job_id=j.id)))) then return jsonb_build_object('status','not_eligible'); end if;
 if j.requires_contract then
  select id into v_contract from public.contracts where user_id=actor and status='active' and effective_from<=now() and (expires_at is null or expires_at>=(select max(ends_at) from public.job_sessions where job_id=j.id)) order by version desc limit 1;
  if v_contract is null then return jsonb_build_object('status','prerequisite_missing'); end if;
 end if;
 if exists(select 1 from public.job_sessions js join public.assignment_sessions a on a.lecturer_id=actor and tstzrange(a.starts_at,a.ends_at,'[)') && tstzrange(js.starts_at,js.ends_at,'[)') where js.job_id=j.id)
 or exists(select 1 from public.job_sessions js join public.personal_events e on e.user_id=actor and tstzrange(e.starts_at,e.ends_at,'[)') && tstzrange(js.starts_at,js.ends_at,'[)') where js.job_id=j.id)
 then return jsonb_build_object('status','conflict'); end if;
 insert into public.job_claims(job_id,lecturer_id,idempotency_key,amount,currency,rate_unit,total_amount,terms,terms_version,contract_id)
 values(j.id,actor,p_idempotency_key,j.amount,j.currency,j.rate_unit,j.total_amount,j.terms,j.terms_version,v_contract) returning id into v_claim;
 insert into public.assignment_sessions(claim_id,lecturer_id,starts_at,ends_at) select v_claim,actor,starts_at,ends_at from public.job_sessions where job_id=j.id;
 update public.jobs set status='filled' where id=j.id;
 insert into public.claim_events(claim_id,actor_id,event_type) values(v_claim,actor,'confirmed');
 insert into public.notifications(user_id,kind,resource_id) values(actor,'claim_confirmed',v_claim);
 insert into public.chat_rooms(job_id) values(j.id) on conflict(job_id) do update set job_id=excluded.job_id returning id into v_room;
 insert into public.chat_members(room_id,user_id) values(v_room,actor) on conflict do nothing;
 return jsonb_build_object('status','confirmed','claim_id',v_claim);
exception when exclusion_violation then
 -- PL/pgSQL exception subtransaction rolls back EVERY preceding write.
 return jsonb_build_object('status','conflict');
end;$$;
create function public.claim_job(p_job_id uuid,p_idempotency_key uuid,p_terms_version integer) returns jsonb language sql security invoker set search_path='' as $$ select private.claim_job(p_job_id,p_idempotency_key,p_terms_version); $$;

create function private.create_job(p_payload jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare v_job uuid; v_org uuid; v_template uuid; v_run uuid; v_course_session uuid; s jsonb; v_start timestamptz; v_end timestamptz; v_status text:=coalesce(p_payload->>'status','draft'); v_tz text:=coalesce(p_payload->>'time_zone','Europe/Berlin');
begin
 if not private.has_permission('jobs.manage') then raise exception 'jobs.manage and MFA required' using errcode='42501'; end if;
 if v_status not in ('draft','published') or jsonb_typeof(p_payload->'sessions') is distinct from 'array' or jsonb_array_length(p_payload->'sessions') not between 1 and 60 then raise exception 'One to sixty sessions and draft/published status required' using errcode='22023'; end if;
 if not exists(select 1 from pg_catalog.pg_timezone_names where name=v_tz) then raise exception 'Invalid IANA time zone' using errcode='22023'; end if;
 insert into public.organisations(name,time_zone) values(p_payload->>'customer_name',v_tz) returning id into v_org;
 insert into public.course_templates(title,description) values(p_payload->>'title',coalesce(p_payload->>'description','')) returning id into v_template;
 insert into public.course_runs(template_id,organisation_id,time_zone) values(v_template,v_org,v_tz) returning id into v_run;
 insert into public.jobs(course_run_id,title,description,customer_name,delivery_type,location,time_zone,status,amount,currency,rate_unit,total_amount,terms,requires_contract,claim_deadline,created_by)
 values(v_run,p_payload->>'title',coalesce(p_payload->>'description',''),p_payload->>'customer_name',p_payload->>'delivery_type',coalesce(p_payload->>'location',''),v_tz,v_status,(p_payload->>'amount')::numeric,p_payload->>'currency',p_payload->>'rate_unit',(p_payload->>'total_amount')::numeric,p_payload->>'terms',coalesce((p_payload->>'requires_contract')::boolean,false),(p_payload->>'claim_deadline')::timestamptz,auth.uid()) returning id into v_job;
 for s in select value from jsonb_array_elements(p_payload->'sessions') loop
  v_start=(s->>'starts_at')::timestamptz; v_end=(s->>'ends_at')::timestamptz;
  if v_start<=now() then raise exception 'Sessions must be in the future' using errcode='22023'; end if;
  insert into public.course_sessions(course_run_id,starts_at,ends_at) values(v_run,v_start,v_end) returning id into v_course_session;
  insert into public.job_sessions(job_id,course_session_id,starts_at,ends_at) values(v_job,v_course_session,v_start,v_end);
 end loop;
 insert into public.job_requirements(job_id,topic_id) select v_job,value::uuid from jsonb_array_elements_text(coalesce(p_payload->'topic_ids','[]'::jsonb)) on conflict do nothing;
 insert into public.audit_events(actor_id,action,resource_id) values(auth.uid(),'job.created.'||v_status,v_job);
 return v_job;
end;$$;
create function public.create_job(p_payload jsonb) returns uuid language sql security invoker set search_path='' as $$ select private.create_job(p_payload); $$;
create function private.set_job_status(p_job_id uuid,p_status text) returns void language plpgsql security definer set search_path='' as $$
declare j public.jobs;
begin
 if not private.has_permission('jobs.manage') then raise exception 'jobs.manage and MFA required' using errcode='42501'; end if;
 if p_status not in ('draft','published','archived') then raise exception 'Invalid status transition' using errcode='22023'; end if;
 select * into j from public.jobs where id=p_job_id for update;
 if not found or j.status='filled' then raise exception 'Confirmed work cannot be silently reopened' using errcode='22023'; end if;
 if p_status='published' and (not exists(select 1 from public.job_sessions where job_id=p_job_id) or exists(select 1 from public.job_sessions where job_id=p_job_id and starts_at<=now())) then raise exception 'Future sessions required' using errcode='22023'; end if;
 update public.jobs set status=p_status where id=p_job_id;
 insert into public.audit_events(actor_id,action,resource_id) values(auth.uid(),'job.status.'||p_status,p_job_id);
end;$$;
create function public.set_job_status(p_job_id uuid,p_status text) returns void language sql security invoker set search_path='' as $$ select private.set_job_status(p_job_id,p_status); $$;

-- Freeze public execution defaults and grant only the designed actor-checked interface.
revoke execute on all functions in schema private from public, anon;
grant execute on function private.actor_active(),private.has_role(text[]),private.has_permission(text),private.claim_job(uuid,uuid,integer),private.create_job(jsonb),private.set_job_status(uuid,text) to authenticated;
revoke execute on function public.claim_job(uuid,uuid,integer),public.create_job(jsonb),public.set_job_status(uuid,text),public.get_my_permissions() from public,anon;
grant execute on function public.claim_job(uuid,uuid,integer),public.create_job(jsonb),public.set_job_status(uuid,text),public.get_my_permissions() to authenticated;
-- Local SMTP invitations handled by Auth, never by a browser service-role key.
commit;
