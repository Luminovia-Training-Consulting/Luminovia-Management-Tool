begin;

-- Give the assigned staff member the task without expanding their access to
-- the course or to tasks outside the existing workbench permission boundary.
create function private.training_escalation_detail(p_task_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not exists(select 1 from private.installation_identity where singleton and edition='internal')
    or not private.can_read_work_task(p_task_id) then raise insufficient_privilege; end if;
  select jsonb_build_object('course_run_id',escalation.run_id,'title',task.title,'description',task.description,
    'due_at',task.due_at,'time_zone',task.time_zone,'state',task.state,'version',task.version,
    'can_update',auth.uid() in (task.creator_id,task.assignee_id) or private.has_permission('jobs.manage'))
  into result from private.work_tasks task
  join private.training_control_escalations escalation on escalation.task_id=task.id
  where task.id=p_task_id and task.scope='operations';
  if result is null then raise insufficient_privilege; end if;
  return result;
end;
$$;

create function private.set_training_escalation_state(p_task_id uuid,p_state text,p_version integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare task private.work_tasks;
begin
  if not (private.training_escalation_detail(p_task_id)->>'can_update')::boolean then raise insufficient_privilege; end if;
  if p_state is null or p_state not in ('open','doing','done') or p_version is null or p_version<1
    then raise invalid_parameter_value; end if;
  select * into strict task from private.work_tasks where id=p_task_id for update;
  if task.state=p_state and task.version in (p_version,p_version+1) then
    return private.training_escalation_detail(p_task_id);
  end if;
  perform private.save_work_task(task.id,jsonb_build_object(
    'title',task.title,'description',task.description,'scope',task.scope,'state',p_state,
    'due_at',task.due_at,'time_zone',task.time_zone,'source_message_id',task.source_message_id,'assignee_id',task.assignee_id
  ),p_version);
  return private.training_escalation_detail(p_task_id);
end;
$$;

create function public.training_escalation_detail(p_task_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select private.training_escalation_detail(p_task_id)
$$;
create function public.set_training_escalation_state(p_task_id uuid,p_state text,p_version integer) returns jsonb
language sql security invoker set search_path='' as $$
  select private.set_training_escalation_state(p_task_id,p_state,p_version)
$$;
revoke all on function private.training_escalation_detail(uuid),public.training_escalation_detail(uuid),
  private.set_training_escalation_state(uuid,text,integer),public.set_training_escalation_state(uuid,text,integer)
  from public,anon,authenticated,service_role;
grant execute on function private.training_escalation_detail(uuid),public.training_escalation_detail(uuid),
  private.set_training_escalation_state(uuid,text,integer),public.set_training_escalation_state(uuid,text,integer) to authenticated;

-- The escalation form needs just the existing eligible staff projection.
create function private.training_escalation_assignees() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.actor_active() or not private.has_permission('jobs.manage')
    or not private.has_permission('courses.manage')
    or not exists(select 1 from private.installation_identity where singleton and edition='internal')
    then raise insufficient_privilege; end if;
  return private.work_tasks(null,null,1,'')->'assignees';
end;
$$;
create function public.training_escalation_assignees() returns jsonb
language sql stable security invoker set search_path='' as $$
  select private.training_escalation_assignees()
$$;
revoke all on function private.training_escalation_assignees(),public.training_escalation_assignees()
  from public,anon,authenticated,service_role;
grant execute on function private.training_escalation_assignees(),public.training_escalation_assignees() to authenticated;

alter function private.notification_target(text,uuid) rename to notification_target_before_training_escalations;
create function private.notification_target(p_kind text,p_resource uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb := private.notification_target_before_training_escalations(p_kind,p_resource);
begin
  if p_kind in ('task_assigned','task_due') and nullif(result->>'href','') is not null and
    exists(select 1 from private.training_control_escalations where task_id=p_resource) then
    return result || jsonb_build_object('href','/workbench?escalation='||p_resource);
  end if;
  return result;
end;
$$;
revoke all on function private.notification_target_before_training_escalations(text,uuid),private.notification_target(text,uuid)
  from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
