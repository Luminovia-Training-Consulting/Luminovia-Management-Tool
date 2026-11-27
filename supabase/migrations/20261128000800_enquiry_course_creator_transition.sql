begin;

-- Keep the reviewed relationship outside browser-editable form snapshots.
alter table private.course_creator_drafts
  add column enquiry_id uuid references private.website_enquiries(id) on delete cascade,
  add column enquiry_version integer,
  add constraint course_creator_enquiry_revision check
    ((enquiry_id is null and enquiry_version is null) or (enquiry_id is not null and enquiry_version > 0));
create index course_creator_enquiry_owner on private.course_creator_drafts(enquiry_id,owner_id,enquiry_version)
  where enquiry_id is not null;

create function private.start_enquiry_course_creator(p_draft_id uuid,p_payload jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  source private.website_enquiries;
  draft private.course_creator_drafts;
begin
  if not private.has_permission('organisations.manage') then raise insufficient_privilege; end if;
  if (p_payload-array['enquiry_id','version'])<>'{}'::jsonb
      or jsonb_typeof(p_payload->'version') is distinct from 'number' then
    raise invalid_parameter_value;
  end if;
  select * into source from private.website_enquiries
  where id=(p_payload->>'enquiry_id')::uuid for share;
  if not found or source.organisation_id is null or source.course_run_id is not null
     or source.status not in ('received','reviewing','awaiting_customer') or not exists (
       select 1 from public.organisations where id=source.organisation_id and archived_at is null
     ) then raise insufficient_privilege; end if;
  if source.version is distinct from (p_payload->>'version')::integer then
    raise exception 'Enquiry changed; reload' using errcode='40001';
  end if;
  select * into draft from private.course_creator_drafts
  where owner_id=auth.uid() and enquiry_id=source.id and enquiry_version=source.version and state='editing'
  order by updated_at desc,id limit 1;
  if draft.id is not null then return private.course_creator_draft_receipt(draft,true); end if;
  if (select count(*) from private.course_creator_drafts where owner_id=auth.uid() and state='editing')>=100 then
    raise program_limit_exceeded;
  end if;
  insert into private.course_creator_drafts(id,owner_id,enquiry_id,enquiry_version,payload)
  values(p_draft_id,auth.uid(),source.id,source.version,jsonb_build_object(
    'run',jsonb_build_object('template_id','','organisation_id',source.organisation_id,
      'time_zone',source.payload->>'time_zone','delivery_type',
      case when source.payload->>'delivery_type'='onsite' then 'onsite' else 'online' end,
      'venue','','archived',false,'sessions',jsonb_build_array(jsonb_build_object('starts_at','','ends_at',''))),
    'content',jsonb_build_object('title',source.payload->>'topic','description',source.payload->>'message',
      'syllabus','','prerequisites','','topic_ids','[]'::jsonb,'archived',false)
  )) on conflict do nothing returning * into draft;
  if draft.id is null then raise insufficient_privilege; end if;
  return private.course_creator_draft_receipt(draft,true);
end;
$$;
revoke all on function private.start_enquiry_course_creator(uuid,jsonb) from public,anon,authenticated,service_role;

-- Reuse the exact public conversion transaction, including its enquiry lock,
-- status transition, audit trail, version checks and intake-record retention.
do $migration$
declare
  definition text;
  patch record;
  active_signature text;
begin
  for patch in select * from (values
    ('private.course_creator_draft_receipt(private.course_creator_drafts,boolean)',
     $old$'state', p_row.state,$old$, $new$'from_enquiry', p_row.enquiry_id is not null, 'state', p_row.state,$new$),
    ('private.course_creator_drafts(uuid)',
     $old$and (p_draft_id is null or draft.id = p_draft_id)$old$,
     $new$and (p_draft_id is null or draft.id = p_draft_id)
        and (draft.enquiry_id is null or private.has_permission('organisations.manage'))$new$),
    ('private.manage_enquiry(uuid,text,jsonb,integer,uuid)',
     $old$array['title','description']$old$,
     $new$array['title','description','syllabus','prerequisites','topic_ids']$new$),
    ('private.manage_enquiry(uuid,text,jsonb,integer,uuid)',
     $old$'prerequisites', '',
      'topic_ids', '[]'::jsonb$old$,
     $new$'syllabus', coalesce(p_payload#>>'{draft,syllabus}',''),
      'prerequisites', coalesce(p_payload#>>'{draft,prerequisites}',''),
      'topic_ids', coalesce(p_payload#>'{draft,topic_ids}','[]'::jsonb)$new$),
    ('private.manage_enquiry(uuid,text,jsonb,integer,uuid)',
     $old$'template_id','sessions','time_zone','delivery_type','venue'$old$,
     $new$'template_id','sessions','time_zone','delivery_type','venue','teaching_language'$new$),
    ('private.manage_enquiry(uuid,text,jsonb,integer,uuid)',
     $old$target:=private.save_course_run(null,run_payload);$old$,
     $new$target:=private.save_course_run(null,run_payload ||
       case when p_payload ? 'teaching_language' then jsonb_build_object('teaching_language',p_payload->'teaching_language')
            else '{}'::jsonb end);$new$),
    ('private.course_creator_draft_action(text,uuid,integer,jsonb)',
     $old$'save', 'duplicate', 'discard', 'create_course')$old$,
     $new$'save', 'duplicate', 'discard', 'create_course', 'start_enquiry')$new$),
    ('private.course_creator_draft_action(text,uuid,integer,jsonb)',
     $old$where id = p_draft_id and owner_id = actor for update;$old$,
     $new$where id = p_draft_id and owner_id = actor for update;

  if p_action='start_enquiry' then
    if p_expected_revision<>0 then raise invalid_parameter_value; end if;
    return private.start_enquiry_course_creator(p_draft_id,p_payload);
  end if;
  if entry.enquiry_id is not null then
    if not private.has_permission('organisations.manage') or p_action='duplicate' then raise insufficient_privilege; end if;
    if p_action='save' and p_payload#>>'{run,organisation_id}' is distinct from entry.payload#>>'{run,organisation_id}'
      then raise invalid_parameter_value; end if;
  end if;$new$),
    ('private.course_creator_draft_action(text,uuid,integer,jsonb)',
     $old$    if selected_template is null then$old$,
     $new$    if entry.enquiry_id is not null then
      if selected_organisation::text is distinct from entry.payload#>>'{run,organisation_id}'
        then raise invalid_parameter_value; end if;
      perform private.manage_enquiry(entry.enquiry_id,'convert',
        (run_payload-array['organisation_id','operational_preset']) ||
        case when selected_template is null then jsonb_build_object('draft',content_payload)
          else '{}'::jsonb end,entry.enquiry_version,entry.id);
      select course_run_id into strict created_course from private.website_enquiries where id=entry.enquiry_id;
    else
    if selected_template is null then$new$),
    ('private.course_creator_draft_action(text,uuid,integer,jsonb)',
     $old$jsonb_build_object('template_id', selected_template, 'published', false, 'archived', false));$old$,
     $new$jsonb_build_object('template_id', selected_template, 'published', false, 'archived', false));
    end if;$new$)
  ) as changes(signature,before_code,after_code) loop
    if patch.signature is distinct from active_signature then
      if active_signature is not null then execute definition; end if;
      definition := pg_catalog.pg_get_functiondef(patch.signature::regprocedure);
      active_signature := patch.signature;
    end if;
    if cardinality(string_to_array(definition,patch.before_code)) <> 2 then
      raise exception 'Expected one source transition seam in %', patch.signature;
    end if;
    definition := replace(definition,patch.before_code,patch.after_code);
  end loop;
  execute definition;
end;
$migration$;

notify pgrst, 'reload schema';
commit;
