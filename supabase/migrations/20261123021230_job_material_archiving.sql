-- Use the existing document archive operation for shared job materials.
-- Staff may remove them without taking ownership or editing their metadata.
create or replace function private.rename_document(
  p_id uuid,
  p_name text,
  p_delete boolean default false
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  document public.documents;
begin
  perform 1 from public.profiles where id = auth.uid() and active for share;
  if not found then
    raise exception 'Active account required' using errcode = '42501';
  end if;

  select * into document from public.documents where id = p_id for update;
  if not found or not private.can_access_document(p_id) then
    raise exception 'Document access required' using errcode = '42501';
  end if;

  if document.owner_id <> auth.uid() then
    if p_delete is distinct from true
      or document.scope not in ('job_before', 'job_after')
      or document.kind <> 'material'
      or document.job_id is null
      or not private.has_permission('jobs.manage') then
      raise exception 'Owner or job material archive permission required' using errcode = '42501';
    end if;
    update public.documents set deleted_at = now() where id = p_id;
  else
    if p_name is null or length(trim(p_name)) not between 1 and 200
      or p_name ~ '[[:cntrl:]/\\]' then
      raise exception 'Invalid name' using errcode = '22023';
    end if;
    update public.documents
    set original_name = trim(p_name),
        deleted_at = case when p_delete then now() else deleted_at end
    where id = p_id;
  end if;

  insert into public.audit_events(actor_id, action, resource_id)
  values (
    auth.uid(),
    case when p_delete then 'document.deleted' else 'document.renamed' end,
    p_id
  );
end;
$$;
