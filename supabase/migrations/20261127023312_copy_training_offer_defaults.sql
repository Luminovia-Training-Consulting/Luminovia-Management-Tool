-- Configure an optional new offer draft during the reviewed course copy.
-- Preserve the original migration and add this implementation only after its
-- venue, compensation and matching authorities are installed.
begin;
do $migration$
declare
  definition text := pg_catalog.pg_get_functiondef('private.copy_training_course(uuid,text,jsonb,text,uuid)'::regprocedure);
begin
  if cardinality(string_to_array(definition,$old$  source public.course_runs%rowtype;
  template public.course_templates%rowtype;
  source_delivery private.training_course_delivery%rowtype;
  prior private.training_course_copy_requests%rowtype;
  command jsonb;
  plan jsonb;$old$)) <> 2 then
    raise exception 'Unexpected reviewed copy offer upgrade point 1';
  end if;
  definition := replace(definition,$old$  source public.course_runs%rowtype;
  template public.course_templates%rowtype;
  source_delivery private.training_course_delivery%rowtype;
  prior private.training_course_copy_requests%rowtype;
  command jsonb;
  plan jsonb;$old$,
    $new$  source public.course_runs%rowtype;
  template public.course_templates%rowtype;
  source_delivery private.training_course_delivery%rowtype;
  selected_offer jsonb;
  selected_requirements jsonb;
  copied_components jsonb;
  destination_offer uuid;
  destination_version integer;
  offer_source_revision text;
  selected_offer_id uuid;
  prior private.training_course_copy_requests%rowtype;
  command jsonb;
  plan jsonb;$new$);
  if cardinality(string_to_array(definition,$old$    or (select edition from private.installation_identity where singleton) <> 'internal' then
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
  end if;$old$)) <> 2 then
    raise exception 'Unexpected reviewed copy offer upgrade point 2';
  end if;
  definition := replace(definition,$old$    or (select edition from private.installation_identity where singleton) <> 'internal' then
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
  end if;$old$,
    $new$    or (select edition from private.installation_identity where singleton) <> 'internal' then
    raise insufficient_privilege;
  end if;
  if p_action = 'options' then
    if not private.has_permission('jobs.manage') or not private.has_permission('finance.gross.read') then
      return '[]'::jsonb;
    end if;
    return (select coalesce(jsonb_agg(jsonb_build_object('id',job.id,'title',job.title,'currency',price.currency)
      order by job.created_at desc,job.id),'[]'::jsonb)
      from public.course_runs run
      join public.organisations customer on customer.id = run.organisation_id and customer.archived_at is null
      join public.jobs job on job.course_run_id = run.id and not job.company_internal
      join private.job_commission_offers price on price.job_id = job.id
        and price.organisation_id = customer.id and price.pricing_mode = 'role_split'
      where run.id = p_source_run_id);
  end if;
  if coalesce(p_action,'') not in ('preview','save') or jsonb_typeof(p_options) is distinct from 'object'
    or p_options - array['template','title','schedule','first_day','delivery','venue','preparation','contact','materials','offer_id','offer_requirements'] <> '{}'::jsonb
    or coalesce(p_options->>'template','') not in ('reuse','copy','blank')
    or coalesce(p_options->>'schedule','') not in ('same','shift','none')
    or exists(select 1 from unnest(array['delivery','venue','preparation','contact','materials']) field
      where jsonb_typeof(p_options->field) is distinct from 'boolean')
    or coalesce(jsonb_typeof(p_options->'offer_requirements'),'boolean') <> 'boolean'
    or coalesce(jsonb_typeof(p_options->'offer_id'),'null') not in ('null','string')
    or (p_action = 'save' and (p_request_id is null or coalesce(p_expected_revision,'') !~ '^[a-f0-9]{64}$')) then
    raise invalid_parameter_value;
  end if;$new$);
  if cardinality(string_to_array(definition,$old$  copy_preparation := (p_options->>'preparation')::boolean;
  copy_contacts := (p_options->>'contact')::boolean;
  copy_materials := (p_options->>'materials')::boolean;
  if (template_mode <> 'reuse' and length(new_title) not between 1 and 200)
    or (copy_venue and not copy_delivery) then raise invalid_parameter_value; end if;
  if schedule_mode = 'shift' then$old$)) <> 2 then
    raise exception 'Unexpected reviewed copy offer upgrade point 3';
  end if;
  definition := replace(definition,$old$  copy_preparation := (p_options->>'preparation')::boolean;
  copy_contacts := (p_options->>'contact')::boolean;
  copy_materials := (p_options->>'materials')::boolean;
  if (template_mode <> 'reuse' and length(new_title) not between 1 and 200)
    or (copy_venue and not copy_delivery) then raise invalid_parameter_value; end if;
  if schedule_mode = 'shift' then$old$,
    $new$  copy_preparation := (p_options->>'preparation')::boolean;
  copy_contacts := (p_options->>'contact')::boolean;
  copy_materials := (p_options->>'materials')::boolean;
  selected_offer_id := (p_options->>'offer_id')::uuid;
  if selected_offer_id is not null and (not private.has_permission('jobs.manage')
    or not private.has_permission('finance.gross.read')) then raise insufficient_privilege; end if;
  if (template_mode <> 'reuse' and length(new_title) not between 1 and 200)
    or (copy_venue and not copy_delivery) then raise invalid_parameter_value; end if;
  if schedule_mode = 'shift' then$new$);
  if cardinality(string_to_array(definition,$old$
  command := jsonb_build_object('source',p_source_run_id,'options',p_options,'revision',p_expected_revision);
  if p_action = 'save' then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('training-copy:'||auth.uid()::text,0));
    select * into prior from private.training_course_copy_requests
      where actor_id = auth.uid() and request_id = p_request_id;$old$)) <> 2 then
    raise exception 'Unexpected reviewed copy offer upgrade point 4';
  end if;
  definition := replace(definition,$old$
  command := jsonb_build_object('source',p_source_run_id,'options',p_options,'revision',p_expected_revision);
  if p_action = 'save' then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('training-copy:'||auth.uid()::text,0));
    select * into prior from private.training_course_copy_requests
      where actor_id = auth.uid() and request_id = p_request_id;$old$,
    $new$
  command := jsonb_build_object('source',p_source_run_id,'options',p_options,'revision',p_expected_revision);
  if p_action = 'save' then
    -- Offer creation locks the actor before course rows. Keep that ordering
    -- even when the operation also reads and locks its original course.
    if selected_offer_id is not null then
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('client-request:'||auth.uid()::text,0));
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('training-copy:'||auth.uid()::text,0));
    select * into prior from private.training_course_copy_requests
      where actor_id = auth.uid() and request_id = p_request_id;$new$);
  if cardinality(string_to_array(definition,$old$      ));
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
  if p_action = 'preview' then return result; end if;$old$)) <> 2 then
    raise exception 'Unexpected reviewed copy offer upgrade point 5';
  end if;
  definition := replace(definition,$old$      ));
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
  if p_action = 'preview' then return result; end if;$old$,
    $new$      ));
    end loop;
  end if;
  if selected_offer_id is not null then
    if jsonb_array_length(planned_slots) = 0 or exists (
      select 1 from jsonb_array_elements(planned_slots) planned
      where (planned->>'starts_at')::timestamptz <= clock_timestamp()
    ) then
      raise exception 'Copied teaching offers require a future course schedule' using errcode = '22023';
    end if;
    select jsonb_build_object('title',job.title,'gross_amount',price.gross_amount,
      'gross_total_amount',price.gross_total_amount,'currency',price.currency,'rate_unit',job.rate_unit,
      'platform_percent',price.platform_percent_override,'capacity',job.capacity,
      'requires_contract',job.requires_contract,'components',price.training_components->'configuration')
      into selected_offer
    from public.jobs job join private.job_commission_offers price on price.job_id = job.id
    where job.id = selected_offer_id and job.course_run_id = source.id and not job.company_internal
      and price.organisation_id = source.organisation_id and price.pricing_mode = 'role_split';
    if selected_offer is null then raise insufficient_privilege; end if;
    if coalesce((p_options->>'offer_requirements')::boolean,false) then
      select to_jsonb(req) - 'job_id' into selected_requirements
      from private.job_matching_requirements req where req.job_id = selected_offer_id;
    end if;
  end if;
  plan := jsonb_build_object(
    'source_run_id',source.id,'organisation_id',source.organisation_id,'time_zone',source.time_zone,
    'title',case when template_mode = 'reuse' then template.title else new_title end,
    'sessions',planned_slots,'structured_delivery',defaults is not null,
    'preparation_count',jsonb_array_length(task_labels),'material_count',cardinality(resource_ids),
    'contact',target_contact is not null,
    'offer',case when selected_offer is not null then jsonb_build_object('title',selected_offer->'title',
      'currency',selected_offer->'currency','base_total',selected_offer->'gross_total_amount',
      'requirements',selected_requirements is not null) end
  );
  revision := encode(extensions.digest(convert_to(jsonb_build_object(
    'plan',plan,'options',p_options,'template',to_jsonb(template),
    'task_labels',task_labels,'resources',resource_ids,'contact',target_contact,'defaults',defaults,
    'offer',selected_offer,'offer_requirements',selected_requirements
  )::text,'UTF8'),'sha256'),'hex');
  result := plan || jsonb_build_object('revision',revision);
  if p_action = 'preview' then return result; end if;$new$);
  if cardinality(string_to_array(definition,$old$  foreach material_id in array resource_ids loop
    perform private.reuse_course_material(material_id,target_run,true);
  end loop;

  insert into private.training_course_copy_requests(actor_id,request_id,target_run_id,command)
    values(auth.uid(),p_request_id,target_run,command);$old$)) <> 2 then
    raise exception 'Unexpected reviewed copy offer upgrade point 6';
  end if;
  definition := replace(definition,$old$  foreach material_id in array resource_ids loop
    perform private.reuse_course_material(material_id,target_run,true);
  end loop;

  insert into private.training_course_copy_requests(actor_id,request_id,target_run_id,command)
    values(auth.uid(),p_request_id,target_run,command);$old$,
    $new$  foreach material_id in array resource_ids loop
    perform private.reuse_course_material(material_id,target_run,true);
  end loop;

  if selected_offer is not null then
    -- The existing authoritative offer creator establishes a fresh draft and
    -- keeps the original negotiated terms, claims and publication state out.
    offer_source_revision := private.course_run_job_defaults(target_run)->>'source_revision';
    destination_offer := private.create_course_run_job(target_run,jsonb_build_object(
      'source_revision',offer_source_revision,'gross_amount',selected_offer->'gross_amount',
      'gross_total_amount',selected_offer->'gross_total_amount','currency',selected_offer->'currency',
      'rate_unit',selected_offer->'rate_unit','capacity',selected_offer->'capacity',
      'requires_contract',selected_offer->'requires_contract','status','draft','terms',''
    ),(selected_offer->>'platform_percent')::numeric,gen_random_uuid());
    if selected_requirements is not null then
      select lifecycle_version into destination_version from public.jobs where id = destination_offer;
      perform private.save_job_matching_requirements(destination_offer,destination_version,selected_requirements);
    end if;
    copied_components := selected_offer->'components';
    if jsonb_typeof(copied_components) = 'object' then
      -- General compensation applies again. Source job session IDs and
      -- schedule-specific rate/break overrides belong to the original.
      copied_components := copied_components || jsonb_build_object('components',
        (select coalesce(jsonb_agg(line.value - 'session_rates' order by line.ordinality),'[]'::jsonb)
         from jsonb_array_elements(copied_components->'components') with ordinality line(value,ordinality)));
      select terms_version into destination_version from public.jobs where id = destination_offer;
      perform private.training_offer_compensation(destination_offer,'save',destination_version,
        jsonb_build_object('configuration',copied_components,'unpaid_breaks','{}'::jsonb));
    end if;
  end if;

  insert into private.training_course_copy_requests(actor_id,request_id,target_run_id,command)
    values(auth.uid(),p_request_id,target_run,command);$new$);
  execute definition;
end
$migration$;
notify pgrst, 'reload schema';
commit;
