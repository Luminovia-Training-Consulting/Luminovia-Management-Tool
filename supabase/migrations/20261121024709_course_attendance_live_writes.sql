begin;

-- Attendance writes take the same Premium lock as other course mutations.
-- A paused or reassigned course rechecks authority after waiting for the lock.
alter function private.save_course_session_attendance(
  uuid,uuid,uuid,text,timestamptz,timestamptz,text,text,integer
) rename to save_course_session_attendance_before_premium_lock;
alter function private.attach_course_session_evidence(uuid,uuid,uuid)
  rename to attach_course_session_evidence_before_premium_lock;

revoke all on function private.save_course_session_attendance_before_premium_lock(
  uuid,uuid,uuid,text,timestamptz,timestamptz,text,text,integer
), private.attach_course_session_evidence_before_premium_lock(uuid,uuid,uuid)
from public,anon,authenticated,service_role;

create function private.save_course_session_attendance(
  p_run_id uuid,p_session_id uuid,p_user_id uuid,p_status text,
  p_arrival_at timestamptz,p_departure_at timestamptz,p_note text,
  p_reason text,p_expected_version integer
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform private.course_workspace_context(p_run_id);
  perform private.lock_course_premium(p_run_id);
  return private.save_course_session_attendance_before_premium_lock(
    p_run_id,p_session_id,p_user_id,p_status,p_arrival_at,p_departure_at,
    p_note,p_reason,p_expected_version
  );
end;
$$;

create function private.attach_course_session_evidence(
  p_run_id uuid,p_session_id uuid,p_version_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform private.course_workspace_context(p_run_id);
  perform private.lock_course_premium(p_run_id);
  perform 1 from public.documents document
    join public.document_versions version on version.document_id=document.id
    where version.id=p_version_id and document.owner_id=auth.uid()
    for share of document,version;
  return private.attach_course_session_evidence_before_premium_lock(
    p_run_id,p_session_id,p_version_id
  );
end;
$$;

revoke all on function private.save_course_session_attendance(
  uuid,uuid,uuid,text,timestamptz,timestamptz,text,text,integer
), private.attach_course_session_evidence(uuid,uuid,uuid)
from public,anon,authenticated,service_role;
grant execute on function private.save_course_session_attendance(
  uuid,uuid,uuid,text,timestamptz,timestamptz,text,text,integer
), private.attach_course_session_evidence(uuid,uuid,uuid) to authenticated;
commit;
