begin;

-- These explicit version mismatches require a fresh client read. Report a
-- stable HTTP conflict without intercepting genuine transaction failures.
do $$
declare
  target record;
  definition text;
  previous_error text;
  conflict_error text;
begin
  for target in
    select * from (values
      ('private.save_dashboard_preferences(jsonb,integer)'::regprocedure,
       'Dashboard changed; reload'),
      ('private.save_notification_preferences(jsonb,integer)'::regprocedure,
       'Preferences changed; reload before saving'),
      ('private.save_delivery_preferences(jsonb,integer)'::regprocedure,
       'Delivery preferences changed; reload before saving'),
      ('private.save_contact_visibility_preferences(jsonb,integer)'::regprocedure,
       'Contact visibility changed; reload'),
      ('private.save_welcome_progress(text,text,integer)'::regprocedure,
       'Welcome progress changed; reload current version')
    ) as conflicts(signature, reason)
  loop
    definition := pg_catalog.pg_get_functiondef(target.signature);
    previous_error := format('raise exception %L using errcode=%L', target.reason, '40001');
    conflict_error := format('raise exception %L using errcode=%L', target.reason, 'PT409');
    if cardinality(string_to_array(definition, previous_error)) <> 2 then
      raise exception 'Expected one version conflict in %', target.signature;
    end if;
    execute replace(definition, previous_error, conflict_error);
  end loop;
end;
$$;

commit;
