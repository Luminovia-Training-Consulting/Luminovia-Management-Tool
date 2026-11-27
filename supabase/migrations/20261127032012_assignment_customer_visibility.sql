-- Keep the customer identity and contact fields behind one server-clock policy.
-- The setting changes access to existing and future bookings without editing them.
begin;
create table private.assignment_customer_policy (
  singleton boolean primary key default true check (singleton),
  mode text not null default 'scheduled' check (mode in ('scheduled','on_confirmation','management_only')),
  lead_hours integer not null default 168 check (lead_hours between 0 and 8760),
  revision integer not null default 0 check (revision >= 0)
);
insert into private.assignment_customer_policy default values;
revoke all on private.assignment_customer_policy from public,anon,authenticated,service_role;

create function private.assignment_customer_settings()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not private.has_permission('jobs.manage') then raise insufficient_privilege; end if;
  return (select jsonb_build_object('mode',mode,'lead_hours',lead_hours,'revision',revision)
    from private.assignment_customer_policy);
end
$$;

create function private.save_assignment_customer_settings(p_mode text,p_lead_hours integer,p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not private.has_permission('jobs.manage') then raise insufficient_privilege; end if;
  if p_mode is null or p_mode not in ('scheduled','on_confirmation','management_only')
    or p_lead_hours is null or p_lead_hours not between 0 and 8760
    or p_expected_revision is null or p_expected_revision < 0 then
    raise invalid_parameter_value;
  end if;
  update private.assignment_customer_policy
  set mode=p_mode,lead_hours=p_lead_hours,revision=revision+1
  where revision=p_expected_revision;
  if not found then
    raise exception 'Customer visibility settings changed' using errcode='40001';
  end if;
  return private.assignment_customer_settings();
end
$$;

create function public.assignment_customer_settings()
returns jsonb language sql stable security invoker set search_path='' as $$
  select private.assignment_customer_settings()
$$;

create function public.save_assignment_customer_settings(p_mode text,p_lead_hours integer,p_expected_revision integer)
returns jsonb language sql security invoker set search_path='' as $$
  select private.save_assignment_customer_settings(p_mode,p_lead_hours,p_expected_revision)
$$;

revoke execute on function private.assignment_customer_settings(),public.assignment_customer_settings(),
  private.save_assignment_customer_settings(text,integer,integer),
  public.save_assignment_customer_settings(text,integer,integer) from public,anon,service_role;
grant execute on function private.assignment_customer_settings(),public.assignment_customer_settings(),
  private.save_assignment_customer_settings(text,integer,integer),
  public.save_assignment_customer_settings(text,integer,integer) to authenticated;

-- Own confirmed allocation and its first unreleased session define the window.
-- The 168-hour default uses elapsed time, matching the withdrawal clock across DST.
create function private.can_read_assignment_customer(p_job_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select private.has_permission('jobs.manage') or (
    private.lecturer_actor() and not private.job_lecturer_blocked(p_job_id,auth.uid()) and exists (
      select 1 from public.job_claims claim
      cross join private.assignment_customer_policy policy
      where claim.job_id=p_job_id and claim.lecturer_id=auth.uid() and claim.status='confirmed'
      and (policy.mode='on_confirmation' or (policy.mode='scheduled' and (
        select min(slot.starts_at)
        from public.assignment_sessions slot
        where slot.claim_id=claim.id and slot.released_at is null
      ) <= statement_timestamp() + make_interval(hours=>policy.lead_hours)))
    )
  )
$$;

-- The detail view can explain a scheduled reveal using the same allocation
-- and clock. An employee who has not taken the job never learns its reveal time.
create function private.assignment_customer_reveal_at(p_job_id uuid)
returns timestamptz language sql stable security invoker set search_path='' as $$
  select min(slot.starts_at - make_interval(hours=>policy.lead_hours))
  from public.job_claims claim
  join public.assignment_sessions slot on slot.claim_id=claim.id and slot.released_at is null
  cross join private.assignment_customer_policy policy
  where claim.job_id=p_job_id and claim.lecturer_id=auth.uid() and claim.status='confirmed'
    and policy.mode='scheduled' and private.lecturer_actor()
    and not private.job_lecturer_blocked(p_job_id,auth.uid())
$$;
revoke execute on function private.assignment_customer_reveal_at(uuid)
  from public,anon,authenticated,service_role;

-- Existing company contacts and enrolled learners keep their own scoped course access.
-- A lecturer's eligibility to prepare a course does not grant its customer identity.
create function private.can_read_course_customer(p_run_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select private.has_permission('jobs.manage') or private.has_permission('courses.manage') or exists (
    select 1 from public.course_runs run where run.id=p_run_id and (
      private.client_has_organisation(run.organisation_id)
      or (
        private.course_lms_read_enabled(run.organisation_id)
        and private.active_company_participant(auth.uid(),run.organisation_id)
        and exists (select 1 from public.course_enrolments enrolment
          where enrolment.course_run_id=run.id and enrolment.user_id=auth.uid()
          and enrolment.status in ('enrolled','completed'))
      )
      or exists (select 1 from public.jobs job where job.course_run_id=run.id
        and private.can_read_assignment_customer(job.id))
    )
  )
$$;

revoke execute on function private.can_read_assignment_customer(uuid),private.can_read_course_customer(uuid)
  from public,anon,service_role;
grant execute on function private.can_read_assignment_customer(uuid),private.can_read_course_customer(uuid)
  to authenticated;

-- Raw relation reads cannot project protected columns. Use the scoped RPCs for
-- preparation until the same principal could read the full underlying row.
create policy customer_policy_jobs on public.jobs as restrictive for select to authenticated
  using (private.can_read_assignment_customer(id));
create policy customer_policy_courses on public.course_runs as restrictive for select to authenticated
  using (private.can_read_course_customer(id));
create policy customer_policy_templates on public.course_templates as restrictive for select to authenticated
  using (owner_organisation_id is null or private.has_permission('courses.manage')
    or private.has_permission('jobs.manage') or private.client_has_organisation(owner_organisation_id)
    or exists (select 1 from public.course_runs run where run.template_id=course_templates.id
      and run.organisation_id=course_templates.owner_organisation_id and private.can_read_course_customer(run.id)));
create policy customer_policy_organisations on public.organisations as restrictive for select to authenticated
  using (private.has_permission('organisations.manage') or private.client_has_organisation(id)
    or exists (select 1 from public.course_runs run where run.organisation_id=organisations.id
      and private.can_read_course_customer(run.id)));

-- Keep the same read predicate in filtering and ordering as in the result.
-- Prefer internal, ungranted helpers so raw identity can never be selected by
-- bypassing a public projection. Job scope is checked by each owning reader.
create function private.visible_job_customer(p_job_id uuid,p_name text)
returns text language sql stable security invoker set search_path='' as $$
  select case when private.can_read_assignment_customer(p_job_id) then p_name else '' end
$$;
create function private.visible_job_location(p_job_id uuid,p_location text)
returns text language sql stable security invoker set search_path='' as $$
  select case when private.can_read_assignment_customer(p_job_id) then p_location else '' end
$$;
create function private.visible_course_customer(p_run_id uuid,p_name text)
returns text language sql stable security invoker set search_path='' as $$
  select case when private.can_read_course_customer(p_run_id) then p_name else '' end
$$;
revoke execute on function private.visible_job_customer(uuid,text),private.visible_job_location(uuid,text),
  private.visible_course_customer(uuid,text) from public,anon,authenticated,service_role;

-- Apply the policy at the existing read boundaries. Fail the migration if an
-- owning projection changes shape instead of silently leaving it unprotected.
create function pg_temp.assignment_customer_patch(p_function regprocedure,p_before text,p_after text)
returns void language plpgsql set search_path='' as $$
declare definition text := pg_get_functiondef(p_function);
begin
  if cardinality(string_to_array(definition,p_before))<>2 then
    raise exception 'Unexpected customer identity projection in % for %',p_function,p_before;
  end if;
  execute replace(definition,p_before,p_after);
end
$$;
select pg_temp.assignment_customer_patch('private.job_discovery_item(uuid)',
  $before$'customer_name',j.customer_name$before$,
  $after$'customer_name',private.visible_job_customer(j.id,j.customer_name),'customer_hidden',not private.can_read_assignment_customer(j.id),
    'customer_reveal_at',case when not private.can_read_assignment_customer(j.id)
      then private.assignment_customer_reveal_at(j.id) end$after$);
select pg_temp.assignment_customer_patch('private.job_discovery_item(uuid)',
  $before$'location',j.location$before$,
  $after$'location',private.visible_job_location(j.id,j.location)$after$);

select pg_temp.assignment_customer_patch('private.job_discovery_candidates(jsonb)',
  $before$select job.id, job.title, job.customer_name, job.created_at, job.capacity$before$,
  $after$select job.id, job.title, private.visible_job_customer(job.id,job.customer_name) as customer_name, job.created_at, job.capacity$after$);
select pg_temp.assignment_customer_patch('private.job_discovery_candidates(jsonb)',
  $before$job.description || ' ' || job.customer_name || ' ' || job.location$before$,
  $after$job.description || ' ' || private.visible_job_customer(job.id,job.customer_name) || ' ' || private.visible_job_location(job.id,job.location)$after$);
select pg_temp.assignment_customer_patch('private.job_discovery_candidates(jsonb)',
  $before$strpos(lower(job.customer_name), lower(f->>'customer'))$before$,
  $after$strpos(lower(private.visible_job_customer(job.id,job.customer_name)), lower(f->>'customer'))$after$);

select pg_temp.assignment_customer_patch('private.job_offers()',
  $before$to_jsonb(j)||jsonb_build_object($before$,
  $after$(case when private.can_read_assignment_customer(j.id) then to_jsonb(j)
    else to_jsonb(j)-array['course_run_id','created_by'] end)||jsonb_build_object(
  'customer_name',private.visible_job_customer(j.id,j.customer_name),'location',private.visible_job_location(j.id,j.location),$after$);
select pg_temp.assignment_customer_patch('private.job_offers()',
  $before$jsonb_agg(s order by s.starts_at)$before$,
  $after$jsonb_agg(case when private.can_read_assignment_customer(j.id) then to_jsonb(s)
    else to_jsonb(s)-'course_session_id' end order by s.starts_at)$after$);

select pg_temp.assignment_customer_patch('private.job_briefing(uuid)',
  $before$has_contact := coalesce(briefing.contact_name <> '' or briefing.contact_email <> ''
    or briefing.contact_phone <> '' or briefing.contact_description <> '', false);$before$,
  $after$has_contact := private.can_read_assignment_customer(job.id)
    and coalesce(concat(briefing.contact_name,briefing.contact_email,briefing.contact_phone,briefing.contact_description)<>'',false);$after$);
select pg_temp.assignment_customer_patch('private.job_briefing(uuid)',
  $before$coalesce(briefing.reference_url, '')$before$,
  $after$case when private.can_read_assignment_customer(job.id) then coalesce(briefing.reference_url,'') else '' end$after$);
select pg_temp.assignment_customer_patch('private.job_briefing(uuid)',
  $before$coalesce(briefing.reference_label, '')$before$,
  $after$case when private.can_read_assignment_customer(job.id) then coalesce(briefing.reference_label,'') else '' end$after$);
select pg_temp.assignment_customer_patch('private.job_briefing(uuid)',
  $before$coalesce(briefing.reference_description, '')$before$,
  $after$case when private.can_read_assignment_customer(job.id) then coalesce(briefing.reference_description,'') else '' end$after$);
select pg_temp.assignment_customer_patch('private.job_briefing(uuid)',
  $before$'fallback_contact', case when not has_contact and ($before$,
  $after$'fallback_contact', case when private.can_read_assignment_customer(job.id) and not has_contact and ($after$);

select pg_temp.assignment_customer_patch('private.job_dispatch_projection(public.jobs)',
  $before$if manager or assigned_lecturer or private.job_dispatch_company_actor(p_job.id) then$before$,
  $after$if manager or (assigned_lecturer and private.can_read_assignment_customer(p_job.id)) or private.job_dispatch_company_actor(p_job.id) then$after$);

select pg_temp.assignment_customer_patch('private.assignment_calendar_metadata(uuid[])',
  $before$'organisation_id',r.organisation_id$before$,
  $after$'organisation_id',case when private.can_read_assignment_customer(j.id) then r.organisation_id end$after$);
select pg_temp.assignment_customer_patch('private.assignment_calendar_metadata(uuid[])',
  $before$coalesce(o.name,j.customer_name)$before$,
  $after$private.visible_job_customer(j.id,coalesce(o.name,j.customer_name))$after$);

select pg_temp.assignment_customer_patch('private.assignment_confirmation(uuid)',
  $before$'customer_name', job.customer_name$before$,
  $after$'customer_name', private.visible_job_customer(job.id,job.customer_name)$after$);
select pg_temp.assignment_customer_patch('private.assignment_confirmation(uuid)',
  $before$'physical_location', case when coalesce$before$,
  $after$'physical_location', case when private.can_read_assignment_customer(job.id) and coalesce$after$);

select pg_temp.assignment_customer_patch('private.teaching_day()',
  $before$'customer_name',j.customer_name$before$,
  $after$'customer_name',private.visible_job_customer(j.id,j.customer_name)$after$);
select pg_temp.assignment_customer_patch('private.teaching_day()',
  $before$'location',j.location$before$,
  $after$'location',private.visible_job_location(j.id,j.location)$after$);
select pg_temp.assignment_customer_patch('private.teaching_day()',
  $before$(select jsonb_build_object('name',contact.name,'email',contact.email,'phone',contact.phone)
    from private.course_workspace_settings settings join public.organisation_contacts contact on contact.id=settings.contact_id
    join public.organisations organisation on organisation.id=contact.organisation_id
    where settings.run_id=r.id and contact.organisation_id=r.organisation_id and contact.archived_at is null and organisation.archived_at is null)$before$,
  $after$case when private.can_read_assignment_customer(j.id) then private.course_job_contact(r.id) end$after$);

select pg_temp.assignment_customer_patch('private.course_workspace_before_premium(uuid)',
  $before$'venue',r.venue$before$,
  $after$'venue',case when private.can_read_course_customer(r.id) then r.venue else '' end$after$);
select pg_temp.assignment_customer_patch('private.course_workspace_before_premium(uuid)',
  $before$(select jsonb_build_object('name',oc.name,'email',oc.email,'phone',oc.phone) from public.organisation_contacts oc where oc.id=settings.contact_id and oc.organisation_id=r.organisation_id and oc.archived_at is null)$before$,
  $after$case when private.can_read_course_customer(r.id) then private.course_job_contact(r.id) end$after$);

select pg_temp.assignment_customer_patch('private.standard_course_workspace(uuid,jsonb)',
  $before$when run.delivery_type = 'onsite' then run.venue$before$,
  $after$when run.delivery_type = 'onsite' and private.can_read_course_customer(run.id) then run.venue$after$);

select pg_temp.assignment_customer_patch('private.my_course_workspaces()',
  $before$run.time_zone, run.venue, run.delivery_type$before$,
  $after$run.time_zone, case when private.can_read_course_customer(run.id) then run.venue else '' end as venue, run.delivery_type$after$);
select pg_temp.assignment_customer_patch('private.my_course_workspaces()',
  $before$organisation.name as organisation_name$before$,
  $after$case when private.can_read_course_customer(run.id) then organisation.name end as organisation_name$after$);

select pg_temp.assignment_customer_patch('private.training_delivery_view(uuid)',
  $before$where booking.lecturer_id=auth.uid() and booking.released_at is null$before$,
  $after$where booking.lecturer_id=auth.uid() and booking.released_at is null and private.can_read_assignment_customer(job.id)$after$);

select pg_temp.assignment_customer_patch('private.recommended_jobs()',
  $before$select j.id,j.title,j.customer_name,j.time_zone,s.begins$before$,
  $after$select j.id,j.title,private.visible_job_customer(j.id,j.customer_name) as customer_name,j.time_zone,s.begins$after$);
select pg_temp.assignment_customer_patch('private.recommended_jobs()',
  $before$where run.id=j.course_run_id) favourite_customer$before$,
  $after$where run.id=j.course_run_id and private.can_read_assignment_customer(j.id)) favourite_customer$after$);
select pg_temp.assignment_customer_patch('private.recommended_jobs()',
  $before$where run.id=j.course_run_id) then 2 else 0 end score$before$,
  $after$where run.id=j.course_run_id and private.can_read_assignment_customer(j.id)) then 2 else 0 end score$after$);

select pg_temp.assignment_customer_patch('private.unified_search_before_course_chat_links(text,text,text,text,uuid,integer)',
  $before$job.customer_name detail$before$,
  $after$private.visible_job_customer(job.id,job.customer_name) detail$after$);
select pg_temp.assignment_customer_patch('private.unified_search_before_course_chat_links(text,text,text,text,uuid,integer)',
  $before$job.description || ' ' || job.customer_name$before$,
  $after$job.description || ' ' || private.visible_job_customer(job.id,job.customer_name)$after$);
select pg_temp.assignment_customer_patch('private.unified_search_before_course_chat_links(text,text,text,text,uuid,integer)',
  $before$template.title, coalesce(organisation.name, ''),$before$,
  $after$template.title, private.visible_course_customer(run.id,coalesce(organisation.name,'')),$after$);
select pg_temp.assignment_customer_patch('private.unified_search_before_course_chat_links(text,text,text,text,uuid,integer)',
  $before$template.description || ' ' || coalesce(organisation.name, '')$before$,
  $after$template.description || ' ' || private.visible_course_customer(run.id,coalesce(organisation.name,''))$after$);

select pg_temp.assignment_customer_patch('private.job_picker_candidates(text,text)',
  $before$j.title,j.customer_name,j.course_run_id$before$,
  $after$j.title,private.visible_job_customer(j.id,j.customer_name),j.course_run_id$after$);
select pg_temp.assignment_customer_patch('private.job_picker_candidates(text,text)',
  $before$j.title||' '||j.customer_name$before$,
  $after$j.title||' '||private.visible_job_customer(j.id,j.customer_name)$after$);
select pg_temp.assignment_customer_patch('private.job_picker_candidates(text,text)',
  $before$t.title,coalesce(o.name,''),r.id$before$,
  $after$t.title,private.visible_course_customer(r.id,coalesce(o.name,'')),r.id$after$);
select pg_temp.assignment_customer_patch('private.job_picker_candidates(text,text)',
  $before$t.title||' '||coalesce(o.name,'')$before$,
  $after$t.title||' '||private.visible_course_customer(r.id,coalesce(o.name,''))$after$);

select pg_temp.assignment_customer_patch('private.job_picker(text,text,jsonb,integer,uuid)',
  $before$'customer_name',j.customer_name$before$,
  $after$'customer_name',private.visible_job_customer(j.id,j.customer_name)$after$);
select pg_temp.assignment_customer_patch('private.job_picker(text,text,jsonb,integer,uuid)',
  $before$'customer_name',coalesce(o.name,'')$before$,
  $after$'customer_name',private.visible_course_customer(r.id,coalesce(o.name,''))$after$);

select pg_temp.assignment_customer_patch('private.finance_earnings(boolean)',
  $before$r.title, r.customer_name, r.starts_at$before$,
  $after$r.title, private.visible_job_customer(r.job_id,r.customer_name), r.starts_at$after$);

select pg_temp.assignment_customer_patch('private.finance_statement(date,date,boolean)',
  $before$j.title,j.customer_name,c.status$before$,
  $after$j.title,private.visible_job_customer(j.id,j.customer_name) as customer_name,c.status$after$);

-- Calendar, readiness, substitutions and organization favorites also expose
-- identity data independently from the marketplace.
select pg_temp.assignment_customer_patch('private.favourite_resource(text,uuid)',
  $before$private.can_read_course_run(r.id)$before$,
  $after$private.can_read_course_run(r.id) and private.can_read_course_customer(r.id)$after$);
select pg_temp.assignment_customer_patch('private.my_favourites(text)',
  $before$private.can_read_course_run(run.id)$before$,
  $after$private.can_read_course_run(run.id) and private.can_read_course_customer(run.id)$after$);
select pg_temp.assignment_customer_patch('private.readiness_snapshot_for_start(uuid,boolean)',
  $before$'organisation_name',(select name from public.organisations where id=r.organisation_id)$before$,
  $after$'organisation_name',case when private.can_read_course_customer(r.id) then (select name from public.organisations where id=r.organisation_id) end$after$);
select pg_temp.assignment_customer_patch('private.readiness_snapshot_for_start(uuid,boolean)',
  $before$'venue',case when r.delivery_type='onsite' then r.venue else '' end,'meeting_url',meeting$before$,
  $after$'venue',case when r.delivery_type='onsite' and private.can_read_course_customer(r.id) then r.venue else '' end,'meeting_url',case when private.can_read_course_customer(r.id) then meeting else '' end$after$);
select pg_temp.assignment_customer_patch('private.readiness_snapshot_for_start(uuid,boolean)',
  $before$'meeting_url',cfg.meeting_url$before$,
  $after$'meeting_url',case when private.can_read_course_customer(r.id) then cfg.meeting_url else '' end$after$);
-- Keep the stored quote intact for pricing consistency and redact its read model.
select pg_temp.assignment_customer_patch('private.job_substitutions(uuid)',
  $before$'quote',case when (s.target_user_id=auth.uid() and s.pricing_context is not null) or private.has_permission('finance.gross.read') then s.quote
    else s.quote||jsonb_build_object('amount',null,'total_amount',null,'currency',null,'rate_unit',null,'terms',null,'terms_version',null) end$before$,
  $after$'quote',(case when (s.target_user_id=auth.uid() and s.pricing_context is not null) or private.has_permission('finance.gross.read') then s.quote
    else s.quote||jsonb_build_object('amount',null,'total_amount',null,'currency',null,'rate_unit',null,'terms',null,'terms_version',null) end)
      || case when private.can_read_assignment_customer(s.job_id) then '{}'::jsonb
        else jsonb_build_object('customer_name','','location','') end$after$);

drop function pg_temp.assignment_customer_patch(regprocedure,text,text);
commit;
