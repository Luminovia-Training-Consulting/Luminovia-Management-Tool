begin;

-- A reviewed plan is separate from the teaching offer. The existing lifecycle
-- still performs the only status transition and fan-out into live marketplace.
create table private.job_publication_plans (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  reviewed_by uuid references public.profiles(id) on delete set null,
  job_version integer not null check (job_version > 0),
  state text not null check (state in ('scheduled', 'active', 'released', 'expired', 'cancelled', 'blocked')),
  audience text not null check (audience in ('marketplace', 'selected', 'priority')),
  opens_at timestamptz not null check (isfinite(opens_at)),
  selection_ends_at timestamptz check (isfinite(selection_ends_at) and selection_ends_at > opens_at),
  worker_request_id uuid not null unique,
  check ((audience = 'marketplace') = (selection_ends_at is null))
);
create index job_publication_plans_due_idx on private.job_publication_plans (opens_at, job_id)
  where state = 'scheduled';
create index job_publication_plans_priority_end_idx on private.job_publication_plans (selection_ends_at, job_id)
  where state = 'active' and selection_ends_at is not null;
create index job_publication_plans_reviewer_idx on private.job_publication_plans (reviewed_by);

create table private.job_publication_invitees (
  job_id uuid not null references private.job_publication_plans(job_id) on delete cascade,
  lecturer_id uuid not null references public.profiles(id) on delete cascade,
  cancelled_at timestamptz,
  primary key (job_id, lecturer_id)
);
create index job_publication_invitees_lecturer_idx on private.job_publication_invitees (lecturer_id);

create table private.job_publication_requests (
  actor_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid not null,
  job_id uuid not null references public.jobs(id) on delete cascade,
  input jsonb not null,
  receipt jsonb not null,
  primary key (actor_id, request_id)
);
create index job_publication_requests_job_idx on private.job_publication_requests (job_id);
alter table private.job_publication_plans enable row level security;
alter table private.job_publication_invitees enable row level security;
alter table private.job_publication_requests enable row level security;
revoke all on private.job_publication_plans, private.job_publication_invitees, private.job_publication_requests
  from public, anon, authenticated, service_role;

create function private.job_publication_audience_blocks(p_job uuid, p_lecturer uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from private.job_publication_plans plan
    join public.jobs job on job.id = plan.job_id and job.status in ('published','filled','archived')
    where plan.job_id = p_job and plan.state in ('active', 'expired')
      and (plan.audience = 'selected' or
        (plan.audience = 'priority' and statement_timestamp() < plan.selection_ends_at))
      and not exists (
        select 1 from private.job_publication_invitees invitee
        where invitee.job_id = plan.job_id and invitee.lecturer_id = p_lecturer
          and invitee.cancelled_at is null and statement_timestamp() < plan.selection_ends_at
      )
      and not exists (
        select 1 from public.job_claims accepted where accepted.job_id = plan.job_id
          and accepted.lecturer_id = p_lecturer and accepted.status = 'confirmed'
      )
  );
$$;

-- Current discovery, claims, notifications and course checks already share this
-- authority. Attach the narrower window without changing company membership.
do $migration$
declare
  definition text;
  anchor text := 'or private.job_lecturer_blocked_before_company_audience(p_job_id, p_lecturer_id);';
begin
  definition := pg_get_functiondef('private.job_lecturer_blocked(uuid,uuid)'::regprocedure);
  if cardinality(string_to_array(definition, anchor)) <> 2 then raise exception 'Expected current audience guard'; end if;
  execute replace(definition, anchor, replace(anchor, ';',
    ' or private.job_publication_audience_blocks(p_job_id, p_lecturer_id);'));
  definition := pg_get_functiondef('private.manage_job_offer(uuid,text,integer,uuid,jsonb)'::regprocedure);
  anchor := 'if j.lifecycle_version<>p_expected_version then';
  if cardinality(string_to_array(definition, anchor)) <> 2 then raise exception 'Expected current job revision check'; end if;
  execute replace(definition, anchor, $new$
  if p_action = 'published' and exists (
    select 1 from private.job_publication_plans plan where plan.job_id = j.id and plan.state = 'scheduled'
  ) then raise exception 'Cancel the reviewed publication plan before publishing manually' using errcode = '22023'; end if;
  if j.lifecycle_version<>p_expected_version then$new$);
end
$migration$;

create function private.require_job_publication_manager() returns void
language plpgsql stable security invoker set search_path = '' as $$
begin
  if not private.has_permission('jobs.manage')
    or not exists (select 1 from private.installation_identity where edition = 'internal') then
    raise insufficient_privilege;
  end if;
end;
$$;

create function private.job_publication_plan(p_job_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  job public.jobs;
  plan private.job_publication_plans;
begin
  perform private.require_job_publication_manager();
  select * into job from public.jobs where id = p_job_id;
  if not found then raise insufficient_privilege; end if;
  select * into plan from private.job_publication_plans where job_id = job.id;
  return jsonb_build_object('version', job.lifecycle_version, 'time_zone', job.time_zone,
    'can_schedule', job.status = 'draft', 'state', plan.state, 'audience', plan.audience,
    'opens_at', plan.opens_at, 'selection_ends_at', plan.selection_ends_at,
    'invitees', coalesce((
      select jsonb_agg(jsonb_build_object('id', invitee.lecturer_id, 'name', profile.display_name,
        'status', case when exists (select 1 from public.job_claims claim where claim.job_id = job.id
          and claim.lecturer_id = invitee.lecturer_id and claim.status = 'confirmed') then 'accepted'
          when invitee.cancelled_at is not null or plan.state in ('cancelled','blocked') then 'cancelled'
          when statement_timestamp() >= plan.selection_ends_at then 'expired'
          when plan.state = 'scheduled' then 'scheduled' else 'available' end)
        order by profile.display_name, profile.id)
      from private.job_publication_invitees invitee
      join public.profiles profile on profile.id = invitee.lecturer_id where invitee.job_id = job.id
    ), '[]'::jsonb));
end;
$$;

create function private.job_publication_candidates(p_job_id uuid, p_search text default '') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_job_publication_manager();
  if not exists (select 1 from public.jobs where id = p_job_id and status = 'draft') then
    raise insufficient_privilege;
  end if;
  if p_search is null or char_length(p_search) > 120 then raise invalid_parameter_value; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', candidate.id, 'name', candidate.display_name)
      order by candidate.display_name, candidate.id)
    from (
      select profile.id, profile.display_name from private.matching_job_lecturers(p_job_id) eligible
      join public.profiles profile on profile.id = eligible.user_id
      where strpos(lower(profile.display_name), lower(p_search)) > 0
      order by profile.display_name, profile.id limit 40
    ) candidate
  ), '[]'::jsonb);
end;
$$;

create function private.apply_reviewed_job_publication(p_job uuid) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  reviewed private.job_publication_plans;
begin
  -- The caller holds the job row. The actor was checked by the API or the worker.
  select * into strict reviewed from private.job_publication_plans where job_id = p_job and state = 'scheduled' for update;
  if reviewed.selection_ends_at <= clock_timestamp() or (
      reviewed.audience <> 'marketplace' and not exists (
        select 1 from private.job_publication_invitees invitee
        cross join lateral private.matching_job_lecturers(reviewed.job_id, invitee.lecturer_id) eligible
        where invitee.job_id = p_job and invitee.cancelled_at is null
      )
  ) then raise invalid_parameter_value using message = 'Publication recipients are no longer available'; end if;
  update private.job_publication_plans set state = case when reviewed.audience = 'marketplace' then 'released' else 'active' end
  where job_id = p_job;
  perform private.manage_job_offer(p_job, 'published', reviewed.job_version, reviewed.worker_request_id, '{}'::jsonb);
end;
$$;

create function private.job_publication_action(
  p_job_id uuid, p_action text, p_expected_version integer, p_request_id uuid, p_payload jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  who uuid := auth.uid();
  input jsonb;
  old_request private.job_publication_requests;
  job public.jobs;
  plan private.job_publication_plans;
  reviewed_audience text;
  publish_at timestamptz;
  cutoff timestamptz;
  first_start timestamptz;
  target uuid;
  recipients uuid[];
  result jsonb;
begin
  perform private.require_job_publication_manager();
  perform 1 from public.profiles where id = who and active for share;
  if not found or not private.has_permission('jobs.manage') then raise insufficient_privilege; end if;
  if p_job_id is null or p_request_id is null or p_expected_version is null
    or p_action is null or p_action not in ('schedule','cancel','cancel_invitation')
    or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text) > 4096 then
    raise invalid_parameter_value;
  end if;
  input := jsonb_build_object('action', p_action, 'job', p_job_id, 'version', p_expected_version, 'payload', p_payload);
  perform pg_advisory_xact_lock(hashtextextended('job-publication:' || who::text || p_request_id::text, 0));
  select * into old_request from private.job_publication_requests where actor_id = who and request_id = p_request_id;
  if found then
    if old_request.input <> input then raise invalid_parameter_value using message = 'Publication request was already used'; end if;
    return old_request.receipt;
  end if;
  select * into job from public.jobs where id = p_job_id for update;
  if not found then raise insufficient_privilege; end if;
  if job.lifecycle_version <> p_expected_version then raise exception 'Assignment changed' using errcode = '40001'; end if;
  select * into plan from private.job_publication_plans where job_id = job.id for update;

  if p_action = 'schedule' then
    if job.status <> 'draft' or plan.state in ('scheduled','active') or
      (p_payload - array['audience', 'opens_at', 'selection_ends_at', 'lecturer_ids']) <> '{}'::jsonb
      or jsonb_typeof(p_payload->'lecturer_ids') is distinct from 'array' then raise invalid_parameter_value; end if;
    if jsonb_array_length(p_payload->'lecturer_ids') > 40 or exists (
      select 1 from jsonb_array_elements_text(p_payload->'lecturer_ids') item(id)
      where not coalesce(pg_input_is_valid(id, 'uuid'), false)
    ) then raise invalid_parameter_value; end if;
    if (p_payload->>'opens_at' is not null and p_payload->>'opens_at' !~ '(Z|[+-][0-9]{2}:[0-9]{2})$')
      or (p_payload->>'selection_ends_at' is not null and p_payload->>'selection_ends_at' !~ '(Z|[+-][0-9]{2}:[0-9]{2})$') then
      raise invalid_parameter_value using message = 'Explicit publication offsets are required';
    end if;
    reviewed_audience := p_payload->>'audience';
    publish_at := coalesce((p_payload->>'opens_at')::timestamptz, clock_timestamp());
    cutoff := (p_payload->>'selection_ends_at')::timestamptz;
    recipients := array(select distinct id::uuid from jsonb_array_elements_text(p_payload->'lecturer_ids') item(id) order by id::uuid);
    select min(starts_at) into first_start from public.job_sessions where job_id = job.id;
    if reviewed_audience is null or reviewed_audience not in ('marketplace','selected','priority')
      or first_start is null or not isfinite(publish_at)
      or (p_payload->>'opens_at' is not null and publish_at <= clock_timestamp())
      or publish_at >= least(first_start, job.claim_deadline)
      or (reviewed_audience = 'marketplace' and (cutoff is not null or cardinality(recipients) <> 0))
      or (reviewed_audience <> 'marketplace' and (cutoff is null or not isfinite(cutoff)
        or cutoff <= publish_at or cutoff > least(first_start, job.claim_deadline) or cardinality(recipients) = 0)) then
      raise invalid_parameter_value using message = 'Publication and invitation window must precede the teaching block and its deadline';
    end if;
    if exists (select 1 from unnest(recipients) invitee(id)
      where not exists (select 1 from private.matching_job_lecturers(job.id, invitee.id))) then
      raise invalid_parameter_value using message = 'Choose currently eligible lecturers';
    end if;
    update public.jobs set lifecycle_version = job.lifecycle_version where id = job.id returning * into job;
    insert into private.job_publication_plans(job_id, reviewed_by, job_version, state, audience, opens_at, selection_ends_at, worker_request_id)
    values (job.id, who, job.lifecycle_version, 'scheduled', reviewed_audience, publish_at, cutoff, gen_random_uuid())
    on conflict (job_id) do update set reviewed_by = excluded.reviewed_by, job_version = excluded.job_version,
      state = excluded.state, audience = excluded.audience, opens_at = excluded.opens_at,
      selection_ends_at = excluded.selection_ends_at, worker_request_id = excluded.worker_request_id;
    delete from private.job_publication_invitees where job_id = job.id;
    insert into private.job_publication_invitees(job_id, lecturer_id) select job.id, id from unnest(recipients) item(id);
    if p_payload->>'opens_at' is null then perform private.apply_reviewed_job_publication(job.id); end if;
  elsif p_action = 'cancel' then
    if p_payload <> '{}'::jsonb or
      (plan.state is distinct from 'scheduled' and
       (plan.state is distinct from 'active' or job.status <> 'draft')) then
      raise invalid_parameter_value;
    end if;
    update private.job_publication_plans set state = 'cancelled' where job_id = job.id;
    update public.jobs set lifecycle_version = job.lifecycle_version where id = job.id;
  else
    target := (p_payload->>'lecturer_id')::uuid;
    if target is null or (p_payload - 'lecturer_id') <> '{}'::jsonb
      or plan.state not in ('scheduled','active') or plan.selection_ends_at <= clock_timestamp()
      or exists (select 1 from public.job_claims claim where claim.job_id = job.id
        and claim.lecturer_id = target and claim.status = 'confirmed') then raise invalid_parameter_value; end if;
    if plan.state = 'scheduled' and plan.job_version <> job.lifecycle_version then
      raise exception 'Review the changed assignment before editing its publication plan' using errcode = '40001';
    end if;
    update private.job_publication_invitees set cancelled_at = clock_timestamp()
    where job_id = job.id and lecturer_id = target and cancelled_at is null;
    if not found then raise invalid_parameter_value; end if;
    update public.jobs set lifecycle_version = job.lifecycle_version where id = job.id returning * into job;
    update private.job_publication_plans set job_version = job.lifecycle_version where job_id = job.id;
  end if;
  result := private.job_publication_plan(p_job_id);
  insert into public.audit_events(actor_id, action, resource_id, details)
  values (who, 'job.publication.' || p_action, job.id, jsonb_build_object('job_version', result->'version', 'state', result->'state'));
  insert into private.job_publication_requests(actor_id, request_id, job_id, input, receipt)
  values (who, p_request_id, p_job_id, input, result);
  return result;
end;
$$;

-- Cron locks jobs in the same order as the UI. Restore Auth configuration
-- immediately after the existing reviewed publisher has committed its work.
create function private.run_scheduled_job_publications() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  chosen record;
  context text := current_setting('request.jwt.claims', true);
  completed integer := 0;
begin
  if not exists (select 1 from private.installation_identity where edition = 'internal') then return 0; end if;
  for chosen in select plan.job_id, plan.reviewed_by
    from private.job_publication_plans plan join public.jobs job on job.id = plan.job_id
    where plan.state = 'scheduled' and plan.opens_at <= clock_timestamp()
    order by plan.opens_at, plan.job_id limit 20 for update of job skip locked
  loop
    begin
      perform 1 from public.profiles profile
        join public.user_roles role on role.user_id = profile.id
        join public.role_permissions permission on permission.role = role.role
        where profile.id = chosen.reviewed_by and profile.active and permission.permission = 'jobs.manage'
        for share of profile, role, permission;
      if not found then raise insufficient_privilege; end if;
      perform set_config('request.jwt.claims', jsonb_build_object('sub', chosen.reviewed_by, 'role', 'authenticated', 'aal', 'aal1')::text, true);
      perform private.apply_reviewed_job_publication(chosen.job_id);
      perform set_config('request.jwt.claims', coalesce(context, ''), true);
      completed := completed + 1;
    exception when insufficient_privilege or serialization_failure or invalid_parameter_value or no_data_found then
      perform set_config('request.jwt.claims', coalesce(context, ''), true);
      update private.job_publication_plans set state = 'blocked'
        where job_id = chosen.job_id and state = 'scheduled';
      insert into public.audit_events(action, resource_id, details)
      values ('job.publication.blocked', chosen.job_id, jsonb_build_object('result', sqlstate));
    end;
  end loop;

  for chosen in select plan.job_id, plan.audience, job.status
    from private.job_publication_plans plan join public.jobs job on job.id = plan.job_id
    where plan.state = 'active' and plan.selection_ends_at <= clock_timestamp()
    order by plan.selection_ends_at, plan.job_id limit 20 for update of job skip locked
  loop
    update private.job_publication_plans set state = case when chosen.audience = 'priority' then 'released' else 'expired' end
      where job_id = chosen.job_id and state = 'active';
    if chosen.audience = 'priority' and chosen.status = 'published' then
      insert into public.notifications(user_id, kind, resource_id)
      select user_id, 'job_matching', chosen.job_id from private.matching_job_lecturers(chosen.job_id)
      on conflict (user_id, kind, resource_id) do nothing;
    end if;
    completed := completed + 1;
  end loop;
  return completed;
end;
$$;

create function private.ensure_job_publication_schedule() returns boolean
language plpgsql security invoker set search_path = '' as $$
declare
  job_number bigint;
  use_socket boolean := current_user = 'supabase_admin' and current_setting('cron.use_background_workers', true) = 'off';
begin
  if current_database() is distinct from current_setting('cron.database_name', true)
    or not exists (select 1 from pg_extension where extname = 'pg_cron')
    or not has_schema_privilege(current_user, 'cron', 'USAGE') then return false; end if;
  if exists (select 1 from cron.job where jobname = 'portal-job-publication'
    and command = 'select private.run_scheduled_job_publications()' and active
    and (not use_socket or nodename = '')) then return true; end if;
  job_number := cron.schedule('portal-job-publication', '* * * * *', 'select private.run_scheduled_job_publications()');
  if use_socket then update cron.job set nodename = '' where jobid = job_number; end if;
  return true;
end;
$$;

create function public.job_publication_plan(p_job_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$ select private.job_publication_plan(p_job_id); $$;
create function public.job_publication_candidates(p_job_id uuid, p_search text default '') returns jsonb
language sql stable security invoker set search_path = '' as $$ select private.job_publication_candidates(p_job_id, p_search); $$;
create function public.job_publication_action(
  p_job_id uuid, p_action text, p_expected_version integer, p_request_id uuid, p_payload jsonb
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.job_publication_action(p_job_id, p_action, p_expected_version, p_request_id, p_payload);
$$;
revoke all on function private.job_publication_audience_blocks(uuid,uuid), private.require_job_publication_manager(),
  private.apply_reviewed_job_publication(uuid), private.ensure_job_publication_schedule(), private.run_scheduled_job_publications(),
  private.job_publication_plan(uuid), public.job_publication_plan(uuid),
  private.job_publication_candidates(uuid,text), public.job_publication_candidates(uuid,text),
  private.job_publication_action(uuid,text,integer,uuid,jsonb), public.job_publication_action(uuid,text,integer,uuid,jsonb)
from public, anon, authenticated, service_role;
grant execute on function private.job_publication_plan(uuid), public.job_publication_plan(uuid),
  private.job_publication_candidates(uuid,text), public.job_publication_candidates(uuid,text),
  private.job_publication_action(uuid,text,integer,uuid,jsonb), public.job_publication_action(uuid,text,integer,uuid,jsonb)
to authenticated;

select private.ensure_job_publication_schedule();
notify pgrst, 'reload schema';
commit;
