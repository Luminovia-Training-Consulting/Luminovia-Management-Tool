BEGIN;

-- The original archive fingerprint remains the package identity. Existing
-- one-question receipts keep their position and existing bank identifiers.
alter table private.lms_h5p_question_imports
  add column package_position integer not null default 1 check (package_position between 1 and 20);
alter table private.lms_h5p_question_imports drop constraint lms_h5p_question_imports_pkey;
alter table private.lms_h5p_question_imports add primary key (organisation_id, package_sha256, package_position);

do $migration$
declare
  definition text := pg_get_functiondef('private.validate_lms_h5p_attribution(jsonb)'::regprocedure);
  allowed constant text := $list$('H5P.MultiChoice 1.16','H5P.TrueFalse 1.8')$list$;
begin
  if cardinality(string_to_array(definition, allowed)) <> 2 then
    raise exception 'Expected the H5P attribution library allowlist';
  end if;
  execute replace(definition, allowed,
    $list$('H5P.MultiChoice 1.16','H5P.TrueFalse 1.8','H5P.SingleChoiceSet 1.11','H5P.QuestionSet 1.20','H5P.QuestionSet 1.21')$list$);
end;
$migration$;

-- Both public shapes converge on one authorized package transaction. The
-- database stores normalized content only and never sees executable assets.
create function private.course_h5p_import_items(
  p_run_id uuid, p_package_hash text, p_credits jsonb, p_items jsonb, p_collection boolean
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  who uuid := auth.uid();
  context jsonb;
  course_org uuid;
  entry jsonb;
  item jsonb;
  subcontent jsonb;
  credits jsonb;
  position integer;
  item_library text;
  existing_count integer;
  imported private.lms_h5p_question_imports%rowtype;
  receipt jsonb;
  results jsonb := '[]'::jsonb;
begin
  if who is null then raise insufficient_privilege; end if;
  if p_package_hash is null or p_package_hash !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(p_items) is distinct from 'array' then raise invalid_parameter_value; end if;
  if jsonb_array_length(p_items) not between 1 and 20 then raise invalid_parameter_value; end if;

  if (select edition from private.installation_identity) = 'internal' then
    perform private.lock_course_premium(p_run_id);
  else
    perform private.lock_academy_course_access();
  end if;
  perform 1 from public.profiles where id = who and active for share;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.user_roles where user_id = who order by role for share;
  select run.organisation_id into course_org from public.course_runs run
  join public.organisations organisation on organisation.id = run.organisation_id
  where run.id = p_run_id and run.archived_at is null and organisation.archived_at is null
  for no key update of run for share of organisation;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.job_claims claim join public.jobs job on job.id = claim.job_id
    where job.course_run_id = p_run_id and claim.lecturer_id = who and claim.status = 'confirmed' for share of claim;
  context := private.course_workspace_context(p_run_id);
  if (context->>'staff')::boolean is not true or (context->>'lms_enabled')::boolean is not true then
    raise insufficient_privilege;
  end if;

  perform private.validate_lms_h5p_attribution(p_credits);
  if p_collection is distinct from ((p_credits->>'library') in ('H5P.SingleChoiceSet 1.11','H5P.QuestionSet 1.20','H5P.QuestionSet 1.21')) then
    raise invalid_parameter_value;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'h5p-bank-import:' || course_org || ':' || p_package_hash, 0
  ));
  select count(*) into existing_count from private.lms_h5p_question_imports
  where organisation_id = course_org and package_sha256 = p_package_hash;
  if existing_count <> 0 and existing_count <> jsonb_array_length(p_items) then
    raise exception 'The declared package conflicts with the saved import' using errcode = 'PT409';
  end if;

  for entry, position in select value, ordinality::integer from jsonb_array_elements(p_items) with ordinality loop
    if jsonb_typeof(entry) is distinct from 'object' or entry - array['question','library','subcontent'] <> '{}'::jsonb
      or not (entry ?& array['question','library','subcontent'])
      or jsonb_typeof(entry->'library') is distinct from 'string' then raise invalid_parameter_value; end if;
    item_library := entry->>'library';
    item := private.validated_bank_quiz_item(entry->'question');
    subcontent := case when entry->'subcontent' <> 'null'::jsonb then entry->'subcontent' end;
    credits := p_credits;
    if subcontent is not null then
      perform private.validate_lms_h5p_attribution(subcontent);
      if not p_collection or subcontent->>'library' <> item_library then raise invalid_parameter_value; end if;
      credits := credits || jsonb_build_object('subcontent', subcontent);
    end if;
    if ((p_credits->>'library') = 'H5P.SingleChoiceSet 1.11' and (
          item_library <> 'H5P.SingleChoiceSet 1.11' or (item->>'correct')::integer <> 0
          or jsonb_array_length(item->'options') > 4 or subcontent is not null
        ))
      or ((p_credits->>'library') <> 'H5P.SingleChoiceSet 1.11'
        and item_library not in ('H5P.TrueFalse 1.8','H5P.MultiChoice 1.16'))
      or (not p_collection and item_library <> (p_credits->>'library'))
      or (item_library = 'H5P.TrueFalse 1.8' and jsonb_array_length(item->'options') <> 2)
      or exists (
        select 1 from jsonb_array_elements_text(item->'options') option_label
        group by lower(option_label) having count(*) > 1
      ) then raise invalid_parameter_value; end if;

    select * into imported from private.lms_h5p_question_imports
    where organisation_id = course_org and package_sha256 = p_package_hash and package_position = position;
    if found then
      if imported.attribution is distinct from credits or not exists (
        select 1 from private.course_bank_question_revisions
        where question_id = imported.question_id and revision = 1 and content = item
      ) then raise exception 'The declared package conflicts with the saved import' using errcode = 'PT409'; end if;
    elsif existing_count <> 0 then
      raise exception 'The declared package conflicts with the saved import' using errcode = 'PT409';
    else
      imported.question_id := gen_random_uuid();
      perform private.course_question_bank_action(p_run_id, 'save', jsonb_build_object(
        'id', imported.question_id, 'content', item, 'topic', left(p_credits->>'title', 120), 'difficulty', 'introductory'
      ), 0);
      insert into private.lms_h5p_question_imports(organisation_id, package_sha256, package_position, question_id, attribution, imported_by)
      values (course_org, p_package_hash, position, imported.question_id, credits, who);
    end if;

    select jsonb_build_object(
      'id', head.id, 'revision', definition.revision, 'content', definition.content,
      'topic', definition.topic, 'difficulty', definition.difficulty, 'archived', definition.archived,
      'can_edit', (context->>'manager')::boolean or coalesce(head.author_id = who, false),
      'h5p_attribution', credits
    ) into strict receipt
    from private.course_bank_questions head
    join private.course_bank_question_revisions definition
      on definition.question_id = head.id and definition.revision = head.revision
    where head.id = imported.question_id;
    results := results || jsonb_build_array(receipt);
  end loop;
  return results;
end;
$$;

create or replace function private.course_h5p_question_import(p_run_id uuid, p_package jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if jsonb_typeof(p_package) is distinct from 'object'
    or p_package - array['package_sha256','attribution','question'] <> '{}'::jsonb
    or jsonb_typeof(p_package->'package_sha256') is distinct from 'string'
    or octet_length(p_package::text) > 65536 then raise invalid_parameter_value; end if;
  return private.course_h5p_import_items(
    p_run_id, p_package->>'package_sha256', p_package->'attribution',
    jsonb_build_array(jsonb_build_object(
      'question', p_package->'question', 'library', p_package->'attribution'->'library', 'subcontent', null
    )), false
  )->0;
end;
$$;

create function private.course_h5p_collection_import(p_run_id uuid, p_package jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if jsonb_typeof(p_package) is distinct from 'object'
    or p_package - array['package_sha256','attribution','questions'] <> '{}'::jsonb
    or jsonb_typeof(p_package->'package_sha256') is distinct from 'string'
    or octet_length(p_package::text) > 131072 then raise invalid_parameter_value; end if;
  return jsonb_build_object('questions', private.course_h5p_import_items(
    p_run_id, p_package->>'package_sha256', p_package->'attribution', p_package->'questions', true
  ));
end;
$$;
create function public.course_h5p_collection_import(p_run_id uuid, p_package jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.course_h5p_collection_import(p_run_id, p_package);
$$;
revoke all on function private.course_h5p_import_items(uuid,text,jsonb,jsonb,boolean),
  private.course_h5p_collection_import(uuid,jsonb), public.course_h5p_collection_import(uuid,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function private.course_h5p_collection_import(uuid,jsonb), public.course_h5p_collection_import(uuid,jsonb)
  to authenticated;

do $migration$
declare
  definition text := pg_catalog.pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  anchor constant text := '''/rpc/course_h5p_question_import''';
begin
  if cardinality(string_to_array(definition, anchor)) <> 2 then raise exception 'Expected active Academy H5P write gate'; end if;
  execute replace(definition, anchor, anchor || ', ''/rpc/course_h5p_collection_import''');
end;
$migration$;

notify pgrst, 'reload schema';
COMMIT;
