begin;

-- SMTP may use a provider-specific port. Both supported modes still require
-- TLS and hostname verification at the relay, independently of the port.
alter table private.mail_transport_settings drop constraint mail_smtp_transport_valid;
alter table private.mail_transport_settings add constraint mail_smtp_transport_valid check (
  (smtp_port is null and smtp_security is null) or
  (smtp_port is not null and smtp_port between 1 and 65535
    and smtp_security is not null and smtp_security in ('implicit_tls', 'starttls'))
);

do $migration$
declare
  definition text := pg_catalog.pg_get_functiondef('private.save_mail_configuration(integer,jsonb,jsonb)'::regprocedure);
  old_validation constant text := $old$smtp_port_value is null or smtp_port_value not in (465, 587) or
       (smtp_port_value = 465 and smtp_security_value <> 'implicit_tls') or
       (smtp_port_value = 587 and smtp_security_value <> 'starttls')$old$;
  old_username constant text := $old$smtp_username_value !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}$'$old$;
begin
  if cardinality(string_to_array(definition, old_validation)) <> 2 or
     cardinality(string_to_array(definition, old_username)) <> 2 then
    raise exception 'Expected one SMTP port validation';
  end if;
  definition := replace(definition, old_validation,
    $new$smtp_port_value is null or smtp_port_value not between 1 and 65535 or
       smtp_security_value not in ('implicit_tls', 'starttls')$new$);
  execute replace(definition, old_username,
    $new$smtp_username_value collate "C" ~ '[^ -~]'$new$);
end;
$migration$;

commit;
