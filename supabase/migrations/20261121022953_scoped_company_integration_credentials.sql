begin;

create table private.company_integration_keys (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 120),
  secret_hash bytea not null check (octet_length(secret_hash) = 32),
  issued_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  version integer not null default 1 check (version > 0),
  last_used_at timestamptz,
  window_started_at timestamptz,
  window_requests integer not null default 0
);
alter table private.company_integration_keys enable row level security;
revoke all on private.company_integration_keys from public,anon,authenticated,service_role;

create function private.company_integration_admin()
returns boolean language sql stable security definer set search_path = ''
as $$
  select private.actor_active() and exists(
    select 1 from public.user_roles r where r.user_id=auth.uid() and r.role in ('admin','owner')
  );
$$;

create function private.company_integration_keys(p_organisation_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.company_integration_admin() then raise insufficient_privilege; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(k) order by k.created_at desc, k.id)
    from (
      select id, label, created_at, expires_at, revoked_at, version, last_used_at
      from private.company_integration_keys
      where organisation_id = p_organisation_id
      order by created_at desc, id limit 100
    ) k
  ), '[]'::jsonb);
end;
$$;

create function private.issue_company_integration_key(
  p_organisation_id uuid, p_label text, p_expires_at timestamptz,
  p_rotate_id uuid, p_expected_version integer
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  secret text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  key_row private.company_integration_keys%rowtype;
begin
  if not private.company_integration_admin() then raise insufficient_privilege; end if;
  perform 1 from public.organisations where id=p_organisation_id and archived_at is null for update;
  if not found then raise insufficient_privilege; end if;
  if p_expires_at is null or p_expires_at <= now() or p_expires_at > now() + interval '180 days'
    or p_label is null or char_length(btrim(p_label)) not between 1 and 120
  then raise exception 'Invalid label or key expiry' using errcode='22023'; end if;
  if p_rotate_id is null then
    if (select count(*) from private.company_integration_keys
        where organisation_id=p_organisation_id and revoked_at is null and expires_at > now()) >= 20 then
      raise exception 'Too many active integration keys' using errcode='54000';
    end if;
    insert into private.company_integration_keys(organisation_id,label,secret_hash,issued_by,expires_at)
    values(p_organisation_id,btrim(p_label),sha256(convert_to(secret,'UTF8')),auth.uid(),p_expires_at)
    returning * into key_row;
  else
    update private.company_integration_keys set
      label=btrim(p_label), secret_hash=sha256(convert_to(secret,'UTF8')),
      issued_by=auth.uid(), expires_at=p_expires_at, version=version+1,
      window_requests=0, window_started_at=null
    where id=p_rotate_id and organisation_id=p_organisation_id and revoked_at is null
      and version=p_expected_version
    returning * into key_row;
    if not found then raise exception 'Integration key changed' using errcode='40001'; end if;
  end if;
  insert into public.audit_events(actor_id,action,resource_id,details) values(
    auth.uid(),case when p_rotate_id is null then 'integration.created' else 'integration.rotated' end,
    key_row.id,jsonb_build_object('organisation_id',p_organisation_id,'scope','courses.read')
  );
  return jsonb_build_object('id',key_row.id,'version',key_row.version,
    'credential','lvi_' || key_row.id::text || '_' || secret);
end;
$$;

create function private.revoke_company_integration_key(p_id uuid,p_expected_version integer)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not private.company_integration_admin() then raise insufficient_privilege; end if;
  update private.company_integration_keys set revoked_at=now(),version=version+1
    where id=p_id and version=p_expected_version and revoked_at is null;
  if not found then raise exception 'Integration key changed' using errcode='40001'; end if;
  insert into public.audit_events(actor_id,action,resource_id,details)
    values(auth.uid(),'integration.revoked',p_id,'{}'::jsonb);
end;
$$;

-- No client can call the service dispatcher directly. The integration key does
-- not become a Supabase role or grant access to native REST, Storage or Auth.
create function private.integration_course_index(
  p_id uuid,p_secret_hash text,p_limit integer,p_after uuid
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  key_row private.company_integration_keys%rowtype;
  items jsonb;
begin
  if p_secret_hash is null or p_secret_hash !~ '^[0-9a-f]{64}$' or
     p_limit is null or p_limit not between 1 and 50
  then return jsonb_build_object('status','denied'); end if;
  select * into key_row from private.company_integration_keys
    where id=p_id and secret_hash=decode(p_secret_hash,'hex')
    for update;
  if not found or key_row.revoked_at is not null or key_row.expires_at <= clock_timestamp() or
     not exists(select 1 from public.organisations o where o.id=key_row.organisation_id and o.archived_at is null) or
     not exists(select 1 from public.user_roles r join public.profiles p on p.id=r.user_id
       where r.user_id=key_row.issued_by and p.active and r.role in ('admin','owner'))
  then return jsonb_build_object('status','denied'); end if;
  if key_row.window_started_at is null or key_row.window_started_at <= clock_timestamp() - interval '1 minute' then
    key_row.window_started_at := clock_timestamp();
    key_row.window_requests := 0;
  end if;
  if key_row.window_requests >= 60 then return jsonb_build_object('status','rate_limited'); end if;
  update private.company_integration_keys
  set window_started_at=key_row.window_started_at, window_requests=key_row.window_requests+1,
      last_used_at=clock_timestamp() where id=p_id;
  select coalesce(jsonb_agg(to_jsonb(course_row) order by course_row.id),'[]'::jsonb) into items from (
    select r.id,t.title,r.time_zone from public.course_runs r
    join public.course_templates t on t.id=r.template_id
    where r.organisation_id=key_row.organisation_id and r.archived_at is null and r.published
      and (p_after is null or r.id > p_after)
    order by r.id limit p_limit+1
  ) course_row;
  return jsonb_build_object('status','ok','items',
    case when jsonb_array_length(items)>p_limit then items-p_limit else items end,
    'next_cursor',case when jsonb_array_length(items)>p_limit then items->(p_limit-1)->>'id' end);
end;
$$;

create function public.company_integration_keys(p_organisation_id uuid)
returns jsonb language sql stable security invoker set search_path=''
as $$select private.company_integration_keys(p_organisation_id);$$;
create function public.issue_company_integration_key(
  p_organisation_id uuid,p_label text,p_expires_at timestamptz,p_rotate_id uuid,p_expected_version integer
)
returns jsonb language sql security invoker set search_path=''
as $$select private.issue_company_integration_key(p_organisation_id,p_label,p_expires_at,p_rotate_id,p_expected_version);$$;
create function public.revoke_company_integration_key(p_id uuid,p_expected_version integer)
returns void language sql security invoker set search_path=''
as $$select private.revoke_company_integration_key(p_id,p_expected_version);$$;
create function public.integration_course_index(p_id uuid,p_secret_hash text,p_limit integer,p_after uuid)
returns jsonb language sql security invoker set search_path=''
as $$select private.integration_course_index(p_id,p_secret_hash,p_limit,p_after);$$;

revoke all on function private.company_integration_admin(), private.company_integration_keys(uuid),
  private.issue_company_integration_key(uuid,text,timestamptz,uuid,integer),
  private.revoke_company_integration_key(uuid,integer), private.integration_course_index(uuid,text,integer,uuid),
  public.company_integration_keys(uuid),public.issue_company_integration_key(uuid,text,timestamptz,uuid,integer),
  public.revoke_company_integration_key(uuid,integer),public.integration_course_index(uuid,text,integer,uuid)
from public,anon,authenticated,service_role;
grant execute on function private.company_integration_keys(uuid),
  private.issue_company_integration_key(uuid,text,timestamptz,uuid,integer),
  private.revoke_company_integration_key(uuid,integer),public.company_integration_keys(uuid),
  public.issue_company_integration_key(uuid,text,timestamptz,uuid,integer),
  public.revoke_company_integration_key(uuid,integer) to authenticated;
grant execute on function private.integration_course_index(uuid,text,integer,uuid),
  public.integration_course_index(uuid,text,integer,uuid) to service_role;
commit;
