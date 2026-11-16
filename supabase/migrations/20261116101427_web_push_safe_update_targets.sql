-- Keep service-only Web Push configuration compatible with safe-update hooks.
-- Rotation invalidates only active subscriptions; inactive device history and
-- the original validation, service ACLs and singleton contract are retained.
BEGIN;

create or replace function private.configure_web_push(p_public_key text,p_enabled boolean) returns void
language plpgsql security definer set search_path='' as $$begin
 perform private.require_email_worker();
 if p_enabled is null or p_public_key is null or p_public_key!~'^[A-Za-z0-9_-]{87}$' then raise exception 'Invalid public push key' using errcode='22023';end if;
 if get_byte(decode(translate(p_public_key,'-_','+/')||'=','base64'),0)<>4 then raise exception 'Invalid public push key' using errcode='22023';end if;
 if exists(select 1 from private.push_configuration where public_key is distinct from p_public_key) then update private.push_subscriptions set active=false,updated_at=now() where active;end if;
 update private.push_configuration set public_key=p_public_key,enabled=p_enabled where singleton=true;
end;$$;

COMMIT;
