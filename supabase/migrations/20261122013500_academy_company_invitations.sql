begin;

alter table private.academy_account_requests add column company_invitation boolean not null default false;
alter table private.academy_account_requests drop constraint academy_account_requests_role_check;
alter table private.academy_account_requests drop constraint academy_account_requests_check;
alter table private.academy_account_requests add constraint academy_account_requests_role_check
  check (role in ('lecturer', 'participant', 'management', 'client'));
alter table private.academy_account_requests add constraint academy_account_requests_organisation_scope
  check ((role in ('participant', 'client')) = (organisation_id is not null)
    and (not company_invitation or (role = 'participant' and mode = 'invite')));

create function private.lock_academy_company_inviter(p_actor uuid, p_organisation uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  perform private.lock_academy_course_access();
  perform private.lock_academy_account_seats();
  perform 1 from public.organisations where id = p_organisation and archived_at is null for share;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.profiles where id = p_actor and active for share;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.user_roles where user_id = p_actor and role = 'client' for share;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.client_organisation_memberships
    where user_id = p_actor and organisation_id = p_organisation and removed_at is null for share;
  if not found or not exists (select 1 from auth.users where id = p_actor and email_confirmed_at is not null)
    or exists (select 1 from private.account_password_setup where user_id = p_actor) then
    raise insufficient_privilege;
  end if;
end;
$$;

-- Carry the trusted transport actor into the same durable reservation and seat
-- budget used by the academy directory. Browser RPCs keep their caller only.
do $migration$
declare
  reservation text := pg_get_functiondef('private.reserve_academy_account(uuid,text,text,text,uuid,text)'::regprocedure);
  source text;
  patch record;
  gate text := pg_get_functiondef('public.require_portal_access()'::regprocedure);
  gate_anchor constant text := 'current_setting(''request.path'', true) = ''/rpc/finish_academy_account''';
begin
  for patch in select * from (values
    ('FUNCTION private.reserve_academy_account(', 'FUNCTION private.reserve_academy_account_for_actor('),
    ('p_mode text)', 'p_mode text, p_actor uuid, p_company_invitation boolean)'),
    ('actor uuid := auth.uid();', 'actor uuid := p_actor;'),
    ('  perform private.lock_academy_seat_administration(actor);', $change$  if p_company_invitation then
    if p_role is distinct from 'participant' or p_mode is distinct from 'invite' then raise insufficient_privilege; end if;
    perform private.lock_academy_company_inviter(actor, p_organisation_id);
  else
    perform private.lock_academy_seat_administration(actor);
  end if;$change$),
    ('p_role = ''management'' and not private.academy_local_admin(actor)',
      'p_role in (''management'', ''client'') and not private.academy_local_admin(actor)'),
    ('p_role not in (''lecturer'', ''participant'', ''management'')',
      'p_role not in (''lecturer'', ''participant'', ''management'', ''client'')'),
    ('(p_role = ''participant'') is distinct from', '(p_role in (''participant'', ''client'')) is distinct from'),
    ('previous.organisation_id, previous.mode)', 'previous.organisation_id, previous.mode, previous.company_invitation)'),
    ('p_role, p_organisation_id, p_mode) then', 'p_role, p_organisation_id, p_mode, p_company_invitation) then'),
    ('display_name, role, organisation_id, mode', 'display_name, role, organisation_id, mode, company_invitation'),
    (E'display_value, p_role, p_organisation_id, p_mode\n', E'display_value, p_role, p_organisation_id, p_mode, p_company_invitation\n')
  ) as rewrites(anchor, replacement) loop
    if cardinality(string_to_array(reservation, patch.anchor)) <> 2 then
      raise exception 'Expected one academy reservation anchor: %', patch.anchor;
    end if;
    reservation := replace(reservation, patch.anchor, patch.replacement);
  end loop;
  execute reservation;

  for patch in select * from (values
    ('private.finish_academy_account(uuid,uuid,text)'::regprocedure,
      '    perform private.lock_academy_seat_administration(request.actor_id);', $change$    if request.company_invitation then
      perform private.lock_academy_company_inviter(request.actor_id, request.organisation_id);
    else
      perform private.lock_academy_seat_administration(request.actor_id);
    end if;$change$),
    ('private.finish_academy_account(uuid,uuid,text)'::regprocedure,
      'request.role = ''management'' and not private.academy_local_admin(request.actor_id)',
      'request.role in (''management'', ''client'') and not private.academy_local_admin(request.actor_id)'),
    ('private.finish_academy_account(uuid,uuid,text)'::regprocedure,
      '  if request.role = ''participant'' then', $change$  if request.role = 'client' then
    perform 1 from public.organisations where id = request.organisation_id and archived_at is null for share;
    if not found then raise insufficient_privilege; end if;
    insert into public.client_organisation_memberships(user_id, organisation_id) values (target.id, request.organisation_id);
  elsif request.role = 'participant' then$change$),
    ('private.academy_managed_role(uuid)'::regprocedure,
      '    when array[''participant''] then ''participant''',
      E'    when array[''participant''] then ''participant''\n    when array[''client''] then ''client'''),
    ('private.academy_managed_member(uuid,uuid,boolean,boolean)'::regprocedure,
      '(item.role <> ''management'' or p_admin)', '(item.role not in (''management'', ''client'') or p_admin)'),
    ('private.academy_set_member_active(uuid,boolean,boolean)'::regprocedure,
      '(managed_role = ''management'' and not admin)', '(managed_role in (''management'', ''client'') and not admin)')
  ) as rewrites(routine, anchor, replacement) loop
    source := pg_get_functiondef(patch.routine);
    if cardinality(string_to_array(source, patch.anchor)) - 1 < 1 then
      raise exception 'Expected academy company scope anchor in %', patch.routine;
    end if;
    execute replace(source, patch.anchor, patch.replacement);
  end loop;

  if cardinality(string_to_array(gate, gate_anchor)) <> 2 then
    raise exception 'Expected dedicated service method gate';
  end if;
  execute replace(gate, gate_anchor, 'current_setting(''request.path'', true) in (''/rpc/finish_academy_account'', ''/rpc/reserve_academy_company_invitation'')');
end;
$migration$;

create or replace function private.reserve_academy_account(
  p_request_id uuid, p_email text, p_display_name text, p_role text, p_organisation_id uuid, p_mode text
) returns jsonb language sql security definer set search_path = '' as $$
  select private.reserve_academy_account_for_actor(p_request_id, p_email, p_display_name, p_role,
    p_organisation_id, p_mode, auth.uid(), false);
$$;

create function private.reserve_academy_company_invitation(
  p_creator uuid, p_request_id uuid, p_email text, p_display_name text, p_course_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  company_id uuid;
begin
  select organisation_id into company_id from public.course_runs where id = p_course_id and archived_at is null for share;
  if not found or company_id is null then raise insufficient_privilege; end if;
  return private.reserve_academy_account_for_actor(p_request_id, p_email, p_display_name, 'participant',
    company_id, 'invite', p_creator, true);
exception when sqlstate 'PT409' then
  if exists (select 1 from private.academy_account_requests where actor_id = p_creator and request_id = p_request_id) then
    raise;
  end if;
  return jsonb_build_object('status', 'requested');
end;
$$;

create function public.reserve_academy_company_invitation(
  p_creator uuid, p_request_id uuid, p_email text, p_display_name text, p_course_id uuid
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.reserve_academy_company_invitation(p_creator, p_request_id, p_email, p_display_name, p_course_id);
$$;

revoke all on function private.lock_academy_company_inviter(uuid,uuid),
  private.reserve_academy_account_for_actor(uuid,text,text,text,uuid,text,uuid,boolean),
  private.reserve_academy_company_invitation(uuid,uuid,text,text,uuid),
  public.reserve_academy_company_invitation(uuid,uuid,text,text,uuid) from public, anon, authenticated, service_role;
grant execute on function public.reserve_academy_company_invitation(uuid,uuid,text,text,uuid),
  private.reserve_academy_company_invitation(uuid,uuid,text,text,uuid) to service_role;

notify pgrst, 'reload schema';
commit;
