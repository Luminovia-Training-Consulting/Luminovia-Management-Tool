-- Preview selected reusable facts and commit the exact reviewed copy as a
-- fresh unpublished course. The existing offer duplication path stays intact.
begin;

create table private.training_course_copy_requests (
  actor_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid not null,
  target_run_id uuid not null references public.course_runs(id) on delete cascade,
  command jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(actor_id,request_id)
);
create index training_course_copy_requests_target
  on private.training_course_copy_requests(target_run_id);
alter table private.training_course_copy_requests enable row level security;
revoke all on private.training_course_copy_requests from public,anon,authenticated,service_role;

-- Copy receipts have explicit ownership under both course and account cleanup.
do $migration$
declare
  definition text := pg_catalog.pg_get_functiondef('private.deletion_scope(text,uuid)'::regprocedure);
  anchor text := $anchor$  if p_kind <> 'job' then
    return scope;
  end if;$anchor$;
begin
  if strpos(definition, anchor) = 0 then
    raise exception 'Expected the owned-job deletion scope';
  end if;
  execute replace(definition, anchor, $replacement$
  if p_kind = 'course_run' then
    scope := private.deletion_add_scope(scope, 'private.training_course_copy_requests',
      format('x.target_run_id=%L::uuid', p_id));
  elsif p_kind = 'account' then
    scope := private.deletion_add_scope(scope, 'private.training_course_copy_requests',
      format('x.actor_id=%L::uuid', p_id));
  end if;
$replacement$ || anchor);
end
$migration$;

-- Copy venue facts only from an active same-customer directory entry. The
-- meeting platform is safe to reuse; URLs, IDs, secrets and instructions are
-- entered afresh. Legacy free-text locations may contain joining credentials.
create function private.training_copy_delivery(p_config jsonb,p_organisation_id uuid,p_copy_venue boolean)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select case when p_config is null then null else
    coalesce((select jsonb_object_agg(key,value) from jsonb_each(p_config)
      where key in ('mode','meeting_platform')),'{}'::jsonb)
    || case when p_copy_venue and p_config ? 'venue_id' then
      coalesce((select jsonb_build_object('venue_id',venue.id,'venue',
        coalesce((select jsonb_object_agg(key,value) from jsonb_each(venue.details)
          where key in ('name','street','house_number','address_line','city','region','postal_code',
                        'country','room','building','floor','time_zone')),
                  '{}'::jsonb))
        from private.training_venues venue where venue.id::text = p_config->>'venue_id'
          and venue.organisation_id = p_organisation_id and venue.archived_at is null),
        '{"venue_id":null,"venue":null}'::jsonb)
      else '{}'::jsonb end
  end
$$;

-- PostgreSQL chooses an offset on ambiguous input. Reject both ambiguous and
-- missing local times when moving a date, including non-hour IANA transitions.
create function private.training_copy_session_instant(p_local timestamp,p_zone text)
returns timestamptz language plpgsql stable security invoker set search_path = '' as $$
declare
  candidate timestamptz := p_local at time zone p_zone;
  observed timestamptz;
  candidate_offset interval := p_local - (candidate at time zone 'UTC');
  alternate timestamptz;
begin
  if candidate at time zone p_zone <> p_local then
    raise exception 'Shifted course session is missing or ambiguous in its time zone' using errcode = '22023';
  end if;
  foreach observed in array array[candidate - interval '36 hours',candidate + interval '36 hours'] loop
    alternate := candidate + candidate_offset - ((observed at time zone p_zone) - (observed at time zone 'UTC'));
    if alternate <> candidate and alternate at time zone p_zone = p_local then
      raise exception 'Shifted course session is missing or ambiguous in its time zone' using errcode = '22023';
    end if;
  end loop;
  return candidate;
end;
$$;

create function private.copy_training_course(
  p_source_run_id uuid,p_action text,p_options jsonb,
  p_expected_revision text,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  source public.course_runs%rowtype;
  template public.course_templates%rowtype;
  source_delivery private.training_course_delivery%rowtype;
  prior private.training_course_copy_requests%rowtype;
  command jsonb;
  plan jsonb;
  result jsonb;
  revision text;
  template_mode text;
  schedule_mode text;
  copy_delivery boolean;
  copy_venue boolean;
  copy_preparation boolean;
  copy_contacts boolean;
  copy_materials boolean;
  new_first_day date;
  shift_days integer := 0;
  original_first_day date;
  planned_slots jsonb := '[]'::jsonb;
  task_labels jsonb := '[]'::jsonb;
  resource_ids uuid[] := array[]::uuid[];
  material_id uuid;
  target_run uuid;
  target_template uuid;
  target_contact uuid;
  target_session uuid;
  new_title text;
  slot record;
  start_time timestamptz;
  end_time timestamptz;
  defaults jsonb;
  override jsonb;
begin
  if not private.actor_active() or not private.has_permission('courses.manage')
    or (select edition from private.installation_identity where singleton) <> 'internal' then
    raise insufficient_privilege;
  end if;
  if coalesce(p_action,'') not in ('preview','save') or jsonb_typeof(p_options) is distinct from 'object'
    or p_options - array['template','title','schedule','first_day','delivery','venue','preparation','contact','materials'] <> '{}'::jsonb
    or coalesce(p_options->>'template','') not in ('reuse','copy','blank')
    or coalesce(p_options->>'schedule','') not in ('same','shift','none')
    or exists(select 1 from unnest(array['delivery','venue','preparation','contact','materials']) field
      where jsonb_typeof(p_options->field) is distinct from 'boolean')
    or (p_action = 'save' and (p_request_id is null or coalesce(p_expected_revision,'') !~ '^[a-f0-9]{64}$')) then
    raise invalid_parameter_value;
  end if;
  template_mode := p_options->>'template';
  new_title := btrim(coalesce(p_options->>'title',''));
  schedule_mode := p_options->>'schedule';
  copy_delivery := (p_options->>'delivery')::boolean;
  copy_venue := (p_options->>'venue')::boolean;
  copy_preparation := (p_options->>'preparation')::boolean;
  copy_contacts := (p_options->>'contact')::boolean;
  copy_materials := (p_options->>'materials')::boolean;
  if (template_mode <> 'reuse' and length(new_title) not between 1 and 200)
    or (copy_venue and not copy_delivery) then raise invalid_parameter_value; end if;
  if schedule_mode = 'shift' then
    if coalesce(p_options->>'first_day','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise invalid_parameter_value;
    end if;
    new_first_day := (p_options->>'first_day')::date;
  end if;

  command := jsonb_build_object('source',p_source_run_id,'options',p_options,'revision',p_expected_revision);
  if p_action = 'save' then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('training-copy:'||auth.uid()::text,0));
    select * into prior from private.training_course_copy_requests
      where actor_id = auth.uid() and request_id = p_request_id;
    if found then
      if prior.command is distinct from command then
        raise exception 'Course copy request differs from its committed values' using errcode = 'PT409';
      end if;
      return jsonb_build_object('course_run_id',prior.target_run_id);
    end if;
    select * into source from public.course_runs where id = p_source_run_id for share;
    if source.id is not null then perform private.lock_training_delivery(source.id); end if;
  else
    select * into source from public.course_runs where id = p_source_run_id;
  end if;
  if source.id is null or (source.organisation_id is not null and not exists(
    select 1 from public.organisations customer where customer.id = source.organisation_id and customer.archived_at is null
  )) then raise insufficient_privilege; end if;
  select * into strict template from public.course_templates where id = source.template_id for share;
  if (template.owner_organisation_id is not null
      and template.owner_organisation_id is distinct from source.organisation_id)
    or (template_mode = 'reuse' and template.archived_at is not null) then
    raise exception 'Choose a new template for this course copy' using errcode = '22023';
  end if;
  if copy_delivery then
    select * into source_delivery from private.training_course_delivery where course_run_id = source.id;
    defaults := private.training_copy_delivery(source_delivery.defaults,source.organisation_id,copy_venue);
  end if;
  if copy_contacts then
    select contact.id into target_contact from private.course_workspace_settings setting
    join public.organisation_contacts contact on contact.id = setting.contact_id
    where setting.run_id = source.id and contact.organisation_id = source.organisation_id and contact.archived_at is null;
  end if;
  if copy_preparation then
    select coalesce(jsonb_agg(jsonb_build_object('label',item.label,'client_visible',item.client_visible)
      order by item.id),'[]'::jsonb) into task_labels from private.course_preparation_items item where item.run_id = source.id;
  end if;
  if copy_materials and source.organisation_id is not null then
    select coalesce(array_agg(reuse.resource_id order by reuse.resource_id),array[]::uuid[]) into resource_ids
    from (
      select material.id as resource_id from private.course_resources material
      where material.run_id = source.id and material.removed_at is null and material.category = 'material'
        and (private.course_material_reuse_source(material.id)).id is not null
      order by material.id limit 51
    ) reuse;
    if cardinality(resource_ids) > 50 then
      raise exception 'Use the reusable material library for courses with over 50 eligible resources' using errcode = '22023';
    end if;
  end if;

  if schedule_mode <> 'none' then
    select (min(s.starts_at) at time zone source.time_zone)::date into original_first_day
      from public.course_sessions s where s.course_run_id = source.id;
    if schedule_mode = 'shift' then
      if original_first_day is null or new_first_day < (clock_timestamp() at time zone source.time_zone)::date then
        raise exception 'Choose a current or future first teaching date' using errcode = '22023';
      end if;
      shift_days := new_first_day - original_first_day;
    end if;
    for slot in
      select s.id,s.starts_at,s.ends_at,
        case when source_delivery.overrides_enabled then d.config end as delivery_override
      from public.course_sessions s left join private.training_session_delivery d on d.course_session_id = s.id
      where s.course_run_id = source.id order by s.starts_at,s.id
    loop
      if jsonb_array_length(planned_slots) = 60 then raise invalid_parameter_value; end if;
      start_time := slot.starts_at;
      end_time := slot.ends_at;
      if shift_days <> 0 then
        start_time := private.training_copy_session_instant((slot.starts_at at time zone source.time_zone) + make_interval(days => shift_days),source.time_zone);
        end_time := private.training_copy_session_instant((slot.ends_at at time zone source.time_zone) + make_interval(days => shift_days),source.time_zone);
      end if;
      if end_time <= start_time or exists(select 1 from jsonb_array_elements(planned_slots) old_slot
        where tstzrange((old_slot->>'starts_at')::timestamptz,(old_slot->>'ends_at')::timestamptz,'[)')
          && tstzrange(start_time,end_time,'[)')) then
        raise exception 'The copied schedule would contain overlapping or invalid sessions' using errcode = '22023';
      end if;
      override := case when copy_delivery then private.training_copy_delivery(slot.delivery_override,source.organisation_id,copy_venue) end;
      planned_slots := planned_slots || jsonb_build_array(jsonb_build_object(
        'starts_at',start_time,'ends_at',end_time,'override',override
      ));
    end loop;
  end if;
  plan := jsonb_build_object(
    'source_run_id',source.id,'organisation_id',source.organisation_id,'time_zone',source.time_zone,
    'title',case when template_mode = 'reuse' then template.title else new_title end,
    'sessions',planned_slots,'structured_delivery',defaults is not null,
    'preparation_count',jsonb_array_length(task_labels),'material_count',cardinality(resource_ids),
    'contact',target_contact is not null
  );
  revision := encode(extensions.digest(convert_to(jsonb_build_object(
    'plan',plan,'options',p_options,'template',to_jsonb(template),
    'task_labels',task_labels,'resources',resource_ids,'contact',target_contact,'defaults',defaults
  )::text,'UTF8'),'sha256'),'hex');
  result := plan || jsonb_build_object('revision',revision);
  if p_action = 'preview' then return result; end if;
  if p_expected_revision is distinct from revision then
    raise exception 'Course copy source changed; review the new preview' using errcode = 'PT409';
  end if;

  target_template := template.id;
  if template_mode = 'copy' then
    target_template := private.duplicate_course_template(template.id,new_title);
  elsif template_mode = 'blank' then
    insert into public.course_templates(title,owner_organisation_id) values(new_title,source.organisation_id) returning id into target_template;
  end if;
  insert into public.course_runs(template_id,organisation_id,time_zone,delivery_type,published,venue)
  values(target_template,source.organisation_id,source.time_zone,
    case when copy_delivery then source.delivery_type else 'online' end,false,'')
  returning id into target_run;
  if defaults is not null then
    insert into private.training_course_delivery(course_run_id,defaults,overrides_enabled)
    values(target_run,defaults,source_delivery.overrides_enabled and schedule_mode <> 'none');
  end if;
  for slot in select value from jsonb_array_elements(planned_slots) loop
    insert into public.course_sessions(course_run_id,starts_at,ends_at)
    values(target_run,(slot.value->>'starts_at')::timestamptz,(slot.value->>'ends_at')::timestamptz)
    returning id into target_session;
    if defaults is not null and jsonb_typeof(slot.value->'override') = 'object' and slot.value->'override' <> '{}'::jsonb then
      insert into private.training_session_delivery(course_session_id,config) values(target_session,slot.value->'override');
    end if;
  end loop;
  if target_contact is not null then
    insert into private.course_workspace_settings(run_id,contact_id,version) values(target_run,target_contact,1);
  end if;
  insert into private.course_preparation_items(run_id,label,client_visible,updated_by)
    select target_run,label,client_visible,auth.uid() from jsonb_to_recordset(task_labels) task(label text,client_visible boolean);
  foreach material_id in array resource_ids loop
    perform private.reuse_course_material(material_id,target_run,true);
  end loop;

  insert into private.training_course_copy_requests(actor_id,request_id,target_run_id,command)
    values(auth.uid(),p_request_id,target_run,command);
  insert into public.audit_events(actor_id,action,resource_id,details)
    values(auth.uid(),'course.run.duplicated',target_run,jsonb_build_object('source',source.id));
  return jsonb_build_object('course_run_id',target_run);
end;
$$;

create function public.copy_training_course(
  p_source_run_id uuid,p_action text,p_options jsonb,
  p_expected_revision text default null,p_request_id uuid default null
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.copy_training_course(p_source_run_id,p_action,p_options,p_expected_revision,p_request_id)
$$;
revoke all on function private.training_copy_delivery(jsonb,uuid,boolean),
  private.training_copy_session_instant(timestamp,text),
  private.copy_training_course(uuid,text,jsonb,text,uuid),public.copy_training_course(uuid,text,jsonb,text,uuid)
  from public,anon,authenticated,service_role;
grant execute on function private.copy_training_course(uuid,text,jsonb,text,uuid),
  public.copy_training_course(uuid,text,jsonb,text,uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
