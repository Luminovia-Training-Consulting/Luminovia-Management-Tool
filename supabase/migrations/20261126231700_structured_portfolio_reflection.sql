begin;

alter table private.learning_portfolio_revisions add column reflection jsonb not null default '{}'::jsonb
  check (jsonb_typeof(reflection) = 'object');

create function private.normalize_portfolio_reflection(p_reflection jsonb)
returns jsonb language plpgsql stable strict set search_path = '' as $$
declare
  normalized jsonb := '{}'::jsonb;
  item record;
  value text;
begin
  if jsonb_typeof(p_reflection) <> 'object'
    or p_reflection - array['goal','outcome','next_step'] <> '{}'::jsonb
    then raise invalid_parameter_value; end if;
  for item in select * from jsonb_each(p_reflection) loop
    value := btrim(item.value #>> '{}');
    if jsonb_typeof(item.value) <> 'string' or char_length(value) > 1200
      then raise invalid_parameter_value; end if;
    if value <> '' then normalized := jsonb_set(normalized,array[item.key],to_jsonb(value)); end if;
  end loop;
  return normalized;
end;
$$;

revoke all on function private.normalize_portfolio_reflection(jsonb) from public, anon, authenticated, service_role;

do $migration$
declare
  correction record;
  definition text;
begin
  for correction in select * from (values
    (1, 'private.learning_portfolio(uuid,uuid,boolean,integer)',
      'select share.id, revision.title, revision.body, revision.revision, share.shared_at,',
      'select share.id, revision.title, revision.body, revision.reflection, revision.revision, share.shared_at,'),
    (2, 'private.learning_portfolio_command(uuid,text,jsonb,integer)',
      '  body_value text;', '  body_value text;' || chr(10) || '  reflection_value jsonb;'),
    (3, 'private.learning_portfolio_command(uuid,text,jsonb,integer)',
      $old$array['title','body']$old$, $new$array['title','body','reflection']$new$),
    (4, 'private.learning_portfolio_command(uuid,text,jsonb,integer)',
      $old$    if current_revision.title = title_value and current_revision.body = body_value then$old$,
      $new$    reflection_value := coalesce(private.normalize_portfolio_reflection(p_payload->'reflection'),
      current_revision.reflection, '{}'::jsonb);
    if current_revision.title = title_value and current_revision.body = body_value
      and current_revision.reflection = reflection_value then$new$),
    (5, 'private.learning_portfolio_command(uuid,text,jsonb,integer)',
      'learning_portfolio_revisions(entry_id, revision, title, body)',
      'learning_portfolio_revisions(entry_id, revision, title, body, reflection)'),
    (6, 'private.learning_portfolio_command(uuid,text,jsonb,integer)',
      'p_expected_revision + 1, title_value, body_value);',
      'p_expected_revision + 1, title_value, body_value, reflection_value);'),
    (7, 'private.change_learning_portfolio_evidence(uuid,integer,integer,text,jsonb)',
      'learning_portfolio_revisions(entry_id, revision, title, body)',
      'learning_portfolio_revisions(entry_id, revision, title, body, reflection)'),
    (8, 'private.change_learning_portfolio_evidence(uuid,integer,integer,text,jsonb)',
      'p_current + 1, title, body from',
      'p_current + 1, title, body, reflection from')
  ) as changes(position, signature, previous, replacement) order by position
  loop
    definition := pg_catalog.pg_get_functiondef(correction.signature::regprocedure);
    if cardinality(string_to_array(definition, correction.previous)) <> 2 then
      raise exception 'Expected a single reflection change in % at %', correction.signature, correction.position;
    end if;
    execute replace(definition, correction.previous, correction.replacement);
  end loop;
end;
$migration$;

commit;
