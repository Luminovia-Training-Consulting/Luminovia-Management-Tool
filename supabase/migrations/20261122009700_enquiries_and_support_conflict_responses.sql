begin;

-- These version conflicts require a new client read. Leave actual transaction
-- serialization and the existing idempotency and budget errors unchanged.
do $$
declare
  target record;
  definition text;
  previous_error text;
  conflict_error text;
begin
  for target in
    select * from (values
      ('private.manage_enquiry(uuid,text,jsonb,integer,uuid)'::regprocedure,
       'Enquiry changed; reload'),
      ('private.update_support_ticket(uuid,text,jsonb,integer,uuid)'::regprocedure,
       'Support ticket changed; reload')
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
