begin;

-- A previously authorized whole-block command cannot take over a day that
-- has already become its own offer. Keep command receipts and closed history.
do $migration$
declare
  source text;
  patch record;
  guard constant text := $guard$
 if exists (select 1 from private.emergency_assignment_days where source_claim_id = c.id) then
  raise exception 'emergency_whole_block_unavailable' using errcode = '22023';
 end if;$guard$;
begin
  for patch in select * from (values
    ('private.cancel_job_assignment_before_chat_origins(uuid,text,uuid)',
     'if c.status<>''confirmed'' then raise exception ''Assignment is already cancelled'' using errcode=''22023'';end if;'),
    ('private.request_replacement(uuid,text,text,uuid[],boolean,uuid)',
     'select * into c from public.job_claims where id=p_claim_id for update;'),
    ('private.request_assignment_withdrawal(uuid,text,uuid)',
     'select * into c from public.job_claims where id=c.id for update;')
  ) as changes(signature, anchor) loop
    select pg_get_functiondef(patch.signature::regprocedure) into source;
    if cardinality(string_to_array(source, patch.anchor)) <> 2 then
      raise exception 'Unexpected whole-block implementation: %', patch.signature;
    end if;
    execute replace(source, patch.anchor, patch.anchor || guard);
  end loop;

  select pg_get_functiondef('private.replacement_eligible(uuid,uuid)'::regprocedure) into source;
  if cardinality(string_to_array(source, 'select private.marketplace_eligibility_before_company_rejection_guard(p_offer,p_user)')) <> 2 then
    raise exception 'Unexpected replacement eligibility implementation';
  end if;
  execute replace(source,
    'select private.marketplace_eligibility_before_company_rejection_guard(p_offer,p_user)',
    $replacement$select private.marketplace_eligibility_before_company_rejection_guard(p_offer,p_user)
  and not exists (
    select 1 from private.replacement_offers offer
    join private.emergency_assignment_days emergency on emergency.source_claim_id = offer.original_claim_id
    where offer.id = p_offer
  )$replacement$);

  select pg_get_functiondef('private.manage_job_offer(uuid,text,integer,uuid,jsonb)'::regprocedure) into source;
  if cardinality(string_to_array(source, 'if p_action=''reopen'' then' || chr(10) || '   if (select count(*)')) <> 2 then
    raise exception 'Unexpected audited reopening implementation';
  end if;
  execute replace(source, 'if p_action=''reopen'' then' || chr(10) || '   if (select count(*)', $reopen$if p_action='reopen' then
   if j.capacity = 1 and j.status = 'archived' and exists (
     select 1 from public.job_claims claim
     join private.emergency_assignment_days emergency on emergency.source_claim_id = claim.id
     where claim.job_id = j.id and claim.status = 'cancelled'
   ) then raise exception 'emergency_whole_block_unavailable' using errcode = '22023'; end if;
   if (select count(*)$reopen$);

  select pg_get_functiondef('private.assignment_withdrawals(uuid)'::regprocedure) into source;
  if cardinality(string_to_array(source, 'and private.lecturer_actor()')) <> 2 then
    raise exception 'Unexpected withdrawal projection implementation';
  end if;
  execute replace(source, 'and private.lecturer_actor()', $projection$and private.lecturer_actor()
   and not exists (select 1 from private.emergency_assignment_days emergency where emergency.source_claim_id = c.id)$projection$);
end;
$migration$;

-- The emergency command has the source job and claim locks before the insert.
-- Retire pending commands in that same transaction, preserving their receipts.
create function private.retire_emergency_legacy_handover(p_claim_id uuid)
returns void language sql security definer set search_path = '' as $$
  update private.replacement_offers set status = 'cancelled', version = version + 1
  where original_claim_id = p_claim_id and status = 'open';
  update private.job_substitutions set status = 'superseded', resolved_at = clock_timestamp()
  where original_claim_id = p_claim_id and status = 'pending';
  update private.assignment_withdrawals set status = 'superseded', resolved_at = clock_timestamp()
  where claim_id = p_claim_id and status = 'pending';
$$;

create function private.retire_new_emergency_legacy_handover()
returns trigger language plpgsql set search_path = '' as $$
begin
  perform private.retire_emergency_legacy_handover(new.source_claim_id);
  return new;
end;
$$;
revoke all on function private.retire_emergency_legacy_handover(uuid),
  private.retire_new_emergency_legacy_handover() from public, anon, authenticated, service_role;

create trigger retire_emergency_legacy_handover after insert on private.emergency_assignment_days
for each row execute function private.retire_new_emergency_legacy_handover();

-- Reconcile commands written between this migration and the initial rollout.
do $backfill$
declare
  claim_id uuid;
begin
  for claim_id in select distinct source_claim_id from private.emergency_assignment_days order by source_claim_id loop
    perform private.retire_emergency_legacy_handover(claim_id);
  end loop;
end;
$backfill$;

-- Company links normally come from the inherited course run or pricing. A
-- request can also be the only link in retained data. Follow that private
-- ancestry without exposing or duplicating the customer's request.
create or replace function private.job_lecturer_blocked(p_job_id uuid, p_lecturer_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select case when exists (
    select 1 from private.company_lecturer_blocks restriction
    where restriction.lecturer_id = p_lecturer_id and restriction.blocked
  ) then exists (
    with recursive ancestry(job_id) as (
      select p_job_id
      union
      select claim.job_id from ancestry
      join private.emergency_assignment_days emergency on emergency.job_id = ancestry.job_id
      join public.job_claims claim on claim.id = emergency.source_claim_id
    )
    select 1 from public.jobs job where job.id = p_job_id
      and private.course_lecturer_blocked(job.course_run_id, p_lecturer_id)
    union all
    select 1 from private.job_commission_offers offer where offer.job_id = p_job_id
      and private.company_lecturer_blocked(offer.organisation_id, p_lecturer_id)
    union all
    select 1 from ancestry
    join private.client_course_requests request on request.job_id = ancestry.job_id
    where private.company_lecturer_blocked(request.organisation_id, p_lecturer_id)
  ) else false end;
$$;

commit;
