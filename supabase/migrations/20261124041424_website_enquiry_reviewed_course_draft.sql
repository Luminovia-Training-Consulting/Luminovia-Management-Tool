begin;

-- Preserve the existing command identity, version checks and immutable intake.
-- Each owner-scoped draft contains reviewed course text, never directory fields.
do $draft$
declare
  definition text := pg_catalog.pg_get_functiondef('private.manage_enquiry(uuid,text,jsonb,integer,uuid)'::regprocedure);
  old_keys constant text := $old$'template_id','sessions','time_zone','delivery_type','venue')$old$;
  old_create constant text := $old$  if template is null then template:=private.save_course_template(null,jsonb_build_object('title',enquiry.payload->>'topic','description',enquiry.payload->>'message','prerequisites','','topic_ids','[]'::jsonb));$old$;
begin
  if cardinality(string_to_array(definition, old_keys)) <> 2
    or cardinality(string_to_array(definition, old_create)) <> 2 then
    raise exception 'Unexpected enquiry conversion definition';
  end if;
  definition := replace(definition, old_keys, $new$'template_id','sessions','time_zone','delivery_type','venue','draft')$new$);
  definition := replace(definition, old_create, $new$
  if p_payload ? 'draft' and (
    template is not null
    or jsonb_typeof(p_payload->'draft') is distinct from 'object'
    or jsonb_typeof(p_payload#>'{draft,title}') is distinct from 'string'
    or jsonb_typeof(p_payload#>'{draft,description}') is distinct from 'string'
    or (p_payload->'draft') - array['title','description'] <> '{}'::jsonb
  ) then
    raise exception 'Invalid enquiry draft fields' using errcode='22023';
  end if;
  if template is null then
    template := private.save_course_template(null, jsonb_build_object(
      'owner_organisation_id', enquiry.organisation_id,
      'title', coalesce(p_payload#>>'{draft,title}', enquiry.payload->>'topic'),
      'description', coalesce(p_payload#>>'{draft,description}', enquiry.payload->>'message'),
      'prerequisites', '',
      'topic_ids', '[]'::jsonb
    ));$new$);
  execute definition;
end;
$draft$;

commit;
