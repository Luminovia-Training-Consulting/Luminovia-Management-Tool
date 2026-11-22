-- Record a verified ordinary upload and its audit event in one transaction.
-- The caller has already scanned the exact bytes and finished writing to Storage.
begin;

create function private.complete_document_upload(
  p_document_id uuid, p_version_id uuid, p_lease_id uuid,
  p_sha256 text, p_scanner_version text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  uploader_id uuid;
  document_status text;
  document_kind text;
  version_status text;
  recorded_hash text;
  recorded_scanner text;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    raise insufficient_privilege;
  end if;
  if p_sha256 is null or p_sha256 !~ '^[a-f0-9]{64}$'
    or p_scanner_version is null or p_scanner_version not like 'ClamAV %'
    or length(p_scanner_version) > 1024 then
    raise invalid_parameter_value;
  end if;

  select uploaded_by into uploader_id from public.document_versions
  where id = p_version_id and document_id = p_document_id;
  if not found then raise insufficient_privilege; end if;

  -- Follow the existing invoice completion order. Keep the uploader active and
  -- the exact deletion lease live while updating the document and owned version.
  perform 1 from public.profiles where id = uploader_id and active for share;
  if not found then raise insufficient_privilege; end if;
  perform 1 from private.deletion_upload_leases
  where id = p_lease_id and document_id = p_document_id and version_id = p_version_id
  for share;
  if not found then raise insufficient_privilege; end if;

  select status, kind into document_status, document_kind from public.documents
  where id = p_document_id and current_version_id = p_version_id and deleted_at is null
  for update;
  if not found or private.deletion_document_fenced(p_document_id) then
    raise exception 'Upload version is no longer current' using errcode = 'PT409';
  end if;
  -- Dedicated uploads have their own authority and scan checks.
  if document_kind = 'invoice'
    or exists (select 1 from private.academy_course_material_intake where version_id = p_version_id) then
    raise insufficient_privilege;
  end if;

  select status, sha256, scanner_version into version_status, recorded_hash, recorded_scanner
  from public.document_versions
  where id = p_version_id and document_id = p_document_id and uploaded_by = uploader_id
  for update;
  if not found then raise insufficient_privilege; end if;
  -- Repeating an already recorded verdict never emits a second audit event.
  if document_status = 'clean' and version_status = 'clean'
    and recorded_hash = p_sha256 and recorded_scanner is not null then
    return;
  end if;
  if document_status <> 'scanning' or version_status <> 'scanning' then
    raise exception 'Upload scan state changed' using errcode = '55000';
  end if;

  update public.document_versions
    set status = 'clean', sha256 = p_sha256, scanner_version = p_scanner_version
    where id = p_version_id;
  if not found then raise exception 'Upload version update failed' using errcode = '55000'; end if;
  update public.documents set status = 'clean' where id = p_document_id;
  if not found then raise exception 'Upload document update failed' using errcode = '55000'; end if;
  insert into public.audit_events(actor_id, action, resource_id)
    values (uploader_id, 'document.scan_clean', p_document_id);
end;
$$;

-- PostgREST reaches the service-only wrapper. Browser roles cannot record a scan.
create function public.complete_document_upload(
  p_document_id uuid, p_version_id uuid, p_lease_id uuid,
  p_sha256 text, p_scanner_version text
) returns void language sql security invoker set search_path = '' as $$
  select private.complete_document_upload(p_document_id, p_version_id, p_lease_id, p_sha256, p_scanner_version);
$$;

revoke all on function private.complete_document_upload(uuid, uuid, uuid, text, text),
  public.complete_document_upload(uuid, uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function private.complete_document_upload(uuid, uuid, uuid, text, text),
  public.complete_document_upload(uuid, uuid, uuid, text, text) to service_role;

notify pgrst, 'reload schema';
commit;
