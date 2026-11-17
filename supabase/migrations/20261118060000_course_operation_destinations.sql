begin;
-- Workspace permission never grants a destination: every job/chat is checked
-- independently against current server resource membership.
create function private.course_operation_destinations(p_run_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform private.course_workspace_context(p_run_id);
 return jsonb_build_object(
  'organisation',(select jsonb_build_object('id',o.id,'name',o.name) from public.course_runs r join public.organisations o on o.id=r.organisation_id where r.id=p_run_id),
  'lecturers',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'name',x.display_name) order by x.display_name,x.id) from (
   select distinct p.id,p.display_name from public.profiles p join public.job_claims c on c.lecturer_id=p.id and c.status='confirmed' join public.jobs j on j.id=c.job_id where j.course_run_id=p_run_id and p.active and private.can_read_job(j.id)
  )x),'[]'::jsonb),
  'jobs',coalesce((select jsonb_agg(jsonb_build_object('id',j.id,'title',j.title) order by j.title,j.id) from public.jobs j where j.course_run_id=p_run_id and private.can_read_job(j.id)),'[]'::jsonb),
  'rooms',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'name',r.title) order by r.title,r.id) from public.chat_rooms r join public.jobs j on j.id=r.job_id where j.course_run_id=p_run_id and r.kind='lecturer_course' and private.can_access_chat_room(r.id)),'[]'::jsonb)
 );
end;$$;
create function public.course_operation_destinations(p_run_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$select private.course_operation_destinations(p_run_id);$$;
revoke all on function private.course_operation_destinations(uuid),public.course_operation_destinations(uuid) from public,anon,authenticated,service_role;
grant execute on function private.course_operation_destinations(uuid),public.course_operation_destinations(uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
