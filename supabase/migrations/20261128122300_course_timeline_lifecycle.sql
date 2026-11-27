begin;

-- Keep legacy visibility receipts readable. The existing lifecycle transaction
-- records which state changed without exposing its actor or raw audit payload.
create or replace function private.set_course_visibility(p_id uuid, p_published boolean, p_archived boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  previous public.course_runs%rowtype;
  milestone text;
begin
  if not private.has_permission('courses.manage') then
    raise exception 'courses.manage and MFA required' using errcode = '42501';
  end if;
  select * into previous from public.course_runs where id = p_id for update;
  if not found or p_published is null or p_archived is null then
    raise exception 'Invalid course' using errcode = '22023';
  end if;
  if p_archived and exists (
    select 1 from public.jobs where course_run_id = p_id and status in ('published','filled')
  ) then raise exception 'course_locked' using errcode = '22023'; end if;
  if p_published and not exists (
    select 1 from public.course_sessions where course_run_id = p_id
  ) then raise exception 'Sessions required' using errcode = '22023'; end if;

  update public.course_runs
  set published = p_published, archived_at = case when p_archived then coalesce(archived_at, now()) end
  where id = previous.id;
  milestone := case
    when p_archived and previous.archived_at is null then 'archived'
    when not p_archived and previous.archived_at is not null then 'restored'
    when p_published and not previous.published then 'published'
    when not p_published and previous.published then 'unpublished'
  end;
  insert into public.audit_events(actor_id, action, resource_id, details)
  values (auth.uid(), 'course.visibility.changed', previous.id, jsonb_build_object('milestone',milestone));
end;
$$;

drop index public.course_timeline_audit_history;
create index course_timeline_audit_history on public.audit_events(resource_id, created_at desc, id desc)
where action in (
  'course.run.saved', 'course.run.duplicated', 'course.visibility.changed', 'course.class.changed',
  'course.series.pattern_changed', 'academy.course.schedule_updated', 'academy.course.published',
  'academy.course.capacity_updated', 'academy.instructor.assigned', 'academy.instructor.released'
);

create index course_timeline_assignment_history on public.claim_events(claim_id, created_at desc, id desc)
where event_type in ('confirmed', 'cancelled');

create index course_timeline_academy_instructors on private.academy_course_instructors(course_id, claim_id);

create or replace function private.course_timeline(p_run_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  access jsonb := private.course_workspace_context_for_package(p_run_id, false);
  internal_edition boolean := (select edition = 'internal' from private.installation_identity);
  include_assignments boolean;
begin
  if (access->>'staff')::boolean is not true or (
    (access->>'standard_enabled')::boolean is not true
    and not exists (
      select 1 from public.course_runs run
      where run.id = p_run_id and run.organisation_id is null and internal_edition
    )
  ) then raise insufficient_privilege; end if;

  -- Use exact course-linked committed assignment events. Only managers with
  -- assignment authority can see these, and no offer/claim/lecturer data leaves.
  include_assignments := (access->>'manager')::boolean is true
    and (not internal_edition or private.has_permission('jobs.manage'));
  return (
    select coalesce(jsonb_agg(jsonb_build_object('id', event.id, 'kind', event.kind, 'at', event.created_at)
      order by event.created_at, event.id), '[]'::jsonb)
    from (
      select source.id, source.created_at, source.kind
      from (
        select audit.id, audit.created_at, case audit.action
          when 'course.run.saved' then 'updated'
          when 'course.run.duplicated' then 'copied'
          when 'course.visibility.changed' then case
            when audit.details->>'milestone' in ('archived','restored','published','unpublished')
            then audit.details->>'milestone'
            else 'visibility'
          end
          when 'course.class.changed' then 'class'
          when 'course.series.pattern_changed' then 'series_pattern'
          when 'academy.course.schedule_updated' then 'schedule'
          when 'academy.course.published' then 'published'
          when 'academy.course.capacity_updated' then 'capacity'
        end as kind
        from public.audit_events audit
        where audit.resource_id = p_run_id
          and audit.action in (
            'course.run.saved', 'course.run.duplicated', 'course.visibility.changed', 'course.class.changed',
            'course.series.pattern_changed', 'academy.course.schedule_updated', 'academy.course.published',
            'academy.course.capacity_updated'
          )
          and (audit.action <> 'course.run.saved' or audit.details->'created' is distinct from 'true'::jsonb)
          and (audit.action <> 'course.visibility.changed' or audit.details->'milestone' is distinct from 'null'::jsonb)
        union all
        select assignment.id, assignment.created_at,
          case assignment.event_type when 'confirmed' then 'instructor_confirmed' else 'instructor_released' end
        from public.jobs job
        join public.job_claims claim on claim.job_id = job.id
        join public.claim_events assignment on assignment.claim_id = claim.id
        where include_assignments and internal_edition and job.course_run_id = p_run_id
          and assignment.event_type in ('confirmed', 'cancelled')
        union all
        select audit.id, audit.created_at,
          case audit.action when 'academy.instructor.assigned' then 'instructor_confirmed' else 'instructor_released' end
        from private.academy_course_instructors assignment
        join public.audit_events audit on audit.resource_id = assignment.claim_id
        where include_assignments and not internal_edition and assignment.course_id = p_run_id
          and audit.action in ('academy.instructor.assigned', 'academy.instructor.released')
      ) source
      order by source.created_at desc, source.id desc
      limit 100
    ) event
  );
end;
$$;

notify pgrst, 'reload schema';
commit;
