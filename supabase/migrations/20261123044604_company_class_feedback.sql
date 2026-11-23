begin;

alter table private.course_evaluations
  add column available_via_dispatch boolean not null default false;
create index course_evaluations_class_feedback
  on private.course_evaluations(subject_id, id) where subject_kind = 'class' and rater_role = 'lecturer';

create table private.company_class_notes (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null,
  organisation_id uuid not null,
  author_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid not null,
  comment text not null check (length(comment) between 1 and 2000),
  foreign key (class_id, organisation_id) references private.course_classes(id, organisation_id) on delete cascade,
  unique (author_id, request_id)
);
create index company_class_notes_class on private.company_class_notes(class_id, organisation_id, id);
alter table private.company_class_notes enable row level security;
revoke all on private.company_class_notes from public, anon, authenticated, service_role;
create trigger permanent_deletion_fence before insert or update or delete on private.company_class_notes
  for each row execute function private.guard_permanent_deletion();

create function private.class_feedback_claim(p_job_id uuid, p_class_id uuid)
returns uuid language sql stable security invoker set search_path = '' as $$
  select claim.id
  from public.job_claims claim
  join public.jobs job on job.id = claim.job_id
  join public.course_runs run on run.id = job.course_run_id
  join private.job_dispatch dispatch on dispatch.job_id = job.id and dispatch.organisation_id = run.organisation_id
  join public.organisations company on company.id = run.organisation_id
  where claim.job_id = p_job_id and dispatch.class_id = p_class_id
    and claim.lecturer_id = auth.uid() and claim.status = 'confirmed'
    and run.archived_at is null and company.archived_at is null
    and private.lecturer_actor()
    and not private.job_lecturer_blocked(job.id, auth.uid())
    and not private.deletion_row_fenced('public.jobs', to_jsonb(job))
    and not private.deletion_row_fenced('public.course_runs', to_jsonb(run));
$$;

create function private.class_feedback_claim_completed(p_claim_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select coalesce(max(s.ends_at) < statement_timestamp(), false)
  from public.assignment_sessions s where s.claim_id = p_claim_id;
$$;

create function private.class_feedback(p_class_id uuid, p_job_id uuid, p_after uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  class_row private.course_classes;
  claim_id uuid;
  rating jsonb;
  stats jsonb;
  comments jsonb;
begin
  select * into class_row from private.course_classes where id = p_class_id;
  if not found or (select edition from private.installation_identity) is distinct from 'internal' then
    raise insufficient_privilege;
  end if;
  if p_job_id is null then
    if not private.company_dispatch_allowed(class_row.organisation_id) then
      raise insufficient_privilege;
    end if;
  else
    claim_id := private.class_feedback_claim(p_job_id, p_class_id);
    if claim_id is null then raise insufficient_privilege; end if;
    select jsonb_build_object('score', e.score, 'comment', e.comment, 'version', e.version)
    into rating from private.course_evaluations e
    join public.jobs job on job.course_run_id = e.run_id
    where job.id = p_job_id and e.user_id = auth.uid() and e.rater_role = 'lecturer'
      and e.subject_kind = 'class' and e.subject_id = p_class_id;
  end if;

  with reviews as materialized (
    select e.id, e.score, e.comment
    from private.course_evaluations e
    join public.course_runs run on run.id = e.run_id and run.organisation_id = class_row.organisation_id
    where e.subject_kind = 'class' and e.subject_id = p_class_id and e.rater_role = 'lecturer'
      and run.archived_at is null
      and (e.available_via_dispatch or private.company_premium_enabled(class_row.organisation_id))
  ), page as (
    select * from (
      select id, comment, score, 'lecturer'::text as source from reviews
        where p_after is null or id > p_after
      union all
      select id, comment, null::integer, 'company'::text from private.company_class_notes
        where class_id = p_class_id and organisation_id = class_row.organisation_id
          and (p_after is null or id > p_after)
    ) entries order by id limit 26
  ), visible as (select * from page order by id limit 25)
  select (select jsonb_build_object('count', count(*), 'average', round(avg(score), 2)) from reviews),
    jsonb_build_object(
      'items', coalesce(jsonb_agg(to_jsonb(visible) order by visible.id), '[]'::jsonb),
      'next', case when (select count(*) from page) > 25 then
        (select id from visible order by id desc limit 1) end
    ) into stats, comments from visible;

  return stats || jsonb_build_object('comments', comments, 'rating', rating,
    'can_rate', private.class_feedback_claim_completed(claim_id), 'can_comment', p_job_id is null);
end;
$$;

-- Use the same optimistic write, exact retry receipt and history in the
-- Premium course and assignment entry points.
create function private.write_course_evaluation(
  p_run_id uuid, p_rater_role text, p_subject_kind text, p_subject_id uuid,
  p_score integer, p_expected_version integer, p_comment text
) returns private.course_evaluations
language plpgsql security invoker set search_path = '' as $$
declare saved private.course_evaluations;
begin
  if p_expected_version = 0 then
    insert into private.course_evaluations(run_id, user_id, rater_role, subject_kind, subject_id, score, comment)
      values (p_run_id, auth.uid(), p_rater_role, p_subject_kind, p_subject_id, p_score, p_comment)
      on conflict (run_id, user_id, rater_role, subject_kind, subject_id) do nothing
      returning * into saved;
  else
    update private.course_evaluations evaluation
    set score = p_score, comment = p_comment, version = evaluation.version + 1
    where evaluation.run_id = p_run_id and evaluation.user_id = auth.uid() and evaluation.rater_role = p_rater_role
      and evaluation.subject_kind = p_subject_kind and evaluation.subject_id = p_subject_id
      and evaluation.version = p_expected_version
    returning * into saved;
  end if;
  if found then
    insert into private.course_evaluation_revisions(evaluation_id, version)
      values (saved.id, saved.version);
  else
    select * into saved from private.course_evaluations evaluation
    where evaluation.run_id = p_run_id and evaluation.user_id = auth.uid()
      and evaluation.rater_role = p_rater_role and evaluation.subject_kind = p_subject_kind
      and evaluation.subject_id = p_subject_id and evaluation.version = p_expected_version + 1
      and evaluation.score = p_score and evaluation.comment = p_comment;
    if not found then
      raise sqlstate 'PT409' using message = 'Evaluation changed. Reload the current evaluation.';
    end if;
  end if;
  return saved;
end;
$$;

do $migration$
declare
  definition text := pg_get_functiondef('private.save_course_evaluation(uuid,text,text,uuid,integer,integer,text)'::regprocedure);
  first integer := strpos(definition, '  if p_expected_version = 0 then');
  last integer := strpos(definition, $marker$  return jsonb_build_object('rater_role',$marker$);
begin
  if first = 0 or last <= first then raise exception 'Expected course evaluation persistence seams'; end if;
  execute left(definition, first - 1)
    || $write$  saved := private.write_course_evaluation(
    p_run_id, p_rater_role, p_subject_kind, p_subject_id, p_score, p_expected_version, normalized_comment
  );
$write$
    || substr(definition, last);
end;
$migration$;

create or replace function private.course_evaluation_can_review(
  p_context jsonb, p_rater_role text, p_kind text, p_subject uuid, p_written boolean
)
returns boolean language sql stable security invoker set search_path = '' as $$
  select (p_context->>'manager')::boolean
    or ((p_context->>'teacher')::boolean and (
      (p_kind = 'lecturer' and p_subject = auth.uid()) or
      (p_rater_role = 'lecturer' and p_kind in ('course', 'company', 'class'))
    ))
    or ((p_context->>'client')::boolean and (
      (p_kind = 'company' and p_rater_role = 'learner')
      or (p_kind = 'class' and p_rater_role = 'lecturer')
    ))
    or (not p_written and (p_context->>'learner')::boolean and p_kind = 'lecturer');
$$;

create function private.save_job_class_rating(
  p_job_id uuid, p_class_id uuid, p_score integer, p_expected_version integer, p_comment text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  selected_claim uuid;
  run_id uuid;
  company_id uuid;
  normalized_comment text := btrim(p_comment, E' \t\n\r');
  saved private.course_evaluations;
begin
  if p_score is null or p_score not between 1 and 5 or p_expected_version is null
    or p_expected_version not between 0 and 2147483646 or normalized_comment is null
    or length(normalized_comment) > 2000 then
    raise invalid_parameter_value;
  end if;
  selected_claim := private.class_feedback_claim(p_job_id, p_class_id);
  if selected_claim is null or (select edition from private.installation_identity) is distinct from 'internal' then
    raise insufficient_privilege;
  end if;

  select course_run_id into run_id from public.jobs where id = p_job_id for share;
  select organisation_id into company_id from public.course_runs where id = run_id for update;
  perform 1 from public.organisations where id = company_id for share;
  perform 1 from public.profiles where id = auth.uid() for share;
  perform 1 from public.user_roles where user_id = auth.uid() order by role for share;
  perform 1 from public.job_claims where id = selected_claim for share;
  perform 1 from public.assignment_sessions s where s.claim_id = selected_claim
    order by s.id for share;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text, 0));
  if private.class_feedback_claim(p_job_id, p_class_id) is distinct from selected_claim
    or not private.class_feedback_claim_completed(selected_claim) then raise insufficient_privilege; end if;

  saved := private.write_course_evaluation(
    run_id, 'lecturer', 'class', p_class_id, p_score, p_expected_version, normalized_comment
  );
  if not saved.available_via_dispatch then
    update private.course_evaluations set available_via_dispatch = true where id = saved.id;
  end if;
  return jsonb_build_object('score', saved.score, 'comment', saved.comment, 'version', saved.version);
end;
$$;

create function private.add_company_class_note(p_class_id uuid, p_comment text, p_request_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  author_id uuid := auth.uid();
  company_id uuid;
  note_id uuid;
  normalized_comment text := btrim(p_comment, E' \t\n\r');
begin
  if p_request_id is null or normalized_comment is null or length(normalized_comment) not between 1 and 2000
  then raise invalid_parameter_value; end if;
  select organisation_id into company_id from private.course_classes where id = p_class_id;
  if not private.company_dispatch_allowed(company_id) then raise insufficient_privilege; end if;
  perform 1 from public.organisations where id = company_id for share;
  perform 1 from public.profiles where id = author_id for share;
  perform 1 from public.user_roles where user_id = author_id order by role for share;
  perform 1 from public.client_organisation_memberships
    where user_id = author_id and organisation_id = company_id for share;
  if not private.company_dispatch_allowed(company_id) then raise insufficient_privilege; end if;
  insert into private.company_class_notes(class_id, organisation_id, author_id, request_id, comment)
    values (p_class_id, company_id, author_id, p_request_id, normalized_comment)
    on conflict on constraint company_class_notes_author_id_request_id_key do nothing
    returning id into note_id;
  if note_id is null then
    select note.id into note_id from private.company_class_notes note
    where note.author_id = auth.uid() and note.request_id = p_request_id
      and note.class_id = p_class_id and note.organisation_id = company_id and note.comment = normalized_comment;
    if not found then raise sqlstate 'PT409' using message = 'Request already used for a different note.'; end if;
  end if;
  return note_id;
end;
$$;

create function public.class_feedback(p_class_id uuid, p_job_id uuid default null, p_after uuid default null)
returns jsonb language sql stable security invoker set search_path = ''
return private.class_feedback(p_class_id, p_job_id, p_after);

create function public.save_job_class_rating(
  p_job_id uuid, p_class_id uuid, p_score integer, p_expected_version integer, p_comment text default ''
) returns jsonb language sql security invoker set search_path = ''
return private.save_job_class_rating(p_job_id, p_class_id, p_score, p_expected_version, p_comment);

create function public.add_company_class_note(p_class_id uuid, p_comment text, p_request_id uuid)
returns uuid language sql security invoker set search_path = ''
return private.add_company_class_note(p_class_id, p_comment, p_request_id);

revoke all on function private.class_feedback_claim(uuid,uuid), private.class_feedback_claim_completed(uuid),
  private.write_course_evaluation(uuid,text,text,uuid,integer,integer,text),
  public.class_feedback(uuid,uuid,uuid), private.class_feedback(uuid,uuid,uuid),
  public.save_job_class_rating(uuid,uuid,integer,integer,text), private.save_job_class_rating(uuid,uuid,integer,integer,text),
  public.add_company_class_note(uuid,text,uuid), private.add_company_class_note(uuid,text,uuid)
from public, anon, authenticated, service_role;
grant execute on function public.class_feedback(uuid,uuid,uuid), private.class_feedback(uuid,uuid,uuid),
  public.save_job_class_rating(uuid,uuid,integer,integer,text), private.save_job_class_rating(uuid,uuid,integer,integer,text),
  public.add_company_class_note(uuid,text,uuid), private.add_company_class_note(uuid,text,uuid)
to authenticated;

alter function private.deletion_scope(text,uuid) rename to deletion_scope_before_company_class_notes;
revoke all on function private.deletion_scope_before_company_class_notes(text,uuid) from public, anon, authenticated, service_role;
create function private.deletion_scope(p_kind text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  scope jsonb := private.deletion_scope_before_company_class_notes(p_kind, p_id);
  company_selector text := private.deletion_selector(scope, 'public.organisations');
begin
  if p_kind = 'account' then
    scope := private.deletion_add_scope(scope, 'private.company_class_notes', format('x.author_id=%L::uuid', p_id));
  end if;
  if company_selector is not null then
    scope := private.deletion_add_scope(scope, 'private.company_class_notes',
      format('x.organisation_id in (select scoped.id from public.organisations scoped where %s)',
        replace(company_selector, 'x.', 'scoped.')));
  end if;
  return scope;
end;
$$;
revoke all on function private.deletion_scope(text,uuid) from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
commit;
