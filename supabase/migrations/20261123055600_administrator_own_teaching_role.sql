begin;

-- Allow an internal administrator or owner to opt into regular teaching
-- while retaining all of their other roles and the existing audited mutation.
do $migration$
declare
  definition text := pg_get_functiondef('private.set_account_roles(uuid,text[])'::regprocedure);
  authority_gate constant text := $old$ if p_user_id=auth.uid() then raise exception 'Self administrative role changes denied' using errcode='42501';end if;
 if not private.account_role_target_manageable(p_user_id) or exists(select 1 from unnest(p_roles) r where not private.account_assignable_role(r,auth.uid())) then raise exception 'Only subordinate accounts and roles may be assigned' using errcode='42501';end if;$old$;
  locked_roles constant text := $old$ select coalesce(array_agg(role order by role),'{}'::text[]) into before_roles from public.user_roles where user_id=p_user_id;$old$;
begin
  if cardinality(string_to_array(definition, authority_gate)) <> 2
    or cardinality(string_to_array(definition, locked_roles)) <> 2 then
    raise exception 'Expected current account role guards';
  end if;
  definition := replace(definition, authority_gate, $new$ if p_user_id is distinct from auth.uid() and (
  not private.account_role_target_manageable(p_user_id)
  or exists(select 1 from unnest(p_roles) r where not private.account_assignable_role(r,auth.uid()))
 ) then raise exception 'Only subordinate accounts and roles may be assigned' using errcode='42501';end if;$new$);
  execute replace(definition, locked_roles, locked_roles || $new$
 if p_user_id=auth.uid() then
  if (select edition from private.installation_identity) is distinct from 'internal'
     or not (before_roles && array['admin','owner'])
     or array_remove(before_roles,'lecturer') is distinct from array_remove(normalized,'lecturer') then
   raise exception 'Self administrative role changes denied' using errcode='42501';
  end if;
  if 'lecturer'=any(before_roles) and not (normalized && array['lecturer','senior_lecturer'])
     and exists (
       select 1 from public.job_claims claim
       join public.assignment_sessions slot on slot.claim_id=claim.id
       where claim.lecturer_id=auth.uid() and claim.status='confirmed'
         and slot.released_at is null and slot.ends_at>clock_timestamp()
     ) then
   raise exception 'Complete or transfer active teaching assignments first' using errcode='22023';
  end if;
 end if;$new$);
end;
$migration$;

commit;
