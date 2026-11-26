-- Record inert H5P imports against the existing question bank, retaining
-- attribution when a course pins a question or an author revises the text.
begin;

create table private.lms_h5p_question_imports (
  organisation_id uuid not null references public.organisations(id) on delete restrict,
  package_sha256 text not null check (package_sha256 ~ '^[0-9a-f]{64}$'),
  question_id uuid not null unique references private.course_bank_questions(id) on delete restrict,
  attribution jsonb not null,
  imported_by uuid not null,
  imported_at timestamptz not null default now(),
  primary key (organisation_id, package_sha256)
);
alter table private.lms_h5p_question_imports enable row level security;
revoke all on private.lms_h5p_question_imports from public, anon, authenticated, service_role;
create trigger lms_h5p_attribution_immutable before update or delete on private.lms_h5p_question_imports
  for each row execute function private.prevent_course_bank_revision_mutation();


-- Have the database validate the declared content licence and attribution too.
-- An import receipt identifies the chosen package, not an authenticity proof.
create function private.validate_lms_h5p_attribution(p_metadata jsonb)
returns void language plpgsql immutable set search_path = '' as $$
begin
  if jsonb_typeof(p_metadata) is distinct from 'object'
    or p_metadata - array['title','language','library','license','authors','source_url','license_notice','changes'] <> '{}'::jsonb
    or not (p_metadata ?& array['title','language','library','license','authors','source_url','license_notice','changes'])
    or jsonb_typeof(p_metadata->'title') is distinct from 'string'
    or char_length(btrim(p_metadata->>'title')) not between 1 and 150
    or jsonb_typeof(p_metadata->'language') is distinct from 'string'
    or (p_metadata->>'language') !~ '^([a-z]{2}|und)$'
    or jsonb_typeof(p_metadata->'library') is distinct from 'string'
    or (p_metadata->>'library') not in ('H5P.MultiChoice 1.16','H5P.TrueFalse 1.8')
    or jsonb_typeof(p_metadata->'license') is distinct from 'string'
    or (p_metadata->>'license') not in ('CC0-1.0','CC-BY-4.0')
    or jsonb_typeof(p_metadata->'authors') is distinct from 'array'
    or jsonb_typeof(p_metadata->'changes') is distinct from 'array'
    or jsonb_typeof(p_metadata->'source_url') not in ('null','string')
    or jsonb_typeof(p_metadata->'license_notice') not in ('null','string') then
    raise exception 'Invalid or unsupported H5P attribution' using errcode = '22023';
  end if;

  if char_length(p_metadata->>'source_url') > 500 or (p_metadata->>'source_url') !~*
       '^https?://[A-Za-z0-9.-]+(:[0-9]{1,5})?([/?#][^[:space:]]*)?$'
    or strpos(p_metadata->>'source_url', chr(92)) > 0
    or char_length(p_metadata->>'license_notice') > 1000
    or jsonb_array_length(p_metadata->'authors') > 10
    or ((p_metadata->>'license') = 'CC-BY-4.0' and jsonb_array_length(p_metadata->'authors') = 0)
    or jsonb_array_length(p_metadata->'changes') > 10
    or exists (
      select 1 from jsonb_array_elements(p_metadata->'authors') author(value)
      where jsonb_typeof(value) is distinct from 'object' or value - array['name','role'] <> '{}'::jsonb
        or jsonb_typeof(value->'name') is distinct from 'string'
        or char_length(btrim(value->>'name')) not between 1 and 150
        or jsonb_typeof(value->'role') is distinct from 'string'
        or (value->>'role') not in ('Author','Editor','Licensee','Originator')
    )
    or exists (
      select 1 from jsonb_array_elements(p_metadata->'changes') entry(value)
      where jsonb_typeof(value) is distinct from 'object' or value - array['date','author','log'] <> '{}'::jsonb
        or jsonb_typeof(value->'date') is distinct from 'string'
        or char_length(btrim(value->>'date')) not between 1 and 100
        or jsonb_typeof(value->'author') is distinct from 'string'
        or char_length(btrim(value->>'author')) not between 1 and 150
        or jsonb_typeof(value->'log') is distinct from 'string'
        or char_length(btrim(value->>'log')) not between 1 and 500
    ) then raise exception 'Invalid or unsupported H5P attribution' using errcode = '22023'; end if;
end;
$$;

create function private.course_h5p_question_import(p_run_id uuid, p_package jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  who uuid := auth.uid();
  context jsonb;
  course_org uuid;
  package_hash text;
  credits jsonb;
  item jsonb;
  imported private.lms_h5p_question_imports%rowtype;
begin
  if who is null then raise insufficient_privilege; end if;
  if jsonb_typeof(p_package) is distinct from 'object'
    or p_package - array['package_sha256','attribution','question'] <> '{}'::jsonb
    or jsonb_typeof(p_package->'package_sha256') is distinct from 'string'
    or (p_package->>'package_sha256') !~ '^[0-9a-f]{64}$'
    or octet_length(p_package::text) > 65536 then raise invalid_parameter_value; end if;

  -- Match existing course edit lock order and recheck scoped authority before
  -- returning even an identical receipt from another course in the company.
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

  package_hash := p_package->>'package_sha256';
  credits := p_package->'attribution';
  perform private.validate_lms_h5p_attribution(credits);
  item := private.validated_bank_quiz_item(p_package->'question');
  if ((credits->>'library') = 'H5P.TrueFalse 1.8' and jsonb_array_length(item->'options') <> 2)
    or exists (
      select 1 from jsonb_array_elements_text(item->'options') option_label
      group by lower(option_label) having count(*) > 1
    ) then raise invalid_parameter_value; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'h5p-bank-import:' || course_org || ':' || package_hash, 0
  ));
  select * into imported from private.lms_h5p_question_imports
  where organisation_id = course_org and package_sha256 = package_hash;
  if found then
    if imported.attribution is distinct from credits or not exists (
      select 1 from private.course_bank_question_revisions
      where question_id = imported.question_id and revision = 1 and content = item
    ) then raise exception 'The declared package receipt conflicts with the saved import' using errcode = 'PT409'; end if;
  else
    imported.question_id := gen_random_uuid();
    imported.attribution := credits;
    -- Existing versioned question authorship, validation and audit stay in
    -- one command. A failure rolls back the whole receipt and question.
    perform private.course_question_bank_action(p_run_id, 'save', jsonb_build_object(
      'id', imported.question_id, 'content', item, 'topic', left(credits->>'title', 120), 'difficulty', 'introductory'
    ), 0);
    insert into private.lms_h5p_question_imports(organisation_id, package_sha256, question_id, attribution, imported_by)
    values (course_org, package_hash, imported.question_id, credits, who);
  end if;

  return (
    select jsonb_build_object(
      'id', head.id, 'revision', definition.revision, 'content', definition.content,
      'topic', definition.topic, 'difficulty', definition.difficulty, 'archived', definition.archived,
      'can_edit', (context->>'manager')::boolean or coalesce(head.author_id = who, false),
      'h5p_attribution', imported.attribution
    )
    from private.course_bank_questions head
    join private.course_bank_question_revisions definition
      on definition.question_id = head.id and definition.revision = head.revision
    where head.id = imported.question_id
  );
end;
$$;

-- Join the immutable attribution to both the current question bank and the
-- pinned quiz projection. Learner JSON still has no answer key or bank IDs.
do $migration$
declare
  bank text := pg_catalog.pg_get_functiondef('private.course_question_bank(uuid,text,boolean,integer)'::regprocedure);
  quiz text := pg_catalog.pg_get_functiondef('private.course_workspace_before_premium(uuid)'::regprocedure);
  bank_fields constant text := 'item.topic, item.difficulty, item.archived,';
  bank_join constant text := '    where head.organisation_id = company_id';
  quiz_fields constant text := '      order by item.position';
  quiz_join constant text := '      on source.run_id = p_run_id and source.quiz_version = quiz.version and source.position = item.position - 1';
begin
  if cardinality(string_to_array(bank, bank_fields)) <> 2 or cardinality(string_to_array(bank, bank_join)) <> 2
    or cardinality(string_to_array(quiz, quiz_fields)) <> 2 or cardinality(string_to_array(quiz, quiz_join)) <> 2
    then raise exception 'Expected question bank and quiz attribution projections'; end if;
  execute replace(replace(bank, bank_fields, bank_fields || ' h5p.attribution as h5p_attribution,'),
    bank_join, E'    left join private.lms_h5p_question_imports h5p on h5p.question_id = head.id\n' || bank_join);
  execute replace(replace(quiz, quiz_fields, $projection$
      || case when h5p.attribution is null then '{}'::jsonb
        else jsonb_build_object('h5p_attribution', h5p.attribution) end
$projection$ || quiz_fields), quiz_join, quiz_join ||
    E'\n    left join private.lms_h5p_question_imports h5p on h5p.question_id = source.question_id');
end;
$migration$;

create function public.course_h5p_question_import(p_run_id uuid, p_package jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.course_h5p_question_import(p_run_id, p_package);
$$;
revoke all on function private.validate_lms_h5p_attribution(jsonb),
  private.course_h5p_question_import(uuid,jsonb), public.course_h5p_question_import(uuid,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function private.course_h5p_question_import(uuid,jsonb), public.course_h5p_question_import(uuid,jsonb)
  to authenticated;

do $migration$
declare
  definition text := pg_catalog.pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  anchor constant text := '''/rpc/course_question_bank_action''';
begin
  if cardinality(string_to_array(definition, anchor)) <> 2 then raise exception 'Expected active Academy bank write gate'; end if;
  execute replace(definition, anchor, anchor || ', ''/rpc/course_h5p_question_import''');
end;
$migration$;

notify pgrst, 'reload schema';
commit;
