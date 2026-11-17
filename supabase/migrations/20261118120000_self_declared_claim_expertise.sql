begin;
-- User-declared expertise is sufficient to meet job topic requirements. Optional
-- attestation/evidence remains historical metadata, never an allocation gate.
-- Replace only the former verified/expiry predicates in the current, composed
-- implementations; retain all authority, contract, capacity and overlap checks.
do $migration$
declare signature text; source text; patched text;
begin
 foreach signature in array array[
  'private.claim_job_base(uuid,uuid,integer)',
  'private.replacement_eligibility_before_company_rejection_guard(uuid,uuid,uuid)',
  'private.marketplace_eligibility_before_company_rejection_guard(uuid,uuid)',
  'private.job_dashboard()',
  'private.notify_matching_job()',
  'private.recommended_jobs()',
  'private.readiness_snapshot(uuid)'
 ] loop
  select pg_catalog.pg_get_functiondef(signature::regprocedure) into source;
  patched:=source;
  patched:=replace(patched,' and lt.verified and (lt.valid_until is null or lt.valid_until>=(select max(ends_at) from public.job_sessions where job_id=j.id))','');
  patched:=replace(patched,' and t.verified and (t.valid_until is null or t.valid_until>=ends)','');
  patched:=replace(patched,E' and lt.verified\n  and (lt.valid_until is null or lt.valid_until>=(select max(ends_at) from public.job_sessions where job_id=j.id))','');
  patched:=replace(patched,' and t.verified and(t.valid_until is null or t.valid_until>=(select max(ends_at)from public.job_sessions where job_id=j.id))','');
  patched:=replace(patched,'and t.verified and (t.valid_until is null or t.valid_until>=(select max(s.ends_at) from public.job_sessions s where s.job_id=j.id))','');
  patched:=replace(patched,' and topic.verified','');
  if patched=source or patched ~ '\m[a-z_]+\.verified\M' then
   raise exception 'Unexpected declared-expertise gate implementation: %',signature;
  end if;
  execute patched;
 end loop;
end $migration$;
notify pgrst, 'reload schema';
commit;
