begin;

-- Per-company entitlement is default-OFF and versioned independently from
-- courses, memberships, claims, files and all retained business data.
create table private.company_premium_settings (
  organisation_id uuid primary key references public.organisations(id) on delete cascade,
  enabled boolean not null default false,
  version integer not null default 0 check (version >= 0),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
insert into private.company_premium_settings(organisation_id)
select id from public.organisations
on conflict (organisation_id) do nothing;
revoke all on private.company_premium_settings
  from public, anon, authenticated, service_role;

create table private.company_premium_commands (
  actor_id uuid not null,
  request_id uuid not null,
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  requested_enabled boolean not null,
  expected_version integer not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(actor_id, request_id)
);
revoke all on private.company_premium_commands
  from public, anon, authenticated, service_role;

create table private.company_premium_audit (
  id bigint generated always as identity primary key,
  actor_id uuid not null,
  organisation_id uuid not null,
  request_id uuid not null,
  previous_enabled boolean not null,
  requested_enabled boolean not null,
  previous_version integer not null,
  expected_version integer not null,
  result text not null check (result in ('updated', 'unchanged', 'conflict')),
  created_at timestamptz not null default now()
);
create index company_premium_audit_org_time
  on private.company_premium_audit(organisation_id, created_at desc);
revoke all on private.company_premium_audit
  from public, anon, authenticated, service_role;

-- One shared current database decision for every server-side learning path.
-- The general role helper treats an owner as a functional admin; this command
-- deliberately requires an actual admin role row instead.
create function private.is_company_premium_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.actor_active() and exists (
    select 1 from public.user_roles role
    where role.user_id = auth.uid() and role.role = 'admin'
  );
$$;
revoke all on function private.is_company_premium_admin()
  from public, anon, authenticated, service_role;

create function private.company_premium_enabled(p_organisation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select settings.enabled
    from private.company_premium_settings settings
    join public.organisations organisation
      on organisation.id = settings.organisation_id
    where settings.organisation_id = p_organisation_id
      and organisation.archived_at is null
  ), false);
$$;
revoke all on function private.company_premium_enabled(uuid)
  from public, anon, authenticated, service_role;

create function private.course_company_premium_enabled(p_run_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.company_premium_enabled(organisation_id)
  from public.course_runs
  where id = p_run_id and archived_at is null;
$$;
revoke all on function private.course_company_premium_enabled(uuid)
  from public, anon, authenticated, service_role;

-- Staff who already manage organisations may inspect the current label/version;
-- this projection never grants the ability to toggle Premium.
create function private.company_premium_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.actor_active() or
     not private.has_permission('organisations.manage') then
    raise exception 'Organisation management required' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'organisation_id', organisation.id,
        'enabled', coalesce(settings.enabled, false),
        'version', coalesce(settings.version, 0),
        'updated_at', settings.updated_at
      ) order by organisation.name, organisation.id
    )
    from public.organisations organisation
    left join private.company_premium_settings settings
      on settings.organisation_id = organisation.id
  ), '[]'::jsonb);
end;
$$;

-- RLS may use this predicate safely: nonmembers and inactive accounts receive
-- false rather than learning the entitlement of an unrelated company.
create function private.course_premium_access(p_run_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  context jsonb;
begin
  context := private.course_workspace_context(p_run_id);
  return coalesce((context->>'lms_enabled')::boolean, false);
exception when insufficient_privilege then
  return false;
end;
$$;
revoke all on function private.course_premium_access(uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.course_premium_access(uuid) to authenticated;

-- Base course visibility remains unchanged; only participant/enrolment reads
-- and course reviews require the current company LMS entitlement.
alter policy runs_read on public.course_runs using (
  private.can_read_course_run(id) or
  ((select private.actor_active()) and private.course_premium_access(id) and exists (
    select 1 from public.course_enrolments enrolment
    where enrolment.course_run_id = course_runs.id
      and enrolment.user_id = (select auth.uid())
      and enrolment.status in ('enrolled', 'completed')
  ))
);
alter policy course_sessions_read on public.course_sessions using (
  private.can_read_course_run(course_run_id) or
  ((select private.actor_active()) and private.course_premium_access(course_run_id) and exists (
    select 1 from public.course_enrolments enrolment
    where enrolment.course_run_id = course_sessions.course_run_id
      and enrolment.user_id = (select auth.uid())
      and enrolment.status in ('enrolled', 'completed')
  ))
);
alter policy templates_read on public.course_templates using (
  private.can_read_course_template(id) or
  ((select private.actor_active()) and exists (
    select 1 from public.course_runs run
    join public.course_enrolments enrolment on enrolment.course_run_id = run.id
    where run.template_id = course_templates.id
      and private.course_premium_access(run.id)
      and enrolment.user_id = (select auth.uid())
      and enrolment.status in ('enrolled', 'completed')
  ))
);
alter policy course_enrolments_scoped on public.course_enrolments using (
  (select private.actor_active()) and
  private.course_premium_access(course_run_id) and
  (user_id = (select auth.uid()) or (select private.has_permission('courses.manage')))
);
alter policy course_reviews_private on public.course_reviews using (
  (select private.actor_active()) and
  private.course_premium_access(course_run_id) and
  (reviewer_id = (select auth.uid()) or (select private.has_permission('reviews.manage')))
);

-- Profile-course history and review summaries are Premium learning data too.
create or replace function private.can_read_profile_course(
  p_lecturer_id uuid, p_run_id uuid
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.actor_active() and
    private.company_premium_enabled((
      select run.organisation_id from public.course_runs run where run.id = p_run_id
    )) and
    (auth.uid() = p_lecturer_id or private.profile_staff(auth.uid()) or exists (
      select 1 from public.course_enrolments enrolment
      where enrolment.user_id = auth.uid()
        and enrolment.course_run_id = p_run_id
        and enrolment.status in ('enrolled', 'completed')
    ) or exists (
      select 1 from public.course_runs run
      where run.id = p_run_id and private.client_has_organisation(run.organisation_id)
    ));
$$;

create or replace function private.reviewable_courses()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.actor_active() then
    raise exception 'Active login required' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'course_run_id', run.id,
      'title', template.title,
      'lecturer_id', profile.id,
      'lecturer_name', profile.display_name,
      'ends_at', session_data.ends_at,
      'review', case when review.id is not null then jsonb_build_object(
        'id', review.id, 'rating', review.rating, 'comment', review.comment,
        'version', review.version, 'hidden', review.hidden,
        'moderation_reason', review.moderation_reason,
        'deleted', review.deleted_at is not null
      ) end
    ) order by session_data.ends_at desc, profile.display_name)
    from public.course_enrolments enrolment
    join public.course_runs run on run.id = enrolment.course_run_id
    join public.course_templates template on template.id = run.template_id
    join lateral (
      select max(ends_at) ends_at from public.course_sessions
      where course_run_id = run.id
    ) session_data on session_data.ends_at <= now()
    join lateral (
      select distinct claim.lecturer_id
      from public.jobs job
      join public.job_claims claim on claim.job_id = job.id
      where job.course_run_id = run.id and claim.status = 'confirmed'
    ) teachers on true
    join public.profiles profile on profile.id = teachers.lecturer_id and profile.active
    left join public.course_reviews review on review.course_run_id = run.id
      and review.lecturer_id = profile.id and review.reviewer_id = auth.uid()
    where enrolment.user_id = auth.uid() and enrolment.status = 'completed'
      and private.course_premium_access(run.id)
      and profile.id <> auth.uid()
  ), '[]'::jsonb);
end;
$$;

-- The legacy candidate list is organization-agnostic; keep it inaccessible
-- until the scoped participant invitation workflow is introduced separately.
revoke all on function private.enrolment_candidates()
  from public, anon, authenticated, service_role;
revoke all on function public.enrolment_candidates()
  from public, anon, authenticated, service_role;

-- Existing roster RPCs must include their own run ID in the entitlement check.
create or replace function private.course_enrolments(p_course_run_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_permission('courses.manage') then
    raise exception 'courses.manage required' using errcode = '42501';
  end if;
  perform private.lock_course_premium(p_course_run_id);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', enrolment.user_id,
      'display_name', profile.display_name,
      'status', enrolment.status,
      'updated_at', enrolment.updated_at
    ) order by profile.display_name)
    from public.course_enrolments enrolment
    join public.profiles profile on profile.id = enrolment.user_id
    where enrolment.course_run_id = p_course_run_id
  ), '[]'::jsonb);
end;
$$;

create or replace function private.manage_course_enrolment(
  p_course_run_id uuid, p_user_id uuid, p_status text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous text;
  course_end timestamptz;
begin
  if not private.has_permission('courses.manage') then
    raise exception 'courses.manage required' using errcode = '42501';
  end if;
  perform private.lock_course_premium(p_course_run_id);
  perform 1 from public.course_runs where id = p_course_run_id for update;
  if not found then raise exception 'Invalid course' using errcode = '22023'; end if;
  perform 1 from public.profiles where id = p_user_id and active for share;
  if not found or not exists (
    select 1 from public.user_roles
    where user_id = p_user_id and role in ('participant', 'admin', 'owner')
  ) or p_status is null or p_status not in ('enrolled', 'completed', 'removed') then
    raise exception 'Invalid participant' using errcode = '22023';
  end if;
  select max(ends_at) into course_end
  from public.course_sessions where course_run_id = p_course_run_id;
  if p_status = 'completed' and
     (course_end is null or course_end > now()) then
    raise exception 'Course has not completed' using errcode = '22023';
  end if;
  select status into previous from public.course_enrolments
  where course_run_id = p_course_run_id and user_id = p_user_id;
  insert into public.course_enrolments(course_run_id, user_id, status, enrolled_by)
  values (p_course_run_id, p_user_id, p_status, auth.uid())
  on conflict (course_run_id, user_id) do update
    set status = excluded.status, updated_at = now();
  insert into public.audit_events(actor_id, action, resource_id, details)
  values (
    auth.uid(), 'course.enrolment.changed', p_course_run_id,
    jsonb_build_object('user_id', p_user_id, 'previous', previous, 'status', p_status)
  );
end;
$$;

-- Course ratings, reviews and moderation remain available only while the
-- owning organization currently has Premium enabled.
create or replace function private.submit_course_review(
  p_course_run_id uuid, p_lecturer_id uuid,
  p_rating integer, p_comment text, p_version integer default 0
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous public.course_reviews%rowtype;
  target uuid;
  course_end timestamptz;
begin
  if not private.actor_active() then
    raise exception 'Active login required' using errcode = '42501';
  end if;
  if p_lecturer_id = auth.uid() or p_rating is null or p_rating not between 1 and 5 or
     not private.has_role(array['participant']) or
     p_comment is null or length(p_comment) > 2000 or p_version is null or p_version < 0 then
    raise exception 'Invalid review' using errcode = '22023';
  end if;
  perform private.lock_course_premium(p_course_run_id);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'course-review:' || p_course_run_id::text || ':' || auth.uid()::text || ':' || p_lecturer_id::text,
      0
    )
  );
  perform 1 from public.course_enrolments
  where course_run_id = p_course_run_id and user_id = auth.uid() and status = 'completed'
  for share;
  select max(ends_at) into course_end
  from public.course_sessions where course_run_id = p_course_run_id;
  if course_end is null or course_end > now() or
     not exists (
       select 1 from public.course_enrolments
       where course_run_id = p_course_run_id and user_id = auth.uid() and status = 'completed'
     ) or not exists (
       select 1 from public.jobs job
       join public.job_claims claim on claim.job_id = job.id
       where job.course_run_id = p_course_run_id
         and claim.lecturer_id = p_lecturer_id and claim.status = 'confirmed'
     ) or not private.profile_staff(p_lecturer_id) then
    raise exception 'Completed enrolment and assigned lecturer required' using errcode = '42501';
  end if;
  select * into previous from public.course_reviews
  where course_run_id = p_course_run_id and lecturer_id = p_lecturer_id
    and reviewer_id = auth.uid()
  for update;
  if found then
    if previous.version <> p_version then
      raise exception 'review_version_conflict' using errcode = '40001';
    end if;
    update public.course_reviews set
      rating = p_rating, comment = trim(p_comment),
      version = version + 1, deleted_at = null, updated_at = now()
    where id = previous.id returning id into target;
  else
    if p_version <> 0 then
      raise exception 'review_version_conflict' using errcode = '40001';
    end if;
    insert into public.course_reviews(
      course_run_id, lecturer_id, reviewer_id, rating, comment
    ) values (p_course_run_id, p_lecturer_id, auth.uid(), p_rating, trim(p_comment))
    returning id into target;
  end if;
  insert into public.audit_events(actor_id, action, resource_id, details)
  values (
    auth.uid(), 'course.review.saved', target,
    jsonb_build_object('course_run_id', p_course_run_id, 'lecturer_id', p_lecturer_id, 'version', p_version + 1)
  );
  return target;
end;
$$;

create or replace function private.delete_course_review(p_review_id uuid, p_version integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare previous public.course_reviews%rowtype;
begin
  select * into previous from public.course_reviews
  where id = p_review_id for update;
  if not private.actor_active() or not private.has_role(array['participant']) or
     not found or previous.reviewer_id <> auth.uid() then
    raise exception 'Review access denied' using errcode = '42501';
  end if;
  perform private.lock_course_premium(previous.course_run_id);
  if previous.version <> p_version then
    raise exception 'review_version_conflict' using errcode = '40001';
  end if;
  update public.course_reviews set
    comment = '', deleted_at = now(), version = version + 1, updated_at = now()
  where id = p_review_id;
  insert into public.audit_events(actor_id, action, resource_id)
  values (auth.uid(), 'course.review.deleted', p_review_id);
end;
$$;

create or replace function private.moderate_course_review(
  p_review_id uuid, p_hidden boolean, p_reason text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare course_run_id uuid;
begin
  if not private.has_permission('reviews.manage') then
    raise exception 'reviews.manage required' using errcode = '42501';
  end if;
  if p_hidden is null or p_reason is null or length(trim(p_reason)) not between 1 and 1000 then
    raise exception 'Moderation reason required' using errcode = '22023';
  end if;
  select review.course_run_id into course_run_id
  from public.course_reviews review
  where review.id = p_review_id and review.deleted_at is null
  for update;
  if not found then raise exception 'Review not found' using errcode = '22023'; end if;
  perform private.lock_course_premium(course_run_id);
  update public.course_reviews set
    hidden = p_hidden, moderation_reason = trim(p_reason),
    version = version + 1, updated_at = now()
  where id = p_review_id and deleted_at is null;
  if not found then raise exception 'Review not found' using errcode = '22023'; end if;
  insert into public.audit_events(actor_id, action, resource_id, details)
  values (
    auth.uid(), 'course.review.moderated', p_review_id,
    jsonb_build_object('hidden', p_hidden, 'reason', trim(p_reason))
  );
end;
$$;

-- Learners opt into this narrow actor check in the participant migration. The
-- general operational actor check and its callers remain unchanged.
create function private.learning_actor()
returns boolean language sql stable security definer set search_path = ''
as $$ select private.actor_active(); $$;
revoke all on function private.learning_actor() from public, anon, authenticated, service_role;

-- Course document delivery must recheck entitlement independently of workspace
-- metadata and exact Storage versions.
do $$
declare
  body text;
begin
  select prosrc into strict body
  from pg_catalog.pg_proc
  where oid = 'private.course_document_access(text,uuid)'::regprocedure;
  if strpos(body, 'if not private.actor_active() then') = 0 then
    raise exception 'Unexpected course document account check';
  end if;
  body := replace(body, 'if not private.actor_active() then', 'if not private.learning_actor() then');
  execute format(
    'create function private.course_document_access_before_premium(p_kind text,p_id uuid) returns jsonb language plpgsql stable security definer set search_path = %L as %L',
    '', body
  );
end;
$$;
revoke all on function private.course_document_access_before_premium(text, uuid)
  from public, anon, authenticated, service_role;
alter function private.course_document_access(text, uuid)
  rename to course_document_access_obsolete;
revoke all on function private.course_document_access_obsolete(text, uuid)
  from public, anon, authenticated, service_role;

create function private.course_document_access(p_kind text, p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  run_id uuid;
  context jsonb;
begin
  if p_kind = 'resource' then
    select resource.run_id into run_id
    from private.course_resources resource where resource.id = p_id;
  elsif p_kind = 'completion' then
    select record.run_id into run_id
    from private.course_completion_records record
    where record.id = p_id and record.revoked_at is null;
  elsif p_kind = 'attendance' then
    run_id := p_id;
  end if;
  if run_id is not null then
    context := private.course_workspace_context(run_id);
    if not coalesce((context->>'lms_enabled')::boolean, false) then
      raise exception 'Company Premium LMS is OFF' using errcode = '42501';
    end if;
  end if;
  return private.course_document_access_before_premium(p_kind, p_id);
end;
$$;

create or replace function public.course_document_access(p_kind text, p_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.course_document_access(p_kind, p_id); $$;

revoke all on function private.course_document_access(text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.course_document_access(text, uuid) to authenticated;
revoke all on function public.course_document_access(text, uuid) from public, anon;
grant execute on function public.course_document_access(text, uuid) to authenticated;

-- Preserve room membership and existing staff-room rules, adding the live
-- company entitlement for participant-course rooms on every direct/Realtime read.
create or replace function private.can_access_chat_room(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.actor_active() and exists (
    select 1
    from public.chat_members member
    join public.chat_rooms room on room.id = member.room_id
    where member.room_id = p_room_id
      and member.user_id = auth.uid()
      and member.removed_at is null
      and (
        room.kind <> 'participant_course' or
        coalesce(private.course_company_premium_enabled(room.course_run_id), false)
      )
      and (
        room.kind not in ('general', 'topic', 'lecturer_course') or
        (room.kind = 'general' and private.has_role(array['lecturer', 'senior_lecturer'])) or
        (room.kind in ('topic', 'lecturer_course') and private.chat_staff(auth.uid()))
      )
  );
$$;

-- Course search uses the same workspace actor/organization projection; an
-- enrolled participant cannot discover an OFF organization's course title.
create function private.course_search_allowed(p_run_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  context jsonb;
begin
  context := private.course_workspace_context(p_run_id);
  return coalesce((context->>'manager')::boolean, false) or
    coalesce((context->>'teacher')::boolean, false) or
    coalesce((context->>'client')::boolean, false) or
    (coalesce((context->>'lms_enabled')::boolean, false) and
     coalesce((context->>'learner')::boolean, false));
exception when insufficient_privilege then
  return false;
end;
$$;
revoke all on function private.course_search_allowed(uuid)
  from public, anon, authenticated, service_role;

-- Course-to-chat/job destination discovery is an LMS surface, not a way around
-- an OFF entitlement or the separately-scoped live chat predicate.
create or replace function private.course_operation_destinations(p_run_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  context jsonb;
begin
  context := private.course_workspace_context(p_run_id);
  if not coalesce((context->>'lms_enabled')::boolean, false) then
    raise exception 'Company Premium LMS is OFF' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'organisation', (
      select jsonb_build_object('id', organisation.id, 'name', organisation.name)
      from public.course_runs run
      join public.organisations organisation on organisation.id = run.organisation_id
      where run.id = p_run_id
    ),
    'lecturers', coalesce((
      select jsonb_agg(jsonb_build_object('id', profile.id, 'name', profile.display_name)
        order by profile.display_name, profile.id)
      from (
        select distinct p.id, p.display_name
        from public.profiles p
        join public.job_claims claim on claim.lecturer_id = p.id and claim.status = 'confirmed'
        join public.jobs job on job.id = claim.job_id
        where job.course_run_id = p_run_id and p.active and private.can_read_job(job.id)
      ) profile
    ), '[]'::jsonb),
    'jobs', coalesce((
      select jsonb_agg(jsonb_build_object('id', job.id, 'title', job.title)
        order by job.title, job.id)
      from public.jobs job
      where job.course_run_id = p_run_id and private.can_read_job(job.id)
    ), '[]'::jsonb),
    'rooms', coalesce((
      select jsonb_agg(jsonb_build_object('id', room.id, 'name', room.title)
        order by room.title, room.id)
      from public.chat_rooms room
      join public.jobs job on job.id = room.job_id
      where job.course_run_id = p_run_id and room.kind = 'lecturer_course'
        and private.can_access_chat_room(room.id)
    ), '[]'::jsonb)
  );
end;
$$;

-- Keep every existing domain's search ACL, paging bound and cursor ordering;
-- only replace the prior direct enrolment predicate for course results.
create or replace function private.unified_search(
  p_query text, p_kind text default '',
  p_after_kind text default null, p_after_title text default null,
  p_after_id uuid default null, p_limit integer default 40
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  items jsonb;
begin
  if not (private.actor_active() or (coalesce(p_kind in ('courses', 'chats'), false) and private.learning_actor())) then
    raise exception 'Active account required' using errcode = '42501';
  end if;
  if p_query is null or length(trim(p_query)) not between 2 and 100 or
     p_kind is null or p_kind not in ('', 'jobs', 'files', 'wiki', 'forum', 'chats', 'people', 'courses', 'clients', 'contracts', 'finance') or
     (p_after_kind is not null and p_after_kind not in ('jobs', 'files', 'wiki', 'forum', 'chats', 'people', 'courses', 'clients', 'contracts', 'finance')) or
     p_limit is null or p_limit not between 1 and 80 or
     (p_after_kind is null) <> (p_after_title is null) or
     (p_after_kind is null) <> (p_after_id is null) or
     length(p_after_title) > 1000 then
    raise exception 'Invalid search page' using errcode = '22023';
  end if;
  p_query := lower(trim(p_query));
  with available as (
    select job.id, 'jobs'::text kind, job.title, job.customer_name detail,
      '/jobs/' || job.id url
    from public.jobs job
    where private.can_read_job(job.id) and
      position(p_query in lower(job.title || ' ' || job.description || ' ' || job.customer_name)) > 0
    union all
    select document.id, 'files', document.original_name, ''::text,
      '/files?q=' || private.search_url_component(document.original_name)
    from public.documents document
    where document.deleted_at is null and document.status = 'clean' and
      private.can_access_document(document.id) and
      position(p_query in lower(document.original_name)) > 0
    union all
    select page.id, 'wiki', revision.title, revision.locale,
      '/wiki?page=' || page.id
    from public.wiki_pages page
    join public.wiki_revisions revision on revision.page_id = page.id and
      revision.version = case
        when page.owner_id = auth.uid() or private.has_permission('wiki.manage')
          then page.current_version else page.published_version end
    where not page.archived and private.can_read_wiki(page.id) and
      position(p_query in lower(revision.title || ' ' || revision.content_text)) > 0
    union all
    select thread.id, 'forum', thread.title, ''::text,
      '/forum?thread=' || thread.id
    from public.forum_threads thread
    where not thread.archived and private.can_read_forum(thread.id) and
      (position(p_query in lower(thread.title)) > 0 or exists (
        select 1 from public.forum_posts post
        where post.thread_id = thread.id and post.deleted_at is null and
          position(p_query in lower(post.content_text)) > 0
      ))
    union all
    select message.id, 'chats', left(message.body, 150), ''::text,
      '/chats?room=' || message.room_id
    from public.messages message
    where message.deleted_at is null and
      private.can_access_chat_room(message.room_id) and
      not private.chat_message_hidden(message.id) and
      position(p_query in lower(message.body)) > 0
    union all
    select profile.id, 'people', profile.display_name, ''::text,
      '/people/' || profile.id
    from public.profiles profile
    where private.profile_staff(profile.id) and private.can_read_person(profile.id) and
      position(p_query in lower(profile.display_name || ' ' || profile.bio_de || ' ' || profile.bio_en)) > 0
    union all
    select run.id, 'courses', template.title, coalesce(organisation.name, ''),
      case when private.course_premium_access(run.id)
        then '/courses/' || run.id || '/workspace' else '/courses?run=' || run.id end
    from public.course_runs run
    join public.course_templates template on template.id = run.template_id
    left join public.organisations organisation on organisation.id = run.organisation_id
    where run.archived_at is null and
      (private.can_read_course_run(run.id) or private.course_search_allowed(run.id)) and
      position(p_query in lower(template.title || ' ' || template.description || ' ' || coalesce(organisation.name, ''))) > 0
    union all
    select organisation.id, 'clients', organisation.name, ''::text,
      case when private.has_permission('organisations.manage') then '/clients'
        when private.client_has_organisation(organisation.id) then '/client'
        else '/courses' end
    from public.organisations organisation
    where private.favourite_resource('organisation', organisation.id) is not null and
      position(p_query in lower(organisation.name)) > 0
    union all
    select contract.id, 'contracts', contract.title, ''::text, '/contracts'
    from public.contracts contract
    where (contract.user_id = auth.uid() or private.has_permission('contracts.read') or
      private.has_permission('contracts.manage')) and
      position(p_query in lower(contract.title)) > 0
    union all
    select invoice.id, 'finance', invoice.number, invoice.currency, '/finance'
    from public.invoices invoice
    where private.can_read_invoice(invoice.id) and
      position(p_query in lower(invoice.number)) > 0
  ), page as (
    select * from available item
    where (p_kind = '' or item.kind = p_kind) and
      (p_after_kind is null or
        (item.kind, lower(item.title), item.id) > (p_after_kind, p_after_title, p_after_id))
    order by item.kind, lower(item.title), item.id
    limit p_limit + 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'kind', kind, 'title', title, 'detail', detail, 'url', url
  ) order by kind, lower(title), id), '[]'::jsonb)
  into items from page;
  return jsonb_build_object(
    'items', case when jsonb_array_length(items) > p_limit then items - p_limit else items end,
    'has_more', jsonb_array_length(items) > p_limit,
    'next_cursor', case when jsonb_array_length(items) > p_limit then jsonb_build_object(
      'kind', items->(p_limit - 1)->>'kind',
      'title', lower(items->(p_limit - 1)->>'title'),
      'id', items->(p_limit - 1)->>'id'
    ) else null end
  );
end;
$$;
revoke all on function private.unified_search(text, text, text, text, uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function private.unified_search(text, text, text, text, uuid, integer)
  to authenticated;

-- Preserve all current server-side workspace mutations and guard the action
-- boundary. Contact selection is retained as base organization management.
do $$
declare
  body text;
begin
  select prosrc into strict body
  from pg_catalog.pg_proc
  where oid = 'private.course_workspace_action(uuid,text,jsonb,integer)'::regprocedure;
  execute format(
    'create function private.course_workspace_action_before_premium(p_run_id uuid,p_action text,p_payload jsonb,p_expected_version integer default 0) returns jsonb language plpgsql security definer set search_path = %L as %L',
    '', body
  );
end;
$$;
revoke all on function private.course_workspace_action_before_premium(uuid, text, jsonb, integer)
  from public, anon, authenticated, service_role;
alter function private.course_workspace_action(uuid, text, jsonb, integer)
  rename to course_workspace_action_obsolete;
revoke all on function private.course_workspace_action_obsolete(uuid, text, jsonb, integer)
  from public, anon, authenticated, service_role;

create function private.course_workspace_action(
  p_run_id uuid, p_action text, p_payload jsonb,
  p_expected_version integer default 0
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.lock_course_premium(p_run_id);
  return private.course_workspace_action_before_premium(
    p_run_id, p_action, p_payload, p_expected_version
  );
end;
$$;

create or replace function public.course_workspace_action(
  p_run_id uuid, p_action text, p_payload jsonb,
  p_expected_version integer default 0
) returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.course_workspace_action(
    p_run_id, p_action, p_payload, p_expected_version
  );
$$;

revoke all on function private.course_workspace_action(uuid, text, jsonb, integer)
  from public, anon, authenticated, service_role;
grant execute on function private.course_workspace_action(uuid, text, jsonb, integer)
  to authenticated;
revoke all on function public.course_workspace_action(uuid, text, jsonb, integer)
  from public, anon;
grant execute on function public.course_workspace_action(uuid, text, jsonb, integer)
  to authenticated;

-- Only an active account with the actual admin role can issue a toggle. A
-- conflict is committed and audited as a result instead of raised and rolled
-- back, so callers can safely reload; cancelling in the UI calls no command.
create function private.set_company_premium(
  p_organisation_id uuid,
  p_enabled boolean,
  p_expected_version integer,
  p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  settings_row private.company_premium_settings%rowtype;
  previous_command private.company_premium_commands%rowtype;
  result_value jsonb;
  result_status text;
  old_enabled boolean;
  old_version integer;
begin
  if not private.is_company_premium_admin() then
    raise exception 'Active admin role required' using errcode = '42501';
  end if;
  if p_organisation_id is null or p_enabled is null or
     p_expected_version is null or p_expected_version < 0 or p_request_id is null then
    raise exception 'Valid company toggle request required' using errcode = '22023';
  end if;
  perform 1 from public.organisations
  where id = p_organisation_id and archived_at is null
  for update;
  if not found then
    raise exception 'Company unavailable' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('company-premium:' || p_organisation_id::text, 0)
  );
  select * into previous_command
  from private.company_premium_commands
  where actor_id = auth.uid() and request_id = p_request_id;
  if found then
    if previous_command.organisation_id <> p_organisation_id or
       previous_command.requested_enabled <> p_enabled or
       previous_command.expected_version <> p_expected_version then
      raise exception 'Company toggle request ID conflict' using errcode = '22023';
    end if;
    return previous_command.result;
  end if;

  insert into private.company_premium_settings(organisation_id)
  values (p_organisation_id) on conflict (organisation_id) do nothing;
  select * into settings_row
  from private.company_premium_settings
  where organisation_id = p_organisation_id
  for update;
  old_enabled := settings_row.enabled;
  old_version := settings_row.version;
  if settings_row.version <> p_expected_version then
    result_status := 'conflict';
    result_value := jsonb_build_object(
      'status', result_status,
      'enabled', settings_row.enabled,
      'version', settings_row.version
    );
  elsif settings_row.enabled = p_enabled then
    result_status := 'unchanged';
    result_value := jsonb_build_object(
      'status', result_status,
      'enabled', settings_row.enabled,
      'version', settings_row.version
    );
  else
    update private.company_premium_settings set
      enabled = p_enabled,
      version = version + 1,
      updated_by = auth.uid(),
      updated_at = clock_timestamp()
    where organisation_id = p_organisation_id
    returning * into settings_row;
    result_status := 'updated';
    result_value := jsonb_build_object(
      'status', result_status,
      'enabled', settings_row.enabled,
      'version', settings_row.version
    );
  end if;
  insert into private.company_premium_audit(
    actor_id, organisation_id, request_id, previous_enabled,
    requested_enabled, previous_version, expected_version, result
  ) values (
    auth.uid(), p_organisation_id, p_request_id,
    old_enabled,
    p_enabled, old_version, p_expected_version, result_status
  );
  insert into public.audit_events(actor_id, action, resource_id, details)
  values (
    auth.uid(),
    'company.premium.' || result_status,
    p_organisation_id,
    jsonb_build_object(
      'requested_enabled', p_enabled,
      'previous_enabled', old_enabled,
      'expected_version', p_expected_version,
      'actual_version', settings_row.version,
      'request_id', p_request_id
    )
  );
  insert into private.company_premium_commands(
    actor_id, request_id, organisation_id, requested_enabled,
    expected_version, result
  ) values (
    auth.uid(), p_request_id, p_organisation_id, p_enabled,
    p_expected_version, result_value
  );
  return result_value;
end;
$$;

-- Admin-only retention oversight returns scoped course summaries and clean
-- resource metadata, not private notebooks, unrelated DMs or storage paths.
create function private.retained_company_lms(p_organisation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
  course_count integer;
begin
  if not private.is_company_premium_admin() then
    raise exception 'Active admin role required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.organisations
    where id = p_organisation_id
  ) then
    raise exception 'Company unavailable' using errcode = '42501';
  end if;
  select count(*) into course_count
  from public.course_runs r where r.organisation_id = p_organisation_id;
  select coalesce(jsonb_agg(course.ordering order by course.title, course.run_id), '[]'::jsonb)
  into result
  from (
    select r.id run_id, t.title,
      jsonb_build_object(
        'run_id', r.id,
        'title', t.title,
        'archived_at', r.archived_at,
        'sessions', (select count(*) from public.course_sessions s where s.course_run_id = r.id),
        'enrolments', (select count(*) from public.course_enrolments e where e.course_run_id = r.id),
        'resources', coalesce((
          select jsonb_agg(jsonb_build_object(
            'name', v.original_name,
            'version', v.version,
            'audience', resource.audience,
            'removed', resource.removed_at is not null
          ) order by v.original_name, v.version)
          from private.course_resources resource
          join public.document_versions v on v.id = resource.version_id
          where resource.run_id = r.id
        ), '[]'::jsonb),
        'attendance_entries', (select count(*) from private.course_attendance a join public.course_sessions s on s.id = a.session_id where s.course_run_id = r.id),
        'course_group_messages', (select count(*) from public.messages m join public.chat_rooms room on room.id = m.room_id where room.course_run_id = r.id and room.kind = 'participant_course' and m.deleted_at is null),
        'questions', (select count(*) from private.course_questions q where q.run_id = r.id),
        'quiz_attempts', (select count(*) from private.course_quiz_attempts a where a.run_id = r.id),
        'completion_records', (select count(*) from private.course_completion_records completion where completion.run_id = r.id)
      ) ordering
    from public.course_runs r
    join public.course_templates t on t.id = r.template_id
    where r.organisation_id = p_organisation_id
  ) course;
  insert into public.audit_events(actor_id, action, resource_id, details)
  values (
    auth.uid(), 'company.premium_retained_data_viewed', p_organisation_id,
    jsonb_build_object('course_count', course_count, 'premium_enabled', private.company_premium_enabled(p_organisation_id))
  );
  return jsonb_build_object(
    'organisation_id', p_organisation_id,
    'premium_enabled', private.company_premium_enabled(p_organisation_id),
    'course_count', course_count,
    'courses', result
  );
end;
$$;

-- Public wrappers remain SECURITY INVOKER; implementations enforce the actual role.
create function public.company_premium_settings()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.company_premium_settings(); $$;

create function public.set_company_premium(
  p_organisation_id uuid, p_enabled boolean,
  p_expected_version integer, p_request_id uuid
) returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.set_company_premium(p_organisation_id, p_enabled, p_expected_version, p_request_id); $$;

create function public.retained_company_lms(p_organisation_id uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.retained_company_lms(p_organisation_id); $$;

revoke all on function private.company_premium_settings() from public, anon, authenticated, service_role;
revoke all on function private.set_company_premium(uuid, boolean, integer, uuid) from public, anon, authenticated, service_role;
revoke all on function private.retained_company_lms(uuid) from public, anon, authenticated, service_role;
grant execute on function private.company_premium_settings() to authenticated;
grant execute on function private.set_company_premium(uuid, boolean, integer, uuid) to authenticated;
grant execute on function private.retained_company_lms(uuid) to authenticated;
revoke all on function public.company_premium_settings() from public, anon;
revoke all on function public.set_company_premium(uuid, boolean, integer, uuid) from public, anon;
revoke all on function public.retained_company_lms(uuid) from public, anon;
grant execute on function public.company_premium_settings() to authenticated;
grant execute on function public.set_company_premium(uuid, boolean, integer, uuid) to authenticated;
grant execute on function public.retained_company_lms(uuid) to authenticated;

-- Keep base course information available to its actual staff/company scope,
-- while the learner relationship itself requires the current org entitlement.
create or replace function private.course_workspace_context(p_run_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  run_row public.course_runs%rowtype;
  manager boolean;
  teacher boolean;
  learner boolean;
  client boolean;
  lms_enabled boolean;
begin
  if not private.actor_active() then
    raise exception 'Active course account required' using errcode = '42501';
  end if;
  select * into run_row
  from public.course_runs where id = p_run_id and archived_at is null;
  if not found then
    raise exception 'Course unavailable' using errcode = '42501';
  end if;
  manager := private.has_permission('courses.manage');
  teacher := private.lecturer_actor() and exists (
    select 1 from public.job_claims claim
    join public.jobs job on job.id = claim.job_id
    where job.course_run_id = p_run_id
      and claim.lecturer_id = auth.uid()
      and claim.status = 'confirmed'
  );
  client := private.client_has_organisation(run_row.organisation_id);
  lms_enabled := private.company_premium_enabled(run_row.organisation_id);
  learner := lms_enabled and private.has_role(array['participant']) and exists (
    select 1 from public.course_enrolments enrolment
    where enrolment.course_run_id = p_run_id
      and enrolment.user_id = auth.uid()
      and enrolment.status in ('enrolled', 'completed')
  );
  if not (manager or teacher or client or learner) then
    raise exception 'Course unavailable' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'manager', manager,
    'teacher', teacher,
    'learner', learner,
    'client', client,
    'staff', manager or teacher,
    'lms_enabled', lms_enabled
  );
end;
$$;

-- Serialize company-level LMS mutations with the admin switch. Both acquire
-- the organization row before reading or changing the entitlement row.
create function private.lock_company_premium(p_organisation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare enabled_now boolean;
begin
  perform 1 from public.organisations
  where id = p_organisation_id and archived_at is null
  for share;
  if not found then
    raise exception 'Company Premium LMS is OFF' using errcode = '42501';
  end if;
  select settings.enabled into enabled_now
  from private.company_premium_settings settings
  where settings.organisation_id = p_organisation_id
  for share;
  if not found or not enabled_now then
    raise exception 'Company Premium LMS is OFF' using errcode = '42501';
  end if;
end;
$$;
revoke all on function private.lock_company_premium(uuid)
  from public, anon, authenticated, service_role;

-- Pin the course-to-company relationship before checking the entitlement.
create function private.lock_course_premium(p_run_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare company_id uuid;
begin
  select run.organisation_id into company_id
  from public.course_runs run
  where run.id = p_run_id and run.archived_at is null
  for no key update;
  perform private.lock_company_premium(company_id);
end;
$$;
revoke all on function private.lock_course_premium(uuid)
  from public, anon, authenticated, service_role;

-- Self-cancellation remains an all-course action, but only a current participant
-- on an enabled company can invoke the learning-specific workflow.
create or replace function private.cancel_own_course_enrolment(p_course_run_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  first_start timestamptz;
  room record;
  actor uuid := auth.uid();
begin
  if not private.actor_active() or not private.has_role(array['participant']) then
    raise exception 'Active participant required' using errcode = '42501';
  end if;
  perform private.lock_course_premium(p_course_run_id);
  perform 1 from public.profiles where id = actor for share;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(actor::text, 0)
  );
  perform 1 from public.course_runs where id = p_course_run_id for update;
  if not found then
    raise exception 'Active enrolment required' using errcode = '42501';
  end if;
  perform 1 from public.course_enrolments
  where course_run_id = p_course_run_id and user_id = actor and status = 'enrolled'
  for update;
  if not found then
    raise exception 'Active enrolment required' using errcode = '42501';
  end if;
  select min(starts_at) into first_start
  from public.course_sessions where course_run_id = p_course_run_id;
  if first_start is null or first_start < clock_timestamp() + interval '7 days' then
    raise exception 'Cancellation deadline passed' using errcode = '22023';
  end if;
  update public.course_enrolments set status = 'removed', updated_at = clock_timestamp()
  where course_run_id = p_course_run_id and user_id = actor;
  for room in
    select id from public.chat_rooms
    where course_run_id = p_course_run_id and kind = 'participant_course'
    order by id for update
  loop
    perform private.participant_chat_assignment_release(room.id, actor, p_course_run_id);
  end loop;
  insert into public.audit_events(actor_id, action, resource_id, details)
  values (
    actor, 'course.enrolment.changed', p_course_run_id,
    jsonb_build_object(
      'user_id', actor, 'previous', 'enrolled', 'status', 'removed',
      'self_cancelled', true
    )
  );
end;
$$;
revoke all on function private.cancel_own_course_enrolment(uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.cancel_own_course_enrolment(uuid) to authenticated;

-- Existing course resources are all behind the same current entitlement.
create or replace function private.course_resource_allowed(p_resource_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  resource_row private.course_resources%rowtype;
  context jsonb;
begin
  select * into resource_row
  from private.course_resources
  where id = p_resource_id and removed_at is null;
  if not found then return false; end if;
  begin
    context := private.course_workspace_context(resource_row.run_id);
  exception when insufficient_privilege then
    return false;
  end;
  if not coalesce((context->>'lms_enabled')::boolean, false) then return false; end if;
  return (context->>'staff')::boolean or
    resource_row.audience = 'all' or
    (resource_row.audience = 'client' and (context->>'client')::boolean) or
    (resource_row.audience = 'participants' and (context->>'learner')::boolean);
end;
$$;

-- The participant dashboard omits every OFF company course even when the same
-- Auth account has a retained enrolment or an enabled company elsewhere.
create or replace function private.my_course_workspaces()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.actor_active() then
    raise exception 'Active account required' using errcode = '42501';
  end if;
  return (
    select coalesce(jsonb_agg(to_jsonb(course) order by course.starts_at desc nulls last, course.id), '[]'::jsonb)
    from (
      select run.id, template.title, template.description, template.syllabus,
        run.time_zone, run.venue, run.delivery_type,
        private.company_premium_enabled(run.organisation_id) lms_enabled,
        min(session.starts_at) starts_at,
        max(session.ends_at) ends_at,
        private.company_premium_enabled(run.organisation_id) and
        private.has_role(array['participant']) and exists (
          select 1 from public.course_enrolments enrolment
          where enrolment.course_run_id = run.id
            and enrolment.user_id = auth.uid()
            and enrolment.status in ('enrolled', 'completed')
        ) participant
      from public.course_runs run
      join public.course_templates template on template.id = run.template_id
      left join public.course_sessions session on session.course_run_id = run.id
      where run.archived_at is null and (
        private.has_permission('courses.manage') or
        private.client_has_organisation(run.organisation_id) or
        exists (
          select 1 from public.job_claims claim
          join public.jobs job on job.id = claim.job_id
          where job.course_run_id = run.id
            and claim.lecturer_id = auth.uid()
            and claim.status = 'confirmed'
        ) or (
          private.company_premium_enabled(run.organisation_id) and
          private.has_role(array['participant']) and exists (
            select 1 from public.course_enrolments enrolment
            where enrolment.course_run_id = run.id
              and enrolment.user_id = auth.uid()
              and enrolment.status in ('enrolled', 'completed')
          )
        )
      )
      group by run.id, template.title, template.description, template.syllabus,
        run.organisation_id
      order by min(session.starts_at) desc nulls last, run.id
      limit 200
    ) course
  );
end;
$$;

-- Preserve the existing full workspace projection only for current ON access;
-- OFF staff/company views retain base course details and planned sessions only.
do $$
declare
  body text;
begin
  select prosrc into strict body
  from pg_catalog.pg_proc
  where oid = 'private.course_workspace(uuid)'::regprocedure;
  execute format(
    'create function private.course_workspace_before_premium(p_run_id uuid) returns jsonb language plpgsql stable security definer set search_path = %L as %L',
    '', body
  );
end;
$$;
revoke all on function private.course_workspace_before_premium(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.course_workspace(p_run_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  context jsonb;
  result jsonb;
begin
  context := private.course_workspace_context(p_run_id);
  if not coalesce((context->>'lms_enabled')::boolean, false) then
    raise exception 'company_premium_lms_off' using errcode = '42501';
  end if;
  result := private.course_workspace_before_premium(p_run_id);
  return result || jsonb_build_object('lms_enabled', true);
end;
$$;

-- Course notification targets expose no title/link while the owning company's
-- Premium entitlement is OFF; queued email/push dispatch uses this same result.
create or replace function private.course_notification_target(
  p_kind text, p_resource uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  run_id uuid;
  heading text;
  context jsonb;
  item private.course_preparation_items%rowtype;
  question private.course_questions%rowtype;
  completion private.course_completion_records%rowtype;
begin
  if not private.actor_active() then
    return jsonb_build_object('href', null, 'title', '');
  end if;
  if p_kind = 'course_preparation_updated' then
    select * into item from private.course_preparation_items where id = p_resource;
    run_id := item.run_id;
  elsif p_kind in ('course_question', 'course_answer') then
    select * into question from private.course_questions where id = p_resource;
    run_id := question.run_id;
  elsif p_kind = 'course_resource_shared' then
    select resource.run_id into run_id
    from private.course_resources resource
    where resource.id = p_resource and private.course_resource_allowed(resource.id);
  elsif p_kind = 'course_quiz_published' then
    select quiz.run_id into run_id
    from private.course_quizzes quiz
    join private.course_quiz_versions version
      on version.run_id = quiz.run_id and version.version = quiz.version
    where quiz.run_id = p_resource and version.published;
  elsif p_kind in ('course_completion_issued', 'course_completion_revoked') then
    select * into completion
    from private.course_completion_records record
    where record.id = p_resource and record.user_id = auth.uid();
    run_id := completion.run_id;
  elsif p_kind = 'course_attendance_updated' then
    select session.course_run_id into run_id
    from public.course_sessions session
    join private.course_attendance attendance
      on attendance.session_id = session.id and attendance.user_id = auth.uid()
    where session.id = p_resource;
  end if;
  if run_id is null then return jsonb_build_object('href', null, 'title', ''); end if;
  begin
    context := private.course_workspace_context(run_id);
  exception when insufficient_privilege then
    return jsonb_build_object('href', null, 'title', '');
  end;
  if not coalesce((context->>'lms_enabled')::boolean, false) or
     (p_kind = 'course_preparation_updated' and not (
       (context->>'staff')::boolean or
       (item.client_visible and (context->>'client')::boolean)
     )) or
     (p_kind = 'course_question' and not (context->>'staff')::boolean) or
     (p_kind = 'course_answer' and question.author_id <> auth.uid()) or
     (p_kind = 'course_quiz_published' and not (context->>'learner')::boolean) then
    return jsonb_build_object('href', null, 'title', '');
  end if;
  select template.title into heading
  from public.course_runs run
  join public.course_templates template on template.id = run.template_id
  where run.id = run_id;
  return jsonb_build_object(
    'title', coalesce(heading, ''),
    'href', '/courses/' || run_id || '/workspace'
  );
end;
$$;

-- The inbox and unread/quiet count omit course or group-chat events that no
-- longer have an active current-entitlement destination.
create function private.notification_currently_visible(p_kind text, p_resource uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when left(coalesce(p_kind, ''), 7) = 'course_' or p_kind = 'chat_message'
      then coalesce((private.notification_target(p_kind, p_resource)->>'href') is not null, false)
    else true
  end;
$$;
revoke all on function private.notification_currently_visible(text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.notification_currently_visible(text, uuid)
  to authenticated;

create or replace function private.notification_inbox(
  p_unread_only boolean default false, p_before_at timestamptz default null,
  p_before_id uuid default null, p_limit integer default 40
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
  total bigint;
begin
  if not private.actor_active() then
    raise exception 'Account inactive' using errcode = '42501';
  end if;
  if p_unread_only is null or p_limit is null or p_limit not between 1 and 100 or
     ((p_before_at is null) <> (p_before_id is null)) or
     (p_before_at is not null and not isfinite(p_before_at)) then
    raise exception 'Invalid inbox cursor' using errcode = '22023';
  end if;
  select count(*) into total
  from public.notifications notification
  where notification.user_id = auth.uid() and notification.read_at is null
    and private.notification_currently_visible(notification.kind, notification.resource_id);
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', notification.id,
      'kind', notification.kind,
      'read_at', notification.read_at,
      'created_at', notification.created_at
    ) || private.notification_target(notification.kind, notification.resource_id)
    order by notification.created_at desc, notification.id desc
  ), '[]'::jsonb) into result
  from (
    select * from public.notifications notification
    where notification.user_id = auth.uid()
      and (not p_unread_only or notification.read_at is null)
      and (p_before_at is null or (notification.created_at, notification.id) < (p_before_at, p_before_id))
      and private.notification_currently_visible(notification.kind, notification.resource_id)
    order by notification.created_at desc, notification.id desc
    limit p_limit
  ) notification;
  return jsonb_build_object('items', result, 'unread_count', total, 'as_of', now());
end;
$$;

create or replace function private.notification_attention()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  preferences private.attention_preferences;
  total bigint;
begin
  if not private.actor_active() then
    raise exception 'Account inactive' using errcode = '42501';
  end if;
  select * into preferences from private.attention_preferences where user_id = auth.uid();
  if not found or not preferences.enabled or not private.attention_is_quiet(
    now(), preferences.time_zone, preferences.starts_minute, preferences.ends_minute
  ) then
    return jsonb_build_object('quiet_active', false);
  end if;
  select count(*) into total
  from public.notifications notification
  where notification.user_id = auth.uid() and notification.read_at is null
    and private.notification_currently_visible(notification.kind, notification.resource_id)
    and (
      notification.kind in (
        'claim_confirmed', 'claim_cancelled', 'contract_available',
        'substitution_proposed', 'substitution_closed', 'task_assigned',
        'timesheet_reviewed', 'course_attendance_updated',
        'course_completion_issued', 'course_completion_revoked'
      ) or (notification.kind = 'portal_announcement' and
        private.can_read_announcement_revision(notification.resource_id))
    );
  return jsonb_build_object('quiet_active', true, 'attention_count', total);
end;
$$;

-- Preserve the notification source matrix but stop generating new course
-- notices while that company's learning module is disabled.
create or replace function private.notify_course_workspace_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_id uuid;
  event_kind text;
  resource uuid;
  recipient uuid;
  only_user uuid;
  allow_clients boolean := false;
  allow_learners boolean := false;
  allow_staff boolean := false;
begin
  if tg_table_name = 'course_preparation_items' then
    if tg_op = 'INSERT' or new.done is not distinct from old.done then return new; end if;
    run_id := new.run_id; event_kind := 'course_preparation_updated';
    resource := new.id; allow_clients := new.client_visible; allow_staff := true;
  elsif tg_table_name = 'course_questions' then
    if tg_op = 'UPDATE' and new.answer is not distinct from old.answer then return new; end if;
    run_id := new.run_id; resource := new.id;
    if tg_op = 'INSERT' then event_kind := 'course_question'; allow_staff := true;
    else event_kind := 'course_answer'; only_user := new.author_id; end if;
  elsif tg_table_name = 'course_resources' then
    if new.removed_at is not null or (tg_op = 'UPDATE' and old.removed_at is null) then return new; end if;
    run_id := new.run_id; event_kind := 'course_resource_shared'; resource := new.id;
    allow_staff := true; allow_clients := new.audience in ('client', 'all');
    allow_learners := new.audience in ('participants', 'all');
  elsif tg_table_name = 'course_quiz_versions' then
    if not new.published or not exists (
      select 1 from private.course_quizzes quiz
      where quiz.run_id = new.run_id and quiz.version = new.version
    ) then return new; end if;
    run_id := new.run_id; event_kind := 'course_quiz_published';
    resource := new.run_id; allow_learners := true;
  elsif tg_table_name = 'course_attendance' then
    if tg_op = 'UPDATE' and new.state is not distinct from old.state and
       new.minutes is not distinct from old.minutes then return new; end if;
    select session.course_run_id into run_id
    from public.course_sessions session where session.id = new.session_id;
    event_kind := 'course_attendance_updated'; resource := new.session_id;
    only_user := new.user_id;
  elsif tg_table_name = 'course_completion_records' then
    if tg_op = 'UPDATE' and new.revoked_at is not distinct from old.revoked_at then return new; end if;
    run_id := new.run_id;
    event_kind := case when new.revoked_at is null
      then 'course_completion_issued' else 'course_completion_revoked' end;
    resource := new.id; only_user := new.user_id;
  end if;
  if run_id is null or not private.company_premium_enabled((
    select course.organisation_id from public.course_runs course where course.id = run_id
  )) then return new; end if;
  for recipient in
    select profile.id from (
      select only_user user_id where only_user is not null
      union select enrolment.user_id from public.course_enrolments enrolment
        where allow_learners and enrolment.course_run_id = run_id
          and enrolment.status in ('enrolled', 'completed')
      union select claim.lecturer_id from public.job_claims claim
        join public.jobs job on job.id = claim.job_id
        where allow_staff and job.course_run_id = run_id
          and claim.status = 'confirmed' and private.lecturer_user(claim.lecturer_id)
      union select membership.user_id from public.course_runs course
        join public.client_organisation_memberships membership
          on membership.organisation_id = course.organisation_id
        join public.user_roles role on role.user_id = membership.user_id and role.role = 'client'
        where allow_clients and course.id = run_id and membership.removed_at is null
    ) candidates
    join public.profiles profile on profile.id = candidates.user_id
    where profile.active and profile.id is distinct from auth.uid()
  loop
    insert into public.notifications(user_id, kind, resource_id)
    values (recipient, event_kind, resource)
    on conflict (user_id, kind, resource_id) do update
      set created_at = clock_timestamp(), read_at = null;
  end loop;
  return new;
end;
$$;

-- RLS covers direct PostgREST reads/edits as well as the RPC inbox; stale
-- entitlement-specific receipts are hidden but retained for a later audit.
alter policy notification_read on public.notifications using (
  (select private.actor_active()) and
  user_id = (select auth.uid()) and
  private.notification_currently_visible(kind, resource_id)
);
alter policy notification_edit on public.notifications using (
  (select private.actor_active()) and
  user_id = (select auth.uid()) and
  private.notification_currently_visible(kind, resource_id)
) with check (
  (select private.actor_active()) and
  user_id = (select auth.uid()) and
  private.notification_currently_visible(kind, resource_id)
);

notify pgrst, 'reload schema';
commit;