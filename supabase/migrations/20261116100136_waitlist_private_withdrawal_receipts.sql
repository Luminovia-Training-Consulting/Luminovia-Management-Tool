-- Keep waitlist withdrawal idempotent without disclosing private job metadata.
-- Current active-account checks and explicit interest ownership remain authoritative.
BEGIN;

create or replace function private.set_job_waitlist(p_job_id uuid,p_join boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.jobs; state jsonb;
begin
 if not private.actor_active() or (p_join and not private.lecturer_actor()) then raise exception 'Lecturer account required' using errcode='42501';end if;
 if p_join is null then raise exception 'Join or leave required' using errcode='22023';end if;
 perform 1 from public.profiles where id=auth.uid() and active for share;
 -- Role/activation edits serialize on this same profile. The initial check
 -- may describe the old committed actor while this request waits for its lock.
 if not private.actor_active() or (p_join and not private.lecturer_actor()) then
  raise exception 'Current active account and lecturer join authority required' using errcode='42501';end if;
 if p_job_id is null then raise exception 'Waitlist unavailable' using errcode='42501';end if;
 -- Withdrawal is idempotent own-state cleanup, never a job lookup capability.
 -- Return the same redacted receipt for unknown/private IDs without interest
 -- before taking any foreign job lock or reading its current metadata.
 if not p_join and not exists(select 1 from private.job_waitlist where job_id=p_job_id and user_id=auth.uid()) then
  delete from public.notifications where user_id=auth.uid() and kind='job_waitlist_available' and resource_id=p_job_id;
  return jsonb_build_object('job_id',p_job_id,'title','','joined',false,'can_join',false,'available',false);
 end if;
 select * into j from public.jobs where id=p_job_id for update;
 if not found then raise exception 'Waitlist unavailable' using errcode='42501';end if;
 if p_join then
  state=private.job_waitlist(p_job_id);
  if not (state->>'joined')::boolean and not (state->>'can_join')::boolean then raise exception 'Only a full future offer can be waitlisted' using errcode='22023';end if;
  insert into private.job_waitlist(job_id,user_id) values(p_job_id,auth.uid()) on conflict do nothing;
 else
  delete from private.job_waitlist where job_id=p_job_id and user_id=auth.uid();
  delete from public.notifications where user_id=auth.uid() and kind='job_waitlist_available' and resource_id=p_job_id;
  -- Own interest permits removal after role/resource revocation, not a fresh
  -- title read. Every leave receipt uses the same metadata-free contract.
  return jsonb_build_object('job_id',j.id,'title','','joined',false,'can_join',false,'available',false);
 end if;
 return private.job_waitlist(p_job_id);
end;$$;

create or replace function private.job_waitlist(p_job_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare j public.jobs; joined boolean; can_join boolean;
begin
 if not private.lecturer_actor() then raise exception 'Lecturer account required' using errcode='42501';end if;
 select * into j from public.jobs where id=p_job_id;
 select exists(select 1 from private.job_waitlist w where w.job_id=p_job_id and w.user_id=auth.uid()) into joined;
 if j.id is null or (not joined and j.status not in('filled','published')) then raise exception 'Waitlist unavailable' using errcode='42501';end if;
 can_join=j.status in('filled','published') and exists(select 1 from public.job_sessions where job_id=j.id)
  and not exists(select 1 from public.job_sessions where job_id=j.id and starts_at<=now())
  and not exists(select 1 from public.job_claims where job_id=j.id and lecturer_id=auth.uid() and status='confirmed')
  and (j.status='filled' or (select count(*) from public.job_claims where job_id=j.id and status='confirmed')>=j.capacity);
 -- Interest retains own-state visibility, not access to later private edits.
 -- Filled/published offers keep their existing reduced marketplace contract.
 return jsonb_build_object('job_id',j.id,'title',case when j.status in('published','filled') or private.can_read_job(j.id) then j.title else '' end,'joined',joined,'can_join',can_join,
  'available',j.status='published' and (select count(*) from public.job_claims where job_id=j.id and status='confirmed')<j.capacity
   and (j.claim_deadline is null or j.claim_deadline>now()));
end;$$;

COMMIT;
