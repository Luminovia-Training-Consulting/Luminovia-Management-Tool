begin;

create table private.table_import_receipts (
  actor_id uuid not null references auth.users(id) on delete cascade,
  row_key uuid not null,
  fingerprint bytea not null,
  primary key (actor_id, row_key)
);

alter table private.table_import_receipts enable row level security;
revoke all on private.table_import_receipts from public, anon, authenticated;

create function private.import_table_row(p_row_key uuid, p_kind text, p_scope uuid, p_payload jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  row_fingerprint bytea := sha256(convert_to(jsonb_build_array(p_kind, p_scope, p_payload)::text, 'UTF8'));
  learner uuid;
begin
  if actor is null or not private.actor_active() then
    raise exception 'Active account required' using errcode = '42501';
  end if;
  if (select edition from private.installation_identity) is distinct from 'internal'
      and (p_kind is distinct from 'enrolment'
        or private.academy_course_access_status() is distinct from 'active') then
    raise exception 'Import unavailable in this edition' using errcode = '42501';
  end if;
  if p_row_key is null or jsonb_typeof(p_payload) is distinct from 'object'
      or octet_length(p_payload::text) > 65536 then
    raise exception 'Invalid import row' using errcode = '22023';
  end if;

  -- The unique receipt waits for concurrent submissions and rolls back with the write.
  insert into private.table_import_receipts values (actor, p_row_key, row_fingerprint)
    on conflict do nothing;
  if not found then
    if not exists (
      select 1 from private.table_import_receipts receipt
      where receipt.actor_id = actor and receipt.row_key = p_row_key
        and receipt.fingerprint = row_fingerprint
    ) then
      raise sqlstate 'PT409' using message = 'Import row key already used for different data';
    end if;
    return true;
  end if;

  case p_kind
    when 'course-template' then perform private.save_course_template(null, p_payload);
    when 'course-draft' then perform private.save_course_run(null, p_payload);
    when 'company' then perform private.save_organisation(null, p_payload);
    when 'contact' then perform private.save_organisation_contact(null, p_scope, p_payload);
    when 'taxonomy' then perform private.save_taxonomy_topic(null, p_payload, 0);
    when 'enrolment' then
      select candidate.user_id into learner
      from jsonb_to_recordset(public.course_enrolment_candidates(p_scope, p_payload->>'id'))
        as candidate(user_id uuid, luminovia_user_id text)
      where candidate.luminovia_user_id = p_payload->>'id';
      if not found then
        raise exception 'Eligible participant not found' using errcode = '22023';
      end if;
      perform private.manage_course_enrolment(p_scope, learner, 'enrolled');
    else raise exception 'Unsupported import kind' using errcode = '22023';
  end case;
  return true;
end;
$$;

create function public.import_table_row(p_row_key uuid, p_kind text, p_scope uuid, p_payload jsonb)
returns boolean language sql security invoker set search_path = '' as $$
  select private.import_table_row(p_row_key, p_kind, p_scope, p_payload);
$$;

create function private.search_course_materials(p_course_id uuid, p_search text, p_category text, p_offset integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  dedicated boolean := (select edition from private.installation_identity) is distinct from 'internal';
  licence text;
  needle text := lower(trim(coalesce(p_search, '')));
begin
  if not (private.actor_active() or private.participant_actor()) then
    raise exception 'Active course account required' using errcode = '42501';
  end if;
  if length(needle) > 200 or p_offset is null or p_offset < 0
      or (p_category is not null and p_category not in ('material', 'report')) then
    raise exception 'Invalid material filters' using errcode = '22023';
  end if;
  if dedicated then
    licence := private.academy_course_access_status();
    if licence is null or licence not in ('active', 'grace') then return '[]'::jsonb; end if;
  end if;

  return (
    select coalesce(jsonb_agg(to_jsonb(page) order by page.name collate "C", page.id), '[]'::jsonb)
    from (
      select resource.id, run.id as course_id, template.title as course_title,
        organisation.name as organisation_name, version.original_name as name,
        version.version, resource.category,
        (not dedicated or licence = 'active') and (
          private.has_permission('courses.manage') or
          private.client_has_organisation(run.organisation_id) or
          (private.lecturer_actor() and private.course_has_current_teacher(run.id))
        ) as can_upload
      from private.course_resources resource
      join public.course_runs run on run.id = resource.run_id
      join public.course_templates template on template.id = run.template_id
      left join public.organisations organisation on organisation.id = run.organisation_id
      join public.document_versions version on version.id = resource.version_id
      join public.documents document on document.id = version.document_id
      where run.archived_at is null and resource.removed_at is null
        and document.deleted_at is null and version.status = 'clean'
        and (not dedicated or coalesce(version.sha256 ~ '^[0-9a-f]{64}$', false))
        and (p_course_id is null or run.id = p_course_id)
        and (p_category is null or resource.category = p_category)
        and strpos(lower(version.original_name), needle) > 0
        and private.course_resource_allowed(resource.id)
      order by version.original_name collate "C", resource.id
      limit 25 offset p_offset
    ) page
  );
end;
$$;

create function public.search_course_materials(p_course_id uuid, p_search text, p_category text, p_offset integer)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.search_course_materials(p_course_id, p_search, p_category, p_offset);
$$;

revoke all on function private.import_table_row(uuid, text, uuid, jsonb),
  public.import_table_row(uuid, text, uuid, jsonb),
  private.search_course_materials(uuid, text, text, integer),
  public.search_course_materials(uuid, text, text, integer) from public, anon;
grant execute on function private.import_table_row(uuid, text, uuid, jsonb),
  public.import_table_row(uuid, text, uuid, jsonb),
  private.search_course_materials(uuid, text, text, integer),
  public.search_course_materials(uuid, text, text, integer) to authenticated;

-- Reuse the existing REST profile, actor and licence checks for both routes.
do $$
declare
  internal_gate text := pg_get_functiondef('private.require_portal_access()'::regprocedure);
  academy_gate text := pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  evaluations constant text := $t$'/rpc/course_evaluations', '/rpc/save_course_evaluation'$t$;
  licence_line constant text := '  licence_status := private.academy_course_access_status();';
begin
  if cardinality(string_to_array(internal_gate, evaluations)) <> 2
    or cardinality(string_to_array(academy_gate, licence_line)) <> 2 then
    raise exception 'Expected portal and academy REST gate definitions';
  end if;
  execute replace(internal_gate, evaluations, evaluations || $t$, '/rpc/search_course_materials'$t$);
  execute replace(academy_gate, licence_line, licence_line || $access$
  if request_method = 'POST' and (
    (licence_status in ('active', 'grace') and request_path = '/rpc/search_course_materials')
    or (licence_status = 'active' and request_path = '/rpc/import_table_row')
  ) then return; end if;$access$);
end;
$$;

notify pgrst, 'reload schema';
commit;
