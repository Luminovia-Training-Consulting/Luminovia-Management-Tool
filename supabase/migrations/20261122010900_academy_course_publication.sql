begin;

alter table private.academy_course_draft_requests add column learner_capacity integer
  check (learner_capacity between 1 and 10000);

-- Courses authored through the dedicated workflow start unpublished. Retained
-- courses predating this workflow retain their existing enrolment semantics.
create function private.academy_course_publication(p_course_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  publication jsonb;
begin
  if not coalesce(private.academy_course_access_status() in ('active','grace'), false)
     or not private.has_permission('courses.manage') then
    raise insufficient_privilege;
  end if;
  select jsonb_build_object('published', run.published, 'capacity', draft.learner_capacity)
    into publication
  from private.academy_course_draft_requests draft
  join public.course_runs run on run.id = draft.run_id
  join public.organisations org on org.id = run.organisation_id
  where run.id = p_course_id and run.archived_at is null and org.archived_at is null;
  return publication;
end;
$$;

create function private.academy_publish_course(p_course_id uuid, p_capacity integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  published boolean;
  capacity integer;
begin
  perform private.lock_academy_course_access();
  perform 1 from public.profiles where id = auth.uid() and active for share;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.user_roles where user_id = auth.uid() order by role for share;
  if not private.has_permission('courses.manage') then raise insufficient_privilege; end if;
  if p_capacity is null or p_capacity not between 1 and 10000 then
    raise invalid_parameter_value;
  end if;
  select run.published, draft.learner_capacity into published, capacity
  from private.academy_course_draft_requests draft
  join public.course_runs run on run.id = draft.run_id
  join public.organisations org on org.id = run.organisation_id
  where run.id = p_course_id and run.archived_at is null and org.archived_at is null
  for update of run, draft for share of org;
  if not found then raise insufficient_privilege; end if;
  if published then
    if capacity is distinct from p_capacity then
      raise exception 'Course has already been published' using errcode = 'PT409';
    end if;
    return jsonb_build_object('published', true, 'capacity', capacity);
  end if;
  if not exists (select 1 from public.course_sessions where course_run_id = p_course_id)
    or not exists (
      select 1 from private.academy_course_instructors assignment
      join public.profiles instructor on instructor.id = assignment.instructor_id and instructor.active
      where assignment.course_id = p_course_id and assignment.released_at is null
        and private.lecturer_user(instructor.id)
        and private.academy_course_teacher(p_course_id,instructor.id)
    ) then
    raise exception 'Confirm an active instructor and schedule before publishing' using errcode = 'PT409';
  end if;
  update private.academy_course_draft_requests set learner_capacity = p_capacity where run_id = p_course_id;
  update public.course_runs set published = true where id = p_course_id;
  insert into public.audit_events(actor_id, action, resource_id, details)
  values (auth.uid(), 'academy.course.published', p_course_id, jsonb_build_object('capacity',p_capacity));
  return jsonb_build_object('published', true, 'capacity', p_capacity);
end;
$$;

create function public.academy_course_publication(p_course_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.academy_course_publication(p_course_id);
$$;
create function public.academy_publish_course(p_course_id uuid, p_capacity integer)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.academy_publish_course(p_course_id,p_capacity);
$$;

revoke all on function private.academy_course_publication(uuid), public.academy_course_publication(uuid),
  private.academy_publish_course(uuid,integer), public.academy_publish_course(uuid,integer)
  from public, anon, authenticated, service_role;
grant execute on function private.academy_course_publication(uuid), public.academy_course_publication(uuid),
  private.academy_publish_course(uuid,integer), public.academy_publish_course(uuid,integer) to authenticated;

-- Apply the final seat check beneath all enrolment paths. The course row
-- serializes confirmation, removal and concurrent claims for the last seat.
create function private.guard_academy_course_capacity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  course_published boolean;
  capacity integer;
begin
  if new.status not in ('enrolled','completed') or (select edition from private.installation_identity) = 'internal' then
    return new;
  end if;
  select run.published, draft.learner_capacity into course_published, capacity
  from private.academy_course_draft_requests draft
  join public.course_runs run on run.id = draft.run_id
  where run.id = new.course_run_id for update of run;
  if not found then return new; end if;
  if not course_published or capacity is null then
    raise exception 'Publish the course before enrolling participants' using errcode = 'PT409', detail = 'academy_course_unpublished';
  end if;
  if (select count(*) from public.course_enrolments
      where course_run_id = new.course_run_id and user_id <> new.user_id
        and status in ('enrolled','completed')) >= capacity then
    raise exception 'Course capacity reached' using errcode = 'PT409', detail = 'academy_course_capacity_reached';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_academy_course_capacity() from public, anon, authenticated, service_role;
create trigger academy_course_capacity before insert or update of status, course_run_id, user_id
on public.course_enrolments for each row execute function private.guard_academy_course_capacity();

do $$
declare
  definition text := pg_catalog.pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  read_anchor constant text := '''/rpc/course_workspace_entitlement'', ''/rpc/course_enrolments''';
  write_anchor constant text := '''/rpc/academy_create_course_draft'',';
begin
  if cardinality(string_to_array(definition,read_anchor)) <> 2
     or cardinality(string_to_array(definition,write_anchor)) <> 2 then
    raise exception 'Expected exact academy course allowlists';
  end if;
  execute replace(replace(definition,read_anchor,read_anchor || ', ''/rpc/academy_course_publication'''),
    write_anchor, write_anchor || ' ''/rpc/academy_publish_course'',');
end;
$$;

notify pgrst, 'reload schema';
commit;
