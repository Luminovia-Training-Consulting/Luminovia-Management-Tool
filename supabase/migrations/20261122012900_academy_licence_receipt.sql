begin;

-- Administrative usage reflects the local verified terms and allocator
-- accounting in one snapshot. The public capability view stays unchanged.
create function private.academy_licence_receipt()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  current_state text := private.academy_course_access_status();
  receipt jsonb;
begin
  if not coalesce(current_state in ('active', 'grace'), false)
     or not private.academy_local_admin(auth.uid()) then
    raise insufficient_privilege;
  end if;

  select jsonb_build_object(
    'state', current_state,
    'issued_at', licence.issued_at,
    'starts_at', licence.starts_at,
    'expires_at', licence.expires_at,
    'grace_until', licence.grace_until,
    'seats', jsonb_build_object(
      'limit', seats.seat_limit,
      'occupied', seats.occupied,
      'available', greatest(seats.seat_limit - seats.occupied, 0)
    ),
    'storage', jsonb_build_object(
      'limit_bytes', limits.storage_bytes,
      'used_bytes', storage.used_bytes,
      'available_bytes', greatest(limits.storage_bytes - storage.used_bytes, 0)
    ),
    'api_requests_per_minute', limits.api_requests_per_minute
  ) into strict receipt
  from private.installation_identity identity
  join private.installation_verified_licence licence using (installation_id)
  cross join private.academy_seat_usage() seats
  cross join lateral (
    select (licence.terms #>> '{limits,storage_bytes}')::bigint as storage_bytes,
           (licence.terms #>> '{limits,api_requests_per_minute}')::bigint as api_requests_per_minute
  ) limits
  cross join (select coalesce(sum(size_bytes), 0) as used_bytes from public.document_versions) storage
  where identity.singleton;
  return receipt;
end;
$$;

create function public.academy_licence_receipt()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.academy_licence_receipt();
$$;

revoke all on function private.academy_licence_receipt(), public.academy_licence_receipt()
  from public, anon, authenticated, service_role;
grant execute on function private.academy_licence_receipt(), public.academy_licence_receipt()
  to authenticated;

do $$
declare
  definition text := pg_catalog.pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  anchor constant text := '  licence_status := private.academy_course_access_status();';
begin
  if cardinality(string_to_array(definition, anchor)) <> 2 then
    raise exception 'Expected one academy licence read gate';
  end if;
  execute replace(definition, anchor, anchor || chr(10) ||
    '  if licence_status in (''active'', ''grace'') and request_method = ''POST''' || chr(10) ||
    '     and request_path = ''/rpc/academy_licence_receipt'' then return; end if;');
end;
$$;

notify pgrst, 'reload schema';
commit;
