BEGIN;

alter table public.documents drop constraint documents_kind_check;
alter table public.documents add constraint documents_kind_check
  check (kind in ('material','chat','cv','certificate','contract','invoice','avatar',
    'participant_submission','organisation_contract','portfolio_evidence'));
alter table public.documents add constraint portfolio_evidence_personal_check
  check (kind <> 'portfolio_evidence' or (scope = 'personal' and size_bytes <= 10485760));

create table private.learning_portfolio_uploads (
  version_id uuid primary key references public.document_versions(id) on delete cascade,
  expected_sha256 text not null check (expected_sha256 ~ '^[0-9a-f]{64}$')
);
create table private.learning_portfolio_evidence (
  entry_id uuid not null,
  revision integer not null,
  version_id uuid not null references private.learning_portfolio_uploads(version_id) on delete cascade,
  primary key (entry_id, revision, version_id),
  foreign key (entry_id, revision)
    references private.learning_portfolio_revisions(entry_id, revision) on delete cascade
);
create index learning_portfolio_evidence_file on private.learning_portfolio_evidence(version_id);
alter table private.learning_portfolio_uploads enable row level security;
alter table private.learning_portfolio_evidence enable row level security;
revoke all on private.learning_portfolio_uploads, private.learning_portfolio_evidence
  from public, anon, authenticated, service_role;

-- Reuse the existing reservation quotas, ownership checks and deletion-safe
-- upload pipeline. Dedicated evidence never passes ordinary Files RLS.
do $migration$
declare
  definition text;
  item record;
begin
  for item in select * from (values
    ('private.can_access_document(uuid)',
      $old$d.kind in ('participant_submission', 'organisation_contract')$old$,
      $new$d.kind in ('participant_submission', 'organisation_contract', 'portfolio_evidence')$new$),
    ('private.deletion_authorized(text,uuid)',
      $old$kind = 'organisation_contract'$old$,
      $new$kind in ('organisation_contract', 'portfolio_evidence')$new$),
    ('private.reserve_document(text,text,bigint,text,text,uuid,uuid,uuid,uuid,uuid)',
      $old$  if not private.actor_active() or p_kind = 'participant_submission' then
    raise insufficient_privilege;$old$,
      $new$  if not private.actor_active() or p_kind in ('participant_submission','portfolio_evidence') then
    raise insufficient_privilege;$new$),
    ('private.reserve_document_before_contract_owner(text,text,bigint,text,text,uuid,uuid,uuid,uuid,uuid)',
      $old$    private.participant_actor() and p_scope = 'personal' and p_kind = 'participant_submission'$old$,
      $new$    private.participant_actor() and p_scope = 'personal' and p_kind in ('participant_submission','portfolio_evidence')$new$),
    ('private.reserve_document_before_contract_owner(text,text,bigint,text,text,uuid,uuid,uuid,uuid,uuid)',
      $old$    private.can_access_document(d.id) or $old$,
      $new$    private.can_access_document(d.id) or (
      p_kind = 'portfolio_evidence' and d.kind = p_kind and d.owner_id = actor
      and existing_v.uploaded_by = actor and d.deleted_at is null
      and not private.deletion_document_fenced(d.id)
    ) or $new$)
  ) as replacements(signature, old_text, new_text)
  loop
    definition := pg_get_functiondef(item.signature::regprocedure);
    if cardinality(string_to_array(definition, item.old_text)) <> 2 then
      raise exception 'Expected one portfolio evidence guard point in %', item.signature;
    end if;
    execute replace(definition, item.old_text, item.new_text);
  end loop;
end;
$migration$;

-- The ordinary promotion path remains service-only. Portfolio reservations also
-- pin the submitted digest and require the current Academy write entitlement.
do $migration$
declare
  definition text := pg_get_functiondef('private.complete_document_upload(uuid,uuid,uuid,text,text)'::regprocedure);
  anchor constant text := '  select uploaded_by into uploader_id from public.document_versions';
begin
  if cardinality(string_to_array(definition, anchor)) <> 2 then
    raise exception 'Expected the document promotion authority boundary';
  end if;
  execute replace(definition, anchor, $check$
  if exists (select 1 from private.learning_portfolio_uploads where version_id = p_version_id) then
    if not exists (select 1 from private.learning_portfolio_uploads
      where version_id = p_version_id and expected_sha256 = p_sha256) then
      raise invalid_parameter_value;
    end if;
    if (select edition from private.installation_identity) is distinct from 'internal' then
      perform private.lock_academy_course_access();
    end if;
  end if;
$check$ || anchor);
end;
$migration$;

create function private.learning_portfolio_evidence_access_allowed()
returns boolean language sql stable security invoker set search_path = '' as $$
  select coalesce(private.learning_actor(), false) and (
    (select edition from private.installation_identity) = 'internal'
    or coalesce(private.academy_course_access_status() in ('active','grace'), false)
  );
$$;

create function private.reserve_learning_portfolio_evidence(
  p_name text, p_mime text, p_size bigint, p_client_id uuid, p_sha256 text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  who uuid := auth.uid();
  reservation jsonb;
  bound_hash text;
begin
  if p_size is null or p_size not between 1 and 10485760 or p_sha256 is null
    or p_sha256 !~ '^[0-9a-f]{64}$' or p_mime is null then raise invalid_parameter_value; end if;
  if (select edition from private.installation_identity) is distinct from 'internal' then
    perform private.lock_academy_course_access();
  end if;
  perform 1 from public.profiles where id = who and active for share;
  if not found or not coalesce(private.learning_actor(), false) then raise insufficient_privilege; end if;
  reservation := private.reserve_document_before_contract_owner(
    p_name, p_mime, p_size, 'personal', 'portfolio_evidence', null, null, p_client_id, null, null
  );
  insert into private.learning_portfolio_uploads(version_id, expected_sha256)
    values ((reservation->>'version_id')::uuid, p_sha256)
    on conflict (version_id) do nothing;
  select expected_sha256 into bound_hash from private.learning_portfolio_uploads
  where version_id = (reservation->>'version_id')::uuid;
  if bound_hash is distinct from p_sha256 then
    raise exception 'Portfolio upload changed' using errcode = 'PT409';
  end if;
  return reservation;
end;
$$;

create function private.learning_portfolio_evidence_upload_status(p_document_id uuid, p_version_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'document', jsonb_build_object(
      'id', document.id, 'scope', document.scope, 'kind', document.kind, 'owner_id', document.owner_id,
      'uploaded_by', document.uploaded_by, 'room_id', document.room_id, 'job_id', document.job_id, 'original_name', document.original_name,
      'mime_type', document.mime_type, 'size_bytes', document.size_bytes, 'status', document.status,
      'current_version_id', version.id, 'created_at', document.created_at, 'deleted_at', null
    ), 'sha256', upload.expected_sha256
  )
  from private.learning_portfolio_uploads upload
  join public.document_versions version on version.id = upload.version_id
  join public.documents document on document.id = version.document_id and document.current_version_id = version.id
  where private.learning_portfolio_evidence_access_allowed()
    and ((select edition from private.installation_identity) = 'internal' or private.academy_course_access_status() = 'active')
    and document.id = p_document_id and version.id = p_version_id and document.kind = 'portfolio_evidence'
    and document.owner_id = auth.uid() and version.uploaded_by = auth.uid() and document.deleted_at is null
    and not private.deletion_document_fenced(document.id)
    and (document.status <> 'clean' or (
      version.status = 'clean' and version.sha256 = upload.expected_sha256 and version.scanner_version is not null
    ));
$$;

-- Eligibility must hold both when the version is linked and every time it is
-- projected or downloaded. For the latter, the Edge gateway also hashes the bytes.
create function private.learning_portfolio_evidence_file(p_owner_id uuid, p_version_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('version_id', version.id, 'name', version.original_name,
    'mime_type', version.mime_type, 'size_bytes', version.size_bytes, 'sha256', version.sha256)
  from private.learning_portfolio_uploads upload
  join public.document_versions version on version.id = upload.version_id
  join public.documents document on document.id = version.document_id and document.current_version_id = version.id
  where version.id = p_version_id and version.uploaded_by = p_owner_id and document.owner_id = p_owner_id
    and document.kind = 'portfolio_evidence' and document.status = 'clean' and version.status = 'clean'
    and version.sha256 = upload.expected_sha256 and version.scanner_version like 'ClamAV %'
    and document.deleted_at is null and not private.deletion_document_fenced(document.id);
$$;

create function private.learning_portfolio_evidence_list(p_entry_id uuid, p_revision integer, p_owner_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('version_id', link.version_id, 'name', file.data->>'name')
    order by file.data->>'name', link.version_id), '[]'::jsonb)
  from private.learning_portfolio_evidence link
  cross join lateral (select private.learning_portfolio_evidence_file(p_owner_id, link.version_id) as data) file
  where link.entry_id = p_entry_id and link.revision = p_revision and file.data is not null;
$$;

create function private.learning_portfolio_evidence_access(
  p_id uuid, p_revision integer, p_shared boolean, p_version_id uuid
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  who uuid := auth.uid();
  result jsonb;
begin
  if p_id is null or p_revision is null or p_shared is null or p_version_id is null
    then raise invalid_parameter_value; end if;
  if not private.learning_portfolio_evidence_access_allowed() then raise insufficient_privilege; end if;
  if p_shared then
    select private.learning_portfolio_evidence_file(entry.owner_id, p_version_id) into result
    from private.learning_portfolio_shares share
    join private.learning_portfolio_entries entry on entry.id = share.entry_id
    join private.learning_portfolio_evidence link on link.entry_id = entry.id and link.revision = share.revision
    where share.id = p_id and share.revision = p_revision and share.teacher_id = who
      and share.revoked_at is null and entry.archived_at is null and entry.deleted_at is null
      and link.version_id = p_version_id
      and private.learning_portfolio_current_teacher(share.course_id, who)
      and private.learning_portfolio_current_learner(share.course_id, entry.owner_id);
  else
    select private.learning_portfolio_evidence_file(entry.owner_id, p_version_id) into result
    from private.learning_portfolio_entries entry
    join private.learning_portfolio_evidence link on link.entry_id = entry.id and link.revision = p_revision
    where entry.id = p_id and entry.owner_id = who and entry.archived_at is null and entry.deleted_at is null
      and link.version_id = p_version_id;
  end if;
  if result is null then raise insufficient_privilege; end if;
  return result;
end;
$$;

-- The caller owns and already holds the portfolio mutation/admission lock.
create function private.change_learning_portfolio_evidence(
  p_entry_id uuid, p_current integer, p_expected integer,
  p_action text, p_payload jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  version uuid;
  linked boolean;
begin
  if jsonb_typeof(p_payload->'version_id') is distinct from 'string'
    or p_payload - 'version_id' <> '{}'::jsonb then raise invalid_parameter_value; end if;
  version := (p_payload->>'version_id')::uuid;
  if p_action = 'link' and private.learning_portfolio_evidence_file(auth.uid(), version) is null then
    raise insufficient_privilege;
  end if;
  linked := exists (select 1 from private.learning_portfolio_evidence
    where entry_id = p_entry_id and revision = p_current and version_id = version);
  if linked = (p_action = 'link') and p_expected in (p_current, p_current - 1) then
    return jsonb_build_object('revision', p_current);
  end if;
  if p_expected is distinct from p_current then
    raise exception 'Portfolio entry changed' using errcode = 'PT409';
  end if;
  if p_current >= 30 or (p_action = 'link' and (
    select count(*) from private.learning_portfolio_evidence where entry_id = p_entry_id and revision = p_current
  ) >= 5) then raise exception 'Portfolio evidence limit reached' using errcode = '22023'; end if;
  insert into private.learning_portfolio_revisions(entry_id, revision, title, body)
    select entry_id, p_current + 1, title, body from private.learning_portfolio_revisions
    where entry_id = p_entry_id and revision = p_current;
  insert into private.learning_portfolio_evidence(entry_id, revision, version_id)
    select entry_id, p_current + 1, version_id from private.learning_portfolio_evidence
    where entry_id = p_entry_id and revision = p_current and version_id <> version;
  if p_action = 'link' then
    insert into private.learning_portfolio_evidence(entry_id, revision, version_id) values (p_entry_id, p_current + 1, version);
  end if;
  return jsonb_build_object('revision', p_current + 1);
end;
$$;

do $migration$
declare
  command_def text := pg_get_functiondef('private.learning_portfolio_command(uuid,text,jsonb,integer)'::regprocedure);
  read_def text := pg_get_functiondef('private.learning_portfolio(uuid,uuid,boolean,integer)'::regprocedure);
  academy text := pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  portal text := pg_get_functiondef('private.require_portal_access()'::regprocedure);
  operations constant text := $ops$'save', 'share', 'revoke', 'archive', 'restore', 'delete'$ops$;
  save_start constant text := $save$  if p_action = 'save' then$save$;
  save_end constant text := $save$    values (p_entry_id, p_expected_revision + 1, title_value, body_value);$save$;
  shared_read constant text := '        profile.display_name as learner';
  current_read constant text := $read$    'current', to_jsonb(current_revision) - 'entry_id',$read$;
  history_read constant text := $read$      select jsonb_agg(to_jsonb(history_row) - 'entry_id' order by history_row.revision desc)$read$;
  read_gate constant text := '''/rpc/learning_portfolio''';
  write_gate constant text := '''/rpc/learning_portfolio_command''';
  reads constant text := read_gate || ', ''/rpc/learning_portfolio_evidence_access''';
  writes constant text := write_gate || ', ''/rpc/reserve_learning_portfolio_evidence'', ''/rpc/learning_portfolio_evidence_upload_status''';
begin
  if cardinality(string_to_array(command_def, operations)) <> 2
    or cardinality(string_to_array(command_def, save_start)) <> 2
    or cardinality(string_to_array(command_def, save_end)) <> 2
    or cardinality(string_to_array(read_def, shared_read)) <> 2
    or cardinality(string_to_array(read_def, current_read)) <> 2
    or cardinality(string_to_array(read_def, history_read)) <> 2
    or cardinality(string_to_array(academy, '= ' || read_gate)) <> 2
    or cardinality(string_to_array(academy, '= ' || write_gate)) <> 2
    or cardinality(string_to_array(portal, '= ' || read_gate)) <> 2
    or cardinality(string_to_array(portal, '= ' || write_gate)) <> 2
    then raise exception 'Expected portfolio lifecycle and access boundaries'; end if;

  command_def := replace(command_def, operations, operations || ', ''link'', ''unlink''');
  command_def := replace(command_def, save_start, $actions$
  if p_action in ('link','unlink') then
    if current_revision.revision is null then raise insufficient_privilege; end if;
    return private.change_learning_portfolio_evidence(p_entry_id, current_revision.revision, p_expected_revision, p_action, p_payload);
  end if;
$actions$ || save_start);
  command_def := replace(command_def, save_end, save_end || $copy$
    insert into private.learning_portfolio_evidence(entry_id, revision, version_id)
      select entry_id, p_expected_revision + 1, version_id from private.learning_portfolio_evidence
      where entry_id = p_entry_id and revision = p_expected_revision;$copy$);
  execute command_def;

  read_def := replace(read_def, shared_read, shared_read || $shared$,
        private.learning_portfolio_evidence_list(entry.id, revision.revision, entry.owner_id) as evidence$shared$);
  read_def := replace(read_def, current_read, $current$
    'current', (to_jsonb(current_revision) - 'entry_id') || jsonb_build_object(
      'evidence', private.learning_portfolio_evidence_list(entry.id, current_revision.revision, entry.owner_id)
    ),$current$);
  read_def := replace(read_def, history_read, $history$
      select jsonb_agg((to_jsonb(history_row) - 'entry_id') || jsonb_build_object(
        'evidence', private.learning_portfolio_evidence_list(entry.id, history_row.revision, entry.owner_id)
      ) order by history_row.revision desc)$history$);
  execute read_def;

  execute replace(replace(academy, '= ' || read_gate, 'in (' || reads || ')'),
    '= ' || write_gate, 'in (' || writes || ')');
  execute replace(replace(portal, '= ' || read_gate, 'in (' || reads || ')'),
    '= ' || write_gate, 'in (' || writes || ')');
end;
$migration$;

create function public.reserve_learning_portfolio_evidence(
  p_name text, p_mime text, p_size bigint, p_client_id uuid, p_sha256 text
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.reserve_learning_portfolio_evidence(p_name, p_mime, p_size, p_client_id, p_sha256);
$$;
create function public.learning_portfolio_evidence_upload_status(p_document_id uuid, p_version_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.learning_portfolio_evidence_upload_status(p_document_id, p_version_id);
$$;
create function public.learning_portfolio_evidence_access(
  p_id uuid, p_revision integer, p_shared boolean, p_version_id uuid
) returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.learning_portfolio_evidence_access(p_id, p_revision, p_shared, p_version_id);
$$;

revoke all on function private.learning_portfolio_evidence_access_allowed(),
  private.learning_portfolio_evidence_file(uuid, uuid),
  private.learning_portfolio_evidence_list(uuid, integer, uuid),
  private.change_learning_portfolio_evidence(uuid, integer, integer, text, jsonb),
  private.reserve_learning_portfolio_evidence(text, text, bigint, uuid, text),
  public.reserve_learning_portfolio_evidence(text, text, bigint, uuid, text),
  private.learning_portfolio_evidence_upload_status(uuid, uuid),
  public.learning_portfolio_evidence_upload_status(uuid, uuid),
  private.learning_portfolio_evidence_access(uuid, integer, boolean, uuid),
  public.learning_portfolio_evidence_access(uuid, integer, boolean, uuid) from public, anon, authenticated, service_role;
grant execute on function private.reserve_learning_portfolio_evidence(text, text, bigint, uuid, text),
  public.reserve_learning_portfolio_evidence(text, text, bigint, uuid, text),
  private.learning_portfolio_evidence_upload_status(uuid, uuid),
  public.learning_portfolio_evidence_upload_status(uuid, uuid),
  private.learning_portfolio_evidence_access(uuid, integer, boolean, uuid),
  public.learning_portfolio_evidence_access(uuid, integer, boolean, uuid) to authenticated;

notify pgrst, 'reload schema';
COMMIT;
