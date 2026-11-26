-- Per-learner extra time extends the existing timed-assessment authority.
-- Only current course managers can change allowances. The learner can see
-- the own effective deadline, and other learners retain the base window.
begin;

create table private.course_exam_time_revisions (
  run_id uuid not null references private.course_timed_exams(run_id) on delete cascade,
  participant_id uuid not null references public.profiles(id) on delete cascade,
  revision integer not null check (revision > 0),
  extra_minutes integer not null check (extra_minutes between 0 and 480),
  approved_at timestamptz not null default clock_timestamp(),
  primary key (run_id, participant_id, revision)
);
alter table private.course_exam_time_revisions enable row level security;
revoke all on private.course_exam_time_revisions from public, anon, authenticated, service_role;

-- Reads use the latest approval. A zero-minute revision withdraws a prior allowance.
create function private.course_exam_extra_minutes(p_run_id uuid, p_participant_id uuid)
returns integer language sql stable security invoker set search_path = '' as $$
  select coalesce((
    select extra_minutes from private.course_exam_time_revisions
    where run_id = p_run_id and participant_id = p_participant_id order by revision desc limit 1
  ), 0);
$$;

-- Staff release grades after the last current learner's effective deadline.
create function private.course_exam_grading_deadline(p_run_id uuid, p_base timestamptz)
returns timestamptz language sql stable security invoker set search_path = '' as $$
  select p_base + make_interval(mins => coalesce(max(
    private.course_exam_extra_minutes(p_run_id, enrolment.user_id)
  ), 0))
  from public.course_enrolments enrolment
  where enrolment.course_run_id = p_run_id and enrolment.status in ('enrolled', 'completed');
$$;

create function private.course_timed_exam_open_for(p_run_id uuid, p_at timestamptz, p_actor_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from private.course_timed_exams exam
    join private.course_exam_settings setting using (run_id)
    where exam.run_id = p_run_id and setting.required
      and p_at >= exam.starts_at and p_at < exam.ends_at
        + make_interval(mins => private.course_exam_extra_minutes(p_run_id, p_actor_id))
  );
$$;

-- Keep existing paper, visibility and submit call sites actor-scoped. Scan
-- callbacks must pass the recorded uploader explicitly because they have no human JWT.
create or replace function private.course_timed_exam_open(p_run_id uuid, p_at timestamptz)
returns boolean language sql stable security invoker set search_path = '' as $$
  select private.course_timed_exam_open_for(p_run_id, p_at, auth.uid());
$$;

create function private.course_student_exam_paper_current_for(p_exam_id uuid, p_actor_id uuid)
returns boolean language sql stable security invoker set search_path = ''
as $$
  select exists (
    select 1
    from private.course_exam_documents paper
    join public.document_versions version on version.id = paper.version_id
    where paper.id = p_exam_id and paper.audience = 'students'
      and (not exists (select 1 from private.course_timed_exams where run_id = paper.run_id)
        or private.course_timed_exam_open_for(paper.run_id, statement_timestamp(), p_actor_id))
      and not exists (
        select 1
        from public.document_versions successor
        join private.course_exam_documents publication
          on publication.version_id = successor.id
         and publication.run_id = paper.run_id
         and publication.audience = 'students'
        where successor.document_id = version.document_id
          and successor.version > version.version
      )
  );
$$;

create or replace function private.course_student_exam_paper_current(p_exam_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select private.course_student_exam_paper_current_for(p_exam_id, auth.uid());
$$;

create function private.set_course_exam_extra_time(
  p_run_id uuid, p_participant_id uuid, p_extra_minutes integer, p_expected_revision integer
) returns integer language plpgsql security definer set search_path = '' as $$
declare
  context jsonb := private.lock_course_submission_settings_actor(p_run_id);
  current_revision private.course_exam_time_revisions;
begin
  if not private.course_submission_write_enabled() or (context->>'manager')::boolean is not true then
    raise insufficient_privilege;
  end if;
  if p_participant_id is null or p_extra_minutes is null or p_extra_minutes not between 0 and 480
    or p_expected_revision is null or p_expected_revision < 0 then
    raise invalid_parameter_value;
  end if;
  perform 1 from public.course_enrolments
  where course_run_id = p_run_id and user_id = p_participant_id and status = 'enrolled' for share;
  if not found then raise insufficient_privilege; end if;
  perform 1 from private.course_timed_exams exam join private.course_exam_settings setting using (run_id)
  where exam.run_id = p_run_id and setting.required and clock_timestamp() < exam.starts_at
    and exam.published_at is null for update of exam;
  if not found then
    raise sqlstate 'PT409' using message = 'Extra time can only be assigned before the exam starts';
  end if;
  select * into current_revision from private.course_exam_time_revisions
  where run_id = p_run_id and participant_id = p_participant_id order by revision desc limit 1;
  if coalesce(current_revision.extra_minutes, 0) = p_extra_minutes then
    return coalesce(current_revision.revision, 0);
  end if;
  if coalesce(current_revision.revision, 0) <> p_expected_revision then
    raise sqlstate 'PT409' using message = 'Exam time allowance changed';
  end if;
  insert into private.course_exam_time_revisions(run_id, participant_id, revision, extra_minutes)
  values (p_run_id, p_participant_id, p_expected_revision + 1, p_extra_minutes);
  insert into public.audit_events(actor_id, action, resource_id)
    values (auth.uid(), 'course_exam.time_allowance_revised', p_run_id);
  return p_expected_revision + 1;
end;
$$;

create function public.set_course_exam_extra_time(
  p_run_id uuid, p_participant_id uuid, p_extra_minutes integer, p_expected_revision integer
) returns integer language sql security invoker set search_path = '' as $$
  select private.set_course_exam_extra_time(p_run_id, p_participant_id, p_extra_minutes, p_expected_revision);
$$;

revoke all on function private.course_exam_extra_minutes(uuid, uuid),
  private.course_exam_grading_deadline(uuid, timestamptz),
  private.course_timed_exam_open_for(uuid, timestamptz, uuid),
  private.course_student_exam_paper_current_for(uuid, uuid),
  private.set_course_exam_extra_time(uuid, uuid, integer, integer),
  public.set_course_exam_extra_time(uuid, uuid, integer, integer)
from public, anon, authenticated, service_role;
grant execute on function private.set_course_exam_extra_time(uuid, uuid, integer, integer),
  public.set_course_exam_extra_time(uuid, uuid, integer, integer) to authenticated;

create or replace function private.course_exam_state(p_run_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  context jsonb := private.course_submission_context(p_run_id);
  exam private.course_timed_exams%rowtype;
  editor boolean := private.course_exam_editor(context);
  grader boolean := (context->>'teacher')::boolean or (context->>'manager')::boolean;
  learner boolean := (context->>'learner')::boolean;
  manager boolean := (context->>'manager')::boolean;
  effective_end timestamptz;
  required boolean;
  published boolean;
  submitted timestamptz;
  results jsonb;
  draft jsonb;
begin
  select setting.required into required from private.course_exam_settings setting where setting.run_id=p_run_id;
  select * into exam from private.course_timed_exams where run_id=p_run_id;
  effective_end := exam.ends_at + make_interval(mins =>
    case when learner then private.course_exam_extra_minutes(p_run_id, auth.uid()) else 0 end);
  select submitted_at into submitted from private.course_exam_results
    where run_id=p_run_id and participant_id=auth.uid();
  if exam.run_id is null or (not editor and (not coalesce(learner,false) or not coalesce(required,false)
    or statement_timestamp() < exam.visible_from
    or (statement_timestamp() >= effective_end and submitted is null and exam.published_at is null))) then
    return null;
  end if;
  published := exam.published_at is not null;
  if required and (grader or (context->>'client')::boolean) then
    select coalesce(jsonb_agg(jsonb_build_object(
      'participant_id', e.user_id, 'name', p.display_name, 'submitted_at', r.submitted_at,
      'version_id', case when grader then r.submitted_version_id end,
      'file_name', case when grader then v.original_name end, 'score', r.score,
      'time_allowance', case when manager and e.status='enrolled' then jsonb_build_object(
        'extra_minutes', coalesce(allowance.extra_minutes, 0),
        'revision', coalesce(allowance.revision, 0)
      ) end
    ) order by p.display_name, e.user_id), '[]'::jsonb) into results
    from public.course_enrolments e join public.profiles p on p.id=e.user_id
    left join private.course_exam_results r on r.run_id=e.course_run_id and r.participant_id=e.user_id
    left join public.document_versions v on v.id=r.submitted_version_id
    left join lateral (
      select revision, extra_minutes from private.course_exam_time_revisions
      where run_id = e.course_run_id and participant_id = e.user_id and manager
      order by revision desc limit 1
    ) allowance on true
    where e.course_run_id=p_run_id and e.status in ('enrolled','completed')
      and (grader or (published and r.score is not null));
  end if;
  if learner and submitted is null and private.course_timed_exam_open(p_run_id,statement_timestamp()) then
    select jsonb_build_object('version_id',v.id,'name',v.original_name) into draft
    from private.course_submissions intake
    join public.document_versions v on v.id=intake.version_id
    join public.documents d on d.id=v.document_id and d.current_version_id=v.id
    where intake.run_id=p_run_id and intake.is_exam and intake.withdrawn_at is null
      and v.uploaded_by=auth.uid() and d.owner_id=auth.uid()
      and v.status='clean' and d.status='clean' and v.sha256=intake.expected_sha256
      and d.deleted_at is null and not private.deletion_document_fenced(d.id)
    order by v.created_at desc,v.id desc limit 1;
  end if;
  return jsonb_build_object('title',exam.title,'visible_from',exam.visible_from,
    'starts_at',exam.starts_at,'ends_at',exam.ends_at,'pass_percent',exam.pass_percent,
    'version',exam.version,'required',coalesce(required,false),'published',published,
    'open',private.course_timed_exam_open(p_run_id,statement_timestamp()),
    'grading_open',statement_timestamp() >= case when grader
      then private.course_exam_grading_deadline(p_run_id, exam.ends_at) else effective_end end,
    'learner_ends_at',case when learner then effective_end end,
    'can_set_extra_time',coalesce(manager,false) and coalesce(required,false)
      and statement_timestamp() < exam.starts_at and private.course_submission_write_enabled(),
    'can_submit',coalesce(learner,false) and submitted is null and private.course_submission_write_enabled()
      and private.course_timed_exam_open(p_run_id,statement_timestamp()) and exists (
        select 1 from public.course_enrolments where course_run_id=p_run_id and user_id=auth.uid() and status='enrolled'
      ),
    'can_grade',coalesce(grader,false) and private.course_submission_write_enabled(),
    'submitted_at',submitted,'draft',draft,'rows',coalesce(results,'[]'::jsonb));
end;
$$;

create or replace function private.lock_timed_submission_upload(p_run_id uuid, p_actor_id uuid, p_exam boolean)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  company_id uuid;
begin
  company_id := private.lock_course_submission_scope(p_run_id);
  perform 1 from auth.users where id = p_actor_id and email_confirmed_at is not null for share;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.profiles where id = p_actor_id and active for share;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.user_roles where user_id = p_actor_id order by role for share;
  perform 1 from private.company_participant_memberships
    where user_id = p_actor_id and organisation_id = company_id and status = 'active' for share;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.course_enrolments
    where user_id = p_actor_id and course_run_id = p_run_id and status = 'enrolled' for share;
  if not found or not private.active_company_participant(p_actor_id, company_id)
     or (not p_exam and not exists (select 1 from private.course_submission_settings where run_id = p_run_id and enabled))
     or (p_exam and (not private.course_submission_write_enabled()
        or not private.course_timed_exam_open_for(p_run_id,clock_timestamp(),p_actor_id)
        or exists(select 1 from private.course_exam_results where run_id=p_run_id
          and participant_id=p_actor_id and submitted_at is not null)
        or not exists(
          select 1 from private.course_exam_documents e
          join public.document_versions v on v.id=e.version_id
          join public.documents d on d.id=v.document_id
          where e.run_id=p_run_id and e.audience='students' and e.removed_at is null
            and private.course_student_exam_paper_current_for(e.id, p_actor_id)
            and v.status='clean' and v.sha256 is not null and d.deleted_at is null
            and not private.deletion_document_fenced(d.id)
        ))) then
    raise insufficient_privilege;
  end if;
end;
$$;

create or replace function private.save_course_exam_grades(p_run_id uuid,p_scores jsonb,p_version integer,p_publish boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  context jsonb := private.lock_course_submission_settings_actor(p_run_id);
  exam private.course_timed_exams%rowtype;
  entry record;
begin
  if not private.course_submission_write_enabled() or not (
    coalesce((context->>'teacher')::boolean,false) or coalesce((context->>'manager')::boolean,false)
  ) then raise insufficient_privilege; end if;
  select timed.* into exam from private.course_timed_exams timed
    join private.course_exam_settings setting using(run_id) where timed.run_id=p_run_id and setting.required;
  if not found or clock_timestamp()<private.course_exam_grading_deadline(p_run_id,exam.ends_at) then raise insufficient_privilege; end if;
  if exam.published_at is not null or exam.version is distinct from p_version then
    raise exception 'Exam grades changed or already published' using errcode='PT409';
  end if;
  if p_publish is null or jsonb_typeof(p_scores) is distinct from 'object'
    or length(p_scores::text)>50000 then raise invalid_parameter_value; end if;
  for entry in select key::uuid as participant, value from jsonb_each(p_scores) loop
    if jsonb_typeof(entry.value) <> 'number' or entry.value::text !~ '^(100|[0-9]{1,2})$'
      or not exists(select 1 from public.course_enrolments where course_run_id=p_run_id
        and user_id=entry.participant and status in ('enrolled','completed')) then
      raise invalid_parameter_value;
    end if;
    insert into private.course_exam_results(run_id,participant_id,score)
      values(p_run_id,entry.participant,entry.value::text::integer)
    on conflict(run_id,participant_id) do update set score=excluded.score;
  end loop;
  if p_publish and (not exists (
    select 1 from private.course_exam_results where run_id=p_run_id and score is not null
  ) or exists (
    select 1 from private.course_exam_results r
    join public.course_enrolments e on e.course_run_id=r.run_id and e.user_id=r.participant_id
    where r.run_id=p_run_id and r.submitted_at is not null and r.score is null
      and e.status in ('enrolled','completed')
  )) then
    raise exception 'Grade all submitted exams before publishing' using errcode='22023';
  end if;
  update private.course_timed_exams set version=version+1,
    published_at=case when p_publish then clock_timestamp() end where run_id=p_run_id;
  insert into public.audit_events(actor_id,action,resource_id)
    values(auth.uid(),case when p_publish then 'course_exam.grades_published' else 'course_exam.grades_saved' end,p_run_id);
  return true;
end;
$$;


-- Include sensitive allowance records in the existing reviewed deletion fences.
create trigger permanent_deletion_fence before insert or update or delete
on private.course_exam_time_revisions for each row execute function private.guard_permanent_deletion();

alter function private.deletion_scope(text,uuid) rename to deletion_scope_before_exam_time;
create function private.deletion_scope(p_kind text,p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  scope jsonb := private.deletion_scope_before_exam_time(p_kind,p_id);
  course_filter text := private.deletion_selector(scope,'public.course_runs');
  profile_filter text := private.deletion_selector(scope,'public.profiles');
  filters text[] := '{}';
begin
  if course_filter is not null then
    filters := array_append(filters,
      format('x.run_id in (select scoped.id from public.course_runs scoped where %s)',replace(course_filter,'x.','scoped.')));
  end if;
  if profile_filter is not null then
    filters := array_append(filters,
      format('x.participant_id in (select scoped.id from public.profiles scoped where %s)',replace(profile_filter,'x.','scoped.')));
  end if;
  if cardinality(filters)>0 then
    scope := private.deletion_add_scope(scope,'private.course_exam_time_revisions',array_to_string(filters,' or '));
  end if;
  return scope;
end;
$$;
revoke all on function private.deletion_scope_before_exam_time(text,uuid), private.deletion_scope(text,uuid)
  from public, anon, authenticated, service_role;

-- Apply the same Academy write gate as the existing timed exam schedule.
do $$
declare
  definition text := pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  path constant text := '/rpc/save_course_exam_schedule';
begin
  if cardinality(string_to_array(definition, quote_literal(path))) <> 2 then
    raise exception 'Expected one Academy timed exam write boundary';
  end if;
  execute replace(definition, quote_literal(path),
    quote_literal(path) || ', ''/rpc/set_course_exam_extra_time''');
end;
$$;
notify pgrst, 'reload schema';
commit;
