begin;

-- Forward integration for the independent operational modules. Historical
-- migration bytes stay intact; PR17 is optional, never a rollout prerequisite.
-- Where installed, the smart body may be current or held in one of the known
-- enquiry/change aliases; neither P2 installation nor its chronology is required.
-- Exact private signatures and known helper calls exclude wrapper recursion.
do $$
declare source text; previous regprocedure;
begin
 select p.prosrc into source from unnest(array[
  to_regprocedure('private.notification_target(text,uuid)'),
  to_regprocedure('private.notification_target_before_changes(text,uuid)'),
  to_regprocedure('private.notification_target_before_enquiries(text,uuid)'),
  to_regprocedure('private.notification_target_before_extensions(text,uuid)')
 ]) with ordinality candidate(signature,priority)
 join pg_catalog.pg_proc p on p.oid=candidate.signature
 join pg_catalog.pg_language l on l.oid=p.prolang
 where p.prosecdef and p.prorettype='jsonb'::regtype and l.lanname='plpgsql'
 and position('private.course_notification_target(' in p.prosrc)>0
 and position('private.timesheet_notification_target(' in p.prosrc)>0
 and position('qualification_expiring' in p.prosrc)>0
 and position('job_waitlist_available' in p.prosrc)>0
 order by candidate.priority limit 1;
 if source is null and to_regprocedure('private.course_notification_target(text,uuid)') is not null then
  raise exception 'The installed smart notification resolver is missing; refusing partial integration' using errcode='55000';
 end if;
 if source is null then
  select prosrc into source from pg_catalog.pg_proc where oid=to_regprocedure('private.notification_target_before_extensions(text,uuid)');
 end if;
 if source is null then raise exception 'The installed base notification resolver is missing' using errcode='55000';end if;
 execute format('create function private.notification_target_integrated_fallback(p_kind text,p_resource uuid) returns jsonb language plpgsql stable security definer set search_path='''' as %L',source);
 -- These are implementation aliases, not independent permission bypasses.
 for previous in select signature from unnest(array[
  to_regprocedure('private.notification_target_before_changes(text,uuid)'),
  to_regprocedure('private.notification_target_before_enquiries(text,uuid)'),
  to_regprocedure('private.notification_target_before_extensions(text,uuid)')
 ]) signature where signature is not null loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',previous);
 end loop;
end;$$;
revoke all on function private.notification_target_integrated_fallback(text,uuid) from public,anon,authenticated,service_role;

-- Replace the current function in place, preserving its OID and the inbox
-- contract. Every branch resolves current resource authority before any title.
-- Optional P2 discovery uses exact server-owned signatures and catalog-qualified
-- dynamic templates so absence fails closed without a missing static dependency.
create or replace function private.notification_target(p_kind text,p_resource uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare heading text; target uuid; result jsonb; helper regprocedure; relation regclass;
begin
 if not private.actor_active() then return jsonb_build_object('href',null,'title','');end if;
 if p_kind='readiness_task' then
  select t.course_run_id,t.title into target,heading from private.course_readiness_tasks t
   where t.id=p_resource and t.archived_at is null and t.responsible_user_id=auth.uid() and private.readiness_access(t.course_run_id);
  return jsonb_build_object('href',case when target is not null then '/readiness/'||target end,'title',coalesce(heading,''));
 elsif p_kind='support_update' then
  return private.support_notification_target(p_kind,p_resource);
 elsif p_kind in('delivery_submitted','delivery_confirmed','delivery_disputed','delivery_correction_requested','delivery_customer_confirmed') then
  return private.delivery_notification_target(p_kind,p_resource);
 elsif p_kind in('replacement_available','replacement_completed') then
  select j.title,o.id into heading,target from private.replacement_offers o
   join public.job_claims c on c.id=o.original_claim_id join public.jobs j on j.id=c.job_id
   where o.id=p_resource and (private.replacement_eligible(o.id,auth.uid()) or c.lecturer_id=auth.uid()
    or private.has_permission('jobs.manage') or exists(select 1 from public.job_claims where id=o.replacement_claim_id and lecturer_id=auth.uid()));
  return jsonb_build_object('href',case when target is not null then '/replacements' end,'title',coalesce(heading,''));
 elsif p_kind='website_enquiry' then
  helper=to_regprocedure('private.enquiry_notification_target(text,uuid)');
  if helper is not null then
   execute format('select %s($1,$2)',helper::oid::regproc) into result using p_kind,p_resource;
  end if;
  return coalesce(result,jsonb_build_object('href',null,'title',''));
 elsif p_kind='assignment_change' then
  relation=to_regclass('private.assignment_change_requests');helper=to_regprocedure('private.assignment_change_access(uuid)');
  if relation is not null and helper is not null then
   execute format('select r.original->>''title'' from %s r where r.id=$1 and %s(r.claim_id)',relation,helper::oid::regproc) into heading using p_resource;
  end if;
  return jsonb_build_object('href',case when heading is not null then '/changes/'||p_resource end,'title',coalesce(heading,''));
 end if;
 return private.notification_target_integrated_fallback(p_kind,p_resource);
end;$$;
revoke all on function private.notification_target(text,uuid) from public,anon,service_role;
grant execute on function private.notification_target(text,uuid) to authenticated;

-- A directed handover and a marketplace handover serialize on the same job.
-- Close only marketplace offers superseded by a committed directed acceptance,
-- not every cancelled source claim: the marketplace cancels its own source
-- inside the transaction before it marks its in-flight offer completed.
-- No lecturer/profile locks are acquired after the existing business locks.
create function private.reconcile_directed_marketplace_offer(p_substitution uuid) returns void
language plpgsql security definer set search_path='' as $$
declare substitution jsonb; closed record; relation regclass:=to_regclass('private.job_substitutions');
begin
 if relation is null then return;end if;
 execute format('select to_jsonb(s) from %s s where id=$1',relation) into substitution using p_substitution;
 if substitution is null then return;end if;
 perform 1 from public.jobs where id=(substitution->>'job_id')::uuid for update;
 perform 1 from public.job_claims where id=(substitution->>'original_claim_id')::uuid for update;
 execute format('select to_jsonb(s) from %s s where id=$1 for update',relation) into substitution using p_substitution;
 if substitution->>'status'<>'accepted' or not exists(
  select 1 from public.job_claims original join public.job_claims replacement on replacement.id=(substitution->>'accepted_claim_id')::uuid
  where original.id=(substitution->>'original_claim_id')::uuid and original.status='cancelled'
   and original.job_id=(substitution->>'job_id')::uuid and replacement.job_id=original.job_id
   and replacement.lecturer_id=(substitution->>'target_user_id')::uuid
 ) then return;end if;
 for closed in update private.replacement_offers set status='cancelled',version=version+1
  where original_claim_id=(substitution->>'original_claim_id')::uuid and status='open' returning id loop
  insert into public.audit_events(actor_id,action,resource_id,details) values(
   coalesce(auth.uid(),(substitution->>'target_user_id')::uuid),'replacement.superseded_by_directed_handover',closed.id,
   jsonb_build_object('substitution_id',substitution->>'id','original_claim_id',substitution->>'original_claim_id',
    'replacement_claim_id',substitution->>'accepted_claim_id','basis','accepted_directed_handover',
    'migration_reconciliation',auth.uid() is null));
 end loop;
end;$$;

-- Only the private directed workflow can produce the accepted transition.
-- Failed or rolled-back handovers also roll back reconciliation and its audit.
create function private.reconcile_directed_marketplace_offer_trigger() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.status='accepted' and old.status is distinct from new.status then
  perform private.reconcile_directed_marketplace_offer(new.id);
 end if;
 return new;
end;$$;
do $$
begin
 if to_regclass('private.job_substitutions') is not null then
  execute 'create trigger reconcile_directed_marketplace_offer after update of status on private.job_substitutions for each row execute function private.reconcile_directed_marketplace_offer_trigger()';
 end if;
end;$$;
revoke all on function private.reconcile_directed_marketplace_offer(uuid),private.reconcile_directed_marketplace_offer_trigger() from public,anon,authenticated,service_role;

-- Repair pre-integration accepted directed handovers without replaying messages
-- or inventing historical timestamps. Required audit attribution uses the real
-- accepted decision's lecturer; migration_reconciliation explicitly identifies
-- the later database repair, without impersonating that actor's JWT/session.
do $$
declare accepted record;
begin
 if to_regclass('private.job_substitutions') is null then return;end if;
 for accepted in execute 'select s.id from private.job_substitutions s where s.status=''accepted''
  and exists(select 1 from private.replacement_offers o where o.original_claim_id=s.original_claim_id and o.status=''open'')
  order by s.job_id,s.original_claim_id,s.id' loop
  perform private.reconcile_directed_marketplace_offer(accepted.id);
 end loop;
end;$$;

-- Inbox integration changes no email/push preferences, allowlists or queues.
commit;
