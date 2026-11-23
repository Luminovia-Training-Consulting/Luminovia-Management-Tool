begin;

create function private.can_edit_linked_course_details(p_job public.jobs)
returns boolean language sql stable set search_path = '' as $$
  select p_job.status = 'draft'
    and private.has_permission('courses.manage')
    and private.can_edit_job_schedule(p_job)
    and private.job_company_reassignable(p_job.id);
$$;

create function private.edit_linked_course_details(p_job public.jobs, p_patch jsonb)
returns void language plpgsql set search_path = '' as $$
declare
  new_template_id uuid := (p_patch->>'course_template_id')::uuid;
begin
  perform 1 from public.course_runs where id = p_job.course_run_id for update;
  if not coalesce(private.can_edit_linked_course_details(p_job), false) then
    raise exception 'course_locked' using errcode = '22023';
  end if;

  if p_patch ? 'course_template_id' then
    perform 1 from public.course_templates template
    where template.id = new_template_id and template.archived_at is null
    for share;
    if not found then raise exception 'Course template unavailable' using errcode = '22023'; end if;
  end if;

  update public.course_runs run set
    template_id = coalesce(new_template_id, run.template_id),
    time_zone = coalesce(p_patch->>'time_zone', run.time_zone),
    delivery_type = coalesce(p_patch->>'delivery_type', run.delivery_type)
  where run.id = p_job.course_run_id;
end;
$$;

create function private.save_linked_course_run(p_run public.course_runs, p_payload jsonb)
returns uuid language plpgsql set search_path = '' as $$
declare
  job public.jobs;
  patch jsonb := '{}'::jsonb;
begin
  if jsonb_typeof(p_payload->'sessions') is distinct from 'array'
     or exists (
       select 1 from jsonb_array_elements(p_payload->'sessions') slot
       where coalesce(slot->>'starts_at', '') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
          or coalesce(slot->>'ends_at', '') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
     ) then
    raise exception 'Explicit instants required' using errcode = '22023';
  end if;

  if p_run.template_id is distinct from (p_payload->>'template_id')::uuid then
    patch := patch || jsonb_build_object('course_template_id', p_payload->'template_id');
  end if;
  if p_run.organisation_id is distinct from nullif(p_payload->>'organisation_id', '')::uuid then
    patch := patch || jsonb_build_object('organisation_id', p_payload->'organisation_id');
  end if;
  if p_run.time_zone is distinct from p_payload->>'time_zone' then
    patch := patch || jsonb_build_object('time_zone', p_payload->'time_zone');
  end if;
  if p_run.delivery_type is distinct from p_payload->>'delivery_type' then
    patch := patch || jsonb_build_object('delivery_type', p_payload->'delivery_type');
  end if;
  if exists (
    with desired as (
      select slot.starts_at, slot.ends_at
      from jsonb_to_recordset(p_payload->'sessions') slot(starts_at timestamptz, ends_at timestamptz)
    ), current_slots as (
      select starts_at, ends_at from public.course_sessions where course_run_id = p_run.id
    )
    (select * from current_slots except all select * from desired)
    union all
    (select * from desired except all select * from current_slots)
  ) then
    patch := patch || jsonb_build_object('sessions', p_payload->'sessions');
  end if;

  if patch <> '{}'::jsonb then
    if not private.has_permission('jobs.manage') then raise insufficient_privilege; end if;
    select * into job from public.jobs where course_run_id = p_run.id order by id limit 1;
    if job.id is null or exists (
      select 1 from public.jobs sibling where sibling.course_run_id = p_run.id and sibling.id <> job.id
    ) then
      raise exception 'course_locked' using errcode = '22023';
    end if;
    if p_payload->>'expected_job_version' is null or p_payload->>'job_request_id' is null then
      raise exception 'course_locked' using errcode = '22023';
    end if;
    perform private.manage_job_offer(
      job.id, 'edit', (p_payload->>'expected_job_version')::integer,
      (p_payload->>'job_request_id')::uuid, patch
    );
  end if;

  perform private.set_course_visibility(
    p_run.id, coalesce((p_payload->>'published')::boolean, false),
    coalesce((p_payload->>'archived')::boolean, false)
  );
  update public.course_runs set venue = coalesce(p_payload->>'venue', '') where id = p_run.id;
  insert into public.audit_events(actor_id, action, resource_id, details)
  values (auth.uid(), 'course.run.saved', p_run.id, jsonb_build_object('linked', true));
  return p_run.id;
end;
$$;

revoke all on function private.can_edit_linked_course_details(public.jobs),
  private.edit_linked_course_details(public.jobs,jsonb),
  private.save_linked_course_run(public.course_runs,jsonb)
from public, anon, authenticated, service_role;

do $migration$
declare
  definition text := pg_get_functiondef('private.protect_building_block_provenance()'::regprocedure);
  check_run constant text := 'exists(select 1 from public.jobs where course_run_id=(previous_row->>''id'')::uuid)';
begin
  if cardinality(string_to_array(definition, check_run)) <> 2 then
    raise exception 'Expected offered run template guard';
  end if;
  execute replace(definition, check_run, $new$
    exists (
      select 1 from public.jobs job where job.course_run_id = (previous_row->>'id')::uuid
        and not coalesce(private.can_edit_linked_course_details(job), false)
    )$new$);
end;
$migration$;

do $migration$
declare
  definition text := pg_get_functiondef('private.save_course_run(uuid,jsonb)'::regprocedure);
  start_marker constant text := '    perform 1 from public.course_runs where id = target for update;';
  end_marker constant text := '    update public.course_runs run';
  declaration constant text := '  item jsonb;';
  start_at integer;
  end_at integer;
begin
  if cardinality(string_to_array(definition, start_marker)) <> 2
     or cardinality(string_to_array(definition, end_marker)) <> 2
     or cardinality(string_to_array(definition, declaration)) <> 2 then
    raise exception 'Expected linked course edit seams';
  end if;
  definition := replace(definition, declaration, declaration || ' run_row public.course_runs;');
  start_at := strpos(definition, start_marker);
  end_at := strpos(definition, end_marker);
  execute overlay(definition placing $new$
    perform 1 from public.profiles where id = auth.uid() and active for share;
    if not found then raise insufficient_privilege; end if;
    if p_payload->>'job_request_id' is not null then
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
        'job-request:' || auth.uid()::text || (p_payload->>'job_request_id')::uuid::text, 0
      ));
    end if;
    -- Match the job lifecycle and coordinated amendments: lock offers before the run.
    perform 1 from public.jobs where course_run_id = target order by id for update;
    select * into run_row from public.course_runs where id = target for update;
    if not found then raise exception 'Run not found' using errcode = '22023'; end if;
    if exists (select 1 from public.jobs where course_run_id = target) then
      return private.save_linked_course_run(run_row, p_payload);
    end if;
$new$ from start_at for end_at - start_at);

  definition := pg_get_functiondef('private.job_lifecycle(uuid)'::regprocedure);
  if cardinality(string_to_array(definition, '''can_edit_schedule'',manager')) <> 2 then
    raise exception 'Expected job planning capability seam';
  end if;
  execute replace(definition, '''can_edit_schedule'',manager',
    '''can_edit_course_details'',manager and private.can_edit_linked_course_details(j),''can_edit_schedule'',manager');
end;
$migration$;

do $migration$
declare
  definition text := pg_get_functiondef('private.manage_job_offer(uuid,text,integer,uuid,jsonb)'::regprocedure);
  validate_key constant text := 'for k in select jsonb_object_keys(p_payload) loop';
  apply_key constant text := '    if p_action = ''edit'' then';
  fields constant text := 'update public.jobs set customer_name=j.customer_name,title=';
  terms constant text := 'array[''sessions'',''topic_ids'',''organisation_id''] then j.terms_version+1';
begin
  if cardinality(string_to_array(definition, validate_key)) <> 2
     or cardinality(string_to_array(definition, apply_key)) <> 2
     or cardinality(string_to_array(definition, fields)) <> 2
     or cardinality(string_to_array(definition, terms)) <> 2 then
    raise exception 'Expected versioned offer planning seams';
  end if;
  definition := replace(definition, validate_key, validate_key || $new$
    if k in ('course_template_id', 'time_zone', 'delivery_type') then
      if p_action <> 'edit' or jsonb_typeof(p_payload->k) is distinct from 'string' then
        raise exception 'Course planning fields are valid only on an edit' using errcode = '22023';
      end if;
      continue;
    end if;
$new$);
  definition := replace(definition, apply_key, apply_key || $new$
      if p_payload ?| array['course_template_id','time_zone','delivery_type'] then
        perform private.edit_linked_course_details(j, p_payload);
        j.time_zone := coalesce(p_payload->>'time_zone', j.time_zone);
        j.delivery_type := coalesce(p_payload->>'delivery_type', j.delivery_type);
      end if;
$new$);
  definition := replace(definition, fields,
    'update public.jobs set customer_name=j.customer_name,time_zone=j.time_zone,delivery_type=j.delivery_type,title=');
  execute replace(definition, terms,
    'array[''sessions'',''topic_ids'',''organisation_id'',''course_template_id'',''time_zone'',''delivery_type''] then j.terms_version+1');
end;
$migration$;

commit;
