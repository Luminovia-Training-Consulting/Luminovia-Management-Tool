begin;

-- These private revisions were retained when their callers moved to the
-- current workspace, document, enrolment, lifecycle and notification routines.
-- Reject the migration if any tracked object still depends on a retired OID.
drop function private.course_workspace_action_obsolete(uuid, text, jsonb, integer) restrict;
drop function private.notification_target_before_extensions(text, uuid) restrict;
drop function private.course_document_access_obsolete(text, uuid) restrict;
drop function private.manage_course_enrolment_before_origins(uuid, uuid, text) restrict;
drop function private.job_lifecycle_before_withdrawals(uuid) restrict;

commit;
