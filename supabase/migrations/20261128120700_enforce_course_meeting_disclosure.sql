-- Protect dedicated meeting links with the same policy as dispatch and venues.
-- Branded Academy allocations have their own instructor and licence authority.
begin;

do $migration$
declare
  definition text;
  course_scope constant text := 'private.client_has_organisation(run.organisation_id)';
  meeting_read constant text := 'or workspace->>''delivery_type'' <> ''online'' or (workspace->>''ended'')::boolean then';
  meeting_write constant text := '(context->>''lms_enabled'')::boolean is not true or not exists (';
begin
  definition := pg_get_functiondef('private.can_read_course_customer(uuid)'::regprocedure);
  if cardinality(string_to_array(definition,course_scope))<>2 then
    raise exception 'Unexpected course customer scope';
  end if;
  execute replace(definition,course_scope,course_scope || $code$
    or (
      (select edition from private.installation_identity) <> 'internal'
      and private.academy_course_teacher(run.id,auth.uid())
    )
  $code$);

  definition := pg_get_functiondef('private.course_workspace_with_meeting_link(uuid)'::regprocedure);
  if cardinality(string_to_array(definition,meeting_read))<>2 then
    raise exception 'Unexpected course meeting link projection';
  end if;
  execute replace(definition,meeting_read,$code$
    or workspace->>'delivery_type' <> 'online' or (workspace->>'ended')::boolean
    or not private.can_read_course_customer(p_run_id) then
  $code$);

  -- Perform the same scope check after the existing course and entitlement
  -- locks, so an instructor replacement cannot authorize a stale edit.
  definition := pg_get_functiondef('private.set_course_meeting_link(uuid,text,integer)'::regprocedure);
  if cardinality(string_to_array(definition,meeting_write))<>2 then
    raise exception 'Unexpected course meeting link write guard';
  end if;
  execute replace(definition,meeting_write,$code$
    (context->>'lms_enabled')::boolean is not true
    or not private.can_read_course_customer(p_run_id)
    or not exists (
  $code$);
end;
$migration$;

commit;
