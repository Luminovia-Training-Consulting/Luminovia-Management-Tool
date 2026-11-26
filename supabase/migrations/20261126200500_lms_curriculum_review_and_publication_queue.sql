-- Optional review and scheduled publication pin one exact saved draft.
begin;

create table private.course_curriculum_reviews (
  run_id uuid not null references public.course_runs(id) on delete cascade,
  published_version integer not null check (published_version >= 0),
  draft_version integer not null check (draft_version > 0),
  state text not null check (state in ('requested', 'approved', 'returned', 'cancelled', 'scheduled', 'published', 'blocked')),
  publish_at timestamptz,
  scheduler_id uuid references public.profiles(id) on delete set null,
  primary key (run_id, published_version, draft_version),
  check (state <> 'scheduled' or publish_at is not null)
);
create index course_curriculum_reviews_due on private.course_curriculum_reviews(publish_at, run_id)
where state = 'scheduled';
alter table private.course_curriculum_reviews enable row level security;
revoke all on private.course_curriculum_reviews from public, anon, authenticated, service_role;

-- Manual and scheduled publication use the same release, pinning and audit logic.
-- Callers hold the course and draft locks and have revalidated their authority.
create function private.publish_course_curriculum(
  p_run_id uuid, p_version integer, p_content jsonb, p_actor_id uuid
) returns void language plpgsql security invoker set search_path = '' as $$
begin
  if not private.course_authoring_content_valid(p_content) then
    raise exception 'Invalid course curriculum' using errcode = '22023';
  end if;
  insert into private.course_content_revisions(course_run_id, version, content, published_by)
  values (p_run_id, p_version, p_content, p_actor_id);
  delete from private.course_content_drafts where course_run_id = p_run_id;
  update public.course_enrolments set course_content_version = p_version
  where course_run_id = p_run_id and status = 'enrolled' and course_content_version is null;
  insert into public.audit_events(actor_id, action, resource_id)
  values (p_actor_id, 'course.content.published', p_run_id);
end;
$$;
revoke all on function private.publish_course_curriculum(uuid, integer, jsonb, uuid)
from public, anon, authenticated, service_role;

create or replace function private.course_content_studio(p_run_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  context jsonb;
  latest_version integer;
  visible_version integer;
  visible_content jsonb;
  visible_at timestamptz;
  draft private.course_content_drafts%rowtype;
  enrolment public.course_enrolments%rowtype;
begin
  context := private.course_workspace_context(p_run_id);
  if (context->>'lms_enabled')::boolean is not true or
     (context->>'staff')::boolean is not true and (context->>'learner')::boolean is not true then
    raise exception 'Course curriculum unavailable' using errcode = '42501';
  end if;
  select max(version) into latest_version
  from private.course_content_revisions where course_run_id = p_run_id;

  if (context->>'staff')::boolean then
    visible_version := coalesce(latest_version, 0);
  else
    select * into enrolment from public.course_enrolments
    where course_run_id = p_run_id and user_id = auth.uid()
      and status in ('enrolled', 'completed');
    if not found then raise insufficient_privilege; end if;
    visible_version := coalesce(enrolment.course_content_version, 0);
  end if;

  select revision.content, revision.published_at
  into visible_content, visible_at
  from private.course_content_revisions revision
  where revision.course_run_id = p_run_id and revision.version = visible_version;

  if (context->>'staff')::boolean then
    select * into draft from private.course_content_drafts
    where course_run_id = p_run_id;
    return jsonb_build_object(
      'can_edit', true,
      'published_version', coalesce(latest_version, 0),
      'published_content', coalesce(visible_content, jsonb_build_object('modules', '[]'::jsonb)),
      'published_at', visible_at,
      'draft_version', coalesce(draft.version, 0),
      'draft_base_version', coalesce(draft.base_version, coalesce(latest_version, 0)),
      'draft_content', draft.content,
      'review', (
        select jsonb_build_object('state', review.state, 'publish_at', review.publish_at)
        from private.course_curriculum_reviews review
        where review.run_id = p_run_id and review.published_version = draft.base_version
          and review.draft_version = draft.version and review.state <> 'cancelled'
      ),
      'versions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'version', revision.version, 'published_at', revision.published_at,
          'module_count', jsonb_array_length(revision.content->'modules')
        ) order by revision.version desc)
        from private.course_content_revisions revision
        where revision.course_run_id = p_run_id
      ), '[]'::jsonb)
    );
  end if;

  return jsonb_build_object(
    'can_edit', false,
    'published_version', visible_version,
    'published_content', private.learner_curriculum(p_run_id, visible_content),
    'published_at', visible_at,
    'draft_version', 0,
    'draft_base_version', 0,
    'draft_content', null,
    'versions', '[]'::jsonb
  );
end;
$$;

create or replace function private.course_content_action(p_run_id uuid, p_action text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  context jsonb;
  actor_id uuid := auth.uid();
  course_org_id uuid;
  current_version integer;
  current_draft private.course_content_drafts%rowtype;
  source_revision private.course_content_revisions%rowtype;
  target_user uuid;
  target_version integer;
  expected_version integer;
  expected_draft integer;
  review private.course_curriculum_reviews;
  desired_state text;
  planned_at timestamptz;
begin
  context := private.course_workspace_context(p_run_id);
  if (context->>'staff')::boolean is not true then
    raise exception 'Assigned course author required' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('save_draft', 'publish', 'restore', 'migrate',
       'request_review', 'approve_review', 'return_review', 'cancel_review', 'schedule_publish') or
     p_payload is null or jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'Invalid course authoring action' using errcode = '22023';
  end if;

  if (select edition from private.installation_identity) = 'internal' then
    perform private.lock_course_premium(p_run_id);
  else
    perform private.lock_academy_course_access();
    perform 1 from public.profiles where id = actor_id and active for share;
    if not found then raise insufficient_privilege; end if;
    perform 1 from public.user_roles where user_id = actor_id order by role for share;
    select organisation.id into course_org_id
    from public.course_runs run
    join public.organisations organisation on organisation.id = run.organisation_id
    where run.id = p_run_id and run.archived_at is null and organisation.archived_at is null
    for no key update of run for share of organisation;
    if not found then raise insufficient_privilege; end if;
    perform 1 from public.client_organisation_memberships membership
    where membership.organisation_id = course_org_id and membership.user_id = actor_id
    for share;
    perform 1 from public.job_claims claim
    join public.jobs job on job.id = claim.job_id
    where job.course_run_id = p_run_id and claim.lecturer_id = actor_id
      and claim.status = 'confirmed'
    for share of claim;
  end if;
  context := private.course_workspace_context(p_run_id);
  if (context->>'lms_enabled')::boolean is not true or
     (context->>'staff')::boolean is not true then
    raise exception 'Assigned course author required' using errcode = '42501';
  end if;

  select coalesce(max(version), 0) into current_version
  from private.course_content_revisions where course_run_id = p_run_id;
  if p_action <> 'migrate' then
    if jsonb_typeof(p_payload->'published_version') is distinct from 'number'
       or (p_payload->>'published_version') !~ '^(0|[1-9][0-9]{0,8})$'
       or jsonb_typeof(p_payload->'draft_version') is distinct from 'number'
       or (p_payload->>'draft_version') !~ '^(0|[1-9][0-9]{0,8})$' then
      raise exception 'Invalid course revision version' using errcode = '22023';
    end if;
    expected_version := (p_payload->>'published_version')::integer;
    expected_draft := (p_payload->>'draft_version')::integer;
    if current_version <> expected_version then
      raise exception 'Published course content changed' using errcode = 'PT409';
    end if;
    select * into current_draft from private.course_content_drafts
    where course_run_id = p_run_id for update;
    if coalesce(current_draft.version, 0) <> expected_draft or
       (found and current_draft.base_version <> current_version) then
      raise exception 'Course draft changed' using errcode = 'PT409';
    end if;
    select * into review from private.course_curriculum_reviews
    where run_id = p_run_id and published_version = current_version and draft_version = expected_draft;
  end if;

  if p_action in ('save_draft','restore') and review.state in ('requested','approved','scheduled') then
    raise sqlstate 'PT409' using message = 'Cancel or return the review before changing the draft';
  end if;

  if p_action in ('request_review','approve_review','return_review','cancel_review','schedule_publish') then
    if current_draft.version is null then raise invalid_parameter_value; end if;
    if p_action in ('approve_review','return_review','schedule_publish')
      and (context->>'manager')::boolean is not true then raise insufficient_privilege; end if;
    if p_action = 'cancel_review' and review.state in ('approved','scheduled')
      and (context->>'manager')::boolean is not true then raise insufficient_privilege; end if;

    if p_action = 'request_review' and (review.state is null or review.state in ('returned','cancelled','blocked')) then
      desired_state := 'requested';
    elsif p_action = 'approve_review' and review.state = 'requested' then
      desired_state := 'approved';
    elsif p_action = 'return_review' and review.state = 'requested' then
      desired_state := 'returned';
    elsif p_action = 'cancel_review' and review.state in ('requested','approved','returned','scheduled','blocked') then
      desired_state := 'cancelled';
    elsif p_action = 'schedule_publish' and review.state = 'approved' then
      if jsonb_typeof(p_payload->'publish_at') is distinct from 'string'
        or (p_payload->>'publish_at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
        or not pg_input_is_valid(p_payload->>'publish_at', 'timestamptz') then raise invalid_parameter_value; end if;
      planned_at := (p_payload->>'publish_at')::timestamptz;
      if planned_at <= clock_timestamp() or planned_at > clock_timestamp() + interval '365 days' then
        raise invalid_parameter_value;
      end if;
      desired_state := 'scheduled';
    else
      raise sqlstate 'PT409' using message = 'Course curriculum review changed';
    end if;

    insert into private.course_curriculum_reviews(run_id,published_version,draft_version,state,publish_at,scheduler_id)
    values (p_run_id,current_version,expected_draft,desired_state,planned_at,
      case when desired_state='scheduled' then actor_id end)
    on conflict (run_id,published_version,draft_version) do update set
      state=excluded.state, publish_at=excluded.publish_at, scheduler_id=excluded.scheduler_id;
    insert into public.audit_events(actor_id,action,resource_id,details)
    values (actor_id,'course.content.review_' || desired_state,p_run_id,
      jsonb_build_object('published_version',current_version,'draft_version',expected_draft,'publish_at',planned_at));
    return private.course_content_studio(p_run_id);
  end if;

  if p_action = 'save_draft' then
    if not private.course_authoring_content_valid(p_payload->'content') then
      raise exception 'Invalid course curriculum' using errcode = '22023';
    end if;
    insert into private.course_content_drafts(
      course_run_id, base_version, version, content, updated_by
    ) values (
      p_run_id, current_version, 1, p_payload->'content', auth.uid()
    ) on conflict (course_run_id) do update set
      version = private.course_content_drafts.version + 1,
      content = excluded.content,
      updated_by = auth.uid(),
      updated_at = now();
  elsif p_action = 'publish' then
    if current_draft.version is null then
      raise exception 'Save a course draft before publishing' using errcode = '22023';
    end if;
    if review.state in ('requested','returned','scheduled','blocked') then
      raise sqlstate 'PT409' using message = 'Review approval or cancellation is required';
    end if;
    perform private.publish_course_curriculum(p_run_id, current_version + 1, current_draft.content, actor_id);
    update private.course_curriculum_reviews set state = 'published'
    where run_id = p_run_id and published_version = current_version and draft_version = expected_draft
      and state = 'approved';
  elsif p_action = 'restore' then
    if jsonb_typeof(p_payload->'source_version') is distinct from 'number'
       or (p_payload->>'source_version') !~ '^[1-9][0-9]{0,8}$' then
      raise exception 'Invalid source revision' using errcode = '22023';
    end if;
    select * into source_revision from private.course_content_revisions
    where course_run_id = p_run_id and version = (p_payload->>'source_version')::integer;
    if not found then raise exception 'Course revision unavailable' using errcode = '42501'; end if;
    insert into private.course_content_drafts(
      course_run_id, base_version, version, content, updated_by
    ) values (
      p_run_id, current_version, 1, source_revision.content, auth.uid()
    ) on conflict (course_run_id) do update set
      version = private.course_content_drafts.version + 1,
      base_version = current_version,
      content = excluded.content,
      updated_by = auth.uid(),
      updated_at = now();
  elsif p_action = 'migrate' then
    if (context->>'manager')::boolean is not true then
      raise exception 'Course management required for participant migration' using errcode = '42501';
    end if;
    if jsonb_typeof(p_payload->'target_version') is distinct from 'number'
       or (p_payload->>'target_version') !~ '^[1-9][0-9]{0,8}$'
       or jsonb_typeof(p_payload->'user_id') is distinct from 'string'
       or (p_payload->>'user_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Invalid participant content migration' using errcode = '22023';
    end if;
    target_version := (p_payload->>'target_version')::integer;
    target_user := (p_payload->>'user_id')::uuid;
    if target_version > current_version or not exists (
      select 1 from private.course_content_revisions
      where course_run_id = p_run_id and version = target_version
    ) then
      raise exception 'Target course revision unavailable' using errcode = '42501';
    end if;
    select enrolment.course_content_version into expected_version
    from public.course_enrolments enrolment
    where course_run_id = p_run_id and user_id = target_user and status = 'enrolled'
    for update;
    if not found then raise exception 'Active course enrolment required' using errcode = '42501'; end if;
    if expected_version = target_version then return private.course_content_studio(p_run_id); end if;
    if expected_version > target_version then
      raise exception 'Target revision must be newer than the current revision' using errcode = '22023';
    end if;
    update public.course_enrolments set course_content_version = target_version
    where course_run_id = p_run_id and user_id = target_user;
    insert into public.audit_events(actor_id, action, resource_id)
    values (
      auth.uid(),
      format('course.content.participant_migrated:%s:revision_%s', target_user, target_version),
      p_run_id
    );
  end if;
  return private.course_content_studio(p_run_id);
end;
$$;

-- Bounded cron work. Manual writers and the worker take the course row
-- before the draft; two workers never pick the same course concurrently.
create function private.run_scheduled_course_publications()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  job private.course_curriculum_reviews;
  draft private.course_content_drafts;
  course_company uuid;
  completed integer := 0;
begin
  if (select edition from private.installation_identity) <> 'internal' then
    perform 1 from private.installation_identity where singleton for share;
  end if;
  for job in select review.*
    from private.course_curriculum_reviews review
    join public.course_runs run on run.id = review.run_id
    where review.state = 'scheduled' and review.publish_at <= clock_timestamp()
    order by review.publish_at, review.run_id limit 20 for no key update of run skip locked
  loop
    -- The candidate came from the outer query snapshot. Recheck current state
    -- after acquiring the course lock, so a concurrent cancellation wins.
    select * into job from private.course_curriculum_reviews
    where run_id=job.run_id and published_version=job.published_version
      and draft_version=job.draft_version and state='scheduled' and publish_at <= clock_timestamp()
    for update;
    if not found then continue; end if;
    begin
      select organisation_id into strict course_company from public.course_runs
      where id = job.run_id and archived_at is null;
      if (select edition from private.installation_identity) = 'internal' then
        perform private.lock_company_premium(course_company);
      else
        perform private.lock_academy_course_access();
        perform 1 from public.organisations where id = course_company and archived_at is null for share;
        if not found then raise insufficient_privilege; end if;
      end if;
      perform 1 from public.profiles profile
      where profile.id = job.scheduler_id and profile.active for share;
      if not found then raise insufficient_privilege; end if;
      perform 1 from public.user_roles role join public.role_permissions permission using (role)
      where role.user_id = job.scheduler_id and permission.permission = 'courses.manage'
      for share of role, permission;
      if not found then raise insufficient_privilege; end if;
      select * into draft from private.course_content_drafts
      where course_run_id = job.run_id and base_version = job.published_version
        and version = job.draft_version for update;
      if not found then raise insufficient_privilege; end if;
      perform private.publish_course_curriculum(job.run_id, job.published_version + 1, draft.content, job.scheduler_id);
      update private.course_curriculum_reviews set state='published'
      where run_id=job.run_id and published_version=job.published_version and draft_version=job.draft_version;
      completed := completed + 1;
    exception when insufficient_privilege or no_data_found then
      update private.course_curriculum_reviews set state='blocked'
      where run_id=job.run_id and published_version=job.published_version and draft_version=job.draft_version;
      insert into public.audit_events(action,resource_id,details)
      values ('course.content.review_blocked',job.run_id,
        jsonb_build_object('published_version',job.published_version,'draft_version',job.draft_version));
    end;
  end loop;
  return completed;
end;
$$;
revoke all on function private.run_scheduled_course_publications()
from public, anon, authenticated, service_role;

-- Local and self-hosted deployments register the worker if PostgreSQL supports
-- pg_cron. This uses the existing database socket and leaves other jobs alone.
create function private.ensure_course_curriculum_schedule()
returns boolean language plpgsql security invoker set search_path = '' as $$
declare
  scheduled_job bigint;
  use_socket boolean := current_user = 'supabase_admin'
    and current_setting('cron.use_background_workers', true) = 'off';
begin
  if current_database() is distinct from current_setting('cron.database_name', true)
    or not exists (select 1 from pg_extension where extname='pg_cron')
    or not has_schema_privilege(current_user, 'cron', 'USAGE') then
    return false;
  end if;
  if exists (select 1 from cron.job where jobname='portal-course-curriculum-publication'
    and command='select private.run_scheduled_course_publications()' and active
    and (not use_socket or nodename='')) then return true; end if;
  scheduled_job := cron.schedule('portal-course-curriculum-publication','* * * * *',
    'select private.run_scheduled_course_publications()');
  if use_socket then update cron.job set nodename='' where jobid=scheduled_job; end if;
  return true;
end;
$$;
revoke all on function private.ensure_course_curriculum_schedule()
from public, anon, authenticated, service_role;
select private.ensure_course_curriculum_schedule();

notify pgrst, 'reload schema';
commit;
