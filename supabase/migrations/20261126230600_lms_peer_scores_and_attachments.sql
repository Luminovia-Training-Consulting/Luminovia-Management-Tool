-- Pin optional peer scores and scanned attachments within the existing moderated rounds.
begin;

alter table private.lms_peer_rounds add column scoring_rubric jsonb
  check (scoring_rubric is null or private.valid_course_assignment_rubric(scoring_rubric));
alter table private.lms_peer_matches add column scores jsonb
  check (scores is null or (feedback is not null and jsonb_typeof(scores) = 'array'));
alter table private.lms_peer_entries add column attachment_version uuid
  references private.learning_portfolio_uploads(version_id) on delete set null;
create index lms_peer_entry_attachment on private.lms_peer_entries(attachment_version)
  where attachment_version is not null;

-- Reuse exact clean personal evidence versions and replace filenames in all
-- peer projections. The existing scanner and account deletion own the bytes.
create function private.lms_peer_attachment_file(p_owner uuid, p_version uuid)
returns jsonb language sql stable set search_path = '' as $$
  select (file.data - 'name') || jsonb_build_object('name',
    case file.data->>'mime_type' when 'application/pdf' then 'peer-attachment.pdf' else 'peer-attachment.txt' end)
  from (select private.learning_portfolio_evidence_file(p_owner, p_version) as data) file
  where file.data->>'mime_type' in ('application/pdf','text/plain');
$$;

create function private.lms_peer_attachment_summary(p_owner uuid, p_version uuid)
returns jsonb language sql stable set search_path = '' as $$
  select private.lms_peer_attachment_file(p_owner, p_version) - array['sha256','size_bytes','mime_type'];
$$;

create function private.lms_peer_valid_scores(p_rubric jsonb, p_scores jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
begin
  if jsonb_typeof(p_scores) is distinct from 'array' then return false; end if;
  if jsonb_array_length(p_scores) <> jsonb_array_length(p_rubric) then return false; end if;
  return not exists (
    select from jsonb_array_elements(p_rubric) with ordinality as criterion(value, position)
    where not exists (
      select from jsonb_array_elements(criterion.value->'levels') as level(value)
      where level.value->'points' = p_scores->(criterion.position::integer - 1)
    )
  );
end;
$$;

create or replace function private.course_peer_feedback(p_run_id uuid, p_round_number integer)
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
        'approved', entry.approved, 'revision', entry.revision,
        'attachment', private.lms_peer_attachment_summary(entry.user_id, entry.attachment_version)) order by entry.id), '[]'::jsonb)
      into entries from private.lms_peer_entries entry where entry.run_id = p_run_id and entry.round_number = round.round_number
        and private.lms_peer_current_learner(p_run_id, course_org, entry.user_id);
    else
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', match.id, 'feedback', match.feedback, 'approved', match.approved,
        'dispute', match.dispute, 'resolution', match.resolution, 'scores', match.scores
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
    select jsonb_build_object(
      'body', author.body, 'feedback', match.feedback, 'scores', match.scores,
      'attachment', private.lms_peer_attachment_summary(author.user_id, author.attachment_version))
    into outgoing from private.lms_peer_matches match
    join private.lms_peer_entries author on author.id = match.author_entry
    where match.run_id = p_run_id and match.round_number = round.round_number and match.reviewer_entry = own_entry.id and author.approved
      and private.lms_peer_current_learner(p_run_id, course_org, author.user_id);
    if round.stage = 'released' then
      select jsonb_build_object(
        'feedback', case when match.approved and (match.dispute is null or match.resolution is not null)
          then match.feedback end,
        'scores', case when match.approved and (match.dispute is null or match.resolution is not null)
          then match.scores end,
        'dispute', match.dispute, 'resolution', match.resolution
      ) into incoming from private.lms_peer_matches match
      join private.lms_peer_entries reviewer on reviewer.id = match.reviewer_entry
      where match.run_id = p_run_id and match.round_number = round.round_number and match.author_entry = own_entry.id
        and (match.approved or match.dispute is not null)
        and private.lms_peer_current_learner(p_run_id, course_org, reviewer.user_id);
    end if;
  end if;
  return jsonb_build_object('round_number', round.round_number, 'rounds', rounds,
    'assignment_rubric', round.assignment_rubric, 'scoring_rubric', round.scoring_rubric,
    'available_assignments', case when staff and writable then (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', assignment.id, 'title', definition.title, 'version', definition.version
      ) order by definition.title, assignment.id), '[]'::jsonb)
      from private.course_assignments assignment
      join private.course_assignment_definitions definition on
        definition.assignment_id = assignment.id and definition.version = assignment.published_version
      where assignment.run_id = p_run_id
    ) else '[]'::jsonb end, 'prompt', round.prompt, 'stage', round.stage, 'can_write', writable,
    'can_moderate', staff and writable, 'entries', entries, 'reviews', reviews, 'assignment', outgoing,
    'received', incoming, 'own_entry', case when own_entry.id is not null then jsonb_build_object(
      'body', own_entry.body, 'revision', own_entry.revision, 'approved', own_entry.approved,
      'attachment', private.lms_peer_attachment_summary(own_entry.user_id, own_entry.attachment_version)
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
  rubric_snapshot jsonb;
  scoring_rubric jsonb;
  attachment uuid;
  review_scores jsonb;
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
    if p_payload - array['body','assignment_id','assignment_version','scored'] <> '{}'::jsonb
      or (p_payload ? 'scored' and (
        jsonb_typeof(p_payload->'scored') is distinct from 'boolean'
        or not (p_payload ? 'assignment_id')
      ))
      or jsonb_typeof(p_payload->'body') is distinct from 'string'
      or char_length(btrim(p_payload->>'body')) not between 3 and 1000 then raise invalid_parameter_value; end if;
    if p_payload ?| array['assignment_id','assignment_version'] then
      if jsonb_typeof(p_payload->'assignment_id') is distinct from 'string'
        or jsonb_typeof(p_payload->'assignment_version') is distinct from 'number'
        or (p_payload->>'assignment_version') !~ '^[1-9][0-9]{0,8}$'
        then raise invalid_parameter_value; end if;
      select jsonb_build_object(
        'title', definition.title, 'version', definition.version, 'criteria',
        (select jsonb_agg(criterion.value->>'label' order by criterion.ordinality)
          from jsonb_array_elements(definition.rubric) with ordinality as criterion)
      ), case when (p_payload->>'scored')::boolean then definition.rubric end
      into rubric_snapshot, scoring_rubric
      from private.course_assignments assignment
      join private.course_assignment_definitions definition on
        definition.assignment_id = assignment.id and definition.version = assignment.published_version
      where assignment.run_id = p_run_id and assignment.id = (p_payload->>'assignment_id')::uuid
        and definition.version = (p_payload->>'assignment_version')::integer
      for share of assignment;
      if not found then
        raise exception 'Published assignment changed' using errcode = 'PT409';
      end if;
    end if;
    insert into private.lms_peer_rounds(run_id, round_number, prompt, assignment_rubric, scoring_rubric)
      values (p_run_id, target_round, btrim(p_payload->>'body'), rubric_snapshot, scoring_rubric);
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
        and private.lms_peer_current_learner(p_run_id, course_org, entry.user_id)
        and (entry.attachment_version is null
          or private.lms_peer_attachment_file(entry.user_id, entry.attachment_version) is not null);
      if not found then raise exception 'Peer entry changed' using errcode = 'PT409'; end if;
    else
      select * into own_entry from private.lms_peer_entries where run_id = p_run_id and round_number = target_round and user_id = who;
      if coalesce(own_entry.revision, 0) <> expected_revision then raise exception 'Peer entry changed' using errcode = 'PT409'; end if;
      if p_action = 'entry' then
        if p_payload - array['body','revision','attachment_version'] <> '{}'::jsonb
          or jsonb_typeof(p_payload->'body') is distinct from 'string'
          or char_length(btrim(p_payload->>'body')) not between 3 and 2000 then raise invalid_parameter_value; end if;
        if own_entry.id is null and (select count(*) from private.lms_peer_entries where run_id = p_run_id and round_number = target_round) >= 60
          then raise exception 'Peer feedback round is full' using errcode = '22023'; end if;
        attachment := own_entry.attachment_version;
        if p_payload ? 'attachment_version' then
          if jsonb_typeof(p_payload->'attachment_version') not in ('string','null') then
            raise invalid_parameter_value;
          end if;
          attachment := (p_payload->>'attachment_version')::uuid;
        end if;
        if attachment is not null and private.lms_peer_attachment_file(who, attachment) is null then
          raise insufficient_privilege;
        end if;
        insert into private.lms_peer_entries(run_id, round_number, user_id, body, attachment_version)
          values (p_run_id, target_round, who, btrim(p_payload->>'body'), attachment)
          on conflict (run_id, round_number, user_id) do update set
            body = excluded.body, attachment_version = excluded.attachment_version,
            approved = false, revision = private.lms_peer_entries.revision + 1;
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
    if p_payload - (case when p_action = 'feedback' then array['body','scores'] else array['body'] end) <> '{}'::jsonb
      or jsonb_typeof(p_payload->'body') is distinct from 'string' then
      raise invalid_parameter_value;
    end if;
    feedback_body := btrim(p_payload->>'body');
    select * into own_entry from private.lms_peer_entries where run_id = p_run_id and round_number = target_round and user_id = who;
    if not found then raise insufficient_privilege; end if;
    if p_action = 'feedback' then
      if char_length(feedback_body) not between 3 and 2000 then raise invalid_parameter_value; end if;
      review_scores := p_payload->'scores';
      if round.scoring_rubric is null then
        if p_payload ? 'scores' then raise invalid_parameter_value; end if;
      elsif not private.lms_peer_valid_scores(round.scoring_rubric, review_scores) then
        raise invalid_parameter_value;
      end if;
      update private.lms_peer_matches match set feedback = feedback_body, scores = review_scores
      from private.lms_peer_entries author
      where match.run_id = p_run_id and match.round_number = target_round and match.reviewer_entry = own_entry.id and author.id = match.author_entry
        and (match.feedback is null or (match.feedback = feedback_body and match.scores is not distinct from review_scores))
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

create function private.course_peer_feedback_attachment(p_run_id uuid, p_round_number integer, p_version_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  context jsonb := private.course_workspace_context(p_run_id);
  who uuid := auth.uid();
  selected jsonb;
begin
  if who is null or (context->>'lms_enabled')::boolean is not true
    or not coalesce((context->>'staff')::boolean or (context->>'learner')::boolean, false)
    then raise insufficient_privilege; end if;
  if (select edition from private.installation_identity) is distinct from 'internal'
    and private.academy_course_access_status() not in ('active','grace') then raise insufficient_privilege; end if;

  select private.lms_peer_attachment_file(entry.user_id, entry.attachment_version)
    into selected
  from private.lms_peer_entries entry
  join private.lms_peer_rounds round
    on round.run_id = entry.run_id and round.round_number = entry.round_number
  join public.course_runs run on run.id = entry.run_id
  join public.organisations company on company.id = run.organisation_id
  where entry.run_id = p_run_id and entry.round_number = p_round_number and entry.attachment_version = p_version_id
    and company.archived_at is null
    and private.lms_peer_current_learner(p_run_id, run.organisation_id, entry.user_id)
    and (
      (context->>'staff')::boolean is true
      or entry.user_id = who
      or (round.stage = 'reviewing' and entry.approved and exists (
        select from private.lms_peer_matches match
        join private.lms_peer_entries reviewer on reviewer.id = match.reviewer_entry
        where match.author_entry = entry.id and match.run_id = entry.run_id
          and match.round_number = entry.round_number and reviewer.user_id = who
          and private.lms_peer_current_learner(p_run_id, run.organisation_id, who)
      ))
    )
  limit 1;
  if selected is null then raise insufficient_privilege; end if;
  return selected;
end;
$$;

create function public.course_peer_feedback_attachment(p_run_id uuid, p_round_number integer, p_version_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.course_peer_feedback_attachment(p_run_id, p_round_number, p_version_id);
$$;

revoke all on function private.lms_peer_attachment_file(uuid,uuid), private.lms_peer_attachment_summary(uuid,uuid),
  private.lms_peer_valid_scores(jsonb,jsonb), private.course_peer_feedback_attachment(uuid,integer,uuid),
  public.course_peer_feedback_attachment(uuid,integer,uuid) from public, anon, authenticated, service_role;
grant execute on function private.course_peer_feedback_attachment(uuid,integer,uuid),
  public.course_peer_feedback_attachment(uuid,integer,uuid) to authenticated;

do $migration$
declare
  academy text := pg_catalog.pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  portal text := pg_catalog.pg_get_functiondef('private.require_portal_access()'::regprocedure);
  anchor constant text := '''/rpc/course_peer_feedback''';
  gate constant text := anchor || ', ''/rpc/course_peer_feedback_attachment''';
begin
  if cardinality(string_to_array(academy, anchor)) <> 2 or cardinality(string_to_array(portal, anchor)) <> 2
    then raise exception 'Expected the moderated peer feedback read boundary'; end if;
  execute replace(academy, anchor, gate);
  execute replace(portal, anchor, gate);
end;
$migration$;

notify pgrst, 'reload schema';
commit;
