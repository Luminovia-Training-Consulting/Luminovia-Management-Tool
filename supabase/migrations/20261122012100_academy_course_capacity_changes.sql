begin;

create function private.academy_set_course_capacity(
  p_course_id uuid, p_expected_capacity integer, p_capacity integer
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  capacity integer;
  occupied integer;
begin
  perform private.lock_academy_course_access();
  perform 1 from public.profiles where id=auth.uid() and active for share;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.user_roles where user_id=auth.uid() order by role for share;
  if not private.has_permission('courses.manage') then raise insufficient_privilege; end if;
  if p_capacity is null or p_capacity not between 1 and 10000 or p_expected_capacity is null
     or p_expected_capacity not between 1 and 10000 then raise invalid_parameter_value; end if;

  select draft.learner_capacity into capacity
  from private.academy_course_draft_requests draft
  join public.course_runs run on run.id=draft.run_id
  join public.organisations org on org.id=run.organisation_id
  where run.id=p_course_id and run.published and run.archived_at is null and org.archived_at is null
  for update of run,draft for share of org;
  if not found or capacity is null then raise insufficient_privilege; end if;
  if p_capacity = capacity then return jsonb_build_object('published',true,'capacity',capacity); end if;
  if capacity <> p_expected_capacity then
    raise exception 'Course capacity changed' using errcode='PT409', detail='academy_course_capacity_changed';
  end if;
  select count(*) into occupied from public.course_enrolments
  where course_run_id=p_course_id and status in ('enrolled','completed');
  if p_capacity < occupied then
    raise exception 'Course capacity is below existing enrolments' using errcode='PT409', detail='academy_course_capacity_below_enrolments';
  end if;

  update private.academy_course_draft_requests set learner_capacity=p_capacity where run_id=p_course_id;
  insert into public.audit_events(actor_id,action,resource_id,details)
  values(auth.uid(),'academy.course.capacity_updated',p_course_id,jsonb_build_object('previous',capacity,'capacity',p_capacity));
  return jsonb_build_object('published',true,'capacity',p_capacity);
end;
$$;
create function public.academy_set_course_capacity(p_course_id uuid,p_expected_capacity integer,p_capacity integer)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.academy_set_course_capacity(p_course_id,p_expected_capacity,p_capacity);
$$;
revoke all on function private.academy_set_course_capacity(uuid,integer,integer),public.academy_set_course_capacity(uuid,integer,integer)
  from public, anon, authenticated, service_role;
grant execute on function private.academy_set_course_capacity(uuid,integer,integer),public.academy_set_course_capacity(uuid,integer,integer)
  to authenticated;

do $$
declare definition text := pg_catalog.pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  anchor constant text := '''/rpc/academy_publish_course'',';
begin
  if cardinality(string_to_array(definition,anchor)) <> 2 then raise exception 'Expected dedicated publication write gate'; end if;
  execute replace(definition,anchor,anchor || ' ''/rpc/academy_set_course_capacity'',');
end;
$$;

notify pgrst, 'reload schema';
commit;
