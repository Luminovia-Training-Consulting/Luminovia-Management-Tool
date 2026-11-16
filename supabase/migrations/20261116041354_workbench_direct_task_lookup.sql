begin;
-- Notifications/search can target an authorized task outside the current page.
-- The same current-source/owner checks protect direct reads and task history.
create function private.work_task_detail(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.actor_active() then raise exception 'Active account required' using errcode='42501';end if;
 if p_id is null then raise exception 'Task identity required' using errcode='22023';end if;
 return private.work_task_json(p_id);
end;$$;
create function public.work_task_detail(p_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$select private.work_task_detail(p_id);$$;
revoke all on function private.work_task_detail(uuid),public.work_task_detail(uuid) from public,anon,authenticated,service_role;
grant execute on function private.work_task_detail(uuid),public.work_task_detail(uuid) to authenticated;
commit;
