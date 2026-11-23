begin;

create table private.course_timed_exams (
  run_id uuid primary key references public.course_runs(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 160),
  visible_from timestamptz not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  pass_percent integer not null check (pass_percent between 0 and 100),
  version integer not null default 1,
  published_at timestamptz,
  check (visible_from <= starts_at and starts_at < ends_at)
);

create table private.course_exam_results (
  run_id uuid not null references private.course_timed_exams(run_id) on delete cascade,
  participant_id uuid not null references public.profiles(id) on delete cascade,
  submitted_version_id uuid references private.course_submissions(version_id) on delete set null,
  submitted_at timestamptz,
  score integer check (score between 0 and 100),
  primary key (run_id, participant_id),
  check (submitted_at is not null or score is not null)
);
create index course_exam_results_participant on private.course_exam_results(participant_id, run_id);
create index course_exam_results_submission on private.course_exam_results(submitted_version_id);
alter table private.course_timed_exams enable row level security;
alter table private.course_exam_results enable row level security;
revoke all on private.course_timed_exams, private.course_exam_results from public, anon, authenticated, service_role;

-- General course uploads retain their existing settings and visibility.
alter table private.course_submissions add column is_exam boolean not null default false;
alter table private.course_exam_settings add column allow_untimed_papers boolean not null default false;
insert into private.course_exam_settings(run_id,allow_untimed_papers)
  select distinct run_id,true from private.course_exam_documents where audience='students'
  on conflict (run_id) do update set allow_untimed_papers=true;

create function private.course_timed_exam_open(p_run_id uuid, p_at timestamptz) returns boolean
language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from private.course_timed_exams exam
    join private.course_exam_settings setting using (run_id)
    where exam.run_id = p_run_id and setting.required
      and p_at >= exam.starts_at and p_at < exam.ends_at
  );
$$;

create function private.save_course_exam_schedule(
  p_run_id uuid, p_title text, p_visible_from timestamptz, p_starts_at timestamptz,
  p_ends_at timestamptz, p_pass_percent integer, p_version integer
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  context jsonb := private.lock_course_submission_settings_actor(p_run_id);
  lower_day date; upper_day date; course_zone text; current_version integer;
begin
  if not private.course_submission_write_enabled() or not private.course_exam_editor(context) then
    raise insufficient_privilege;
  end if;
  select run.time_zone, min((session.starts_at at time zone run.time_zone)::date),
                         max((session.ends_at at time zone run.time_zone)::date)
    into course_zone, lower_day, upper_day
  from public.course_runs run join public.course_sessions session on session.course_run_id = run.id
  where run.id = p_run_id group by run.time_zone;
  if lower_day is null or p_title is null or length(btrim(p_title)) not between 1 and 160
    or p_version is null or p_pass_percent is null or p_pass_percent not between 0 and 100
    or not coalesce(isfinite(p_visible_from) and isfinite(p_starts_at) and isfinite(p_ends_at), false)
    or p_visible_from > p_starts_at or p_starts_at >= p_ends_at
    or (p_starts_at at time zone course_zone)::date < lower_day
    or (p_ends_at at time zone course_zone)::date > upper_day then
    raise invalid_parameter_value;
  end if;
  select version into current_version from private.course_timed_exams where run_id = p_run_id;
  if coalesce(current_version, 0) <> p_version or exists (
    select 1 from private.course_exam_results where run_id = p_run_id
  ) or exists (
    select 1 from private.course_submissions where run_id=p_run_id and is_exam and withdrawn_at is null
  ) then
    raise exception 'Exam changed or already has results' using errcode = 'PT409';
  end if;
  insert into private.course_timed_exams(run_id,title,visible_from,starts_at,ends_at,pass_percent)
    values(p_run_id,btrim(p_title),p_visible_from,p_starts_at,p_ends_at,p_pass_percent)
  on conflict (run_id) do update set title=excluded.title, visible_from=excluded.visible_from,
    starts_at=excluded.starts_at, ends_at=excluded.ends_at, pass_percent=excluded.pass_percent,
    version=private.course_timed_exams.version+1;
  insert into private.course_exam_settings(run_id,required,version,updated_by)
    values(p_run_id,true,1,auth.uid())
  on conflict (run_id) do update set required=true, version=private.course_exam_settings.version+1,
    updated_by=auth.uid(), updated_at=clock_timestamp(), allow_untimed_papers=false;
  insert into public.audit_events(actor_id,action,resource_id)
    values(auth.uid(),'course_exam.schedule_saved',p_run_id);
  return true;
end;
$$;

create function private.course_exam_state(p_run_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  context jsonb := private.course_submission_context(p_run_id);
  exam private.course_timed_exams%rowtype;
  editor boolean := private.course_exam_editor(context);
  grader boolean := (context->>'teacher')::boolean or (context->>'manager')::boolean;
  learner boolean := (context->>'learner')::boolean;
  required boolean;
  published boolean;
  submitted timestamptz;
  results jsonb;
  draft jsonb;
begin
  select setting.required into required from private.course_exam_settings setting where setting.run_id=p_run_id;
  select * into exam from private.course_timed_exams where run_id=p_run_id;
  select submitted_at into submitted from private.course_exam_results
    where run_id=p_run_id and participant_id=auth.uid();
  if exam.run_id is null or (not editor and (not coalesce(learner,false) or not coalesce(required,false)
    or statement_timestamp() < exam.visible_from
    or (statement_timestamp() >= exam.ends_at and submitted is null and exam.published_at is null))) then
    return null;
  end if;
  published := exam.published_at is not null;
  if required and (grader or (context->>'client')::boolean) then
    select coalesce(jsonb_agg(jsonb_build_object(
      'participant_id', e.user_id, 'name', p.display_name, 'submitted_at', r.submitted_at,
      'version_id', case when grader then r.submitted_version_id end,
      'file_name', case when grader then v.original_name end, 'score', r.score
    ) order by p.display_name, e.user_id), '[]'::jsonb) into results
    from public.course_enrolments e join public.profiles p on p.id=e.user_id
    left join private.course_exam_results r on r.run_id=e.course_run_id and r.participant_id=e.user_id
    left join public.document_versions v on v.id=r.submitted_version_id
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
    'grading_open',statement_timestamp() >= exam.ends_at,
    'can_submit',coalesce(learner,false) and submitted is null and private.course_submission_write_enabled()
      and private.course_timed_exam_open(p_run_id,statement_timestamp()) and exists (
        select 1 from public.course_enrolments where course_run_id=p_run_id and user_id=auth.uid() and status='enrolled'
      ),
    'can_grade',coalesce(grader,false) and private.course_submission_write_enabled(),
    'submitted_at',submitted,'draft',draft,'rows',coalesce(results,'[]'::jsonb));
end;
$$;

create function private.lock_timed_submission_upload(p_run_id uuid, p_actor_id uuid, p_exam boolean)
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
        or not private.course_timed_exam_open(p_run_id,clock_timestamp())
        or exists(select 1 from private.course_exam_results where run_id=p_run_id
          and participant_id=p_actor_id and submitted_at is not null)
        or not exists(
          select 1 from private.course_exam_documents e
          join public.document_versions v on v.id=e.version_id
          join public.documents d on d.id=v.document_id
          where e.run_id=p_run_id and e.audience='students' and e.removed_at is null
            and private.course_student_exam_paper_current(e.id)
            and v.status='clean' and v.sha256 is not null and d.deleted_at is null
            and not private.deletion_document_fenced(d.id)
        ))) then
    raise insufficient_privilege;
  end if;
end;
$$;

create function private.reserve_submission_for_purpose(
  p_run_id uuid, p_name text, p_mime text, p_size bigint, p_client_id uuid, p_sha256 text, p_exam boolean
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  existing_version public.document_versions%rowtype;
  result jsonb;
begin
  perform private.lock_timed_submission_upload(p_run_id, actor_id, p_exam);
  if p_client_id is null or p_size is null or p_size not between 1 and 10485760
     or not coalesce(p_sha256 ~ '^[0-9a-f]{64}$', false) then
    raise invalid_parameter_value;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('documents-global-quota', 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('documents:' || actor_id::text, 0));
  select * into existing_version from public.document_versions where uploaded_by = actor_id and client_id = p_client_id;
  if found then
    if existing_version.original_name is distinct from p_name
       or existing_version.mime_type is distinct from p_mime or existing_version.size_bytes is distinct from p_size
       or existing_version.version <> 1 or not exists (
        select 1 from private.course_submissions submission
        join public.documents document on document.current_version_id = submission.version_id
        where submission.version_id = existing_version.id and submission.run_id = p_run_id
          and submission.is_exam=p_exam and submission.expected_sha256 = p_sha256 and submission.withdrawn_at is null
          and document.id = existing_version.document_id and document.kind = 'participant_submission'
          and document.owner_id = actor_id and document.deleted_at is null
          and not private.deletion_document_fenced(document.id)
    ) then
      raise exception 'Submission reservation conflicts with this upload' using errcode = 'PT409';
    end if;
    return jsonb_build_object('document_id', existing_version.document_id, 'version_id', existing_version.id,
      'object_path', existing_version.object_path, 'status', existing_version.status);
  end if;
  if (select edition from private.installation_identity) is distinct from 'internal'
     and (select coalesce(sum(size_bytes), 0) from public.document_versions) + p_size >
         (select (terms #>> '{limits,storage_bytes}')::bigint from private.installation_verified_licence) then
    raise exception 'Academy storage quota reached' using errcode = '54000';
  end if;
  result := private.reserve_document_before_contract_owner(p_name, p_mime, p_size, 'personal', 'participant_submission',
    null, null, p_client_id, null, null);
  insert into private.course_submissions(version_id, run_id, expected_sha256, is_exam)
    values ((result->>'version_id')::uuid, p_run_id, p_sha256, p_exam);
  return result;
end;
$$;

create function private.submit_course_exam(p_run_id uuid,p_version_id uuid) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare
  context jsonb := private.lock_course_submission_settings_actor(p_run_id);
  existing private.course_exam_results%rowtype;
  submitted timestamptz;
begin
  if (context->>'learner')::boolean is not true then raise insufficient_privilege; end if;
  select * into existing from private.course_exam_results
    where run_id=p_run_id and participant_id=auth.uid();
  if existing.submitted_at is not null then
    if existing.submitted_version_id=p_version_id then return existing.submitted_at; end if;
    raise exception 'Exam already submitted' using errcode='PT409';
  end if;
  perform private.lock_timed_submission_upload(p_run_id,auth.uid(),true);
  perform 1
  from private.course_submissions intake
  join public.document_versions v on v.id=intake.version_id
  join public.documents d on d.id=v.document_id and d.current_version_id=v.id
  where intake.is_exam and intake.run_id=p_run_id and intake.version_id=p_version_id
    and intake.withdrawn_at is null and v.uploaded_by=auth.uid() and d.owner_id=auth.uid()
    and v.status='clean' and d.status='clean' and v.sha256=intake.expected_sha256
    and d.deleted_at is null and not private.deletion_document_fenced(d.id)
  for share of v,d;
  if not found then raise insufficient_privilege; end if;
  submitted:=clock_timestamp();
  if not private.course_timed_exam_open(p_run_id,submitted) then raise insufficient_privilege; end if;
  insert into private.course_exam_results(run_id,participant_id,submitted_version_id,submitted_at)
    values(p_run_id,auth.uid(),p_version_id,submitted);
  insert into public.audit_events(actor_id,action,resource_id)
    values(auth.uid(),'course_exam.submitted',p_run_id);
  return submitted;
end;
$$;

-- One versioned write handles both saving draft grades and the explicit publication.
create function private.save_course_exam_grades(p_run_id uuid,p_scores jsonb,p_version integer,p_publish boolean)
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
  if not found or clock_timestamp()<exam.ends_at then raise insufficient_privilege; end if;
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

create function private.course_exam_result_visible(p_run_id uuid,p_user_id uuid) returns boolean
language plpgsql stable security invoker set search_path = '' as $$
declare context jsonb;
begin
  context:=private.course_submission_context(p_run_id);
  if p_user_id=auth.uid() and (context->>'learner')::boolean then return true; end if;
  return coalesce((context->>'teacher')::boolean,false) or coalesce((context->>'client')::boolean,false)
    or coalesce((context->>'manager')::boolean,false);
exception when insufficient_privilege then return false;
end;
$$;

create function private.published_course_exam_results(p_user_id uuid default null,p_organisation_id uuid default null) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('average',round(avg(score),2),'results',
    coalesce(jsonb_agg(to_jsonb(visible) order by published_at desc,run_id),'[]'::jsonb))
  from (
    select r.run_id, template.title as course, exam.title, r.score, r.score>=exam.pass_percent as passed,
      exam.published_at
    from private.course_exam_results r
    join private.course_timed_exams exam using(run_id)
    join private.course_exam_settings setting using(run_id)
    join public.course_runs run on run.id=r.run_id
    join public.course_templates template on template.id=run.template_id
    join public.course_enrolments enrolment on enrolment.course_run_id=r.run_id
      and enrolment.user_id=r.participant_id and enrolment.status in ('enrolled','completed')
    where r.participant_id=coalesce(p_user_id,auth.uid()) and r.score is not null
      and (p_organisation_id is null or run.organisation_id=p_organisation_id)
      and setting.required and exam.published_at is not null
      and private.course_exam_result_visible(r.run_id,r.participant_id)
  ) visible;
$$;

create or replace function private.lock_course_submission_upload(p_run_id uuid,p_actor_id uuid)
returns void language sql security invoker set search_path='' as $$
  select private.lock_timed_submission_upload(p_run_id,p_actor_id,false);
$$;

create or replace function private.reserve_course_submission(
  p_run_id uuid,p_name text,p_mime text,p_size bigint,p_client_id uuid,p_sha256 text
) returns jsonb language sql security definer set search_path='' as $$
  select private.reserve_submission_for_purpose(p_run_id,p_name,p_mime,p_size,p_client_id,p_sha256,false);
$$;

create function private.reserve_course_exam_submission(
  p_run_id uuid,p_name text,p_mime text,p_size bigint,p_client_id uuid,p_sha256 text
) returns jsonb language sql security definer set search_path='' as $$
  select private.reserve_submission_for_purpose(p_run_id,p_name,p_mime,p_size,p_client_id,p_sha256,true);
$$;

create function public.reserve_course_exam_submission(
  p_run_id uuid,p_name text,p_mime text,p_size bigint,p_client_id uuid,p_sha256 text
) returns jsonb language sql security invoker set search_path='' as $$
  select private.reserve_course_exam_submission(p_run_id,p_name,p_mime,p_size,p_client_id,p_sha256);
$$;
create function public.course_exam_state(p_run_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$ select private.course_exam_state(p_run_id); $$;
create function public.save_course_exam_schedule(
  p_run_id uuid,p_title text,p_visible_from timestamptz,p_starts_at timestamptz,p_ends_at timestamptz,
  p_pass_percent integer,p_version integer
) returns boolean language sql security invoker set search_path='' as $$
  select private.save_course_exam_schedule(p_run_id,p_title,p_visible_from,p_starts_at,p_ends_at,p_pass_percent,p_version);
$$;
create function public.submit_course_exam(p_run_id uuid,p_version_id uuid) returns timestamptz
language sql security invoker set search_path='' as $$ select private.submit_course_exam(p_run_id,p_version_id); $$;
create function public.save_course_exam_grades(p_run_id uuid,p_scores jsonb,p_version integer,p_publish boolean)
returns boolean language sql security invoker set search_path='' as $$
  select private.save_course_exam_grades(p_run_id,p_scores,p_version,p_publish);
$$;
create function public.published_course_exam_results(p_user_id uuid default null,p_organisation_id uuid default null) returns jsonb
language sql stable security invoker set search_path='' as $$ select private.published_course_exam_results(p_user_id,p_organisation_id); $$;

revoke all on function private.course_timed_exam_open(uuid,timestamptz),
  private.lock_timed_submission_upload(uuid,uuid,boolean),
  private.reserve_submission_for_purpose(uuid,text,text,bigint,uuid,text,boolean),
  private.course_exam_result_visible(uuid,uuid)
  from public,anon,authenticated,service_role;

do $migration$
declare
  name text;
  signature text;
  change record;
  definition text;
begin
  for name,signature in select * from (values
    ('reserve_course_exam_submission','uuid,text,text,bigint,uuid,text'),
    ('course_exam_state','uuid'),
    ('save_course_exam_schedule','uuid,text,timestamptz,timestamptz,timestamptz,integer,integer'),
    ('submit_course_exam','uuid,uuid'),
    ('save_course_exam_grades','uuid,jsonb,integer,boolean'),
    ('published_course_exam_results','uuid,uuid')
  ) endpoints loop
    execute format('revoke all on function public.%I(%s), private.%I(%s) from public,anon,authenticated,service_role',name,signature,name,signature);
    execute format('grant execute on function public.%I(%s), private.%I(%s) to authenticated',name,signature,name,signature);
  end loop;

  -- Reuse the established learner paper checks at both metadata and byte delivery.
  -- Existing untimed publications retain their previous behaviour.
  for change in select * from (values
    ('private.course_student_exam_paper_current(uuid)'::regprocedure,
      $old$paper.audience = 'students'$old$,
      $new$paper.audience = 'students'
      and (not exists(select 1 from private.course_timed_exams where run_id=paper.run_id)
        or private.course_timed_exam_open(paper.run_id,statement_timestamp()))$new$),
    ('private.share_course_exam_pdf(uuid,uuid,text)'::regprocedure,
      $old$  select * into existing from private.course_exam_documents$old$,
      $new$  if p_audience='students'
        and not exists(select 1 from private.course_exam_settings setting where setting.run_id=p_run_id
          and (setting.allow_untimed_papers or (setting.required
            and exists(select 1 from private.course_timed_exams where run_id=p_run_id))))
        then raise insufficient_privilege;
      end if;
      select * into existing from private.course_exam_documents$new$),
    ('private.course_exams(uuid)'::regprocedure,
      $old$'required', exam_required,$old$,
      $new$'required', exam_required and (editor or not exists (
        select 1 from private.course_timed_exams schedule where schedule.run_id=p_run_id
          and statement_timestamp()<schedule.visible_from
      )),$new$),
    ('private.course_submission_scan(uuid,uuid,text,uuid,text,text)'::regprocedure,
      $old$private.lock_course_submission_upload(intake.run_id, version.uploaded_by)$old$,
      $new$private.lock_timed_submission_upload(intake.run_id, version.uploaded_by, intake.is_exam)$new$),
    ('private.course_submission_status(uuid,uuid,uuid)'::regprocedure,
      $old$and exists (select 1 from private.course_submission_settings where run_id = p_run_id and enabled)$old$,
      $new$and case when submission.is_exam then private.course_timed_exam_open(p_run_id,statement_timestamp())
        else exists (select 1 from private.course_submission_settings where run_id = p_run_id and enabled) end$new$),
    ('private.course_submissions(uuid,uuid)'::regprocedure,
      $old$submission.withdrawn_at is null$old$,
      $new$submission.withdrawn_at is null and not submission.is_exam$new$),
    ('private.course_submissions(uuid,uuid)'::regprocedure,
      $old$where submission.run_id = p_run_id and version.id = p_after$old$,
      $new$where submission.run_id = p_run_id and version.id = p_after and not submission.is_exam$new$),
    ('private.withdraw_course_submission(uuid,uuid)'::regprocedure,
      $old$submission.withdrawn_at is null$old$,
      $new$submission.withdrawn_at is null and not submission.is_exam$new$),
    ('private.course_submission_access(uuid,uuid,boolean)'::regprocedure,
      $old$and version.version = 1 and version.status$old$,
      $new$and (not submission.is_exam or (
        ((context->>'teacher')::boolean or (context->>'manager')::boolean or document.owner_id=auth.uid())
        and exists (select 1 from private.course_exam_results result
            where result.run_id=p_run_id and result.submitted_version_id=p_version_id)
      ))
      and version.version = 1 and version.status$new$)
  ) alterations(target, previous, replacement) loop
    definition := pg_get_functiondef(change.target);
    if cardinality(string_to_array(definition,change.previous)) <> 2 then
      raise exception 'Unexpected exam integration anchor in %',change.target;
    end if;
    execute replace(definition,change.previous,change.replacement);
  end loop;
end;
$migration$;

-- The pre-request allowlists keep these scoped RPCs available to existing
-- participant accounts and the licensed Academy editions.
do $$
declare
  portal text := pg_get_functiondef('private.require_portal_access()'::regprocedure);
  academy text := pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  anchor text := '  licence_status := private.academy_course_access_status();';
begin
  if cardinality(string_to_array(portal, '''/rpc/course_evaluations'''))<>2
     or cardinality(string_to_array(academy,anchor))<>2 then
    raise exception 'Unexpected exam gateway allowlist';
  end if;
  execute replace(portal,'''/rpc/course_evaluations''',
    '''/rpc/course_evaluations'', ''/rpc/course_exam_state'', ''/rpc/published_course_exam_results'',
      ''/rpc/reserve_course_exam_submission'', ''/rpc/submit_course_exam''');
  execute replace(academy,anchor,anchor || $routes$
  if request_method = 'POST' and (
      (licence_status in ('active','grace') and request_path in (
        '/rpc/course_exam_state','/rpc/published_course_exam_results'))
      or (licence_status = 'active' and request_path in (
        '/rpc/save_course_exam_schedule','/rpc/reserve_course_exam_submission',
        '/rpc/submit_course_exam','/rpc/save_course_exam_grades'))
    ) then return; end if;$routes$);
end;
$$;

create trigger permanent_deletion_fence before insert or update or delete on private.course_timed_exams
for each row execute function private.guard_permanent_deletion();
create trigger permanent_deletion_fence before insert or update or delete on private.course_exam_results
for each row execute function private.guard_permanent_deletion();

alter function private.deletion_scope(text,uuid) rename to deletion_scope_before_timed_exams;
create function private.deletion_scope(p_kind text,p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  scope jsonb := private.deletion_scope_before_timed_exams(p_kind,p_id);
  course_filter text := private.deletion_selector(scope,'public.course_runs');
  profile_filter text := private.deletion_selector(scope,'public.profiles');
  version_filter text := private.deletion_selector(scope,'public.document_versions');
  result_filters text[] := '{}';
begin
  if course_filter is not null then
    scope:=private.deletion_add_scope(scope,'private.course_timed_exams',
      format('x.run_id in (select scoped.id from public.course_runs scoped where %s)',replace(course_filter,'x.','scoped.')));
    result_filters:=array_append(result_filters,
      format('x.run_id in (select scoped.id from public.course_runs scoped where %s)',replace(course_filter,'x.','scoped.')));
  end if;
  if profile_filter is not null then
    result_filters:=array_append(result_filters,
      format('x.participant_id in (select scoped.id from public.profiles scoped where %s)',replace(profile_filter,'x.','scoped.')));
  end if;
  if version_filter is not null then
    result_filters:=array_append(result_filters,
      format('x.submitted_version_id in (select scoped.id from public.document_versions scoped where %s)',replace(version_filter,'x.','scoped.')));
  end if;
  if cardinality(result_filters)>0 then
    scope:=private.deletion_add_scope(scope,'private.course_exam_results',array_to_string(result_filters,' or '));
  end if;
  return scope;
end;
$$;
revoke all on function private.deletion_scope_before_timed_exams(text,uuid),
  private.deletion_scope(text,uuid) from public,anon,authenticated,service_role;

notify pgrst, 'reload schema';
commit;
