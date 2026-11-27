begin;

-- Keep the original settings validation for legacy drafts and validate the
-- optional package separately. Only the validator's local argument is stripped.
do $migration$
declare
  definition text := pg_get_functiondef('private.validate_academy_customer_settings(jsonb)'::regprocedure);
  anchor constant text := 'begin' || chr(10) || '  for field in select * from (values';
begin
  if cardinality(string_to_array(definition, anchor)) <> 2 then
    raise exception 'Expected Academy setup settings validator';
  end if;
  execute replace(definition, anchor, $body$begin
  if p_settings #> '{licence,lms_package}' is not null then
    if jsonb_typeof(p_settings #> '{licence,lms_package}') <> 'string'
       or (p_settings #>> '{licence,lms_package}') not in ('standard', 'premium') then
      return false;
    end if;
    p_settings := p_settings #- '{licence,lms_package}';
  end if;
  for field in select * from (values$body$);
end;
$migration$;

notify pgrst, 'reload schema';
commit;
