begin;
-- Add current course context to the own-day preview without changing the
-- released personal checklist or broadening contact/document table grants.
create or replace function private.teaching_day() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare zone text; day date; begins timestamptz; ends timestamptz; result jsonb;
begin
 if not private.actor_active() then raise exception 'Active account required' using errcode='42501';end if;
 select p.time_zone into zone from public.profiles p where p.id=auth.uid();
 day:=(now() at time zone zone)::date;
 begins:=day::timestamp at time zone zone;ends:=(day+1)::timestamp at time zone zone;
 select coalesce(jsonb_agg(x.item order by x.starts_at,x.id),'[]'::jsonb) into result from (
  select s.starts_at,s.id,jsonb_build_object('id',s.id,'claim_id',c.id,'job_id',j.id,'title',j.title,
   'customer_name',j.customer_name,'starts_at',s.starts_at,'ends_at',s.ends_at,'time_zone',j.time_zone,
   'delivery_type',j.delivery_type,'location',j.location,'course_run_id',r.id,
   -- Only the deliberately selected contact for this exact current course/org.
   -- Contact existence, another org contact, internal notes and private profiles
   -- are never alternative sources for this projection.
   'course_contact',(select jsonb_build_object('name',contact.name,'email',contact.email,'phone',contact.phone)
    from private.course_workspace_settings settings join public.organisation_contacts contact on contact.id=settings.contact_id
    join public.organisations organisation on organisation.id=contact.organisation_id
    where settings.run_id=r.id and contact.organisation_id=r.organisation_id and contact.archived_at is null and organisation.archived_at is null),
   'shared_preparation',case when r.id is not null then (select jsonb_build_object('done',count(*) filter(where item.done),'total',count(*)) from private.course_preparation_items item where item.run_id=r.id) end,
   -- Exact shared versions can differ from the owner's later private current
   -- version. The owning resource helper rechecks audience and course access.
   'course_resources',(select coalesce(jsonb_agg(jsonb_build_object('id',resource.id,'version_id',resource.version_id,'name',resource.original_name,'sha256',resource.sha256,'category',resource.category) order by resource.created_at,resource.id),'[]'::jsonb)
    from(select l.id,l.version_id,l.category,l.created_at,v.original_name,v.sha256
     from private.course_resources l join public.document_versions v on v.id=l.version_id join public.documents d on d.id=v.document_id
     where l.run_id=r.id and l.removed_at is null and v.status='clean' and v.sha256~'^[0-9a-f]{64}$' and d.deleted_at is null and d.kind='material' and private.course_resource_allowed(l.id)
     order by l.created_at,l.id limit 10) resource),
   'course_resource_count',(select count(*) from private.course_resources l join public.document_versions v on v.id=l.version_id join public.documents d on d.id=v.document_id
    where l.run_id=r.id and l.removed_at is null and v.status='clean' and v.sha256~'^[0-9a-f]{64}$' and d.deleted_at is null and d.kind='material' and private.course_resource_allowed(l.id)),
   'documents',(select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'name',d.original_name) order by d.created_at,d.id),'[]'::jsonb)
    from(select d.* from public.documents d where d.job_id=j.id and d.kind='material' and d.status='clean' and d.deleted_at is null and private.can_access_document(d.id) order by d.created_at,d.id limit 20)d),
   'document_count',(select count(*) from public.documents d where d.job_id=j.id and d.kind='material' and d.status='clean' and d.deleted_at is null and private.can_access_document(d.id)),
   'preparation',jsonb_build_object('materials_ready',coalesce(p.materials_ready,false),'location_ready',coalesce(p.location_ready,false),'contact_ready',coalesce(p.contact_ready,false),'version',coalesce(p.version,0))) item
  from public.assignment_sessions s join public.job_claims c on c.id=s.claim_id join public.jobs j on j.id=c.job_id
   left join public.course_runs r on r.id=j.course_run_id and r.archived_at is null
   left join private.teaching_preparation p on p.claim_id=c.id
  -- Same live lecturer/confirmed/unreleased boundary as the original day. A
  -- former claimant or revoked lecturer cannot keep the transferred context.
  where private.lecturer_actor() and c.lecturer_id=auth.uid() and s.lecturer_id=auth.uid() and c.status='confirmed' and s.released_at is null
   and s.starts_at<ends and s.ends_at>begins and private.can_read_job(j.id)
  order by s.starts_at,s.id limit 100
 )x;
 return jsonb_build_object('day',day,'time_zone',zone,'sessions',result);
end;$$;
-- Existing invoker wrapper and explicit authenticated-only EXECUTE grants stay
-- unchanged. No direct contact, resource, history or Storage grant is added.
commit;
