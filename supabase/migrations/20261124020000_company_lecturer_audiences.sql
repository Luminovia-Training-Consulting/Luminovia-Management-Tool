begin;

create table private.company_lecturers (
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  lecturer_id uuid not null references public.profiles(id) on delete cascade,
  primary key (organisation_id, lecturer_id)
);
alter table private.company_lecturers enable row level security;
revoke all on private.company_lecturers from public, anon, authenticated, service_role;
create index company_lecturers_by_lecturer on private.company_lecturers(lecturer_id);
create trigger permanent_deletion_fence before insert or update or delete on private.company_lecturers
for each row execute function private.guard_permanent_deletion();

alter table public.course_runs add column own_lecturers_only boolean not null default false;
alter table public.course_runs add constraint own_lecturer_course_requires_company
  check (not own_lecturers_only or organisation_id is not null);
create index company_only_course_runs on public.course_runs(id)
  include (organisation_id) where own_lecturers_only;

create function private.active_company_lecturers(p_organisation_id uuid)
returns table(id uuid, display_name text)
language sql stable security definer set search_path = ''
as $$
  select profile.id, profile.display_name
  from private.company_lecturers linked
  join public.profiles profile on profile.id = linked.lecturer_id and profile.active
  where linked.organisation_id = p_organisation_id and exists (
    select 1 from public.user_roles role
    where role.user_id = profile.id and role.role in ('lecturer','senior_lecturer')
  );
$$;

create function private.company_lecturer_roster(p_organisation_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare staff boolean := private.has_permission('organisations.manage');
begin
  if (select edition from private.installation_identity) is distinct from 'internal'
     or not private.actor_active()
     or not (staff or private.client_has_organisation(p_organisation_id))
     or not exists (select 1 from public.organisations where id = p_organisation_id and archived_at is null)
  then raise exception 'Organisation access required' using errcode = '42501'; end if;

  return jsonb_build_object(
    'members', coalesce((
      select jsonb_agg(to_jsonb(member) order by member.display_name, member.id)
      from private.active_company_lecturers(p_organisation_id) member
    ), '[]'::jsonb),
    'candidates', case when staff then coalesce((
      select jsonb_agg(jsonb_build_object('id', profile.id, 'display_name', profile.display_name)
        order by profile.display_name, profile.id)
      from public.profiles profile
      where profile.active and exists (
        select 1 from public.user_roles role where role.user_id = profile.id
          and role.role in ('lecturer','senior_lecturer')
      ) and not exists (
        select 1 from private.company_lecturers linked
        where linked.organisation_id = p_organisation_id and linked.lecturer_id = profile.id
      )
    ), '[]'::jsonb) else '[]'::jsonb end,
    'can_add', staff
  );
end;
$$;

create function private.set_company_lecturer(p_organisation_id uuid, p_lecturer_id uuid, p_remove boolean)
returns void language plpgsql security definer set search_path = ''
as $$
declare staff boolean := private.has_permission('organisations.manage');
begin
  if (select edition from private.installation_identity) is distinct from 'internal'
     or not private.actor_active()
     or p_organisation_id is null or p_lecturer_id is null or p_remove is null
     or not (staff or (p_remove and private.client_has_organisation(p_organisation_id)))
  then raise exception 'Organisation access required' using errcode = '42501'; end if;

  perform 1 from public.profiles where id in (auth.uid(), p_lecturer_id) order by id for share;
  perform 1 from public.user_roles where user_id in (auth.uid(), p_lecturer_id) order by user_id, role for share;
  perform 1 from public.client_organisation_memberships
    where user_id=auth.uid() and organisation_id=p_organisation_id for share;
  perform 1 from public.organisations where id=p_organisation_id and archived_at is null for no key update;
  if not found then raise exception 'Organisation unavailable' using errcode = '22023'; end if;
  -- The existing claim trigger takes this same lock before accepting.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_lecturer_id::text, 0));
  if not (private.has_permission('organisations.manage')
    or (p_remove and private.client_has_organisation(p_organisation_id)))
  then raise exception 'Organisation access required' using errcode = '42501'; end if;
  if p_remove then
    delete from private.company_lecturers where organisation_id=p_organisation_id and lecturer_id=p_lecturer_id;
  else
    if not exists (
      select 1 from public.profiles profile join public.user_roles role on role.user_id=profile.id
      where profile.id=p_lecturer_id and profile.active and role.role in ('lecturer','senior_lecturer')
    ) then raise exception 'Active lecturer required' using errcode = '22023'; end if;
    insert into private.company_lecturers(organisation_id,lecturer_id)
      values(p_organisation_id,p_lecturer_id) on conflict do nothing;
  end if;
  if found then
    insert into public.audit_events(actor_id,action,resource_id,details)
      values(auth.uid(),case when p_remove then 'company.lecturer_removed' else 'company.lecturer_added' end,
        p_organisation_id,jsonb_build_object('lecturer_id',p_lecturer_id));
  end if;
end;
$$;

create function public.company_lecturer_roster(p_organisation_id uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.company_lecturer_roster(p_organisation_id); $$;

create function public.set_company_lecturer(p_organisation_id uuid, p_lecturer_id uuid, p_remove boolean)
returns void language sql security invoker set search_path = ''
as $$ select private.set_company_lecturer(p_organisation_id, p_lecturer_id, p_remove); $$;

revoke all on function private.active_company_lecturers(uuid),
  private.company_lecturer_roster(uuid), private.set_company_lecturer(uuid,uuid,boolean),
  public.company_lecturer_roster(uuid), public.set_company_lecturer(uuid,uuid,boolean)
  from public, anon, authenticated, service_role;
grant execute on function private.company_lecturer_roster(uuid),
  private.set_company_lecturer(uuid,uuid,boolean), public.company_lecturer_roster(uuid),
  public.set_company_lecturer(uuid,uuid,boolean) to authenticated;

-- The common guard already fences marketplace, quote, claim, assignment,
-- material and notification paths. A confirmed assignment remains accessible
-- after roster removal, but membership is required for offers and new claims.
alter function private.job_lecturer_blocked(uuid, uuid)
  rename to job_lecturer_blocked_before_company_audience;
create function private.job_lecturer_blocked(p_job_id uuid, p_lecturer_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.jobs job
    join public.course_runs run on run.id = job.course_run_id and run.own_lecturers_only
    where job.id = p_job_id and not exists (
      select 1 from private.active_company_lecturers(run.organisation_id) lecturer
      where lecturer.id = p_lecturer_id
    ) and not exists (
      select 1 from public.job_claims accepted where accepted.job_id = p_job_id
        and accepted.lecturer_id = p_lecturer_id and accepted.status = 'confirmed'
    )
  ) or private.job_lecturer_blocked_before_company_audience(p_job_id, p_lecturer_id);
$$;
revoke all on function private.job_lecturer_blocked(uuid,uuid),
  private.job_lecturer_blocked_before_company_audience(uuid,uuid)
  from public, anon, authenticated, service_role;

do $migration$
declare rule record; definition text;
begin
  for rule in select * from (values
    ('private.create_client_request_record(uuid,jsonb,uuid)',
      $old$'gross_total_amount','currency','rate_unit')$old$,
      $new$'gross_total_amount','currency','rate_unit','own_lecturers_only')$new$),
    ('private.create_client_request_record(uuid,jsonb,uuid)',
      $old$ perform pg_catalog.pg_advisory_xact_lock$old$,
      $new$ if p_payload ? 'own_lecturers_only' then
        if jsonb_typeof(p_payload->'own_lecturers_only') is distinct from 'boolean' then
          raise exception 'Invalid lecturer audience' using errcode='22023';
        end if;
        if p_payload->'own_lecturers_only' = 'true'::jsonb then
          normalized := normalized || jsonb_build_object('own_lecturers_only', true);
        end if;
      end if;
      perform pg_catalog.pg_advisory_xact_lock$new$),
    ('private.create_client_request_record(uuid,jsonb,uuid)',
      $old$ insert into private.client_course_requests(organisation_id,$old$,
      $new$ if normalized ? 'own_lecturers_only'
        and not exists (select 1 from private.active_company_lecturers(p_organisation_id))
      then raise exception 'Active company lecturers required' using errcode='22023'; end if;
      insert into private.client_course_requests(organisation_id,$new$),
    ('private.publish_client_request(uuid,numeric,text,boolean,timestamptz)',
      $old$ insert into public.course_runs(template_id,organisation_id,time_zone,delivery_type,venue,published) values(template,org.id,r.payload->>'time_zone',r.payload->>'delivery_type',r.payload->>'location',true)$old$,
      $new$ if r.payload ? 'own_lecturers_only'
        and not exists (select 1 from private.active_company_lecturers(org.id))
      then raise exception 'Active company lecturers required' using errcode='22023'; end if;
      insert into public.course_runs(template_id,organisation_id,time_zone,delivery_type,venue,published,own_lecturers_only)
        values(template,org.id,r.payload->>'time_zone',r.payload->>'delivery_type',r.payload->>'location',true,r.payload ? 'own_lecturers_only')$new$)
  ) as rules(signature, before, after)
  loop
    definition := pg_get_functiondef(rule.signature::regprocedure);
    if cardinality(string_to_array(definition, rule.before)) <> 2 then
      raise exception 'Expected one lecturer audience update point in %', rule.signature;
    end if;
    execute replace(definition, rule.before, rule.after);
  end loop;
end;
$migration$;

commit;
