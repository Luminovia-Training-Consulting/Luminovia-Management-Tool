begin;

-- The ledgers are RPC-owned and have no direct application-role grants.
-- Keep that boundary if a future migration grants table privileges.
alter table private.calendar_color_preferences enable row level security;
alter table private.company_participant_invitation_dispatches enable row level security;
alter table private.company_participant_link_requests enable row level security;
alter table private.company_participant_membership_commands enable row level security;
alter table private.company_participant_memberships enable row level security;
alter table private.company_premium_audit enable row level security;
alter table private.company_premium_commands enable row level security;
alter table private.company_premium_settings enable row level security;
alter table private.invoice_review_requests enable row level security;
alter table private.mail_configuration_audit enable row level security;
alter table private.mail_connection_tests enable row level security;
alter table private.mail_transport_settings enable row level security;

-- Anonymous and service calls do not require application-role checks.
-- Keep the public pre-request function callable without exposing its private helper.
create or replace function public.require_portal_access()
returns void language plpgsql stable security invoker set search_path = ''
as $$
begin
  if current_setting('role', true) = 'authenticated' then
    perform private.require_portal_access();
  end if;
end;
$$;
revoke execute on function private.require_portal_access() from public, anon, service_role;
revoke all on function private.reserve_company_participant_link(uuid, text, uuid)
from public, anon, authenticated, service_role;
revoke usage on schema private from anon;

commit;
