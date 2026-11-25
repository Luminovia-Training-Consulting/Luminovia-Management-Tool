begin;

-- Keep confirmed and retained cancelled assignments. Historic jobs can be
-- linked by a request, commission or accepted ledger even without a course run.
-- If recorded organisations disagree, grant neither tenant access from that job.
create function private.client_lecturer_assignment_history(
  p_client_id uuid,
  p_lecturer_id uuid,
  p_require_premium boolean
) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.job_claims claim
    join public.jobs job on job.id = claim.job_id
    left join public.course_runs run on run.id = job.course_run_id
    left join private.client_course_requests request on request.job_id = job.id
    left join private.job_commission_offers offer on offer.job_id = job.id
    left join private.claim_revenue_ledger ledger on ledger.claim_id = claim.id
    join lateral (
      select min(link.organisation_id::text)::uuid as organisation_id
      from (values (run.organisation_id), (request.organisation_id),
                   (offer.organisation_id), (ledger.organisation_id)) link(organisation_id)
      having count(distinct link.organisation_id) = 1
    ) ownership on true
    join public.organisations organisation
      on organisation.id = ownership.organisation_id and organisation.archived_at is null
    join public.client_organisation_memberships membership
      on membership.organisation_id = organisation.id
      and membership.user_id = p_client_id and membership.removed_at is null
    join public.profiles client on client.id = membership.user_id and client.active
    join public.user_roles client_role on client_role.user_id = client.id and client_role.role = 'client'
    join public.profiles lecturer on lecturer.id = claim.lecturer_id and lecturer.active
    join public.user_roles lecturer_role on lecturer_role.user_id = lecturer.id
      and lecturer_role.role in ('lecturer', 'senior_lecturer')
    where claim.lecturer_id = p_lecturer_id and claim.status in ('confirmed', 'cancelled')
      and (not p_require_premium or private.company_premium_enabled(organisation.id))
  );
$$;
revoke all on function private.client_lecturer_assignment_history(uuid, uuid, boolean)
  from public, anon, authenticated, service_role;

-- Contacts don't require Premium; profile visibility always checks Premium on
-- the very same assignment organisation, not on a different client membership.
create or replace function private.client_lecturer_assignment_history(p_client_id uuid, p_lecturer_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select private.client_lecturer_assignment_history(p_client_id, p_lecturer_id, false);
$$;

create or replace function private.can_read_person(p_user_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select private.actor_active() and (
    p_user_id = auth.uid()
    or (private.profile_staff(p_user_id) and private.profile_staff(auth.uid()))
    or private.client_lecturer_assignment_history(auth.uid(), p_user_id, true)
  );
$$;

commit;