begin;

-- The dedicated course profile exposes only the reviewed learning commands.
-- Role-specific scoring, attendance evidence and immutable revisions stay in
-- the canonical course transaction used by the internal LMS.
create function private.academy_learning_action(
  p_run_id uuid, p_action text, p_payload jsonb, p_expected_version integer default 0
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  company_id uuid;
  permitted_keys text[];
  result jsonb;
begin
  permitted_keys := case p_action
    when 'feedback' then array['rating','comment']
    when 'quiz_config' then array['questions','published','pass_percent','max_attempts']
    when 'quiz_attempt' then array['answers','request_id']
    when 'completion_issue' then array[]::text[]
    when 'completion_revoke' then array['id','reason']
  end;
  if permitted_keys is null or jsonb_typeof(p_payload) is distinct from 'object'
     or not (p_payload ?& permitted_keys) or p_payload - permitted_keys <> '{}'::jsonb
     or p_expected_version is null or p_expected_version < 0 then
    raise invalid_parameter_value;
  end if;
  perform private.lock_academy_course_access();
  perform 1 from public.profiles where id = actor_id and active for share;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.user_roles where user_id = actor_id order by role for share;
  select org.id into company_id
  from public.course_runs run join public.organisations org on org.id = run.organisation_id
  where run.id = p_run_id and run.archived_at is null and org.archived_at is null
  for no key update of run for share of org;
  if not found then raise insufficient_privilege; end if;
  if private.participant_actor() then
    perform 1 from private.company_participant_memberships
    where organisation_id = company_id and user_id = actor_id and status = 'active' for share;
    if not found then raise insufficient_privilege; end if;
    perform 1 from public.course_enrolments
    where course_run_id = p_run_id and user_id = actor_id and status in ('enrolled','completed') for share;
    if not found then raise insufficient_privilege; end if;
  else
    perform 1 from public.client_organisation_memberships
    where organisation_id = company_id and user_id = actor_id for share;
  end if;
  result := private.course_workspace_action_before_premium(p_run_id,p_action,p_payload,p_expected_version);
  if p_action = 'completion_issue' then
    return jsonb_build_object('id',result->'id');
  end if;
  return result;
exception when serialization_failure then
  raise exception 'Learning activity was updated' using errcode = 'PT409';
end;
$$;

create function public.academy_learning_action(
  p_run_id uuid, p_action text, p_payload jsonb, p_expected_version integer default 0
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.academy_learning_action(p_run_id,p_action,p_payload,p_expected_version);
$$;
revoke all on function private.academy_learning_action(uuid,text,jsonb,integer),
  public.academy_learning_action(uuid,text,jsonb,integer) from public, anon, authenticated, service_role;
grant execute on function private.academy_learning_action(uuid,text,jsonb,integer),
  public.academy_learning_action(uuid,text,jsonb,integer) to authenticated;

-- Completion facts contain no raw Storage locator. The existing Edge renderer
-- rechecks the same caller's current membership after preparing the PDF.
do $$
declare
  definition text := pg_catalog.pg_get_functiondef('private.course_document_access(text,uuid)'::regprocedure);
  kinds constant text := 'p_kind not in (''resource'', ''exam'')';
  digest_check constant text := 'if dedicated and not coalesce((resolved->>''sha256'')';
  gate text := pg_catalog.pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  action_anchor constant text := '''/rpc/academy_publish_course'',';
begin
  if cardinality(string_to_array(definition,kinds)) <> 2
     or cardinality(string_to_array(definition,digest_check)) <> 2
     or cardinality(string_to_array(gate,action_anchor)) <> 2 then
    raise exception 'Expected reviewed academy activity and document access gates';
  end if;
  execute replace(replace(definition,kinds,'p_kind not in (''resource'', ''exam'', ''completion'')'),
    digest_check,'if dedicated and p_kind = ''resource'' and not coalesce((resolved->>''sha256'')');
  execute replace(gate,action_anchor,action_anchor || ' ''/rpc/academy_learning_action'',');
end;
$$;

notify pgrst, 'reload schema';
commit;
