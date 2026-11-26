-- Persist exact-package SCORM 1.2 core state without giving a content origin any portal credential.
begin;

alter table private.course_scorm_packages
  add column playback text not null default 'static' check (playback in ('static','runtime'));

create table private.course_scorm_runtime_state (
  version_id uuid not null references private.course_scorm_packages(version_id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  item_id text not null check (char_length(item_id) between 1 and 160),
  revision integer not null check (revision > 0),
  cmi jsonb not null check (jsonb_typeof(cmi) = 'object'),
  session_id uuid not null,
  session_elapsed_cs bigint not null check (session_elapsed_cs between 0 and 3599999999),
  total_elapsed_cs bigint not null check (total_elapsed_cs between 0 and 3599999999),
  primary key (version_id, user_id, item_id)
);
create index course_scorm_runtime_state_user on private.course_scorm_runtime_state(user_id);
alter table private.course_scorm_runtime_state enable row level security;
revoke all on private.course_scorm_runtime_state from public, anon, authenticated, service_role;

create function private.course_scorm_runtime_target(p_run_id uuid, p_version_id uuid, p_item_id text)
returns boolean language sql stable set search_path = '' as $$
  select exists (
    select 1 from private.course_scorm_packages package
    where package.run_id = p_run_id and package.version_id = p_version_id
      and package.published_at is not null and package.playback = 'runtime'
      and package.lessons @> jsonb_build_array(jsonb_build_object('id', p_item_id))
      and private.course_scorm_clean_package(package.version_id) is not null
  );
$$;

create function private.read_course_scorm_runtime(p_run_id uuid, p_version_id uuid, p_item_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  context jsonb := private.course_submission_context(p_run_id);
  learner boolean := (context->>'learner')::boolean is true;
  staff boolean := (context->>'staff')::boolean is true;
  saved private.course_scorm_runtime_state;
begin
  if auth.uid() is null or not (staff or learner)
    or not private.course_scorm_runtime_target(p_run_id, p_version_id, p_item_id) then
    raise insufficient_privilege;
  end if;
  if learner then
    select * into saved from private.course_scorm_runtime_state state
      where state.version_id = p_version_id and state.user_id = auth.uid() and state.item_id = p_item_id;
  end if;
  return jsonb_build_object(
    'revision', coalesce(saved.revision, 0),
    'cmi', coalesce(saved.cmi, '{}'::jsonb),
    'total_elapsed_cs', coalesce(saved.total_elapsed_cs, 0),
    'student_id', case when learner then encode(extensions.digest(
      'scorm-v1:' || p_run_id::text || ':' || p_version_id::text || ':' || auth.uid()::text, 'sha256'), 'hex') else 'preview' end,
    'can_write', learner and private.course_submission_write_enabled()
  );
end;
$$;

create function private.save_course_scorm_runtime(
  p_run_id uuid, p_version_id uuid, p_item_id text, p_session_id uuid, p_expected_revision integer, p_cmi jsonb
) returns integer language plpgsql security definer set search_path = '' as $$
declare
  context jsonb := private.lock_course_submission_settings_actor(p_run_id);
  who uuid := auth.uid();
  saved private.course_scorm_runtime_state;
  time_code text;
  elapsed bigint;
  new_total bigint;
  new_revision integer;
  element record;
begin
  if who is null or (context->>'learner')::boolean is not true
    or private.course_submission_write_enabled() is not true then raise insufficient_privilege; end if;
  perform 1 from private.course_scorm_packages package
    where package.run_id = p_run_id and package.version_id = p_version_id for update;
  if not found or not private.course_scorm_runtime_target(p_run_id, p_version_id, p_item_id) then
    raise insufficient_privilege;
  end if;
  perform 1 from public.course_enrolments enrolment
    where enrolment.course_run_id = p_run_id and enrolment.user_id = who
      and enrolment.status in ('enrolled','completed') for share;
  if not found then raise insufficient_privilege; end if;
  if p_session_id is null or p_expected_revision is null or p_expected_revision < 0
    or jsonb_typeof(p_cmi) is distinct from 'object' or octet_length(p_cmi::text) > 28000
    or not (p_cmi ?& array[
    'cmi.core.lesson_status', 'cmi.core.lesson_location', 'cmi.suspend_data',
    'cmi.core.score.raw', 'cmi.core.score.min', 'cmi.core.score.max', 'cmi.core.exit', 'cmi.core.session_time']) then
    raise invalid_parameter_value;
  end if;
  for element in select key, value #>> '{}' as text_value, jsonb_typeof(value) as data_type from jsonb_each(p_cmi)
  loop
    if element.data_type <> 'string' or not (case
      when element.key = 'cmi.core.lesson_status' then element.text_value in ('passed','completed','failed','incomplete','browsed','not attempted')
      when element.key = 'cmi.core.lesson_location' then char_length(element.text_value) <= 255
      when element.key = 'cmi.suspend_data' then char_length(element.text_value) <= 4096
      when element.key = 'cmi.core.exit' then element.text_value in ('','time-out','suspend','logout')
      when element.key = 'cmi.core.session_time' then element.text_value ~ '^[0-9]{2,4}:[0-5][0-9]:[0-5][0-9](\.[0-9]{1,2})?$'
      when element.key in ('cmi.core.score.raw', 'cmi.core.score.min', 'cmi.core.score.max') then
        element.text_value = '' or case when element.text_value ~ '^([0-9]{1,3}(\.[0-9]{1,7})?|\.[0-9]{1,7})$'
          then element.text_value::numeric <= 100 else false end
      else false end) then raise invalid_parameter_value; end if;
  end loop;
  select * into saved from private.course_scorm_runtime_state state
    where state.version_id = p_version_id and state.user_id = who and state.item_id = p_item_id for update;
  if coalesce(saved.revision, 0) <> p_expected_revision then
    raise exception 'SCORM runtime state changed' using errcode = 'PT409';
  end if;
  time_code := p_cmi->>'cmi.core.session_time';
  elapsed := split_part(time_code, ':', 1)::bigint * 360000 +
    split_part(time_code, ':', 2)::bigint * 6000 +
    (split_part(time_code, ':', 3)::numeric * 100)::bigint;
  if saved.session_id = p_session_id then
    elapsed := greatest(elapsed, saved.session_elapsed_cs);
    new_total := saved.total_elapsed_cs + elapsed - saved.session_elapsed_cs;
  else
    new_total := coalesce(saved.total_elapsed_cs, 0) + elapsed;
  end if;
  insert into private.course_scorm_runtime_state(version_id, user_id, item_id, revision, cmi, session_id, session_elapsed_cs, total_elapsed_cs)
    values(p_version_id, who, p_item_id, p_expected_revision + 1, p_cmi - 'cmi.core.session_time',
      p_session_id, elapsed, least(new_total, 3599999999))
  on conflict (version_id, user_id, item_id) do update
    set revision = excluded.revision, cmi = excluded.cmi, session_id = excluded.session_id,
        session_elapsed_cs = excluded.session_elapsed_cs, total_elapsed_cs = excluded.total_elapsed_cs
  returning revision into new_revision;
  if p_cmi->>'cmi.core.lesson_status' in ('passed','completed') then
    insert into private.course_scorm_progress(version_id, user_id, item_id)
      values (p_version_id, who, p_item_id) on conflict do nothing;
  end if;
  return new_revision;
end;
$$;

create function public.read_course_scorm_runtime(p_run_id uuid, p_version_id uuid, p_item_id text)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.read_course_scorm_runtime(p_run_id, p_version_id, p_item_id);
$$;
create function public.save_course_scorm_runtime(
  p_run_id uuid, p_version_id uuid, p_item_id text, p_session_id uuid, p_expected_revision integer, p_cmi jsonb
) returns integer language sql security invoker set search_path = '' as $$
  select private.save_course_scorm_runtime(p_run_id, p_version_id, p_item_id, p_session_id, p_expected_revision, p_cmi);
$$;

revoke all on function private.course_scorm_runtime_target(uuid,uuid,text),
  private.read_course_scorm_runtime(uuid,uuid,text), public.read_course_scorm_runtime(uuid,uuid,text),
  private.save_course_scorm_runtime(uuid,uuid,text,uuid,integer,jsonb),
  public.save_course_scorm_runtime(uuid,uuid,text,uuid,integer,jsonb) from public, anon, authenticated, service_role;
grant execute on function private.read_course_scorm_runtime(uuid,uuid,text), public.read_course_scorm_runtime(uuid,uuid,text),
  private.save_course_scorm_runtime(uuid,uuid,text,uuid,integer,jsonb),
  public.save_course_scorm_runtime(uuid,uuid,text,uuid,integer,jsonb) to authenticated;

-- Keep older clients' static package response intact. Runtime writes use a separate command.
do $migration$
declare
  item record;
  definition text;
begin
  for item in select * from (values
    ('private.course_scorm_packages(uuid)',
      $old$'[]'::jsonb)) order by package.published_at$old$,
      $new$'[]'::jsonb)) || case when package.playback = 'runtime' then '{"playback":"runtime"}'::jsonb else '{}'::jsonb end order by package.published_at$new$),
    ('private.course_scorm_action(uuid,uuid,text,jsonb)',
      $old$array['sha256','title','lessons'] <> '{}'::jsonb$old$,
      $new$array['sha256','title','lessons','playback'] <> '{}'::jsonb
      or (p_payload ? 'playback' and p_payload->'playback' is distinct from '"runtime"'::jsonb)$new$),
    ('private.course_scorm_action(uuid,uuid,text,jsonb)',
      $old$package.lessons is not distinct from publication_lessons then return true;$old$,
      $new$package.lessons is not distinct from publication_lessons
        and package.playback = coalesce(p_payload->>'playback','static') then return true;$new$),
    ('private.course_scorm_action(uuid,uuid,text,jsonb)',
      $old$set title = publication_title, lessons = publication_lessons, published_at = now()$old$,
      $new$set title = publication_title, lessons = publication_lessons, published_at = now(),
      playback = coalesce(p_payload->>'playback','static')$new$),
    ('private.course_scorm_action(uuid,uuid,text,jsonb)',
      $old$item := p_payload->>'item_id';$old$,
      $new$if package.playback <> 'static' then raise invalid_parameter_value; end if;
    item := p_payload->>'item_id';$new$),
    ('private.require_academy_course_access()',
      $old$'/rpc/course_scorm_download'$old$,
      $new$'/rpc/course_scorm_download', '/rpc/read_course_scorm_runtime'$new$),
    ('private.require_academy_course_access()',
      $old$'/rpc/course_scorm_action'$old$,
      $new$'/rpc/course_scorm_action', '/rpc/save_course_scorm_runtime'$new$),
    ('private.require_portal_access()',
      $old$'/rpc/course_scorm_download'$old$,
      $new$'/rpc/course_scorm_download', '/rpc/read_course_scorm_runtime'$new$),
    ('private.require_portal_access()',
      $old$'/rpc/course_scorm_action'$old$,
      $new$'/rpc/course_scorm_action', '/rpc/save_course_scorm_runtime'$new$)
  ) as anchors(signature, old_text, new_text)
  loop
    definition := pg_get_functiondef(item.signature::regprocedure);
    if cardinality(string_to_array(definition, item.old_text)) <> 2 then
      raise exception 'Expected one SCORM runtime integration boundary in %', item.signature;
    end if;
    execute replace(definition, item.old_text, item.new_text);
  end loop;
end;
$migration$;

notify pgrst, 'reload schema';
commit;
