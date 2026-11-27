begin;

-- Link a current training exception to an ordinary, auditable operations task.
create table private.training_control_escalations (
  run_id uuid not null references public.course_runs(id) on delete cascade,
  issue text not null check (issue in ('staffing','delivery','agreement','qualification','preparation')),
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{32}$'),
  task_id uuid not null unique references private.work_tasks(id) on delete cascade,
  primary key (run_id,issue,fingerprint)
);
alter table private.training_control_escalations enable row level security;
revoke all on private.training_control_escalations from public,anon,authenticated,service_role;

create function private.training_escalation_task(p_run uuid,p_issue text,p_fingerprint text)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id',task.id,'state',task.state,'due_at',task.due_at,'assignee',profile.display_name)
  from private.training_control_escalations escalation
  join private.work_tasks task on task.id=escalation.task_id and task.scope='operations'
  join public.profiles profile on profile.id=task.assignee_id
  where escalation.run_id=p_run and escalation.issue=p_issue
    and (task.state in ('open','doing') or escalation.fingerprint=p_fingerprint and task.state='done')
    and private.can_read_work_task(task.id)
  order by (task.state in ('open','doing')) desc,task.created_at desc,task.id limit 1
$$;
revoke all on function private.training_escalation_task(uuid,text,text) from public,anon,authenticated,service_role;

do $migration$
declare
  definition text := pg_get_functiondef('private.training_control_center(date,date,uuid,uuid)'::regprocedure);
  marker constant text := '''code'',issue.issue,''fingerprint'',issue.fingerprint,''acknowledged'',coalesce(issue.acknowledged,false)';
begin
  if cardinality(string_to_array(definition,marker))<>2 then
    raise exception 'Expected the training issue projection';
  end if;
  execute replace(definition,marker,marker ||
    ',''escalation'',private.training_escalation_task(issue.id,issue.issue,issue.fingerprint)');
end;
$migration$;

create function private.escalate_training_issue(
  p_run_id uuid,p_issue text,p_fingerprint text,p_from date,p_until date,
  p_assignee_id uuid,p_due_at timestamptz,p_reason text,p_organisation_id uuid,p_topic_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  issue jsonb;
  current_task jsonb;
  created_task jsonb;
  zone text;
begin
  if not private.actor_active() or not private.has_permission('courses.manage')
    or not private.has_permission('jobs.manage')
    or not exists(select 1 from private.installation_identity where singleton and edition='internal') then
    raise insufficient_privilege;
  end if;
  if p_run_id is null or p_fingerprint is null or p_issue is null or p_assignee_id is null
    or p_due_at is null or not isfinite(p_due_at)
    or length(btrim(coalesce(p_reason,''))) not between 3 and 1000 then
    raise invalid_parameter_value;
  end if;

  -- Serialize all attempts on a course and issue, even across actors and filters.
  perform pg_advisory_xact_lock(hashtextextended('training-escalation:'||p_run_id||':'||p_issue,0));
  current_task := private.training_escalation_task(p_run_id,p_issue,p_fingerprint);
  if current_task is not null then return current_task; end if;
  select item into issue
  from jsonb_array_elements(private.training_control_center(p_from,p_until,p_organisation_id,p_topic_id)#>'{operations,issues}') item
  where item->>'run_id'=p_run_id::text and item->>'code'=p_issue and item->>'fingerprint'=p_fingerprint;
  if issue is null then
    raise exception 'The current course issue has changed' using errcode='40001';
  end if;
  if p_due_at<=now() or p_due_at>(issue->>'starts_at')::timestamptz then
    raise exception 'Choose a future deadline no later than the course start' using errcode='22023';
  end if;
  select time_zone into strict zone from public.profiles where id=auth.uid();
  created_task := private.save_work_task(null,jsonb_build_object(
    'title',left(issue->>'title',200),'description',btrim(p_reason)||E'\n\n/courses?run='||p_run_id,
    'state','open','due_at',p_due_at,'time_zone',zone,'scope','operations',
    'assignee_id',p_assignee_id,'source_message_id',null
  ),0,gen_random_uuid());
  insert into private.training_control_escalations(run_id,issue,fingerprint,task_id)
    values(p_run_id,p_issue,p_fingerprint,(created_task->>'id')::uuid)
    on conflict(run_id,issue,fingerprint) do update set task_id=excluded.task_id;
  return private.training_escalation_task(p_run_id,p_issue,p_fingerprint);
end;
$$;

create function public.escalate_training_issue(
  p_run_id uuid,p_issue text,p_fingerprint text,p_from date,p_until date,
  p_assignee_id uuid,p_due_at timestamptz,p_reason text,p_organisation_id uuid default null,p_topic_id uuid default null
) returns jsonb language sql security invoker set search_path='' as $$
  select private.escalate_training_issue(p_run_id,p_issue,p_fingerprint,p_from,p_until,p_assignee_id,p_due_at,p_reason,p_organisation_id,p_topic_id)
$$;
revoke all on function private.escalate_training_issue(uuid,text,text,date,date,uuid,timestamptz,text,uuid,uuid),
  public.escalate_training_issue(uuid,text,text,date,date,uuid,timestamptz,text,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.escalate_training_issue(uuid,text,text,date,date,uuid,timestamptz,text,uuid,uuid),
  public.escalate_training_issue(uuid,text,text,date,date,uuid,timestamptz,text,uuid,uuid) to authenticated;
-- A follow-up task belongs to the workbench. Course removal only unlinks
-- its issue reference within the ordinary reviewed deletion scope.
alter function private.deletion_scope(text,uuid) rename to deletion_scope_before_training_escalations;
create function private.deletion_scope(p_kind text,p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  scope jsonb := private.deletion_scope_before_training_escalations(p_kind,p_id);
  runs text := private.deletion_selector(scope,'public.course_runs');
begin
  if runs is not null then
    scope := private.deletion_add_scope(scope,'private.training_control_escalations',
      format('x.run_id in (select x.id from public.course_runs x where %s)',runs));
  end if;
  return scope;
end;
$$;
revoke all on function private.deletion_scope_before_training_escalations(text,uuid),
  private.deletion_scope(text,uuid) from public,anon,authenticated,service_role;
create trigger permanent_deletion_fence before insert or update or delete
  on private.training_control_escalations for each row execute function private.guard_permanent_deletion();
notify pgrst,'reload schema';
commit;
