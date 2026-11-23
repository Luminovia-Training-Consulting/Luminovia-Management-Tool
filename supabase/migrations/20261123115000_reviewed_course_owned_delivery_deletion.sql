begin;

alter function private.deletion_scope(text, uuid)
  rename to deletion_scope_before_owned_course_delivery;

-- Merge explicitly owned delivery records into the reviewed plan. The existing
-- snapshot still reports references from outside the plan as blockers.
create function private.deletion_scope(p_kind text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  scope jsonb := private.deletion_scope_before_owned_course_delivery(p_kind, p_id);
  child record;
  claim_ids uuid[];
  room_ids uuid[];
  job_ids uuid[];
begin
  if p_kind <> 'course_run'
     or (select edition from private.installation_identity) is distinct from 'internal'
     or exists (select 1 from private.course_evaluations where run_id = p_id)
     or exists (select 1 from private.course_exam_results where run_id = p_id)
  then
    return scope;
  end if;

  select array_agg(id order by id) into job_ids
    from public.jobs where course_run_id = p_id;
  select array_agg(id order by id) into claim_ids
    from public.job_claims where job_id = any(job_ids);

  select array_agg(room.id order by room.id) into room_ids
    from public.chat_rooms room
    where (room.kind = 'lecturer_course' and room.job_id = any(job_ids)
      and (room.course_run_id is null or room.course_run_id = p_id))
      or (room.kind = 'participant_course' and room.course_run_id = p_id
      and room.job_id is null);

  if private.deletion_selector(scope, 'public.course_sessions') is null then
    scope := private.deletion_add_scope(scope, 'public.course_sessions',
      format('x.course_run_id=%L::uuid', p_id));
  end if;

  for child in
    select 'job' kind, job.id
    from public.jobs job where job.id = any(job_ids)
      and private.deletion_selector(scope, 'public.jobs') is null
    union all
    select 'assignment', claim.id
    from public.job_claims claim where claim.id = any(claim_ids)
    union all
    select 'chat_room', room.id
    from public.chat_rooms room
    where room.id = any(room_ids)
    union all
    select 'document', document.id from public.documents document
    where (document.scope in ('job_before', 'job_after') and document.job_id = any(job_ids) and document.room_id is null)
      or (document.scope = 'room' and document.room_id = any(room_ids) and document.job_id is null)
    union all
    select 'resource_comment', comment.id
    from private.resource_comments comment where comment.job_id = any(job_ids)
    order by kind, id
  loop
    scope := scope || private.deletion_scope_before_owned_course_delivery(child.kind, child.id);
  end loop;

  if job_ids is not null then
    scope := private.deletion_add_scope(scope, 'private.job_dispatch',
      format('x.job_id=any(%L::uuid[])', job_ids));
  end if;

  if claim_ids is not null then
    -- Derived offer amounts and decisions are owned by the assignment.
    -- Invoices, settlements and contracts are separate protected records.
    scope := private.deletion_add_scope(scope, 'private.claim_revenue_ledger',
      format('x.claim_id=any(%L::uuid[]) and x.job_id=any(%L::uuid[])', claim_ids, job_ids));
    scope := private.deletion_add_scope(scope, 'private.company_lecturer_decisions',
      format('x.claim_id=any(%L::uuid[])', claim_ids));
  end if;

  return (
    select jsonb_agg(jsonb_build_object('table', relation, 'predicate', predicate) order by first_position)
    from (
      select entry->>'table' relation,
        string_agg('(' || (entry->>'predicate') || ')', ' or ' order by position) predicate,
        min(position) first_position
      from jsonb_array_elements(scope) with ordinality item(entry, position)
      group by entry->>'table'
    ) grouped
  );
end;
$$;

revoke all on function private.deletion_scope_before_owned_course_delivery(text, uuid),
  private.deletion_scope(text, uuid) from public, anon, authenticated, service_role;

commit;
