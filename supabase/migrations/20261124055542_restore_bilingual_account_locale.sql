begin;

-- Translate existing account settings in place before revalidating the constraint.
lock table public.profiles in access exclusive mode;
update public.profiles set locale = 'de' where locale = 'de-CH';

alter table public.profiles drop constraint profiles_locale_check;
alter table public.profiles add constraint profiles_locale_check
  check (locale in ('de', 'en'));

-- Change only the allowed languages in the current account validation paths.
do $$
declare
  target regprocedure;
  definition text;
  previous constant text := '(''de'',''en'',''de-CH'')';
begin
  foreach target in array array[
    'private.save_ui_preferences(jsonb)'::regprocedure,
    'private.save_account_profile(jsonb)'::regprocedure,
    'private.write_basic_account_profile(uuid,jsonb,jsonb,uuid)'::regprocedure
  ] loop
    definition := pg_catalog.pg_get_functiondef(target);
    if cardinality(string_to_array(definition, previous)) <> 2 then
      raise exception 'Expected one account locale validation in %', target;
    end if;
    execute replace(definition, previous, '(''de'',''en'')');
  end loop;
end;
$$;

commit;
