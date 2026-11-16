begin;

-- Company deletion authority is derived from current relational ownership. A
-- request, commission offer and course run may each record an organisation; all
-- present links must agree. Names, creator IDs and old lecturer claims never
-- grant company deletion rights. The permanent-deletion framework owns locking,
-- dependency preview, irreversible confirmation and physical cleanup.
create or replace function private.deletion_can_manage_job(p_job_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  with ownership as (
    select r.organisation_id from private.client_course_requests r where r.job_id=p_job_id
    union all
    select o.organisation_id from private.job_commission_offers o where o.job_id=p_job_id
    union all
    select r.organisation_id from public.jobs j join public.course_runs r on r.id=j.course_run_id
      where j.id=p_job_id and r.organisation_id is not null
  ), owner as (
    select min(organisation_id::text)::uuid organisation_id from ownership
      having count(distinct organisation_id)=1
  )
  select private.actor_active() and exists(select 1 from public.jobs where id=p_job_id)
    and exists(select 1 from owner where private.client_has_organisation(organisation_id));
$$;
revoke execute on function private.deletion_can_manage_job(uuid) from public,anon,authenticated,service_role;

-- This company-only selector reveals the deletion target and organisation label,
-- never job prices, accepted lecturer terms, claim details or private documents.
-- can_delete is current actor authority to request the framework preview; the
-- preview remains authoritative about accepted/invoiced/shared dependencies.
create function private.company_jobs_for_deletion()
returns table(id uuid,title text,organisation_id uuid,organisation_name text,can_delete boolean)
language sql stable security definer set search_path='' as $$
  select j.id,j.title,owned.organisation_id,o.name,private.deletion_authorized('job',j.id)
  from public.jobs j
  cross join lateral (
    select min(link.organisation_id::text)::uuid organisation_id from (
      select r.organisation_id from private.client_course_requests r where r.job_id=j.id
      union all select fee.organisation_id from private.job_commission_offers fee where fee.job_id=j.id
      union all select run.organisation_id from public.course_runs run where run.id=j.course_run_id and run.organisation_id is not null
    ) link having count(distinct link.organisation_id)=1
  ) owned
  join public.organisations o on o.id=owned.organisation_id
  where private.deletion_can_manage_job(j.id)
  order by j.created_at desc,j.id limit 500;
$$;
create function public.company_jobs_for_deletion()
returns table(id uuid,title text,organisation_id uuid,organisation_name text,can_delete boolean)
language sql stable security invoker set search_path='' as $$
  select * from private.company_jobs_for_deletion();
$$;
revoke execute on function private.company_jobs_for_deletion(),public.company_jobs_for_deletion() from public,anon;
grant execute on function private.company_jobs_for_deletion(),public.company_jobs_for_deletion() to authenticated;

-- A current company account must not inherit another organisation's staff job
-- projection merely because the person used to hold a lecturer role. Current
-- lecturers retain their own accepted/cancelled assignment history, while actual
-- job managers retain the existing current-role/MFA management authority.
create or replace function private.can_read_job(p_job_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select private.actor_active() and exists(
    select 1 from public.jobs j where j.id=p_job_id and (
      private.has_permission('jobs.manage')
      or (private.lecturer_actor() and (j.status='published'
        or exists(select 1 from public.job_claims c where c.job_id=j.id and c.lecturer_id=auth.uid())))
    )
  );
$$;

-- Keep the existing quote projection; centralize its resource access decision so
-- legacy net prices cannot escape through the historical-claim branch.
create or replace function private.job_offers() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not private.actor_active() then raise exception 'Active login required' using errcode='42501';end if;
 select coalesce(jsonb_agg(to_jsonb(j)||jsonb_build_object(
  'amount',case when o.pricing_mode='role_split' then case when private.lecturer_actor() then private.role_net(o.gross_amount,auth.uid(),j.id) end else j.amount end,
  'total_amount',case when o.pricing_mode='role_split' then case when private.lecturer_actor() then private.role_net(o.gross_total_amount,auth.uid(),j.id) end else j.total_amount end,
  'terms_version',case when o.pricing_mode='role_split' and private.lecturer_actor() then private.role_quote_version(j.terms_version,auth.uid()) else j.terms_version end,
  'job_sessions',coalesce((select jsonb_agg(s order by s.starts_at) from public.job_sessions s where s.job_id=j.id),'[]'::jsonb),
  'job_requirements',coalesce((select jsonb_agg(jsonb_build_object('topic_id',r.topic_id)) from public.job_requirements r where r.job_id=j.id),'[]'::jsonb)) order by j.created_at desc,j.id),'[]'::jsonb) into result
 from public.jobs j left join private.job_commission_offers o on o.job_id=j.id
 where private.can_read_job(j.id);
 return result;
end;$$;

-- Preserve the latest captured senior-cost bound, budget redaction and accepted
-- lifecycle payloads. Only the current-role resource access gate changes.
create or replace function private.job_lifecycle(p_job_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare j public.jobs; manager boolean:=private.has_permission('jobs.manage');
begin
 if not private.actor_active() then raise exception 'Authentication required' using errcode='42501';end if;
 select * into j from public.jobs where id=p_job_id;
 if j.id is null or not private.can_read_job(j.id) then raise exception 'Job access denied' using errcode='42501';end if;
 return jsonb_build_object('version',j.lifecycle_version,'capacity',j.capacity,'capacity_basis',j.capacity_basis,'confirmed_count',(select count(*) from public.job_claims where job_id=j.id and status='confirmed'),'open_positions',case when j.status='published' then j.capacity-(select count(*) from public.job_claims where job_id=j.id and status='confirmed') else 0 end,'can_set_capacity',manager and j.capacity_basis='per_position' and not exists(select 1 from public.job_claims where job_id=j.id),'gross_budget',case when private.has_permission('finance.gross.read') then (select gross_total_amount*j.capacity from private.job_commission_offers where job_id=j.id) end,'max_net_budget',case when exists(select 1 from private.job_commission_offers where job_id=j.id and pricing_mode='role_split') then case when private.has_permission('finance.gross.read') then (select round(gross_total_amount*senior_percent/100,2)*j.capacity from private.job_commission_offers where job_id=j.id) end else j.total_amount*j.capacity end,'can_manage',manager,'can_edit',manager and not exists(select 1 from public.job_claims c where c.job_id=j.id),
 'can_duplicate',manager and private.has_permission('courses.manage') and not exists(select 1 from public.job_sessions where job_id=j.id and starts_at<=now()) and (not exists(select 1 from private.job_commission_offers o where o.job_id=j.id) or private.has_permission('finance.gross.read')),
 'claims',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'lecturer_id',c.lecturer_id,'lecturer_name',p.display_name,'status',c.status,'created_at',c.created_at,
 'can_cancel',c.status='confirmed' and not exists(select 1 from public.invoice_items i where i.claim_id=c.id) and (select min(s.starts_at) from public.assignment_sessions s where s.claim_id=c.id)>now(),
 'sessions',(select jsonb_agg(jsonb_build_object('starts_at',s.starts_at,'ends_at',s.ends_at,'released_at',s.released_at) order by s.starts_at) from public.assignment_sessions s where s.claim_id=c.id),
 'events',(select jsonb_agg(jsonb_build_object('type',e.event_type,'created_at',e.created_at,'reason',case when e.event_type='cancelled' then a.details->>'reason' end) order by e.created_at,e.id) from public.claim_events e left join public.audit_events a on a.resource_id=c.id and a.action='claim.cancelled' where e.claim_id=c.id)) order by c.created_at desc,c.id)
 from public.job_claims c join public.profiles p on p.id=c.lecturer_id where c.job_id=j.id and (manager or c.lecturer_id=auth.uid())),'[]'::jsonb));
end;$$;

-- Preserve qualification-specific evidence rules and personal/room document ACLs.
-- Only current lecturers inherit job attachment access from a confirmed claim.
create or replace function private.can_access_document(p_id uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
declare d public.documents;
begin
 if not private.actor_active() then return false;end if;
 if private.deletion_document_fenced(p_id) then return false;end if;
 select * into d from public.documents where id=p_id and deleted_at is null;if not found then return false;end if;
 if d.scope='room' then return private.can_access_chat_room(d.room_id);end if;
 if d.scope='personal' then return d.owner_id=auth.uid()
  or(d.kind='cv' and private.has_permission('users.manage'))
  or(d.kind='contract' and private.has_permission('contracts.read'))
  or(d.kind='invoice' and private.has_permission('finance.manage'));end if;
 if private.has_permission('jobs.manage') then return true;end if;
 if private.lecturer_actor() and exists(select 1 from public.job_claims c where c.job_id=d.job_id and c.lecturer_id=auth.uid() and c.status='confirmed') then return true;end if;
 return d.scope='job_before' and private.lecturer_actor() and exists(select 1 from public.jobs j where j.id=d.job_id and j.status='published');
end;$$;

revoke execute on function private.can_read_job(uuid),private.job_offers(),private.job_lifecycle(uuid) from public,anon;
grant execute on function private.can_read_job(uuid),private.job_offers(),private.job_lifecycle(uuid) to authenticated;
commit;
