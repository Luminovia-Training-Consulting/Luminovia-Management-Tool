-- Export committed course records without opening an LRS connection or exposing names.
begin;

create table private.xapi_export_identity (
  singleton boolean primary key default true check (singleton),
  pseudonym_key bytea not null check (octet_length(pseudonym_key) = 32)
);
alter table private.xapi_export_identity enable row level security;
revoke all on private.xapi_export_identity from public, anon, authenticated, service_role;
insert into private.xapi_export_identity(pseudonym_key) values (extensions.gen_random_bytes(32));

create index course_quiz_attempt_export_order on private.course_quiz_attempts(run_id, created_at, id);
create index course_completion_export_order on private.course_completion_records(run_id, created_at, id);
create index course_completion_revocations_export_order on private.course_completion_records(run_id, revoked_at, id)
where revoked_at is not null;

-- Deterministic statement IDs remain separate from database row identities.
-- Namespace-derived UUIDs use the RFC 4122 SHA-1 name-based format.
create function private.xapi_statement_id(p_kind text, p_record uuid, p_key bytea)
returns uuid language sql immutable security invoker set search_path = '' as $$
  select encode(substring(
    set_byte(set_byte(hash, 6, (get_byte(hash, 6) & 15) | 80), 8, (get_byte(hash, 8) & 63) | 128)
    from 1 for 16), 'hex')::uuid
  from (select extensions.digest(
    decode('6ba7b8109dad11d180b400c04fd430c8', 'hex') ||
    convert_to(encode(p_key, 'hex') || ':' || p_kind || ':' || p_record, 'UTF8'), 'sha1'
  ) hash) encoded;
$$;
revoke all on function private.xapi_statement_id(text, uuid, bytea) from public, anon, authenticated, service_role;

-- Only course managers can export an organisation's committed, currently
-- eligible learner facts. Mapping order and source timestamps remain stable.
create function private.course_xapi_statements(p_run_id uuid, p_from timestamptz, p_until timestamptz)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  context jsonb := private.course_workspace_context(p_run_id);
  course_company uuid;
  export_key bytea;
  activity text;
  result jsonb;
begin
  if (context->>'manager')::boolean is not true or (context->>'lms_enabled')::boolean is not true then
    raise insufficient_privilege;
  end if;
  if p_from is null or p_until is null or not isfinite(p_from) or not isfinite(p_until)
    or p_until <= p_from or p_until - p_from > interval '366 days' then
    raise exception 'Invalid learning record export window' using errcode = '22023';
  end if;
  select organisation_id into course_company from public.course_runs where id = p_run_id;
  if course_company is null then raise insufficient_privilege; end if;
  select pseudonym_key into strict export_key from private.xapi_export_identity;
  activity := 'https://luminovia.org/xapi/activities/course/' ||
    encode(extensions.hmac(convert_to('course:' || p_run_id, 'UTF8'), export_key, 'sha256'), 'hex');

  with roster as materialized (
    select user_id from public.course_enrolments where course_run_id = p_run_id
      and status in ('enrolled','completed')
      and private.active_company_participant(user_id, course_company)
  ), facts as (
    select attempt.id, attempt.user_id, attempt.created_at as happened_at,
      'attempt'::text as kind, attempt.quiz_version, attempt.score, attempt.passed
    from private.course_quiz_attempts attempt join roster using(user_id)
    where attempt.run_id = p_run_id and attempt.created_at >= p_from and attempt.created_at < p_until
    union all
    select certificate.id, certificate.user_id, certificate.created_at,
      'completion', null, null, null
    from private.course_completion_records certificate join roster using(user_id)
    where certificate.run_id = p_run_id and certificate.created_at >= p_from and certificate.created_at < p_until
    union all
    select certificate.id, certificate.user_id, certificate.revoked_at,
      'revocation', null, null, null
    from private.course_completion_records certificate join roster using(user_id)
    where certificate.run_id = p_run_id and certificate.revoked_at >= p_from and certificate.revoked_at < p_until
  ), bounded as (
    select * from facts order by happened_at, kind, id limit 2001
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', private.xapi_statement_id(kind, id, export_key),
    'timestamp', happened_at,
    'actor', jsonb_build_object('objectType', 'Agent', 'account', jsonb_build_object(
      'homePage','https://luminovia.org',
      'name', encode(extensions.hmac(convert_to(
        course_company::text || ':' || case when kind='revocation' then 'certificate-service' else user_id::text end,
        'UTF8'), export_key, 'sha256'), 'hex')
    )),
    'verb', jsonb_build_object('id', 'http://adlnet.gov/expapi/verbs/' ||
      case kind when 'revocation' then 'voided' when 'attempt' then 'attempted' else 'completed' end),
    'object', case when kind='revocation' then jsonb_build_object(
      'objectType', 'StatementRef', 'id', private.xapi_statement_id('completion', id, export_key)
    ) else jsonb_build_object('objectType','Activity', 'id',
      case when kind='attempt' then activity || '/quiz/' || quiz_version else activity end)
    end
  ) || case kind
    when 'attempt' then jsonb_build_object('result', jsonb_build_object('score', jsonb_build_object(
      'scaled', score::numeric / 100, 'raw', score, 'min', 0, 'max', 100), 'success', passed))
    when 'completion' then jsonb_build_object('result', jsonb_build_object('completion', true))
    else '{}'::jsonb end
  order by happened_at, kind, id), '[]'::jsonb) into result from bounded;
  if jsonb_array_length(result) > 2000 then
    raise exception 'Learning record export exceeds 2000 statements; choose a shorter period' using errcode = '54000';
  end if;
  return jsonb_build_object('profile', 'luminovia-lms-1', 'xapi_version', '1.0.3', 'statements', result);
end;
$$;

create function public.course_xapi_statements(p_run_id uuid, p_from timestamptz, p_until timestamptz)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.course_xapi_statements(p_run_id, p_from, p_until);
$$;
revoke all on function private.course_xapi_statements(uuid, timestamptz, timestamptz),
  public.course_xapi_statements(uuid, timestamptz, timestamptz) from public, anon, authenticated, service_role;
grant execute on function private.course_xapi_statements(uuid, timestamptz, timestamptz),
  public.course_xapi_statements(uuid, timestamptz, timestamptz) to authenticated;

do $$
declare
  source text := pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  anchor text := '/rpc/course_material_metadata_history';
begin
  if cardinality(string_to_array(source, quote_literal(anchor))) <> 2 then
    raise exception 'Expected one Academy learning record read boundary';
  end if;
  execute replace(source, quote_literal(anchor), quote_literal(anchor) || ', ''/rpc/course_xapi_statements''');
end;
$$;
notify pgrst, 'reload schema';
commit;
