begin;

-- Job-specific authored references and explicitly released contact details are
-- separate from the private customer directory and from accepted commercial terms.
create table private.job_briefings (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  reference_url text not null default '' check (length(reference_url) <= 2048),
  reference_label text not null default '' check (length(reference_label) <= 120),
  reference_description text not null default '' check (length(reference_description) <= 4000),
  contact_name text not null default '' check (length(contact_name) <= 120),
  contact_email text not null default '' check (length(contact_email) <= 254),
  contact_phone text not null default '' check (length(contact_phone) <= 50),
  contact_description text not null default '' check (length(contact_description) <= 2000),
  contact_visibility text not null default 'after_claim'
    check (contact_visibility in ('after_claim', 'offer_viewers')),
  version integer not null check (version > 0),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default clock_timestamp()
);

-- A retry binds the original operation, not just an arbitrary UUID. These private
-- historical inputs are never projected through the job/read or audit interfaces.
create table private.job_briefing_requests (
  actor_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid not null,
  job_id uuid not null references public.jobs(id) on delete cascade,
  expected_version integer not null check (expected_version >= 0),
  request_payload jsonb not null,
  saved_version integer not null check (saved_version > 0),
  created_at timestamptz not null default clock_timestamp(),
  primary key (actor_id, request_id)
);
create index job_briefing_requests_job on private.job_briefing_requests(job_id);
alter table private.job_briefings enable row level security;
alter table private.job_briefing_requests enable row level security;
-- No direct client grants or policies: only the actor-checked private functions
-- below may read/write these unexposed rows. FK cleanup retains ordinary ownership.
revoke all on private.job_briefings, private.job_briefing_requests from public, anon, authenticated;

-- Return only information this current active actor can read on this job.
-- Historical/cancelled claims may retain job history, but never after-claim contacts.
-- A historical claim is not a bypass for a current learner/client/guest role.
create function private.job_briefing(p_job_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  briefing private.job_briefings;
  job public.jobs;
  manager boolean := private.has_permission('jobs.manage');
  has_contact boolean;
  contact_visible boolean;
begin
  if not private.actor_active() or not private.can_read_job(p_job_id)
    or not (manager or private.lecturer_actor()) then
    raise exception 'Job briefing access denied' using errcode = '42501';
  end if;
  select * into job from public.jobs where id = p_job_id;
  if job.id is null then
    raise exception 'Job briefing access denied' using errcode = '42501';
  end if;
  select * into briefing from private.job_briefings where job_id = p_job_id;
  has_contact := coalesce(briefing.contact_name <> '' or briefing.contact_email <> ''
    or briefing.contact_phone <> '' or briefing.contact_description <> '', false);
  contact_visible := has_contact and (
    manager
    or briefing.contact_visibility = 'offer_viewers'
    or exists(select 1 from public.job_claims c where c.job_id = p_job_id
      and c.lecturer_id = auth.uid() and c.status = 'confirmed')
  );
  return jsonb_build_object(
    'version', coalesce(briefing.version, 0),
    'reference_url', coalesce(briefing.reference_url, ''),
    'reference_label', coalesce(briefing.reference_label, ''),
    'reference_description', coalesce(briefing.reference_description, ''),
    'contact_name', case when contact_visible then briefing.contact_name else '' end,
    'contact_email', case when contact_visible then briefing.contact_email else '' end,
    'contact_phone', case when contact_visible then briefing.contact_phone else '' end,
    'contact_description', case when contact_visible then briefing.contact_description else '' end,
    'contact_visibility', coalesce(briefing.contact_visibility, 'after_claim'),
    'has_contact', has_contact,
    'contact_visible', contact_visible,
    'can_manage', manager,
    'can_edit', manager and job.status <> 'archived'
  );
end;
$$;

-- The public entry point stays invoker; the unexposed implementation performs
-- current actor/resource checks rather than trusting submitted user or role IDs.
create function public.job_briefing(p_job_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select private.job_briefing(p_job_id);
$$;

-- Save a reviewed complete set of optional fields without changing job fees,
-- accepted claims, contractual terms, customer contacts or any source provenance.
create function private.save_job_briefing(
  p_job_id uuid, p_expected_version integer, p_request_id uuid, p_payload jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  job public.jobs;
  previous private.job_briefings;
  prior private.job_briefing_requests;
  reference_url text;
  reference_label text;
  reference_description text;
  contact_name text;
  contact_email text;
  contact_phone text;
  contact_description text;
  visibility text;
  authority text;
  port text;
  saved integer;
begin
  -- Role/lifecycle changes lock the actor profile FOR UPDATE. Keep its SHARE
  -- lock before request/job locks, so revocation cannot race a successful write.
  perform 1 from public.profiles where id = actor and active for share;
  if not found or not private.has_permission('jobs.manage') then
    raise exception 'Job management and MFA required' using errcode = '42501';
  end if;
  if p_job_id is null or p_request_id is null or p_expected_version is null
    or p_expected_version < 0 or p_expected_version >= 2147483647
    or p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Invalid job briefing request' using errcode = '22023';
  end if;
  if exists(select 1 from jsonb_each(p_payload) field
    where field.key not in ('reference_url', 'reference_label', 'reference_description',
      'contact_name', 'contact_email', 'contact_phone', 'contact_description', 'contact_visibility')
      or jsonb_typeof(field.value) <> 'string') then
    raise exception 'Invalid job briefing fields' using errcode = '22023';
  end if;
  -- Bound the original request too: whitespace normalization must not turn a
  -- huge input into a small row while retaining that huge input in retry history.
  if exists(select 1 from jsonb_each_text(p_payload) field where length(field.value) >
    case field.key when 'reference_url' then 2048 when 'reference_label' then 120
      when 'reference_description' then 4000 when 'contact_name' then 120
      when 'contact_email' then 254 when 'contact_phone' then 50
      when 'contact_description' then 2000 when 'contact_visibility' then 13 else 0 end) then
    raise exception 'Job briefing fields exceed their bounds' using errcode = '22023';
  end if;
  reference_url := btrim(coalesce(p_payload->>'reference_url', ''));
  reference_label := btrim(coalesce(p_payload->>'reference_label', ''));
  reference_description := btrim(coalesce(p_payload->>'reference_description', ''));
  contact_name := btrim(coalesce(p_payload->>'contact_name', ''));
  contact_email := btrim(coalesce(p_payload->>'contact_email', ''));
  contact_phone := btrim(coalesce(p_payload->>'contact_phone', ''));
  contact_description := btrim(coalesce(p_payload->>'contact_description', ''));
  visibility := coalesce(p_payload->>'contact_visibility', 'after_claim');
  if length(reference_url) > 2048 or length(reference_label) > 120
    or length(reference_description) > 4000 or length(contact_name) > 120
    or length(contact_email) > 254 or length(contact_phone) > 50
    or length(contact_description) > 2000 or visibility not in ('after_claim', 'offer_viewers')
    or reference_label ~ '[[:cntrl:]]' or contact_name ~ '[[:cntrl:]]'
    or contact_email ~ '[[:cntrl:]]' or contact_phone ~ '[[:cntrl:]]'
    or (contact_email <> '' and contact_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
    raise exception 'Invalid job briefing values' using errcode = '22023';
  end if;
  -- This URL is rendered as a link, never fetched by the server. Restrict schemes,
  -- authority, credentials, whitespace/control characters and impossible ports.
  if reference_url <> '' then
    if reference_url !~* '^https?://([[:alnum:]]([[:alnum:].-]*[[:alnum:]])?|\[[0-9a-f:]+\])(:[0-9]{1,5})?([/?#][^[:space:][:cntrl:]]*)?$' then
      raise exception 'Invalid job reference URL' using errcode = '22023';
    end if;
    authority := substring(reference_url from '^[^:]+://([^/?#]+)');
    port := substring(authority from ':([0-9]+)$');
    if port is not null and (port::integer < 1 or port::integer > 65535) then
      raise exception 'Invalid job reference URL port' using errcode = '22023';
    end if;
  end if;
  -- Retry identity is serialized before the job lock, including cross-job reuse.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'job-briefing-request:' || actor::text || ':' || p_request_id::text, 0));
  select * into prior from private.job_briefing_requests
    where actor_id = actor and request_id = p_request_id;
  if found then
    if prior.job_id <> p_job_id or prior.expected_version <> p_expected_version
      or prior.request_payload <> p_payload then
      raise exception 'Job briefing request identity changed' using errcode = '22023';
    end if;
    -- A successful old retry never rewrites a newer contact. Return the fresh
    -- authorized current version, including any subsequent archival/revocation.
    return private.job_briefing(p_job_id);
  end if;
  select * into job from public.jobs where id = p_job_id for update;
  if job.id is null then
    raise exception 'Job not found' using errcode = '22023';
  end if;
  if job.status = 'archived' then
    raise exception 'Archived job briefing is read-only' using errcode = '22023';
  end if;
  select * into previous from private.job_briefings where job_id = p_job_id;
  if coalesce(previous.version, 0) <> p_expected_version then
    raise exception 'Job briefing changed; reload current version' using errcode = '40001';
  end if;
  saved := p_expected_version + 1;
  insert into private.job_briefings(job_id, reference_url, reference_label,
    reference_description, contact_name, contact_email, contact_phone,
    contact_description, contact_visibility, version, updated_by)
  values(p_job_id, reference_url, reference_label, reference_description,
    contact_name, contact_email, contact_phone, contact_description, visibility, saved, actor)
  on conflict(job_id) do update set reference_url = excluded.reference_url,
    reference_label = excluded.reference_label, reference_description = excluded.reference_description,
    contact_name = excluded.contact_name, contact_email = excluded.contact_email,
    contact_phone = excluded.contact_phone, contact_description = excluded.contact_description,
    contact_visibility = excluded.contact_visibility, version = excluded.version,
    updated_by = excluded.updated_by, updated_at = clock_timestamp();
  insert into private.job_briefing_requests(actor_id, request_id, job_id,
    expected_version, request_payload, saved_version)
  values(actor, p_request_id, p_job_id, p_expected_version, p_payload, saved);
  -- General audit metadata contains no contact text, customer notes or URL.
  insert into public.audit_events(actor_id, action, resource_id, details)
  values(actor, 'job.briefing.saved', p_job_id, jsonb_build_object(
    'version', saved, 'has_reference', reference_url <> '' or reference_label <> '' or reference_description <> '',
    'has_contact', contact_name <> '' or contact_email <> '' or contact_phone <> '' or contact_description <> '',
    'contact_visibility', visibility));
  return private.job_briefing(p_job_id);
end;
$$;

create function public.save_job_briefing(
  p_job_id uuid, p_expected_version integer, p_request_id uuid, p_payload jsonb
) returns jsonb
language sql security invoker set search_path = '' as $$
  select private.save_job_briefing(p_job_id, p_expected_version, p_request_id, p_payload);
$$;

revoke all on function private.job_briefing(uuid), public.job_briefing(uuid),
  private.save_job_briefing(uuid,integer,uuid,jsonb), public.save_job_briefing(uuid,integer,uuid,jsonb)
  from public, anon;
grant execute on function private.job_briefing(uuid), public.job_briefing(uuid),
  private.save_job_briefing(uuid,integer,uuid,jsonb), public.save_job_briefing(uuid,integer,uuid,jsonb)
  to authenticated;
commit;
