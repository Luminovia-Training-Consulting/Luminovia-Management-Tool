begin;

alter table private.assignment_change_requests
  add column requires_coordination boolean not null default false;

-- A customer drafts and submits one request for the shared course. Until
-- management coordinates it, no lecturer sees the draft or receives a request.
create function private.assignment_change_pending_coordination(p_request private.assignment_change_requests)
returns boolean language sql immutable set search_path = '' as $$
  select p_request.requires_coordination and p_request.shared_schedule_group_id is null;
$$;

create function private.assignment_change_row_visible(p_request private.assignment_change_requests)
returns boolean language sql stable set search_path = '' as $$
  select private.assignment_change_access(p_request.claim_id)
    and (p_request.requester_id = auth.uid() or (
      private.assignment_change_staff_access(p_request.claim_id)
      and (not private.assignment_change_pending_coordination(p_request)
        or (p_request.status <> 'draft' and private.has_permission('jobs.manage')))
    ));
$$;

-- A coordinated schedule can also contain one explicit assignment-specific
-- addendum. Changing active or completed work must use the accounting and
-- evidence correction workflows; it cannot reprice past delivery.
create function private.shared_commercial_window(
  p_source jsonb, p_checked_at timestamptz default statement_timestamp()
)
returns boolean language sql stable set search_path = '' as $$
  select (p_source->'sessions'->0->>'starts_at')::timestamptz > p_checked_at
    and not exists (
      select 1 from public.assignment_sessions session
      where session.claim_id = (p_source->>'claim_id')::uuid
        and (exists (select 1 from private.delivery_records delivery where delivery.session_id = session.id)
          or exists (select 1 from private.teaching_timesheets timesheet where timesheet.session_id = session.id))
    );
$$;

create function private.shared_commercial_changed(p_original jsonb, p_proposed jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select private.assignment_change_price_changed(p_original, p_proposed)
    or p_original->'terms' is distinct from p_proposed->'terms';
$$;

create function private.shared_group_finance_authority(p_group uuid)
returns boolean language sql stable set search_path = '' as $$
  select not exists (
    select 1 from private.assignment_change_requests member
    where member.shared_schedule_group_id = p_group
      and private.assignment_change_price_changed(member.original, member.proposed)
      and not private.assignment_change_money_authority(member.claim_id)
  );
$$;

revoke all on function private.assignment_change_pending_coordination(private.assignment_change_requests),
  private.assignment_change_row_visible(private.assignment_change_requests),
  private.shared_commercial_window(jsonb,timestamptz), private.shared_commercial_changed(jsonb,jsonb),
  private.shared_group_finance_authority(uuid)
from public, anon, authenticated, service_role;

do $migration$
declare
  patch record;
  definition text;
begin
  for patch in select * from (values
    ('private.validate_shared_schedule_only(uuid,jsonb)'::regprocedure,
      $old$p_proposed-'sessions' is distinct from private.assignment_change_normalize(current_source, '{}'::jsonb)-'sessions'$old$,
      $new$(p_proposed - array['sessions','terms','amount','total_amount'])
      is distinct from (private.assignment_change_normalize(current_source, '{}'::jsonb)
        - array['sessions','terms','amount','total_amount'])$new$),
    ('private.validate_shared_schedule_only(uuid,jsonb)'::regprocedure,
      $old$    raise exception 'Shared amendments can only change the schedule' using errcode = '22023';
  end if;$old$,
      $new$    raise exception 'A changed schedule and the original course scope, currency and rate unit are required'
      using errcode = '22023';
  end if;
  if private.shared_commercial_changed(current_source, p_proposed) and (
    not private.shared_commercial_window(current_source, clock_timestamp())
    or private.shared_schedule_quantity(original_schedule, current_source->>'time_zone', current_source->>'rate_unit')
      is distinct from private.shared_schedule_quantity(target_schedule, current_source->>'time_zone', current_source->>'rate_unit')
  ) then
    raise exception 'Shared commercial terms require future delivery and the agreed billable quantity'
      using errcode = 'PT422';
  end if;$new$),
    ('private.save_assignment_change(uuid,uuid,jsonb,integer,uuid)'::regprocedure,
      $old$v_reason text;customer boolean;$old$,
      $new$v_reason text;customer boolean;shared boolean;$new$),
    ('private.save_assignment_change(uuid,uuid,jsonb,integer,uuid)'::regprocedure,
      $old$ if private.course_schedule_requires_group((source->>'course_run_id')::uuid)
     and not private.has_permission('jobs.manage') then
  raise exception 'Management must propose a shared schedule' using errcode = '42501';
 end if;
 perform private.assignment_change_validate(p_claim_id,proposal);$old$,
      $new$ shared := private.course_schedule_requires_group((source->>'course_run_id')::uuid);
 if shared and customer then
  if (p_payload->'changes') - 'sessions' <> '{}'::jsonb then
   raise exception 'Customers may propose only dates for a shared course' using errcode = '42501';
  end if;
  -- Management verifies staff commitments during coordination. Customer
  -- draft validation must not reveal which time windows a lecturer is free.
  perform private.validate_shared_schedule_only(p_claim_id, proposal);
 elsif shared and not private.has_permission('jobs.manage') then
  raise exception 'Management must propose a shared schedule' using errcode = '42501';
 else
  perform private.assignment_change_validate(p_claim_id, proposal);
 end if;$new$),
    ('private.save_assignment_change(uuid,uuid,jsonb,integer,uuid)'::regprocedure,
      $old$source_hash,requested_by_customer)values(p_claim_id,auth.uid(),(source->>'lecturer_id')::uuid,v_reason,source,proposal,md5(source::text),customer)$old$,
      $new$source_hash,requested_by_customer,requires_coordination)
   values(p_claim_id,auth.uid(),(source->>'lecturer_id')::uuid,v_reason,source,proposal,md5(source::text),customer,customer and shared)$new$),
    ('private.save_assignment_change(uuid,uuid,jsonb,integer,uuid)'::regprocedure,
      $old$set reason=v_reason,proposed=proposal,version=version+1,updated_at=clock_timestamp()$old$,
      $new$set reason=v_reason,proposed=proposal,requires_coordination=customer and shared,
      version=version+1,updated_at=clock_timestamp()$new$),
    ('private.assignment_change_action(uuid,text,integer,text,uuid)'::regprocedure,
      $old$if not found or not private.assignment_change_access(r.claim_id) then raise exception 'Change request access denied'$old$,
      $new$if not found or not private.assignment_change_row_visible(r) then raise exception 'Change request access denied'$new$),
    ('private.assignment_change_action(uuid,text,integer,text,uuid)'::regprocedure,
      $old$not in('submit','accept','reject','withdraw','apply')$old$,
      $new$not in('submit','coordinate','accept','reject','withdraw','apply')$new$),
    ('private.assignment_change_action(uuid,text,integer,text,uuid)'::regprocedure,
      $old$ -- Even matching apply receipts retain current privileged authority;$old$,
      $new$ if p_action='coordinate' and not private.has_permission('jobs.manage') then
  raise exception 'Management must coordinate a customer request' using errcode='42501';
 end if;
 -- Even matching apply receipts retain current privileged authority;$new$),
    ('private.assignment_change_action(uuid,text,integer,text,uuid)'::regprocedure,
      $old$or (p_action = 'submit' and$old$,
      $new$or private.assignment_change_pending_coordination(r) or (p_action = 'submit' and$new$),
    ('private.assignment_change_action(uuid,text,integer,text,uuid)'::regprocedure,
      $old$   if p_action = 'apply' then
    return private.apply_shared_schedule$old$,
      $new$   if p_action = 'apply' then
    if not private.shared_group_finance_authority(r.shared_schedule_group_id) then
     raise exception 'Current finance authority must apply a coordinated compensation change' using errcode='42501';
    end if;
    return private.apply_shared_schedule$new$),
    ('private.assignment_change_action(uuid,text,integer,text,uuid)'::regprocedure,
      $old$  perform private.assignment_change_validate(r.claim_id,r.proposed);
  if private.shared_linked_schedule_editable((r.original->>'course_run_id')::uuid) then
   perform private.submit_shared_schedule(r);
  end if;
  update private.assignment_change_requests set status='submitted' where id=r.id;
 elsif p_action in('accept','reject') then$old$,
      $new$  if private.assignment_change_pending_coordination(r) then
   if exists (
    select 1 from private.assignment_change_requests pending
    where pending.id <> r.id and pending.requester_id = r.requester_id and pending.status = 'submitted'
      and pending.original->>'course_run_id' = r.original->>'course_run_id'
      and private.assignment_change_pending_coordination(pending)
   ) then
    raise exception 'An own shared course request already awaits coordination' using errcode='PT409';
   end if;
   perform private.validate_shared_schedule_only(r.claim_id,r.proposed);
  else
   perform private.assignment_change_validate(r.claim_id,r.proposed);
   if private.course_schedule_requires_group((r.original->>'course_run_id')::uuid) then
    perform private.submit_shared_schedule(r);
   end if;
  end if;
  update private.assignment_change_requests set status='submitted' where id=r.id;
 elsif p_action='coordinate' then
  if not private.assignment_change_pending_coordination(r) or r.status <> 'submitted' then
   raise exception 'The customer request no longer awaits coordination' using errcode='PT409';
  end if;
  if r.source_hash <> md5(private.assignment_change_source(r.claim_id)::text) then
   raise exception 'Original assignment changed; recreate request' using errcode='40001';
  end if;
  perform private.assignment_change_validate(r.claim_id,r.proposed);
  perform private.submit_shared_schedule(r);
 elsif p_action in('accept','reject') then
  if private.assignment_change_pending_coordination(r) and
    (p_action <> 'reject' or not private.has_permission('jobs.manage')) then
   raise exception 'Management must first coordinate the customer request' using errcode='42501';
  end if;$new$),
    ('private.assignment_change_action(uuid,text,integer,text,uuid)'::regprocedure,
      $old$select r.lecturer_id recipient union select r.requester_id union$old$,
      $new$select r.lecturer_id recipient
    where not private.assignment_change_pending_coordination(r) or p_action='coordinate'
   union select r.requester_id union$new$),
    ('private.assignment_change_projection(uuid)'::regprocedure,
      $old$not found or not private.assignment_change_access(r.claim_id)$old$,
      $new$not found or not private.assignment_change_row_visible(r)$new$),
    ('private.assignment_change_projection(uuid)'::regprocedure,
      $old$  'can_edit',r.status='draft'$old$,
      $new$  'awaiting_coordination',r.status='submitted' and private.assignment_change_pending_coordination(r),
  'can_coordinate',r.status='submitted' and private.assignment_change_pending_coordination(r) and private.has_permission('jobs.manage'),
  'shared_commercial_editable',not customer and private.has_permission('jobs.manage')
    and private.shared_commercial_window(r.original)
    and private.course_schedule_requires_group((r.original->>'course_run_id')::uuid),
  'can_edit',r.status='draft'$new$),
    ('private.assignment_change_projection(uuid)'::regprocedure,
      $old$  'can_respond',not customer and r.status in('submitted','awaiting_response')and$old$,
      $new$  'can_respond',not customer and not private.assignment_change_pending_coordination(r)
    and r.status in('submitted','awaiting_response')and$new$),
    ('private.assignment_change_projection(uuid)'::regprocedure,
      $old$(r.shared_schedule_group_id is null or private.shared_schedule_progress(r.shared_schedule_group_id)->>'state'='ready')and$old$,
      $new$(r.shared_schedule_group_id is null or (private.shared_schedule_progress(r.shared_schedule_group_id)->>'state'='ready'
    and private.shared_group_finance_authority(r.shared_schedule_group_id)))and$new$),
    ('private.assignment_changes(uuid)'::regprocedure,
      $old$from(select * from private.assignment_change_requests where private.assignment_change_access(claim_id)
   and(private.assignment_change_staff_access(claim_id)or requester_id=auth.uid())order by created_at desc,id limit 250)r$old$,
      $new$from(select candidate.* from private.assignment_change_requests candidate
   where private.assignment_change_row_visible(candidate) order by created_at desc,id limit 250)r$new$),
    ('private.changeable_assignments()'::regprocedure,
      $old$'shared_schedule_only',private.shared_linked_schedule_editable(j.course_run_id),$old$,
      $new$'shared_schedule_only',private.shared_linked_schedule_editable(j.course_run_id),
 'shared_commercial_editable',private.has_permission('jobs.manage')
   and private.shared_linked_schedule_editable(j.course_run_id)
   and private.shared_commercial_window(private.assignment_change_source(c.id)),$new$),
    ('private.changeable_assignments()'::regprocedure,
      $old$or (private.has_permission('jobs.manage') and private.shared_linked_schedule_editable(j.course_run_id)))$old$,
      $new$or ((private.has_permission('jobs.manage') or not private.assignment_change_staff_access(c.id))
        and private.shared_linked_schedule_editable(j.course_run_id)))$new$)
  ) patches(signature, previous, replacement)
  loop
    definition := pg_catalog.pg_get_functiondef(patch.signature);
    if cardinality(string_to_array(definition, patch.previous)) <> 2 then
      raise exception 'Unexpected customer/shared change boundary in %: %', patch.signature, patch.previous;
    end if;
    execute replace(definition, patch.previous, patch.replacement);
  end loop;
end;
$migration$;

notify pgrst, 'reload schema';
commit;
