begin;

alter table public.course_runs
  add column creation_origin text not null default 'unknown'
    check (creation_origin in ('staff', 'company', 'unknown'));

-- Use only creation events from staff-only operations in the same transaction.
-- The current organisation or current roles cannot prove historical authorship.
update public.course_runs run
set creation_origin = 'staff'
where exists (
  select 1
  from public.audit_events event
  where event.resource_id = run.id
    and event.created_at = run.created_at
    and event.action = 'course.run.duplicated'
) or exists (
  select 1
  from public.jobs job
  join public.audit_events event on event.resource_id = job.id
  where job.course_run_id = run.id
    and job.created_at = run.created_at
    and event.created_at = run.created_at
    and event.action = 'job.capacity_created'
);

-- Capture the authorised creator's context before any later role or company change.
create function private.record_course_run_origin() returns trigger
language plpgsql set search_path = '' as $function$
begin
  if tg_op = 'UPDATE' then
    new.creation_origin := old.creation_origin;
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

revoke all on function private.record_course_run_origin() from public, anon, authenticated, service_role;

create trigger course_run_origin_capture
before insert or update of creation_origin on public.course_runs
for each row execute function private.record_course_run_origin();

notify pgrst, 'reload schema';

commit;
