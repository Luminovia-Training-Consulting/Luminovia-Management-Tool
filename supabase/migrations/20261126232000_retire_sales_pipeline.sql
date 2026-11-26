begin;

-- Remove the public pipeline API and its workers without modifying applied migrations.
drop function public.create_crm_opportunity(uuid, text, numeric, text, uuid),
  public.list_crm_opportunities(uuid, integer),
  public.list_crm_opportunity_page(uuid, text, text, integer, integer),
  public.list_crm_opportunity_events(uuid, uuid, integer),
  public.move_crm_opportunity(uuid, uuid, text, integer, uuid),
  public.update_crm_opportunity_forecast(uuid, uuid, numeric, date, integer, uuid);
drop function private.create_crm_opportunity(uuid, text, numeric, text, uuid),
  private.list_crm_opportunities(uuid, integer),
  private.list_crm_opportunity_page(uuid, text, text, integer, integer),
  private.list_crm_opportunity_events(uuid, uuid, integer),
  private.move_crm_opportunity(uuid, uuid, text, integer, uuid),
  private.update_crm_opportunity_forecast(uuid, uuid, numeric, date, integer, uuid);

-- Preserve closed history in the non-exposed schema. Retained IDs are snapshots
-- and may not block deletion of a company or account in the current application.
drop policy crm_opportunities_staff_read on public.crm_opportunities;
drop policy crm_opportunity_events_staff_read on public.crm_opportunity_events;
revoke all on public.crm_opportunities, public.crm_opportunity_events
  from public, anon, authenticated, service_role;

alter table public.crm_opportunity_events drop constraint crm_opportunity_events_actor_id_fkey;
alter table public.crm_opportunities drop constraint crm_opportunities_organisation_id_fkey,
  drop constraint crm_opportunities_created_by_fkey;

alter table public.crm_opportunities set schema private;
alter table public.crm_opportunity_events set schema private;

comment on table private.crm_opportunities is 'Retired pipeline snapshots. No application role or public API has access.';
comment on table private.crm_opportunity_events is 'Immutable retired pipeline history, scoped to the retained opportunity snapshots.';

-- Ensure an already-running Data API reloads the retired schema surface.
notify pgrst, 'reload schema';

commit;
