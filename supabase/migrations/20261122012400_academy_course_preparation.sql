begin;

create table private.academy_preparation_requests (
  actor_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid not null,
  course_id uuid not null references public.course_runs(id) on delete cascade,
  item_id uuid not null references private.course_preparation_items(id) on delete cascade,
  digest bytea not null check (octet_length(digest)=32),
  primary key(actor_id,request_id)
);
create index academy_preparation_requests_course on private.academy_preparation_requests(course_id);
create index academy_preparation_requests_item on private.academy_preparation_requests(item_id);
alter table private.academy_preparation_requests enable row level security;
revoke all on private.academy_preparation_requests from public, anon, authenticated, service_role;

-- The surrounding learning transaction already holds the current licence,
-- actor and course locks. Keep retries on the original reviewed item.
create function private.academy_prepare_course_item(p_run_id uuid,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  command_id uuid := (p_payload->>'request_id')::uuid;
  existing private.academy_preparation_requests;
  fingerprint bytea;
  outcome jsonb;
begin
  if command_id is null then raise invalid_parameter_value; end if;
  if not private.has_permission('courses.manage') then raise insufficient_privilege; end if;
  fingerprint := sha256(convert_to((p_payload-'request_id')::text,'UTF8'));
  perform pg_advisory_xact_lock(hashtextextended('academy-preparation:'||auth.uid()::text||':'||command_id::text,0));
  select * into existing from private.academy_preparation_requests where actor_id=auth.uid() and request_id=command_id;
  if found then
    if existing.course_id<>p_run_id or existing.digest<>fingerprint then
      raise exception 'Preparation request changed' using errcode='PT409';
    end if;
    return jsonb_build_object('id',existing.item_id,'saved',true);
  end if;
  outcome := private.course_workspace_action_before_premium(p_run_id,'preparation_create',p_payload-'request_id',0);
  insert into private.academy_preparation_requests(actor_id,request_id,course_id,item_id,digest)
  values(auth.uid(),command_id,p_run_id,(outcome->>'id')::uuid,fingerprint);
  return outcome;
end;
$$;
revoke all on function private.academy_prepare_course_item(uuid,jsonb) from public, anon, authenticated, service_role;

do $$
declare
  definition text := pg_catalog.pg_get_functiondef('private.academy_learning_action(uuid,text,jsonb,integer)'::regprocedure);
  input_anchor constant text := 'when ''resource_acknowledge'' then array[''id'']';
  write_anchor constant text := '  result := private.course_workspace_action_before_premium';
begin
  if cardinality(string_to_array(definition,input_anchor)) <> 2
     or cardinality(string_to_array(definition,write_anchor)) <> 2 then
    raise exception 'Expected reviewed preparation action boundary';
  end if;
  execute replace(replace(definition,input_anchor,input_anchor || chr(10) ||
    '    when ''preparation_create'' then array[''request_id'',''label'',''client_visible'']' || chr(10) ||
    '    when ''preparation_toggle'' then array[''id'',''done'']' || chr(10) ||
    '    when ''notebook'' then array[''body'']'),write_anchor,
    '  if p_action = ''preparation_create'' then' || chr(10) ||
    '    if p_expected_version <> 0 then raise invalid_parameter_value; end if;' || chr(10) ||
    '    return private.academy_prepare_course_item(p_run_id,p_payload);' || chr(10) ||
    '  end if;' || chr(10) || write_anchor);
end;
$$;

notify pgrst, 'reload schema';
commit;
