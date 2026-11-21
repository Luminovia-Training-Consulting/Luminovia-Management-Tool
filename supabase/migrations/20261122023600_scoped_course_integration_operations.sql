begin;

alter table private.company_integration_keys
  drop constraint company_integration_keys_purpose_check,
  add constraint company_integration_keys_purpose_check check (
    purpose in ('course-index','academy-webhook','course-enrolment','course-report')
  );

create or replace function private.company_integration_keys(p_organisation_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.company_integration_admin() then raise insufficient_privilege; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(k) order by k.created_at desc,k.id)
    from (
      select id,label,created_at,expires_at,revoked_at,version,last_used_at,
        case purpose when 'course-enrolment' then 'enrolments.write'
                     when 'course-report' then 'reports.read'
                     else 'courses.read' end as scope
      from private.company_integration_keys
      where organisation_id=p_organisation_id and purpose<>'academy-webhook'
      order by created_at desc,id limit 100
    ) k
  ),'[]'::jsonb);
end;
$$;

create function private.issue_scoped_company_integration_key(
  p_organisation_id uuid,p_label text,p_expires_at timestamptz,
  p_rotate_id uuid,p_expected_version integer,p_scope text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  secret text := replace(gen_random_uuid()::text || gen_random_uuid()::text,'-','');
  key_row private.company_integration_keys%rowtype;
  key_purpose text := case p_scope
    when 'courses.read' then 'course-index'
    when 'enrolments.write' then 'course-enrolment'
    when 'reports.read' then 'course-report' end;
begin
  if not private.company_integration_admin() then raise insufficient_privilege; end if;
  perform 1 from public.organisations where id=p_organisation_id and archived_at is null for update;
  if not found then raise insufficient_privilege; end if;
  if key_purpose is null or p_expires_at is null or p_expires_at <= now()
    or p_expires_at > now()+interval '180 days' or p_label is null
    or char_length(btrim(p_label)) not between 1 and 120
  then raise exception 'Invalid scope, label or key expiry' using errcode='22023'; end if;
  if (select count(*) from private.company_integration_keys
      where organisation_id=p_organisation_id and purpose<>'academy-webhook'
        and revoked_at is null and expires_at>now() and id is distinct from p_rotate_id) >= 20 then
    raise exception 'Too many active integration keys' using errcode='54000';
  end if;
  if p_rotate_id is null then
    insert into private.company_integration_keys(organisation_id,label,secret_hash,issued_by,expires_at,purpose)
    values(p_organisation_id,btrim(p_label),sha256(convert_to(secret,'UTF8')),auth.uid(),p_expires_at,key_purpose)
    returning * into key_row;
  else
    update private.company_integration_keys set
      label=btrim(p_label),secret_hash=sha256(convert_to(secret,'UTF8')),issued_by=auth.uid(),
      expires_at=p_expires_at,version=version+1,window_requests=0,window_started_at=null
    where id=p_rotate_id and organisation_id=p_organisation_id and purpose=key_purpose
      and revoked_at is null and version=p_expected_version
    returning * into key_row;
    if not found then raise exception 'Integration key changed' using errcode='PT409'; end if;
  end if;
  insert into public.audit_events(actor_id,action,resource_id,details)
  values(auth.uid(),case when p_rotate_id is null then 'integration.created' else 'integration.rotated' end,
    key_row.id,jsonb_build_object('organisation_id',p_organisation_id,'scope',p_scope));
  return jsonb_build_object('id',key_row.id,'version',key_row.version,
    'credential','lvi_' || key_row.id::text || '_' || secret);
end;
$$;

create or replace function private.issue_company_integration_key(
  p_organisation_id uuid,p_label text,p_expires_at timestamptz,p_rotate_id uuid,p_expected_version integer
) returns jsonb language sql security definer set search_path = '' as $$
  select private.issue_scoped_company_integration_key(
    p_organisation_id,p_label,p_expires_at,p_rotate_id,p_expected_version,'courses.read');
$$;

create function public.issue_scoped_company_integration_key(
  p_organisation_id uuid,p_label text,p_expires_at timestamptz,
  p_rotate_id uuid,p_expected_version integer,p_scope text
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.issue_scoped_company_integration_key(
    p_organisation_id,p_label,p_expires_at,p_rotate_id,p_expected_version,p_scope);
$$;

create or replace function private.revoke_company_integration_key(p_id uuid,p_expected_version integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.company_integration_admin() then raise insufficient_privilege; end if;
  update private.company_integration_keys set revoked_at=now(),version=version+1
  where id=p_id and version=p_expected_version and purpose<>'academy-webhook' and revoked_at is null;
  if not found then raise exception 'Integration key changed' using errcode='PT409'; end if;
  insert into public.audit_events(actor_id,action,resource_id,details)
    values(auth.uid(),'integration.revoked',p_id,'{}'::jsonb);
end;
$$;

-- All inbound integration operations share the same credential lifecycle and rate limit.
create function private.use_company_integration_key(p_id uuid,p_secret_hash text,p_purpose text)
returns table(key_status text,company_id uuid,issuer_id uuid)
language plpgsql security invoker set search_path = '' as $$
declare
  company uuid;
  key_row private.company_integration_keys%rowtype;
  clock_now timestamptz;
begin
  if p_secret_hash is null or p_secret_hash !~ '^[0-9a-f]{64}$' then
    return query select 'denied'::text,null::uuid,null::uuid;
    return;
  end if;
  select organisation_id into company from private.company_integration_keys
  where id=p_id and purpose=p_purpose and secret_hash=decode(p_secret_hash,'hex');
  -- Issue/rotate also locks the organisation before the key.
  perform 1 from public.organisations where id=company and archived_at is null for share;
  if not found then
    return query select 'denied'::text,null::uuid,null::uuid;
    return;
  end if;
  select * into key_row from private.company_integration_keys
    where id=p_id and organisation_id=company and purpose=p_purpose and secret_hash=decode(p_secret_hash,'hex')
    for update;
  clock_now := clock_timestamp();
  if not found or key_row.revoked_at is not null or key_row.expires_at<=clock_now
    or not private.course_index_integration_issuer(key_row.issued_by) then
    return query select 'denied'::text,null::uuid,null::uuid;
    return;
  end if;
  if key_row.window_started_at is null or key_row.window_started_at<=clock_now-interval '1 minute' then
    key_row.window_started_at := clock_now;
    key_row.window_requests := 0;
  end if;
  if key_row.window_requests>=60 then
    return query select 'rate_limited'::text,null::uuid,null::uuid;
    return;
  end if;
  update private.company_integration_keys
  set window_started_at=key_row.window_started_at,window_requests=key_row.window_requests+1,
      last_used_at=clock_now where id=p_id;
  return query select 'ok'::text,company,key_row.issued_by;
end;
$$;

create or replace function private.integration_course_index(
  p_id uuid,p_secret_hash text,p_limit integer,p_after uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare credential record; items jsonb;
begin
  if p_limit is null or p_limit not between 1 and 50 then
    return jsonb_build_object('status','denied');
  end if;
  select * into credential from private.use_company_integration_key(p_id,p_secret_hash,'course-index');
  if credential.key_status<>'ok' then return jsonb_build_object('status',credential.key_status); end if;
  select coalesce(jsonb_agg(to_jsonb(course_row) order by course_row.id),'[]'::jsonb) into items from (
    select r.id,t.title,r.time_zone from public.course_runs r
    join public.course_templates t on t.id=r.template_id
    where r.organisation_id=credential.company_id and r.archived_at is null and r.published
      and (p_after is null or r.id>p_after)
    order by r.id limit p_limit+1
  ) course_row;
  return jsonb_build_object('status','ok','items',
    case when jsonb_array_length(items)>p_limit then items-p_limit else items end,
    'next_cursor',case when jsonb_array_length(items)>p_limit then items->(p_limit-1)->>'id' end);
end;
$$;

-- Trusted callers have already locked the course and established their authority.
create function private.store_course_enrolment(
  p_course_run_id uuid,p_user_id uuid,p_status text,p_actor_id uuid,p_integration_key uuid
) returns void language plpgsql security invoker set search_path = '' as $$
declare previous text; course_end timestamptz;
begin
  if p_status='completed' then
    select max(ends_at) into course_end from public.course_sessions where course_run_id=p_course_run_id;
    if course_end is null or course_end>now() then
      raise exception 'Course has not completed' using errcode='22023';
    end if;
  end if;
  select status into previous from public.course_enrolments
  where course_run_id=p_course_run_id and user_id=p_user_id for update;
  insert into public.course_enrolments(course_run_id,user_id,status,enrolled_by)
  values(p_course_run_id,p_user_id,p_status,p_actor_id)
  on conflict(course_run_id,user_id) do update set status=excluded.status,updated_at=now();
  insert into public.audit_events(actor_id,action,resource_id,details)
  values(p_actor_id,'course.enrolment.changed',p_course_run_id,
    jsonb_build_object('user_id',p_user_id,'previous',previous,'status',p_status)
      || case when p_integration_key is null then '{}'::jsonb
              else jsonb_build_object('integration_key_id',p_integration_key) end);
end;
$$;

create or replace function private.manage_course_enrolment_before_chat_autosync(
  p_course_run_id uuid,p_user_id uuid,p_status text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  context jsonb;
  organisation_id uuid;
  is_internal boolean := (select edition='internal' from private.installation_identity);
begin
  if not is_internal then
    perform private.lock_academy_course_access();
    perform 1 from public.course_runs run
    join public.organisations org on org.id=run.organisation_id
    where run.id=p_course_run_id and run.archived_at is null and org.archived_at is null
    for update of run for share of org;
    if not found then raise insufficient_privilege; end if;
  end if;
  context := private.course_workspace_context(p_course_run_id);
  if not ((context->>'manager')::boolean or (context->>'client')::boolean) then
    raise exception 'Course enrolment management required' using errcode='42501';
  end if;
  if is_internal then perform private.lock_course_premium(p_course_run_id); end if;
  select run.organisation_id into organisation_id
  from public.course_runs run where run.id=p_course_run_id for update;
  if not found then raise exception 'Invalid course' using errcode='22023'; end if;
  if not private.active_company_participant(p_user_id,organisation_id) or
    p_status is null or p_status not in ('enrolled','completed','removed') then
    raise exception 'Active company participant required' using errcode='42501';
  end if;
  perform private.store_course_enrolment(p_course_run_id,p_user_id,p_status,auth.uid(),null);
end;
$$;

create function private.sync_course_enrolment_chat(
  p_course_run_id uuid,p_user_id uuid,p_status text
) returns void language plpgsql security invoker set search_path = '' as $$
declare room record; organisation_id uuid;
begin
  select run.organisation_id into organisation_id from public.course_runs run where run.id=p_course_run_id;
  for room in
    select id from public.chat_rooms where course_run_id=p_course_run_id and kind='participant_course'
    order by id for update
  loop
    if p_status in ('enrolled','completed') and private.active_company_participant(p_user_id,organisation_id) then
      perform private.participant_chat_assignment_grant(room.id,p_user_id);
      insert into public.chat_members(room_id,user_id) values(room.id,p_user_id)
      on conflict(room_id,user_id) do update set removed_at=null,joined_at=clock_timestamp();
    elsif p_status='removed' and exists (
      select 1 from private.participant_chat_origins origin
      where origin.room_id=room.id and origin.user_id=p_user_id and origin.assignment and not origin.unknown
    ) then
      perform private.participant_chat_assignment_release(room.id,p_user_id,p_course_run_id);
    end if;
  end loop;
end;
$$;

create or replace function private.manage_course_enrolment(
  p_course_run_id uuid,p_user_id uuid,p_status text
) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.manage_course_enrolment_before_chat_autosync(p_course_run_id,p_user_id,p_status);
  perform private.sync_course_enrolment_chat(p_course_run_id,p_user_id,p_status);
end;
$$;

create function private.integration_course_operation(
  p_id uuid,p_secret_hash text,p_action text,p_course_id uuid,p_participant_id text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  credential record;
  participant uuid;
  existing text;
  is_internal boolean := (select edition='internal' from private.installation_identity);
  key_purpose text := case p_action when 'enrol' then 'course-enrolment' when 'report' then 'course-report' end;
begin
  if key_purpose is null or p_course_id is null
    or (p_action='enrol' and (p_participant_id is null or p_participant_id !~ '^LV(-[0-9A-F]{4}){5}$'))
    or (p_action='report' and p_participant_id is not null)
  then return jsonb_build_object('status','invalid_request'); end if;
  if not is_internal then
    begin
      perform private.lock_academy_course_access();
    exception when insufficient_privilege then
      return jsonb_build_object('status','denied');
    end;
  end if;
  select * into credential from private.use_company_integration_key(p_id,p_secret_hash,key_purpose);
  if credential.key_status<>'ok' then return jsonb_build_object('status',credential.key_status); end if;

  perform 1 from public.course_runs run
  where run.id=p_course_id and run.organisation_id=credential.company_id
    and run.published and run.archived_at is null
  for update;
  if not found then return jsonb_build_object('status','not_found'); end if;
  if is_internal then
    begin
      perform private.lock_company_premium(credential.company_id);
    exception when insufficient_privilege then
      return jsonb_build_object('status','not_found');
    end;
  end if;

  if p_action='report' then
    return (
      select jsonb_build_object('status','ok','course_id',p_course_id,
        'session_count',(select count(*) from public.course_sessions where course_run_id=p_course_id),
        'enrolled_count',count(*) filter(where enrolment.status='enrolled'),
        'completed_count',count(*) filter(where enrolment.status='completed'))
      from public.course_enrolments enrolment
      where enrolment.course_run_id=p_course_id and enrolment.status in ('enrolled','completed')
        and private.active_company_participant(enrolment.user_id,credential.company_id)
    );
  end if;

  select profile.id into participant from public.profiles profile
  where profile.luminovia_user_id=p_participant_id and profile.active for share;
  if not found or not private.active_company_participant(participant,credential.company_id) then
    return jsonb_build_object('status','not_found');
  end if;
  select enrolment.status into existing from public.course_enrolments enrolment
  where enrolment.course_run_id=p_course_id and enrolment.user_id=participant for update;
  -- The integration only creates an enrolment. A retry cannot undo a human removal or completion.
  if existing is not null and existing<>'enrolled' then
    return jsonb_build_object('status','conflict');
  end if;
  if existing is null then
    begin
      perform private.store_course_enrolment(p_course_id,participant,'enrolled',credential.issuer_id,p_id);
      perform private.sync_course_enrolment_chat(p_course_id,participant,'enrolled');
    exception when sqlstate 'PT409' then
      return jsonb_build_object('status','conflict');
    end;
  end if;
  return jsonb_build_object('status','ok','course_id',p_course_id,'participant_id',p_participant_id);
end;
$$;

create function public.integration_course_operation(
  p_id uuid,p_secret_hash text,p_action text,p_course_id uuid,p_participant_id text
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.integration_course_operation(p_id,p_secret_hash,p_action,p_course_id,p_participant_id);
$$;

revoke all on function private.issue_scoped_company_integration_key(uuid,text,timestamptz,uuid,integer,text),
  public.issue_scoped_company_integration_key(uuid,text,timestamptz,uuid,integer,text),
  private.use_company_integration_key(uuid,text,text),private.store_course_enrolment(uuid,uuid,text,uuid,uuid),
  private.sync_course_enrolment_chat(uuid,uuid,text), private.integration_course_operation(uuid,text,text,uuid,text),
  public.integration_course_operation(uuid,text,text,uuid,text)
from public,anon,authenticated,service_role;
grant execute on function private.issue_scoped_company_integration_key(uuid,text,timestamptz,uuid,integer,text),
  public.issue_scoped_company_integration_key(uuid,text,timestamptz,uuid,integer,text) to authenticated;
grant execute on function private.integration_course_operation(uuid,text,text,uuid,text),
  public.integration_course_operation(uuid,text,text,uuid,text) to service_role;

create or replace function private.academy_course_index_service_allowed()
returns boolean language sql stable security definer set search_path = '' as $$
  select current_setting('role',true)='service_role'
    and current_setting('request.method',true)='POST'
    and current_setting('request.path',true) in ('/rpc/integration_course_index','/rpc/integration_course_operation')
    and coalesce(coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb->>'accept-profile','public')='public'
    and coalesce(coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb->>'content-profile','public')='public'
    and (select edition from private.installation_identity)<>'internal';
$$;

do $migration$
declare
  academy_gate text := pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  anchor constant text := '''/rpc/company_integration_keys'',''/rpc/issue_company_integration_key''';
begin
  if cardinality(string_to_array(academy_gate,anchor))<>2 then
    raise exception 'Expected the current Academy integration administration routes';
  end if;
  execute replace(academy_gate,anchor,anchor || ',''/rpc/issue_scoped_company_integration_key''');
end;
$migration$;

notify pgrst,'reload schema';
commit;
