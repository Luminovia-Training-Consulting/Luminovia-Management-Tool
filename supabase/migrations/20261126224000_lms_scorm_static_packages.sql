BEGIN;

alter table public.documents drop constraint documents_kind_check;
alter table public.documents add constraint documents_kind_check check (kind in (
  'material','chat','cv','certificate','contract','invoice','avatar','participant_submission',
  'organisation_contract','portfolio_evidence','scorm_package'
));
alter table public.documents add constraint scorm_package_document_check
  check (kind <> 'scorm_package' or (scope = 'personal' and mime_type = 'application/zip' and size_bytes between 4 and 10485760));

-- The exact scanned version is the package identity. Upload reservations are private
-- until the authenticated author separately publishes the reviewed package.
create table private.course_scorm_packages (
  version_id uuid primary key references public.document_versions(id) on delete cascade,
  run_id uuid not null references public.course_runs(id) on delete cascade,
  expected_sha256 text not null check (expected_sha256 ~ '^[0-9a-f]{64}$'),
  title text,
  lessons jsonb,
  published_at timestamptz,
  withdrawn_at timestamptz,
  check ((published_at is null and title is null and lessons is null and withdrawn_at is null)
    or (published_at is not null and title is not null and lessons is not null)),
  check (title is null or char_length(title) between 1 and 200),
  check (lessons is null or (jsonb_typeof(lessons) = 'array' and jsonb_array_length(lessons) between 1 and 100))
);
create index course_scorm_packages_run on private.course_scorm_packages(run_id);
create table private.course_scorm_progress (
  version_id uuid not null references private.course_scorm_packages(version_id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  item_id text not null,
  completed_at timestamptz not null default now(),
  primary key (version_id, user_id, item_id)
);
create index course_scorm_progress_user on private.course_scorm_progress(user_id);
alter table private.course_scorm_packages enable row level security;
alter table private.course_scorm_progress enable row level security;
revoke all on private.course_scorm_packages, private.course_scorm_progress from public, anon, authenticated, service_role;

-- Normal uploads and Files RLS stay closed to ZIPs and dedicated course packages.
do $migration$
declare
  item record;
  definition text;
begin
  for item in select * from (values
    ('private.can_access_document(uuid)',
      $old$d.kind in ('participant_submission', 'organisation_contract', 'portfolio_evidence')$old$,
      $new$d.kind in ('participant_submission', 'organisation_contract', 'portfolio_evidence', 'scorm_package')$new$),
    ('private.reserve_document(text,text,bigint,text,text,uuid,uuid,uuid,uuid,uuid)',
      $old$p_kind in ('participant_submission','portfolio_evidence')$old$,
      $new$p_kind in ('participant_submission','portfolio_evidence','scorm_package')$new$),
    ('private.reserve_document_before_contract_owner(text,text,bigint,text,text,uuid,uuid,uuid,uuid,uuid)',
      $old$if p_mime not in ($old$,
      $new$if not (p_kind = 'scorm_package' and p_mime = 'application/zip') and p_mime not in ($new$),
    ('private.reserve_document_before_contract_owner(text,text,bigint,text,text,uuid,uuid,uuid,uuid,uuid)',
      $old$p_kind = 'portfolio_evidence' and d.kind = p_kind$old$,
      $new$p_kind in ('portfolio_evidence','scorm_package') and d.kind = p_kind$new$)
  ) as replacements(signature, old_text, new_text)
  loop
    definition := pg_get_functiondef(item.signature::regprocedure);
    if cardinality(string_to_array(definition, item.old_text)) <> 2 then
      raise exception 'Expected one SCORM document guard point in %', item.signature;
    end if;
    execute replace(definition, item.old_text, item.new_text);
  end loop;
end;
$migration$;

create function private.reserve_course_scorm_package(
  p_run_id uuid, p_name text, p_size bigint, p_client_id uuid, p_sha256 text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  context jsonb := private.lock_course_submission_settings_actor(p_run_id);
  reservation jsonb;
  bound private.course_scorm_packages;
begin
  if (context->>'staff')::boolean is not true or private.course_submission_write_enabled() is not true then
    raise insufficient_privilege;
  end if;
  if p_size is null or p_size not between 4 and 10485760 or p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$'
    or p_client_id is null or p_name is null or p_name !~* '\.zip$' then raise invalid_parameter_value; end if;
  reservation := private.reserve_document_before_contract_owner(
    p_name, 'application/zip', p_size, 'personal', 'scorm_package', null, null, p_client_id, null, null
  );
  select * into bound from private.course_scorm_packages where version_id = (reservation->>'version_id')::uuid;
  if not found then
    insert into private.course_scorm_packages(version_id, run_id, expected_sha256)
      values ((reservation->>'version_id')::uuid, p_run_id, p_sha256);
  elsif bound.run_id <> p_run_id or bound.expected_sha256 <> p_sha256 or bound.withdrawn_at is not null then
    raise exception 'SCORM upload changed' using errcode = 'PT409';
  end if;
  return reservation;
end;
$$;

-- Scope metadata for the upload gateway to the still-authorized original uploader.
create function private.course_scorm_upload_status(p_run_id uuid, p_document_id uuid, p_version_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  context jsonb := private.course_submission_context(p_run_id);
begin
  if (context->>'staff')::boolean is not true or private.course_submission_write_enabled() is not true then
    raise insufficient_privilege;
  end if;
  return (
    select jsonb_build_object('document', to_jsonb(document), 'sha256', package.expected_sha256)
      from private.course_scorm_packages package
      join public.document_versions version on version.id = package.version_id
      join public.documents document on document.id = version.document_id and document.current_version_id = version.id
      where package.run_id = p_run_id and package.version_id = p_version_id and package.withdrawn_at is null
        and document.id = p_document_id and document.kind = 'scorm_package' and document.deleted_at is null
        and document.owner_id = auth.uid() and version.uploaded_by = auth.uid()
        and not private.deletion_document_fenced(document.id)
  );
end;
$$;

-- The same exact-version projection governs catalogue reads, progress and downloads.
create function private.course_scorm_clean_package(p_version_id uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('version_id', version.id, 'size_bytes', version.size_bytes,
    'sha256', version.sha256, 'name', version.original_name)
  from private.course_scorm_packages package
  join public.document_versions version on version.id = package.version_id
  join public.documents document on document.id = version.document_id and document.current_version_id = version.id
  where version.id = p_version_id and package.withdrawn_at is null and document.kind = 'scorm_package'
    and document.deleted_at is null and not private.deletion_document_fenced(document.id)
    and document.status = 'clean' and version.status = 'clean' and version.mime_type = 'application/zip'
    and version.sha256 = package.expected_sha256 and version.scanner_version like 'ClamAV %';
$$;

create function private.course_scorm_packages(p_run_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  context jsonb := private.course_submission_context(p_run_id);
  learner boolean := (context->>'learner')::boolean is true;
  staff boolean := (context->>'staff')::boolean is true;
begin
  if not (staff or learner) then raise insufficient_privilege; end if;
  return jsonb_build_object('can_publish', staff and private.course_submission_write_enabled(),
    'can_complete', learner and private.course_submission_write_enabled(),
    'packages', coalesce((
      select jsonb_agg(jsonb_build_object('id', package.version_id, 'title', package.title,
        'sha256', package.expected_sha256, 'lessons', package.lessons,
        'completed', coalesce((select jsonb_agg(progress.item_id order by progress.item_id)
          from private.course_scorm_progress progress where progress.version_id = package.version_id
            and progress.user_id = auth.uid()), '[]'::jsonb)) order by package.published_at desc, package.version_id)
      from private.course_scorm_packages package
      where package.run_id = p_run_id and package.published_at is not null
        and private.course_scorm_clean_package(package.version_id) is not null
    ), '[]'::jsonb));
end;
$$;

create function private.course_scorm_download(p_run_id uuid, p_version_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  context jsonb := private.course_submission_context(p_run_id);
  grant_data jsonb;
begin
  if (context->>'staff')::boolean is not true and (context->>'learner')::boolean is not true then
    raise insufficient_privilege;
  end if;
  select private.course_scorm_clean_package(version_id) into grant_data from private.course_scorm_packages
  where run_id = p_run_id and version_id = p_version_id and published_at is not null;
  if grant_data is null then raise insufficient_privilege; end if;
  return grant_data;
end;
$$;

create function private.course_scorm_action(p_run_id uuid, p_version_id uuid, p_action text, p_payload jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  context jsonb := private.lock_course_submission_settings_actor(p_run_id);
  package private.course_scorm_packages;
  publication_title text;
  publication_lessons jsonb;
  item text;
begin
  if private.course_submission_write_enabled() is not true then raise insufficient_privilege; end if;
  if p_action is null or p_action not in ('publish','withdraw','complete') or
    jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text) > 140000 then
    raise invalid_parameter_value;
  end if;
  if (p_action = 'complete' and (context->>'learner')::boolean is not true)
    or (p_action <> 'complete' and (context->>'staff')::boolean is not true) then raise insufficient_privilege; end if;
  select * into package from private.course_scorm_packages where run_id = p_run_id and version_id = p_version_id for update;
  if not found then raise insufficient_privilege; end if;
  if p_action = 'withdraw' and p_payload = '{}'::jsonb and package.withdrawn_at is not null then return true; end if;
  if private.course_scorm_clean_package(package.version_id) is null then raise insufficient_privilege; end if;

  if p_action = 'publish' then
    publication_title := btrim(p_payload->>'title');
    publication_lessons := p_payload->'lessons';
    if p_payload - array['sha256','title','lessons'] <> '{}'::jsonb
      or p_payload->>'sha256' is distinct from package.expected_sha256
      or jsonb_typeof(p_payload->'title') is distinct from 'string'
      or char_length(publication_title) not between 1 and 200
      or jsonb_typeof(publication_lessons) is distinct from 'array' then raise invalid_parameter_value; end if;
    if jsonb_array_length(publication_lessons) not between 1 and 100 or exists (
      select 1 from jsonb_array_elements(publication_lessons) lesson(value)
      where jsonb_typeof(value) is distinct from 'object' or value - array['id','title'] <> '{}'::jsonb
        or jsonb_typeof(value->'id') is distinct from 'string' or char_length(value->>'id') not between 1 and 160
        or jsonb_typeof(value->'title') is distinct from 'string' or char_length(btrim(value->>'title')) not between 1 and 200
    ) or (select count(distinct value->>'id') from jsonb_array_elements(publication_lessons)) <> jsonb_array_length(publication_lessons)
      then raise invalid_parameter_value; end if;
    if package.published_at is not null then
      if package.title is not distinct from publication_title and package.lessons is not distinct from publication_lessons then return true; end if;
      raise exception 'SCORM publication is immutable' using errcode = 'PT409';
    end if;
    if (select count(*) from private.course_scorm_packages where run_id = p_run_id and published_at is not null and withdrawn_at is null) >= 20 then
      raise exception 'Course SCORM publication limit reached' using errcode = 'PT409';
    end if;
    update private.course_scorm_packages set title = publication_title, lessons = publication_lessons, published_at = now()
      where version_id = package.version_id;
  elsif p_action = 'withdraw' then
    if p_payload <> '{}'::jsonb or package.published_at is null then raise invalid_parameter_value; end if;
    update private.course_scorm_packages set withdrawn_at = now() where version_id = package.version_id;
  else
    item := p_payload->>'item_id';
    if p_payload - 'item_id' <> '{}'::jsonb or jsonb_typeof(p_payload->'item_id') is distinct from 'string'
      or package.published_at is null or not (package.lessons @> jsonb_build_array(jsonb_build_object('id', item)))
      then raise invalid_parameter_value; end if;
    perform 1 from public.course_enrolments where course_run_id = p_run_id and user_id = auth.uid()
      and status in ('enrolled','completed') for share;
    if not found then raise insufficient_privilege; end if;
    insert into private.course_scorm_progress(version_id, user_id, item_id) values (package.version_id, auth.uid(), item)
      on conflict do nothing;
  end if;
  if p_action in ('publish','withdraw') then
    insert into public.audit_events(actor_id,action,resource_id,details)
      values(auth.uid(),'course.scorm_' || p_action,p_run_id,jsonb_build_object('version_id',package.version_id));
  end if;
  return true;
end;
$$;

create function public.reserve_course_scorm_package(p_run_id uuid,p_name text,p_size bigint,p_client_id uuid,p_sha256 text)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.reserve_course_scorm_package(p_run_id,p_name,p_size,p_client_id,p_sha256);
$$;
create function public.course_scorm_upload_status(p_run_id uuid,p_document_id uuid,p_version_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.course_scorm_upload_status(p_run_id,p_document_id,p_version_id);
$$;
create function public.course_scorm_packages(p_run_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.course_scorm_packages(p_run_id);
$$;
create function public.course_scorm_download(p_run_id uuid,p_version_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.course_scorm_download(p_run_id,p_version_id);
$$;
create function public.course_scorm_action(p_run_id uuid,p_version_id uuid,p_action text,p_payload jsonb)
returns boolean language sql security invoker set search_path = '' as $$
  select private.course_scorm_action(p_run_id,p_version_id,p_action,p_payload);
$$;

revoke all on function private.course_scorm_clean_package(uuid),
  private.reserve_course_scorm_package(uuid,text,bigint,uuid,text), public.reserve_course_scorm_package(uuid,text,bigint,uuid,text),
  private.course_scorm_upload_status(uuid,uuid,uuid), public.course_scorm_upload_status(uuid,uuid,uuid),
  private.course_scorm_packages(uuid), public.course_scorm_packages(uuid),
  private.course_scorm_download(uuid,uuid), public.course_scorm_download(uuid,uuid),
  private.course_scorm_action(uuid,uuid,text,jsonb), public.course_scorm_action(uuid,uuid,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function
  private.reserve_course_scorm_package(uuid,text,bigint,uuid,text), public.reserve_course_scorm_package(uuid,text,bigint,uuid,text),
  private.course_scorm_upload_status(uuid,uuid,uuid), public.course_scorm_upload_status(uuid,uuid,uuid),
  private.course_scorm_packages(uuid), public.course_scorm_packages(uuid),
  private.course_scorm_download(uuid,uuid), public.course_scorm_download(uuid,uuid),
  private.course_scorm_action(uuid,uuid,text,jsonb), public.course_scorm_action(uuid,uuid,text,jsonb) to authenticated;

do $migration$
declare
  academy text := pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  portal text := pg_get_functiondef('private.require_portal_access()'::regprocedure);
  promotion text := pg_get_functiondef('private.complete_document_upload(uuid,uuid,uuid,text,text)'::regprocedure);
  read_anchor constant text := '''/rpc/learning_portfolio_evidence_access''';
  write_anchor constant text := '''/rpc/learning_portfolio_evidence_upload_status''';
  promotion_anchor constant text := '  select uploaded_by into uploader_id from public.document_versions';
begin
  if cardinality(string_to_array(academy, read_anchor)) <> 2
    or cardinality(string_to_array(academy, write_anchor)) <> 2
    or cardinality(string_to_array(portal, read_anchor)) <> 2
    or cardinality(string_to_array(portal, write_anchor)) <> 2
    or cardinality(string_to_array(promotion, promotion_anchor)) <> 2 then
    raise exception 'Expected SCORM gateway integration boundaries';
  end if;
  execute replace(replace(academy, read_anchor, read_anchor || ', ''/rpc/course_scorm_packages'', ''/rpc/course_scorm_download'''),
    write_anchor, write_anchor || ', ''/rpc/reserve_course_scorm_package'', ''/rpc/course_scorm_upload_status'', ''/rpc/course_scorm_action''');
  execute replace(replace(portal, read_anchor, read_anchor || ', ''/rpc/course_scorm_packages'', ''/rpc/course_scorm_download'''),
    write_anchor, write_anchor || ', ''/rpc/reserve_course_scorm_package'', ''/rpc/course_scorm_upload_status'', ''/rpc/course_scorm_action''');
  execute replace(promotion, promotion_anchor, $guard$
  if exists (select 1 from private.course_scorm_packages where version_id = p_version_id) then
    if not exists (select 1 from private.course_scorm_packages where version_id = p_version_id
      and expected_sha256 = p_sha256 and withdrawn_at is null) then raise invalid_parameter_value; end if;
    if (select edition from private.installation_identity) is distinct from 'internal' then
      perform private.lock_academy_course_access();
    end if;
  end if;
$guard$ || promotion_anchor);
end;
$migration$;

notify pgrst, 'reload schema';
COMMIT;
