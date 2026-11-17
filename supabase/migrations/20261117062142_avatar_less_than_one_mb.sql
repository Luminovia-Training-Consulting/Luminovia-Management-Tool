begin;

-- Existing clean selections remain readable. Enforce the new limit on any
-- newly reserved or modified avatar metadata; actual bytes are also checked
-- by the files gateway before storage and after upload.
create or replace function private.validate_avatar_document_metadata() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.kind='avatar' and (new.scope<>'personal' or new.owner_id<>new.uploaded_by
   or new.mime_type<>'image/png' or new.size_bytes>=1000000) then
  raise exception 'Invalid avatar metadata' using errcode='22023';
 end if;
 return new;
end;$$;
create or replace function private.validate_avatar_version_metadata() returns trigger
language plpgsql set search_path='' as $$
begin
 if exists(select 1 from public.documents d where d.id=new.document_id and d.kind='avatar')
   and (new.mime_type<>'image/png' or new.size_bytes>=1000000) then
  raise exception 'Invalid avatar metadata' using errcode='22023';
 end if;
 return new;
end;$$;

commit;
