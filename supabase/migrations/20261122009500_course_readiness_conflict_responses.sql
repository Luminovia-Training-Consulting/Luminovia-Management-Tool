begin;

-- These deterministic precondition failures need a new client read.
-- Preserve genuine database serialization failures and request replay semantics.
do $$
declare
  target record;
  definition text;
  previous_error text;
  conflict_error text;
begin
  for target in
    select * from (values
      ('private.save_readiness_settings(uuid,jsonb,integer,uuid)'::regprocedure,
       'Preparation settings changed; reload'),
      ('private.confirm_course_sessions(uuid,integer,uuid)'::regprocedure,
       'Preparation settings changed; reload'),
      ('private.save_readiness_task(uuid,uuid,jsonb,integer,uuid)'::regprocedure,
       'New task version required'),
      ('private.save_readiness_task(uuid,uuid,jsonb,integer,uuid)'::regprocedure,
       'Preparation task changed; reload'),
      ('private.complete_readiness_task(uuid,boolean,integer,uuid)'::regprocedure,
       'Preparation task changed; reload'),
      ('private.acknowledge_course_instructions(uuid,integer,uuid)'::regprocedure,
       'Instructions changed; reload')
    ) as conflicts(signature, reason)
  loop
    definition := pg_catalog.pg_get_functiondef(target.signature);
    previous_error := format('raise exception %L using errcode=%L', target.reason, '40001');
    conflict_error := format('raise exception %L using errcode=%L', target.reason, 'PT409');
    if cardinality(string_to_array(definition, previous_error)) <> 2 then
      raise exception 'Expected one version conflict in % for %', target.signature, target.reason;
    end if;
    execute replace(definition, previous_error, conflict_error);
  end loop;
end;
$$;

commit;
