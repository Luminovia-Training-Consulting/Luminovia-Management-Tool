begin;
-- This projection returns only destinations independently authorized now.
create function private.job_related_navigation(p_job_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare run_id uuid; course_id uuid; rooms jsonb;
begin
 select j.course_run_id into run_id from public.jobs j where j.id=p_job_id and private.can_read_job(j.id);
 if not found then raise exception 'Job unavailable' using errcode='42501'; end if;
 if run_id is not null then
  begin
   perform private.course_workspace_context(run_id);
   course_id:=run_id;
  exception when insufficient_privilege then course_id:=null;
  end;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'kind',r.kind) order by r.kind,r.id),'[]'::jsonb) into rooms
 from public.chat_rooms r
 where (r.kind='lecturer_course' and r.job_id=p_job_id
        or r.kind='participant_course' and run_id is not null and r.course_run_id=run_id)
 and private.can_access_chat_room(r.id);
 return jsonb_build_object('course_id',course_id,'rooms',rooms);
end;$$;
create function public.job_related_navigation(p_job_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$select private.job_related_navigation(p_job_id);$$;
revoke all on function private.job_related_navigation(uuid),public.job_related_navigation(uuid) from public,anon,authenticated,service_role;
grant execute on function private.job_related_navigation(uuid),public.job_related_navigation(uuid) to authenticated;
commit;
