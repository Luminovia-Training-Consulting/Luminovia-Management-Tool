begin;

-- An obsolete review version is an application conflict. Return HTTP 409
-- without asking PostgREST 14 to retry a real database serialization failure.

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
      raise sqlstate 'PT409' using message = 'review_version_conflict';
    end if;
    update public.course_reviews set
      rating = p_rating, comment = trim(p_comment),
      version = version + 1, deleted_at = null, updated_at = now()
    where id = previous.id returning id into target;
  else
    if p_version <> 0 then
      raise sqlstate 'PT409' using message = 'review_version_conflict';
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
    raise sqlstate 'PT409' using message = 'review_version_conflict';
  end if;
  update public.course_reviews set
    comment = '', deleted_at = now(), version = version + 1, updated_at = now()
  where id = p_review_id;
  insert into public.audit_events(actor_id, action, resource_id)
  values (auth.uid(), 'course.review.deleted', p_review_id);
end;
$$;

commit;
