begin;

-- Draft requirements and lecturer-owned preferences remain inaccessible as
-- tables. Management receives only a coarse explanation and never a calendar.
create table private.job_matching_requirements (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  qualification_topics uuid[] not null check (cardinality(qualification_topics) <= 20),
  teaching_languages text[] not null check (cardinality(teaching_languages) <= 12),
  document_evidence_required boolean not null default false
);
create table private.lecturer_matching_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  version integer not null default 1 check (version > 0),
  delivery_formats text[] not null check (cardinality(delivery_formats) <= 3),
  teaching_languages text[] not null check (cardinality(teaching_languages) <= 12),
  teaching_days smallint[] not null check (cardinality(teaching_days) <= 7),
  teaching_start time without time zone,
  teaching_end time without time zone,
  urgent_cover boolean not null,
  check ((teaching_start is null and teaching_end is null) or
         (teaching_start is not null and teaching_end is not null and teaching_start < teaching_end))
);
alter table private.job_matching_requirements enable row level security;
alter table private.lecturer_matching_preferences enable row level security;
revoke all on private.job_matching_requirements, private.lecturer_matching_preferences
  from public, anon, authenticated, service_role;

create function private.matching_language_codes(p_value jsonb) returns text[]
language plpgsql immutable security invoker set search_path = '' as $$
declare codes text[];
begin
  if jsonb_typeof(p_value) is distinct from 'array' then
    raise exception 'Teaching language arrays required' using errcode = '22023';
  end if;
  if jsonb_array_length(p_value) > 12 or exists (
    select 1 from jsonb_array_elements_text(p_value) item(code)
    where code is null or code !~ '^[a-z]{2,3}$'
  ) then
    raise exception 'Invalid teaching language codes' using errcode = '22023';
  end if;
  select array(select distinct code from jsonb_array_elements_text(p_value) item(code) order by code) into codes;
  return codes;
end;
$$;

create function private.own_lecturer_matching_preferences() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.lecturer_actor() or not exists (select 1 from private.installation_identity where edition = 'internal') then
    raise insufficient_privilege;
  end if;
  return coalesce((
    select to_jsonb(prefs) - 'user_id' from private.lecturer_matching_preferences prefs where user_id = auth.uid()
  ), jsonb_build_object('version', 0, 'delivery_formats', '[]'::jsonb, 'teaching_languages', '[]'::jsonb,
    'teaching_days', '[]'::jsonb, 'teaching_start', null, 'teaching_end', null, 'urgent_cover', false));
end;
$$;
create function private.save_lecturer_matching_preferences(p_expected_version integer, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  prior integer;
  languages text[];
  formats text[];
  days smallint[];
  start_time time without time zone;
  end_time time without time zone;
begin
  perform private.own_lecturer_matching_preferences();
  perform 1 from public.profiles where id = actor and active for share;
  if not found then raise insufficient_privilege; end if;
  -- Same lecturer lock as claiming and manual allocation.
  perform pg_advisory_xact_lock(hashtextextended(actor::text, 0));
  perform private.own_lecturer_matching_preferences();
  if jsonb_typeof(p_payload) is distinct from 'object'
    or (p_payload - array['delivery_formats', 'teaching_languages', 'teaching_days', 'teaching_start', 'teaching_end', 'urgent_cover']) <> '{}'::jsonb
    or jsonb_typeof(p_payload->'delivery_formats') is distinct from 'array'
    or jsonb_typeof(p_payload->'teaching_days') is distinct from 'array'
    or jsonb_typeof(p_payload->'urgent_cover') is distinct from 'boolean'
    or coalesce(p_payload->>'teaching_start', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$|^$'
    or coalesce(p_payload->>'teaching_end', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$|^$' then
      raise exception 'Invalid teaching preferences' using errcode = '22023';
  end if;
  if jsonb_array_length(p_payload->'delivery_formats') > 3 or jsonb_array_length(p_payload->'teaching_days') > 7
    or exists (select 1 from jsonb_array_elements_text(p_payload->'delivery_formats') item(format)
      where format is null or format not in ('online', 'onsite', 'hybrid'))
    or exists (select 1 from jsonb_array_elements_text(p_payload->'teaching_days') item(day)
      where day is null or day !~ '^[1-7]$') then
    raise exception 'Invalid teaching format or weekday' using errcode = '22023';
  end if;
  start_time := nullif(p_payload->>'teaching_start', '')::time;
  end_time := nullif(p_payload->>'teaching_end', '')::time;
  if (start_time is null) <> (end_time is null) or start_time >= end_time then
    raise exception 'Teaching hours must define one increasing range' using errcode = '22023';
  end if;
  languages := private.matching_language_codes(p_payload->'teaching_languages');
  formats := array(select distinct format from jsonb_array_elements_text(p_payload->'delivery_formats') item(format)
    order by format);
  days := array(select distinct day::smallint from jsonb_array_elements_text(p_payload->'teaching_days') item(day)
    order by day::smallint);
  select coalesce((select version from private.lecturer_matching_preferences where user_id = actor), 0) into prior;
  if prior is distinct from p_expected_version then
    raise exception 'Teaching preferences have changed' using errcode = '40001';
  end if;
  insert into private.lecturer_matching_preferences(user_id, version, delivery_formats, teaching_languages,
    teaching_days, teaching_start, teaching_end, urgent_cover)
  values (actor, prior + 1, formats, languages, days, start_time, end_time, (p_payload->>'urgent_cover')::boolean)
  on conflict (user_id) do update set version = excluded.version, delivery_formats = excluded.delivery_formats,
    teaching_languages = excluded.teaching_languages, teaching_days = excluded.teaching_days,
    teaching_start = excluded.teaching_start, teaching_end = excluded.teaching_end, urgent_cover = excluded.urgent_cover;
  return private.own_lecturer_matching_preferences();
end;
$$;

create function private.job_matching_requirements(p_job_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare j public.jobs;
begin
  if not private.has_permission('jobs.manage')
     or not exists (select 1 from private.installation_identity where edition = 'internal') then
    raise insufficient_privilege;
  end if;
  select * into j from public.jobs where id = p_job_id;
  if not found then raise insufficient_privilege; end if;
  return jsonb_build_object('version', j.lifecycle_version, 'can_edit', j.status = 'draft',
    'qualification_topics', coalesce((select to_jsonb(qualification_topics)
       from private.job_matching_requirements where job_id = j.id), '[]'::jsonb),
    'teaching_languages', coalesce((select to_jsonb(teaching_languages)
       from private.job_matching_requirements where job_id = j.id), '[]'::jsonb),
    'document_evidence_required', coalesce((select document_evidence_required
       from private.job_matching_requirements where job_id = j.id), false));
end;
$$;
create function private.save_job_matching_requirements(p_job_id uuid, p_expected_version integer, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  j public.jobs;
  qualifications uuid[];
  languages text[];
  evidence_required boolean;
begin
  perform private.job_matching_requirements(p_job_id);
  perform 1 from public.profiles where id = auth.uid() and active for share;
  if not found or not private.has_permission('jobs.manage') then raise insufficient_privilege; end if;
  select * into j from public.jobs where id = p_job_id for update;
  if not found or j.status <> 'draft' then raise insufficient_privilege; end if;
  if j.lifecycle_version is distinct from p_expected_version then
    raise exception 'Assignment requirements have changed' using errcode = '40001';
  end if;
  if jsonb_typeof(p_payload) is distinct from 'object'
     or (p_payload - array['qualification_topics', 'teaching_languages', 'document_evidence_required']) <> '{}'::jsonb
     or jsonb_typeof(p_payload->'qualification_topics') is distinct from 'array'
     or coalesce(jsonb_typeof(p_payload->'document_evidence_required'), 'boolean') <> 'boolean' then
    raise exception 'Invalid assignment requirements' using errcode = '22023';
  end if;
  if jsonb_array_length(p_payload->'qualification_topics') > 20
     or exists (select 1 from jsonb_array_elements_text(p_payload->'qualification_topics') item(topic_id)
     where not coalesce(pg_input_is_valid(topic_id, 'uuid'), false)) then
    raise exception 'Invalid qualification topic' using errcode = '22023';
  end if;
  qualifications := array(select distinct topic_id::uuid
    from jsonb_array_elements_text(p_payload->'qualification_topics') item(topic_id) order by topic_id::uuid);
  if exists (select 1 from unnest(qualifications) required(id)
    where not exists (select 1 from public.topics topic where topic.id = required.id and topic.archived_at is null)) then
    raise exception 'Qualification topic unavailable' using errcode = '22023';
  end if;
  languages := private.matching_language_codes(p_payload->'teaching_languages');
  evidence_required := coalesce((p_payload->>'document_evidence_required')::boolean, false);
  if evidence_required and cardinality(qualifications) = 0 then
    raise exception 'Document evidence requires at least one qualification' using errcode = '22023';
  end if;
  insert into private.job_matching_requirements(job_id, qualification_topics, teaching_languages, document_evidence_required)
  values (p_job_id, qualifications, languages, evidence_required)
  on conflict (job_id) do update set qualification_topics = excluded.qualification_topics,
    teaching_languages = excluded.teaching_languages, document_evidence_required = excluded.document_evidence_required;
  -- Existing lifecycle revision invalidates an earlier publication or allocation review.
  update public.jobs set lifecycle_version = j.lifecycle_version where id = j.id;
  insert into public.audit_events(actor_id, action, resource_id, details)
  values (auth.uid(), 'job.matching_requirements_changed', j.id,
    jsonb_build_object('qualification_topics', to_jsonb(qualifications), 'teaching_languages', to_jsonb(languages),
      'document_evidence_required', evidence_required));
  return private.job_matching_requirements(p_job_id);
end;
$$;

create function private.job_required_profile_matches(p_job uuid, p_lecturer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select (
      cardinality(req.teaching_languages) = 0 or
      req.teaching_languages <@ coalesce(prefs.teaching_languages, '{}'::text[])
    ) and not exists (
      select 1 from unnest(req.qualification_topics) required(topic_id)
      where not exists (
        select 1 from public.lecturer_topics qualification
        where qualification.user_id = p_lecturer and qualification.topic_id = required.topic_id
          and qualification.verified
          and (qualification.valid_until is null or qualification.valid_until >= (
            select max(session.ends_at) from public.job_sessions session where session.job_id = p_job
          ))
          -- Merely binding a newer document does not attest that new version.
          and (not req.document_evidence_required or exists (
            select 1 from private.qualification_states state
            join private.qualification_events attestation
              on attestation.user_id = state.user_id and attestation.topic_id = state.topic_id
              and attestation.version = state.version and attestation.evidence_id = state.evidence_id
              and attestation.action = 'attest' and attestation.verified and attestation.basis = 'document_evidence'
            join private.qualification_evidence evidence on evidence.id = state.evidence_id and evidence.withdrawn_at is null
            join public.document_versions version on version.id = evidence.document_version_id
              and version.status = 'clean' and version.sha256 = evidence.sha256
            join public.documents document on document.id = version.document_id and document.deleted_at is null
              and document.owner_id = p_lecturer and document.kind = 'certificate' and document.scope = 'personal'
            where state.user_id = p_lecturer and state.topic_id = required.topic_id
          ))
      )
    )
    from private.job_matching_requirements req
    left join private.lecturer_matching_preferences prefs on prefs.user_id = p_lecturer
    where req.job_id = p_job
  ), true);
$$;

create or replace function private.job_subject_matches(p_job uuid, p_lecturer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.teaching_subject_matches(
    array(select topic_id from public.job_requirements where job_id = p_job),
    p_lecturer
  ) and private.job_required_profile_matches(p_job, p_lecturer);
$$;

create function private.lock_verified_job_topics(p_job uuid, p_lecturer uuid)
returns void language plpgsql volatile security invoker set search_path = '' as $$
begin
  perform 1 from private.job_matching_requirements req
  join public.lecturer_topics qualification on qualification.user_id = p_lecturer
    and qualification.topic_id = any(req.qualification_topics)
  where req.job_id = p_job
  order by qualification.topic_id
  for share of qualification;

  -- Evidence binding takes the same topic lock. Pin the underlying scan and
  -- document status as well when this job explicitly depends on the proof.
  perform 1 from private.job_matching_requirements req
  join private.qualification_states state on state.user_id = p_lecturer
    and state.topic_id = any(req.qualification_topics)
  join private.qualification_evidence evidence on evidence.id = state.evidence_id
  join public.document_versions version on version.id = evidence.document_version_id
  join public.documents document on document.id = version.document_id
  where req.job_id = p_job and req.document_evidence_required
  order by document.id, version.id
  for share of document, version;
end;
$$;

-- Both acceptance paths have already locked the lecturer and job before
-- evaluating requirements. Lock any attestation rows for the rest of that write.
-- A reopened urgent job still requires explicit verified qualifications.
do $migration$
declare
  definition text;
  anchor text := $old$if j.urgent_reopened_at is null and not private.job_subject_matches(j.id, actor) then$old$;
begin
  definition := pg_get_functiondef('private.claim_job_base(uuid,uuid,integer)'::regprocedure);
  if cardinality(string_to_array(definition, anchor)) <> 2 then raise exception 'Expected qualification claim guard'; end if;
  execute replace(definition, anchor, $new$
  perform private.lock_verified_job_topics(j.id, actor);
  if (j.urgent_reopened_at is not null and not private.job_required_profile_matches(j.id, actor))
     or (j.urgent_reopened_at is null and not private.job_subject_matches(j.id, actor)) then$new$);
  definition := pg_get_functiondef('private.confirm_staff_job_assignment(uuid,uuid,integer,integer,uuid,boolean)'::regprocedure);
  anchor := $old$eligibility=private.assignment_replacement_eligibility(j.id,p_lecturer_id,null);$old$;
  if cardinality(string_to_array(definition, anchor)) <> 2 then raise exception 'Expected qualification assignment guard'; end if;
  execute replace(definition, anchor, 'perform private.lock_verified_job_topics(j.id, p_lecturer_id); ' || anchor);
end
$migration$;

-- Only the ordered explanation flags are exposed to the authorised operator.
-- Compare all sessions in the lecturer's profile time zone, never UTC weekdays.
create function private.lecturer_match_reasons(p_job public.jobs, p_lecturer uuid)
returns text[] language sql stable security invoker set search_path = '' as $$
  select array_remove(array[
    case when exists (select 1 from public.job_requirements requirement
      join public.lecturer_topics selected on selected.topic_id = requirement.topic_id and selected.user_id = p_lecturer
      where requirement.job_id = p_job.id) then 'subject' end,
    case when p_job.delivery_type = any(prefs.delivery_formats) then 'format' end,
    case when cardinality(prefs.teaching_days) > 0
      and not exists (select 1 from public.job_sessions session where session.job_id = p_job.id
        and (not (extract(isodow from session.starts_at at time zone profile.time_zone)::smallint = any(prefs.teaching_days))
          or (session.starts_at at time zone profile.time_zone)::date
            <> ((session.ends_at - interval '1 microsecond') at time zone profile.time_zone)::date))
      then 'weekdays' end,
    case when prefs.teaching_start is not null
      and not exists (select 1 from public.job_sessions session where session.job_id = p_job.id
        and ((session.starts_at at time zone profile.time_zone)::time < prefs.teaching_start
          or (session.ends_at at time zone profile.time_zone)::time > prefs.teaching_end
          or (session.starts_at at time zone profile.time_zone)::date <> (session.ends_at at time zone profile.time_zone)::date))
      then 'hours' end,
    case when prefs.urgent_cover and p_job.urgent_reopened_at is not null then 'urgent' end
  ]::text[], null)
  from public.profiles profile
  left join private.lecturer_matching_preferences prefs on prefs.user_id = profile.id
  where profile.id = p_lecturer;
$$;

create or replace function private.manual_assignment_candidates(p_job_id uuid, p_search text default '')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare j public.jobs;
begin
  if not private.has_permission('jobs.manage') then raise insufficient_privilege; end if;
  if p_search is null or length(p_search) > 200 then
    raise exception 'Invalid lecturer search' using errcode = '22023';
  end if;
  select * into j from public.jobs where id = p_job_id;
  if not found then raise insufficient_privilege; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', candidate.id, 'name', candidate.display_name,
      'eligibility', candidate.status,
      'terms_version', case when exists (select 1 from private.job_commission_offers
        where job_id = j.id and pricing_mode = 'role_split')
        then private.role_quote_version(j.terms_version, candidate.id) else j.terms_version end,
      'quote', case when not j.company_internal and private.has_permission('finance.gross.read') then candidate.quote end,
      'match_reasons', case when candidate.status = 'eligible' then to_jsonb(candidate.reasons) else '[]'::jsonb end)
      order by (candidate.status = 'eligible') desc,
        case when candidate.status = 'eligible' then cardinality(candidate.reasons) else 0 end desc,
        candidate.display_name, candidate.id)
    from (
      select ranked.* from (
        select matched.*, case when j.status <> 'published' then 'unavailable'
          when matched.eligibility <> 'eligible' then matched.eligibility
          when matched.quote is null then 'quote_unavailable' else 'eligible' end as status
        from (
          select profile.id, profile.display_name,
            private.assignment_replacement_eligibility(j.id, profile.id, null) eligibility,
            private.lecturer_job_quote(profile.id, j.id) quote,
            private.lecturer_match_reasons(j, profile.id) reasons
          from public.profiles profile where profile.active and private.lecturer_user(profile.id)
            and strpos(lower(profile.display_name), lower(p_search)) > 0
        ) matched
      ) ranked
      order by (ranked.status = 'eligible') desc,
        case when ranked.status = 'eligible' then cardinality(ranked.reasons) else 0 end desc,
        ranked.display_name, ranked.id
      limit 50
    ) candidate
  ), '[]'::jsonb);
end;
$$;

create function public.own_lecturer_matching_preferences() returns jsonb
language sql stable security invoker set search_path = '' as $$ select private.own_lecturer_matching_preferences(); $$;
create function public.save_lecturer_matching_preferences(p_expected_version integer, p_payload jsonb) returns jsonb
language sql security invoker set search_path = '' as $$
  select private.save_lecturer_matching_preferences(p_expected_version, p_payload);
$$;
create function public.job_matching_requirements(p_job_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$ select private.job_matching_requirements(p_job_id); $$;
create function public.save_job_matching_requirements(p_job_id uuid, p_expected_version integer, p_payload jsonb) returns jsonb
language sql security invoker set search_path = '' as $$
  select private.save_job_matching_requirements(p_job_id, p_expected_version, p_payload);
$$;

revoke all on function private.matching_language_codes(jsonb), private.job_required_profile_matches(uuid, uuid),
  private.lock_verified_job_topics(uuid, uuid), private.lecturer_match_reasons(public.jobs, uuid),
  private.own_lecturer_matching_preferences(), public.own_lecturer_matching_preferences(),
  private.save_lecturer_matching_preferences(integer, jsonb), public.save_lecturer_matching_preferences(integer, jsonb),
  private.job_matching_requirements(uuid), public.job_matching_requirements(uuid),
  private.save_job_matching_requirements(uuid, integer, jsonb), public.save_job_matching_requirements(uuid, integer, jsonb)
from public, anon, authenticated, service_role;
grant execute on function private.own_lecturer_matching_preferences(), public.own_lecturer_matching_preferences(),
  private.save_lecturer_matching_preferences(integer, jsonb), public.save_lecturer_matching_preferences(integer, jsonb),
  private.job_matching_requirements(uuid), public.job_matching_requirements(uuid),
  private.save_job_matching_requirements(uuid, integer, jsonb), public.save_job_matching_requirements(uuid, integer, jsonb)
to authenticated;

commit;
