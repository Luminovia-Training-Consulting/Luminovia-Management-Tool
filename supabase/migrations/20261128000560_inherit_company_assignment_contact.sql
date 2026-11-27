begin;

-- Older companies without an explicit choice retain their existing default.
-- Saving a null default suppresses that implicit selection.
create function private.company_default_job_contact(p_organisation_id uuid)
returns uuid language sql stable set search_path = '' as $$
  select contact.id
  from public.organisations company
  join public.organisation_contacts contact on contact.organisation_id = company.id and contact.archived_at is null
  left join private.company_dispatch_settings settings on settings.organisation_id = company.id
  where company.id = p_organisation_id and company.archived_at is null
    and (settings.organisation_id is null or contact.id = settings.contact_id)
  order by contact.created_at desc, contact.id desc
  limit 1
$$;

revoke all on function private.company_default_job_contact(uuid)
from public, anon, authenticated, service_role;

create or replace function private.dispatch_contact(p_organisation_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('name', contact.name, 'email', contact.email, 'phone', contact.phone)
  from public.organisation_contacts contact
  where contact.id = private.company_default_job_contact(p_organisation_id)
$$;

-- Reflect the effective setting so an older company's implicit selection can
-- be cleared in the existing editor.
create or replace function private.company_class_directory(p_organisation_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.company_dispatch_allowed(p_organisation_id) then raise insufficient_privilege; end if;
  return jsonb_build_object(
    'classes', private.dispatch_classes(p_organisation_id),
    'contact_id', private.company_default_job_contact(p_organisation_id),
    'contacts', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'name', c.name, 'email', c.email, 'phone', c.phone) order by lower(c.name), c.id), '[]'::jsonb)
      from public.organisation_contacts c where c.organisation_id = p_organisation_id and c.archived_at is null)
  );
end;
$$;

-- Resolve the current contact at read time so a confirmed assignment never
-- retains contact details for an archived person or a former company.
create or replace function private.course_job_contact(p_run_id uuid, p_organisation_id uuid default null)
returns jsonb language sql stable set search_path = '' as $$
  select case when contact.id is not null
    then jsonb_build_object('name', contact.name, 'email', contact.email, 'phone', contact.phone)
    else private.dispatch_contact(company.id)
  end
  from public.course_runs run
  join public.organisations company on company.id = coalesce(p_organisation_id, run.organisation_id)
    and company.archived_at is null
  left join private.course_workspace_settings settings on settings.run_id = run.id
  left join public.organisation_contacts contact on contact.id = settings.contact_id
    and contact.organisation_id = company.id and contact.archived_at is null
  where run.id = p_run_id
$$;

commit;
