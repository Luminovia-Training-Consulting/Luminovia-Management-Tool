begin;

-- The offering, rather than its sibling offerings, owns this audience.
-- Previously restricted course requests still keep their course-level fence.
create or replace function private.job_lecturer_blocked(p_job_id uuid, p_lecturer_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.jobs job
    join public.course_runs run on run.id = job.course_run_id
    where job.id = p_job_id and (job.company_internal or run.own_lecturers_only)
      and not exists (
        select 1 from private.active_company_lecturers(run.organisation_id) lecturer
        where lecturer.id = p_lecturer_id
      ) and not exists (
        select 1 from public.job_claims accepted where accepted.job_id = p_job_id
          and accepted.lecturer_id = p_lecturer_id and accepted.status = 'confirmed'
      )
  ) or private.job_lecturer_blocked_before_company_audience(p_job_id, p_lecturer_id);
$$;

create or replace function private.guard_company_internal_job() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  company uuid;
begin
  if tg_op = 'UPDATE' and old.company_internal is distinct from new.company_internal then
    raise exception 'Cannot change internal staffing mode' using errcode = '22023';
  end if;
  if not new.company_internal then return new; end if;
  select run.organisation_id into company
  from public.course_runs run where run.id = new.course_run_id;
  if company is null then
    raise exception 'Internal staffing requires an assigned company' using errcode = '22023';
  end if;
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    -- The roster writer takes a conflicting organisation lock.
    perform 1 from public.organisations o
      where o.id = company and o.archived_at is null for share;
    if not found or not exists (select 1 from private.active_company_lecturers(company)) then
      raise exception 'course_offer_roster_required' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

drop trigger company_internal_job_guard on public.jobs;
create trigger company_internal_job_guard
before insert or update of company_internal, course_run_id, status
on public.jobs for each row execute function private.guard_company_internal_job();

-- Only staff who manage both resources see an eligibility summary. Use the
-- same complete-block predicate as matching notices, without returning identities,
-- counts per exclusion, or any details from private calendars.
create function private.course_offer_publication_preview(p_job_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  result jsonb;
begin
  if not private.has_permission('jobs.manage') or not private.has_permission('courses.manage') then
    raise insufficient_privilege;
  end if;
  select jsonb_build_object(
    'version', job.lifecycle_version,
    'audience', case when job.company_internal or run.own_lecturers_only then 'company' else 'marketplace' end,
    'billable', not job.company_internal,
    'eligible', exists (select 1 from private.matching_job_lecturers(job.id)),
    'ready', run.archived_at is null and (not job.company_internal or
      (company.id is not null and exists (select 1 from private.active_company_lecturers(company.id))))
      and (job.claim_deadline is null or job.claim_deadline > statement_timestamp())
      and exists (select 1 from public.job_sessions s where s.job_id = job.id)
      and not exists (select 1 from public.job_sessions s where s.job_id = job.id and s.starts_at <= statement_timestamp())
  ) into result
  from public.jobs job join public.course_runs run on run.id = job.course_run_id
  left join public.organisations company on company.id = run.organisation_id and company.archived_at is null
  where job.id = p_job_id and job.status = 'draft';
  if result is null then raise exception 'Course offer draft unavailable' using errcode = '22023'; end if;
  return result;
end;
$$;

create function public.course_offer_publication_preview(p_job_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select private.course_offer_publication_preview(p_job_id);
$$;

revoke all on function private.course_offer_publication_preview(uuid), public.course_offer_publication_preview(uuid)
from public, anon, authenticated, service_role;
grant execute on function private.course_offer_publication_preview(uuid), public.course_offer_publication_preview(uuid)
to authenticated;

-- Preserve the existing course lock, idempotent receipt, and exact source
-- references. Normalise only internal staffing inputs to the existing zero-net
-- storage representation. External finance validation is unchanged.
do $course_offer$
declare
  rule record;
  old_lock_order constant text := $old$  perform 1 from public.organisations where id=p_organisation_id and archived_at is null for no key update;
  if not found then raise exception 'Organisation unavailable' using errcode = '22023'; end if;
  -- The existing claim trigger takes this same lock before accepting.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_lecturer_id::text, 0));$old$;
  new_lock_order constant text := $new$  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_lecturer_id::text, 0));
  perform 1 from public.organisations where id=p_organisation_id and archived_at is null for no key update;
  if not found then raise exception 'Organisation unavailable' using errcode = '22023'; end if;$new$;
  definition text := pg_catalog.pg_get_functiondef('private.create_course_run_job(uuid,jsonb,numeric,uuid)'::regprocedure);
begin
  for rule in select * from (values
    ($old$offer_title text;$old$, $new$offer_title text; internal_only boolean;$new$),
    ($old$'capacity','title','description')) then raise exception 'Invalid course offer'$old$,
     $new$'capacity','title','description','own_lecturers_only')) then raise exception 'Invalid course offer'$new$),
    ($old$ if jsonb_typeof(p_payload->'source_revision')$old$,
     $new$ if p_payload ? 'own_lecturers_only'
    and jsonb_typeof(p_payload->'own_lecturers_only') is distinct from 'boolean' then
  raise invalid_parameter_value;
 end if;
 internal_only := coalesce(p_payload->'own_lecturers_only' = 'true'::jsonb, false);
 if internal_only then
  if p_platform_percent is not null or p_payload ?| array['amount','total_amount','gross_amount','gross_total_amount','currency','rate_unit','requires_contract'] then
   raise exception 'Internal course offers do not take pricing or contract inputs' using errcode='22023';
  end if;
  gross := false;
  p_payload := p_payload || '{"amount":0,"total_amount":0,"currency":"EUR","rate_unit":"fixed_total","requires_contract":false}'::jsonb;
 end if;
 if jsonb_typeof(p_payload->'source_revision')$new$),
    ($old$amount not between 0.01 and 9999999999.99 or total not between 0.01 and 9999999999.99$old$,
     $new$amount not between (case when internal_only then 0 else 0.01 end) and 9999999999.99 or total not between (case when internal_only then 0 else 0.01 end) and 9999999999.99$new$),
    ($old$ if (private.course_run_job_defaults(r.id)->>'source_revision')$old$,
     $new$ if r.own_lecturers_only and not internal_only then
  raise exception 'This course requires internal staffing' using errcode='22023';
 end if;
 if internal_only and not exists (select 1 from private.active_company_lecturers(o.id)) then
  raise exception 'course_offer_roster_required' using errcode='22023';
 end if;
 if (private.course_run_job_defaults(r.id)->>'source_revision')$new$),
    ($old$case when gross then 'commission' else 'legacy_net' end$old$,
     $new$case when internal_only then 'company_internal' when gross then 'commission' else 'legacy_net' end$new$),
    ($old$claim_deadline,created_by,capacity,capacity_basis)$old$,
     $new$claim_deadline,created_by,capacity,capacity_basis,company_internal)$new$),
    ($old$case when positions>1 then 'per_position' else 'single_position' end);$old$,
     $new$case when positions>1 then 'per_position' else 'single_position' end,internal_only);$new$)
  ) rules(before, after)
  loop
    if cardinality(string_to_array(definition, rule.before)) <> 2 then
      raise exception 'Course offer audience update point unavailable: %', rule.before;
    end if;
    definition := replace(definition, rule.before, rule.after);
  end loop;
  execute definition;

  -- Claims lock the lecturer before the job. The roster writer must not
  -- hold the company while it waits for that lecturer during publication.
  definition := pg_catalog.pg_get_functiondef('private.set_company_lecturer(uuid,uuid,boolean)'::regprocedure);
  if cardinality(string_to_array(definition, old_lock_order)) <> 2 then
    raise exception 'Company lecturer lock update point unavailable';
  end if;
  execute replace(definition, old_lock_order, new_lock_order);

  definition := pg_catalog.pg_get_functiondef('private.course_run_job_defaults(uuid)'::regprocedure);
  if cardinality(string_to_array(definition, 'return result||jsonb_build_object(')) <> 2 then
    raise exception 'Course offer defaults update point unavailable';
  end if;
  -- Roster changes must not invalidate an external client's reviewed source hash.
  execute replace(definition, 'return result||jsonb_build_object(', $new$
  return result || jsonb_build_object(
    'company_only_course', (select run.own_lecturers_only from public.course_runs run where run.id = p_course_run_id),
    'has_company_lecturers', exists (
      select 1 from private.active_company_lecturers((result->>'organisation_id')::uuid)
    )
  ) || jsonb_build_object($new$);
end;
$course_offer$;

notify pgrst, 'reload schema';
commit;
