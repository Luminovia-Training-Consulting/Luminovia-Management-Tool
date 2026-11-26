-- Keep native exam accommodations private to management and one published sitting.
begin;

create table private.course_text_exam_time_revisions (
  run_id uuid not null,
  exam_revision integer not null,
  learner_id uuid not null references public.profiles(id) on delete cascade,
  revision integer not null check (revision > 0),
  extra_minutes integer not null check (extra_minutes between 0 and 480),
  approved_at timestamptz not null default clock_timestamp(),
  primary key (run_id, exam_revision, learner_id, revision),
  foreign key (run_id, exam_revision) references private.course_text_exam_versions(run_id, revision) on delete cascade
);
create index course_text_exam_time_learner_idx on private.course_text_exam_time_revisions(learner_id);
alter table private.course_text_exam_time_revisions enable row level security;
revoke all on private.course_text_exam_time_revisions from public, anon, authenticated, service_role;

-- Explicit zero overrides the legacy PDF allowance for this sitting alone.
create function private.course_text_exam_extra_minutes(p_run_id uuid, p_revision integer, p_learner_id uuid)
returns integer language sql stable security invoker set search_path = '' as $$
  select coalesce((
    select extra_minutes from private.course_text_exam_time_revisions
    where run_id = p_run_id and exam_revision = p_revision and learner_id = p_learner_id
    order by revision desc limit 1
  ), private.course_exam_extra_minutes(p_run_id, p_learner_id));
$$;

create function private.course_text_exam_grading_deadline(p_run_id uuid, p_revision integer, p_base timestamptz)
returns timestamptz language sql stable security invoker set search_path = '' as $$
  select p_base + make_interval(mins => coalesce(max(
    private.course_text_exam_extra_minutes(p_run_id, p_revision, enrolment.user_id)
  ), 0))
  from public.course_enrolments enrolment
  where enrolment.course_run_id = p_run_id and enrolment.status in ('enrolled', 'completed');
$$;

-- Only the authorized course manager receives the pre-opening candidate list.
create function private.course_text_exam_time_options(p_run_id uuid, p_revision integer, p_offset integer)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('rows', coalesce(jsonb_agg(
    jsonb_build_object('learner_id', candidate.user_id, 'name', candidate.display_name,
      'revision', candidate.revision, 'extra_minutes', candidate.extra_minutes)
    order by candidate.display_name, candidate.user_id
  ) filter (where candidate.position <= 25), '[]'::jsonb), 'has_more', count(*) > 25)
  from (
    select enrolment.user_id, profile.display_name,
      coalesce(allowance.revision, 0) revision,
      coalesce(allowance.extra_minutes, private.course_exam_extra_minutes(p_run_id, enrolment.user_id)) extra_minutes,
      row_number() over (order by profile.display_name, enrolment.user_id) - p_offset position
    from public.course_enrolments enrolment
    join public.profiles profile on profile.id = enrolment.user_id
    join public.course_runs run on run.id = enrolment.course_run_id
    left join lateral (
      select setting.revision, setting.extra_minutes from private.course_text_exam_time_revisions setting
      where setting.run_id = p_run_id and setting.exam_revision = p_revision and setting.learner_id = enrolment.user_id
      order by setting.revision desc limit 1
    ) allowance on true
    where enrolment.course_run_id = p_run_id and enrolment.status = 'enrolled'
      and private.active_company_participant(enrolment.user_id, run.organisation_id)
    order by profile.display_name, enrolment.user_id offset p_offset limit 26
  ) candidate;
$$;

-- The enclosing command holds the ordinary course lock and rechecks management.
create function private.set_course_text_exam_time(p_exam private.course_text_exam_versions, p_expected integer, p_payload jsonb)
returns integer language plpgsql security invoker set search_path = '' as $$
declare
  target uuid;
  minutes integer;
  current_revision private.course_text_exam_time_revisions;
begin
  if p_payload - array['learner_id','extra_minutes'] <> '{}'::jsonb
    or jsonb_typeof(p_payload->'learner_id') is distinct from 'string'
    or (p_payload->>'learner_id') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    or jsonb_typeof(p_payload->'extra_minutes') is distinct from 'number'
    or (p_payload->>'extra_minutes') !~ '^(0|[1-9][0-9]{0,2})$'
    then raise invalid_parameter_value; end if;
  target := (p_payload->>'learner_id')::uuid;
  minutes := (p_payload->>'extra_minutes')::integer;
  if minutes > 480 then raise invalid_parameter_value; end if;
  if clock_timestamp() >= p_exam.opens_at then
    raise sqlstate 'PT409' using message = 'Text exam time can only change before opening';
  end if;
  perform 1 from public.course_enrolments enrolment
    join public.course_runs run on run.id = enrolment.course_run_id
    join public.profiles profile on profile.id = enrolment.user_id and profile.active
    join public.user_roles learner_role on learner_role.user_id = enrolment.user_id and learner_role.role = 'participant'
    join private.company_participant_memberships member
      on member.user_id = enrolment.user_id and member.organisation_id = run.organisation_id and member.status = 'active'
    where enrolment.course_run_id = p_exam.run_id and enrolment.user_id = target and enrolment.status = 'enrolled'
    for share of enrolment, profile, learner_role, member;
  if not found then raise insufficient_privilege; end if;

  select * into current_revision from private.course_text_exam_time_revisions
    where run_id = p_exam.run_id and exam_revision = p_exam.revision and learner_id = target
    order by revision desc limit 1;
  if current_revision.extra_minutes = minutes
    and current_revision.revision in (p_expected, p_expected + 1)
    then return current_revision.revision; end if;
  if coalesce(current_revision.revision, 0) <> p_expected then
    raise sqlstate 'PT409' using message = 'Text exam time allowance changed';
  end if;
  if exists (
    select 1 from private.course_text_exam_versions other
    where other.run_id = p_exam.run_id and other.revision <> p_exam.revision
      and other.published_at is not null
      and tstzrange(p_exam.opens_at, p_exam.closes_at + make_interval(mins => minutes)) &&
          tstzrange(other.opens_at, private.course_text_exam_grading_deadline(other.run_id, other.revision, other.closes_at))
  ) then raise sqlstate 'PT409' using message = 'Published text exam windows overlap'; end if;

  if clock_timestamp() >= p_exam.opens_at then
    raise sqlstate 'PT409' using message = 'Text exam time can only change before opening';
  end if;
  insert into private.course_text_exam_time_revisions (run_id, exam_revision, learner_id, revision, extra_minutes)
    values (p_exam.run_id, p_exam.revision, target, p_expected + 1, minutes);
  return p_expected + 1;
end;
$$;

revoke all on function private.course_text_exam_extra_minutes(uuid,integer,uuid),
  private.course_text_exam_grading_deadline(uuid,integer,timestamptz), private.course_text_exam_time_options(uuid,integer,integer),
  private.set_course_text_exam_time(private.course_text_exam_versions,integer,jsonb)
  from public, anon, authenticated, service_role;

do $migration$
declare
  correction record;
  definition text;
begin
  for correction in select * from (values
    ('private.course_text_exam(uuid,integer,uuid,integer)',
      'private.course_exam_extra_minutes(p_run_id, who))' || chr(10) || '    then 0',
      'private.course_text_exam_extra_minutes(p_run_id, version.revision, who))' || chr(10) || '    then 0'),
    ('private.course_text_exam(uuid,integer,uuid,integer)',
      'private.course_exam_extra_minutes(p_run_id, who)',
      'private.course_text_exam_extra_minutes(p_run_id, exam.revision, who)'),
    ('private.course_text_exam(uuid,integer,uuid,integer)',
      'private.course_exam_grading_deadline(p_run_id, exam.closes_at)',
      'private.course_text_exam_grading_deadline(p_run_id, exam.revision, exam.closes_at)'),
    ('private.course_text_exam(uuid,integer,uuid,integer)',
      '''versions'', versions, ''exam'', paper,',
      $projection$'versions', versions, 'exam', paper,
    'time_allowances', case when writable and (context->>'manager')::boolean is true
      and exam.published_at is not null and statement_timestamp() < exam.opens_at
      then private.course_text_exam_time_options(p_run_id, exam.revision, p_offset) end,$projection$),
    ('private.lock_course_text_exam_actor(uuid,text)',
      $gate$p_action in ('save_exam','publish')$gate$,
      $gate$p_action in ('save_exam','publish','set_extra_time')$gate$),
    ('private.course_text_exam_author(uuid,text,integer,jsonb)',
      'private.course_exam_grading_deadline(p_run_id, previous.closes_at)',
      'private.course_text_exam_grading_deadline(p_run_id, previous.revision, previous.closes_at)'),
    ('private.course_text_exam_author(uuid,text,integer,jsonb)',
      'private.course_exam_grading_deadline(p_run_id, head.closes_at)',
      'private.course_text_exam_grading_deadline(p_run_id, head.revision, head.closes_at)'),
    ('private.course_text_exam_submit(private.course_text_exam_versions,text,integer,jsonb)',
      'private.course_exam_extra_minutes(p_exam.run_id, who)',
      'private.course_text_exam_extra_minutes(p_exam.run_id, p_exam.revision, who)'),
    ('private.course_text_exam_grade(private.course_text_exam_versions,text,integer,jsonb)',
      'private.course_exam_grading_deadline(p_exam.run_id, p_exam.closes_at)',
      'private.course_text_exam_grading_deadline(p_exam.run_id, p_exam.revision, p_exam.closes_at)'),
    ('private.import_course_text_exam_reviews(private.course_text_exam_versions,jsonb)',
      'private.course_exam_grading_deadline(p_exam.run_id, p_exam.closes_at)',
      'private.course_text_exam_grading_deadline(p_exam.run_id, p_exam.revision, p_exam.closes_at)'),
    ('private.course_text_exam_action(uuid,text,integer,integer,jsonb)',
      $actions$'import_reviews')$actions$,
      $actions$'import_reviews','set_extra_time')$actions$),
    ('private.course_text_exam_action(uuid,text,integer,integer,jsonb)',
      $command$    if p_action = 'import_reviews' then$command$,
      $command$    if p_action = 'set_extra_time' then
      accepted := private.set_course_text_exam_time(exam, p_expected, p_payload);
    elsif p_action = 'import_reviews' then$command$)
  ) as changes(signature, previous, replacement)
  loop
    definition := pg_catalog.pg_get_functiondef(correction.signature::regprocedure);
    if cardinality(string_to_array(definition, correction.previous)) <> 2 then
      raise exception 'Expected exact text exam time boundary in %', correction.signature;
    end if;
    execute replace(definition, correction.previous, correction.replacement);
  end loop;
end;
$migration$;

commit;
