begin;

-- These explicit version mismatches require fresh caller data. Preserve actual
-- PostgreSQL serialization failures and the private calendar access checks.
do $$
declare
  target record;
  definition text;
  previous_error text;
  conflict_error text;
begin
  for target in
    select * from (values
      ('private.save_my_calendar_color_preferences(integer,text,text,text)'::regprocedure,
       'Calendar color preference version conflict', ' = ', 2),
      ('private.save_calendar_subscription(uuid,text,boolean,text,integer,uuid)'::regprocedure,
       'Invalid new subscription version', '=', 2),
      ('private.save_calendar_subscription(uuid,text,boolean,text,integer,uuid)'::regprocedure,
       'Subscription changed', '=', 2),
      ('private.revoke_calendar_subscription(uuid,integer)'::regprocedure,
       'Subscription changed', '=', 1)
    ) as conflicts(signature, reason, spacing, occurrences)
  loop
    definition := pg_catalog.pg_get_functiondef(target.signature);
    previous_error := format('raise exception %L using errcode%s%L', target.reason, target.spacing, '40001');
    conflict_error := format('raise exception %L using errcode%s%L', target.reason, target.spacing, 'PT409');
    if cardinality(string_to_array(definition, previous_error)) <> target.occurrences + 1 then
      raise exception 'Unexpected version conflict count in % for %', target.signature, target.reason;
    end if;
    execute replace(definition, previous_error, conflict_error);
  end loop;
end;
$$;

commit;
