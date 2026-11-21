begin;

-- Project only the existing public capability fields in a closed private
-- routine. Keep the licence documents, dates, limits and account data private.
create function private.installation_capability_projection()
returns table(
  installation_id uuid,
  edition text,
  licence_status text,
  customer_ready boolean,
  lms_available boolean,
  marketplace_available boolean,
  company_premium_switch_available boolean
)
language sql stable security definer set search_path = ''
as $$
  select identity.installation_id, identity.edition,
    case
      when identity.edition = 'internal' then 'not-required'
      when licence.installation_id is null then 'unlicensed'
      when statement_timestamp() < licence.starts_at then 'scheduled'
      when statement_timestamp() < licence.expires_at then 'active'
      when statement_timestamp() < licence.grace_until then 'grace'
      else 'expired'
    end,
    false,
    identity.edition = 'internal',
    identity.edition = 'internal',
    identity.edition = 'internal'
  from private.installation_identity identity
  left join private.installation_verified_licence licence using (installation_id);
$$;
revoke all on function private.installation_capability_projection()
  from public, anon, authenticated, service_role;
grant execute on function private.installation_capability_projection()
  to anon, authenticated, service_role;

-- Preserve the projection's columns and grants for existing pre-request and
-- browser capability callers. The exposed view itself uses invoker rights.
create or replace view public.installation_capability_state
with (security_barrier = true, security_invoker = true) as
select installation_id, edition, licence_status, customer_ready, lms_available,
       marketplace_available, company_premium_switch_available
from private.installation_capability_projection();

notify pgrst, 'reload schema';
commit;
