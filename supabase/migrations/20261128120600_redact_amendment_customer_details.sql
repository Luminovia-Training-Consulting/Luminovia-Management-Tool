-- Apply the same assignment disclosure authorization to change requests.
-- Original and proposed snapshots stay intact for concurrency and consent.
begin;

create or replace function private.assignment_change_visible_snapshot(
  p_snapshot jsonb,p_customer boolean,p_price boolean
) returns jsonb language sql stable set search_path='' as $$
  select case when p_customer then jsonb_build_object(
    'claim_id',p_snapshot->'claim_id','job_id',p_snapshot->'job_id','course_run_id',p_snapshot->'course_run_id',
    'lecturer_id',p_snapshot->'lecturer_id','title',p_snapshot->'title','time_zone',p_snapshot->'time_zone',
    'delivery_type',p_snapshot->'delivery_type','location',p_snapshot->'location','scope',p_snapshot->'scope',
    'sessions',p_snapshot->'sessions','cancel',p_snapshot->'cancel','amount',null,'total_amount',null,
    'currency',null,'rate_unit',null,'terms',null)
  else (p_snapshot-'session_evidence'-'offer_sessions')
    || case when p_price then '{}'::jsonb else jsonb_build_object('amount',null,'total_amount',null) end
    || case when private.can_read_assignment_customer((p_snapshot->>'job_id')::uuid) then '{}'::jsonb
      else jsonb_build_object('location','','location_hidden',true,'readiness',null)
    end
  end
$$;

-- Guard writes using the authoritative original. A stale browser cannot submit
-- a private location change, and changing other fields retains that location.
do $migration$
declare
  definition text;
  normalize_fragment constant text :=
    'source=private.assignment_change_source(p_claim_id);proposal=private.assignment_change_normalize(source,p_payload->''changes'');';
  version_fragment constant text :=
    'if r.version is distinct from p_expected_version then raise exception ''Change request changed; reload'' using errcode=''40001'';end if;';
  projection_fragment constant text :=
    '  ''original'',private.assignment_change_visible_snapshot(r.original,customer,price),';
  hidden_location_change constant text := $predicate$
    r.lecturer_id=auth.uid()
    and private.assignment_change_staff_access(r.claim_id)
    and r.original->'location' is distinct from r.proposed->'location'
    and not private.can_read_assignment_customer((r.original->>'job_id')::uuid)
  $predicate$;
begin
  definition := pg_get_functiondef('private.save_assignment_change(uuid,uuid,jsonb,integer,uuid)'::regprocedure);
  if cardinality(string_to_array(definition,normalize_fragment))<>2 then
    raise exception 'Unexpected assignment change normalization';
  end if;
  execute replace(definition,normalize_fragment,$code$
    source=private.assignment_change_source(p_claim_id);
    if not customer and (p_payload->'changes')?'location'
      and not private.can_read_assignment_customer((source->>'job_id')::uuid) then
      raise exception 'Assignment location unavailable' using errcode='42501';
    end if;
    proposal=private.assignment_change_normalize(source,p_payload->'changes');
  $code$);

  definition := pg_get_functiondef('private.assignment_change_action(uuid,text,integer,text,uuid)'::regprocedure);
  if cardinality(string_to_array(definition,version_fragment))<>2 then
    raise exception 'Unexpected assignment change version check';
  end if;
  execute replace(definition,version_fragment,version_fragment || $code$
    if p_action='accept' and ($code$ || hidden_location_change || $code$) then
      raise exception 'Assignment location unavailable for consent' using errcode='42501';
    end if;
  $code$);

  definition := pg_get_functiondef('private.assignment_change_projection(uuid)'::regprocedure);
  if cardinality(string_to_array(definition,projection_fragment))<>2 then
    raise exception 'Unexpected assignment change projection';
  end if;
  execute replace(definition,projection_fragment,
    '  ''awaits_location_disclosure'',(' || hidden_location_change || '),' || projection_fragment);
end;
$migration$;

commit;
