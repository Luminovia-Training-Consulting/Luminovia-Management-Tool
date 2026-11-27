begin;

-- Keep the source agreement and job schedule. The new assignment is an explicit
-- fixed-fee cover order tied to the same course and just the selected sessions.
create table private.partial_teaching_replacements (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles(id),
  request_id uuid not null,
  source_claim_id uuid not null references public.job_claims(id),
  replacement_claim_id uuid not null unique references public.job_claims(id),
  source_session_ids uuid[] not null check (cardinality(source_session_ids) between 1 and 59),
  command jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  unique(actor_id, request_id)
);
create index partial_replacements_source_claim on private.partial_teaching_replacements(source_claim_id, created_at);
alter table private.partial_teaching_replacements enable row level security;
revoke all on private.partial_teaching_replacements from public, anon, authenticated, service_role;

create function private.can_replace_part_of_assignment(p_claim public.job_claims)
returns boolean language sql stable set search_path = '' as $$
  select p_claim.status = 'confirmed'
    and exists (select 1 from public.jobs j where j.id = p_claim.job_id
      and j.status in ('published','filled') and not j.company_internal)
    and not exists (select 1 from public.invoice_items i where i.claim_id = p_claim.id)
    and not private.assignment_change_customer_invoiced(p_claim.id)
    and not private.invoice_series_reserved(p_claim.id)
    and not exists (select 1 from private.invoice_exception_approvals approval
      where approval.claim_id = p_claim.id and approval.revoked_at is null)
    and (select count(*) from public.assignment_sessions s where s.claim_id = p_claim.id and s.released_at is null) >= 2
$$;

create function private.partial_replacement_options(p_claim_id uuid, p_search text default '')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  source public.job_claims;
  slots jsonb;
  candidates jsonb;
begin
  if not private.actor_active() or not private.has_permission('jobs.manage') or not private.has_permission('finance.manage')
    or (select edition from private.installation_identity) <> 'internal' then raise insufficient_privilege; end if;
  if p_search is null or char_length(p_search) > 200 then raise invalid_parameter_value; end if;
  select * into source from public.job_claims where id = p_claim_id;
  if not found or not private.can_replace_part_of_assignment(source) then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'starts_at', s.starts_at, 'ends_at', s.ends_at)
    order by s.starts_at, s.id), '[]'::jsonb) into slots
  from public.assignment_sessions s where s.claim_id = source.id and s.released_at is null and s.starts_at > now()
    and not exists (select 1 from private.teaching_timesheets time where time.session_id = s.id)
    and not exists (select 1 from private.delivery_records evidence where evidence.session_id = s.id and evidence.latest_submission_id is not null);
  if jsonb_array_length(slots) = 0 then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', who.id, 'name', who.display_name) order by who.display_name, who.id), '[]'::jsonb)
    into candidates
  from (select profile.id, profile.display_name from public.profiles profile
    where profile.active and private.lecturer_user(profile.id) and profile.id <> source.lecturer_id
      and not private.job_lecturer_blocked(source.job_id, profile.id)
      and not private.company_rejected_lecturer(source.job_id, profile.id)
      and strpos(lower(profile.display_name), lower(p_search)) > 0
    order by profile.display_name, profile.id limit 50) who;
  return jsonb_build_object('sessions', slots, 'candidates', candidates, 'currency', source.currency);
end;
$$;

create function private.replace_teaching_sessions(
  p_claim_id uuid, p_expected_job_version integer, p_session_ids uuid[], p_lecturer_id uuid,
  p_total text, p_terms text, p_reason text, p_request_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  who uuid := auth.uid();
  source public.job_claims;
  offer public.jobs;
  replacement_job uuid := gen_random_uuid();
  replacement_claim uuid;
  replacement_terms_version integer;
  replacement_job_version integer;
  existing private.partial_teaching_replacements;
  result jsonb;
  canonical_ids uuid[];
  fee numeric;
  reviewed_terms text := btrim(coalesce(p_terms,''));
  reason text := btrim(coalesce(p_reason,''));
  command jsonb;
  record_id uuid;
  lock_id uuid;
  selected_count integer;
  slot_time timestamptz;
begin
  if not private.actor_active() or not private.has_permission('jobs.manage') or not private.has_permission('finance.manage')
    or (select edition from private.installation_identity) <> 'internal' then raise insufficient_privilege; end if;
  if p_claim_id is null or p_expected_job_version is null or p_expected_job_version < 1 or p_lecturer_id is null
    or p_request_id is null or p_session_ids is null or cardinality(p_session_ids) not between 1 and 59
    or array_position(p_session_ids, null) is not null or coalesce(p_total,'') !~ '^[0-9]{1,10}(\.[0-9]{1,2})?$'
    or char_length(reviewed_terms) not between 1 and 8000 or char_length(reason) not between 5 and 1000 then
    raise invalid_parameter_value;
  end if;
  fee := p_total::numeric(12,2);
  select array_agg(distinct slot order by slot) into canonical_ids from unnest(p_session_ids) slot;
  if fee <= 0 or cardinality(canonical_ids) <> cardinality(p_session_ids) then raise invalid_parameter_value; end if;
  command := jsonb_build_object('source', p_claim_id, 'version', p_expected_job_version, 'sessions', canonical_ids,
    'target', p_lecturer_id, 'total', fee, 'terms', reviewed_terms, 'reason', reason);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('partial-teaching:' || who || ':' || p_request_id, 0));
  select * into existing from private.partial_teaching_replacements where actor_id = who and request_id = p_request_id;
  if found then
    if existing.command <> command then raise exception 'Cover request changed' using errcode = 'PT409'; end if;
    return (select jsonb_build_object('status', 'confirmed', 'claim_id', c.id, 'job_id', c.job_id, 'replacement_id', existing.id)
      from public.job_claims c where c.id = existing.replacement_claim_id);
  end if;
  select * into source from public.job_claims where id = p_claim_id;
  if not found or p_lecturer_id = source.lecturer_id then raise invalid_parameter_value; end if;
  perform 1 from public.profiles where id = any(array[who, source.lecturer_id, p_lecturer_id]) order by id for share;
  for lock_id in select id from unnest(array[source.lecturer_id,p_lecturer_id]) member(id) order by id loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(lock_id::text, 0));
  end loop;
  select * into strict offer from public.jobs where id = source.job_id for update;
  select * into strict source from public.job_claims where id = p_claim_id for update;
  if not private.has_permission('jobs.manage') or not private.has_permission('finance.manage') then raise insufficient_privilege; end if;
  if offer.lifecycle_version <> p_expected_job_version then return jsonb_build_object('status','terms_changed'); end if;
  if not private.can_replace_part_of_assignment(source) then return jsonb_build_object('status','unavailable'); end if;
  if not private.lecturer_user(p_lecturer_id) or private.job_lecturer_blocked(offer.id,p_lecturer_id)
    or private.company_rejected_lecturer(offer.id,p_lecturer_id) then
    return jsonb_build_object('status','not_eligible');
  end if;

  if offer.course_run_id is not null then
    perform 1 from public.course_runs where id = offer.course_run_id and archived_at is null for no key update;
    if not found then return jsonb_build_object('status','unavailable'); end if;
  end if;
  perform 1 from public.assignment_sessions s where s.claim_id = source.id order by s.id for update;
  slot_time := clock_timestamp();
  select count(*) into selected_count from public.assignment_sessions s
  where s.id = any(canonical_ids) and s.claim_id = source.id and s.released_at is null and s.starts_at > slot_time
    and not exists (select 1 from private.teaching_timesheets time where time.session_id = s.id)
    and not exists (select 1 from private.delivery_records evidence where evidence.session_id = s.id and evidence.latest_submission_id is not null);
  if selected_count <> cardinality(canonical_ids) or not exists (
    select 1 from public.assignment_sessions s where s.claim_id = source.id and s.released_at is null and not (s.id = any(canonical_ids))
  ) then return jsonb_build_object('status','unavailable'); end if;

  begin
    insert into public.jobs(id,course_run_id,title,description,customer_name,delivery_type,location,time_zone,
      status,capacity,amount,currency,rate_unit,total_amount,terms,requires_contract,created_by)
    values (replacement_job,offer.course_run_id,offer.title,offer.description,
      offer.customer_name,offer.delivery_type,offer.location,offer.time_zone,
      'published',1,fee,source.currency,'fixed_total',fee,reviewed_terms,offer.requires_contract,who);
    insert into public.job_sessions(job_id,course_session_id,starts_at,ends_at)
    select replacement_job, position.course_session_id, s.starts_at, s.ends_at
    from public.assignment_sessions s
    left join public.job_sessions position on position.job_id = offer.id
      and position.starts_at = s.starts_at and position.ends_at = s.ends_at
    where s.id = any(canonical_ids) order by s.starts_at,s.id;
    insert into public.job_requirements(job_id,topic_id)
    select replacement_job, topic_id from public.job_requirements where job_id = offer.id;
    insert into private.job_matching_requirements(job_id,qualification_topics,teaching_languages,document_evidence_required)
    select replacement_job,qualification_topics,teaching_languages,document_evidence_required
      from private.job_matching_requirements where job_id = offer.id;
    insert into private.job_dispatch(job_id,organisation_id,class_id,class_name,meeting_url,contact)
    select replacement_job,organisation_id,class_id,class_name,meeting_url,contact
      from private.job_dispatch where job_id = offer.id;

    select j.terms_version,j.lifecycle_version into strict replacement_terms_version,replacement_job_version
      from public.jobs j where j.id = replacement_job;
    result := private.confirm_staff_job_assignment(replacement_job,p_lecturer_id,
      replacement_terms_version,replacement_job_version,p_request_id,true);
    if result->>'status' is distinct from 'confirmed' then raise sqlstate 'PPR01'; end if;
    replacement_claim := (result->>'claim_id')::uuid;
    -- Review the actual allocation and fee before releasing any source slot.
    if not exists(select 1 from public.job_claims c where c.id = replacement_claim and c.lecturer_id = p_lecturer_id
      and c.job_id = replacement_job and c.currency = source.currency and c.total_amount = fee and c.terms = reviewed_terms)
      or (select count(*) from public.assignment_sessions s where s.claim_id = replacement_claim) <> selected_count
      then raise check_violation; end if;
    update public.assignment_sessions set released_at = slot_time where id = any(canonical_ids) and claim_id = source.id;
    -- Revision invalidates stale whole- or partial-replacement screens.
    update public.jobs set lifecycle_version = lifecycle_version + 1 where id = offer.id;
    -- Preserve source workspace/chat access for retained teaching; grant the
    -- cover lecturer in the same course only through the current assignment.
    if offer.course_run_id is not null then
      for record_id in select id from public.chat_rooms where course_run_id = offer.course_run_id
        and kind = 'participant_course' order by id for update loop
        perform private.participant_chat_assignment_grant(record_id,p_lecturer_id);
      end loop;
    end if;
    insert into private.partial_teaching_replacements(actor_id,request_id,source_claim_id,replacement_claim_id,source_session_ids,command)
    values(who,p_request_id,source.id,replacement_claim,canonical_ids,command) returning id into record_id;
    insert into public.notifications(user_id,kind,resource_id)
      values(source.lecturer_id,'partial_teaching_replacement',record_id) on conflict do nothing;
    insert into public.audit_events(actor_id,action,resource_id,details)
      values(who,'assignment.partial_replacement',record_id,jsonb_build_object(
        'source_claim_id',source.id,'cover_claim_id',replacement_claim,'source_session_ids',canonical_ids));
    return result || jsonb_build_object('job_id',replacement_job,'replacement_id',record_id);
  exception when sqlstate 'PPR01' then
    return result;
  end;
end;
$$;

-- Surface only actionable source claims in the existing management panel.
do $migration$
declare
  definition text := pg_get_functiondef('private.job_lifecycle(uuid)'::regprocedure);
  anchor constant text := $mark$'can_manage',manager$mark$;
begin
  if cardinality(string_to_array(definition, anchor)) <> 2 then
    raise exception 'Expected job lifecycle capability projection';
  end if;
  execute replace(definition, anchor, anchor || $projection$,
    'partial_replaceable_claim_ids', case when manager and private.has_permission('finance.manage')
      and (select edition from private.installation_identity) = 'internal' then coalesce((
      select jsonb_agg(claim.id order by claim.id)
      from public.job_claims claim
      where claim.job_id = j.id and private.can_replace_part_of_assignment(claim)
        and exists (select 1 from public.assignment_sessions slot
          where slot.claim_id = claim.id and slot.released_at is null and slot.starts_at > now()
            and not exists (select 1 from private.teaching_timesheets sheet where sheet.session_id = slot.id)
            and not exists (select 1 from private.delivery_records delivery where delivery.session_id = slot.id
              and delivery.latest_submission_id is not null))
    ), '[]'::jsonb) else '[]'::jsonb end$projection$);
end;
$migration$;

alter function private.notification_target(text,uuid) rename to notification_target_before_partial_replacement;
revoke all on function private.notification_target_before_partial_replacement(text,uuid)
  from public, anon, authenticated, service_role;
create function private.notification_target(p_kind text,p_resource uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare item jsonb;
begin
  if p_kind = 'partial_teaching_replacement' then
    select jsonb_build_object('href','/jobs/' || job.id,'title',job.title) into item
    from private.partial_teaching_replacements replaced
    join public.job_claims source on source.id = replaced.source_claim_id
    join public.jobs job on job.id = source.job_id
    where replaced.id = p_resource and private.actor_active()
      and (source.lecturer_id = auth.uid() or private.has_permission('jobs.manage'));
    return coalesce(item,jsonb_build_object('href',null,'title',''));
  end if;
  return private.notification_target_before_partial_replacement(p_kind,p_resource);
end;
$$;

create function public.partial_replacement_options(p_claim_id uuid,p_search text default '')
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.partial_replacement_options(p_claim_id,p_search);
$$;
create function public.replace_teaching_sessions(
  p_claim_id uuid,p_expected_job_version integer,p_session_ids uuid[],p_lecturer_id uuid,
  p_total text,p_terms text,p_reason text,p_request_id uuid
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.replace_teaching_sessions(p_claim_id,p_expected_job_version,p_session_ids,p_lecturer_id,
    p_total,p_terms,p_reason,p_request_id);
$$;
revoke all on function private.can_replace_part_of_assignment(public.job_claims),private.notification_target(text,uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.partial_replacement_options(uuid,text),public.partial_replacement_options(uuid,text),
  private.replace_teaching_sessions(uuid,integer,uuid[],uuid,text,text,text,uuid),
  public.replace_teaching_sessions(uuid,integer,uuid[],uuid,text,text,text,uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.partial_replacement_options(uuid,text),public.partial_replacement_options(uuid,text),
  private.replace_teaching_sessions(uuid,integer,uuid[],uuid,text,text,text,uuid),
  public.replace_teaching_sessions(uuid,integer,uuid[],uuid,text,text,text,uuid)
  to authenticated;
commit;
