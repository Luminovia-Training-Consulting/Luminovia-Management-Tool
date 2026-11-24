begin;

create index course_closeout_review_followups_idx
  on private.course_closeout_reviews using gin (followups jsonb_path_ops);

-- Only tasks created by a confirmed closeout participate. Other workbench
-- records retain their original access paths and are not exposed here.
create function private.course_closeout_followup(p_task_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  result jsonb;
begin
  if not private.has_permission('courses.manage')
     or (select edition from private.installation_identity) is distinct from 'internal' then
    raise insufficient_privilege;
  end if;

  select jsonb_build_object(
    'course_run_id', run.id, 'title', task.title, 'due_at', task.due_at,
    'time_zone', task.time_zone, 'state', task.state, 'version', task.version,
    'can_update', task.creator_id = auth.uid() or task.assignee_id = auth.uid()
      or private.has_permission('jobs.manage')
  ) into result
  from private.course_closeout_reviews review
  join public.course_runs run on run.id = review.course_run_id and run.archived_at is null
  join private.work_tasks task on task.id = p_task_id
  where (review.followups @> jsonb_build_object('attendance', p_task_id)
      or review.followups @> jsonb_build_object('grade', p_task_id)
      or review.followups @> jsonb_build_object('submission', p_task_id))
    and private.course_lms_read_enabled(run.organisation_id)
    and private.can_read_work_task(task.id);
  if result is null then raise insufficient_privilege; end if;
  return result;
end;
$$;

create function public.course_closeout_followup(p_task_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select private.course_closeout_followup(p_task_id)
$$;

create function private.set_course_closeout_followup_state(
  p_task_id uuid, p_state text, p_version integer
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  current_task jsonb;
  task private.work_tasks;
begin
  if not private.has_permission('courses.manage') then raise insufficient_privilege; end if;
  perform 1 from public.profiles where id = auth.uid() and active for share;
  if not found then raise insufficient_privilege; end if;
  current_task := private.course_closeout_followup(p_task_id);
  perform private.lock_course_premium((current_task->>'course_run_id')::uuid);
  current_task := private.course_closeout_followup(p_task_id);
  if not (current_task->>'can_update')::boolean then raise insufficient_privilege; end if;
  if p_state is null or p_state not in ('open','doing','done') then
    raise exception 'Invalid closeout task state' using errcode = '22023';
  end if;

  select * into task from private.work_tasks where id = p_task_id for update;
  if task.state = p_state and task.version in (p_version, p_version + 1) then
    return private.course_closeout_followup(p_task_id);
  end if;
  perform private.save_work_task(task.id, jsonb_build_object(
    'title', task.title, 'description', task.description, 'scope', task.scope,
    'state', p_state, 'due_at', task.due_at, 'time_zone', task.time_zone,
    'source_message_id', task.source_message_id, 'assignee_id', task.assignee_id
  ), p_version);
  return private.course_closeout_followup(p_task_id);
end;
$$;

create function public.set_course_closeout_followup_state(
  p_task_id uuid, p_state text, p_version integer
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.set_course_closeout_followup_state(p_task_id, p_state, p_version)
$$;

revoke all on function private.course_closeout_followup(uuid), public.course_closeout_followup(uuid),
  private.set_course_closeout_followup_state(uuid,text,integer), public.set_course_closeout_followup_state(uuid,text,integer)
from public, anon, authenticated, service_role;
grant execute on function private.course_closeout_followup(uuid), public.course_closeout_followup(uuid),
  private.set_course_closeout_followup_state(uuid,text,integer), public.set_course_closeout_followup_state(uuid,text,integer)
to authenticated;

notify pgrst, 'reload schema';
commit;
