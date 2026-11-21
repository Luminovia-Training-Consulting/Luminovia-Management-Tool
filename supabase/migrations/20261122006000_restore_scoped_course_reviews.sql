begin;

-- Company contacts review their own completed training runs. Participant-only
-- actors review only their own completed enrolment at a currently enabled company.
-- Neither can access another author's record or review an unrelated course.
create function private.course_review_actor_allowed(p_run_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.course_runs r
    where r.id=p_run_id and r.archived_at is null and private.company_premium_enabled(r.organisation_id)
      and (
        (private.actor_active() and private.client_has_organisation(r.organisation_id))
        or (private.participant_actor() and private.active_company_participant(auth.uid(),r.organisation_id)
          and exists(select 1 from public.course_enrolments e where e.course_run_id=r.id
            and e.user_id=auth.uid() and e.status='completed'))
      )
  );
$$;

-- Reuse the live course/entitlement lock and hold the actor relationship
-- through the write. Check the relationship again after waiting for locks.
create function private.lock_course_reviewer(p_run_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare company_id uuid;
begin
  if not private.course_review_actor_allowed(p_run_id) then
    raise exception 'Company membership or completed enrolment required' using errcode='42501';
  end if;
  perform private.lock_course_premium(p_run_id);
  select r.organisation_id into company_id from public.course_runs r where r.id=p_run_id;
  perform 1 from public.profiles where id=auth.uid() and active for share;
  if private.participant_actor() then
    perform 1 from private.company_participant_memberships m
      where m.organisation_id=company_id and m.user_id=auth.uid() and m.status='active' for share;
    perform 1 from public.course_enrolments e
      where e.course_run_id=p_run_id and e.user_id=auth.uid() and e.status='completed' for share;
  else
    perform 1 from public.client_organisation_memberships m
      where m.organisation_id=company_id and m.user_id=auth.uid() and m.removed_at is null for share;
  end if;
  if not private.course_review_actor_allowed(p_run_id) then
    raise exception 'Company membership or completed enrolment required' using errcode='42501';
  end if;
end;
$$;
revoke all on function private.course_review_actor_allowed(uuid),private.lock_course_reviewer(uuid)
  from public,anon,authenticated,service_role;

create or replace function private.reviewable_courses()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.learning_actor() then
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
    from public.course_runs run
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
    where private.course_review_actor_allowed(run.id)
      and profile.id <> auth.uid()
  ), '[]'::jsonb);
end;
$$;

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
  if not private.learning_actor() then
    raise exception 'Active login required' using errcode = '42501';
  end if;
  if p_lecturer_id = auth.uid() or p_rating is null or p_rating not between 1 and 5 or
     p_comment is null or length(p_comment) > 2000 or p_version is null or p_version < 0 then
    raise exception 'Invalid review' using errcode = '22023';
  end if;
  perform private.lock_course_reviewer(p_course_run_id);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'course-review:' || p_course_run_id::text || ':' || auth.uid()::text || ':' || p_lecturer_id::text,
      0
    )
  );
  select max(ends_at) into course_end
  from public.course_sessions where course_run_id = p_course_run_id;
  if course_end is null or course_end > now() or
     not exists (
       select 1 from public.jobs job
       join public.job_claims claim on claim.job_id = job.id
       where job.course_run_id = p_course_run_id
         and claim.lecturer_id = p_lecturer_id and claim.status = 'confirmed'
     ) or not private.profile_staff(p_lecturer_id) then
    raise exception 'Completed course and assigned lecturer required' using errcode = '42501';
  end if;
  select * into previous from public.course_reviews
  where course_run_id = p_course_run_id and lecturer_id = p_lecturer_id
    and reviewer_id = auth.uid()
  for update;
  if found then
    if previous.version is distinct from p_version then
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
  where id = p_review_id and reviewer_id = auth.uid() and deleted_at is null;
  if not found then raise exception 'Review access denied' using errcode = '42501'; end if;
  perform private.lock_course_reviewer(previous.course_run_id);
  select * into previous from public.course_reviews where id = p_review_id for update;
  if not found or previous.deleted_at is not null then
    raise exception 'Review access denied' using errcode = '42501';
  end if;
  if previous.version is distinct from p_version then
    raise exception 'review_version_conflict' using errcode = '40001';
  end if;
  update public.course_reviews set
    comment = '', deleted_at = now(), version = version + 1, updated_at = now()
  where id = p_review_id;
  insert into public.audit_events(actor_id, action, resource_id)
  values (auth.uid(), 'course.review.deleted', p_review_id);
end;
$$;

-- Participants may use these three scoped RPCs; the public pre-request wrapper
-- remains an invoker and still skips private checks for non-user requests.
alter function private.require_portal_access() rename to require_portal_access_before_course_reviews;
revoke all on function private.require_portal_access_before_course_reviews() from public,anon,authenticated,service_role;
create function private.require_portal_access()
returns void language plpgsql stable security definer set search_path='' as $$
begin
  if current_setting('role',true)='authenticated'
    and coalesce(current_setting('request.path',true),'') in (
      '/rpc/reviewable_courses','/rpc/submit_course_review','/rpc/delete_course_review'
    ) and private.participant_actor() then return; end if;
  perform private.require_portal_access_before_course_reviews();
end;
$$;
revoke all on function private.require_portal_access() from public,anon,authenticated,service_role;
grant execute on function private.require_portal_access() to authenticated;
notify pgrst,'reload schema';
commit;
