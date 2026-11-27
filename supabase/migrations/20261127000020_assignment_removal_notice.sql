begin;

-- Resolve cancellation details only for the affected lecturer. A cancellation
-- notice remains readable after the underlying assignment loses its access.
do $migration$
declare
  definition text := pg_get_functiondef('private.notification_target(text,uuid)'::regprocedure);
  marker constant text := '  if p_kind <> ''course_offer_published'' then';
begin
  if cardinality(string_to_array(definition, marker)) <> 2 then
    raise exception 'Expected the current notification target resolver';
  end if;
  execute replace(definition, marker, $branch$
  if p_kind = 'claim_cancelled' then
    return coalesce((
      select jsonb_build_object(
        'href', null, 'title', job.title, 'assignment_removed', true,
        'removal_reason', event.details->>'reason'
      )
      from public.job_claims claim
      join public.jobs job on job.id = claim.job_id
      join public.audit_events event on event.resource_id = claim.id
        and event.action = 'claim.cancelled'
      where claim.id = p_resource and claim.lecturer_id = auth.uid()
        and claim.status = 'cancelled' and private.actor_active()
        and nullif(btrim(event.details->>'reason'), '') is not null
      order by event.created_at desc, event.id desc
      limit 1
    ), private.notification_target_before_course_publication(p_kind, p_resource));
  end if;
$branch$ || marker);
end;
$migration$;

commit;
