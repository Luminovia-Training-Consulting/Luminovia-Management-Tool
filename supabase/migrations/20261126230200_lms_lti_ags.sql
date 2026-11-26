-- Maintain external line items and results within the owning deployment.
-- A tool cannot publish or change a released Portal course grade.
begin;

alter table private.lti_course_registrations
  add column ags_enabled boolean not null default false,
  add constraint lti_ags_key_required check (not ags_enabled or tool_public_key is not null);
alter table private.lti_subjects add unique (registration_id, subject_id);

create table private.lti_ags_lineitems (
  registration_id uuid not null references private.lti_course_registrations(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  resource_link_id uuid,
  label text not null check (length(btrim(label)) between 1 and 300),
  score_maximum numeric not null check (score_maximum between 0.000001 and 1000000000000),
  resource_id text check (length(resource_id) between 1 and 500),
  tag text check (length(tag) between 1 and 500),
  starts_at timestamptz,
  ends_at timestamptz,
  archived_at timestamptz,
  primary key (registration_id, id),
  check (starts_at is null or ends_at is null or starts_at <= ends_at)
);
create index lti_ags_active_items on private.lti_ags_lineitems(registration_id, id)
  where archived_at is null;

create table private.lti_ags_results (
  registration_id uuid not null,
  line_item_id uuid not null,
  subject_id uuid not null,
  source_at timestamptz not null,
  score_ratio numeric check (score_ratio >= 0),
  activity_progress text not null check (activity_progress in ('Initialized','Started','InProgress','Submitted','Completed')),
  grading_progress text not null check (grading_progress in ('FullyGraded','Pending','PendingManual','Failed','NotReady')),
  comment text check (length(comment) <= 2000),
  primary key (registration_id, line_item_id, subject_id),
  foreign key (registration_id, line_item_id) references private.lti_ags_lineitems(registration_id, id) on delete cascade,
  foreign key (registration_id, subject_id) references private.lti_subjects(registration_id, subject_id) on delete cascade
);
create index lti_ags_results_subject on private.lti_ags_results(registration_id,subject_id);
alter table private.lti_ags_lineitems enable row level security;
alter table private.lti_ags_results enable row level security;
revoke all on private.lti_ags_lineitems, private.lti_ags_results from public, anon, authenticated, service_role;

create function private.configure_course_lti_ags(p_registration_id uuid,p_expected_version integer,p_ags boolean)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  run uuid;
  next_revision integer;
  context jsonb;
begin
  select registration.run_id into run from private.lti_course_registrations registration where id = p_registration_id;
  if not found then raise insufficient_privilege; end if;
  context := private.lti_course_access(run);
  if (context->>'manager')::boolean is not true then raise insufficient_privilege; end if;
  if p_ags is null or p_expected_version is null or p_expected_version < 1 then raise invalid_parameter_value; end if;
  update private.lti_course_registrations tool set ags_enabled = p_ags, version = tool.version + 1
  where tool.id = p_registration_id and tool.version = p_expected_version and (not p_ags or tool.tool_public_key is not null)
  returning version into next_revision;
  if not found then raise exception 'LTI registration changed or public key is missing' using errcode = 'PT409'; end if;
  insert into public.audit_events(actor_id,action,resource_id,details) values
    (auth.uid(),'course.lti_ags_configured',run,jsonb_build_object('registration',p_registration_id,'enabled',p_ags));
  return next_revision;
end;
$$;

-- A service token never grants a scope that the course manager has disabled.
create or replace function private.lti_issue_service_token(
  p_deployment uuid, p_version integer, p_assertion_id text, p_assertion_expiry timestamptz, p_scopes text[]
) returns text language plpgsql security definer set search_path = '' as $$
declare
  tool private.lti_course_registrations;
  clock_value timestamptz := clock_timestamp();
  token text := encode(extensions.gen_random_bytes(32),'hex');
  allowed text[] := '{}';
  roster_scope constant text := 'https://purl.imsglobal.org/spec/lti-nrps/scope/contextmembership.readonly';
  grading_scopes constant text[] := array['https://purl.imsglobal.org/spec/lti-ags/scope/lineitem',
    'https://purl.imsglobal.org/spec/lti-ags/scope/lineitem.readonly',
    'https://purl.imsglobal.org/spec/lti-ags/scope/result.readonly',
    'https://purl.imsglobal.org/spec/lti-ags/scope/score'];
begin
  if p_assertion_id is null or length(p_assertion_id) not between 1 and 255 or p_assertion_expiry is null
    or p_assertion_expiry <= clock_value or p_assertion_expiry > clock_value + interval '6 minutes'
    or p_scopes is null or cardinality(p_scopes) not between 1 and 5
    or array_position(p_scopes,null) is not null or not p_scopes <@ (grading_scopes || roster_scope)
    then raise invalid_parameter_value; end if;
  select * into tool from private.lti_course_registrations where id = p_deployment for update;
  if not found or tool.version is distinct from p_version or not private.lti_services_available(p_deployment)
    then raise insufficient_privilege; end if;
  if tool.nrps_enabled then
    allowed := allowed || roster_scope;
  end if;
  if tool.ags_enabled then
    allowed := allowed || grading_scopes;
  end if;
  if not p_scopes <@ allowed then raise insufficient_privilege; end if;

  delete from private.lti_tool_assertions where registration_id = tool.id and expires_at <= clock_value;
  delete from private.lti_service_tokens where registration_id = tool.id
    and (expires_at <= clock_value or registration_version <> tool.version);
  insert into private.lti_tool_assertions values (tool.id, p_assertion_id, p_assertion_expiry)
    on conflict do nothing;
  if not found then raise insufficient_privilege; end if;
  insert into private.lti_service_tokens(token_hash,registration_id,registration_version,scopes,expires_at)
    values (extensions.digest(token,'sha256'),tool.id,tool.version,p_scopes,clock_value + interval '5 minutes');
  return token;
end;
$$;

create function private.lti_ags_lineitem_json(item private.lti_ags_lineitems)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id',item.id,'label',item.label,'scoreMaximum',item.score_maximum,
    'resourceLinkId',item.resource_link_id,'resourceId',item.resource_id,
    'tag',item.tag,'startDateTime',item.starts_at,'endDateTime',item.ends_at
  ));
$$;

-- One service RPC keeps the line-item, result, and score ACLs consistent.
-- The credential is opaque, tied to a registration revision and checked inside the database.
create function private.lti_ags_service(
  p_deployment uuid,p_token text,p_action text,p_item uuid,p_input jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  scope_prefix constant text := 'https://purl.imsglobal.org/spec/lti-ags/scope/';
  tool private.lti_course_registrations;
  row_item private.lti_ags_lineitems;
  run_org uuid;
  member uuid;
  after_id uuid;
  link_id uuid;
  new_label text;
  resource text;
  item_tag text;
  maximum numeric;
  score numeric;
  denominator numeric;
  activity text;
  grading text;
  source_time timestamptz;
  start_time timestamptz;
  end_time timestamptz;
  page_size integer;
  is_link_owned boolean;
  required_scope text;
begin
  if p_action is null or p_action not in ('list','read','create','update','delete','results','score')
    or jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text) > 8192
    or (p_action in ('list','create')) is distinct from (p_item is null)
    then raise invalid_parameter_value; end if;
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise insufficient_privilege; end if;
  select * into tool from private.lti_course_registrations where id = p_deployment and ags_enabled for share;
  if not found then raise insufficient_privilege; end if;
  required_scope := scope_prefix || case p_action when 'results' then 'result.readonly' when 'score' then 'score'
    when 'list' then 'lineitem.readonly' when 'read' then 'lineitem.readonly' else 'lineitem' end;
  if not private.lti_service_token_allows(p_deployment,p_token,required_scope) and
    not (p_action in ('list','read') and private.lti_service_token_allows(p_deployment,p_token,scope_prefix || 'lineitem'))
    then raise insufficient_privilege; end if;

  if p_item is not null then
    select * into row_item from private.lti_ags_lineitems
    where registration_id = tool.id and id = p_item and archived_at is null for no key update;
    if not found then raise exception 'LTI line item unavailable' using errcode = 'PT404'; end if;
  end if;
  if p_action in ('list','results') then
    page_size := coalesce((p_input->>'limit')::integer, 100);
    after_id := (p_input->>'after')::uuid;
    if page_size not between 1 and 200 then raise invalid_parameter_value; end if;
  end if;

  if p_action = 'list' then
    return (
      select coalesce(jsonb_agg(private.lti_ags_lineitem_json(item) order by item.id),'[]'::jsonb)
      from (
        select entry.* from private.lti_ags_lineitems entry
        where entry.registration_id = tool.id and entry.archived_at is null
          and (after_id is null or entry.id > after_id)
          and (p_input->>'resource_id' is null or entry.resource_id = p_input->>'resource_id')
          and (p_input->>'tag' is null or entry.tag = p_input->>'tag')
          and (p_input->>'resource_link_id' is null or entry.resource_link_id = (p_input->>'resource_link_id')::uuid)
        order by entry.id limit page_size + 1
      ) item
    );
  elsif p_action = 'read' then
    return private.lti_ags_lineitem_json(row_item);
  elsif p_action = 'delete' then
    update private.lti_ags_lineitems set archived_at = statement_timestamp()
    where registration_id = tool.id and id = p_item;
    return 'true'::jsonb;
  elsif p_action in ('create','update') then
    if jsonb_typeof(p_input->'label') is distinct from 'string'
      or jsonb_typeof(p_input->'scoreMaximum') is distinct from 'number'
      or (p_input->>'resourceLinkId' is not null and jsonb_typeof(p_input->'resourceLinkId') <> 'string')
      or (p_input->>'resourceId' is not null and jsonb_typeof(p_input->'resourceId') <> 'string')
      or (p_input->>'tag' is not null and jsonb_typeof(p_input->'tag') <> 'string')
      or (p_input->>'startDateTime' is not null and jsonb_typeof(p_input->'startDateTime') <> 'string')
      or (p_input->>'endDateTime' is not null and jsonb_typeof(p_input->'endDateTime') <> 'string')
      then raise invalid_parameter_value; end if;
    new_label := btrim(p_input->>'label');
    maximum := (p_input->>'scoreMaximum')::numeric;
    resource := nullif(p_input->>'resourceId','');
    item_tag := nullif(p_input->>'tag','');
    start_time := nullif(p_input->>'startDateTime','')::timestamptz;
    end_time := nullif(p_input->>'endDateTime','')::timestamptz;
    link_id := (p_input->>'resourceLinkId')::uuid;
    if length(new_label) not between 1 and 300 or maximum not between 0.000001 and 1000000000000
      or length(resource) > 500 or length(item_tag) > 500
      or (start_time is not null and not isfinite(start_time)) or (end_time is not null and not isfinite(end_time))
      or start_time > end_time then raise invalid_parameter_value; end if;
    if link_id is not null and link_id <> tool.id then
      if to_regclass('private.lti_resource_links') is not null then
        select exists (select 1 from private.lti_resource_links link
          where link.id = link_id and link.registration_id = tool.id and link.active) into is_link_owned;
      end if;
      if not coalesce(is_link_owned,false) then raise exception 'LTI resource link unavailable' using errcode = 'PT404'; end if;
    end if;
    if p_action = 'create' then
      insert into private.lti_ags_lineitems(registration_id,resource_link_id,label,score_maximum,resource_id,tag,starts_at,ends_at)
      values (tool.id,link_id,new_label,maximum,resource,item_tag,start_time,end_time) returning * into row_item;
    else
      if p_input ? 'resourceLinkId' and row_item.resource_link_id is distinct from link_id
        then raise invalid_parameter_value; end if;
      update private.lti_ags_lineitems item set label=new_label,score_maximum=maximum,
        resource_id=resource,tag=item_tag,starts_at=start_time,ends_at=end_time
      where item.registration_id = tool.id and item.id = p_item returning * into row_item;
    end if;
    return private.lti_ags_lineitem_json(row_item);
  end if;

  select organisation_id into strict run_org from public.course_runs where id = tool.run_id;
  if p_action = 'results' then
    member := (p_input->>'user_id')::uuid;
    return (
      select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'userId', result.subject_id,
        'resultScore', result.score_ratio * row_item.score_maximum,
        'resultMaximum', row_item.score_maximum,
        'comment', result.comment
      )) order by result.subject_id),'[]'::jsonb)
      from (
        select grade.* from private.lti_ags_results grade
        join private.lti_subjects subject using (registration_id, subject_id)
        join private.lti_roster(tool.run_id,run_org) roster on roster.user_id = subject.user_id and roster.learner
        where grade.registration_id = tool.id and grade.line_item_id = p_item
          and (grade.score_ratio is not null or grade.comment is not null)
          and (member is null or grade.subject_id = member) and (after_id is null or grade.subject_id > after_id)
        order by grade.subject_id limit page_size + 1
      ) result
    );
  end if;

  -- Resolve the tool's opaque subject and pin the current membership while writing.
  if jsonb_typeof(p_input->'userId') is distinct from 'string'
    or jsonb_typeof(p_input->'timestamp') is distinct from 'string'
    or jsonb_typeof(p_input->'activityProgress') is distinct from 'string'
    or jsonb_typeof(p_input->'gradingProgress') is distinct from 'string'
    or (p_input->>'comment' is not null and jsonb_typeof(p_input->'comment') <> 'string')
    or (p_input->>'scoreGiven' is not null and jsonb_typeof(p_input->'scoreGiven') <> 'number')
    or (p_input->>'scoreMaximum' is not null and jsonb_typeof(p_input->'scoreMaximum') <> 'number')
    then raise invalid_parameter_value; end if;
  member := (p_input->>'userId')::uuid;
  source_time := (p_input->>'timestamp')::timestamptz;
  activity := p_input->>'activityProgress';
  grading := p_input->>'gradingProgress';
  score := (p_input->>'scoreGiven')::numeric;
  denominator := (p_input->>'scoreMaximum')::numeric;
  if not isfinite(source_time) or source_time > statement_timestamp() + interval '5 minutes'
    or activity not in ('Initialized','Started','InProgress','Submitted','Completed')
    or grading not in ('FullyGraded','Pending','PendingManual','Failed','NotReady')
    or length(p_input->>'comment') > 2000
    or score not between 0 and 1000000000000
    or (score is not null and (denominator is null or denominator not between 0.000001 and 1000000000000))
    then raise invalid_parameter_value; end if;
  perform 1 from private.lti_subjects subject
  join public.course_enrolments enrolment on enrolment.user_id = subject.user_id and enrolment.course_run_id = tool.run_id
  join private.company_participant_memberships membership on membership.user_id = subject.user_id and membership.organisation_id = run_org
  join public.profiles profile on profile.id = subject.user_id
  where subject.registration_id = tool.id and subject.subject_id = member
    and enrolment.status in ('enrolled','completed') and membership.status = 'active' and profile.active
    and private.active_company_participant(subject.user_id,run_org)
  for share of subject,enrolment,membership,profile;
  if not found then raise exception 'LTI learner unavailable' using errcode = 'PT404'; end if;
  insert into private.lti_ags_results(registration_id,line_item_id,subject_id,source_at,score_ratio,activity_progress,grading_progress,comment)
  values (tool.id,p_item,member,source_time,case when grading = 'FullyGraded' then score / denominator end,activity,grading,p_input->>'comment')
  on conflict (registration_id,line_item_id,subject_id) do update set
    source_at=excluded.source_at,
    score_ratio=case when excluded.grading_progress = 'FullyGraded' then excluded.score_ratio else lti_ags_results.score_ratio end,
    activity_progress=excluded.activity_progress,grading_progress=excluded.grading_progress,comment=excluded.comment
    where lti_ags_results.source_at < excluded.source_at;
  return 'true'::jsonb;
end;
$$;

-- The teaching team sees linked external results separately from released grades.
create function private.course_lti_ags_grades(p_registration_id uuid,p_after uuid,p_limit integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  tool private.lti_course_registrations;
  context jsonb;
  run_org uuid;
begin
  if p_limit is null or p_limit not between 1 and 20 then raise invalid_parameter_value; end if;
  select * into tool from private.lti_course_registrations where id = p_registration_id;
  if not found then raise insufficient_privilege; end if;
  context := private.course_workspace_context(tool.run_id);
  if (context->>'lms_enabled')::boolean is not true or (context->>'staff')::boolean is not true
    or ((select edition from private.installation_identity) is distinct from 'internal'
      and not coalesce(private.academy_course_access_status() in ('active','grace'),false))
    then raise insufficient_privilege; end if;
  select organisation_id into strict run_org from public.course_runs where id = tool.run_id;
  return (
    select coalesce(jsonb_agg(row.data order by row.id),'[]'::jsonb)
    from (
      select item.id,jsonb_build_object('id',item.id,'label',item.label,'maximum',item.score_maximum,
        'graded',(select count(*) from private.lti_ags_results grade
          join private.lti_subjects subject using (registration_id,subject_id)
          join private.lti_roster(tool.run_id,run_org) roster on roster.user_id = subject.user_id and roster.learner
          where grade.registration_id = tool.id and grade.line_item_id = item.id and grade.score_ratio is not null),
        'results',(select coalesce(jsonb_agg(score.data order by score.name,score.subject_id),'[]'::jsonb) from (
          select profile.display_name as name,subject.subject_id,jsonb_build_object(
            'subject_id',subject.subject_id,'name',profile.display_name,'score',grade.score_ratio * item.score_maximum,
            'grading_progress',grade.grading_progress,'comment',grade.comment
          ) as data
          from private.lti_ags_results grade
          join private.lti_subjects subject using (registration_id,subject_id)
          join private.lti_roster(tool.run_id,run_org) roster on roster.user_id = subject.user_id and roster.learner
          join public.profiles profile on profile.id = roster.user_id
          where grade.registration_id = tool.id and grade.line_item_id = item.id
          order by profile.display_name,subject.subject_id limit 100
        ) score)) as data
      from private.lti_ags_lineitems item where item.registration_id = tool.id and item.archived_at is null
        and (p_after is null or item.id > p_after)
      order by item.id limit p_limit + 1
    ) row
  );
end;
$$;

create function private.lti_ags_single_lineitem(p_registration uuid,p_link uuid)
returns uuid language sql stable set search_path = '' as $$
  select case when count(*) = 1 then (array_agg(item.id))[1] end
  from private.lti_ags_lineitems item
  where item.registration_id = p_registration and item.resource_link_id = p_link and item.archived_at is null;
$$;

create function public.configure_course_lti_ags(p_registration_id uuid,p_expected_version integer,p_ags boolean)
returns integer language sql security invoker set search_path = '' as $$
  select private.configure_course_lti_ags(p_registration_id,p_expected_version,p_ags);
$$;
create function public.course_lti_ags_grades(p_registration_id uuid,p_after uuid,p_limit integer)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.course_lti_ags_grades(p_registration_id,p_after,p_limit);
$$;
create function public.lti_ags_service(p_deployment uuid,p_token text,p_action text,p_item uuid,p_input jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.lti_ags_service(p_deployment,p_token,p_action,p_item,p_input);
$$;

revoke all on function private.lti_ags_lineitem_json(private.lti_ags_lineitems),private.lti_ags_single_lineitem(uuid,uuid),
  private.lti_ags_service(uuid,text,text,uuid,jsonb),public.lti_ags_service(uuid,text,text,uuid,jsonb),
  private.configure_course_lti_ags(uuid,integer,boolean),public.configure_course_lti_ags(uuid,integer,boolean),
  private.course_lti_ags_grades(uuid,uuid,integer),public.course_lti_ags_grades(uuid,uuid,integer)
  from public, anon, authenticated, service_role;
grant execute on function private.lti_ags_service(uuid,text,text,uuid,jsonb),public.lti_ags_service(uuid,text,text,uuid,jsonb)
  to service_role;
grant execute on function private.configure_course_lti_ags(uuid,integer,boolean),public.configure_course_lti_ags(uuid,integer,boolean),
  private.course_lti_ags_grades(uuid,uuid,integer),public.course_lti_ags_grades(uuid,uuid,integer)
  to authenticated;

-- Use narrow additions to the existing current-role and licence projections.
do $$
declare
  tool_list text := pg_catalog.pg_get_functiondef('private.course_lti_tools(uuid)'::regprocedure);
  advantage_config text := pg_catalog.pg_get_functiondef('private.configure_course_lti_advantage(uuid,integer,jsonb,boolean)'::regprocedure);
  launch text := pg_catalog.pg_get_functiondef('private.consume_lti_launch(text,text,uuid,text,text,text,text)'::regprocedure);
  gate text := pg_catalog.pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  list_anchor constant text := $anchor$'nrps_enabled', registration.nrps_enabled,$anchor$;
  tool_base constant text := $anchor$'version', registration.version$anchor$;
  config_anchor constant text := 'tool_public_key = p_public_key, nrps_enabled = p_nrps,';
  launch_anchor constant text := $anchor$|| case when tool.nrps_enabled then jsonb_build_object('nrps_enabled',true)$anchor$;
  write_anchor constant text := '''/rpc/configure_course_lti_advantage''';
  read_anchor constant text := '''/rpc/course_lti_tools''';
begin
  if cardinality(string_to_array(tool_list,list_anchor)) <> 2
    or cardinality(string_to_array(tool_list,tool_base)) <> 2
    or cardinality(string_to_array(advantage_config,config_anchor)) <> 2
    or cardinality(string_to_array(launch,launch_anchor)) <> 2
    or cardinality(string_to_array(gate,write_anchor)) <> 2
    or cardinality(string_to_array(gate,read_anchor)) <> 2
    then raise exception 'Expected LTI service, configuration and gate anchors'; end if;
  execute replace(replace(tool_list,list_anchor,list_anchor || '''ags_enabled'', registration.ags_enabled,'),
    tool_base,tool_base || $view$,'view_grades', (context->>'staff')::boolean and (
      registration.ags_enabled or exists (select from private.lti_ags_lineitems column_item
        where column_item.registration_id = registration.id and column_item.archived_at is null)
    )$view$);
  execute replace(advantage_config,config_anchor,config_anchor || ' ags_enabled = p_public_key is not null and registration.ags_enabled,');
  execute replace(launch,launch_anchor,
    $ags$|| case when tool.ags_enabled then jsonb_strip_nulls(jsonb_build_object(
      'ags_enabled',true,'ags_lineitem',private.lti_ags_single_lineitem(
        tool.id, coalesce((to_jsonb(hint)->>'resource_link_id')::uuid,tool.id)
      )
    )) else '{}'::jsonb end $ags$ || launch_anchor);
  execute replace(replace(gate,write_anchor,write_anchor || ', ''/rpc/configure_course_lti_ags'''),
    read_anchor,read_anchor || ', ''/rpc/course_lti_ags_grades''');
end;
$$;

notify pgrst, 'reload schema';
commit;
