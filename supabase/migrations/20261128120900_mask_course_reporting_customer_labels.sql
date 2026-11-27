-- Keep personal reporting available for teaching preparation, and apply the
-- same disclosure checks to its organization/class labels and search filters.
begin;
do $migration$
declare
  definition text;
  labels constant text := 'template.title, org.name as organisation, class.name as class_name';
  class_filter constant text := 'or strpos(lower(coalesce(class.name, '''')), search) > 0)';
  class_label constant text := '''class_name'', selected_class.name';
  may_disclose constant text := '(p_scope <> ''personal'' or private.can_read_course_customer(run.id))';
begin
  definition := pg_get_functiondef('private.learning_analytics_report(text,date,date,uuid,text,text,integer)'::regprocedure);
  if cardinality(string_to_array(definition,labels))<>2
    or cardinality(string_to_array(definition,class_filter))<>2 then
    raise exception 'Unexpected personal analytics customer labels';
  end if;
  definition := replace(definition,labels,
    'template.title, case when ' || may_disclose || ' then org.name else '''' end as organisation, '
    || 'case when ' || may_disclose || ' then class.name end as class_name');
  execute replace(definition,class_filter,
    'or (strpos(lower(coalesce(class.name, '''')), search) > 0 and ' || may_disclose || '))');

  definition := pg_get_functiondef('private.course_attendance_summary(uuid,uuid)'::regprocedure);
  if cardinality(string_to_array(definition,class_label))<>2 then
    raise exception 'Unexpected attendance class label';
  end if;
  execute replace(definition,class_label,
    '''class_name'', case when private.can_read_course_customer(p_run_id) then selected_class.name end');
end;
$migration$;
commit;
