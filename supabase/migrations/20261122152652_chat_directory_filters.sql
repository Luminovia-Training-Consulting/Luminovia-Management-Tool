begin;

-- Derive metadata only for rooms in the actor's current room directory.
-- Course and job labels independently require their normal read permission.
create function private.chat_directory_filters()
returns jsonb
language sql stable security definer set search_path = '' as $$
  with visible_rooms as materialized (
    select room.id, room.kind, room.job_id, room.course_run_id
    from public.chat_members member
    join public.chat_rooms room on room.id = member.room_id
    where member.user_id = auth.uid()
      and member.removed_at is null
      and private.can_access_chat_room(room.id)
  ),
  course_context as materialized (
    select room.id,
           job.id as job_id,
           job.title as job_title,
           job.customer_name,
           run.id as run_id,
           template.title as course_title,
           company.id as company_id,
           company.name as company_name
    from visible_rooms room
    left join public.jobs job on job.id = room.job_id
      and private.can_read_job(job.id)
    left join public.course_runs run on run.id = coalesce(room.course_run_id, job.course_run_id)
      and private.can_read_course_run(run.id)
    left join public.course_templates template on template.id = run.template_id
    left join public.organisations company on company.id = run.organisation_id
    where room.kind in ('lecturer_course', 'participant_course')
  ),
  peers as materialized (
    select room.id as room_id, room.kind, member.user_id
    from visible_rooms room
    join public.chat_members member on member.room_id = room.id
    join public.profiles profile on profile.id = member.user_id and profile.active
    where member.removed_at is null and member.user_id <> auth.uid()
  ),
  facets(room_id, category, facet_key, label) as (
    select context.id, 'course', coalesce(context.run_id, context.job_id)::text,
           coalesce(context.course_title, context.job_title)
    from course_context context
    where context.run_id is not null or context.job_id is not null
    union
    select context.id, 'company',
           coalesce(context.company_id::text, 'job-name:' || lower(btrim(context.customer_name))),
           coalesce(context.company_name, btrim(context.customer_name))
    from course_context context
    where context.company_id is not null or nullif(btrim(context.customer_name), '') is not null
    union
    select peer.room_id, 'company', company.id::text, company.name
    from peers peer
    join public.user_roles role on role.user_id = peer.user_id and role.role = 'client'
    join public.client_organisation_memberships membership
      on membership.user_id = peer.user_id and membership.removed_at is null
    join public.organisations company on company.id = membership.organisation_id
      and company.archived_at is null
    where peer.kind = 'dm' and (
      private.has_permission('users.roles.manage') or private.client_has_organisation(company.id)
    )
    union
    select peer.room_id,
           case when role.role in ('lecturer', 'senior_lecturer') then 'lecturer' else 'staff' end,
           peer.user_id::text, profile.display_name
    from peers peer
    join public.user_roles role on role.user_id = peer.user_id
      and role.role in ('owner', 'admin', 'management', 'lecturer', 'senior_lecturer')
    join public.profiles profile on profile.id = peer.user_id
    where nullif(btrim(profile.display_name), '') is not null
      and private.can_chat_contact(peer.user_id)
  )
  select coalesce(jsonb_agg(to_jsonb(facet) order by facet.room_id, facet.category, facet.facet_key), '[]'::jsonb)
  from facets facet;
$$;

create function public.chat_directory_filters()
returns jsonb
language sql stable security invoker set search_path = '' as $$
  select private.chat_directory_filters();
$$;

revoke all on function private.chat_directory_filters(), public.chat_directory_filters()
  from public, anon, authenticated, service_role;
grant execute on function private.chat_directory_filters(), public.chat_directory_filters()
  to authenticated;
commit;
