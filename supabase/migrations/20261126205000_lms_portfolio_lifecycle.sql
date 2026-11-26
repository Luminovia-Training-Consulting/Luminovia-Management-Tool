-- Let owners archive, restore and erase their own portfolio text and shares.
-- Existing entries remain active and retain all learner-authored versions.
alter table private.learning_portfolio_entries
  add column archived_at timestamptz,
  add column deleted_at timestamptz,
  add column state_revision integer not null default 0;

create or replace function private.learning_portfolio(
  p_course_id uuid default null, p_entry_id uuid default null,
  p_export boolean default false, p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  context jsonb;
  licence_status text;
  page jsonb;
  entries jsonb;
  targets jsonb := '[]'::jsonb;
begin
  if not coalesce(private.learning_actor(), false) then raise insufficient_privilege; end if;
  if (select installation.edition from private.installation_identity installation) is distinct from 'internal' then
    licence_status := private.academy_course_access_status();
    if licence_status is null or licence_status not in ('active', 'grace') then raise insufficient_privilege; end if;
  end if;
  if p_export is null or p_offset is null or p_offset < 0 or
     (p_course_id is not null and (p_entry_id is not null or p_export)) then
    raise invalid_parameter_value;
  end if;

  if p_course_id is not null then
    context := private.course_workspace_context(p_course_id);
    if not coalesce((context->>'lms_enabled')::boolean, false)
       or not coalesce((context->>'teacher')::boolean, false)
       or not private.learning_portfolio_current_teacher(p_course_id, actor) then
      raise insufficient_privilege;
    end if;
    select coalesce(jsonb_agg(to_jsonb(item) order by item.shared_at desc, item.id), '[]'::jsonb)
      into page
    from (
      select share.id, revision.title, revision.body, revision.revision, share.shared_at,
        profile.display_name as learner
      from private.learning_portfolio_shares share
      join private.learning_portfolio_revisions revision
        on revision.entry_id = share.entry_id and revision.revision = share.revision
      join private.learning_portfolio_entries entry on entry.id = share.entry_id
      join public.profiles profile on profile.id = entry.owner_id
      where share.course_id = p_course_id and share.teacher_id = actor and share.revoked_at is null
        and private.learning_portfolio_current_learner(p_course_id, entry.owner_id)
      order by share.shared_at desc, share.id offset p_offset limit 21
    ) item;
    return jsonb_build_object('shares', page - 20, 'has_more', jsonb_array_length(page) > 20);
  end if;

  if p_entry_id is not null and not exists (
    select 1 from private.learning_portfolio_entries where id = p_entry_id and owner_id = actor and deleted_at is null
  ) then raise insufficient_privilege; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', entry.id, 'archived_at', entry.archived_at, 'state_revision', entry.state_revision,
    'current', to_jsonb(current_revision) - 'entry_id',
    'history', case when p_export or p_entry_id is not null then (
      select jsonb_agg(to_jsonb(history_row) - 'entry_id' order by history_row.revision desc)
      from private.learning_portfolio_revisions history_row where history_row.entry_id = entry.id
    ) end,
    'shares', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', share.id, 'revision', share.revision, 'shared_at', share.shared_at,
        'revoked_at', share.revoked_at, 'course', template.title, 'teacher', instructor.display_name
      ) order by share.shared_at desc, share.id)
      from private.learning_portfolio_shares share
      left join public.course_runs run on run.id = share.course_id
      left join public.course_templates template on template.id = run.template_id
      left join public.profiles instructor on instructor.id = share.teacher_id
      where share.entry_id = entry.id
    ), '[]'::jsonb)
  ) order by current_revision.created_at desc, entry.id), '[]'::jsonb) into entries
  from private.learning_portfolio_entries entry
  join lateral (
    select revision.* from private.learning_portfolio_revisions revision
    where revision.entry_id = entry.id order by revision.revision desc limit 1
  ) current_revision on true
  where entry.owner_id = actor and entry.deleted_at is null
    and (p_entry_id is null or entry.id = p_entry_id);

  if not p_export and p_entry_id is null then
    select coalesce(jsonb_agg(to_jsonb(target) order by target.course, target.teacher, target.course_id), '[]'::jsonb)
      into targets
    from (
      select distinct run.id as course_id, template.title as course,
        instructor.id as teacher_id, instructor.display_name as teacher
      from public.course_enrolments enrolment
      join public.course_runs run on run.id = enrolment.course_run_id
      join public.course_templates template on template.id = run.template_id
      join public.jobs job on job.course_run_id = run.id
      join public.job_claims claim on claim.job_id = job.id and claim.status = 'confirmed'
      join public.profiles instructor on instructor.id = claim.lecturer_id
      where enrolment.user_id = actor and instructor.id <> actor
        and private.learning_portfolio_current_learner(run.id, actor)
        and private.learning_portfolio_current_teacher(run.id, instructor.id)
    ) target;
  end if;
  return jsonb_build_object('entries', entries, 'targets', targets);
end;
$$;

create or replace function private.learning_portfolio_command(
  p_entry_id uuid, p_action text, p_payload jsonb, p_expected_revision integer
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  entry private.learning_portfolio_entries;
  current_revision private.learning_portfolio_revisions;
  context jsonb;
  title_value text;
  body_value text;
  course_id_value uuid;
  teacher_id_value uuid;
  receipt uuid;
begin
  if p_entry_id is null or p_action is null or p_action not in ('save', 'share', 'revoke', 'archive', 'restore', 'delete')
     or jsonb_typeof(p_payload) is distinct from 'object'
     or p_expected_revision is null or p_expected_revision < 0 then raise invalid_parameter_value; end if;
  if (select installation.edition from private.installation_identity installation) is distinct from 'internal' then
    perform private.lock_academy_course_access();
  end if;
  perform 1 from public.profiles where id = actor and active for share;
  if not found or not coalesce(private.learning_actor(), false) then raise insufficient_privilege; end if;
  -- Serialize the owner's list cap, revision changes and receipt mutations.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('learning-portfolio:' || actor::text, 0));
  select * into entry from private.learning_portfolio_entries where id = p_entry_id for update;
  if found and entry.owner_id is distinct from actor then raise insufficient_privilege; end if;
  select * into current_revision from private.learning_portfolio_revisions
  where entry_id = p_entry_id order by revision desc limit 1;

  if p_action in ('archive', 'restore', 'delete') then
    if entry.id is null then raise insufficient_privilege; end if;
    if jsonb_typeof(p_payload->'state_revision') is distinct from 'number'
       or not (p_payload->>'state_revision' ~ '^\d{1,9}$')
       or p_payload - (case when p_action = 'delete'
          then array['state_revision','title'] else array['state_revision'] end) <> '{}'::jsonb
       then raise invalid_parameter_value; end if;
    if p_action = 'delete' and jsonb_typeof(p_payload->'title') is distinct from 'string' then
      raise invalid_parameter_value;
    end if;
    if entry.deleted_at is not null then
      if p_action = 'delete' and entry.state_revision = (p_payload->>'state_revision')::integer + 1 then
        return jsonb_build_object('deleted', true);
      end if;
      raise insufficient_privilege;
    end if;
    if current_revision.revision = p_expected_revision
       and entry.state_revision = (p_payload->>'state_revision')::integer + 1
       and ((p_action = 'archive' and entry.archived_at is not null)
         or (p_action = 'restore' and entry.archived_at is null)) then
      return jsonb_build_object('revision', current_revision.revision);
    end if;
    if entry.state_revision is distinct from (p_payload->>'state_revision')::integer
       or current_revision.revision is distinct from p_expected_revision
       then raise exception 'Portfolio entry changed' using errcode = 'PT409'; end if;
    if p_action = 'delete' then
      if entry.archived_at is null or current_revision.title is distinct from p_payload->>'title'
         then raise invalid_parameter_value; end if;
      -- Retain the opaque entry ID so a late retry cannot recreate erased versions.
      -- The revision cascade removes every share receipt and all of the owner's text.
      delete from private.learning_portfolio_revisions where entry_id = entry.id;
      update private.learning_portfolio_entries set deleted_at = clock_timestamp(),
        archived_at = null, state_revision = entry.state_revision + 1 where id = entry.id;
      return jsonb_build_object('deleted', true);
    end if;
    if p_action = 'archive' and entry.archived_at is null then
      update private.learning_portfolio_entries set archived_at = clock_timestamp(),
        state_revision = entry.state_revision + 1 where id = entry.id;
      update private.learning_portfolio_shares set revoked_at = clock_timestamp()
      where entry_id = entry.id and revoked_at is null;
    elsif p_action = 'restore' and entry.archived_at is not null then
      update private.learning_portfolio_entries set archived_at = null,
        state_revision = entry.state_revision + 1 where id = entry.id;
    end if;
    return jsonb_build_object('revision', current_revision.revision);
  end if;

  if entry.deleted_at is not null then raise insufficient_privilege; end if;
  if entry.archived_at is not null and p_action <> 'revoke' then
    raise exception 'Portfolio entry archived' using errcode = 'PT409';
  end if;

  if p_action = 'save' then
    if jsonb_typeof(p_payload->'title') is distinct from 'string'
       or jsonb_typeof(p_payload->'body') is distinct from 'string'
       or p_payload - array['title','body'] <> '{}'::jsonb then raise invalid_parameter_value; end if;
    title_value := btrim(p_payload->>'title');
    body_value := btrim(p_payload->>'body');
    if length(title_value) not between 1 and 140 or length(body_value) not between 1 and 4000
       then raise invalid_parameter_value; end if;
    if current_revision.title = title_value and current_revision.body = body_value then
      return jsonb_build_object('revision', current_revision.revision);
    end if;
    if coalesce(current_revision.revision, 0) <> p_expected_revision then
      raise exception 'Portfolio entry changed' using errcode = 'PT409';
    end if;
    if coalesce(current_revision.revision, 0) >= 30 or
       (entry.id is null and (select count(*) from private.learning_portfolio_entries where owner_id = actor and deleted_at is null) >= 40)
       then raise exception 'Portfolio limit reached' using errcode = '22023'; end if;
    if entry.id is null then insert into private.learning_portfolio_entries(id, owner_id) values (p_entry_id, actor); end if;
    insert into private.learning_portfolio_revisions(entry_id, revision, title, body)
    values (p_entry_id, p_expected_revision + 1, title_value, body_value);
    return jsonb_build_object('revision', p_expected_revision + 1);
  end if;

  if entry.id is null then raise insufficient_privilege; end if;
  if p_action = 'revoke' then
    if jsonb_typeof(p_payload->'share_id') is distinct from 'string'
       or p_payload - 'share_id' <> '{}'::jsonb then raise invalid_parameter_value; end if;
    update private.learning_portfolio_shares set revoked_at = coalesce(revoked_at, clock_timestamp())
    where id = (p_payload->>'share_id')::uuid and entry_id = p_entry_id returning id into receipt;
    if receipt is null then raise insufficient_privilege; end if;
    return jsonb_build_object('share_id', receipt);
  end if;

  if jsonb_typeof(p_payload->'course_id') is distinct from 'string'
     or jsonb_typeof(p_payload->'teacher_id') is distinct from 'string'
     or p_payload - array['course_id','teacher_id'] <> '{}'::jsonb then raise invalid_parameter_value; end if;
  course_id_value := (p_payload->>'course_id')::uuid;
  teacher_id_value := (p_payload->>'teacher_id')::uuid;
  context := private.course_workspace_context(course_id_value);
  if not coalesce((context->>'learner')::boolean,false) or actor = teacher_id_value
     or not private.learning_portfolio_current_teacher(course_id_value, teacher_id_value)
     then raise insufficient_privilege; end if;
  if current_revision.revision is distinct from p_expected_revision then
    raise exception 'Portfolio entry changed' using errcode = 'PT409';
  end if;
  select id into receipt from private.learning_portfolio_shares where entry_id = p_entry_id
    and revision = p_expected_revision and course_id = course_id_value and teacher_id = teacher_id_value
    and revoked_at is null;
  if receipt is null then
    if (select count(*) from private.learning_portfolio_shares where entry_id = p_entry_id) >= 40 then
      raise exception 'Portfolio sharing limit reached' using errcode = '22023';
    end if;
    insert into private.learning_portfolio_shares(entry_id, revision, course_id, teacher_id)
    values (p_entry_id, p_expected_revision, course_id_value, teacher_id_value) returning id into receipt;
  end if;
  return jsonb_build_object('share_id', receipt);
end;
$$;
