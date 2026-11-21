begin;

-- Only course-local events may be resolved in a dedicated edition. Receipts
-- carry no message text, material bytes, participant notes or contact data.
create function private.academy_notification_target(p_kind text, p_resource uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  run_id uuid;
  heading text;
  section text;
begin
  if not private.learning_actor() or not coalesce(private.academy_course_access_status() in ('active','grace'),false) then
    return null;
  end if;
  case p_kind
    when 'chat_message' then
      select room.course_run_id into run_id
      from public.messages message join public.chat_rooms room on room.id = message.room_id
      where message.id = p_resource and message.deleted_at is null
        and private.academy_course_chat_member(room.id);
      section := '#course-chat';
    when 'course_resource_shared' then
      select resource.run_id into run_id from private.course_resources resource
      where resource.id = p_resource and resource.removed_at is null;
      if run_id is not null and private.course_document_access('resource',p_resource) is null then return null; end if;
      section := '#course-materials';
    when 'course_attendance_updated' then
      select session.course_run_id into run_id
      from public.course_sessions session
      join private.course_attendance attendance on attendance.session_id = session.id
      where session.id = p_resource and attendance.user_id = auth.uid();
      if run_id is not null and not coalesce((private.course_workspace_context(run_id)->>'learner')::boolean,false) then return null; end if;
      section := '';
    else return null;
  end case;
  select template.title into heading
  from public.course_runs run join public.course_templates template on template.id = run.template_id
  where run.id = run_id and run.archived_at is null;
  if not found then return null; end if;
  return jsonb_build_object('href','/courses/' || run_id || '/workspace' || section,'title',heading);
exception when insufficient_privilege then
  return null;
end;
$$;
revoke all on function private.academy_notification_target(text,uuid) from public, anon, authenticated, service_role;

-- Reuse the paged inbox and read-state transaction. Only its target and input
-- gates vary by edition, and dedicated receipts never enter external queues.
do $$
declare
  patch record;
  definition text;
begin
  for patch in select * from (values
    ('private.notification_target(text,uuid)'::regprocedure,
     chr(10) || 'begin' || chr(10),
     chr(10) || 'begin' || chr(10) || '  if (select edition from private.installation_identity) <> ''internal'' then' || chr(10) ||
     '    return coalesce(private.academy_notification_target(p_kind,p_resource),jsonb_build_object(''href'',null,''title'',''''));' || chr(10) || '  end if;' || chr(10)),
    ('private.notification_currently_visible(text,uuid)'::regprocedure,
     'select case',
     'select case when (select edition from private.installation_identity) <> ''internal'' then private.academy_notification_target(p_kind,p_resource) is not null'),
    ('private.mark_notifications(uuid[],timestamptz,boolean)'::regprocedure,
     'participant_only := private.participant_actor();',
     'participant_only := private.participant_actor();' || chr(10) ||
     '  if (select edition from private.installation_identity) <> ''internal'' then' || chr(10) ||
     '    perform private.lock_academy_course_access(); participant_only := true;' || chr(10) || '  end if;'),
    ('private.notification_delivery_allowed(uuid,text,uuid)'::regprocedure,
     chr(10) || 'begin' || chr(10),
     chr(10) || 'begin' || chr(10) || '  if (select edition from private.installation_identity) <> ''internal'' then return false; end if;' || chr(10)),
    ('private.queue_notification_email()'::regprocedure,
     ' if tg_op=',
     ' if (select edition from private.installation_identity) <> ''internal'' then return new; end if;' || chr(10) || ' if tg_op='),
    ('private.queue_notification_push()'::regprocedure,
     ' if tg_op=',
     ' if (select edition from private.installation_identity) <> ''internal'' then return new; end if;' || chr(10) || ' if tg_op='),
    ('private.notify_course_workspace_change()'::regprocedure,
     $old$  if run_id is null or not private.company_premium_enabled((
    select course.organisation_id from public.course_runs course where course.id = run_id
  )) then return new; end if;$old$,
     $new$  if run_id is null then return new; end if;
  if (select edition from private.installation_identity) = 'internal' then
    if not private.company_premium_enabled((select course.organisation_id from public.course_runs course where course.id = run_id)) then return new; end if;
  elsif event_kind not in ('course_resource_shared','course_attendance_updated')
      or private.academy_course_access_status() is distinct from 'active' then
    return new;
  end if;$new$),
    ('private.require_academy_course_access()'::regprocedure,
     '''/rpc/portal_access'', ''/rpc/my_course_workspaces'', ''/rpc/course_workspace'',',
     '''/rpc/portal_access'', ''/rpc/my_course_workspaces'', ''/rpc/course_workspace'', ''/rpc/notification_inbox'','),
    ('private.require_academy_course_access()'::regprocedure,
     '''/rpc/academy_assign_course_instructor'', ''/rpc/academy_release_course_instructor'',',
     '''/rpc/academy_assign_course_instructor'', ''/rpc/academy_release_course_instructor'', ''/rpc/mark_notifications'',' )
  ) changes(signature,anchor,replacement)
  loop
    definition := pg_catalog.pg_get_functiondef(patch.signature);
    if cardinality(string_to_array(definition,patch.anchor)) <> 2 then
      raise exception 'Expected one academy notification boundary in %',patch.signature;
    end if;
    execute replace(definition,patch.anchor,patch.replacement);
  end loop;
end;
$$;

notify pgrst, 'reload schema';
commit;
