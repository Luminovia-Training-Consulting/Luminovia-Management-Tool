begin;

alter table private.company_lecturer_decisions
 add column rejection_released_at timestamptz,
 add column rejection_released_by uuid references public.profiles(id),
 add constraint company_decision_release_pair check (
  (rejection_released_at is null and rejection_released_by is null) or
  (decision='rejected' and rejection_released_at is not null and rejection_released_by is not null)
 );

-- Company rejections apply to the person and the offer, not merely the old
-- claim receipt. A new idempotency key or a substitution cannot erase them.
create function private.company_rejected_lecturer(p_job uuid,p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.company_lecturer_decisions d
   join public.job_claims c on c.id=d.claim_id
   where c.job_id=p_job and c.lecturer_id=p_user and d.decision='rejected' and d.rejection_released_at is null);
$$;
revoke all on function private.company_rejected_lecturer(uuid,uuid) from public,anon,authenticated,service_role;

-- Release is an explicit, scoped company decision. It removes no historical
-- decision and performs no claim; all earlier rejections for the same person
-- and offer are lifted together. Account and job locks match rejection/claim.
create function private.company_rejected_lecturers(p_job uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.deletion_can_manage_job(p_job) then raise exception 'Organisation access required' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('claim_id',item.claim_id,'lecturer_name',item.display_name) order by item.display_name,item.claim_id)
  from (select distinct on(c.lecturer_id) c.id claim_id,p.display_name
   from private.company_lecturer_decisions d join public.job_claims c on c.id=d.claim_id
   join public.profiles p on p.id=c.lecturer_id
   where c.job_id=p_job and d.decision='rejected' and d.rejection_released_at is null
   order by c.lecturer_id,d.decided_at desc,c.id) item),'[]'::jsonb);
end;$$;
create function public.company_rejected_lecturers(p_job uuid) returns jsonb
language sql stable security invoker set search_path='' as $$select private.company_rejected_lecturers(p_job);$$;

create function private.release_company_rejection(p_claim uuid) returns void
language plpgsql security definer set search_path='' as $$
declare c public.job_claims; n integer;
begin
 if not private.actor_active() then raise exception 'Active account required' using errcode='42501';end if;
 select * into c from public.job_claims where id=p_claim;
 if c.id is null or not private.deletion_can_manage_job(c.job_id) then raise exception 'Organisation access required' using errcode='42501';end if;
 perform 1 from public.profiles where id=auth.uid() and active for share;
 if not found then raise exception 'Active account required' using errcode='42501';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(c.lecturer_id::text,0));
 perform 1 from public.jobs where id=c.job_id for update;
 if not private.deletion_can_manage_job(c.job_id) then raise exception 'Organisation access required' using errcode='42501';end if;
 if not exists(select 1 from private.company_lecturer_decisions where claim_id=p_claim and decision='rejected') then
  raise exception 'Rejected assignment required' using errcode='22023';end if;
 update private.company_lecturer_decisions d set rejection_released_at=clock_timestamp(),rejection_released_by=auth.uid()
  from public.job_claims prior where prior.id=d.claim_id and prior.job_id=c.job_id and prior.lecturer_id=c.lecturer_id
   and d.decision='rejected' and d.rejection_released_at is null;
 get diagnostics n=row_count;
 if n>0 then insert into public.audit_events(actor_id,action,resource_id,details)
  values(auth.uid(),'company.lecturer_rejection_released',c.id,jsonb_build_object('job_id',c.job_id,'released_decisions',n));end if;
end;$$;
create function public.release_company_rejection(p_claim uuid) returns void
language sql security invoker set search_path='' as $$select private.release_company_rejection(p_claim);$$;
revoke all on function private.company_rejected_lecturers(uuid),public.company_rejected_lecturers(uuid),private.release_company_rejection(uuid),public.release_company_rejection(uuid) from public,anon,authenticated,service_role;
grant execute on function private.company_rejected_lecturers(uuid),public.company_rejected_lecturers(uuid),private.release_company_rejection(uuid),public.release_company_rejection(uuid) to authenticated;

-- Existing receipt retries must return the real immutable receipt even after a
-- rejection. New requests follow the existing actor-before-job lock order; a
-- concurrent company decision takes the same locks before writing rejection.
alter function private.claim_job(uuid,uuid,integer) rename to claim_job_before_company_rejection_guard;
revoke all on function private.claim_job_before_company_rejection_guard(uuid,uuid,integer) from public,anon,authenticated,service_role;
create function private.claim_job(p_job_id uuid,p_idempotency_key uuid,p_terms_version integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();
begin
 if not private.actor_active() then raise exception 'Authentication required' using errcode='42501';end if;
 perform 1 from public.profiles where id=actor and active for share;
 if p_idempotency_key is null or p_terms_version is null or not private.lecturer_actor() then
  return private.claim_job_before_company_rejection_guard(p_job_id,p_idempotency_key,p_terms_version);
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,0));
 if exists(select 1 from public.job_claims where lecturer_id=actor and idempotency_key=p_idempotency_key) then
  return private.claim_job_before_company_rejection_guard(p_job_id,p_idempotency_key,p_terms_version);
 end if;
 perform 1 from public.jobs where id=p_job_id for update;
 if private.company_rejected_lecturer(p_job_id,actor) then return jsonb_build_object('status','not_eligible');end if;
 return private.claim_job_before_company_rejection_guard(p_job_id,p_idempotency_key,p_terms_version);
end;$$;
revoke all on function private.claim_job(uuid,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function private.claim_job(uuid,uuid,integer) to authenticated;

-- The same decision governs waitlist eligibility, proposals and the final
-- atomic acceptance of a replacement; existing callers already lock the job
-- and relevant lecturer before the final eligibility check.
alter function private.assignment_replacement_eligibility(uuid,uuid,uuid) rename to replacement_eligibility_before_company_rejection_guard;
revoke all on function private.replacement_eligibility_before_company_rejection_guard(uuid,uuid,uuid) from public,anon,authenticated,service_role;
create function private.assignment_replacement_eligibility(p_job uuid,p_user uuid,p_claim uuid default null) returns text
language plpgsql stable security definer set search_path='' as $$
begin
 if private.company_rejected_lecturer(p_job,p_user) then return 'not_eligible';end if;
 return private.replacement_eligibility_before_company_rejection_guard(p_job,p_user,p_claim);
end;$$;
revoke all on function private.assignment_replacement_eligibility(uuid,uuid,uuid) from public,anon,authenticated,service_role;

-- The open/selected replacement marketplace has its own eligibility path.
-- Check it too so a rejected person cannot be invited, offered the quote, or
-- start the transactional handover to take a different lecturer's position.
alter function private.replacement_eligible(uuid,uuid) rename to marketplace_eligibility_before_company_rejection_guard;
revoke all on function private.marketplace_eligibility_before_company_rejection_guard(uuid,uuid) from public,anon,authenticated,service_role;
create function private.replacement_eligible(p_offer uuid,p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select private.marketplace_eligibility_before_company_rejection_guard(p_offer,p_user)
  and not exists(select 1 from private.replacement_offers o
   join public.job_claims c on c.id=o.original_claim_id
   where o.id=p_offer and private.company_rejected_lecturer(c.job_id,p_user));
$$;
revoke all on function private.replacement_eligible(uuid,uuid) from public,anon,authenticated,service_role;

-- Defense in depth against future insertion paths; the current claim and
-- substitution paths take actor/job locks before reaching this trigger.
create function private.enforce_company_rejection_on_claim() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if private.company_rejected_lecturer(new.job_id,new.lecturer_id) then
  raise exception 'Lecturer is not eligible for this offer' using errcode='42501';
 end if;
 return new;
end;$$;
revoke all on function private.enforce_company_rejection_on_claim() from public,anon,authenticated,service_role;
create trigger company_rejection_claim_guard before insert on public.job_claims
 for each row execute function private.enforce_company_rejection_on_claim();
commit;
