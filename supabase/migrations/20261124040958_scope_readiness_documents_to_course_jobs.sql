begin;

-- Resolve direct and room attachments through their job and room indexes.
-- A document linked both ways still belongs to the job only once.
create function private.readiness_job_document_ids(p_job uuid)
returns table(document_id uuid)
language sql stable security invoker set search_path = '' as $$
  select document.id from public.documents document where document.job_id = p_job
  union
  select document.id
  from public.chat_rooms room
  join public.documents document on document.room_id = room.id
  where room.job_id = p_job;
$$;
revoke all on function private.readiness_job_document_ids(uuid)
  from public, anon, authenticated, service_role;

-- Keep both existing document authorisation checks after scoping the input.
do $migration$
declare
  definition text := pg_get_functiondef('private.readiness_snapshot(uuid)'::regprocedure);
  material_before constant text := $sql$not exists(select 1 from public.documents d
   where private.readiness_material_access(d.id,c.lecturer_id,j.id))$sql$;
  material_after constant text := $sql$not exists(select 1 from private.readiness_job_document_ids(j.id) candidate
   where private.readiness_material_access(candidate.document_id,c.lecturer_id,j.id))$sql$;
  listing_before constant text := $sql$select jsonb_agg(jsonb_build_object('id',d.id,'name',d.original_name,'job_id',j.id) order by d.created_at desc,d.id)
   from public.documents d join public.jobs j on j.course_run_id=r.id where private.can_access_document(d.id)
   and d.deleted_at is null and d.status='clean' and (d.job_id=j.id or exists(select 1 from public.chat_rooms room where room.id=d.room_id and room.job_id=j.id))$sql$;
  listing_after constant text := $sql$with course_documents as materialized (
    select d.id,d.original_name,d.created_at,j.id as job_id
    from public.jobs j
    cross join lateral private.readiness_job_document_ids(j.id) candidate
    join public.documents d on d.id=candidate.document_id
    where j.course_run_id=r.id and d.deleted_at is null and d.status='clean'
   )
   select jsonb_agg(jsonb_build_object('id',d.id,'name',d.original_name,'job_id',d.job_id) order by d.created_at desc,d.id)
   from course_documents d where private.can_access_document(d.id)$sql$;
begin
  if cardinality(string_to_array(definition, material_before)) <> 2 or
     cardinality(string_to_array(definition, listing_before)) <> 2 then
    raise exception 'Expected current readiness document projections';
  end if;
  execute replace(replace(definition, material_before, material_after), listing_before, listing_after);
end;
$migration$;

commit;
