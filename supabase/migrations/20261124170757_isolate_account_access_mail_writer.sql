begin;

-- Keep the Edge RPC's signature and service-only scope. Its privileged audit
-- write remains in the private schema under the original service role guard.
alter function public._record_account_access_mail(uuid, boolean) set schema private;

create function public._record_account_access_mail(p_creation_id uuid, p_requested boolean)
returns void language sql security invoker set search_path = '' as $$
  select private._record_account_access_mail(p_creation_id, p_requested);
$$;

revoke all on function
  private._record_account_access_mail(uuid, boolean),
  public._record_account_access_mail(uuid, boolean)
from public, anon, authenticated, service_role;

grant execute on function
  private._record_account_access_mail(uuid, boolean),
  public._record_account_access_mail(uuid, boolean)
to service_role;

notify pgrst, 'reload schema';

commit;
