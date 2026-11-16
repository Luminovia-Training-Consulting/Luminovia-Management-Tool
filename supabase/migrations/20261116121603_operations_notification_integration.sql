begin;
create function private.notify_readiness_task() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.archived_at is null and new.completed_at is null and exists(select 1 from public.profiles where id=new.responsible_user_id and active)
  and coalesce((select reminders from private.notification_preferences where user_id=new.responsible_user_id),true)
  and (tg_op='INSERT' or new.responsible_user_id is distinct from old.responsible_user_id or new.due_at is distinct from old.due_at or new.title is distinct from old.title or old.archived_at is not null) then
  insert into public.notifications(user_id,kind,resource_id) values(new.responsible_user_id,'readiness_task',new.id)
  on conflict(user_id,kind,resource_id) do update set read_at=null,created_at=clock_timestamp();
 end if;
 return new;
end;$$;
create trigger notify_readiness_task after insert or update on private.course_readiness_tasks for each row execute function private.notify_readiness_task();
revoke execute on function private.notify_readiness_task() from public,anon,authenticated;
-- Preserve all existing target resolution. Every new target rechecks current
-- resource authority, including removal, reassignment, MFA and suspension.
alter function private.notification_target(text,uuid) rename to notification_target_before_extensions;
create function private.notification_target(p_kind text,p_resource uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare heading text; target uuid;
begin
 if not private.actor_active() then return jsonb_build_object('href',null,'title','');end if;
 if p_kind='readiness_task' then
  select t.course_run_id,t.title into target,heading from private.course_readiness_tasks t
   where t.id=p_resource and t.archived_at is null and t.responsible_user_id=auth.uid() and private.readiness_access(t.course_run_id);
  return jsonb_build_object('href',case when target is not null then '/readiness/'||target end,'title',coalesce(heading,''));
 elsif p_kind='support_update' then return private.support_notification_target(p_kind,p_resource);
 elsif p_kind in('delivery_submitted','delivery_confirmed','delivery_disputed','delivery_correction_requested','delivery_customer_confirmed') then return private.delivery_notification_target(p_kind,p_resource);
 elsif p_kind in('replacement_available','replacement_completed') then
  select j.title,o.id into heading,target from private.replacement_offers o
   join public.job_claims c on c.id=o.original_claim_id join public.jobs j on j.id=c.job_id
   where o.id=p_resource and (private.replacement_eligible(o.id,auth.uid()) or c.lecturer_id=auth.uid()
    or private.has_permission('jobs.manage') or exists(select 1 from public.job_claims where id=o.replacement_claim_id and lecturer_id=auth.uid()));
  return jsonb_build_object('href',case when target is not null then '/replacements' end,'title',coalesce(heading,''));
 end if;
 return private.notification_target_before_extensions(p_kind,p_resource);
end;$$;
-- Resolve destinations only inside the authorized public inbox/dispatch paths.
revoke all on function private.notification_target(text,uuid) from public,anon,authenticated,service_role;
commit;
