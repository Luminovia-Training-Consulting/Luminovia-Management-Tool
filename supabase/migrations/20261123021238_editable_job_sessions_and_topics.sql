begin;

-- Only replace an exclusively owned, complete future schedule. Shared course
-- plans and existing course activity have separate change workflows.
create function private.can_edit_job_schedule(p_job public.jobs)
returns boolean language sql stable set search_path = '' as $$
  select p_job.status in ('draft', 'published')
    and not exists (select 1 from public.job_claims claim where claim.job_id = p_job.id)
    and not exists (select 1 from public.job_sessions slot where slot.job_id = p_job.id and slot.starts_at <= now())
    and (
      p_job.course_run_id is null
      or (
        private.has_permission('courses.manage')
        and not exists (select 1 from public.jobs peer where peer.course_run_id = p_job.course_run_id and peer.id <> p_job.id)
        and not exists (select 1 from public.course_enrolments member where member.course_run_id = p_job.course_run_id)
        and not exists (
          select 1 from public.job_sessions slot
          left join public.course_sessions session on session.id = slot.course_session_id
            and session.course_run_id = p_job.course_run_id
            and (session.starts_at, session.ends_at) = (slot.starts_at, slot.ends_at)
          where slot.job_id = p_job.id and session.id is null
        )
        and not exists (
          select 1 from public.course_sessions session where session.course_run_id = p_job.course_run_id
          and (
            not exists (select 1 from public.job_sessions slot where slot.job_id = p_job.id and slot.course_session_id = session.id)
            or exists (select 1 from private.course_attendance attendance where attendance.session_id = session.id)
            or exists (select 1 from private.course_attendance_audit audit where audit.session_id = session.id)
            or exists (select 1 from private.course_attendance_evidence evidence where evidence.session_id = session.id)
          )
        )
      )
    );
$$;

create function private.edit_job_schedule(p_job public.jobs, p_sessions jsonb)
returns void language plpgsql set search_path = '' as $$
begin
  if jsonb_typeof(p_sessions) is distinct from 'array' or jsonb_array_length(p_sessions) not between 1 and 60 then
    raise exception 'One to sixty job sessions required' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_sessions) item
    where jsonb_typeof(item) is distinct from 'object'
       or jsonb_typeof(item->'starts_at') is distinct from 'string'
       or jsonb_typeof(item->'ends_at') is distinct from 'string'
       or item->>'starts_at' !~ 'T[0-9]{2}:[0-9]{2}.*(Z|[+-][0-9]{2}:[0-9]{2})$'
       or item->>'ends_at' !~ 'T[0-9]{2}:[0-9]{2}.*(Z|[+-][0-9]{2}:[0-9]{2})$'
  ) then raise exception 'Job sessions require explicit instants' using errcode = '22023'; end if;

  if exists (
    select 1 from (
      select starts_at, ends_at, lag(ends_at) over (order by starts_at, ends_at) previous_end
      from jsonb_to_recordset(p_sessions) as slot(starts_at timestamptz, ends_at timestamptz)
    ) ordered_slots
    where starts_at <= clock_timestamp() or not isfinite(ends_at) or ends_at <= starts_at or starts_at < previous_end
  ) then raise exception 'Future, non-overlapping job sessions required' using errcode = '22023'; end if;

  -- The lifecycle action already holds the job row through the claim commit.
  if p_job.course_run_id is not null then
    perform 1 from public.course_runs where id = p_job.course_run_id for update;
    perform 1 from public.course_sessions where course_run_id = p_job.course_run_id order by id for update;
  end if;
  if not private.can_edit_job_schedule(p_job) then
    raise exception 'Job schedule is protected by existing course activity' using errcode = '22023';
  end if;

  delete from public.job_sessions slot
  where slot.job_id = p_job.id and not exists (
    select 1 from jsonb_to_recordset(p_sessions) as desired(starts_at timestamptz, ends_at timestamptz)
    where (desired.starts_at, desired.ends_at) = (slot.starts_at, slot.ends_at)
  );
  if p_job.course_run_id is not null then
    delete from public.course_sessions session where session.course_run_id = p_job.course_run_id
      and not exists (select 1 from public.job_sessions slot where slot.course_session_id = session.id);
    insert into public.course_sessions(course_run_id, starts_at, ends_at)
    select p_job.course_run_id, desired.starts_at, desired.ends_at
    from jsonb_to_recordset(p_sessions) as desired(starts_at timestamptz, ends_at timestamptz)
    where not exists (
      select 1 from public.course_sessions session where session.course_run_id = p_job.course_run_id
        and (session.starts_at, session.ends_at) = (desired.starts_at, desired.ends_at)
    );
  end if;
  insert into public.job_sessions(job_id, course_session_id, starts_at, ends_at)
  select p_job.id, session.id, desired.starts_at, desired.ends_at
  from jsonb_to_recordset(p_sessions) as desired(starts_at timestamptz, ends_at timestamptz)
  left join public.course_sessions session on session.course_run_id = p_job.course_run_id
    and (session.starts_at, session.ends_at) = (desired.starts_at, desired.ends_at)
  where not exists (
    select 1 from public.job_sessions slot where slot.job_id = p_job.id
      and (slot.starts_at, slot.ends_at) = (desired.starts_at, desired.ends_at)
  );
end;
$$;

create function private.edit_job_topics(p_job_id uuid, p_topics jsonb)
returns void language plpgsql set search_path = '' as $$
declare desired uuid[];
begin
  if jsonb_typeof(p_topics) is distinct from 'array' or jsonb_array_length(p_topics) > 500 then
    raise exception 'Invalid required topics' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_topics) item where jsonb_typeof(item) is distinct from 'string') then
    raise exception 'Required topics must be UUIDs' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct value::uuid), '{}'::uuid[]) into desired
  from jsonb_array_elements_text(p_topics);
  delete from public.job_requirements where job_id = p_job_id and topic_id <> all(desired);
  -- Existing archived topics remain valid until explicitly removed. The
  -- catalogue's insert gate prevents adding a newly archived topic.
  insert into public.job_requirements(job_id, topic_id)
  select p_job_id, selected.topic_id from unnest(desired) as selected(topic_id)
  where not exists (
    select 1 from public.job_requirements req where req.job_id = p_job_id and req.topic_id = selected.topic_id
  );
end;
$$;

revoke all on function private.can_edit_job_schedule(public.jobs),
  private.edit_job_schedule(public.jobs,jsonb), private.edit_job_topics(uuid,jsonb)
from public, anon, authenticated, service_role;

do $migration$
declare
  definition text := pg_get_functiondef('private.manage_job_offer(uuid,text,integer,uuid,jsonb)'::regprocedure);
  validation constant text := 'for k in select jsonb_object_keys(p_payload) loop ';
  accepted_guard constant text := 'deadline=case when p_payload?''claim_deadline''';
  version_update constant text := 'terms=coalesce(p_payload->>''terms'',j.terms),claim_deadline=deadline';
  projection constant text := $$'can_duplicate',manager$$;
begin
  if cardinality(string_to_array(definition, validation)) <> 2
    or cardinality(string_to_array(definition, accepted_guard)) <> 3
    or cardinality(string_to_array(definition, version_update)) <> 2 then
    raise exception 'Expected existing versioned offer edit';
  end if;
  definition := replace(definition, validation, validation || $validation$
    if p_action = 'edit' and k in ('sessions', 'topic_ids') then continue; end if;
  $validation$);
  -- Run after the accepted-history guard, before validating either deadline
  -- against the first retained or replacement session. A failure rolls back
  -- sessions, topics, offer version and receipt as a single transaction.
  definition := overlay(definition placing $write$
    if p_action = 'edit' then
      if p_payload ? 'sessions' then perform private.edit_job_schedule(j, p_payload->'sessions'); end if;
      if p_payload ? 'topic_ids' then perform private.edit_job_topics(j.id, p_payload->'topic_ids'); end if;
    end if;
  $write$ from strpos(definition, accepted_guard) for 0);
  execute replace(definition, version_update, version_update || $version$
    ,terms_version=case when p_payload ?| array['sessions','topic_ids'] then j.terms_version+1 else j.terms_version end
  $version$);

  definition := pg_get_functiondef('private.job_lifecycle(uuid)'::regprocedure);
  if cardinality(string_to_array(definition, projection)) <> 2 then
    raise exception 'Expected existing lifecycle capability projection';
  end if;
  execute replace(definition, projection,
    $projection$'can_edit_schedule',manager and private.can_edit_job_schedule(j),'can_duplicate',manager$projection$);
end;
$migration$;

commit;
