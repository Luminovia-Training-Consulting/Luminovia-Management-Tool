begin;

-- Keep the existing create/update signature and the separately audited Premium
-- decision. The combined operation returns the original ID on a safe retry.
create function private.save_organisation_with_premium(p_payload jsonb, p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  organisation_id uuid;
  previous_command private.company_premium_commands%rowtype;
  command_result jsonb;
begin
  if not private.is_company_premium_admin() or not private.has_permission('organisations.manage') then
    raise exception 'Active admin with organisations.manage required' using errcode = '42501';
  end if;
  if p_request_id is null or coalesce((p_payload->>'archived')::boolean, false) then
    raise exception 'Valid request to create an active organisation required' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('organisation-create-premium:' || auth.uid()::text || ':' || p_request_id::text, 0)
  );
  select command.* into previous_command
  from private.company_premium_commands command
  where command.actor_id = auth.uid() and command.request_id = p_request_id;
  if found then
    if previous_command.result->>'organisation_created' is distinct from 'true' then
      raise exception 'Premium request ID conflict' using errcode = '22023';
    end if;
    return previous_command.organisation_id;
  end if;

  organisation_id := private.save_organisation(null, p_payload);
  command_result := private.set_company_premium(organisation_id, true, 0, p_request_id);
  if command_result->>'status' is distinct from 'updated' then
    raise exception 'Could not enable Premium for the new organisation' using errcode = '22023';
  end if;
  update private.company_premium_commands command
  set result = command_result || '{"organisation_created":true}'::jsonb
  where command.actor_id = auth.uid() and command.request_id = p_request_id;
  return organisation_id;
end;
$$;
revoke all on function private.save_organisation_with_premium(jsonb, uuid) from public, anon, authenticated, service_role;
grant execute on function private.save_organisation_with_premium(jsonb, uuid) to authenticated;

create or replace function public.save_organisation(p_id uuid, p_payload jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_payload ? 'premium_request_id' then
    if p_id is not null then
      raise exception 'Existing organisations use the Premium settings command' using errcode = '22023';
    end if;
    return private.save_organisation_with_premium(p_payload - 'premium_request_id', (p_payload->>'premium_request_id')::uuid);
  end if;
  return private.save_organisation(p_id, p_payload);
end;
$$;

commit;
