begin;

-- Course managers use the same preview, dependency checks and confirmation
-- as administrators, with a live course permission on resumed operations.
do $migration$
declare
  rule record;
  definition text;
begin
  for rule in select * from (values
    ('private.deletion_authorized(text,uuid)',
      $old$ if private.deletion_admin(auth.uid()) then return true;end if;$old$,
      $new$ if private.deletion_admin(auth.uid()) then return true;end if;
 if p_kind='course_run' then
  return private.has_permission('courses.manage')
    and (select edition from private.installation_identity) = 'internal';
 end if;$new$),
    ('private.deletion_access()',
      $old$  if private.has_role(array['client']) then kinds=kinds||'"job"'::jsonb;end if;$old$,
      $new$  if private.has_role(array['client']) then kinds=kinds||'"job"'::jsonb;end if;
  if private.has_permission('courses.manage')
     and (select edition from private.installation_identity) = 'internal' then
   kinds=kinds||'"course_run"'::jsonb;
  end if;$new$),
    ('private.deletion_confirm(uuid,uuid,text)',
      $old$ if mode='scoped' then$old$,
      $new$ if plan.kind='course_run' and not private.deletion_admin(auth.uid()) then
  mode='scoped';
 end if;
 if mode='scoped' then$new$),
    ('private.deletion_confirm(uuid,uuid,text)',
      $old$  if plan.kind='contract' then context=$old$,
      $new$  if plan.kind='course_run' then context=jsonb_build_object('permission','courses.manage');
  elsif plan.kind='contract' then context=$new$)
  ) as rules(signature, old_text, new_text)
  loop
    definition := pg_get_functiondef(rule.signature::regprocedure);
    if cardinality(string_to_array(definition, rule.old_text)) <> 2 then
      raise exception 'Expected one course deletion update point in %', rule.signature;
    end if;
    execute replace(definition, rule.old_text, rule.new_text);
  end loop;
end;
$migration$;

commit;
