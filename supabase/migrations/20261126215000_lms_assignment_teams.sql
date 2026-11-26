-- Optional assignment teams share one scan-bound attempt history and one review.
BEGIN;

create table private.course_assignment_teams (
  id uuid primary key,
  assignment_id uuid not null references private.course_assignments(id) on delete cascade,
  title text not null check (length(title) between 1 and 100),
  due_at timestamptz check (due_at is null or isfinite(due_at)),
  version integer not null check (version > 0),
  unique (assignment_id, id)
);
create unique index course_assignment_team_title on private.course_assignment_teams(assignment_id, lower(title));
create table private.course_assignment_team_members (
  assignment_id uuid not null,
  team_id uuid not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (assignment_id, user_id),
  foreign key (assignment_id, team_id)
    references private.course_assignment_teams(assignment_id, id) on delete cascade
);
create index course_assignment_team_members_team on private.course_assignment_team_members(team_id);
create index course_assignment_team_members_user on private.course_assignment_team_members(user_id);

alter table private.course_assignment_teams enable row level security;
alter table private.course_assignment_team_members enable row level security;
revoke all on private.course_assignment_teams, private.course_assignment_team_members
  from public, anon, authenticated, service_role;

alter table private.course_assignment_attempts
  add column team_id uuid,
  add constraint course_assignment_attempt_team foreign key (assignment_id, team_id)
    references private.course_assignment_teams(assignment_id, id);
create unique index course_assignment_team_attempt_number
  on private.course_assignment_attempts(assignment_id, team_id, attempt_no)
  where team_id is not null;

-- Recheck current enrolment and company membership before disclosing another person's team evidence.
create function private.course_assignment_team_access(p_team uuid, p_assignment uuid, p_user uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1
    from private.course_assignment_team_members member
    join private.course_assignments assignment on assignment.id = member.assignment_id
    join public.course_runs run on run.id = assignment.run_id
    join public.course_enrolments enrolment
      on enrolment.course_run_id = run.id and enrolment.user_id = member.user_id
    where member.team_id = p_team and member.assignment_id = p_assignment and member.user_id = p_user
      and enrolment.status in ('enrolled', 'completed')
      and private.active_company_participant(p_user, run.organisation_id)
  );
$$;

-- The caller holds the course's normal upload/assignment lock. Once a team
-- has submitted, its evidence audience is frozen, subject to current enrolment.
create function private.change_course_assignment_team(
  p_run uuid, p_assignment uuid, p_action text, p_data jsonb, p_version integer
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  target_team_id uuid;
  team_title text;
  deadline timestamptz;
  current_team private.course_assignment_teams%rowtype;
  existing_members uuid[];
  members uuid[];
begin
  if jsonb_typeof(p_data->'team_id') is distinct from 'string' then raise invalid_parameter_value; end if;
  target_team_id := (p_data->>'team_id')::uuid;
  select * into current_team from private.course_assignment_teams
    where id = target_team_id and assignment_id = p_assignment;
  if coalesce(current_team.version, 0) <> p_version then
    raise exception 'Assignment team changed' using errcode = 'PT409';
  end if;

  if p_action = 'remove_team' then
    if current_team.id is null then raise insufficient_privilege; end if;
    if exists(select 1 from private.course_assignment_attempts where team_id = current_team.id) then
      raise exception 'A team with assignment evidence cannot be removed' using errcode = 'PT409';
    end if;
    delete from private.course_assignment_teams where id = current_team.id;
    return target_team_id;
  end if;

  team_title := btrim(p_data->>'title');
  if jsonb_typeof(p_data->'title') is distinct from 'string' or coalesce(length(team_title), 0) not between 1 and 100
    or jsonb_typeof(p_data->'member_ids') is distinct from 'array'
    or jsonb_typeof(p_data->'due_at') is null or jsonb_typeof(p_data->'due_at') not in ('null','string') then
    raise invalid_parameter_value;
  end if;
  if jsonb_array_length(p_data->'member_ids') not between 1 and 20 then raise invalid_parameter_value; end if;
  if p_data->>'due_at' is not null then
    if p_data->>'due_at' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' then
      raise invalid_parameter_value;
    end if;
    deadline := (p_data->>'due_at')::timestamptz;
    if not isfinite(deadline) then raise invalid_parameter_value; end if;
  end if;

  select array_agg(distinct value::uuid order by value::uuid) into members
  from jsonb_array_elements_text(p_data->'member_ids') list(value);
  if cardinality(members) <> jsonb_array_length(p_data->'member_ids') then raise invalid_parameter_value; end if;
  select coalesce(array_agg(user_id order by user_id), '{}'::uuid[]) into existing_members
  from private.course_assignment_team_members where team_id = current_team.id;

  if members is distinct from existing_members then
    if exists(select 1 from private.course_assignment_attempts where team_id = current_team.id)
      or exists (
        select 1 from private.course_assignment_attempts attempt
        where attempt.assignment_id = p_assignment and attempt.user_id = any(members) and attempt.team_id is null
      ) then
      raise exception 'Assignment team membership is frozen by submitted evidence' using errcode = 'PT409';
    end if;
    if exists (
      select 1 from unnest(members) member(user_id)
      where not exists (
        select 1 from public.course_enrolments enrolment join public.course_runs run on run.id = enrolment.course_run_id
        where run.id = p_run and enrolment.user_id = member.user_id and enrolment.status = 'enrolled'
          and private.active_company_participant(enrolment.user_id, run.organisation_id)
      )
    ) then raise insufficient_privilege; end if;
    if exists (
      select 1 from private.course_assignment_team_members member
      where member.assignment_id = p_assignment and member.user_id = any(members) and member.team_id <> target_team_id
    ) then raise exception 'A learner already belongs to another assignment team' using errcode = 'PT409'; end if;
  end if;

  if current_team.id is null then
    if (select count(*) from private.course_assignment_teams where assignment_id = p_assignment) >= 50 then
      raise exception 'Assignment team limit reached' using errcode = '54000';
    end if;
    insert into private.course_assignment_teams (id, assignment_id, title, due_at, version)
      values (target_team_id, p_assignment, team_title, deadline, 1);
  else
    update private.course_assignment_teams set title = team_title,
      due_at = deadline, version = current_team.version + 1 where id = current_team.id;
  end if;
  if members is distinct from existing_members then
    delete from private.course_assignment_team_members where course_assignment_team_members.team_id = current_team.id;
    insert into private.course_assignment_team_members (assignment_id, team_id, user_id)
      select p_assignment, target_team_id, member from unnest(members) as roster(member);
  end if;
  return target_team_id;
end;
$$;

revoke all on function private.course_assignment_team_access(uuid,uuid,uuid),
  private.change_course_assignment_team(uuid,uuid,text,jsonb,integer)
from public, anon, authenticated, service_role;

create or replace function private.can_submit_course_assignment(p_run_id uuid, p_assignment_id uuid, p_actor uuid, p_now timestamptz)
returns boolean language sql stable set search_path = '' as $$
  select exists (
    select 1
    from private.course_assignments assignment
    join private.course_assignment_definitions definition
      on (definition.assignment_id, definition.version) = (assignment.id, assignment.published_version)
    join public.course_runs run on run.id = assignment.run_id
    join public.course_enrolments enrolment
      on enrolment.course_run_id = run.id and enrolment.user_id = p_actor and enrolment.status = 'enrolled'
    left join private.course_assignment_team_members member
      on member.assignment_id = assignment.id and member.user_id = p_actor
    left join private.course_assignment_teams team on team.id = member.team_id
    left join lateral (
      select due_at from private.course_assignment_extensions
      where assignment_id = assignment.id and user_id = p_actor order by version desc limit 1
    ) extension on true
    left join lateral (
      select submitted.id, submitted.attempt_no from private.course_assignment_attempts submitted
      where submitted.assignment_id = assignment.id and (submitted.team_id = team.id
        or (team.id is null and submitted.team_id is null and submitted.user_id = p_actor))
      order by submitted.attempt_no desc limit 1
    ) attempt on true
    left join lateral (
      select state from private.course_assignment_reviews
      where attempt_id = attempt.id and state <> 'draft' order by version desc limit 1
    ) review on true
    where assignment.id = p_assignment_id and assignment.run_id = p_run_id
      and private.active_company_participant(p_actor, run.organisation_id)
      and p_now < greatest(coalesce(team.due_at, definition.due_at), extension.due_at)
      and coalesce(attempt.attempt_no, 0) < definition.max_attempts
      and (attempt.id is null or review.state = 'revision_requested')
  );
$$;

create or replace function private.course_assignments(p_run_id uuid, p_assignment_id uuid, p_offset integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  context jsonb := private.course_submission_context(p_run_id);
  staff boolean := coalesce((context->>'staff')::boolean, false);
  learner boolean := coalesce((context->>'learner')::boolean, false);
  summaries jsonb;
  detail jsonb;
begin
  if not staff and not learner then raise insufficient_privilege; end if;
  if p_offset is null or p_offset < 0 then raise invalid_parameter_value; end if;
  select coalesce(jsonb_agg(to_jsonb(summary) order by summary.title, summary.id), '[]'::jsonb) into summaries
  from (
    select a.id, d.title, d.due_at, a.published_version
    from private.course_assignments a
    join private.course_assignment_definitions d
      on d.assignment_id = a.id and d.version = case when staff then a.current_version else a.published_version end
    where a.run_id = p_run_id order by d.title, a.id limit 100
  ) summary;
  if p_assignment_id is not null then
    select to_jsonb(definition) || jsonb_build_object('published_version', a.published_version,
      'can_submit', learner and private.course_submission_write_enabled()
        and private.can_submit_course_assignment(p_run_id, a.id, auth.uid(), statement_timestamp()),
      'effective_due_at', greatest(coalesce((
        select team.due_at from private.course_assignment_team_members member
        join private.course_assignment_teams team on team.id = member.team_id
        where member.assignment_id = a.id and member.user_id = auth.uid()
      ), definition.due_at), (
        select due_at from private.course_assignment_extensions where assignment_id = a.id and user_id = auth.uid()
        order by version desc limit 1
      )),
      'extensions', case when staff then coalesce((
        select jsonb_agg(to_jsonb(current_extension) order by current_extension.user_id)
        from (
          select distinct on (user_id) user_id, version, due_at
          from private.course_assignment_extensions
          where assignment_id = a.id order by user_id, version desc
        ) current_extension
      ), '[]'::jsonb) else '[]'::jsonb end,
      'teams', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', team.id, 'title', team.title, 'due_at', team.due_at, 'version', team.version,
          'locked', exists(select 1 from private.course_assignment_attempts submitted where submitted.team_id = team.id),
          'member_ids', case when staff then coalesce((
            select jsonb_agg(member.user_id order by member.user_id)
            from private.course_assignment_team_members member where member.team_id = team.id
          ), '[]'::jsonb) else '[]'::jsonb end
        ) order by team.title, team.id)
        from private.course_assignment_teams team where team.assignment_id = a.id
          and (staff or private.course_assignment_team_access(team.id, a.id, auth.uid()))
      ), '[]'::jsonb),
      'attempts', coalesce((
        select jsonb_agg(to_jsonb(visible) order by visible.attempt_no desc, visible.id)
        from (
          select attempt.id, attempt.user_id, profile.display_name, attempt.attempt_no,
            attempt.file_version_id, attempt.file_name, attempt.submitted_at, team.title as team_title,
            pinned.rubric, to_jsonb(review) as review
          from private.course_assignment_attempts attempt
          join public.profiles profile on profile.id = attempt.user_id
          left join private.course_assignment_teams team on team.id = attempt.team_id
          join private.course_assignment_definitions pinned
            on (pinned.assignment_id, pinned.version) = (attempt.assignment_id, attempt.assignment_version)
          left join lateral (
            select rev.version, rev.state, rev.scores, rev.feedback,
              case when staff then rev.private_note end as private_note
            from private.course_assignment_reviews rev
            where rev.attempt_id = attempt.id and (staff or rev.state <> 'draft')
            order by rev.version desc limit 1
          ) review on true
          where attempt.assignment_id = a.id and (
            (staff and (profile.active or team.id is not null))
            or (attempt.team_id is null and attempt.user_id = auth.uid())
            or private.course_assignment_team_access(attempt.team_id, a.id, auth.uid())
          )
          order by attempt.attempt_no desc, attempt.id offset p_offset limit 25
        ) visible
      ), '[]'::jsonb))
    into detail
    from private.course_assignments a join private.course_assignment_definitions definition
      on definition.assignment_id = a.id and definition.version = case when staff then a.current_version else a.published_version end
    where a.id = p_assignment_id and a.run_id = p_run_id;
    if detail is null then raise insufficient_privilege; end if;
  end if;
  return jsonb_build_object('can_manage', staff and private.course_submission_write_enabled(),
    'assignments', summaries, 'detail', detail);
end;
$$;

create or replace function private.course_assignment_action(
  p_run_id uuid, p_assignment_id uuid, p_action text, p_payload jsonb, p_expected_version integer
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  context jsonb := private.lock_course_submission_settings_actor(p_run_id);
  assignment private.course_assignments%rowtype;
  attempt private.course_assignment_attempts%rowtype;
  definition private.course_assignment_definitions%rowtype;
  current_revision integer;
  submission_team uuid;
  target_user uuid;
  next_due timestamptz;
  file_id uuid;
  filename text;
  criterion record;
  score jsonb;
  title text := trim(p_payload->>'title');
  instructions text := trim(p_payload->>'instructions');
  feedback text := trim(coalesce(p_payload->>'feedback', ''));
  note text := trim(coalesce(p_payload->>'private_note', ''));
  review_state text := p_payload->>'state';
  result_id uuid := p_assignment_id;
  accepted_fields text[];
  deadline_text text := p_payload->>'due_at';
begin
  if not private.course_submission_write_enabled() then raise insufficient_privilege; end if;
  if p_action is null or p_assignment_id is null or p_expected_version is null or p_expected_version < 0
    or p_payload is null or jsonb_typeof(p_payload) <> 'object' or octet_length(p_payload::text) > 65536 then
    raise invalid_parameter_value;
  end if;
  accepted_fields := case p_action
    when 'save' then array['title','instructions','due_at','max_attempts','rubric']
    when 'publish' then '{}'::text[]
    when 'extend' then array['user_id','due_at']
    when 'submit' then array['file_version_id']
    when 'save_team' then array['team_id','title','member_ids','due_at']
    when 'remove_team' then array['team_id']
    when 'review' then array['attempt_id','state','scores','feedback','private_note']
  end;
  if accepted_fields is null or p_payload - accepted_fields <> '{}'::jsonb then raise invalid_parameter_value; end if;
  if p_action in ('save','extend') and not coalesce(
    deadline_text ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$', false
  ) then raise invalid_parameter_value; end if;
  select * into assignment from private.course_assignments where run_id = p_run_id and id = p_assignment_id;
  if p_action = 'submit' then
    if (context->>'learner')::boolean is not true or assignment.published_version is null then raise insufficient_privilege; end if;
    file_id := (p_payload->>'file_version_id')::uuid;
    select * into attempt from private.course_assignment_attempts
      where assignment_id = p_assignment_id and user_id = auth.uid() and file_version_id = file_id;
    if found then return jsonb_build_object('id', attempt.id); end if;
    perform private.lock_course_assignment_upload(p_run_id, p_assignment_id, auth.uid());
    if p_expected_version <> assignment.published_version then
      raise exception 'Assignment publication changed' using errcode = 'PT409';
    end if;
    select version.original_name into filename
    from private.course_submissions intake
    join public.document_versions version on version.id = intake.version_id
    join public.documents document on document.id = version.document_id and document.current_version_id = version.id
    where intake.version_id = file_id and intake.assignment_id = p_assignment_id
      and intake.assignment_version = assignment.published_version and intake.withdrawn_at is null
      and version.uploaded_by = auth.uid() and document.owner_id = auth.uid()
      and version.status = 'clean' and document.status = 'clean' and version.sha256 = intake.expected_sha256
      and document.deleted_at is null and not private.deletion_document_fenced(document.id)
    for share of version, document;
    if not found then raise insufficient_privilege; end if;
    select team_id into submission_team from private.course_assignment_team_members
      where assignment_id = p_assignment_id and user_id = auth.uid();
    select coalesce(max(attempt_no), 0) into current_revision from private.course_assignment_attempts
      where assignment_id = p_assignment_id and (team_id = submission_team
        or (submission_team is null and team_id is null and user_id = auth.uid()));
    insert into private.course_assignment_attempts(assignment_id, assignment_version, user_id, attempt_no, file_version_id, file_name, team_id)
      values(p_assignment_id, assignment.published_version, auth.uid(), current_revision + 1, file_id, filename, submission_team)
      returning id into result_id;
  else
    if (context->>'staff')::boolean is not true then raise insufficient_privilege; end if;
    if p_action = 'save' then
      if coalesce(length(title), 0) not between 1 and 160 or coalesce(length(instructions), 0) not between 1 and 8000
        or not coalesce(p_payload->>'max_attempts' ~ '^([1-9]|10)$', false)
        or not private.valid_course_assignment_rubric(p_payload->'rubric') then raise invalid_parameter_value; end if;
      next_due := deadline_text::timestamptz;
      if next_due is null or not isfinite(next_due) then raise invalid_parameter_value; end if;
      current_revision := coalesce(assignment.current_version, 0);
      if current_revision <> p_expected_version then raise exception 'Assignment draft changed' using errcode = 'PT409'; end if;
      if current_revision = 0 then
        if (select count(*) from private.course_assignments where run_id = p_run_id) >= 100 then
          raise exception 'Course assignment limit reached' using errcode = '54000';
        end if;
        insert into private.course_assignments(id, run_id, current_version) values(p_assignment_id, p_run_id, 1);
      else
        update private.course_assignments set current_version = current_revision + 1 where id = p_assignment_id;
      end if;
      insert into private.course_assignment_definitions(assignment_id, version, title, instructions, due_at, max_attempts, rubric)
        values(p_assignment_id, current_revision + 1, title, instructions, next_due, (p_payload->>'max_attempts')::integer, p_payload->'rubric');
    elsif assignment.id is null then
      raise insufficient_privilege;
    elsif p_action in ('save_team', 'remove_team') then
      result_id := private.change_course_assignment_team(p_run_id, assignment.id, p_action, p_payload, p_expected_version);
    elsif p_action = 'publish' then
      if p_expected_version <> assignment.current_version then raise exception 'Assignment draft changed' using errcode = 'PT409'; end if;
      if assignment.published_version = assignment.current_version then return jsonb_build_object('id', p_assignment_id); end if;
      if not exists(select 1 from private.course_assignment_definitions where assignment_id = p_assignment_id
        and version = assignment.current_version and due_at > clock_timestamp()) then raise invalid_parameter_value; end if;
      update private.course_assignments set published_version = current_version where id = p_assignment_id;
    elsif p_action = 'extend' then
      target_user := (p_payload->>'user_id')::uuid;
      next_due := deadline_text::timestamptz;
      if target_user is null or target_user = auth.uid() or assignment.published_version is null
        or not exists(select 1 from public.course_enrolments where course_run_id = p_run_id and user_id = target_user and status = 'enrolled')
        or next_due is null or not isfinite(next_due) or next_due <= clock_timestamp()
        or not exists(select 1 from private.course_assignment_definitions where assignment_id = p_assignment_id
          and version = assignment.published_version and due_at < next_due) then raise invalid_parameter_value; end if;
      select coalesce(max(version), 0) into current_revision from private.course_assignment_extensions
        where assignment_id = p_assignment_id and user_id = target_user;
      if p_expected_version <> current_revision then raise exception 'Assignment extension changed' using errcode = 'PT409'; end if;
      if exists(select 1 from private.course_assignment_extensions where assignment_id = p_assignment_id
        and user_id = target_user and version = current_revision and due_at >= next_due) then raise invalid_parameter_value; end if;
      insert into private.course_assignment_extensions(assignment_id, user_id, version, due_at)
        values(p_assignment_id, target_user, current_revision + 1, next_due);
    elsif p_action = 'review' then
      select * into attempt from private.course_assignment_attempts
        where id = (p_payload->>'attempt_id')::uuid and assignment_id = p_assignment_id;
      if not found or attempt.user_id = auth.uid()
        or private.course_assignment_team_access(attempt.team_id, assignment.id, auth.uid())
        then raise insufficient_privilege; end if;
      select * into strict definition from private.course_assignment_definitions
        where assignment_id = p_assignment_id and version = attempt.assignment_version;
      if review_state is null or review_state not in ('draft', 'revision_requested', 'released')
        or length(feedback) > 4000 or length(note) > 4000
        or (review_state = 'revision_requested' and (feedback = '' or exists (
          select 1 from private.course_assignment_attempts later
          where later.assignment_id = p_assignment_id and later.attempt_no > attempt.attempt_no
            and (later.team_id = attempt.team_id or
              (attempt.team_id is null and later.team_id is null and later.user_id = attempt.user_id))
        ))) or coalesce(jsonb_typeof(p_payload->'scores'), '') <> 'array' then raise invalid_parameter_value; end if;
      if jsonb_array_length(p_payload->'scores') <> jsonb_array_length(definition.rubric) then raise invalid_parameter_value; end if;
      for criterion in select value, ordinality - 1 as idx from jsonb_array_elements(definition.rubric) with ordinality loop
        score := p_payload->'scores'->(criterion.idx::integer);
        if not exists(select 1 from jsonb_array_elements(criterion.value->'levels') as level(value) where level.value->'points' = score) then
          raise invalid_parameter_value;
        end if;
      end loop;
      select coalesce(max(version), 0) into current_revision from private.course_assignment_reviews where attempt_id = attempt.id;
      if p_expected_version <> current_revision then raise exception 'Assignment review changed' using errcode = 'PT409'; end if;
      insert into private.course_assignment_reviews(attempt_id, version, state, scores, feedback, private_note)
        values(attempt.id, current_revision + 1, review_state, p_payload->'scores', feedback, note);
      if review_state <> 'draft' then
        insert into public.notifications(user_id, kind, resource_id)
          select recipient.user_id, 'course_assignment_feedback', attempt.id
          from (
            select attempt.user_id where attempt.team_id is null
            union all
            select member.user_id from private.course_assignment_team_members member
            where member.team_id = attempt.team_id
              and private.course_assignment_team_access(attempt.team_id, p_assignment_id, member.user_id)
          ) recipient
          on conflict(user_id, kind, resource_id) do update set created_at = clock_timestamp(), read_at = null;
      end if;
      result_id := attempt.id;
    else
      raise invalid_parameter_value;
    end if;
  end if;
  insert into public.audit_events(actor_id, action, resource_id, details)
    values(auth.uid(), 'course_assignment.' || p_action, p_run_id,
      jsonb_build_object('assignment_id', p_assignment_id, 'action_id', result_id));
  return jsonb_build_object('id', result_id);
end;
$$;


-- Reuse the exact scanned-file authorisation and current notification targets.
do $team_boundaries$
declare
  access_function regprocedure := 'private.course_submission_access(uuid,uuid,boolean)'::regprocedure;
  definition text;
  target regprocedure;
  old_owner constant text := $old$document.owner_id = auth.uid() or (context->>'staff')::boolean or (context->>'client')::boolean$old$;
  team_access constant text := $access$exists (
    select 1 from private.course_assignment_attempts team_attempt
    where team_attempt.file_version_id = p_version_id
      and private.course_assignment_team_access(team_attempt.team_id, team_attempt.assignment_id, auth.uid())
  )$access$;
  old_notification constant text := $old$attempt.id = p_resource and attempt.user_id = auth.uid()$old$;
begin
  definition := pg_get_functiondef(access_function);
  if cardinality(string_to_array(definition, old_owner)) <> 2
     or cardinality(string_to_array(definition, 'and document.owner_id = auth.uid()))')) <> 2 then
     raise exception 'Unexpected course assignment file authority';
  end if;
  definition := replace(definition, old_owner, old_owner || ' or ((context->>''learner'')::boolean and ' || team_access || ')');
  definition := replace(definition, 'and document.owner_id = auth.uid()))',
    'and (document.owner_id = auth.uid() or ' || team_access || ')))');
  execute definition;

  foreach target in array array[
    'private.course_notification_target(text,uuid)'::regprocedure,
    'private.academy_notification_target(text,uuid)'::regprocedure
  ] loop
    definition := pg_get_functiondef(target);
    if cardinality(string_to_array(definition, old_notification)) <> 2 then
      raise exception 'Unexpected assignment notification authority';
    end if;
    execute replace(definition, old_notification,
      'attempt.id = p_resource and ((attempt.team_id is null and attempt.user_id = auth.uid()) or
        private.course_assignment_team_access(attempt.team_id, attempt.assignment_id, auth.uid()))');
  end loop;
end;
$team_boundaries$;

notify pgrst, 'reload schema';
COMMIT;
