begin;

alter table public.profiles drop constraint profiles_locale_check;
alter table public.profiles add constraint profiles_locale_check
  check (locale in ('de', 'en', 'de-CH'));

-- Keep the existing actor, permission, locking and optimistic revision rules.
-- The managed profile helper serves both staff and eligible company editors.
do $$
declare
  target regprocedure;
  definition text;
  previous constant text := '(''de'',''en'')';
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
    execute replace(definition, previous, '(''de'',''en'',''de-CH'')');
  end loop;
end;
$$;

-- Background delivery continues to use the two supported template families,
-- including when an older worker briefly overlaps activation of this release.
do $$
declare
  target regprocedure;
  definition text;
  previous constant text := '''locale'',lang';
begin
  foreach target in array array[
    'private.prepare_notification_email(uuid,uuid)'::regprocedure,
    'private.prepare_notification_push(uuid,uuid)'::regprocedure
  ] loop
    definition := pg_catalog.pg_get_functiondef(target);
    if cardinality(string_to_array(definition, previous)) <> 2 then
      raise exception 'Expected one notification locale projection in %', target;
    end if;
    execute replace(definition, previous, '''locale'',split_part(lang,''-'',1)');
  end loop;
end;
$$;

commit;
