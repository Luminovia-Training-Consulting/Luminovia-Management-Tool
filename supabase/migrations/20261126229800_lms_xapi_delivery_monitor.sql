-- Persist one bounded operational summary per course, without LRS or learner details.
begin;

create table private.course_xapi_delivery_status (
  run_id uuid primary key references public.course_runs(id) on delete cascade,
  through timestamptz not null check (isfinite(through)),
  reported_at timestamptz not null,
  submitted integer not null check (submitted >= 0),
  retries integer not null check (retries >= 0),
  failure text check (failure in ('delivery','window_budget','window_too_dense','export_or_checkpoint'))
);
alter table private.course_xapi_delivery_status enable row level security;
revoke all on private.course_xapi_delivery_status from public, anon, authenticated, service_role;

create function private.course_xapi_delivery_monitor(p_run_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  context jsonb := private.course_workspace_context(p_run_id);
begin
  if (context->>'manager')::boolean is not true or (context->>'lms_enabled')::boolean is not true
    then raise insufficient_privilege; end if;
  return (select to_jsonb(status) - 'run_id' from private.course_xapi_delivery_status status where run_id = p_run_id);
end;
$$;
create function private.report_course_xapi_delivery(
  p_run_id uuid, p_through timestamptz, p_submitted integer, p_retries integer, p_failure text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  context jsonb;
begin
  if p_through is null or not isfinite(p_through) or p_submitted is null or p_submitted < 0
    or p_retries is null or p_retries < 0
    or (p_failure is not null and p_failure not in ('delivery','window_budget','window_too_dense','export_or_checkpoint'))
    then raise invalid_parameter_value; end if;
  if (select edition = 'internal' from private.installation_identity) then
    perform private.lock_course_premium(p_run_id);
  else
    perform private.lock_academy_course_access();
  end if;
  context := private.course_workspace_context(p_run_id);
  if (context->>'manager')::boolean is not true or (context->>'lms_enabled')::boolean is not true
    then raise insufficient_privilege; end if;
  insert into private.course_xapi_delivery_status(run_id,through,reported_at,submitted,retries,failure)
    values(p_run_id,p_through,clock_timestamp(),p_submitted,p_retries,p_failure)
  on conflict (run_id) do update set through=excluded.through, reported_at=excluded.reported_at,
    submitted=excluded.submitted, retries=excluded.retries, failure=excluded.failure
  where excluded.through >= private.course_xapi_delivery_status.through;
  return true;
end;
$$;

create function public.course_xapi_delivery_monitor(p_run_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.course_xapi_delivery_monitor(p_run_id);
$$;
create function public.report_course_xapi_delivery(
  p_run_id uuid, p_through timestamptz, p_submitted integer, p_retries integer, p_failure text
) returns boolean language sql security invoker set search_path = '' as $$
  select private.report_course_xapi_delivery(p_run_id,p_through,p_submitted,p_retries,p_failure);
$$;
revoke all on function private.course_xapi_delivery_monitor(uuid), public.course_xapi_delivery_monitor(uuid),
  private.report_course_xapi_delivery(uuid,timestamptz,integer,integer,text),
  public.report_course_xapi_delivery(uuid,timestamptz,integer,integer,text)
  from public, anon, authenticated, service_role;
grant execute on function private.course_xapi_delivery_monitor(uuid), public.course_xapi_delivery_monitor(uuid),
  private.report_course_xapi_delivery(uuid,timestamptz,integer,integer,text),
  public.report_course_xapi_delivery(uuid,timestamptz,integer,integer,text) to authenticated;

do $migration$
declare
  gate text := pg_catalog.pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  read_anchor constant text := '''/rpc/course_xapi_statements''';
  write_anchor constant text := '''/rpc/course_text_exam_action''';
begin
  if cardinality(string_to_array(gate, read_anchor)) <> 2
    or cardinality(string_to_array(gate, write_anchor)) <> 2 then
    raise exception 'Expected the active and grace xAPI licence boundaries';
  end if;
  execute replace(replace(gate, read_anchor, read_anchor || ', ''/rpc/course_xapi_delivery_monitor'''),
    write_anchor, write_anchor || ', ''/rpc/report_course_xapi_delivery''');
end;
$migration$;

notify pgrst, 'reload schema';
commit;
