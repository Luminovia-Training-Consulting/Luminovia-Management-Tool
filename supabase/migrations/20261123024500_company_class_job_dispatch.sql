begin;

-- Internal company scheduling metadata is available independently of Premium.
alter table private.course_classes add column meeting_url text
  check (length(meeting_url) <= 2048);

create table private.company_dispatch_settings (
  organisation_id uuid primary key references public.organisations(id) on delete cascade,
  contact_id uuid references public.organisation_contacts(id) on delete set null
);

-- Snapshot public-for-assignment details without overwriting authored briefings.
create table private.job_dispatch (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  organisation_id uuid not null,
  class_id uuid,
  class_name text,
  meeting_url text,
  contact jsonb,
  foreign key (class_id, organisation_id) references private.course_classes(id, organisation_id)
);
alter table private.company_dispatch_settings enable row level security;
alter table private.job_dispatch enable row level security;
revoke all on private.company_dispatch_settings, private.job_dispatch from public, anon, authenticated, service_role;

create function private.company_dispatch_allowed(p_organisation_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.actor_active()
    and exists (select 1 from private.installation_identity where edition = 'internal')
    and exists (select 1 from public.organisations where id = p_organisation_id and archived_at is null)
    and (private.has_permission('jobs.manage') or private.has_permission('organisations.manage')
      or private.client_has_organisation(p_organisation_id));
$$;

create function private.dispatch_classes(p_organisation_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name,
    'meeting_url', c.meeting_url) order by lower(c.name), c.id), '[]'::jsonb)
  from private.course_classes c where c.organisation_id = p_organisation_id;
$$;

create function private.dispatch_contact(p_organisation_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('name', c.name, 'email', c.email, 'phone', c.phone)
  from private.company_dispatch_settings s
  join public.organisation_contacts c on c.id = s.contact_id and c.organisation_id = s.organisation_id
  where s.organisation_id = p_organisation_id and c.archived_at is null;
$$;

create function private.company_class_directory(p_organisation_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.company_dispatch_allowed(p_organisation_id) then raise insufficient_privilege; end if;
  return jsonb_build_object(
    'classes', private.dispatch_classes(p_organisation_id),
    'contact_id', (select c.id from private.company_dispatch_settings s join public.organisation_contacts c
      on c.id = s.contact_id and c.organisation_id = s.organisation_id
      where s.organisation_id = p_organisation_id and c.archived_at is null),
    'contacts', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'name', c.name, 'email', c.email, 'phone', c.phone) order by lower(c.name), c.id), '[]'::jsonb)
      from public.organisation_contacts c where c.organisation_id = p_organisation_id and c.archived_at is null)
  );
end;
$$;

create function private.save_company_dispatch_settings(
  p_organisation_id uuid, p_contact_id uuid, p_new_contact jsonb default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  contact_id uuid := p_contact_id;
  name text;
  email text;
  phone text;
begin
  if not private.company_dispatch_allowed(p_organisation_id) then raise insufficient_privilege; end if;
  perform 1 from public.organisations where id = p_organisation_id for update;
  if not private.company_dispatch_allowed(p_organisation_id) then raise insufficient_privilege; end if;
  if p_new_contact is not null then
    if contact_id is not null or jsonb_typeof(p_new_contact) <> 'object'
      or p_new_contact - array['name','email','phone'] <> '{}'::jsonb
      or jsonb_typeof(p_new_contact->'name') is distinct from 'string'
      or coalesce(jsonb_typeof(p_new_contact->'email'), 'string') <> 'string'
      or coalesce(jsonb_typeof(p_new_contact->'phone'), 'string') <> 'string' then
      raise invalid_parameter_value;
    end if;
    name := btrim(p_new_contact->>'name');
    email := btrim(coalesce(p_new_contact->>'email', ''));
    phone := btrim(coalesce(p_new_contact->>'phone', ''));
    if length(name) not between 1 and 120 or length(email) > 254 or length(phone) > 50
      or concat(name, email, phone) ~ '[[:cntrl:]]'
      or (email <> '' and email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$') then
      raise invalid_parameter_value;
    end if;
    insert into public.organisation_contacts(organisation_id, name, email, phone)
      values (p_organisation_id, name, email, phone) returning id into contact_id;
  elsif contact_id is not null and not exists (
    select 1 from public.organisation_contacts c where c.id = contact_id
      and c.organisation_id = p_organisation_id and c.archived_at is null
  ) then
    raise insufficient_privilege;
  end if;
  insert into private.company_dispatch_settings values (p_organisation_id, contact_id)
    on conflict (organisation_id) do update set contact_id = excluded.contact_id;
  return private.company_class_directory(p_organisation_id);
end;
$$;

create function private.save_company_dispatch_class(
  p_organisation_id uuid, p_class_id uuid, p_name text, p_meeting_url text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  class_name text := btrim(p_name);
  room_url text := nullif(btrim(p_meeting_url), '');
  authority text;
  port text;
begin
  if not private.company_dispatch_allowed(p_organisation_id) then raise insufficient_privilege; end if;
  if class_name is null or length(class_name) not between 1 and 100 or class_name ~ '[[:cntrl:]]' then
    raise invalid_parameter_value;
  end if;
  if room_url is not null then
    authority := substring(room_url from '^https://([^/?#]+)');
    port := nullif(split_part(authority, ':', 2), '');
    if length(room_url) > 2048 or room_url collate "C" !~ '^[!-~]+$'
      or strpos(room_url, chr(92)) > 0 or authority is null
      or authority collate "C" !~ '^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?[.])+[a-zA-Z]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(:[0-9]{1,5})?$'
      or length(split_part(authority, ':', 1)) > 253 then raise invalid_parameter_value; end if;
    if port is not null and port::integer not between 1 and 65535 then raise invalid_parameter_value; end if;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('course-class:' || p_organisation_id::text, 0));
  if not private.company_dispatch_allowed(p_organisation_id) then raise insufficient_privilege; end if;
  if p_class_id is null then
    if (select count(*) from private.course_classes where organisation_id = p_organisation_id) >= 100 then
      raise exception 'Class limit reached' using errcode = 'PT409';
    end if;
    insert into private.course_classes(organisation_id, name, meeting_url)
      values (p_organisation_id, class_name, room_url);
  else
    update private.course_classes c set name = class_name, meeting_url = room_url
      where c.id = p_class_id and c.organisation_id = p_organisation_id;
    if not found then raise insufficient_privilege; end if;
  end if;
  return private.company_class_directory(p_organisation_id);
end;
$$;

create function private.job_dispatch_company_actor(p_job_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (select 1 from private.installation_identity where edition = 'internal')
    and private.deletion_can_manage_job(p_job_id);
$$;

-- Company contacts can open their own operational detail. This does not widen
-- the generic marketplace access gate or expose lecturer terms and prices.
create or replace function private.job_detail(p_job_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare j public.jobs;
begin
  if private.can_read_job(p_job_id) then return private.job_discovery_item(p_job_id); end if;
  if not private.job_dispatch_company_actor(p_job_id) then raise insufficient_privilege; end if;
  select * into strict j from public.jobs where id = p_job_id;
  return jsonb_build_object('dispatch_only', true, 'id', j.id, 'title', j.title, 'description', j.description,
    'customer_name', j.customer_name, 'delivery_type', j.delivery_type, 'location', j.location,
    'time_zone', j.time_zone, 'status', j.status, 'amount', null, 'total_amount', null,
    'currency', j.currency, 'rate_unit', j.rate_unit, 'terms', '', 'terms_version', j.terms_version,
    'requires_contract', false, 'claim_deadline', null, 'capacity', j.capacity,
    'capacity_basis', j.capacity_basis, 'created_at', j.created_at,
    'job_sessions', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'job_id', s.job_id,
      'starts_at', s.starts_at, 'ends_at', s.ends_at) order by s.starts_at, s.id)
      from public.job_sessions s where s.job_id = j.id), '[]'::jsonb),
    'job_requirements', '[]'::jsonb,
    'confirmed_count', (select count(*) from public.job_claims where job_id = j.id and status = 'confirmed'),
    'open_positions', case when j.status = 'published' then greatest(0, j.capacity -
      (select count(*) from public.job_claims where job_id = j.id and status = 'confirmed')) else 0 end);
end;
$$;

create function private.job_dispatch_editable(p_job public.jobs, p_organisation_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select p_job.status in ('draft', 'published', 'filled')
    and private.company_dispatch_allowed(p_organisation_id)
    and (private.has_permission('jobs.manage') or private.job_dispatch_company_actor(p_job.id));
$$;

create function private.job_dispatch_options(p_job_id uuid, p_organisation_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  job public.jobs;
  current_company uuid;
begin
  select * into job from public.jobs where id = p_job_id;
  select organisation_id into current_company from public.course_runs where id = job.course_run_id;
  if job.id is null or not (private.can_read_job(p_job_id) or private.job_dispatch_company_actor(p_job_id))
    or not private.job_dispatch_editable(job, p_organisation_id)
    or (p_organisation_id is distinct from current_company and not
      (private.has_permission('jobs.manage') and private.job_company_reassignable(job.id))) then
    raise insufficient_privilege;
  end if;
  return jsonb_build_object('classes', private.dispatch_classes(p_organisation_id),
    'contact', private.dispatch_contact(p_organisation_id));
end;
$$;

create function private.write_job_dispatch(p_job public.jobs, p_class_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  company uuid;
  selected private.course_classes;
begin
  select organisation_id into company from public.course_runs where id = p_job.course_run_id;
  if not private.job_dispatch_editable(p_job, company) then raise insufficient_privilege; end if;
  if p_class_id is not null then
    select * into selected from private.course_classes c
      where c.id = p_class_id and c.organisation_id = company for share;
    if not found then raise insufficient_privilege; end if;
  end if;
  insert into private.job_dispatch(job_id, organisation_id, class_id, class_name, meeting_url, contact)
    values (p_job.id, company, selected.id, selected.name, selected.meeting_url, private.dispatch_contact(company))
  on conflict (job_id) do update set organisation_id = excluded.organisation_id, class_id = excluded.class_id,
    class_name = excluded.class_name, meeting_url = excluded.meeting_url, contact = excluded.contact;
end;
$$;

create function private.save_job_dispatch(p_job_id uuid, p_class_id uuid, p_expected_version integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare job public.jobs;
begin
  select * into job from public.jobs where id = p_job_id for update;
  if job.id is null
    or not (private.has_permission('jobs.manage') or private.job_dispatch_company_actor(job.id)) then
    raise insufficient_privilege;
  end if;
  if p_expected_version is distinct from job.lifecycle_version then
    raise exception 'Job changed' using errcode = 'PT409';
  end if;
  perform private.write_job_dispatch(job, p_class_id);
  update public.jobs set lifecycle_version = lifecycle_version + 1 where id = job.id;
  insert into public.audit_events(actor_id, action, resource_id, details)
    values (auth.uid(), 'job.dispatch_saved', job.id, jsonb_build_object('class_id', p_class_id));
  return job.id;
end;
$$;

create function private.job_dispatch_projection(p_job public.jobs)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  company uuid;
  assignment private.job_dispatch;
  visible boolean := private.has_permission('jobs.manage') or private.job_dispatch_company_actor(p_job.id)
    or (private.lecturer_actor() and exists (select 1 from public.job_claims
      where job_id = p_job.id and lecturer_id = auth.uid() and status = 'confirmed'));
begin
  select organisation_id into company from public.course_runs where id = p_job.course_run_id;
  if visible then
    select * into assignment from private.job_dispatch where job_id = p_job.id and organisation_id = company;
  end if;
  return jsonb_build_object('class_id', assignment.class_id, 'class_name', assignment.class_name,
    'meeting_url', assignment.meeting_url, 'dispatch_contact', assignment.contact,
    'can_edit_dispatch', coalesce(private.job_dispatch_editable(p_job, company), false));
end;
$$;

create function public.company_class_directory(p_organisation_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.company_class_directory(p_organisation_id);
$$;
create function public.save_company_dispatch_settings(p_organisation_id uuid, p_contact_id uuid, p_new_contact jsonb default null)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.save_company_dispatch_settings(p_organisation_id, p_contact_id, p_new_contact);
$$;
create function public.save_company_dispatch_class(p_organisation_id uuid, p_class_id uuid, p_name text, p_meeting_url text)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.save_company_dispatch_class(p_organisation_id, p_class_id, p_name, p_meeting_url);
$$;
create function public.job_dispatch_options(p_job_id uuid, p_organisation_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.job_dispatch_options(p_job_id, p_organisation_id);
$$;
create function public.save_job_dispatch(p_job_id uuid, p_class_id uuid, p_expected_version integer)
returns uuid language sql security invoker set search_path = '' as $$
  select private.save_job_dispatch(p_job_id, p_class_id, p_expected_version);
$$;

revoke all on function private.company_dispatch_allowed(uuid), private.dispatch_classes(uuid), private.dispatch_contact(uuid),
  private.job_dispatch_editable(public.jobs,uuid), private.write_job_dispatch(public.jobs,uuid),
  private.job_dispatch_projection(public.jobs), private.job_dispatch_company_actor(uuid),
  public.company_class_directory(uuid), private.company_class_directory(uuid),
  public.save_company_dispatch_settings(uuid,uuid,jsonb), private.save_company_dispatch_settings(uuid,uuid,jsonb),
  public.save_company_dispatch_class(uuid,uuid,text,text), private.save_company_dispatch_class(uuid,uuid,text,text),
  public.job_dispatch_options(uuid,uuid), private.job_dispatch_options(uuid,uuid),
  public.save_job_dispatch(uuid,uuid,integer), private.save_job_dispatch(uuid,uuid,integer)
from public, anon, authenticated, service_role;

grant execute on function public.company_class_directory(uuid), private.company_class_directory(uuid),
  public.save_company_dispatch_settings(uuid,uuid,jsonb), private.save_company_dispatch_settings(uuid,uuid,jsonb),
  public.save_company_dispatch_class(uuid,uuid,text,text), private.save_company_dispatch_class(uuid,uuid,text,text),
  public.job_dispatch_options(uuid,uuid), private.job_dispatch_options(uuid,uuid),
  public.save_job_dispatch(uuid,uuid,integer), private.save_job_dispatch(uuid,uuid,integer)
to authenticated;

do $migration$
declare
  definition text;
  lifecycle_marker constant text := $old$return jsonb_build_object('version',j.lifecycle_version$old$;
  read_marker constant text := $old$or not private.can_read_job(j.id) then$old$;
  budget_marker constant text := $old$'max_net_budget',case when$old$;
  organisation_marker constant text := $old$'organisation_id',case when manager then$old$;
  validation_marker constant text := $old$for k in select jsonb_object_keys(p_payload) loop$old$;
  save_marker constant text := $old$update public.jobs set customer_name=j.customer_name,title=case$old$;
begin
  definition := pg_get_functiondef('private.job_lifecycle(uuid)'::regprocedure);
  if cardinality(string_to_array(definition, lifecycle_marker)) <> 2
    or cardinality(string_to_array(definition, organisation_marker)) <> 2
    or cardinality(string_to_array(definition, budget_marker)) <> 2
    or cardinality(string_to_array(definition, read_marker)) <> 2 then
    raise exception 'Expected lifecycle dispatch projection seams';
  end if;
  definition := replace(definition, lifecycle_marker,
    $new$return private.job_dispatch_projection(j) || jsonb_build_object('version',j.lifecycle_version$new$);
  definition := replace(definition, read_marker,
    $new$or not (private.can_read_job(j.id) or private.job_dispatch_company_actor(j.id)) then$new$);
  definition := replace(definition, budget_marker,
    $new$'max_net_budget',case when not private.can_read_job(j.id) then null when$new$);
  execute replace(definition, organisation_marker,
    $new$'organisation_id',case when manager or private.job_dispatch_company_actor(j.id) then$new$);

  definition := pg_get_functiondef('private.manage_job_offer(uuid,text,integer,uuid,jsonb)'::regprocedure);
  if cardinality(string_to_array(definition, validation_marker)) <> 2
    or cardinality(string_to_array(definition, save_marker)) <> 2 then
    raise exception 'Expected job edit dispatch seams';
  end if;
  definition := replace(definition, validation_marker, validation_marker || $new$
    if k = 'class_id' then
      if p_action <> 'edit' or jsonb_typeof(p_payload->k) not in ('string', 'null') then
        raise invalid_parameter_value;
      end if;
      continue;
    end if;
  $new$);
  execute replace(definition, save_marker, $new$
    if p_payload ?| array['organisation_id', 'class_id'] then
      perform private.write_job_dispatch(j, (p_payload->>'class_id')::uuid);
    elsif not exists (select 1 from private.job_dispatch where job_id = j.id)
      and exists (select 1 from public.course_runs r join private.company_dispatch_settings s
        on s.organisation_id = r.organisation_id and s.contact_id is not null
        where r.id = j.course_run_id and private.company_dispatch_allowed(s.organisation_id)) then
      perform private.write_job_dispatch(j, null);
    end if;
  $new$ || save_marker);
end;
$migration$;

-- Include the new owned records in the confirmed deletion preview and fence.
create trigger permanent_deletion_fence before insert or update or delete on private.job_dispatch
for each row execute function private.guard_permanent_deletion();
create trigger permanent_deletion_fence before insert or update or delete on private.company_dispatch_settings
for each row execute function private.guard_permanent_deletion();

do $migration$
declare
  definition text := pg_get_functiondef('private.deletion_scope(text,uuid)'::regprocedure);
  marker constant text := 'return scope;';
begin
  if cardinality(string_to_array(definition, marker)) <> 2 then
    raise exception 'Expected deletion scope seam for company dispatch';
  end if;
  execute replace(definition, marker, $new$
  if private.deletion_selector(scope, 'public.jobs') is not null then
    scope := private.deletion_add_scope(scope, 'private.job_dispatch',
      format('x.job_id in (select scoped.id from public.jobs scoped where %s)',
        replace(private.deletion_selector(scope, 'public.jobs'), 'x.', 'scoped.')));
  end if;
  if private.deletion_selector(scope, 'public.organisations') is not null then
    scope := private.deletion_add_scope(scope, 'private.company_dispatch_settings',
      format('x.organisation_id in (select scoped.id from public.organisations scoped where %s)',
        replace(private.deletion_selector(scope, 'public.organisations'), 'x.', 'scoped.')));
  end if;
  return scope;$new$);
end;
$migration$;

notify pgrst, 'reload schema';
commit;
