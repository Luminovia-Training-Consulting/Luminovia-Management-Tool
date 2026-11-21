begin;

create table private.academy_course_draft_requests (
  actor_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid not null,
  request_digest bytea not null check (octet_length(request_digest) = 32),
  run_id uuid references public.course_runs(id) on delete set null,
  primary key (actor_id, request_id)
);
create index academy_course_draft_request_run on private.academy_course_draft_requests(run_id);
alter table private.academy_course_draft_requests enable row level security;
revoke all on private.academy_course_draft_requests from public, anon, authenticated, service_role;

create function private.academy_course_draft_options(p_organisation_query text, p_template_query text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if private.academy_course_access_status() is distinct from 'active' or not private.learning_actor() then
    raise insufficient_privilege;
  end if;
  if not private.has_permission('courses.manage') then return null; end if;
  if p_organisation_query is null or p_template_query is null or
     length(p_organisation_query) > 100 or length(p_template_query) > 100 then
    raise invalid_parameter_value;
  end if;
  return jsonb_build_object(
    'organisations', coalesce((select jsonb_agg(to_jsonb(item) order by item.name,item.id) from (
      select id,name from public.organisations
      where archived_at is null and strpos(lower(name),lower(btrim(p_organisation_query))) > 0
      order by name,id limit 50
    ) item), '[]'::jsonb),
    'templates', coalesce((select jsonb_agg(to_jsonb(item) order by item.title,item.id) from (
      select id,title from public.course_templates
      where archived_at is null and strpos(lower(title),lower(btrim(p_template_query))) > 0
      order by title,id limit 50
    ) item), '[]'::jsonb)
  );
end;
$$;

create function private.academy_create_course_draft(
  p_request_id uuid, p_organisation_id uuid, p_template_id uuid,
  p_template_title text, p_payload jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  digest bytea;
  receipt private.academy_course_draft_requests%rowtype;
  course_id uuid;
  template_id uuid;
begin
  if not private.has_permission('courses.manage') then raise insufficient_privilege; end if;
  perform private.lock_academy_course_access();
  perform 1 from public.profiles where id = actor and active for share;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.user_roles where user_id = actor order by role for share;
  if not private.has_permission('courses.manage') then raise insufficient_privilege; end if;

  if p_request_id is null or p_organisation_id is null or
     ((p_template_id is null) = (p_template_title is null)) or
     (p_template_id is null and length(btrim(p_template_title)) not between 1 and 200) or
     jsonb_typeof(p_payload) is distinct from 'object' or
     p_payload - array['time_zone','delivery_type','venue','sessions'] <> '{}'::jsonb or
     jsonb_typeof(p_payload->'time_zone') is distinct from 'string' or
     not exists(select 1 from pg_timezone_names where name = p_payload->>'time_zone') or
     coalesce(p_payload->>'delivery_type','') not in ('online','onsite') or
     jsonb_typeof(p_payload->'venue') is distinct from 'string' or
     length(p_payload->>'venue') > 500 or
     jsonb_typeof(p_payload->'sessions') is distinct from 'array' then
    raise exception 'Invalid academy course draft' using errcode = '22023';
  end if;
  if jsonb_array_length(p_payload->'sessions') not between 1 and 60 or
     exists(select 1 from jsonb_array_elements(p_payload->'sessions') item
       where jsonb_typeof(item) is distinct from 'object' or
         item - array['starts_at','ends_at'] <> '{}'::jsonb or
         jsonb_typeof(item->'starts_at') is distinct from 'string' or
         jsonb_typeof(item->'ends_at') is distinct from 'string') then
    raise exception 'Invalid academy course sessions' using errcode = '22023';
  end if;
  digest := sha256(convert_to(jsonb_build_array(p_organisation_id,p_template_id,btrim(p_template_title),p_payload)::text,'UTF8'));
  perform pg_advisory_xact_lock(hashtextextended('academy-course-draft:' || actor::text || ':' || p_request_id::text,0));
  select * into receipt from private.academy_course_draft_requests where actor_id = actor and request_id = p_request_id;
  if found then
    if receipt.request_digest <> digest then raise exception 'Draft request changed' using errcode = 'PT409'; end if;
    select run.id,run.template_id into course_id,template_id
      from public.course_runs run join public.organisations org on org.id = run.organisation_id
      where run.id = receipt.run_id and run.archived_at is null and org.archived_at is null;
    if not found then raise exception 'Draft no longer available' using errcode = 'PT409'; end if;
  else
    perform 1 from public.organisations where id = p_organisation_id and archived_at is null for share;
    if not found then raise exception 'Academy organisation unavailable' using errcode = '22023'; end if;
    template_id := coalesce(p_template_id, private.save_course_template(null,jsonb_build_object('title',btrim(p_template_title))));
    course_id := private.save_course_run(null, p_payload || jsonb_build_object('template_id',template_id,'organisation_id',p_organisation_id));
    insert into private.academy_course_draft_requests(actor_id,request_id,request_digest,run_id)
      values (actor,p_request_id,digest,course_id);
  end if;
  return jsonb_build_object('course_run_id',course_id,'template_id',template_id);
end;
$$;

create function public.academy_course_draft_options(p_organisation_query text default '', p_template_query text default '')
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.academy_course_draft_options(p_organisation_query,p_template_query);
$$;
create function public.academy_create_course_draft(p_request_id uuid, p_organisation_id uuid, p_template_id uuid, p_template_title text, p_payload jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.academy_create_course_draft(p_request_id,p_organisation_id,p_template_id,p_template_title,p_payload);
$$;
revoke all on function private.academy_course_draft_options(text,text), public.academy_course_draft_options(text,text),
  private.academy_create_course_draft(uuid,uuid,uuid,text,jsonb), public.academy_create_course_draft(uuid,uuid,uuid,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function private.academy_course_draft_options(text,text), public.academy_course_draft_options(text,text),
  private.academy_create_course_draft(uuid,uuid,uuid,text,jsonb), public.academy_create_course_draft(uuid,uuid,uuid,text,jsonb)
  to authenticated;

-- Extend only the existing active-profile POST allowlist. Keep all other
-- methods, roles, profiles and release gates in the owning function.
do $$
declare
  definition text := pg_catalog.pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  anchor constant text := '''/rpc/academy_assign_course_instructor'', ''/rpc/academy_release_course_instructor'',';
begin
  if cardinality(string_to_array(definition,anchor)) <> 2 then
    raise exception 'Expected one active academy write allowlist';
  end if;
  execute replace(definition,anchor,anchor || chr(10) ||
    '      ''/rpc/academy_course_draft_options'', ''/rpc/academy_create_course_draft'',');
end;
$$;

notify pgrst, 'reload schema';
commit;
