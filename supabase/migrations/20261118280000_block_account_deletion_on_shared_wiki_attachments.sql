begin;

-- A document owner can contribute a file to another author's wiki page.
-- The generic owned-resource graph follows document_versions and would
-- otherwise absorb that shared wiki row into an account purge. Keep it out of
-- the account's owned scope so the existing FK blocker requires the share to
-- be removed explicitly before the source account can be deleted.
alter function private.deletion_scope(text,uuid)
 rename to deletion_scope_before_account_wiki_attachment_blocker;

create function private.deletion_scope(p_kind text,p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb:=private.deletion_scope_before_account_wiki_attachment_blocker(p_kind,p_id);
begin
 if p_kind='account' then
  select coalesce(jsonb_agg(entry order by ordinal),'[]'::jsonb) into result
  from jsonb_array_elements(result) with ordinality as scopes(entry,ordinal)
  where entry->>'table'<>'private.wiki_revision_attachments';
 end if;
 return result;
end $$;

revoke all on function private.deletion_scope_before_account_wiki_attachment_blocker(text,uuid),
 private.deletion_scope(text,uuid) from public,anon,authenticated,service_role;

commit;
