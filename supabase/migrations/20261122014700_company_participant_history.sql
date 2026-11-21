begin;

-- Keep the historical organisation at the point where the action happened.
-- An unaccepted invitation or withdrawal must not disclose account existence.
create table private.company_participant_activity (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  kind text not null check (kind in ('association_removed', 'course_enrolment_changed')),
  occurred_at timestamptz not null
);
alter table private.company_participant_activity enable row level security;
revoke all on private.company_participant_activity from public, anon, authenticated, service_role;

-- A retained removal with a previous join records a consented membership.
-- An old enrolment audit has no historic company scope and cannot be backfilled.
insert into private.company_participant_activity(organisation_id, kind, occurred_at)
select membership.organisation_id, 'association_removed', membership.removed_at
from private.company_participant_memberships membership
where membership.status = 'removed' and membership.joined_at is not null
  and (select edition from private.installation_identity) = 'internal';

create index company_participant_activity_cursor
  on private.company_participant_activity(organisation_id, occurred_at desc, id desc);
create index company_participant_link_history_cursor
  on private.company_participant_link_requests(organisation_id, created_at desc, id desc);
create index company_participant_invite_history_cursor
  on private.company_participant_invitation_dispatches(organisation_id, created_at desc, id desc);
create index company_participant_audit_history_cursor
  on public.audit_events(resource_id, created_at desc, id desc)
  where action in ('company.participant_link_accepted', 'company.participant_reference_changed');

create function private.capture_company_participant_activity()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  company_id uuid;
begin
  if (select edition from private.installation_identity) is distinct from 'internal' then
    return null;
  end if;

  if tg_table_name = 'company_participant_memberships' then
    insert into private.company_participant_activity(organisation_id, kind, occurred_at)
    values (new.organisation_id, 'association_removed', new.removed_at);
  else
    if tg_op = 'UPDATE' and new.status is not distinct from old.status then
      return null;
    end if;
    select organisation_id into company_id from public.course_runs where id = new.course_run_id;
    if company_id is not null and private.active_company_participant(new.user_id, company_id) then
      insert into private.company_participant_activity(organisation_id, kind, occurred_at)
      values (company_id, 'course_enrolment_changed', clock_timestamp());
    end if;
  end if;
  return null;
end;
$$;
revoke all on function private.capture_company_participant_activity()
from public, anon, authenticated, service_role;

create trigger capture_consented_company_participant_removal
  after update of status on private.company_participant_memberships
  for each row when (old.status = 'active' and new.status = 'removed')
  execute function private.capture_company_participant_activity();
create trigger capture_company_participant_enrolment_change
  after insert or update of status on public.course_enrolments
  for each row execute function private.capture_company_participant_activity();

create function private.company_participant_history(
  p_organisation_id uuid, p_before_at timestamptz, p_before_id uuid, p_limit integer
)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_internal_company_participant_manager(p_organisation_id);
  if not private.company_premium_enabled(p_organisation_id) then
    raise exception 'Company Premium LMS is OFF' using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 100
    or (p_before_at is null) <> (p_before_id is null)
    or (p_before_at is not null and not isfinite(p_before_at)) then
    raise exception 'Invalid company participant history page' using errcode = '22023';
  end if;

  return (
    with recent as (
      (
        -- Do not consult the dispatch's outcome, email, name or target.
        select dispatch.id, 'email_invite_requested'::text as kind, dispatch.created_at as occurred_at
        from private.company_participant_invitation_dispatches dispatch
        where dispatch.organisation_id = p_organisation_id
          and (p_before_at is null or (dispatch.created_at, dispatch.id) < (p_before_at, p_before_id))
        order by dispatch.created_at desc, dispatch.id desc limit p_limit + 1
      )
      union all
      (
        -- Existing, missing and ineligible targets produce identical submission entries.
        select request.id, 'user_id_link_requested', request.created_at
        from private.company_participant_link_requests request
        where request.organisation_id = p_organisation_id
          and (p_before_at is null or (request.created_at, request.id) < (p_before_at, p_before_id))
        order by request.created_at desc, request.id desc limit p_limit + 1
      )
      union all
      (
        select receipt.id, case receipt.action when 'company.participant_link_accepted'
            then 'association_confirmed' else 'reference_changed' end, receipt.created_at
        from public.audit_events receipt
        where receipt.resource_id = p_organisation_id
          and receipt.action in ('company.participant_link_accepted', 'company.participant_reference_changed')
          and (p_before_at is null or (receipt.created_at, receipt.id) < (p_before_at, p_before_id))
        order by receipt.created_at desc, receipt.id desc limit p_limit + 1
      )
      union all
      (
        select activity.id, activity.kind, activity.occurred_at
        from private.company_participant_activity activity
        where activity.organisation_id = p_organisation_id
          and (p_before_at is null or (activity.occurred_at, activity.id) < (p_before_at, p_before_id))
        order by activity.occurred_at desc, activity.id desc limit p_limit + 1
      )
    ), requested as materialized (
      select * from recent order by occurred_at desc, id desc limit p_limit + 1
    )
    select jsonb_build_object(
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', item.id, 'kind', item.kind, 'occurred_at', item.occurred_at
        ) order by item.occurred_at desc, item.id desc)
        from (select * from requested order by occurred_at desc, id desc limit p_limit) item
      ), '[]'::jsonb),
      'has_more', (select count(*) from requested) > p_limit
    )
  );
end;
$$;

create function public.company_participant_history(
  p_organisation_id uuid, p_before_at timestamptz default null,
  p_before_id uuid default null, p_limit integer default 25
)
returns jsonb language sql stable security invoker set search_path = ''
as $$
  select private.company_participant_history(p_organisation_id, p_before_at, p_before_id, p_limit);
$$;

revoke all on function private.company_participant_history(uuid, timestamptz, uuid, integer),
  public.company_participant_history(uuid, timestamptz, uuid, integer)
from public, anon, authenticated, service_role;
grant execute on function private.company_participant_history(uuid, timestamptz, uuid, integer),
  public.company_participant_history(uuid, timestamptz, uuid, integer) to authenticated;

notify pgrst, 'reload schema';
commit;
