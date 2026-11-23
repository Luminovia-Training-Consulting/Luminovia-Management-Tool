begin;

-- The normal workspace and removal command share the same scope. Removing a
-- course link keeps its provenance and never deletes the underlying document.
create function private.can_remove_course_resource(
  p_resource private.course_resources, p_context jsonb
) returns boolean
language plpgsql stable security invoker set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
begin
  if p_resource.removed_at is not null or
     not coalesce((p_context->>'lms_enabled')::boolean, false) then
    return false;
  end if;

  if (select edition from private.installation_identity) is distinct from 'internal' then
    -- Dedicated removals still require the publisher/owner checks in their own
    -- command and the active licence.
    return p_resource.created_by = actor_id and (
      (p_context->>'manager')::boolean or
      ((p_context->>'client')::boolean and p_resource.ownership_kind = 'company') or
      ((p_context->>'teacher')::boolean and p_resource.ownership_kind = 'lecturer')
    );
  end if;

  if (p_context->>'manager')::boolean then
    return true;
  end if;
  if (p_context->>'teacher')::boolean and p_resource.created_by = actor_id and exists (
    select 1 from public.document_versions version
    join public.documents document on document.id = version.document_id
    where version.id = p_resource.version_id
      and document.scope = 'personal' and document.kind = 'material'
      and document.owner_id = actor_id and document.uploaded_by = actor_id
      and version.uploaded_by = actor_id
  ) then
    return true;
  end if;

  return (p_context->>'client')::boolean
    and p_resource.audience in ('client', 'all')
    and private.course_resource_allowed(p_resource.id)
    and exists (
      select 1 from public.document_versions version
      join public.documents document on document.id = version.document_id
      where version.id = p_resource.version_id and version.status = 'clean'
        and version.sha256 is not null and document.deleted_at is null
        and not private.deletion_document_fenced(document.id)
    );
end;
$$;
revoke all on function private.can_remove_course_resource(private.course_resources, jsonb)
  from public, anon, authenticated, service_role;

-- Match course metadata to the existing version resolver's dedicated-document
-- boundary in the internal edition as well. New shares already enforce it.
do $migration$
declare
  allowed text := pg_catalog.pg_get_functiondef('private.course_resource_allowed(uuid)'::regprocedure);
  command text := pg_catalog.pg_get_functiondef('private.course_resource_command(uuid,text,jsonb)'::regprocedure);
  workspace text := pg_catalog.pg_get_functiondef('private.course_workspace(uuid)'::regprocedure);
  allowed_anchor constant text := $old$if (select edition from private.installation_identity) is distinct from 'internal'
     and private.course_document_is_dedicated(($old$;
  command_anchor constant text := $old$if not ((context->>'manager')::boolean or
            ((context->>'client')::boolean and resource_row.ownership_kind = 'company') or
            ((context->>'teacher')::boolean and resource_row.ownership_kind = 'lecturer' and
             resource_row.created_by = actor_id)) then
      raise exception 'Resource owner required' using errcode = '42501';$old$;
  workspace_anchor constant text := $old$'can_remove',
    ((select edition from private.installation_identity) = 'internal' or resource.created_by = auth.uid()) and (
      (context->>'manager')::boolean or
      ((context->>'client')::boolean and resource.ownership_kind = 'company') or
      ((context->>'teacher')::boolean and resource.ownership_kind = 'lecturer' and
       resource.created_by = auth.uid())
    )$old$;
begin
  if cardinality(string_to_array(allowed, allowed_anchor)) <> 2
    or cardinality(string_to_array(command, command_anchor)) <> 2
    or cardinality(string_to_array(workspace, workspace_anchor)) <> 2 then
    raise exception 'Expected one definition of each course resource authority';
  end if;
  execute replace(allowed, allowed_anchor, 'if private.course_document_is_dedicated((');
  execute replace(command, command_anchor, $new$if not private.can_remove_course_resource(resource_row, context) then
      raise exception 'Course resource unavailable' using errcode = '42501';$new$);
  execute replace(workspace, workspace_anchor, $new$'can_remove',
    private.can_remove_course_resource(resource, context) and not exists (
      select 1 from private.course_attendance_evidence evidence where evidence.resource_id = resource.id
    )$new$);
end;
$migration$;

-- Owners can purge personal materials after withdrawing unused shares. Active
-- links and links carrying acknowledgements stay outside the deletion scope.
-- Other foreign-key evidence is still discovered by the reviewed preview.
alter function private.deletion_scope(text, uuid)
  rename to deletion_scope_before_unused_materials;

create function private.deletion_scope(p_kind text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  scope jsonb := private.deletion_scope_before_unused_materials(p_kind, p_id);
  actor_id uuid := auth.uid();
begin
  if p_kind <> 'document'
     or (select edition from private.installation_identity) is distinct from 'internal'
     or not exists (
       select 1 from public.documents document
       where document.id = p_id and document.scope = 'personal' and document.kind = 'material'
         and document.owner_id = actor_id and document.uploaded_by = actor_id
     )
     or private.course_document_is_dedicated(p_id) then
    return scope;
  end if;

  return private.deletion_add_scope(scope, 'private.course_resources', format(
    $filter$x.removed_at is not null and x.created_by = %L::uuid
      and x.version_id in (
        select version.id from public.document_versions version
        where version.document_id = %L::uuid and version.uploaded_by = %L::uuid
      )
      and not exists (
        select 1 from private.course_resource_acknowledgements acknowledgement
        where acknowledgement.resource_id = x.id
      )$filter$, actor_id, p_id, actor_id
  ));
end;
$$;
revoke all on function private.deletion_scope_before_unused_materials(text, uuid),
  private.deletion_scope(text, uuid) from public, anon, authenticated, service_role;

commit;
