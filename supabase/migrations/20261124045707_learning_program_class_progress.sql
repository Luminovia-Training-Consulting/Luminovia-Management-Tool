begin;

-- Class progress uses the participant's current company placement. The
-- course's class tag is a schedule attribute and grants no learner membership.
create function private.learning_program_class_progress(p_program_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  company_id uuid;
begin
  if p_program_id is null then raise invalid_parameter_value; end if;
  select organisation_id into company_id from private.learning_programs where id = p_program_id;
  if not found or not coalesce(
    private.learning_program_manager(company_id) and private.course_lms_read_enabled(company_id), false
  ) then raise insufficient_privilege; end if;

  return coalesce((
    select jsonb_agg(to_jsonb(class_progress) order by lower(class_progress.class_name), class_progress.class_id)
    from (
      select class.id as class_id, class.name as class_name,
        count(*) as participants,
        count(*) filter (where progress.completed_at is not null) as participants_completed,
        sum(progress.total) as module_slots,
        sum(progress.completed) as modules_completed
      from private.learning_program_members enrolled
      join private.company_participant_memberships membership
        on membership.user_id = enrolled.user_id and membership.organisation_id = company_id
        and membership.status = 'active'
      join private.course_classes class on class.id = membership.class_id and class.organisation_id = company_id
      cross join lateral jsonb_to_record(private.learning_program_progress(p_program_id, enrolled.user_id))
        as progress(completed integer, total integer, completed_at timestamptz)
      where enrolled.program_id = p_program_id and private.active_company_participant(enrolled.user_id, company_id)
      group by class.id, class.name
    ) class_progress
  ), '[]'::jsonb);
end;
$$;

create function public.learning_program_class_progress(p_program_id uuid)
returns jsonb language sql stable security invoker set search_path = ''
return private.learning_program_class_progress(p_program_id);

revoke all on function private.learning_program_class_progress(uuid),
  public.learning_program_class_progress(uuid) from public, anon, authenticated, service_role;
grant execute on function private.learning_program_class_progress(uuid),
  public.learning_program_class_progress(uuid) to authenticated;

-- Keep one membership and one versioned class-placement command for both
-- editions. An active Academy licence permits the same current company scope.
create or replace function private.set_company_participant_class(
  p_organisation_id uuid, p_user_id uuid, p_class_id uuid, p_expected_version integer
) returns void language plpgsql security definer set search_path = '' as $$
declare
  entry private.company_participant_memberships%rowtype;
  internal boolean := (select edition = 'internal' from private.installation_identity);
begin
  if internal then
    perform private.require_internal_company_participant_manager(p_organisation_id);
  else
    perform private.lock_academy_course_access();
    if not private.learning_program_manager(p_organisation_id) then raise insufficient_privilege; end if;
  end if;
  if p_user_id is null or p_expected_version is null or p_expected_version < 1 then raise invalid_parameter_value; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('participant-membership:' || p_user_id::text, 0)
  );
  if internal then
    perform private.lock_company_premium(p_organisation_id);
  else
    perform private.lock_learning_program_scope(p_organisation_id, auth.uid(), p_user_id);
  end if;
  select * into entry from private.company_participant_memberships
  where organisation_id = p_organisation_id and user_id = p_user_id for update;
  if internal then
    perform private.require_internal_company_participant_manager(p_organisation_id);
  elsif not private.learning_program_manager(p_organisation_id) then
    raise insufficient_privilege;
  end if;
  if not private.active_company_participant(p_user_id, p_organisation_id) then raise insufficient_privilege; end if;
  perform private.check_participant_class(p_organisation_id, p_class_id);
  if entry.version <> p_expected_version then
    raise exception 'Company participant membership changed' using errcode = 'PT409';
  end if;
  if entry.class_id is not distinct from p_class_id then return; end if;
  update private.company_participant_memberships set class_id = p_class_id, version = version + 1
  where organisation_id = p_organisation_id and user_id = p_user_id;
  insert into public.audit_events(actor_id, action, resource_id, details)
  values (auth.uid(), 'company.participant_class_changed', p_organisation_id,
    jsonb_build_object('user_id', p_user_id, 'class_id', p_class_id));
end;
$$;

-- Include class options and the observed placement version in the existing
-- manager-only programme projection. Learner views never receive placement data.
do $$
declare
  definition text := pg_get_functiondef('private.learning_programs(uuid,uuid,text)'::regprocedure);
  classes constant text := '''roster'', case when manager then coalesce((';
  row_constant constant text := '''active'', private.active_company_participant(profile.id, company),';
  member_constant constant text := 'join public.profiles profile on profile.id = member.user_id';
begin
  if cardinality(string_to_array(definition, classes)) <> 2
    or cardinality(string_to_array(definition, row_constant)) <> 2
    or cardinality(string_to_array(definition, member_constant)) <> 2 then
    raise exception 'Expected one programme management projection';
  end if;
  definition := replace(definition, classes, $projection$
    'classes', case when manager and writable then coalesce((
      select jsonb_agg(jsonb_build_object('id', class.id, 'name', class.name) order by lower(class.name), class.id)
      from private.course_classes class where class.organisation_id = company
    ), '[]'::jsonb) end,
    $projection$ || classes);
  definition := replace(definition, row_constant, row_constant || $placement$
    'placement', case when writable and membership.status = 'active' then
      jsonb_build_object('class_id', membership.class_id, 'version', membership.version) end,
    $placement$);
  definition := replace(definition, member_constant, member_constant || $membership$
    left join private.company_participant_memberships membership
      on membership.organisation_id = company and membership.user_id = member.user_id
    $membership$);
  execute definition;
end;
$$;

-- The existing Academy read profile already guards the account, schema and
-- licence. This additional endpoint independently checks the programme scope.
do $$
declare
  definition text := pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  route constant text := 'and request_path = ''/rpc/learning_programs'')';
  write_route constant text := '''/rpc/start_learning_program_course''))';
begin
  if cardinality(string_to_array(definition, route)) <> 2
    or cardinality(string_to_array(definition, write_route)) <> 2 then
    raise exception 'Expected one Academy learning programme read gate';
  end if;
  execute replace(replace(definition, route,
    'and request_path in (''/rpc/learning_programs'', ''/rpc/learning_program_class_progress''))'),
    write_route, '''/rpc/start_learning_program_course'', ''/rpc/set_company_participant_class''))');
end;
$$;

notify pgrst, 'reload schema';
commit;
