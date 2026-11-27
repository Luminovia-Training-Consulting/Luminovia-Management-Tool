-- Record format validation honestly while preserving the exact-version
-- publication contract for both Academy editions and historical scan receipts.
begin;

create function private.is_academy_format_receipt(p_receipt text)
returns boolean language sql stable set search_path = '' as $$
  select case when p_receipt = 'Academy file validation v1 (no malware scan)' then coalesce(
    (select edition in ('customer-managed', 'customer-self-hosted')
       from private.installation_identity where singleton), false)
    else false
  end;
$$;

create function private.accepts_file_validation_receipt(p_receipt text)
returns boolean language sql stable set search_path = '' as $$
  select case when p_receipt like 'ClamAV %' then true
    else private.is_academy_format_receipt(p_receipt)
  end;
$$;

-- Trusted publication and owning access functions execute as their existing
-- owners. Browser and service roles cannot use these helpers directly.
revoke all on function private.is_academy_format_receipt(text),
  private.accepts_file_validation_receipt(text) from public, anon, authenticated, service_role;

-- Work from exact current definitions so previously installed access, digest,
-- lease and lifecycle checks survive the forward migration.
do $migration$
declare
  change record;
  definition text;
begin
  for change in select * from (values
    ('private.complete_document_upload(uuid,uuid,uuid,text,text)',
      $old$p_scanner_version not like 'ClamAV %'$old$,
      $new$not private.accepts_file_validation_receipt(p_scanner_version)$new$),
    ('private.complete_document_upload(uuid,uuid,uuid,text,text)',
      $old$'document.scan_clean'$old$,
      $new$case when private.is_academy_format_receipt(p_scanner_version)
        then 'document.format_validated' else 'document.scan_clean' end$new$),
    ('private.academy_course_material_scan(uuid,uuid,text,uuid,text,text)',
      $old$p_scanner_version not like 'ClamAV %'$old$,
      $new$not private.accepts_file_validation_receipt(p_scanner_version)
       or (p_action = 'rejected' and private.is_academy_format_receipt(p_scanner_version))$new$),
    ('private.academy_course_material_scan(uuid,uuid,text,uuid,text,text)',
      $old$'document.scan_' || p_action$old$,
      $new$case when private.is_academy_format_receipt(p_scanner_version)
        then 'document.format_validated' else 'document.scan_' || p_action end$new$),
    ('private.course_submission_scan(uuid,uuid,text,uuid,text,text)',
      $old$p_scanner_version not like 'ClamAV %'$old$,
      $new$not private.accepts_file_validation_receipt(p_scanner_version)
       or (p_action = 'rejected' and private.is_academy_format_receipt(p_scanner_version))$new$),
    ('private.course_submission_scan(uuid,uuid,text,uuid,text,text)',
      $old$'document.scan_' || p_action$old$,
      $new$case when private.is_academy_format_receipt(p_scanner_version)
        then 'document.format_validated' else 'document.scan_' || p_action end$new$),
    ('private.academy_attendance_evidence_version(uuid,uuid,uuid)',
      $old$version.scanner_version like 'ClamAV %'$old$,
      $new$private.accepts_file_validation_receipt(version.scanner_version)$new$),
    ('private.course_chat_attachment(uuid)',
      $old$v.scanner_version like 'ClamAV %'$old$,
      $new$private.accepts_file_validation_receipt(v.scanner_version)$new$),
    ('private.send_message(uuid,text,uuid,uuid)',
      $old$version.scanner_version like 'ClamAV %'$old$,
      $new$private.accepts_file_validation_receipt(version.scanner_version)$new$),
    ('private.course_h5p_clean_package(uuid)',
      $old$version.scanner_version like 'ClamAV %'$old$,
      $new$private.accepts_file_validation_receipt(version.scanner_version)$new$),
    ('private.course_scorm_clean_package(uuid)',
      $old$version.scanner_version like 'ClamAV %'$old$,
      $new$private.accepts_file_validation_receipt(version.scanner_version)$new$),
    ('private.learning_portfolio_evidence_file(uuid,uuid)',
      $old$version.scanner_version like 'ClamAV %'$old$,
      $new$private.accepts_file_validation_receipt(version.scanner_version)$new$)
  ) as changes(signature, old_text, new_text)
  loop
    definition := pg_catalog.pg_get_functiondef(change.signature::regprocedure);
    if cardinality(string_to_array(definition, change.old_text)) <> 2 then
      raise exception 'Unexpected file verification definition: %', change.signature;
    end if;
    execute replace(definition, change.old_text, change.new_text);
  end loop;
end;
$migration$;

commit;
