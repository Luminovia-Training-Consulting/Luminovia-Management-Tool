-- Revalidate current account authority after waitlist profile-lock waits.
-- Active former lecturers may still withdraw their own interest; no capacity
-- reservation, notification or commercial snapshot behavior changes.
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
 select * into j from public.jobs where id=p_job_id for update;
 if not found then raise exception 'Waitlist unavailable' using errcode='42501';end if;
 if p_join then
  state=private.job_waitlist(p_job_id);
  if not (state->>'joined')::boolean and not (state->>'can_join')::boolean then raise exception 'Only a full future offer can be waitlisted' using errcode='22023';end if;
  insert into private.job_waitlist(job_id,user_id) values(p_job_id,auth.uid()) on conflict do nothing;
 else
  delete from private.job_waitlist where job_id=p_job_id and user_id=auth.uid();
  delete from public.notifications where user_id=auth.uid() and kind='job_waitlist_available' and resource_id=p_job_id;
  return jsonb_build_object('job_id',j.id,'title',j.title,'joined',false,'can_join',false,'available',false);
 end if;
 return private.job_waitlist(p_job_id);
end;$$;

COMMIT;
