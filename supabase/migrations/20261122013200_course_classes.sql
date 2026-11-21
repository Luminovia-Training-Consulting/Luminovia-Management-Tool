begin;

-- Keep classification metadata outside the exposed course records. The two
-- composite references prevent a course from ever using another company's class.
alter table public.course_runs add constraint course_runs_id_organisation_key
  unique (id, organisation_id);

create table private.course_classes (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  name text not null check (length(name) between 1 and 100 and name = btrim(name)
    and name !~ '[[:cntrl:]]'),
  unique (id, organisation_id)
);
create unique index course_classes_company_name on private.course_classes(organisation_id, lower(name));

create table private.course_class_assignments (
  course_id uuid primary key,
  organisation_id uuid not null,
  class_id uuid,
  version integer not null check (version > 0),
  foreign key (course_id, organisation_id)
    references public.course_runs(id, organisation_id) on update cascade on delete cascade,
  foreign key (class_id, organisation_id)
    references private.course_classes(id, organisation_id)
);
create index course_class_assignments_class on private.course_class_assignments(class_id, organisation_id)
  where class_id is not null;
alter table private.course_classes enable row level security;
alter table private.course_class_assignments enable row level security;
revoke all on private.course_classes, private.course_class_assignments from public, anon, authenticated, service_role;

-- Read only the current class as an ordinary course actor. Managers and
-- company contacts already allowed to see all courses of this company can
-- view the other live classes and runs.
create function private.course_class_options(p_course_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  context jsonb := private.course_workspace_context(p_course_id);
  academy_state text := private.academy_course_access_status();
  internal_edition boolean := (select edition = 'internal' from private.installation_identity);
  company_id uuid;
  assignment private.course_class_assignments%rowtype;
  current_class private.course_classes%rowtype;
  manager boolean;
  editable boolean;
begin
  if not coalesce((context->>'lms_enabled')::boolean, false)
    or (not internal_edition and not coalesce(academy_state in ('active', 'grace'), false)) then
    raise insufficient_privilege;
  end if;
  select run.organisation_id into company_id
  from public.course_runs run join public.organisations organisation on organisation.id = run.organisation_id
  where run.id = p_course_id and run.archived_at is null and organisation.archived_at is null;
  if not found then raise insufficient_privilege; end if;

  manager := (context->>'manager')::boolean or (context->>'client')::boolean;
  editable := manager and (internal_edition or academy_state = 'active');
  select * into assignment from private.course_class_assignments where course_id = p_course_id;
  select * into current_class from private.course_classes where id = assignment.class_id;

  return jsonb_build_object(
    'version', coalesce(assignment.version, 0),
    'current', case when current_class.id is not null
      then jsonb_build_object('id', current_class.id, 'name', current_class.name) end,
    'can_edit', editable,
    'classes', case when editable then coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by lower(c.name), c.id)
      from private.course_classes c where c.organisation_id = company_id
    ), '[]'::jsonb) else '[]'::jsonb end,
    'courses', case when manager and current_class.id is not null then coalesce((
      select jsonb_agg(to_jsonb(course) order by course.title, course.id)
      from (
        select run.id, template.title
        from private.course_class_assignments peer
        join public.course_runs run on run.id = peer.course_id
        join public.course_templates template on template.id = run.template_id
        where peer.class_id = current_class.id and peer.organisation_id = company_id
          and run.archived_at is null
        order by template.title, run.id limit 100
      ) course
    ), '[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;

create function private.set_course_class(p_course_id uuid, p_class_id uuid, p_new_name text, p_expected_version integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  internal_edition boolean := (select edition = 'internal' from private.installation_identity);
  company_id uuid;
  context jsonb;
  assignment private.course_class_assignments%rowtype;
  class_name text := btrim(p_new_name);
  target uuid := p_class_id;
begin
  if p_expected_version is null or p_expected_version < 0
     or (p_new_name is not null and (p_class_id is not null or length(class_name) not between 1 and 100
       or class_name ~ '[[:cntrl:]]')) then
    raise invalid_parameter_value;
  end if;

  if not internal_edition then perform private.lock_academy_course_access(); end if;
  select run.organisation_id into company_id
  from public.course_runs run join public.organisations organisation on organisation.id = run.organisation_id
  where run.id = p_course_id and run.archived_at is null and organisation.archived_at is null
  for update of run for share of organisation;
  if not found then raise insufficient_privilege; end if;
  if internal_edition then perform private.lock_company_premium(company_id); end if;

  perform 1 from public.profiles where id = actor and active for share;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.user_roles where user_id = actor order by role for share;
  perform 1 from public.client_organisation_memberships
  where user_id = actor and organisation_id = company_id and removed_at is null for share;
  context := private.course_workspace_context(p_course_id);
  if not ((context->>'manager')::boolean or (context->>'client')::boolean) then
    raise insufficient_privilege;
  end if;

  select * into assignment from private.course_class_assignments where course_id = p_course_id;
  if p_class_id is not null and not exists (
    select 1 from private.course_classes where id = p_class_id and organisation_id = company_id
  ) then raise insufficient_privilege; end if;

  if class_name is not null then
    -- Serialize creation across several runs of one organisation so the
    -- size bound and case-insensitive class uniqueness stay authoritative.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('course-class:' || company_id::text, 0));
    select c.id into target from private.course_classes c
    where c.organisation_id = company_id and lower(c.name) = lower(class_name);
  end if;
  if (class_name is null or target is not null) and target is not distinct from assignment.class_id then
    return private.course_class_options(p_course_id);
  end if;
  if coalesce(assignment.version, 0) <> p_expected_version then
    raise exception 'Course class changed' using errcode = 'PT409';
  end if;
  if class_name is not null and target is null then
    if (select count(*) from private.course_classes where organisation_id = company_id) >= 100 then
      raise exception 'Class limit reached' using errcode = 'PT409';
    end if;
    insert into private.course_classes(organisation_id, name)
    values (company_id, class_name) returning id into target;
  end if;

  insert into private.course_class_assignments(course_id, organisation_id, class_id, version)
  values (p_course_id, company_id, target, coalesce(assignment.version, 0) + 1)
  on conflict (course_id) do update
    set class_id = excluded.class_id, version = excluded.version;
  insert into public.audit_events(actor_id, action, resource_id, details)
  values (actor, 'course.class.changed', p_course_id,
    jsonb_build_object('previous_class_id', assignment.class_id, 'class_id', target));
  return private.course_class_options(p_course_id);
end;
$$;

create function public.course_class_options(p_course_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.course_class_options(p_course_id);
$$;
create function public.set_course_class(p_course_id uuid, p_class_id uuid, p_new_name text, p_expected_version integer)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.set_course_class(p_course_id, p_class_id, p_new_name, p_expected_version);
$$;
revoke all on function private.course_class_options(uuid), public.course_class_options(uuid),
  private.set_course_class(uuid,uuid,text,integer), public.set_course_class(uuid,uuid,text,integer)
  from public, anon, authenticated, service_role;
grant execute on function private.course_class_options(uuid), public.course_class_options(uuid),
  private.set_course_class(uuid,uuid,text,integer), public.set_course_class(uuid,uuid,text,integer)
  to authenticated;

do $$
declare
  definition text := pg_catalog.pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  internal_gate text := pg_catalog.pg_get_functiondef('private.require_portal_access()'::regprocedure);
  anchor constant text := '  licence_status := private.academy_course_access_status();';
  internal_anchor constant text := '  perform private.require_portal_access_before_course_withdrawal();';
begin
  if cardinality(string_to_array(definition, anchor)) <> 2
     or cardinality(string_to_array(internal_gate, internal_anchor)) <> 2 then
    raise exception 'Expected one dedicated and internal course gate';
  end if;
  execute replace(definition, anchor, anchor || chr(10) ||
    '  if request_method = ''POST'' and ((licence_status in (''active'', ''grace'') and request_path = ''/rpc/course_class_options'')' || chr(10) ||
    '      or (licence_status = ''active'' and request_path = ''/rpc/set_course_class'')) then return; end if;');
  execute replace(internal_gate, internal_anchor,
    '  if current_setting(''role'', true) = ''authenticated'' and current_setting(''request.method'', true) = ''POST''' || chr(10) ||
    '     and current_setting(''request.path'', true) = ''/rpc/course_class_options'' and private.participant_actor() then return; end if;' || chr(10) ||
    internal_anchor);
end;
$$;

notify pgrst, 'reload schema';
commit;
