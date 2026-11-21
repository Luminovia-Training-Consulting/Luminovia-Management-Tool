begin;

-- Keep the existing completion evidence and version counter authoritative.
alter table private.course_attendance
  add column register_status text check(register_status in ('present','absent','excused')),
  add column arrival_at timestamptz,
  add column departure_at timestamptz,
  add column staff_note text not null default '' check(length(staff_note)<=1000);

create function private.sync_legacy_attendance_register() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.state is distinct from old.state and
     new.register_status is not distinct from old.register_status then
    new.register_status := case new.state when 'attended' then 'present'
      when 'absent' then 'absent' else null end;
  end if;
  return new;
end;$$;
create trigger sync_legacy_attendance_register before update of state,register_status
  on private.course_attendance for each row
  execute function private.sync_legacy_attendance_register();

-- Evidence references immutable, virus-checked document versions through the
-- existing course resource and protected document-download boundaries.
create table private.course_attendance_evidence (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.course_sessions(id) on delete cascade,
  resource_id uuid not null references private.course_resources(id) on delete cascade,
  version_id uuid not null references public.document_versions(id),
  attached_by uuid not null references public.profiles(id),
  attached_at timestamptz not null default now(),
  unique(session_id,version_id), unique(session_id,resource_id)
);
alter table private.course_attendance_evidence enable row level security;
revoke all on private.course_attendance_evidence from public,anon,authenticated,service_role;

-- An attached sheet is a retained record. Normal file/resource removal cannot
-- silently erase its protected byte path or the immutable version reference.
create function private.protect_attendance_evidence() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_table_name='course_resources' then
    if new.removed_at is not null and old.removed_at is null and
       exists(select 1 from private.course_attendance_evidence e
         where e.resource_id=old.id) then
      raise exception 'Retained attendance evidence cannot be unshared' using errcode='23503';
    end if;
  elsif tg_table_name='documents' then
    if new.deleted_at is not null and old.deleted_at is null and
       exists(select 1 from private.course_attendance_evidence e
         join public.document_versions v on v.id=e.version_id
         where v.document_id=old.id) then
      raise exception 'Retained attendance evidence cannot be deleted' using errcode='23503';
    end if;
  end if;
  return new;
end;$$;
revoke all on function private.protect_attendance_evidence() from public,anon,authenticated,service_role;
create trigger protect_attendance_resource before update of removed_at
  on private.course_resources for each row execute function private.protect_attendance_evidence();
create trigger protect_attendance_document before update of deleted_at
  on public.documents for each row execute function private.protect_attendance_evidence();

create function private.course_session_register(p_run_id uuid,p_session_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare context jsonb; session_row public.course_sessions%rowtype; result jsonb;
begin
  context := private.course_workspace_context(p_run_id);
  if not coalesce((context->>'lms_enabled')::boolean,false) or
     not ((context->>'manager')::boolean or (context->>'teacher')::boolean or
          (context->>'client')::boolean) then
    raise exception 'Course attendance unavailable' using errcode='42501';
  end if;
  select * into session_row from public.course_sessions
    where id=p_session_id and course_run_id=p_run_id;
  if not found then raise exception 'Course session unavailable' using errcode='42501'; end if;
  select jsonb_build_object(
    'session_id',session_row.id,'starts_at',session_row.starts_at,
    'ends_at',session_row.ends_at,'time_zone',run.time_zone,
    'rows',coalesce((select jsonb_agg(jsonb_build_object(
      'user_id',enrolment.user_id,'name',profile.display_name,
      'status',coalesce(attendance.register_status,case attendance.state
        when 'attended' then 'present' when 'absent' then 'absent' end),
      'arrival_at',attendance.arrival_at,'departure_at',attendance.departure_at,
      'note',coalesce(attendance.staff_note,''),
      'version',coalesce(attendance.version,0)) order by profile.display_name,enrolment.user_id)
      from public.course_enrolments enrolment
      join public.profiles profile on profile.id=enrolment.user_id
      left join private.course_attendance attendance on
        attendance.session_id=session_row.id and attendance.user_id=enrolment.user_id
      where enrolment.course_run_id=p_run_id and enrolment.status in ('enrolled','completed')),'[]'::jsonb),
    'evidence',coalesce((select jsonb_agg(jsonb_build_object(
      'id',evidence.id,'resource_id',resource.id,'version_id',version.id,
      'name',version.original_name,'attached_at',evidence.attached_at)
      order by evidence.attached_at,evidence.id)
      from private.course_attendance_evidence evidence
      join private.course_resources resource on resource.id=evidence.resource_id
        and resource.run_id=p_run_id and resource.removed_at is null
      join public.document_versions version on version.id=evidence.version_id
        and version.id=resource.version_id and version.status='clean'
      join public.documents document on document.id=version.document_id
        and document.deleted_at is null
      where evidence.session_id=session_row.id),'[]'::jsonb),
    'history',coalesce((select jsonb_agg(jsonb_build_object(
      'id',audit.id,'user_id',audit.user_id,'actor_id',audit.actor_id,
      'old_state',audit.old_state,'new_state',audit.new_state,
      'reason',audit.reason,'created_at',audit.created_at)
      order by audit.created_at desc,audit.id desc)
      from private.course_attendance_audit audit
      where audit.session_id=session_row.id),'[]'::jsonb))
    into result from public.course_runs run where run.id=p_run_id;
  return result;
end;$$;
create function public.course_session_register(p_run_id uuid,p_session_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
  select private.course_session_register(p_run_id,p_session_id);
$$;

create function private.save_course_session_attendance(
  p_run_id uuid,p_session_id uuid,p_user_id uuid,p_status text,
  p_arrival_at timestamptz,p_departure_at timestamptz,p_note text,
  p_reason text,p_expected_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare context jsonb; session_row public.course_sessions%rowtype;
  previous private.course_attendance%rowtype; normalized_note text:=btrim(coalesce(p_note,''));
  normalized_reason text:=btrim(coalesce(p_reason,''));
  duration_minutes integer; effective_start timestamptz; effective_end timestamptz;
  state_value text; calculated_minutes integer; new_version integer;
begin
  context := private.course_workspace_context(p_run_id);
  if not coalesce((context->>'lms_enabled')::boolean,false) or
     not ((context->>'manager')::boolean or (context->>'teacher')::boolean or
          (context->>'client')::boolean) then
    raise exception 'Course attendance unavailable' using errcode='42501';
  end if;
  select * into session_row from public.course_sessions
    where id=p_session_id and course_run_id=p_run_id;
  if not found or session_row.starts_at>now() or
     not exists(select 1 from public.course_enrolments enrolment
       where enrolment.course_run_id=p_run_id and enrolment.user_id=p_user_id
         and enrolment.status in ('enrolled','completed')) then
    raise exception 'Current course session and enrolment required' using errcode='42501';
  end if;
  if p_status not in ('present','absent','excused') or p_status is null or
     p_expected_version is null or p_expected_version<0 or
     length(normalized_note)>1000 or length(normalized_reason)>500 or
     (p_expected_version>0 and length(normalized_reason)<3) or
     (p_status<>'present' and (p_arrival_at is not null or p_departure_at is not null)) or
     (p_arrival_at is not null and (p_arrival_at<session_row.starts_at-interval '1 hour' or
       p_arrival_at>session_row.ends_at)) or
     (p_departure_at is not null and (p_departure_at<session_row.starts_at or
       p_departure_at>session_row.ends_at+interval '1 hour' or
       (p_arrival_at is not null and p_departure_at<p_arrival_at))) then
    raise exception 'Invalid attendance details' using errcode='22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'attendance:'||p_session_id||':'||p_user_id,0));
  select * into previous from private.course_attendance
    where session_id=p_session_id and user_id=p_user_id for update;
  if coalesce(previous.version,0)<>p_expected_version then
    raise exception 'Attendance changed' using errcode='40001';
  end if;
  if exists(select 1 from private.course_completion_records record
    where record.run_id=p_run_id and record.user_id=p_user_id and record.revoked_at is null) then
    raise exception 'Revoke active completion before correction' using errcode='22023';
  end if;
  duration_minutes := ceil(extract(epoch from
    (session_row.ends_at-session_row.starts_at))/60)::integer;
  effective_start := greatest(coalesce(p_arrival_at,session_row.starts_at),session_row.starts_at);
  effective_end := least(coalesce(p_departure_at,session_row.ends_at),session_row.ends_at);
  calculated_minutes := case when p_status='present' then
    least(duration_minutes,greatest(0,ceil(extract(epoch from
      (effective_end-effective_start))/60)::integer)) else 0 end;
  state_value := case when p_status='present' then 'attended' else 'absent' end;
  insert into private.course_attendance_audit(
    session_id,user_id,actor_id,old_state,new_state,reason)
    values(p_session_id,p_user_id,auth.uid(),to_jsonb(previous),
      jsonb_build_object('state',state_value,'minutes',calculated_minutes,
        'register_status',p_status,'arrival_at',p_arrival_at,
        'departure_at',p_departure_at,'staff_note',normalized_note),
      case when p_expected_version=0 then 'Initial marking' else normalized_reason end);
  insert into private.course_attendance(
    session_id,user_id,state,minutes,register_status,arrival_at,departure_at,staff_note)
    values(p_session_id,p_user_id,state_value,calculated_minutes,p_status,
      p_arrival_at,p_departure_at,normalized_note)
    on conflict(session_id,user_id) do update set
      state=excluded.state,minutes=excluded.minutes,
      register_status=excluded.register_status,arrival_at=excluded.arrival_at,
      departure_at=excluded.departure_at,staff_note=excluded.staff_note,
      version=course_attendance.version+1,updated_at=now()
    returning version into new_version;
  return jsonb_build_object('status',p_status,'version',new_version,
    'minutes',calculated_minutes);
end;$$;
create function public.save_course_session_attendance(
  p_run_id uuid,p_session_id uuid,p_user_id uuid,p_status text,
  p_arrival_at timestamptz,p_departure_at timestamptz,p_note text,
  p_reason text,p_expected_version integer)
returns jsonb language sql security invoker set search_path='' as $$
  select private.save_course_session_attendance(p_run_id,p_session_id,p_user_id,
    p_status,p_arrival_at,p_departure_at,p_note,p_reason,p_expected_version);
$$;

create function private.attach_course_session_evidence(
  p_run_id uuid,p_session_id uuid,p_version_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare context jsonb; resource_id uuid; evidence_id uuid; version_row public.document_versions%rowtype;
begin
  context := private.course_workspace_context(p_run_id);
  if not coalesce((context->>'lms_enabled')::boolean,false) or
     not ((context->>'manager')::boolean or (context->>'teacher')::boolean or
          (context->>'client')::boolean) then
    raise exception 'Course attendance unavailable' using errcode='42501';
  end if;
  if not exists(select 1 from public.course_sessions
    where id=p_session_id and course_run_id=p_run_id) then
    raise exception 'Course session unavailable' using errcode='42501';
  end if;
  select version.* into version_row from public.document_versions version
    join public.documents document on document.id=version.document_id
    where version.id=p_version_id and version.status='clean'
      and version.sha256 is not null and version.mime_type='application/pdf'
      and document.deleted_at is null and document.current_version_id=version.id
      and document.status='clean' and document.mime_type='application/pdf'
      and document.scope='personal' and document.kind='material'
      and document.owner_id=auth.uid() and document.uploaded_by=auth.uid();
  if not found then raise exception 'Own clean PDF version required' using errcode='42501'; end if;
  insert into private.course_resources(run_id,version_id,audience,category,created_by)
    values(p_run_id,p_version_id,'client','report',auth.uid())
    on conflict(run_id,version_id,audience) do update set removed_at=null
    returning id into resource_id;
  insert into private.course_attendance_evidence(session_id,resource_id,version_id,attached_by)
    values(p_session_id,resource_id,p_version_id,auth.uid())
    on conflict(session_id,version_id) do nothing
    returning id into evidence_id;
  if evidence_id is null then
    select id into evidence_id from private.course_attendance_evidence
      where session_id=p_session_id and version_id=p_version_id;
  else
    insert into public.audit_events(actor_id,action,resource_id,details)
      values(auth.uid(),'course.attendance_evidence_attached',p_session_id,
        jsonb_build_object('evidence_id',evidence_id,'version_id',p_version_id));
  end if;
  return jsonb_build_object('id',evidence_id,'resource_id',resource_id,
    'version_id',p_version_id);
end;$$;
create function public.attach_course_session_evidence(
  p_run_id uuid,p_session_id uuid,p_version_id uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select private.attach_course_session_evidence(p_run_id,p_session_id,p_version_id);
$$;

revoke all on function private.course_session_register(uuid,uuid),public.course_session_register(uuid,uuid),
  private.save_course_session_attendance(uuid,uuid,uuid,text,timestamptz,timestamptz,text,text,integer),
  public.save_course_session_attendance(uuid,uuid,uuid,text,timestamptz,timestamptz,text,text,integer),
  private.attach_course_session_evidence(uuid,uuid,uuid),public.attach_course_session_evidence(uuid,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function private.course_session_register(uuid,uuid),public.course_session_register(uuid,uuid),
  private.save_course_session_attendance(uuid,uuid,uuid,text,timestamptz,timestamptz,text,text,integer),
  public.save_course_session_attendance(uuid,uuid,uuid,text,timestamptz,timestamptz,text,text,integer),
  private.attach_course_session_evidence(uuid,uuid,uuid),public.attach_course_session_evidence(uuid,uuid,uuid)
  to authenticated;

notify pgrst,'reload schema';
commit;
