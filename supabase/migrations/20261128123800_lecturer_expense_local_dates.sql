begin;

-- Expense dates are entered in the acting user's profile time zone. Compare
-- them with that same local day rather than the database session's UTC day.
do $migration$
declare
  definition text := pg_catalog.pg_get_functiondef(
    'private.lecturer_expense_action(text,uuid,integer,jsonb,uuid)'::regprocedure
  );
  old_text text;
  new_text text;
begin
  old_text := '  reference text;' || chr(10);
  new_text := old_text || '  actor_day date;' || chr(10);
  if strpos(definition, old_text) = 0 then
    raise exception 'Unexpected lecturer expense action declarations';
  end if;
  definition := replace(definition, old_text, new_text);

  old_text := '  if not coalesce(private.expense_access(for_staff), false) then raise insufficient_privilege; end if;';
  new_text := old_text || chr(10) ||
    '  select (statement_timestamp() at time zone profile.time_zone)::date into actor_day from public.profiles profile where profile.id = who;' || chr(10) ||
    '  if actor_day is null then raise insufficient_privilege; end if;';
  if strpos(definition, old_text) = 0 then
    raise exception 'Unexpected lecturer expense access gate';
  end if;
  definition := replace(definition, old_text, new_text);

  old_text := 'spent > current_date or amount <= 0';
  if strpos(definition, old_text) = 0 then
    raise exception 'Unexpected lecturer expense submission date check';
  end if;
  definition := replace(definition, old_text, 'spent > actor_day or amount <= 0');

  old_text := 'paid > current_date';
  if strpos(definition, old_text) = 0 then
    raise exception 'Unexpected lecturer expense reimbursement date check';
  end if;
  definition := replace(definition, old_text, 'paid > actor_day');

  execute definition;
end;
$migration$;

commit;
