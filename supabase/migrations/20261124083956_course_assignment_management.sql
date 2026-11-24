begin;

-- Prefer the course's deliberately selected contact; otherwise use the most
-- recently added active contact for the same company. Never copy directory notes.
create function private.course_job_contact(p_run_id uuid, p_organisation_id uuid default null)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('name', contact.name, 'email', contact.email, 'phone', contact.phone)
  from public.course_runs run
  join public.organisations organisation on organisation.id = coalesce(p_organisation_id, run.organisation_id)
  join public.organisation_contacts contact on contact.organisation_id = organisation.id
  left join private.course_workspace_settings settings on settings.run_id = run.id
  where run.id = p_run_id and organisation.archived_at is null and contact.archived_at is null
  order by (contact.id is distinct from settings.contact_id), contact.created_at desc, contact.id desc
  limit 1
$$;

revoke all on function private.course_job_contact(uuid,uuid) from public, anon, authenticated, service_role;

create or replace function private.job_dispatch_projection(p_job public.jobs)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  company uuid;
  assignment private.job_dispatch;
  effective_contact jsonb;
  manager boolean := private.has_permission('jobs.manage');
  assigned_lecturer boolean := private.lecturer_actor() and exists (
    select 1 from public.job_claims where job_id = p_job.id and lecturer_id = auth.uid() and status = 'confirmed'
  );
begin
  select organisation_id into company from public.course_runs where id = p_job.course_run_id;
  if manager or assigned_lecturer or private.job_dispatch_company_actor(p_job.id) then
    select * into assignment from private.job_dispatch where job_id = p_job.id and organisation_id = company;
    -- The separate briefing owns explicitly authored job contacts and their visibility.
    if not ((manager or assigned_lecturer) and exists (
      select 1 from private.job_briefings briefing where briefing.job_id = p_job.id
        and concat(briefing.contact_name, briefing.contact_email, briefing.contact_phone, briefing.contact_description) <> ''
    )) then
      effective_contact := private.course_job_contact(p_job.course_run_id);
    end if;
  end if;
  return jsonb_build_object('class_id', assignment.class_id, 'class_name', assignment.class_name,
    'meeting_url', assignment.meeting_url, 'dispatch_contact', effective_contact,
    'can_edit_dispatch', coalesce(private.job_dispatch_editable(p_job, company), false));
end;
$$;

do $migration$
declare
  definition text := pg_get_functiondef('private.course_workspace_before_premium(uuid)'::regprocedure);
  marker constant text := '''contact_options'',case when';
begin
  if cardinality(string_to_array(definition, marker)) <> 2 then
    raise exception 'Expected the course contact options projection';
  end if;
  execute replace(definition, marker, $new$
    'selected_contact_id',case when (c->>'manager')::boolean then (
      select contact.id from public.organisation_contacts contact
      where contact.id = settings.contact_id and contact.organisation_id = r.organisation_id
        and contact.archived_at is null
    ) end,
    'contact_options',case when$new$);
end;
$migration$;

-- Match the class editor's contact preview to the applied inheritance rule.
do $migration$
declare
  definition text := pg_get_functiondef('private.job_dispatch_options(uuid,uuid)'::regprocedure);
  marker constant text := 'private.dispatch_contact(p_organisation_id)';
begin
  if cardinality(string_to_array(definition, marker)) <> 2 then
    raise exception 'Expected the job dispatch contact preview';
  end if;
  execute replace(definition, marker, 'private.course_job_contact(job.course_run_id, p_organisation_id)');
end;
$migration$;

-- Return inherited contact details separately from editable authored fields.
-- The ordinary before-claim briefing must not disclose the company directory.
do $migration$
declare
  definition text := pg_get_functiondef('private.job_briefing(uuid)'::regprocedure);
  marker constant text := $old$'has_contact', has_contact,$old$;
begin
  if cardinality(string_to_array(definition, marker)) <> 2 then
    raise exception 'Expected the job briefing contact projection';
  end if;
  execute replace(definition, marker, marker || $new$
    'fallback_contact', case when not has_contact and (
      manager or exists(select 1 from public.job_claims claim where claim.job_id = job.id
        and claim.lecturer_id = auth.uid() and claim.status = 'confirmed')
    ) then private.course_job_contact(job.course_run_id) end,$new$);
end;
$migration$;

-- The normal offer editor governs unaccepted terms. The metadata path uses the
-- same version, request and audit handling and can update only descriptive text.
do $migration$
declare
  definition text := pg_get_functiondef('private.manage_job_offer(uuid,text,integer,uuid,jsonb)'::regprocedure);
  allowed constant text := $old$'reopen','edit','duplicate'$old$;
  validation constant text := 'for k in select jsonb_object_keys(p_payload) loop';
  branch constant text := 'if p_action=''duplicate'' then';
begin
  if cardinality(string_to_array(definition, allowed)) <> 2
    or cardinality(string_to_array(definition, validation)) <> 2
    or cardinality(string_to_array(definition, branch)) <> 2 then
    raise exception 'Expected versioned offer edit seams';
  end if;
  definition := replace(definition, allowed, $new$'reopen','edit','duplicate','edit_metadata'$new$);
  definition := replace(definition, validation, validation || $new$
    if p_action = 'edit_metadata' then
      if k not in ('title', 'description') or jsonb_typeof(p_payload->k) is distinct from 'string' then
        raise invalid_parameter_value;
      end if;
      continue;
    end if;
$new$);
  execute replace(definition, branch, $new$
  if p_action = 'edit_metadata' then
    if j.status = 'archived' or length(btrim(coalesce(p_payload->>'title', j.title))) not between 1 and 200
      or length(coalesce(p_payload->>'description', j.description)) > 12000 then
      raise invalid_parameter_value;
    end if;
    update public.jobs set title = btrim(coalesce(p_payload->>'title', j.title)),
      description = coalesce(p_payload->>'description', j.description) where id = j.id;
    result := j.id;
  elsif p_action = 'duplicate' then$new$);
end;
$migration$;

-- Reuse the same allocation path as an initial manual assignment. Replacement
-- ignores the marketplace deadline but still checks the complete future block.
do $migration$
declare
  definition text := pg_get_functiondef('private.manual_assign_job(uuid,uuid,integer,integer,uuid)'::regprocedure);
  signature constant text := 'p_request_id uuid)';
  deadline_guard constant text := 'or j.claim_deadline<=clock_timestamp()';
begin
  if cardinality(string_to_array(definition, signature)) <> 2
    or cardinality(string_to_array(definition, deadline_guard)) <> 2 then
    raise exception 'Expected manual assignment deadline guard';
  end if;
  definition := replace(definition, 'private.manual_assign_job(', 'private.confirm_staff_job_assignment(');
  definition := replace(definition, signature, 'p_request_id uuid, p_replacement boolean)');
  execute replace(definition, deadline_guard, 'or (not p_replacement and j.claim_deadline<=clock_timestamp())');
end;
$migration$;

revoke all on function private.confirm_staff_job_assignment(uuid,uuid,integer,integer,uuid,boolean)
from public, anon, authenticated, service_role;

create or replace function private.manual_assign_job(
  p_job_id uuid, p_lecturer_id uuid, p_terms_version integer, p_expected_job_version integer, p_request_id uuid
) returns jsonb language sql security definer set search_path = '' as $$
  select private.confirm_staff_job_assignment(p_job_id, p_lecturer_id, p_terms_version,
    p_expected_job_version, p_request_id, false)
$$;

create function private.can_replace_job_lecturer(p_claim public.job_claims)
returns boolean language sql stable set search_path = '' as $$
  select p_claim.status = 'confirmed'
    and exists (select 1 from public.jobs job where job.id = p_claim.job_id and job.status in ('published', 'filled'))
    and exists (select 1 from public.assignment_sessions session where session.claim_id = p_claim.id)
    and not exists (
      select 1 from public.assignment_sessions session where session.claim_id = p_claim.id
        and (session.released_at is not null or session.starts_at <= now())
    )
    and not exists (select 1 from public.invoice_items item where item.claim_id = p_claim.id)
    and not private.assignment_change_customer_invoiced(p_claim.id)
    and not exists (
      (select starts_at, ends_at from public.assignment_sessions where claim_id = p_claim.id
       except all select starts_at, ends_at from public.job_sessions where job_id = p_claim.job_id)
      union all
      (select starts_at, ends_at from public.job_sessions where job_id = p_claim.job_id
       except all select starts_at, ends_at from public.assignment_sessions where claim_id = p_claim.id)
    )
$$;

revoke all on function private.can_replace_job_lecturer(public.job_claims) from public, anon, authenticated, service_role;

create function private.job_replacement_candidates(p_claim_id uuid, p_search text default '')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  source public.job_claims;
  job public.jobs;
begin
  if not private.has_permission('jobs.manage') then raise insufficient_privilege; end if;
  if p_search is null or length(p_search) > 200 then raise invalid_parameter_value; end if;
  select * into source from public.job_claims where id = p_claim_id;
  if not found or not private.can_replace_job_lecturer(source) then
    raise exception 'Assignment unavailable for replacement' using errcode = '22023';
  end if;
  select * into strict job from public.jobs where id = source.job_id;

  return coalesce((
    select jsonb_agg(jsonb_build_object('id', candidate.id, 'name', candidate.display_name,
      'eligibility', case when quote is null then 'quote_unavailable' else eligibility end,
      'terms_version', case when exists (
        select 1 from private.job_commission_offers where job_id = job.id and pricing_mode = 'role_split'
      ) then private.role_quote_version(job.terms_version, candidate.id) else job.terms_version end,
      'quote', case when private.has_permission('finance.gross.read') then quote end
    ) order by candidate.display_name, candidate.id)
    from (
      select profile.id, profile.display_name,
        private.assignment_replacement_eligibility(job.id, profile.id, source.id) as eligibility,
        private.lecturer_job_quote(profile.id, job.id) as quote
      from public.profiles profile
      where profile.active and private.lecturer_user(profile.id) and profile.id <> source.lecturer_id
        and strpos(lower(profile.display_name), lower(p_search)) > 0
      order by profile.display_name, profile.id limit 50
    ) candidate
  ), '[]'::jsonb);
end;
$$;

create function private.replace_job_lecturer(
  p_claim_id uuid, p_lecturer_id uuid, p_terms_version integer, p_expected_job_version integer,
  p_request_id uuid, p_reason text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  source public.job_claims;
  job public.jobs;
  prior private.job_lifecycle_requests;
  result jsonb;
  replacement uuid;
  lock_id uuid;
  reason text := btrim(coalesce(p_reason, ''));
  payload jsonb := jsonb_build_object('action', 'replace_lecturer', 'claim_id', p_claim_id,
    'lecturer_id', p_lecturer_id, 'terms_version', p_terms_version,
    'version', p_expected_job_version, 'reason', reason);
begin
  perform 1 from public.profiles where id = actor and active for share;
  if not found or not private.has_permission('jobs.manage') then raise insufficient_privilege; end if;
  if p_request_id is null or p_lecturer_id is null or p_terms_version is null
    or p_expected_job_version is null or length(reason) not between 5 and 1000 then
    raise invalid_parameter_value;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'job-request:' || actor::text || p_request_id::text, 0));
  select * into prior from private.job_lifecycle_requests where actor_id = actor and request_id = p_request_id;
  if found then
    if prior.payload <> payload then raise invalid_parameter_value; end if;
    select jsonb_build_object('status', claim.status, 'claim_id', claim.id) into result
      from public.job_claims claim where claim.id = prior.result;
    return coalesce(result, jsonb_build_object('status', 'unavailable'));
  end if;

  select * into source from public.job_claims where id = p_claim_id;
  if not found or source.lecturer_id = p_lecturer_id then raise invalid_parameter_value; end if;
  perform 1 from public.profiles where id = p_lecturer_id and active for share;
  if not found then return jsonb_build_object('status', 'not_eligible'); end if;
  for lock_id in select id from unnest(array[source.lecturer_id, p_lecturer_id]) as lecturer(id) order by id loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(lock_id::text, 0));
  end loop;
  select * into strict job from public.jobs where id = source.job_id for update;
  select * into strict source from public.job_claims where id = p_claim_id for update;

  if job.lifecycle_version <> p_expected_job_version then
    return jsonb_build_object('status', 'terms_changed');
  end if;
  if not private.can_replace_job_lecturer(source) then return jsonb_build_object('status', 'unavailable'); end if;
  if exists (select 1 from public.job_claims where lecturer_id = p_lecturer_id and idempotency_key = p_request_id) then
    raise invalid_parameter_value;
  end if;

  -- A failed allocation rolls back the cancellation, memberships and notices
  -- together, including a last-second conflict or a changed quote.
  begin
    perform private.cancel_job_assignment_before_marketplace_reopen(source.id, reason, gen_random_uuid());
    update public.jobs set status = 'published' where id = job.id returning * into job;
    result := private.confirm_staff_job_assignment(job.id, p_lecturer_id, p_terms_version,
      job.lifecycle_version, p_request_id, true);
    if result->>'status' is distinct from 'confirmed' then raise sqlstate 'PJA01'; end if;
  exception when sqlstate 'PJA01' then
    return result;
  end;

  replacement := (result->>'claim_id')::uuid;
  insert into public.claim_events(claim_id, actor_id, event_type)
    values (source.id, actor, 'substituted_out');
  insert into private.job_lifecycle_requests(actor_id, request_id, payload, result)
    values (actor, p_request_id, payload, replacement);
  insert into public.audit_events(actor_id, action, resource_id, details)
    values (actor, 'assignment.lecturer_replaced', job.id, jsonb_build_object(
      'source_claim_id', source.id, 'replacement_claim_id', replacement));
  return result;
end;
$$;

create function public.job_replacement_candidates(p_claim_id uuid, p_search text default '')
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.job_replacement_candidates(p_claim_id, p_search)
$$;

create function public.replace_job_lecturer(
  p_claim_id uuid, p_lecturer_id uuid, p_terms_version integer, p_expected_job_version integer,
  p_request_id uuid, p_reason text
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.replace_job_lecturer(p_claim_id, p_lecturer_id, p_terms_version, p_expected_job_version, p_request_id, p_reason)
$$;

revoke all on function private.job_replacement_candidates(uuid,text), public.job_replacement_candidates(uuid,text),
  private.replace_job_lecturer(uuid,uuid,integer,integer,uuid,text), public.replace_job_lecturer(uuid,uuid,integer,integer,uuid,text)
from public, anon, authenticated, service_role;
grant execute on function private.job_replacement_candidates(uuid,text), public.job_replacement_candidates(uuid,text),
  private.replace_job_lecturer(uuid,uuid,integer,integer,uuid,text), public.replace_job_lecturer(uuid,uuid,integer,integer,uuid,text)
to authenticated;

-- Keep existing self-service and emergency fences by projecting an independent
-- staff capability, keyed by the same claims already visible in the lifecycle.
do $migration$
declare
  definition text := pg_get_functiondef('private.job_lifecycle(uuid)'::regprocedure);
  marker constant text := '''can_manage'',manager';
begin
  if cardinality(string_to_array(definition, marker)) <> 2 then
    raise exception 'Expected job management capability projection';
  end if;
  execute replace(definition, marker, marker || $new$,
    'can_edit_metadata', manager and j.status <> 'archived',
    'replaceable_claim_ids', case when manager then coalesce((
      select jsonb_agg(claim.id order by claim.id) from public.job_claims claim
      where claim.job_id = j.id and private.can_replace_job_lecturer(claim)
    ), '[]'::jsonb) else '[]'::jsonb end$new$);
end;
$migration$;

-- Keep the cancellation category, delivery preferences and deduplication. The
-- recipient's inbox can explain the substitution without exposing the new claim.
do $migration$
declare
  definition text := pg_get_functiondef('private.notification_target(text,uuid)'::regprocedure);
  marker constant text := 'else private.notification_target_before_calendar_invitation(p_kind, p_resource) end';
begin
  if cardinality(string_to_array(definition, marker)) <> 2 then
    raise exception 'Expected the current notification projection';
  end if;
  execute replace(definition, marker, $new$
    when p_kind = 'claim_cancelled' then coalesce((
      select jsonb_build_object('href', null, 'title', job.title, 'assignment_replaced', true)
      from public.job_claims claim
      join public.jobs job on job.id = claim.job_id
      where claim.id = p_resource and claim.lecturer_id = auth.uid()
        and exists (select 1 from public.claim_events event
          where event.claim_id = claim.id and event.event_type = 'substituted_out')
    ), private.notification_target_before_calendar_invitation(p_kind, p_resource))
    $new$ || marker);
end;
$migration$;

commit;
