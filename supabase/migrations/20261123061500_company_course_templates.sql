begin;

alter table public.course_templates add column owner_organisation_id uuid
  references public.organisations(id);
create index course_templates_owner_organisation on public.course_templates(owner_organisation_id)
  where owner_organisation_id is not null;

-- Only unambiguous reusable templates get a legacy owner. Standalone
-- offers retain their current company-change path and canonical sources
-- remain in the internal library.
with known_owner as (
  select run.template_id, (array_agg(distinct run.organisation_id))[1] organisation_id
  from public.course_runs run
  group by run.template_id
  having count(distinct run.organisation_id) = 1 and bool_and(run.organisation_id is not null)
     and bool_and(not exists (
       select 1 from public.jobs job where job.course_run_id = run.id
       and not exists (select 1 from private.course_run_job_requests request where request.job_id=job.id)
       and not exists (select 1 from private.client_course_requests request where request.job_id=job.id)
     ))
)
update public.course_templates template
set owner_organisation_id = known_owner.organisation_id
from known_owner
where template.id = known_owner.template_id and template.building_block_id is null;

-- Staff library access, a company's own reusable records, and individual
-- assignment/enrolment access are separate grants.
create or replace function private.can_read_course_template(p_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select private.actor_active() and exists (
   select 1 from public.course_templates template where template.id=p_id and (
     private.has_permission('courses.manage')
     or private.client_has_organisation(template.owner_organisation_id)
     or (template.owner_organisation_id is null and exists (
       select 1 from public.course_runs own_run where own_run.template_id=template.id
         and private.client_has_organisation(own_run.organisation_id)
         and not exists (
           select 1 from public.course_runs other_run where other_run.template_id=template.id
             and other_run.organisation_id is distinct from own_run.organisation_id
         )
     ))
     or ((select edition from private.installation_identity) <> 'internal'
       and exists (select 1 from public.course_runs run
         where run.template_id=template.id and private.can_read_course_run(run.id)))
     or (
       private.lecturer_actor() and exists (
         select 1 from public.course_runs run where run.template_id=template.id and (
           private.course_has_current_teacher(run.id)
           or (not private.has_role(array['client']) and private.can_read_course_run(run.id))
         )
       )
     )
   )
 );
$$;

-- Companies use the template library. The source archive remains available
-- to staff and relevant learner records without exposing a shared catalogue.
do $source_policy$
declare
  definition text := pg_get_functiondef('private.can_read_building_block(uuid)'::regprocedure);
  anchor constant text := 'private.actor_active() and (private.profile_staff(auth.uid()) or exists(';
begin
  if cardinality(string_to_array(definition, anchor)) <> 2 then
    raise exception 'Expected current source catalogue read guard';
  end if;
  execute replace(definition, anchor, 'private.actor_active() and
    (not private.has_role(array[''client'']) or private.has_permission(''courses.manage'')
     or (select edition from private.installation_identity) <> ''internal'')
    and (private.has_permission(''courses.manage'') or exists(');
end;
$source_policy$;

create function private.validate_course_template_owner()
returns trigger language plpgsql security definer set search_path='' as $$
declare company uuid;
begin
  select owner_organisation_id into company from public.course_templates
  where id=new.template_id for share;
  if company is not null and company is distinct from new.organisation_id then
    raise exception 'Course template belongs to another company' using errcode='22023';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_course_template_owner() from public, anon, authenticated, service_role;
create trigger course_run_template_owner
before insert or update of template_id, organisation_id on public.course_runs
for each row execute function private.validate_course_template_owner();

do $migration$
declare
  rule record;
  definition text;
begin
  for rule in select * from (values
    ('private.save_course_template(uuid,jsonb)',
      $old$topic_ids uuid[];$old$,
      $new$topic_ids uuid[]; owner_id uuid; current_owner uuid;$new$),
    ('private.save_course_template(uuid,jsonb)',
      $old$ topic_ids:=array$old$,
      $new$ if p_payload?'owner_organisation_id' then
  owner_id := (p_payload->>'owner_organisation_id')::uuid;
  if owner_id is not null and not exists (
    select 1 from public.organisations o where o.id=owner_id and o.archived_at is null
  ) then raise exception 'Company unavailable' using errcode='22023'; end if;
  if p_id is not null then
    select template.owner_organisation_id into current_owner from public.course_templates template
    where template.id=p_id for update;
    if (current_owner is not null and current_owner is distinct from owner_id)
       or (owner_id is not null and exists (
        select 1 from public.course_runs run where run.template_id=p_id
          and run.organisation_id is distinct from owner_id
       )) then raise exception 'Course template ownership cannot be changed' using errcode='22023'; end if;
  end if;
 end if;
 topic_ids:=array$new$),
    ('private.save_course_template(uuid,jsonb)',
      $old$ delete from public.course_template_topics where template_id=target;$old$,
      $new$ if p_payload?'owner_organisation_id' then
  update public.course_templates set owner_organisation_id=owner_id where id=target;
 end if;
 delete from public.course_template_topics where template_id=target;$new$),
    ('private.publish_client_request(uuid,numeric,text,boolean,timestamptz)',
      $old$insert into public.course_templates(title,description) values(r.payload->>'title',r.payload->>'description')$old$,
      $new$insert into public.course_templates(title,description,owner_organisation_id) values(r.payload->>'title',r.payload->>'description',org.id)$new$),
    ('private.duplicate_course_template(uuid,text)',
      $old$prerequisites,building_block_id,building_block_source_id)$old$,
      $new$prerequisites,building_block_id,building_block_source_id,owner_organisation_id)$new$),
    ('private.duplicate_course_template(uuid,text)',
      $old$original.building_block_source_id);$old$,
      $new$original.building_block_source_id,original.owner_organisation_id);$new$),
    ('private.job_company_reassignable(uuid)',
      $old$and not run.published and run.archived_at is null$old$,
      $new$and not run.published and run.archived_at is null
      and not exists (select 1 from public.course_templates template
        where template.id=run.template_id and template.owner_organisation_id is not null)$new$)
  ) as rules(signature, old_text, new_text)
  loop
    definition := pg_get_functiondef(rule.signature::regprocedure);
    if cardinality(string_to_array(definition, rule.old_text)) <> 2 then
      raise exception 'Expected one template ownership update point in %', rule.signature;
    end if;
    execute replace(definition, rule.old_text, rule.new_text);
  end loop;
end;
$migration$;

commit;
