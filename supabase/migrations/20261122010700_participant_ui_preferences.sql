begin;

-- The internal REST gate already admits both own-UI calls for confirmed
-- participant-only accounts. Apply the same actor check inside those functions.
-- A company's membership controls company data, independently of these settings.
do $$
declare
  target regprocedure;
  definition text;
  previous_check constant text := 'not (private.actor_active() or private.guest_actor())';
  current_check constant text := 'not (private.actor_active() or private.guest_actor() or private.participant_actor())';
begin
  foreach target in array array[
    'private.ui_preferences()'::regprocedure,
    'private.save_ui_preferences(jsonb)'::regprocedure
  ] loop
    definition := pg_catalog.pg_get_functiondef(target);
    if cardinality(string_to_array(definition, previous_check)) <> 2 then
      raise exception 'Expected one own UI actor check in %', target;
    end if;
    execute replace(definition, previous_check, current_check);
  end loop;
end;
$$;

commit;
