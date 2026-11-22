begin;

-- When a claim or allocation is released, the same teacher can revise an
-- existing submission only after an independent reviewer reopens that exact
-- submission. It remains impossible to create initial evidence on a release.
create function private.delivery_may_edit(p_session uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select private.lecturer_actor() and exists (
    select 1 from public.assignment_sessions session
    join public.job_claims claim on claim.id = session.claim_id
    left join private.delivery_records record on record.session_id = session.id
    where session.id = p_session and claim.lecturer_id = auth.uid()
      and coalesce(record.status, 'draft') in ('draft','disputed','correction_requested')
      and ((claim.status = 'confirmed' and session.released_at is null) or exists (
        select 1 from private.delivery_events event
        where event.session_id = session.id and event.submission_id = record.latest_submission_id
          and event.action in ('correction_requested','disputed')
      ))
  );
$$;

revoke all on function private.delivery_may_edit(uuid) from public, anon, authenticated, service_role;

do $migration$
declare
  patch record;
  definition text;
begin
  for patch in select * from (values
    ('private.delivery_projection(uuid)'::regprocedure,
      $old$c.lecturer_id=auth.uid() and private.lecturer_actor() and c.status='confirmed' and s.released_at is null and coalesce(d.status,'draft') in('draft','disputed','correction_requested')$old$,
      $new$private.delivery_may_edit(s.id)$new$),
    ('private.delivery_mutate(uuid,integer,text,jsonb,uuid)'::regprocedure,
      $old$p_action in('draft','submit') and (c.lecturer_id<>auth.uid() or not private.lecturer_actor() or c.status<>'confirmed' or s.released_at is not null)$old$,
      $new$p_action in('draft','submit') and (c.lecturer_id<>auth.uid() or not private.lecturer_actor())$new$),
    ('private.delivery_mutate(uuid,integer,text,jsonb,uuid)'::regprocedure,
      $old$ if p_expected_version<>d.version then raise exception 'Delivery changed; reload' using errcode='40001';end if;$old$,
      $new$ if p_expected_version<>d.version then raise exception 'Delivery changed; reload' using errcode='PT409';end if;
 if p_action in ('draft','submit') and not private.delivery_may_edit(s.id) then
  if c.status <> 'confirmed' or s.released_at is not null then
   raise exception 'Released delivery requires an independently reopened submission' using errcode='42501';
  end if;
  raise exception 'Submitted evidence requires an explicit correction request' using errcode='22023';
 end if;$new$)
  ) patches(signature, previous, replacement)
  loop
    definition := pg_catalog.pg_get_functiondef(patch.signature);
    if cardinality(string_to_array(definition, patch.previous)) <> 2 then
      raise exception 'Unexpected delivery correction boundary in %: %', patch.signature, patch.previous;
    end if;
    execute replace(definition, patch.previous, patch.replacement);
  end loop;
end;
$migration$;

notify pgrst, 'reload schema';
commit;
