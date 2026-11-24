begin;

-- Service writes may create or import a run without a verified human author.
-- Keep the trigger invoker-scoped and avoid the human-only permission helpers
-- for those writes while preserving the stored origin on every update.
create or replace function private.record_course_run_origin() returns trigger
language plpgsql set search_path = '' as $function$
begin
  if tg_op = 'UPDATE' then
    new.creation_origin := old.creation_origin;
  elsif current_user = 'service_role' or auth.uid() is null then
    new.creation_origin := 'unknown';
  elsif private.has_permission('courses.manage') or private.has_permission('jobs.manage') then
    new.creation_origin := 'staff';
  elsif private.client_has_organisation(new.organisation_id) then
    new.creation_origin := 'company';
  else
    new.creation_origin := 'unknown';
  end if;
  return new;
end;
$function$;

commit;
