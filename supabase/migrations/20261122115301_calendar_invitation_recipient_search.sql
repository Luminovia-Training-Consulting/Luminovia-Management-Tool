begin;

create function private.calendar_invitation_recipients(
  p_event_id uuid, p_event_version integer, p_search text
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare search_term text := lower(btrim(p_search));
begin
  if not private.calendar_invitation_access() or not private.has_permission('courses.manage') then
    raise insufficient_privilege;
  end if;
  if p_search is null or length(p_search) > 120 then raise invalid_parameter_value; end if;
  if not exists (
    select from public.global_events where id = p_event_id and version = p_event_version
      and published and archived_at is null and ends_at > now()
  ) then raise exception 'Calendar publication changed' using errcode = '40001'; end if;
  if length(search_term) < 2 then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(candidate) order by candidate.name, candidate.user_code)
    from (
      select profile.luminovia_user_id as user_code, profile.display_name as name,
        coalesce(receipt.revision, 0) as revision
      from public.profiles profile
      left join private.global_event_invitations receipt on receipt.recipient_id = profile.id
        and receipt.event_id = p_event_id and receipt.event_version = p_event_version
      where profile.active and (receipt.withdrawn is distinct from false)
        and strpos(lower(profile.display_name), search_term) > 0
        and exists (
          select from public.user_roles role where role.user_id = profile.id
            and role.role in ('owner', 'admin', 'management', 'lecturer', 'senior_lecturer', 'client')
        )
      order by profile.display_name, profile.luminovia_user_id limit 25
    ) candidate
  ), '[]'::jsonb);
end;
$$;

create function public.calendar_invitation_recipients(p_event_id uuid, p_event_version integer, p_search text)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.calendar_invitation_recipients(p_event_id, p_event_version, p_search);
$$;
revoke all on function private.calendar_invitation_recipients(uuid,integer,text),
  public.calendar_invitation_recipients(uuid,integer,text) from public, anon, authenticated, service_role;
grant execute on function private.calendar_invitation_recipients(uuid,integer,text),
  public.calendar_invitation_recipients(uuid,integer,text) to authenticated;

do $migration$
declare
  definition text := pg_catalog.pg_get_functiondef('private.calendar_invitations(uuid,integer,timestamptz,uuid)'::regprocedure);
  own_mode constant text := 'if p_event_id is null and p_event_version is null then';
  own_recipient constant text := 'where receipt.recipient_id = auth.uid() and not receipt.withdrawn';
  reply_check constant text := 'where event_id = p_event_id and event_version = p_event_version and recipient_id = auth.uid();';
begin
  if cardinality(string_to_array(definition, own_mode)) <> 2
      or cardinality(string_to_array(definition, own_recipient)) <> 2 then
    raise exception 'Expected one personal calendar invitation query';
  end if;
  definition := replace(definition, own_mode, 'if p_event_version is null then');
  execute replace(definition, own_recipient, own_recipient || $scope$
        and (p_event_id is null or event.id = p_event_id)$scope$);

  definition := pg_catalog.pg_get_functiondef('private.reply_calendar_invitation(uuid,integer,integer,text)'::regprocedure);
  if cardinality(string_to_array(definition, reply_check)) <> 2 then
    raise exception 'Expected one persisted calendar invitation response';
  end if;
  execute replace(definition, reply_check, reply_check || $read$
  update public.notifications set read_at = coalesce(read_at, clock_timestamp())
    where user_id = auth.uid() and kind = 'calendar_invitation' and resource_id = p_event_id;$read$);
end;
$migration$;

create or replace function private.notification_target(p_kind text, p_resource uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when p_kind = 'calendar_invitation' then jsonb_build_object(
    'href', case when private.calendar_invitation_available(p_resource)
      then '/calendar?invitation=' || p_resource::text || '#calendar-invitations' end,
    'title', ''
  ) else private.notification_target_before_calendar_invitation(p_kind, p_resource) end;
$$;

notify pgrst, 'reload schema';
commit;
