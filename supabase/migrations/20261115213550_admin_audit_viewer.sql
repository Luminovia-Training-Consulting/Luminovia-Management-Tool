begin;

-- A separate, reduced read capability does not widen the original table RLS.
insert into public.role_permissions(role,permission) values('owner','audit.read'),('admin','audit.read') on conflict do nothing;

-- The cursor always orders by BOTH columns: timestamps are not unique. This
-- also bounds ordinary last-30-day reads without an all-history table scan.
create index audit_events_time_cursor on public.audit_events(created_at desc,id desc);

-- Exact known administrative/business actions only. New producers stay hidden
-- until reviewed here; private profile/calendar/chat/document/commercial files
-- are deliberately excluded, and details JSON is never selected or searched.
create function private.admin_audit_actions() returns text[] language sql immutable set search_path='' as $$
 select array[
  'account.roles_changed','user.activated','user.deactivated',
  'invitation.reserved','invitation.sent','invitation.failed','qualification.attested',
  'client.membership_added','client.membership_removed','client.request_submitted','client.request_published','client.request_cancelled',
  'organisation.saved','organisation.contact.saved',
  'course.template.saved','course.template.duplicated','course.run.saved','course.run.duplicated','course.visibility.changed','course.run_offer_created','course.enrolment.changed',
  'job.created.draft','job.created.published','job.created.archived','job.status.draft','job.status.published','job.status.archived',
  'job.commission_configured','job.lifecycle.draft','job.lifecycle.published','job.lifecycle.archived','job.lifecycle.reopen','job.lifecycle.edit','job.lifecycle.duplicate',
  'job.capacity_created','job.capacity_changed','claim.cancelled',
  'taxonomy.created','taxonomy.updated','taxonomy.archived','taxonomy.restored'
 ]::text[];
$$;

create function private.admin_audit_events(p_from timestamptz default null,p_to timestamptz default null,
 p_action text default '',p_search text default '',p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 40)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare range_to timestamptz:=coalesce(p_to,now());range_from timestamptz;rows jsonb;more boolean;cursor jsonb;
begin
 if not private.has_permission('audit.read') then raise exception 'audit.read and verified MFA required' using errcode='42501';end if;
 range_from:=coalesce(p_from,range_to-interval '30 days');
 if not isfinite(range_from) or not isfinite(range_to) or range_from>=range_to
  or range_to-range_from>interval '93 days 2 hours'
  or p_action is null or (p_action<>'' and not(p_action=any(private.admin_audit_actions())))
  or p_search is null or length(p_search)>160
  or p_limit is null or p_limit not between 1 and 100
  or ((p_before_at is null)<>(p_before_id is null))
  or (p_before_at is not null and (not isfinite(p_before_at) or p_before_at<range_from or p_before_at>=range_to)) then
  raise exception 'Invalid audit range, filter or cursor' using errcode='22023';
 end if;
 with page as materialized(
  select e.id,p.display_name actor_name,e.action,e.resource_id,e.created_at
  from public.audit_events e join public.profiles p on p.id=e.actor_id
  where e.created_at>=range_from and e.created_at<range_to
   and e.action=any(private.admin_audit_actions())
   and (p_action='' or e.action=p_action)
   and (p_search='' or strpos(lower(e.action),lower(p_search))>0 or strpos(lower(p.display_name),lower(p_search))>0 or strpos(coalesce(e.resource_id::text,''),lower(p_search))>0)
   and (p_before_at is null or (e.created_at,e.id)<(p_before_at,p_before_id))
  order by e.created_at desc,e.id desc limit p_limit+1
 ),visible as(
  select * from page order by created_at desc,id desc limit p_limit
 )select coalesce((select jsonb_agg(to_jsonb(v) order by v.created_at desc,v.id desc) from visible v),'[]'::jsonb),
  (select count(*)>p_limit from page),
  (select jsonb_build_object('at',v.created_at,'id',v.id) from visible v order by v.created_at,v.id limit 1)
 into rows,more,cursor;
 return jsonb_build_object('items',rows,'has_more',more,'next_cursor',case when more then cursor else null end,
  'from',range_from,'to',range_to,'actions',private.admin_audit_actions());
end;$$;
create function public.admin_audit_events(p_from timestamptz default null,p_to timestamptz default null,
 p_action text default '',p_search text default '',p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 40)
returns jsonb language sql stable security invoker set search_path='' as $$
 select private.admin_audit_events(p_from,p_to,p_action,p_search,p_before_at,p_before_id,p_limit);
$$;
revoke all on function private.admin_audit_actions() from public,anon,authenticated;
revoke all on function private.admin_audit_events(timestamptz,timestamptz,text,text,timestamptz,uuid,integer),public.admin_audit_events(timestamptz,timestamptz,text,text,timestamptz,uuid,integer) from public,anon;
grant execute on function private.admin_audit_events(timestamptz,timestamptz,text,text,timestamptz,uuid,integer),public.admin_audit_events(timestamptz,timestamptz,text,text,timestamptz,uuid,integer) to authenticated;
commit;
