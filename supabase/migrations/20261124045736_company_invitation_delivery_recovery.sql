begin;

-- Remember an explicitly selected class after its foreign key is cleared by
-- deletion. A corrected invitation may never silently lose that placement.
alter table private.company_participant_invitation_dispatches
  add column delivery_class_bound boolean not null default false;
update private.company_participant_invitation_dispatches
set delivery_class_bound = true where class_id is not null;

-- Existing Academy company invitations retained only the organisation, so an
-- exact course cannot be inferred for them. Record it on every new request.
alter table private.academy_account_requests
  add column delivery_course_bound boolean not null default false,
  add column delivery_course_id uuid references public.course_runs(id) on delete set null;

create function private.company_invitation_retry_scope(
  p_invitation_id uuid, p_organisation_id uuid
) returns boolean language sql stable security invoker set search_path = '' as $$
  select count(*) = 1 and coalesce(bool_and(
    dispatch.status = 'failed' and (not dispatch.delivery_class_bound or dispatch.class_id is not null)
  ), false)
  from private.company_participant_invitation_dispatches dispatch
  where dispatch.invitation_id = p_invitation_id and dispatch.organisation_id = p_organisation_id;
$$;

create function private.reserve_company_invitation_delivery_retry(
  p_invitation_id uuid, p_organisation_id uuid, p_email text, p_name text, p_request_id uuid
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  original private.company_participant_invitation_dispatches%rowtype;
  replacement private.company_participant_invitation_dispatches%rowtype;
  result jsonb;
begin
  perform private.require_internal_company_participant_manager(p_organisation_id);
  perform private.lock_company_premium(p_organisation_id);
  if not private.company_invitation_retry_scope(p_invitation_id, p_organisation_id) then
    raise insufficient_privilege;
  end if;
  select * into strict original from private.company_participant_invitation_dispatches
  where invitation_id = p_invitation_id and organisation_id = p_organisation_id for share;
  perform private.check_participant_class(p_organisation_id, original.class_id);
  perform pg_advisory_xact_lock(hashtextextended('company-participant-invite:' || auth.uid()::text, 0));
  if exists (select 1 from private.company_participant_invitation_dispatches
    where actor_id = auth.uid() and request_id = p_request_id) then
    return jsonb_build_object('status', 'idempotency_conflict');
  end if;

  result := private.reserve_class_participant_invitation(
    p_organisation_id, p_email, p_name, p_request_id, original.class_id);
  select * into replacement from private.company_participant_invitation_dispatches
  where id = (result->>'request_id')::uuid and status = 'pending' and invitation_id is not null;
  if not found then
    return jsonb_build_object('status', 'idempotency_conflict');
  end if;
  return jsonb_build_object('status', 'reserved', 'invitation_id', replacement.invitation_id,
    'dispatch_id', replacement.id);
end;
$$;

create function private.academy_invitation_retry_scope(
  p_company_invitation boolean, p_course_bound boolean, p_course_id uuid, p_organisation_id uuid
) returns boolean language sql stable security invoker set search_path = '' as $$
  select not (p_company_invitation or p_course_bound) or exists (
    select 1 from public.course_runs course
    where course.id = p_course_id and course.organisation_id = p_organisation_id
      and course.archived_at is null
  );
$$;

revoke all on function private.company_invitation_retry_scope(uuid,uuid),
  private.reserve_company_invitation_delivery_retry(uuid,uuid,text,text,uuid),
  private.academy_invitation_retry_scope(boolean,boolean,uuid,uuid)
  from public, anon, authenticated, service_role;

do $migration$
declare
  patch record;
  definition text;
begin
  for patch in select * from (values
    ('private.reserve_company_participant_invitation(uuid,text,text,uuid)'::regprocedure,
      'from public.invitation_requests where email = normalized_email',
      'from public.invitation_requests where email = normalized_email and superseded_at is null'),
    ('private.reserve_class_participant_invitation(uuid,text,text,uuid,uuid)'::regprocedure,
      'set class_id = p_class_id', 'set class_id = p_class_id, delivery_class_bound = (p_class_id is not null)'),
    ('private.reserve_invitation_delivery_retry(uuid,text,uuid)'::regprocedure,
      $old$     or (source.requested_role = 'participant' and source.organisation_id is not null)
     or private.account_authority(actor) <= private.account_role_rank(source.requested_role)
     or (source.organisation_id is not null and not private.has_permission('finance.gross.read')) then$old$,
      $new$     or private.account_authority(actor) <= private.account_role_rank(source.requested_role)
     or (source.requested_role = 'client' and source.organisation_id is not null
       and not private.has_permission('finance.gross.read'))
     or (source.requested_role = 'participant' and source.organisation_id is not null
       and not private.company_invitation_retry_scope(source.id, source.organisation_id)) then$new$),
    ('private.reserve_invitation_delivery_retry(uuid,text,uuid)'::regprocedure,
      $old$    result := private.reserve_account_invitation(destination, source.display_name,
      source.requested_role, source.organisation_id, p_request_id);$old$,
      $new$    if source.requested_role = 'participant' and source.organisation_id is not null then
      result := private.reserve_company_invitation_delivery_retry(source.id, source.organisation_id,
        destination, source.display_name, p_request_id);
    else
      result := private.reserve_account_invitation(destination, source.display_name,
        source.requested_role, source.organisation_id, p_request_id);
    end if;$new$),
    ('private.complete_account_invitation(uuid,uuid,text,boolean)'::regprocedure,
      '    perform private.lock_company_premium(request.organisation_id);',
      $new$    perform private.lock_company_premium(request.organisation_id);
    perform 1 from private.company_participant_invitation_dispatches dispatch
    where dispatch.invitation_id = request.id order by dispatch.id for share;
    if exists (select 1 from private.company_participant_invitation_dispatches dispatch
      where dispatch.invitation_id = request.id and dispatch.delivery_class_bound
        and dispatch.class_id is null) then
      raise insufficient_privilege;
    end if;$new$),
    ('private.reserve_academy_company_invitation(uuid,uuid,text,text,uuid)'::regprocedure,
      '  company_id uuid;', E'  company_id uuid;\n  result jsonb;\n  existing private.academy_account_requests%rowtype;'),
    ('private.reserve_academy_company_invitation(uuid,uuid,text,text,uuid)'::regprocedure,
      $old$  return private.reserve_academy_account_for_actor(p_request_id, p_email, p_display_name, 'participant',
    company_id, 'invite', p_creator, true);$old$,
      $new$  result := private.reserve_academy_account_for_actor(p_request_id, p_email, p_display_name, 'participant',
    company_id, 'invite', p_creator, true);
  select * into existing from private.academy_account_requests where id = (result->>'creation_id')::uuid for update;
  if found and existing.delivery_course_bound and existing.delivery_course_id is distinct from p_course_id then
    raise exception 'Invitation belongs to another course' using errcode = 'PT409';
  end if;
  if result->>'status' = 'reserved' then
    update private.academy_account_requests set delivery_course_bound = true, delivery_course_id = p_course_id
    where id = existing.id;
  end if;
  return result;$new$),
    ('private.academy_reserve_invitation_delivery_retry(uuid,text,uuid)'::regprocedure,
      '     or not source.delivery_rejected or source.user_id is not null or source.company_invitation then',
      $new$     or not source.delivery_rejected or source.user_id is not null
     or not private.academy_invitation_retry_scope(source.company_invitation, source.delivery_course_bound,
       source.delivery_course_id, source.organisation_id) then$new$),
    ('private.academy_reserve_invitation_delivery_retry(uuid,text,uuid)'::regprocedure,
      '  select * into replacement from private.academy_account_requests where retry_of = source.id;',
      $new$  if source.delivery_course_bound then
    perform 1 from public.course_runs where id = source.delivery_course_id
      and organisation_id = source.organisation_id and archived_at is null for share;
    if not found then raise insufficient_privilege; end if;
  end if;
  select * into replacement from private.academy_account_requests where retry_of = source.id;$new$),
    ('private.academy_reserve_invitation_delivery_retry(uuid,text,uuid)'::regprocedure,
      '    update private.academy_account_requests set retry_of = source.id',
      $new$    update private.academy_account_requests set retry_of = source.id,
      delivery_course_bound = source.delivery_course_bound, delivery_course_id = source.delivery_course_id$new$),
    ('private.finish_academy_account(uuid,uuid,text)'::regprocedure,
      '  if request.status = ''created'' then',
      $new$  if p_decision = 'complete' and request.status = 'reserved' and request.delivery_course_bound then
    perform 1 from public.course_runs where id = request.delivery_course_id
      and organisation_id = request.organisation_id and archived_at is null for share;
    if not found then raise insufficient_privilege; end if;
  end if;
  if request.status = 'created' then$new$),
    ('private.mail_delivery_failures()'::regprocedure,
      $old$            and not (invitation.requested_role = 'participant' and invitation.organisation_id is not null)
            and private.account_authority(auth.uid()) > private.account_role_rank(invitation.requested_role)
            and (invitation.organisation_id is null or private.has_permission('finance.gross.read'))$old$,
      $new$            and private.account_authority(auth.uid()) > private.account_role_rank(invitation.requested_role)
            and (invitation.requested_role <> 'client' or invitation.organisation_id is null
              or private.has_permission('finance.gross.read'))
            and (invitation.requested_role <> 'participant' or invitation.organisation_id is null
              or private.company_invitation_retry_scope(invitation.id, invitation.organisation_id))$new$),
    ('private.mail_delivery_failures()'::regprocedure,
      '            and invitation.user_id is null and not invitation.company_invitation',
      $new$            and invitation.user_id is null and private.academy_invitation_retry_scope(invitation.company_invitation,
              invitation.delivery_course_bound, invitation.delivery_course_id, invitation.organisation_id)$new$)
  ) as patches(routine, anchor, replacement) loop
    definition := pg_get_functiondef(patch.routine);
    if cardinality(string_to_array(definition, patch.anchor)) <> 2 then
      raise exception 'Expected exactly one company invitation boundary in %', patch.routine;
    end if;
    execute replace(definition, patch.anchor, patch.replacement);
  end loop;
end;
$migration$;

notify pgrst, 'reload schema';
commit;
