-- Preserve existing moderated records in round one and keep all later peer links round-local.
begin;

alter table private.lms_peer_rounds add column round_number integer not null default 1 check (round_number > 0);
alter table private.lms_peer_entries add column round_number integer not null default 1;
alter table private.lms_peer_matches add column round_number integer not null default 1;

alter table private.lms_peer_matches
  drop constraint lms_peer_matches_run_id_fkey,
  drop constraint lms_peer_matches_run_id_reviewer_entry_fkey,
  drop constraint lms_peer_matches_run_id_author_entry_fkey,
  drop constraint lms_peer_matches_run_id_reviewer_entry_key,
  drop constraint lms_peer_matches_run_id_author_entry_key;
alter table private.lms_peer_entries
  drop constraint lms_peer_entries_run_id_fkey,
  drop constraint lms_peer_entries_run_id_user_id_key,
  drop constraint lms_peer_entries_run_id_id_key;
alter table private.lms_peer_rounds
  drop constraint lms_peer_rounds_pkey,
  add primary key (run_id, round_number),
  alter column round_number drop default;
create unique index lms_peer_round_active on private.lms_peer_rounds(run_id) where stage <> 'released';
alter table private.lms_peer_entries
  alter column round_number drop default,
  add unique (run_id, round_number, user_id),
  add unique (run_id, round_number, id),
  add foreign key (run_id, round_number) references private.lms_peer_rounds(run_id, round_number) on delete cascade;
alter table private.lms_peer_matches
  alter column round_number drop default,
  add unique (run_id, round_number, reviewer_entry),
  add unique (run_id, round_number, author_entry),
  add foreign key (run_id, round_number) references private.lms_peer_rounds(run_id, round_number) on delete cascade,
  add foreign key (run_id, round_number, reviewer_entry)
    references private.lms_peer_entries(run_id, round_number, id) on delete cascade,
  add foreign key (run_id, round_number, author_entry)
    references private.lms_peer_entries(run_id, round_number, id) on delete cascade;

drop function public.course_peer_feedback(uuid);
drop function private.course_peer_feedback(uuid);

create function private.course_peer_feedback(p_run_id uuid, p_round_number integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  who uuid := auth.uid();
  context jsonb := private.course_workspace_context(p_run_id);
  staff boolean := (context->>'staff')::boolean is true;
  course_org uuid;
  round private.lms_peer_rounds%rowtype;
  writable boolean;
  own_entry private.lms_peer_entries%rowtype;
  outgoing jsonb;
  incoming jsonb;
  entries jsonb := '[]'::jsonb;
  rounds jsonb;
  reviews jsonb := '[]'::jsonb;
begin
  if who is null or (context->>'lms_enabled')::boolean is not true
    or not staff and (context->>'learner')::boolean is not true then raise insufficient_privilege; end if;
  select run.organisation_id into course_org from public.course_runs run
  join public.organisations company on company.id = run.organisation_id
  where run.id = p_run_id and company.archived_at is null;
  if not found then raise insufficient_privilege; end if;

  writable := (select edition from private.installation_identity) = 'internal'
    or private.academy_course_access_status() = 'active';
  select coalesce(jsonb_agg(jsonb_build_object(
    'number', r.round_number, 'prompt', r.prompt, 'stage', r.stage
  ) order by r.round_number desc), '[]'::jsonb)
    into rounds from private.lms_peer_rounds r where r.run_id = p_run_id;
  select * into round from private.lms_peer_rounds r where r.run_id = p_run_id
    and (p_round_number is null or r.round_number = p_round_number)
    order by r.round_number desc limit 1;
  if p_round_number is not null and not found then
    raise invalid_parameter_value;
  end if;
  if staff and round.stage is not null then
    if round.stage = 'collecting' then
      select coalesce(jsonb_agg(jsonb_build_object('id', entry.id, 'body', entry.body,
        'approved', entry.approved, 'revision', entry.revision) order by entry.id), '[]'::jsonb)
      into entries from private.lms_peer_entries entry where entry.run_id = p_run_id and entry.round_number = round.round_number
        and private.lms_peer_current_learner(p_run_id, course_org, entry.user_id);
    else
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', match.id, 'feedback', match.feedback, 'approved', match.approved,
        'dispute', match.dispute, 'resolution', match.resolution
      ) order by match.id), '[]'::jsonb) into reviews
      from private.lms_peer_matches match
      join private.lms_peer_entries reviewer on reviewer.id = match.reviewer_entry
      join private.lms_peer_entries author on author.id = match.author_entry
      where match.run_id = p_run_id and match.round_number = round.round_number and match.feedback is not null
        and private.lms_peer_current_learner(p_run_id, course_org, reviewer.user_id)
        and private.lms_peer_current_learner(p_run_id, course_org, author.user_id);
    end if;
  elsif round.stage is not null then
    select * into own_entry from private.lms_peer_entries where run_id = p_run_id and round_number = round.round_number and user_id = who;
    select jsonb_build_object('body', author.body, 'feedback', match.feedback)
    into outgoing from private.lms_peer_matches match
    join private.lms_peer_entries author on author.id = match.author_entry
    where match.run_id = p_run_id and match.round_number = round.round_number and match.reviewer_entry = own_entry.id and author.approved
      and private.lms_peer_current_learner(p_run_id, course_org, author.user_id);
    if round.stage = 'released' then
      select jsonb_build_object(
        'feedback', case when match.approved and (match.dispute is null or match.resolution is not null)
          then match.feedback end,
        'dispute', match.dispute, 'resolution', match.resolution
      ) into incoming from private.lms_peer_matches match
      join private.lms_peer_entries reviewer on reviewer.id = match.reviewer_entry
      where match.run_id = p_run_id and match.round_number = round.round_number and match.author_entry = own_entry.id
        and (match.approved or match.dispute is not null)
        and private.lms_peer_current_learner(p_run_id, course_org, reviewer.user_id);
    end if;
  end if;
  return jsonb_build_object('round_number', round.round_number, 'rounds', rounds, 'prompt', round.prompt, 'stage', round.stage, 'can_write', writable,
    'can_moderate', staff and writable, 'entries', entries, 'reviews', reviews, 'assignment', outgoing,
    'received', incoming, 'own_entry', case when own_entry.id is not null then jsonb_build_object(
      'body', own_entry.body, 'revision', own_entry.revision, 'approved', own_entry.approved
    ) end);
end;
$$;

create or replace function private.course_peer_feedback_action(p_run_id uuid, p_action text, p_payload jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  who uuid := auth.uid();
  course_org uuid;
  context jsonb;
  round private.lms_peer_rounds%rowtype;
  own_entry private.lms_peer_entries%rowtype;
  staff_action boolean;
  target uuid;
  expected_revision integer;
  target_round integer;
  latest private.lms_peer_rounds%rowtype;
  feedback_body text;
begin
  if who is null then raise insufficient_privilege; end if;
  if p_action is null or p_action not in ('open','entry','withdraw','approve_entry','start','feedback','approve_feedback','release','dispute','resolve')
    or jsonb_typeof(p_payload) is distinct from 'object' then raise invalid_parameter_value; end if;
  if p_payload ? 'round' and (
    jsonb_typeof(p_payload->'round') is distinct from 'number'
    or (p_payload->>'round') !~ '^[1-9][0-9]{0,8}$'
  ) then raise invalid_parameter_value; end if;
  target_round := coalesce((p_payload->>'round')::integer, 1);
  p_payload := p_payload - 'round';
  staff_action := p_action in ('open','approve_entry','start','approve_feedback','release','resolve');

  if (select edition from private.installation_identity) = 'internal' then
    perform private.lock_course_premium(p_run_id);
  else
    perform private.lock_academy_course_access();
  end if;
  perform 1 from public.profiles where id = who and active for share;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.user_roles where user_id = who order by role for share;
  select run.organisation_id into course_org from public.course_runs run
    join public.organisations company on company.id = run.organisation_id
    where run.id = p_run_id and run.archived_at is null and company.archived_at is null
    for no key update of run for share of company;
  if not found then raise insufficient_privilege; end if;
  if staff_action then
    perform 1 from public.job_claims claim join public.jobs job on job.id = claim.job_id
      where job.course_run_id = p_run_id and claim.lecturer_id = who and claim.status = 'confirmed' for share of claim;
  else
    perform 1 from private.company_participant_memberships where organisation_id = course_org
      and user_id = who and status = 'active' for share;
    if not found then raise insufficient_privilege; end if;
    perform 1 from public.course_enrolments where course_run_id = p_run_id and user_id = who
      and status in ('enrolled','completed') for share;
    if not found then raise insufficient_privilege; end if;
  end if;
  context := private.course_workspace_context(p_run_id);
  if (context->>'lms_enabled')::boolean is not true
    or (context->>(case when staff_action then 'staff' else 'learner' end))::boolean is not true
    then raise insufficient_privilege; end if;

  select * into round from private.lms_peer_rounds where run_id = p_run_id and round_number = target_round;
  if p_action = 'open' then
    select * into latest from private.lms_peer_rounds where run_id = p_run_id
      order by round_number desc limit 1;
    if target_round <> coalesce(latest.round_number, 0) + 1
      or (latest.round_number is not null and latest.stage <> 'released') then
      raise exception 'Peer feedback round changed' using errcode = 'PT409';
    end if;
    if p_payload - 'body' <> '{}'::jsonb
      or jsonb_typeof(p_payload->'body') is distinct from 'string'
      or char_length(btrim(p_payload->>'body')) not between 3 and 1000 then raise invalid_parameter_value; end if;
    insert into private.lms_peer_rounds(run_id, round_number, prompt) values (p_run_id, target_round, btrim(p_payload->>'body'));
  elsif (p_action in ('entry','withdraw','approve_entry','start') and round.stage is distinct from 'collecting')
    or (p_action in ('feedback','approve_feedback','release') and round.stage is distinct from 'reviewing')
    or (p_action in ('resolve','dispute') and round.stage is distinct from 'released') then
    raise exception 'Peer feedback stage changed' using errcode = 'PT409';
  elsif p_action in ('entry','withdraw','approve_entry') then
    if jsonb_typeof(p_payload->'revision') is distinct from 'number'
      or (p_payload->>'revision') !~ '^(0|[1-9][0-9]{0,8})$'
      then raise invalid_parameter_value; end if;
    expected_revision := (p_payload->>'revision')::integer;
    if p_action = 'approve_entry' then
      if p_payload - array['id','revision'] <> '{}'::jsonb
        or jsonb_typeof(p_payload->'id') is distinct from 'string' then raise invalid_parameter_value; end if;
      update private.lms_peer_entries entry set approved = true
      where entry.run_id = p_run_id and entry.round_number = target_round and entry.id = (p_payload->>'id')::uuid and entry.revision = expected_revision
        and private.lms_peer_current_learner(p_run_id, course_org, entry.user_id);
      if not found then raise exception 'Peer entry changed' using errcode = 'PT409'; end if;
    else
      select * into own_entry from private.lms_peer_entries where run_id = p_run_id and round_number = target_round and user_id = who;
      if coalesce(own_entry.revision, 0) <> expected_revision then raise exception 'Peer entry changed' using errcode = 'PT409'; end if;
      if p_action = 'entry' then
        if p_payload - array['body','revision'] <> '{}'::jsonb
          or jsonb_typeof(p_payload->'body') is distinct from 'string'
          or char_length(btrim(p_payload->>'body')) not between 3 and 2000 then raise invalid_parameter_value; end if;
        if own_entry.id is null and (select count(*) from private.lms_peer_entries where run_id = p_run_id and round_number = target_round) >= 60
          then raise exception 'Peer feedback round is full' using errcode = '22023'; end if;
        insert into private.lms_peer_entries(run_id, round_number, user_id, body)
          values (p_run_id, target_round, who, btrim(p_payload->>'body'))
          on conflict (run_id, round_number, user_id) do update set
            body = excluded.body, approved = false, revision = private.lms_peer_entries.revision + 1;
      else
        if p_payload - 'revision' <> '{}'::jsonb then raise invalid_parameter_value; end if;
        delete from private.lms_peer_entries where id = own_entry.id;
      end if;
    end if;
  elsif p_action = 'start' then
    if p_payload <> '{}'::jsonb then raise invalid_parameter_value; end if;
    -- Rotate a stable hash ordering by one. Every approved current entry is
    -- assigned exactly once without self review and without a two-way pair.
    insert into private.lms_peer_matches(run_id, round_number, reviewer_entry, author_entry)
    select p_run_id, target_round, id, coalesce(next_id, first_id) from (
      select entry.id, lead(entry.id) over ordering next_id, first_value(entry.id) over ordering first_id,
        count(*) over () cohort_size
      from private.lms_peer_entries entry
      where entry.run_id = p_run_id and entry.round_number = target_round and entry.approved
        and private.lms_peer_current_learner(p_run_id, course_org, entry.user_id)
      window ordering as (order by md5(p_run_id::text || ':' || entry.id::text), entry.id)
    ) eligible where cohort_size >= 3;
    if not found then raise exception 'Three approved entries are required' using errcode = '22023'; end if;
    update private.lms_peer_rounds set stage = 'reviewing' where run_id = p_run_id and round_number = target_round;
  elsif p_action = 'release' then
    if p_payload <> '{}'::jsonb then raise invalid_parameter_value; end if;
    if not exists (
      select 1 from private.lms_peer_matches match
      join private.lms_peer_entries reviewer on reviewer.id = match.reviewer_entry
      join private.lms_peer_entries author on author.id = match.author_entry
      where match.run_id = p_run_id and match.round_number = target_round and match.approved
        and private.lms_peer_current_learner(p_run_id, course_org, reviewer.user_id)
        and private.lms_peer_current_learner(p_run_id, course_org, author.user_id)
    ) then raise exception 'Approve eligible feedback before releasing the round' using errcode = '22023'; end if;
    update private.lms_peer_rounds set stage = 'released' where run_id = p_run_id and round_number = target_round;
  elsif staff_action then
    if jsonb_typeof(p_payload->'id') is distinct from 'string' then raise invalid_parameter_value; end if;
    target := (p_payload->>'id')::uuid;
    if p_action = 'approve_feedback' then
      if p_payload - 'id' <> '{}'::jsonb then raise invalid_parameter_value; end if;
      update private.lms_peer_matches set approved = true where run_id = p_run_id and round_number = target_round and id = target and feedback is not null;
    else
      if p_payload - array['id','body','keep'] <> '{}'::jsonb
        or jsonb_typeof(p_payload->'keep') is distinct from 'boolean'
        or jsonb_typeof(p_payload->'body') is distinct from 'string'
        or char_length(btrim(p_payload->>'body')) not between 3 and 1000 then raise invalid_parameter_value; end if;
      update private.lms_peer_matches set approved = (p_payload->>'keep')::boolean, resolution = btrim(p_payload->>'body')
        where run_id = p_run_id and round_number = target_round and id = target and dispute is not null and resolution is null;
    end if;
    if not found then raise insufficient_privilege; end if;
  else
    if p_payload - 'body' <> '{}'::jsonb or jsonb_typeof(p_payload->'body') is distinct from 'string' then
      raise invalid_parameter_value;
    end if;
    feedback_body := btrim(p_payload->>'body');
    select * into own_entry from private.lms_peer_entries where run_id = p_run_id and round_number = target_round and user_id = who;
    if not found then raise insufficient_privilege; end if;
    if p_action = 'feedback' then
      if char_length(feedback_body) not between 3 and 2000 then raise invalid_parameter_value; end if;
      update private.lms_peer_matches match set feedback = feedback_body from private.lms_peer_entries author
      where match.run_id = p_run_id and match.round_number = target_round and match.reviewer_entry = own_entry.id and author.id = match.author_entry
        and (match.feedback is null or match.feedback = feedback_body)
        and private.lms_peer_current_learner(p_run_id, course_org, author.user_id);
    else
      if char_length(feedback_body) not between 3 and 1000 then raise invalid_parameter_value; end if;
      update private.lms_peer_matches match set dispute = feedback_body from private.lms_peer_entries reviewer
      where match.run_id = p_run_id and match.round_number = target_round and match.author_entry = own_entry.id and reviewer.id = match.reviewer_entry
        and match.approved and match.resolution is null and (match.dispute is null or match.dispute = feedback_body)
        and private.lms_peer_current_learner(p_run_id, course_org, reviewer.user_id);
    end if;
    if not found then raise insufficient_privilege; end if;
  end if;
  if staff_action then
    insert into public.audit_events(actor_id, action, resource_id)
      values (who, 'course.peer_feedback.' || p_action, p_run_id);
  end if;
  return true;
end;
$$;

create function public.course_peer_feedback(p_run_id uuid, p_round_number integer default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.course_peer_feedback(p_run_id, p_round_number);
$$;
revoke all on function private.course_peer_feedback(uuid, integer), public.course_peer_feedback(uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function private.course_peer_feedback(uuid, integer), public.course_peer_feedback(uuid, integer)
  to authenticated;

notify pgrst, 'reload schema';
commit;
