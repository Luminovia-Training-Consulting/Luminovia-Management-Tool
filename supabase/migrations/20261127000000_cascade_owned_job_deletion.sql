begin;

alter function private.deletion_scope(text, uuid)
  rename to deletion_scope_before_owned_job_delivery;

-- A standalone job deletion includes its operational records. Compose the
-- registered child scopes so preview, revalidation, fences and storage cleanup
-- use the same graph. The course, general contracts and financial evidence are
-- independent roots. Company users retain their existing, narrower scope.
create function private.deletion_scope(p_kind text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  scope jsonb := private.deletion_scope_before_owned_job_delivery(p_kind, p_id);
  child record;
  child_scope jsonb;
  claim_ids uuid[];
  room_ids uuid[];
  session_ids uuid[];
  message_ids uuid[];
  withdrawal_ids uuid[];
  substitution_ids uuid[];
  replacement_ids uuid[];
  notice_selector text;
begin
  if p_kind <> 'job' then
    return scope;
  end if;

  scope := private.deletion_add_scope(scope, 'private.course_offer_mail_publications',
    format('x.job_id=%L::uuid', p_id));
  notice_selector := format('x.kind=''course_offer_published'' and x.resource_id=%L::uuid', p_id);

  if private.deletion_admin(auth.uid()) then
    select coalesce(array_agg(claim.id order by claim.id), array[]::uuid[]) into claim_ids
    from public.job_claims claim where claim.job_id = p_id;

    select coalesce(array_agg(room.id order by room.id), array[]::uuid[]) into room_ids
    from public.chat_rooms room join public.jobs job on job.id = room.job_id
    where job.id = p_id and room.kind = 'lecturer_course'
      and (room.course_run_id is null or room.course_run_id = job.course_run_id);

    select coalesce(array_agg(id order by id), array[]::uuid[]) into session_ids
    from public.assignment_sessions where claim_id = any(claim_ids);
    select coalesce(array_agg(id order by id), array[]::uuid[]) into message_ids
    from public.messages where room_id = any(room_ids);

    for child in
      select 'assignment' kind, id from unnest(claim_ids) as claim(id)
      union all
      select 'chat_room', id from unnest(room_ids) as room(id)
      union all
      select 'document', document.id from public.documents document
      where (document.scope in ('job_before', 'job_after') and document.job_id = p_id and document.room_id is null)
        or (document.scope = 'room' and document.room_id = any(room_ids) and document.job_id is null)
      union all
      select 'resource_comment', comment.id from private.resource_comments comment
      where comment.job_id = p_id
      order by kind, id
    loop
      child_scope := private.deletion_scope_before_owned_job_delivery(child.kind, child.id);
      -- The merged inbox selectors below survive removal of the source
      -- sessions/messages. Avatar references to job files remain shared.
      scope := scope || coalesce((
        select jsonb_agg(entry order by position)
        from jsonb_array_elements(child_scope) with ordinality item(entry, position)
        where entry->>'table' not in (
          'public.notifications', 'private.notification_email_outbox',
          'private.notification_push_outbox', 'public.profile_avatars'
        )
      ), '[]'::jsonb);
    end loop;

    -- A replacement linked to an assignment of a different job is shared.
    -- Let the existing inbound-reference check report that relationship.
    select coalesce(array_agg(id order by id), array[]::uuid[]) into withdrawal_ids
    from private.assignment_withdrawals where claim_id = any(claim_ids);
    select coalesce(array_agg(id order by id), array[]::uuid[]) into substitution_ids
    from private.job_substitutions where job_id = p_id and original_claim_id = any(claim_ids)
      and (accepted_claim_id is null or accepted_claim_id = any(claim_ids));
    select coalesce(array_agg(id order by id), array[]::uuid[]) into replacement_ids
    from private.replacement_offers where original_claim_id = any(claim_ids)
      and (replacement_claim_id is null or replacement_claim_id = any(claim_ids));

    scope := scope || jsonb_build_array(
      jsonb_build_object('table', 'private.claim_revenue_ledger', 'predicate',
        format('x.job_id=%L::uuid and x.claim_id=any(%L::uuid[])', p_id, claim_ids)),
      jsonb_build_object('table', 'private.company_lecturer_decisions', 'predicate',
        format('x.claim_id=any(%L::uuid[])', claim_ids)),
      jsonb_build_object('table', 'private.emergency_assignment_days', 'predicate',
        format('x.job_id=%L::uuid', p_id)),
      jsonb_build_object('table', 'private.assignment_withdrawals', 'predicate',
        format('x.id=any(%L::uuid[])', withdrawal_ids)),
      jsonb_build_object('table', 'private.assignment_withdrawal_commands', 'predicate',
        format('x.withdrawal_id=any(%L::uuid[])', withdrawal_ids)),
      jsonb_build_object('table', 'private.job_substitutions', 'predicate',
        format('x.id=any(%L::uuid[])', substitution_ids)),
      jsonb_build_object('table', 'private.replacement_offers', 'predicate',
        format('x.id=any(%L::uuid[])', replacement_ids)),
      jsonb_build_object('table', 'private.replacement_requests', 'predicate',
        format('x.result->>''id''=any(%L::text[]) or x.payload->>''offer''=any(%L::text[])',
          replacement_ids, replacement_ids))
    );

    -- Inbox rows have typed resource IDs but no foreign key to their sources.
    notice_selector := notice_selector || format(
      ' or (x.kind=''chat_message'' and x.resource_id=any(%L::uuid[]))
        or (x.kind in (''claim_confirmed'', ''claim_cancelled'') and x.resource_id=any(%L::uuid[]))
        or (x.kind=''session_reminder'' and x.resource_id=any(%L::uuid[]))
        or (x.kind in (''assignment_withdrawal_requested'', ''assignment_withdrawal_withdrawn'', ''assignment_withdrawal_approved'', ''assignment_withdrawal_rejected'')
          and x.resource_id=any(%L::uuid[]))
        or (x.kind in (''substitution_proposed'', ''substitution_closed'') and x.resource_id=any(%L::uuid[]))
        or (x.kind in (''replacement_available'', ''replacement_completed'') and x.resource_id=any(%L::uuid[]))',
      message_ids, claim_ids, session_ids, withdrawal_ids, substitution_ids, replacement_ids);
  end if;

  scope := private.deletion_add_scope(scope, 'public.notifications', notice_selector);
  scope := private.deletion_add_scope(scope, 'private.notification_email_outbox',
    format('x.notification_id in(select notice.id from public.notifications notice where %s)',
      replace(notice_selector, 'x.', 'notice.')));
  scope := private.deletion_add_scope(scope, 'private.notification_push_outbox',
    format('x.notification_id in(select notice.id from public.notifications notice where %s)',
      replace(notice_selector, 'x.', 'notice.')));

  -- The original scope and its children can both include a relation, such as
  -- notifications. Combine selectors before counting or deleting any rows.
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

revoke all on function private.deletion_scope_before_owned_job_delivery(text, uuid),
  private.deletion_scope(text, uuid) from public, anon, authenticated, service_role;

-- Later tables need the same post-confirmation write fence as the original
-- deletion graph. This also blocks new rows that reference a fenced parent.
create trigger permanent_deletion_fence before insert or update or delete on private.company_lecturer_decisions
  for each row execute function private.guard_permanent_deletion();
create trigger permanent_deletion_fence before insert or update or delete on private.emergency_assignment_days
  for each row execute function private.guard_permanent_deletion();
create trigger permanent_deletion_fence before insert or update or delete on private.course_offer_mail_publications
  for each row execute function private.guard_permanent_deletion();

commit;
