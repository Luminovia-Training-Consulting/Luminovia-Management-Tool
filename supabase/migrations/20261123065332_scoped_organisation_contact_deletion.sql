begin;

-- Let the same permission that maintains organisation contacts request their
-- reviewed removal. Full organisation deletion retains its existing authority.
do $migration$
declare
  rule record;
  definition text;
begin
  for rule in select * from (values
    ('private.deletion_authorized(text,uuid)',
      $old$ if p_kind='course_run' then$old$,
      $new$ if p_kind='organisation_contact' then
  return private.has_permission('organisations.manage')
    and (select edition from private.installation_identity) = 'internal';
 end if;
 if p_kind='course_run' then$new$),
    ('private.deletion_access()',
      $old$  if private.has_permission('courses.manage')$old$,
      $new$  if private.has_permission('organisations.manage')
     and (select edition from private.installation_identity) = 'internal' then
   kinds=kinds||'"organisation_contact"'::jsonb;
  end if;
  if private.has_permission('courses.manage')$new$),
    ('private.deletion_confirm(uuid,uuid,text)',
      $old$ if plan.kind='course_run' and not private.deletion_admin(auth.uid()) then$old$,
      $new$ if plan.kind in('course_run','organisation_contact') and not private.deletion_admin(auth.uid()) then$new$),
    ('private.deletion_confirm(uuid,uuid,text)',
      $old$  if plan.kind='course_run' then context=jsonb_build_object('permission','courses.manage');$old$,
      $new$  if plan.kind='organisation_contact' then context=jsonb_build_object('permission','organisations.manage');
  elsif plan.kind='course_run' then context=jsonb_build_object('permission','courses.manage');$new$),
    ('private.deletion_operation_authorized(uuid,uuid)',
      $old$ if o.authority='scoped' then$old$,
      $new$ if o.authority='scoped' then
  if o.kind='organisation_contact' and (select edition from private.installation_identity) is distinct from 'internal' then return false;end if;$new$),
    ('private.deletion_label(text,uuid)',
      $old$ when 'organisation' then select name into label from public.organisations where id=p_id;$old$,
      $new$ when 'organisation' then select name into label from public.organisations where id=p_id;
 when 'organisation_contact' then select name into label from public.organisation_contacts where id=p_id;$new$)
  ) as rules(signature, old_text, new_text)
  loop
    definition := pg_get_functiondef(rule.signature::regprocedure);
    if cardinality(string_to_array(definition, rule.old_text)) <> 2 then
      raise exception 'Expected one contact deletion update point in %', rule.signature;
    end if;
    execute replace(definition, rule.old_text, rule.new_text);
  end loop;
end;
$migration$;

commit;
