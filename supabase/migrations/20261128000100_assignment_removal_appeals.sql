begin;

create table private.assignment_removal_appeals (
  claim_id uuid primary key references public.job_claims(id) on delete cascade,
  removal_event_id uuid not null,
  reason text not null check (length(reason) between 5 and 1000),
  created_at timestamptz not null default clock_timestamp(),
  decision boolean,
  decision_reason text check (length(decision_reason) between 5 and 1000),
  reviewed_at timestamptz,
  reviewed_by uuid,
  check ((decision is null) = (decision_reason is null)
     and (decision is null) = (reviewed_at is null)
     and (decision is null) = (reviewed_by is null))
);
alter table private.assignment_removal_appeals enable row level security;
revoke all on private.assignment_removal_appeals from public, anon, authenticated, service_role;
create index assignment_removal_appeals_pending on private.assignment_removal_appeals(created_at, claim_id)
  where decision is null;

create index claim_cancellation_audit_resource on public.audit_events(resource_id, created_at desc, id desc)
  where action = 'claim.cancelled';

create function private.submit_assignment_removal_appeal(p_claim_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  reason text := btrim(coalesce(p_reason, ''));
  removal uuid;
  removed_by uuid;
  prior private.assignment_removal_appeals%rowtype;
begin
  if not private.actor_active() or not private.lecturer_actor() then raise insufficient_privilege; end if;
  if length(reason) not between 5 and 1000 then raise invalid_parameter_value; end if;
  perform 1 from public.job_claims
    where id = p_claim_id and lecturer_id = actor and status = 'cancelled' for update;
  if not found then raise insufficient_privilege; end if;

  select event.id, event.actor_id into removal, removed_by from public.audit_events event
  where event.resource_id = p_claim_id and event.action = 'claim.cancelled'
    and nullif(btrim(event.details->>'reason'), '') is not null
  order by event.created_at desc, event.id desc limit 1;
  if removal is null or removed_by is null or removed_by = actor then raise insufficient_privilege; end if;

  select * into prior from private.assignment_removal_appeals where claim_id = p_claim_id;
  if found then
    if prior.removal_event_id = removal and prior.reason = reason then return; end if;
    raise exception 'An appeal already exists' using errcode = 'PT409';
  end if;
  insert into private.assignment_removal_appeals(claim_id, removal_event_id, reason)
    values (p_claim_id, removal, reason);
  insert into public.notifications(user_id, kind, resource_id)
    select distinct profile.id, 'course_assignment_removal_appeal', p_claim_id
    from public.profiles profile
    join public.user_roles role on role.user_id = profile.id
    join public.role_permissions permission on permission.role = role.role
    where profile.active and profile.id <> actor and permission.permission = 'jobs.manage'
    on conflict do nothing;
end;
$$;

create function private.assignment_removal_appeals(p_pending boolean, p_before_at timestamptz, p_before_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_permission('jobs.manage') then raise insufficient_privilege; end if;
  if p_pending is null or (p_before_at is null) <> (p_before_id is null) then raise invalid_parameter_value; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(item) order by item.created_at desc, item.claim_id desc)
    from (
      select appeal.claim_id, claim.job_id, job.title, profile.display_name,
        event.details->>'reason' as removal_reason, appeal.reason, appeal.created_at,
        appeal.decision, appeal.decision_reason
      from private.assignment_removal_appeals appeal
      join public.job_claims claim on claim.id = appeal.claim_id
      join public.jobs job on job.id = claim.job_id
      join public.profiles profile on profile.id = claim.lecturer_id
      left join public.audit_events event on event.id = appeal.removal_event_id
      where (appeal.decision is null) = p_pending
        and (p_before_at is null or (appeal.created_at, appeal.claim_id) < (p_before_at, p_before_id))
      order by appeal.created_at desc, appeal.claim_id desc
      limit 30
    ) item
  ), '[]'::jsonb);
end;
$$;

create function private.review_assignment_removal_appeal(p_claim_id uuid, p_approve boolean, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  explanation text := btrim(coalesce(p_reason, ''));
  lecturer uuid;
  prior private.assignment_removal_appeals%rowtype;
begin
  if not private.has_permission('jobs.manage') then raise insufficient_privilege; end if;
  if p_approve is null or length(explanation) not between 5 and 1000 then raise invalid_parameter_value; end if;
  select lecturer_id into lecturer from public.job_claims where id = p_claim_id for update;
  if lecturer is null or lecturer = actor then raise insufficient_privilege; end if;

  select * into prior from private.assignment_removal_appeals where claim_id = p_claim_id for update;
  if not found then raise no_data_found; end if;
  if prior.decision is not null then
    if prior.decision = p_approve and prior.decision_reason = explanation and prior.reviewed_by = actor then return; end if;
    raise exception 'This appeal has already been decided' using errcode = 'PT409';
  end if;

  -- Approval records the decision. Normal assignment checks run before any
  -- later reinstatement, including capacity and consent for a replacement.
  update private.assignment_removal_appeals
  set decision = p_approve, decision_reason = explanation, reviewed_at = clock_timestamp(), reviewed_by = actor
  where claim_id = p_claim_id;
  insert into public.audit_events(actor_id, action, resource_id, details)
    values (actor, 'assignment.removal_appeal_reviewed', p_claim_id, jsonb_build_object('approved', p_approve));
  insert into public.notifications(user_id, kind, resource_id)
    values (lecturer, 'claim_cancelled', p_claim_id) on conflict do nothing;
  update public.notifications set read_at = null, created_at = clock_timestamp()
  where user_id = lecturer and kind = 'claim_cancelled' and resource_id = p_claim_id;
end;
$$;

create function public.submit_assignment_removal_appeal(p_claim_id uuid, p_reason text)
returns void language sql security invoker set search_path = '' as $$
  select private.submit_assignment_removal_appeal(p_claim_id, p_reason);
$$;
create function public.assignment_removal_appeals(p_pending boolean, p_before_at timestamptz default null, p_before_id uuid default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.assignment_removal_appeals(p_pending, p_before_at, p_before_id);
$$;
create function public.review_assignment_removal_appeal(p_claim_id uuid, p_approve boolean, p_reason text)
returns void language sql security invoker set search_path = '' as $$
  select private.review_assignment_removal_appeal(p_claim_id, p_approve, p_reason);
$$;

revoke all on function private.submit_assignment_removal_appeal(uuid,text),
  private.assignment_removal_appeals(boolean,timestamptz,uuid),
  private.review_assignment_removal_appeal(uuid,boolean,text),
  public.submit_assignment_removal_appeal(uuid,text),
  public.assignment_removal_appeals(boolean,timestamptz,uuid),
  public.review_assignment_removal_appeal(uuid,boolean,text)
  from public, anon, authenticated, service_role;
grant execute on function private.submit_assignment_removal_appeal(uuid,text),
  private.assignment_removal_appeals(boolean,timestamptz,uuid),
  private.review_assignment_removal_appeal(uuid,boolean,text),
  public.submit_assignment_removal_appeal(uuid,text),
  public.assignment_removal_appeals(boolean,timestamptz,uuid),
  public.review_assignment_removal_appeal(uuid,boolean,text) to authenticated;

alter function private.notification_target(text,uuid) rename to notification_target_before_removal_appeals;
create function private.notification_target(p_kind text, p_resource uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  target jsonb;
  appeal private.assignment_removal_appeals%rowtype;
begin
  if p_kind = 'course_assignment_removal_appeal' then
    if private.has_permission('jobs.manage') then
      select jsonb_build_object('href', '/admin/assignments?view=appeals', 'title', job.title)
      into target
      from private.assignment_removal_appeals request
      join public.job_claims claim on claim.id = request.claim_id
      join public.jobs job on job.id = claim.job_id
      where request.claim_id = p_resource and request.decision is null;
    end if;
    return coalesce(target, jsonb_build_object('href', null, 'title', ''));
  end if;
  target := private.notification_target_before_removal_appeals(p_kind, p_resource);
  if p_kind <> 'claim_cancelled' or target->>'assignment_removed' is distinct from 'true' then return target; end if;
  if not coalesce((
    select event.actor_id <> auth.uid() from public.audit_events event
    where event.resource_id = p_resource and event.action = 'claim.cancelled'
      and nullif(btrim(event.details->>'reason'), '') is not null
    order by event.created_at desc, event.id desc limit 1
  ), false) then return target; end if;
  select * into appeal from private.assignment_removal_appeals where claim_id = p_resource;
  return target || jsonb_strip_nulls(jsonb_build_object('appeal_claim_id', p_resource,
    'appeal_status', case when not found then 'available' when appeal.decision is null then 'pending'
      when appeal.decision then 'approved' else 'rejected' end,
    'appeal_decision_reason', appeal.decision_reason));
end;
$$;
revoke all on function private.notification_target(text,uuid) from public, anon, authenticated, service_role;

alter function private.deletion_scope(text,uuid) rename to deletion_scope_before_removal_appeals;
create function private.deletion_scope(p_kind text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  scope jsonb := private.deletion_scope_before_removal_appeals(p_kind,p_id);
  claim_selector text;
  notice_selector text;
begin
  if p_kind = 'assignment' then
    claim_selector := format('=%L::uuid',p_id);
  elsif p_kind = 'job' and private.deletion_admin(auth.uid()) then
    claim_selector := format(' in(select id from public.job_claims where job_id=%L::uuid)',p_id);
  else
    return scope;
  end if;
  scope := private.deletion_add_scope(scope, 'private.assignment_removal_appeals', 'x.claim_id' || claim_selector);
  notice_selector := 'kind=''course_assignment_removal_appeal'' and resource_id' || claim_selector;
  scope := private.deletion_add_scope(scope, 'public.notifications', notice_selector);
  scope := private.deletion_add_scope(scope, 'private.notification_email_outbox',
    'x.notification_id in(select id from public.notifications where ' || notice_selector || ')');
  return private.deletion_add_scope(scope, 'private.notification_push_outbox',
    'x.notification_id in(select id from public.notifications where ' || notice_selector || ')');
end;
$$;
revoke all on function private.deletion_scope(text,uuid) from public, anon, authenticated, service_role;
create trigger permanent_deletion_fence before insert or update or delete on private.assignment_removal_appeals
  for each row execute function private.guard_permanent_deletion();

commit;
