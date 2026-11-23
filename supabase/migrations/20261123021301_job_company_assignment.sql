begin;

-- A standalone job already owns a dedicated course run. Use that relationship
-- for the company, so discovery, company access and blocks all agree.
create function private.lock_job_company(p_organisation_id uuid)
returns text language plpgsql volatile security invoker set search_path = '' as $$
declare company_name text;
begin
  select organisation.name into company_name from public.organisations organisation
  where organisation.id = p_organisation_id and organisation.archived_at is null
  for share;
  if not found then
    raise exception 'Organisation unavailable' using errcode = '22023';
  end if;
  return company_name;
end;
$$;

create function private.job_company_reassignable(p_job_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from public.jobs job
    join public.course_runs run on run.id = job.course_run_id
    where job.id = p_job_id and job.status in ('draft', 'published')
      and not run.published and run.archived_at is null
      -- Only the standalone net creator emits this provenance event.
      and exists (
        select 1 from public.audit_events event
        where event.resource_id = job.id and event.action in ('job.created.draft', 'job.created.published')
      )
      and not exists (select 1 from public.job_sessions where job_id = job.id and starts_at <= now())
      and not exists (select 1 from public.job_claims where job_id = job.id)
      and not exists (select 1 from private.job_commission_offers where job_id = job.id)
      and not exists (select 1 from private.client_course_requests where job_id = job.id)
      and not exists (select 1 from public.jobs sibling where sibling.course_run_id = run.id and sibling.id <> job.id)
      and not exists (select 1 from public.course_enrolments where course_run_id = run.id)
      and not exists (select 1 from public.chat_rooms where course_run_id = run.id or job_id = job.id)
      and not exists (select 1 from private.course_class_assignments where course_id = run.id)
      and not exists (select 1 from private.course_workspace_settings where run_id = run.id and contact_id is not null)
      and not exists (select 1 from private.course_resources where run_id = run.id and removed_at is null)
      and not exists (select 1 from private.course_readiness_settings where course_run_id = run.id and meeting_url <> '')
      and not exists (
        select 1 from private.job_briefings briefing where briefing.job_id = job.id
          and concat(briefing.contact_name, briefing.contact_email, briefing.contact_phone, briefing.contact_description) <> ''
      )
  );
$$;

create function private.change_job_company(p_job public.jobs, p_organisation_id uuid)
returns text language plpgsql volatile security invoker set search_path = '' as $$
declare company_name text;
begin
  -- The caller has locked the job and checked its version. Also lock the run
  -- against new FK dependants and keep the selected active company stable.
  perform 1 from public.course_runs where id = p_job.course_run_id for update;
  if not private.job_company_reassignable(p_job.id) then
    raise exception 'The job company is fixed by its source or course activity' using errcode = '22023';
  end if;
  company_name := private.lock_job_company(p_organisation_id);
  update public.course_runs set organisation_id = p_organisation_id
  where id = p_job.course_run_id and organisation_id is distinct from p_organisation_id;
  if found then
    insert into public.audit_events(actor_id, action, resource_id, details)
    values(auth.uid(), 'job.company_assigned', p_job.id, jsonb_build_object('organisation_id', p_organisation_id));
  end if;
  return company_name;
end;
$$;
revoke all on function private.lock_job_company(uuid), private.job_company_reassignable(uuid),
  private.change_job_company(public.jobs, uuid) from public, anon, authenticated, service_role;

do $migration$
declare
  source text;
  original constant text := $old$ insert into public.organisations(name,time_zone) values(p_payload->>'customer_name',v_tz) returning id into v_org;$old$;
begin
  source := pg_get_functiondef('private.create_job_before_readiness(jsonb)'::regprocedure);
  if cardinality(string_to_array(source, original)) <> 2 then
    raise exception 'Expected standalone job company creation seam';
  end if;
  source := replace(source, original, $new$
  if p_payload ? 'organisation_id' then
    if jsonb_typeof(p_payload->'organisation_id') is distinct from 'string' then
      raise exception 'Expected organisation ID' using errcode = '22023';
    end if;
    v_org := (p_payload->>'organisation_id')::uuid;
    p_payload := jsonb_set(p_payload, '{customer_name}', to_jsonb(private.lock_job_company(v_org)));
  else
    insert into public.organisations(name,time_zone) values(p_payload->>'customer_name',v_tz) returning id into v_org;
  end if;$new$);
  execute source;
end;
$migration$;

do $migration$
declare
  source text;
  original constant text := $old$  if p_organisation_id is not null then raise exception 'Organisation pricing requires the gross workflow' using errcode='22023';end if;
  result=private.create_job(p_payload);$old$;
begin
  source := pg_get_functiondef('private.create_capacity_job(jsonb,integer,uuid,uuid,numeric)'::regprocedure);
  if cardinality(string_to_array(source, original)) <> 2 then
    raise exception 'Expected net job capacity company assignment seam';
  end if;
  execute replace(source, original, $new$  result=private.create_job(case
    when p_organisation_id is not null then (p_payload - 'organisation_id') || jsonb_build_object('organisation_id', p_organisation_id)
    else p_payload - 'organisation_id'
  end);$new$);
end;
$migration$;

do $migration$
declare
  source text;
  marker constant text := $old$'can_manage',manager,'can_edit'$old$;
begin
  source := pg_get_functiondef('private.job_lifecycle(uuid)'::regprocedure);
  if cardinality(string_to_array(source, marker)) <> 2 then
    raise exception 'Expected job lifecycle company projection seam';
  end if;
  execute replace(source, marker, $new$'can_manage',manager,
    'organisation_id',case when manager then (select organisation_id from public.course_runs where id = j.course_run_id) end,
    'can_reassign_company',case when manager then private.job_company_reassignable(j.id) else false end,
    'can_edit'$new$);
end;
$migration$;

do $migration$
declare
  source text;
  keys constant text := 'for k in select jsonb_object_keys(p_payload) loop';
  metadata constant text := 'update public.jobs set title=case';
  consent constant text := $old$array['sessions','topic_ids'] then j.terms_version+1$old$;
begin
  source := pg_get_functiondef('private.manage_job_offer(uuid,text,integer,uuid,jsonb)'::regprocedure);
  if cardinality(string_to_array(source, keys)) <> 2 or cardinality(string_to_array(source, metadata)) <> 2
    or cardinality(string_to_array(source, consent)) <> 2 then
    raise exception 'Expected job lifecycle company edit seams';
  end if;
  source := replace(source, keys, keys || $new$
    if k = 'organisation_id' then
      if p_action <> 'edit' or jsonb_typeof(p_payload->k) is distinct from 'string' then
        raise exception 'An organisation ID is valid only on an edit' using errcode = '22023';
      end if;
      continue;
    end if;
  $new$);
  source := replace(source, metadata, $new$if p_payload ? 'organisation_id' then
     j.customer_name := private.change_job_company(j, (p_payload->>'organisation_id')::uuid);
   end if;
   update public.jobs set customer_name=j.customer_name,title=case$new$);
  execute replace(source, consent, $new$array['sessions','topic_ids','organisation_id'] then j.terms_version+1$new$);
end;
$migration$;

notify pgrst, 'reload schema';
commit;
