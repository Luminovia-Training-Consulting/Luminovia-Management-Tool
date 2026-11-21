begin;

-- Exact material acknowledgements use the established course transaction.
-- Enrolment and completion notices remain in the dedicated actor-scoped inbox.
do $$
declare
  patch record;
  definition text;
begin
  for patch in select * from (values
    ('private.academy_learning_action(uuid,text,jsonb,integer)'::regprocedure,
     'when ''feedback'' then array[''rating'',''comment'']',
     'when ''feedback'' then array[''rating'',''comment'']' || chr(10) ||
       '    when ''resource_acknowledge'' then array[''id'']'),
    ('private.academy_notification_target(text,uuid)'::regprocedure,
     '    else return null;',
     $target$    when 'academy_course_enrolled' then
      run_id := p_resource;
      if not coalesce((private.course_workspace_context(run_id)->>'learner')::boolean,false) then return null; end if;
      section := '';
    when 'course_completion_issued', 'course_completion_revoked' then
      select record.run_id into run_id
      from private.course_completion_records record
      where record.id = p_resource and record.user_id = auth.uid()
        and (record.revoked_at is null) = (p_kind = 'course_completion_issued');
      if run_id is not null and not coalesce((private.course_workspace_context(run_id)->>'learner')::boolean,false) then return null; end if;
      section := '#course-learning';
    else return null;$target$),
    ('private.notify_course_workspace_change()'::regprocedure,
     'event_kind not in (''course_resource_shared'',''course_attendance_updated'')',
     'event_kind not in (''course_resource_shared'',''course_attendance_updated'',''course_completion_issued'',''course_completion_revoked'')'),
    ('private.notify_course_workspace_change()'::regprocedure,
     'where profile.active and profile.id is distinct from auth.uid()',
     $recipient$where profile.active and (profile.id is distinct from auth.uid() or (
      event_kind = 'course_completion_issued' and (select edition from private.installation_identity) <> 'internal'
    ))$recipient$)
  ) changes(signature,anchor,replacement)
  loop
    definition := pg_catalog.pg_get_functiondef(patch.signature);
    if cardinality(string_to_array(definition,patch.anchor)) <> 2 then
      raise exception 'Expected one reviewed learner receipt boundary in %',patch.signature;
    end if;
    execute replace(definition,patch.anchor,patch.replacement);
  end loop;
end;
$$;

create function private.notify_academy_enrolment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from 'enrolled' or (tg_op = 'UPDATE' and old.status = new.status)
     or (select edition from private.installation_identity) = 'internal'
     or private.academy_course_access_status() is distinct from 'active' then
    return new;
  end if;
  insert into public.notifications(user_id,kind,resource_id)
  values(new.user_id,'academy_course_enrolled',new.course_run_id)
  on conflict(user_id,kind,resource_id) do update set created_at = clock_timestamp(), read_at = null;
  return new;
end;
$$;
revoke all on function private.notify_academy_enrolment() from public, anon, authenticated, service_role;
create trigger academy_enrolment_notice after insert or update of status on public.course_enrolments
for each row execute function private.notify_academy_enrolment();

notify pgrst, 'reload schema';
commit;
