begin;

-- An academy allocates instructors locally. Retain the existing authoritative
-- scheduling and course membership records and keep a distinct accounting-free
-- association so a technical teaching position cannot be treated as an offer.
create table private.academy_course_instructors (
  course_id uuid not null references public.course_runs(id),
  instructor_id uuid not null references public.profiles(id),
  claim_id uuid primary key references public.job_claims(id),
  assigned_by uuid not null references public.profiles(id),
  request_id uuid not null,
  created_at timestamptz not null default now(),
  released_at timestamptz,
  unique(assigned_by,request_id)
);
create unique index one_active_academy_instructor
  on private.academy_course_instructors(course_id,instructor_id) where released_at is null;
alter table private.academy_course_instructors enable row level security;
revoke all on private.academy_course_instructors from public,anon,authenticated,service_role;

-- These RPCs remain behind the installation's transport gate. A valid
-- dedicated licence and current management capabilities are both necessary.
create function private.academy_assignment_course(p_course_id uuid)
returns public.course_runs language plpgsql stable security definer set search_path='' as $$
declare v_run public.course_runs;
begin
  if not private.customer_installation_has_active_licence() or
     not private.has_permission('courses.manage') or not private.has_permission('jobs.manage')
  then raise insufficient_privilege; end if;
  select r.* into v_run from public.course_runs r join public.organisations o on o.id=r.organisation_id
    where r.id=p_course_id and r.archived_at is null and o.archived_at is null;
  if not found then raise insufficient_privilege; end if;
  return v_run;
end;
$$;

create function private.academy_course_instructor_candidates(p_course_id uuid,p_search text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform private.academy_assignment_course(p_course_id);
  if p_search is null or char_length(p_search)>120 then raise invalid_parameter_value; end if;
  return coalesce((select jsonb_agg(to_jsonb(candidate) order by candidate.name,candidate.id)
     from (
       select p.id,p.display_name as name,
         (select c.id from private.academy_course_instructors a join public.job_claims c on c.id=a.claim_id
          where a.course_id=p_course_id and a.instructor_id=p.id and a.released_at is null and c.status='confirmed') as assignment_id
       from public.profiles p
       where p.active and private.lecturer_user(p.id) and strpos(lower(p.display_name),lower(btrim(p_search)))>0
       order by p.display_name,p.id limit 50
     ) candidate), '[]'::jsonb);
end;
$$;

create function private.academy_assign_course_instructor(p_course_id uuid,p_instructor_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_run public.course_runs;
  v_job_id uuid;
  v_receipt private.academy_course_instructors;
  v_result jsonb;
begin
  if p_course_id is null or p_instructor_id is null or p_request_id is null then raise invalid_parameter_value; end if;
  v_run:=private.academy_assignment_course(p_course_id);
  -- Match the scheduler's profile/lecturer locks before referencing a position
  -- and serialize exact retries across courses for the same acting admin.
  perform 1 from public.profiles where id=auth.uid() and active for share;
  perform 1 from public.profiles where id=p_instructor_id and active for share;
  if not found or not private.lecturer_user(p_instructor_id) then return jsonb_build_object('status','not_eligible'); end if;
  perform pg_advisory_xact_lock(hashtextextended(p_instructor_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('academy-assignment:'||auth.uid()::text||':'||p_request_id::text,0));
  perform 1 from public.course_runs r where r.id=p_course_id for no key update;
  v_run:=private.academy_assignment_course(p_course_id);

  select * into v_receipt from private.academy_course_instructors a
    where a.assigned_by=auth.uid() and a.request_id=p_request_id;
  if found then
    if (v_receipt.course_id,v_receipt.instructor_id) is distinct from (p_course_id,p_instructor_id) then
      return jsonb_build_object('status','idempotency_conflict');
    end if;
    return (select jsonb_build_object('status',c.status,'claim_id',c.id) from public.job_claims c where c.id=v_receipt.claim_id);
  end if;
  if exists (select 1 from private.academy_course_instructors where course_id=p_course_id and instructor_id=p_instructor_id and released_at is null)
    then return jsonb_build_object('status','already_assigned'); end if;

  if not exists (select 1 from public.course_sessions s where s.course_run_id=p_course_id) or exists(
      select 1 from public.course_sessions s where s.course_run_id=p_course_id and s.starts_at<=clock_timestamp()
    ) then return jsonb_build_object('status','schedule_required'); end if;

  -- The technical position is published only inside this transaction. The
  -- engine fills its sole slot on success. Roll back a refused position
  -- completely; no marketplace offer or commission projection is committed.
  begin
    insert into public.jobs(
      course_run_id,title,customer_name,delivery_type,location,time_zone,status,capacity,
      amount,currency,rate_unit,total_amount,terms,requires_contract,created_by
    )
    select v_run.id,t.title,o.name,v_run.delivery_type,v_run.venue,v_run.time_zone,'published',1,
      0,'EUR','fixed_total',0,'Academy course allocation',false,auth.uid()
    from public.course_templates t join public.organisations o on o.id=v_run.organisation_id
    where t.id=v_run.template_id
    returning id into strict v_job_id;

    insert into public.job_sessions(job_id,starts_at,ends_at)
      select v_job_id,s.starts_at,s.ends_at from public.course_sessions s
      where s.course_run_id=p_course_id order by s.starts_at,s.id;
    v_result:=private.manual_assign_job(v_job_id,p_instructor_id,1,1,p_request_id);
    if v_result->>'status' is distinct from 'confirmed' then
      raise sqlstate 'P4130' using message='Academy instructor allocation declined';
    end if;
    insert into private.academy_course_instructors(course_id,instructor_id,claim_id,assigned_by,request_id)
      values(p_course_id,p_instructor_id,(v_result->>'claim_id')::uuid,auth.uid(),p_request_id);
    return v_result;
  exception when sqlstate 'P4130' then
    return v_result;
  end;
end;
$$;

-- A planned teaching change releases the original allocation through the same
-- protected assignment/calendar/room operation. Exclude only marketplace
-- reopening, then archive the technical position without altering its terms.
create function private.academy_release_course_instructor(
  p_course_id uuid,p_claim_id uuid,p_reason text,p_request_id uuid
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_instructor uuid; v_result uuid;
begin
  if p_claim_id is null or p_request_id is null then raise invalid_parameter_value; end if;
  perform private.academy_assignment_course(p_course_id);
  select a.instructor_id into v_instructor from private.academy_course_instructors a
    where a.course_id=p_course_id and a.claim_id=p_claim_id;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.profiles where id=auth.uid() and active for share;
  perform 1 from public.profiles where id=v_instructor for share;
  perform pg_advisory_xact_lock(hashtextextended(v_instructor::text,0));
  perform 1 from public.course_runs r where r.id=p_course_id for no key update;
  perform private.academy_assignment_course(p_course_id);
  v_result:=private.cancel_job_assignment_before_marketplace_reopen(p_claim_id,p_reason,p_request_id);
  update public.jobs j set status='archived' where j.status='draft'
    and exists(select 1 from public.job_claims c where c.id=p_claim_id and c.job_id=j.id and c.status='cancelled');
  update private.academy_course_instructors set released_at=statement_timestamp()
    where claim_id=p_claim_id and released_at is null;
  return jsonb_build_object('status','cancelled','claim_id',v_result);
end;
$$;

create function public.academy_release_course_instructor(
  p_course_id uuid,p_claim_id uuid,p_reason text,p_request_id uuid
)
returns jsonb language sql security invoker set search_path='' as $$
  select private.academy_release_course_instructor(p_course_id,p_claim_id,p_reason,p_request_id);
$$;
revoke all on function private.academy_release_course_instructor(uuid,uuid,text,uuid),
  public.academy_release_course_instructor(uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function private.academy_release_course_instructor(uuid,uuid,text,uuid),
  public.academy_release_course_instructor(uuid,uuid,text,uuid) to authenticated;

create function public.academy_course_instructor_candidates(p_course_id uuid,p_search text default '')
returns jsonb language sql stable security invoker set search_path='' as $$
  select private.academy_course_instructor_candidates(p_course_id,p_search);
$$;
create function public.academy_assign_course_instructor(p_course_id uuid,p_instructor_id uuid,p_request_id uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select private.academy_assign_course_instructor(p_course_id,p_instructor_id,p_request_id);
$$;
revoke all on function private.academy_assignment_course(uuid),
  private.academy_course_instructor_candidates(uuid,text),private.academy_assign_course_instructor(uuid,uuid,uuid),
  public.academy_course_instructor_candidates(uuid,text),public.academy_assign_course_instructor(uuid,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function private.academy_course_instructor_candidates(uuid,text),
  private.academy_assign_course_instructor(uuid,uuid,uuid),public.academy_course_instructor_candidates(uuid,text),
  public.academy_assign_course_instructor(uuid,uuid,uuid) to authenticated;
commit;
