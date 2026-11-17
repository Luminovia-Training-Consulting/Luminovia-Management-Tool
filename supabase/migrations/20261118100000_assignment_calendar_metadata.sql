begin;
-- Calendar filters receive only descriptive metadata for the current lecturer's
-- own confirmed allocations. No staff/administrator-wide bypass or prices.
create function private.assignment_calendar_metadata(p_job_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.actor_active() then raise exception 'Account inactive' using errcode='42501';end if;
 if p_job_ids is null or cardinality(p_job_ids)>1000 or array_position(p_job_ids,null) is not null then raise exception 'Invalid assignment identities' using errcode='22023';end if;
 return coalesce((select jsonb_agg(jsonb_build_object(
  'id',j.id,'title',j.title,'organisation_id',r.organisation_id,
  'organisation_name',coalesce(o.name,j.customer_name),
  'topics',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'label_de',t.label_de,'label_en',t.label_en) order by t.label_de,t.id)
   from public.topics t where exists(select 1 from public.job_requirements q where q.job_id=j.id and q.topic_id=t.id)
   or exists(select 1 from public.course_template_topics q where q.template_id=r.template_id and q.topic_id=t.id)),'[]'::jsonb)
 ) order by j.id)
 from public.jobs j left join public.course_runs r on r.id=j.course_run_id left join public.organisations o on o.id=r.organisation_id
 where private.lecturer_actor() and j.id=any(p_job_ids)
 and exists(select 1 from public.job_claims c where c.job_id=j.id and c.lecturer_id=auth.uid() and c.status='confirmed')),'[]'::jsonb);
end;$$;
create function public.assignment_calendar_metadata(p_job_ids uuid[]) returns jsonb language sql stable security invoker set search_path='' as $$select private.assignment_calendar_metadata(p_job_ids);$$;
revoke all on function private.assignment_calendar_metadata(uuid[]),public.assignment_calendar_metadata(uuid[]) from public,anon,authenticated,service_role;
grant execute on function private.assignment_calendar_metadata(uuid[]),public.assignment_calendar_metadata(uuid[]) to authenticated;
notify pgrst, 'reload schema';
commit;
