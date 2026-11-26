-- Publish a provider's optional grading column in the same transaction as the reviewed link.
begin;

create function private.lti_validate_declared_lineitem(p_value jsonb)
returns void language plpgsql immutable set search_path = '' as $$
begin
  if jsonb_typeof(p_value) is distinct from 'object'
    or p_value - array['label','scoreMaximum','resourceId','tag','gradesReleased'] <> '{}'
    or jsonb_typeof(p_value->'scoreMaximum') is distinct from 'number'
    or (p_value->>'scoreMaximum')::numeric not between 0.000001 and 1000000000000
    or (p_value ? 'gradesReleased' and jsonb_typeof(p_value->'gradesReleased') <> 'boolean')
    then raise invalid_parameter_value; end if;
  if exists (
    select 1 from jsonb_each(p_value) field where field.key in ('label','resourceId','tag')
      and (jsonb_typeof(field.value) <> 'string' or length(btrim(field.value #>> '{}')) < 1
        or length(field.value #>> '{}') > case field.key when 'label' then 300 else 500 end
        or field.value #>> '{}' ~ '[[:cntrl:]]')
  ) then raise invalid_parameter_value; end if;
end;
$$;
revoke all on function private.lti_validate_declared_lineitem(jsonb) from public,anon,authenticated,service_role;

create or replace function private.receive_lti_deep_link(p_deployment uuid,p_version integer,p_data text,p_item jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  stage private.lti_deep_link_selections;
  tool private.lti_course_registrations;
  custom_args jsonb;
begin
  if p_data is null or p_data !~ '^[0-9a-f]{64}$' then raise invalid_parameter_value; end if;
  select * into tool from private.lti_course_registrations
  where id = p_deployment and version = p_version and active and deep_link_uri is not null for share;
  if not found or not private.lti_services_available(p_deployment) then raise insufficient_privilege; end if;

  if p_item is not null then
    if jsonb_typeof(p_item) is distinct from 'object'
      or p_item - array['title','url','custom','lineItem'] <> '{}'
      or jsonb_typeof(p_item->'title') is distinct from 'string'
      or length(btrim(p_item->>'title')) not between 1 and 160 or p_item->>'title' ~ '[[:cntrl:]]'
      or jsonb_typeof(p_item->'url') is distinct from 'string' or not private.lti_https_uri(p_item->>'url')
      or private.lti_uri_origin(p_item->>'url') is distinct from private.lti_uri_origin(tool.target_uri)
      then raise invalid_parameter_value; end if;
    if p_item ? 'lineItem' then
      if not tool.ags_enabled then raise insufficient_privilege; end if;
      perform private.lti_validate_declared_lineitem(p_item->'lineItem');
    end if;
    custom_args := coalesce(p_item->'custom','{}');
    if jsonb_typeof(custom_args) is distinct from 'object' or octet_length(custom_args::text) > 4096
      then raise invalid_parameter_value; end if;
    if exists (select 1 from jsonb_each(custom_args) argument
      where argument.key !~ '^[A-Za-z0-9_]{1,80}$' or jsonb_typeof(argument.value) <> 'string'
        or length(argument.value #>> '{}') > 512 or argument.value #>> '{}' ~ '[[:cntrl:]]')
      then raise invalid_parameter_value; end if;
  end if;

  update private.lti_deep_link_selections
  set responded = true, selection = p_item
  where registration_id = tool.id and registration_version = tool.version
    and data_hash = extensions.digest(p_data,'sha256') and expires_at > clock_timestamp()
    and not responded
  returning * into stage;
  if not found then raise insufficient_privilege; end if;
  return jsonb_build_object('id',stage.id,'origin',stage.portal_origin);
end;
$$;

create or replace function private.lti_deep_link_review(p_id uuid,p_action text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  stage private.lti_deep_link_selections;
  tool private.lti_course_registrations;
  context jsonb;
  grading jsonb;
  live_session uuid := nullif(auth.jwt()->>'session_id','')::uuid;
begin
  if p_action is null or p_action not in ('read','publish','withdraw') then raise invalid_parameter_value; end if;
  if p_action = 'withdraw' then
    select registration.* into tool
    from private.lti_resource_links link join private.lti_course_registrations registration on registration.id = link.registration_id
    where link.id = p_id;
    if not found then raise insufficient_privilege; end if;
    context := private.lti_course_access(tool.run_id);
    if (context->>'staff')::boolean is not true then raise insufficient_privilege; end if;
    update private.lti_resource_links set active = false where id = p_id and active;
    if found then
      insert into public.audit_events(actor_id,action,resource_id,details)
      values (auth.uid(),'course.lti_resource_withdrawn',tool.run_id,jsonb_build_object('link',p_id));
    end if;
    return jsonb_build_object('run_id',tool.run_id);
  end if;

  if live_session is null or not exists (select 1 from auth.sessions session
    where session.id = live_session and session.user_id = auth.uid()
      and (session.not_after is null or session.not_after > clock_timestamp()))
    then raise insufficient_privilege; end if;
  select * into stage from private.lti_deep_link_selections where id = p_id
    and actor = auth.uid() and session_id = live_session and responded and expires_at > clock_timestamp();
  if not found then raise insufficient_privilege; end if;
  select * into tool from private.lti_course_registrations where id = stage.registration_id and active;
  if not found then raise insufficient_privilege; end if;
  context := private.lti_course_access(tool.run_id);
  if (context->>'staff')::boolean is not true then raise insufficient_privilege; end if;
  select * into tool from private.lti_course_registrations where id = stage.registration_id and active for share;
  if not found or tool.version <> stage.registration_version or tool.deep_link_uri is null or tool.tool_public_key is null
    then raise insufficient_privilege; end if;

  if p_action = 'publish' then
    if stage.selection is null then raise invalid_parameter_value; end if;
    grading := stage.selection->'lineItem';
    if grading is not null and not tool.ags_enabled then raise insufficient_privilege; end if;
    insert into private.lti_resource_links(id,registration_id,title,target_uri,custom)
    values (stage.id,tool.id,btrim(stage.selection->>'title'),stage.selection->>'url',coalesce(stage.selection->'custom','{}'))
    on conflict (id) do nothing;
    if found then
      if grading is not null then
        perform private.lti_validate_declared_lineitem(grading);
        insert into private.lti_ags_lineitems(registration_id,id,resource_link_id,label,score_maximum,resource_id,tag)
        values (tool.id,stage.id,stage.id,btrim(coalesce(grading->>'label',stage.selection->>'title')),
          (grading->>'scoreMaximum')::numeric,grading->>'resourceId',grading->>'tag');
      end if;
      insert into public.audit_events(actor_id,action,resource_id,details)
      values (auth.uid(),'course.lti_resource_published',tool.run_id,
        jsonb_build_object('link',stage.id,'line_item',case when grading is not null then stage.id end));
    end if;
  end if;
  return jsonb_build_object('run_id',tool.run_id,'title',stage.selection->>'title',
    'target_uri',stage.selection->>'url','published',
    exists (select 1 from private.lti_resource_links where id = stage.id and active))
    || case when stage.selection ? 'lineItem' then jsonb_build_object('line_item',jsonb_build_object(
      'label',coalesce(stage.selection->'lineItem'->>'label',stage.selection->>'title'),
      'maximum',(stage.selection->'lineItem'->>'scoreMaximum')::numeric
    )) else '{}'::jsonb end;
end;
$$;

notify pgrst, 'reload schema';
commit;
