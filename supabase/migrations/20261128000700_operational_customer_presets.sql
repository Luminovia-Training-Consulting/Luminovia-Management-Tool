begin;

-- These presets contain operational defaults only. Meeting secrets, prices
-- and publication consent stay with the individual course or offer.
create table private.training_operational_presets (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  revision integer not null default 1 check (revision > 0),
  archived_at timestamptz,
  config jsonb not null check (jsonb_typeof(config)='object')
);
create index training_operational_presets_company on private.training_operational_presets(organisation_id);
create unique index training_operational_presets_name on private.training_operational_presets(organisation_id, lower(name))
  where archived_at is null;
alter table private.training_operational_presets enable row level security;
revoke all on private.training_operational_presets from public,anon,authenticated,service_role;

create function private.require_training_operational_presets(p_organisation_id uuid)
returns void language plpgsql stable security invoker set search_path='' as $$
begin
  if not private.actor_active() or not private.has_permission('courses.manage')
    or not exists(select 1 from private.installation_identity where edition='internal')
    or not exists(select 1 from public.organisations where id=p_organisation_id and archived_at is null)
    then raise insufficient_privilege;
  end if;
end;
$$;

create function private.training_operational_presets(p_organisation_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform private.require_training_operational_presets(p_organisation_id);
  return coalesce((
    select jsonb_agg(to_jsonb(preset)-'organisation_id' order by lower(preset.name),preset.id)
    from private.training_operational_presets preset
    where preset.organisation_id=p_organisation_id and preset.archived_at is null
  ),'[]'::jsonb);
end;
$$;

create function private.validate_training_operational_preset(p_organisation_id uuid,p_config jsonb)
returns void language plpgsql stable security invoker set search_path='' as $$
declare
  source public.course_runs;
  delivery jsonb := p_config->'delivery';
  contact uuid;
begin
  if jsonb_typeof(p_config) is distinct from 'object'
    or not (p_config ?& array['time_zone','delivery','contact_id','starts_at','ends_at'])
    or p_config-array['time_zone','delivery','contact_id','starts_at','ends_at']<>'{}'
    or exists (select 1 from unnest(array['time_zone','contact_id','starts_at','ends_at']) as key
      where jsonb_typeof(p_config->key) not in ('string','null'))
    or (p_config->>'time_zone' is not null and not exists(
      select 1 from pg_catalog.pg_timezone_names where name=p_config->>'time_zone'))
    or (p_config->>'starts_at' is null) <> (p_config->>'ends_at' is null)
    or (p_config->>'starts_at' is not null and (
      p_config->>'starts_at' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      or p_config->>'ends_at' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      or (p_config->>'starts_at')::time >= (p_config->>'ends_at')::time))
    or (delivery is distinct from 'null'::jsonb and (
      jsonb_typeof(delivery) is distinct from 'object'
      or not (delivery ?& array['mode','venue_id','meeting_platform','teaching_instructions'])
      or delivery-array['mode','venue_id','meeting_platform','teaching_instructions']<>'{}'
      or jsonb_typeof(delivery->'teaching_instructions') is distinct from 'string'))
    then raise invalid_parameter_value; end if;
  contact := (p_config->>'contact_id')::uuid;
  if contact is not null and not exists(select 1 from public.organisation_contacts where id=contact
    and organisation_id=p_organisation_id and archived_at is null) then raise insufficient_privilege; end if;
  if jsonb_typeof(delivery)='object' then
    source.organisation_id := p_organisation_id;
    perform private.validate_training_delivery_config(source,delivery,null,true);
  end if;
end;
$$;

create function private.save_training_operational_preset(
  p_organisation_id uuid,p_preset_id uuid,p_expected_revision integer,p_payload jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  saved private.training_operational_presets;
  title text := btrim(p_payload->>'name');
  should_archive boolean;
begin
  perform private.require_training_operational_presets(p_organisation_id);
  perform 1 from public.organisations where id=p_organisation_id and archived_at is null for no key update;
  if not found then raise insufficient_privilege; end if;
  if p_expected_revision is null or p_expected_revision<0 or jsonb_typeof(p_payload) is distinct from 'object'
    or p_payload-array['name','config','archived']<>'{}'
    or jsonb_typeof(p_payload->'name') is distinct from 'string'
    or title is null or char_length(title) not between 1 and 120
    or jsonb_typeof(p_payload->'archived') is distinct from 'boolean'
    then raise invalid_parameter_value; end if;
  should_archive := (p_payload->>'archived')::boolean;
  if p_preset_id is not null then
    select * into saved from private.training_operational_presets
      where id=p_preset_id and organisation_id=p_organisation_id for update;
    if not found then raise insufficient_privilege; end if;
    if saved.revision<>p_expected_revision or saved.archived_at is not null then
      raise exception 'Operational preset revision changed' using errcode='PT409';
    end if;
  elsif p_expected_revision<>0 or should_archive then raise invalid_parameter_value;
  end if;
  if should_archive then
    update private.training_operational_presets set archived_at=now(),revision=revision+1 where id=saved.id
      returning * into saved;
  else
    perform private.validate_training_operational_preset(p_organisation_id,p_payload->'config');
    if saved.id is null then
      if (select count(*) from private.training_operational_presets where organisation_id=p_organisation_id
        and archived_at is null)>=100 then raise program_limit_exceeded; end if;
      insert into private.training_operational_presets(organisation_id,name,config)
      values(p_organisation_id,title,p_payload->'config') returning * into saved;
    else
      update private.training_operational_presets set name=title,config=p_payload->'config',revision=revision+1
        where id=saved.id returning * into saved;
    end if;
  end if;
  return to_jsonb(saved)-'organisation_id';
end;
$$;

-- The exact, company-owned revision is locked before preview or adoption.
create function private.review_training_operational_preset(p_organisation_id uuid,p_selection jsonb)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare
  selected private.training_operational_presets;
begin
  if p_selection is null or p_selection='null'::jsonb then return null; end if;
  if jsonb_typeof(p_selection) is distinct from 'object' or p_selection-array['id','revision','apply_delivery']<>'{}'
    or jsonb_typeof(p_selection->'apply_delivery') is distinct from 'boolean' then raise invalid_parameter_value; end if;
  perform private.require_training_operational_presets(p_organisation_id);
  select * into selected from private.training_operational_presets
    where id=(p_selection->>'id')::uuid and organisation_id=p_organisation_id for share;
  if not found then raise insufficient_privilege; end if;
  if selected.archived_at is not null or selected.revision is distinct from (p_selection->>'revision')::integer then
    raise exception 'Operational preset revision changed' using errcode='PT409';
  end if;
  perform private.validate_training_operational_preset(p_organisation_id,selected.config);
  return selected.config;
end;
$$;

-- The new course receives a copy. Later preset edits cannot change it.
create function private.apply_training_operational_preset(p_run uuid,p_selection jsonb)
returns void language plpgsql volatile security invoker set search_path='' as $$
declare
  run public.course_runs;
  config jsonb;
  contact uuid;
  delivery jsonb;
begin
  if p_selection is null or p_selection='null'::jsonb then return; end if;
  select * into strict run from public.course_runs where id=p_run;
  config := private.review_training_operational_preset(run.organisation_id,p_selection);
  contact := (config->>'contact_id')::uuid;
  delivery := config->'delivery';
  if contact is not null then
    perform 1 from public.organisation_contacts where id=contact and organisation_id=run.organisation_id
      and archived_at is null for share;
    if not found then raise insufficient_privilege; end if;
    insert into private.course_workspace_settings(run_id,contact_id,version) values(p_run,contact,1);
  end if;
  if (p_selection->>'apply_delivery')::boolean and jsonb_typeof(delivery)='object' then
    if run.delivery_type::text <> (case when delivery->>'mode'='onsite' then 'onsite' else 'online' end)
      then raise invalid_parameter_value; end if;
    perform private.save_training_delivery(p_run,0,jsonb_build_object(
      'defaults',delivery,'overrides_enabled',false,'overrides','{}'::jsonb));
  end if;
end;
$$;

do $migration$
declare
  definition text := pg_get_functiondef('private.course_creator_draft_action(text,uuid,integer,jsonb)'::regprocedure);
  old_keys constant text := '''delivery_type'', ''venue'', ''sessions'', ''teaching_language'']';
  old_run constant text := 'private.save_course_run(null, run_payload ||';
  old_receipt constant text := '    update private.course_creator_drafts' || chr(10) || '    set payload = ''{}'', state = ''created''';
begin
  if cardinality(string_to_array(definition,old_keys))<>2 or cardinality(string_to_array(definition,old_run))<>2
    or cardinality(string_to_array(definition,old_receipt))<>2 then
    raise exception 'Expected current course creator confirmation';
  end if;
  definition := replace(definition,old_keys,'''delivery_type'', ''venue'', ''sessions'', ''teaching_language'', ''operational_preset'']');
  definition := replace(definition,old_run,'private.save_course_run(null, (run_payload - ''operational_preset'') ||');
  definition := replace(definition,old_receipt,
    '    perform private.apply_training_operational_preset(created_course,run_payload->''operational_preset'');'
    || chr(10) || old_receipt);
  execute definition;
end;
$migration$;

-- Series review and commit keep the existing digest, confirmation and conflict
-- path. A per-run selection is optional, including for existing API clients.
do $migration$
declare
  definition text := pg_get_functiondef('private.plan_course_series(uuid,uuid,text,jsonb,uuid)'::regprocedure);
  patch record;
begin
  for patch in select * from (values
    ($old$  row_data jsonb;$old$,$new$  row_data jsonb;
  preset_config jsonb;$new$),
    ($old$array['delivery_type','venue','class_id','sessions']$old$,
      $new$array['delivery_type','venue','class_id','sessions','operational_preset']$new$),
    ($old$    class_id := (row_data->>'class_id')::uuid;
    if class_id is not null then
      perform 1$old$,$new$    preset_config := private.review_training_operational_preset(p_organisation_id,row_data->'operational_preset');
    if (row_data#>>'{operational_preset,apply_delivery}')::boolean and jsonb_typeof(preset_config->'delivery')='object'
      and row_data->>'delivery_type' <> (case when preset_config#>>'{delivery,mode}'='onsite' then 'onsite' else 'online' end)
      then raise invalid_parameter_value; end if;
    class_id := (row_data->>'class_id')::uuid;
    if class_id is not null then
      perform 1$new$),
    ($old$      tstzrange((session.value->>'starts_at')$old$,$new$
      case when (plan.value#>>'{operational_preset,apply_delivery}')::boolean
        and preset.config#>>'{delivery,mode}' in ('onsite','hybrid')
        then preset.config#>>'{delivery,venue_id}' end as structured_room,
      tstzrange((session.value->>'starts_at')$new$),
    ($old$    cross join lateral jsonb_array_elements(plan.value->'sessions') with ordinality session$old$,$new$    cross join lateral jsonb_array_elements(plan.value->'sessions') with ordinality session
    left join private.training_operational_presets preset
      on preset.id=(plan.value#>>'{operational_preset,id}')::uuid and preset.organisation_id=p_organisation_id$new$),
    ($old$      tstzrange(session.starts_at, session.ends_at, '[)') as slot$old$,$new$      case when effective.config->>'mode' in ('onsite','hybrid') then effective.config->>'venue_id' end as structured_room,
      tstzrange(session.starts_at, session.ends_at, '[)') as slot$new$),
    ($old$    where run.organisation_id = p_organisation_id$old$,$new$    left join private.training_course_delivery delivery on delivery.course_run_id=run.id
    left join private.training_session_delivery overrides on overrides.course_session_id=session.id and delivery.overrides_enabled
    cross join lateral (select delivery.defaults || coalesce(overrides.config,'{}'::jsonb) as config) effective
    where run.organisation_id = p_organisation_id$new$),
    ($old$in (select room from requested where room is not null)))$old$,$new$in (select room from requested where room is not null))
        or (effective.config->>'mode' in ('onsite','hybrid')
          and effective.config->>'venue_id' in (select structured_room from requested where structured_room is not null)))$new$),
    ($old$        ) then 'room'
      end as reason$old$,$new$        ) then 'room'
        when r.structured_room is not null and (
          exists(select 1 from requested peer where r.run_no<>peer.run_no and r.structured_room=peer.structured_room and r.slot && peer.slot)
          or exists(select 1 from recorded peer where r.structured_room=peer.structured_room and r.slot && peer.slot)
        ) then 'room'
      end as reason$new$),
    ($old$private.save_course_run(null, (row_data - 'class_id') ||$old$,
      $new$private.save_course_run(null, (row_data - array['class_id','operational_preset']) ||$new$),
    ($old$    class_id := (row_data->>'class_id')::uuid;
    if class_id is not null then
      insert into$old$,$new$    perform private.apply_training_operational_preset(target,row_data->'operational_preset');
    class_id := (row_data->>'class_id')::uuid;
    if class_id is not null then
      insert into$new$)
  ) values_to_patch(before_code,after_code) loop
    if cardinality(string_to_array(definition,patch.before_code))<>2 then
      raise exception 'Expected current course series definition near %',patch.before_code;
    end if;
    definition := replace(definition,patch.before_code,patch.after_code);
  end loop;
  execute definition;
end;
$migration$;

create function public.training_operational_presets(p_organisation_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
  select private.training_operational_presets(p_organisation_id)
$$;
create function public.save_training_operational_preset(
  p_organisation_id uuid,p_preset_id uuid,p_expected_revision integer,p_payload jsonb
) returns jsonb language sql security invoker set search_path='' as $$
  select private.save_training_operational_preset(p_organisation_id,p_preset_id,p_expected_revision,p_payload)
$$;
revoke all on function private.require_training_operational_presets(uuid),
  private.validate_training_operational_preset(uuid,jsonb),private.review_training_operational_preset(uuid,jsonb),
  private.apply_training_operational_preset(uuid,jsonb),
  private.training_operational_presets(uuid),public.training_operational_presets(uuid),
  private.save_training_operational_preset(uuid,uuid,integer,jsonb),
  public.save_training_operational_preset(uuid,uuid,integer,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function private.training_operational_presets(uuid),public.training_operational_presets(uuid),
  private.save_training_operational_preset(uuid,uuid,integer,jsonb),
  public.save_training_operational_preset(uuid,uuid,integer,jsonb) to authenticated;
-- A confirmed company deletion owns its reusable presets and fences later edits.
alter function private.deletion_scope(text,uuid) rename to deletion_scope_before_operational_presets;
create function private.deletion_scope(p_kind text,p_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  scope jsonb := private.deletion_scope_before_operational_presets(p_kind,p_id);
  company_selector text := private.deletion_selector(scope,'public.organisations');
begin
  if company_selector is not null then
    scope := private.deletion_add_scope(scope,'private.training_operational_presets',
      format('x.organisation_id in (select x.id from public.organisations x where %s)',company_selector));
  end if;
  return scope;
end;
$$;
revoke all on function private.deletion_scope_before_operational_presets(text,uuid),
  private.deletion_scope(text,uuid) from public,anon,authenticated,service_role;
create trigger permanent_deletion_fence before insert or update or delete on private.training_operational_presets
  for each row execute function private.guard_permanent_deletion();

notify pgrst,'reload schema';
commit;
