begin;

-- Permit course-only details on a linked run. Preserve exact session IDs and
-- the company, content and schedule already referenced by its offers.
do $migration$
declare
  definition text := pg_get_functiondef('private.save_course_run(uuid,jsonb)'::regprocedure);
  old_guard constant text := $old$    if exists (select 1 from public.jobs where course_run_id = target) then
      raise exception 'course_locked' using errcode = '22023';
    end if;$old$;
begin
  if cardinality(string_to_array(definition, old_guard)) <> 2 then
    raise exception 'Expected one linked course guard';
  end if;
  execute replace(definition, old_guard, $new$    if exists (select 1 from public.jobs where course_run_id = target) then
      if not exists (
        select 1 from public.course_runs run where run.id = target
          and run.template_id = (p_payload->>'template_id')::uuid
          and run.organisation_id is not distinct from nullif(p_payload->>'organisation_id','')::uuid
          and run.delivery_type = p_payload->>'delivery_type'
          and run.time_zone = p_payload->>'time_zone'
      ) or exists (
        (select s.starts_at, s.ends_at from public.course_sessions s where s.course_run_id = target
         except all
         select (slot->>'starts_at')::timestamptz, (slot->>'ends_at')::timestamptz
         from jsonb_array_elements(p_payload->'sessions') slot)
        union all
        (select (slot->>'starts_at')::timestamptz, (slot->>'ends_at')::timestamptz
         from jsonb_array_elements(p_payload->'sessions') slot
         except all
         select s.starts_at, s.ends_at from public.course_sessions s where s.course_run_id = target)
      ) or exists (
        select 1 from jsonb_array_elements(p_payload->'sessions') slot
        where coalesce(slot->>'starts_at','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
           or coalesce(slot->>'ends_at','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
      ) then
        raise exception 'course_locked' using errcode = '22023';
      end if;

      perform private.set_course_visibility(
        target, coalesce((p_payload->>'published')::boolean, false),
        coalesce((p_payload->>'archived')::boolean, false)
      );
      update public.course_runs set venue = coalesce(p_payload->>'venue','') where id = target;
      insert into public.audit_events(actor_id, action, resource_id, details)
      values (auth.uid(), 'course.run.saved', target, jsonb_build_object('linked', true));
      return target;
    end if;$new$);
end;
$migration$;

commit;
