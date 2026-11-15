begin;

-- Avatars reuse private, scanned document versions. Selecting one never grants
-- readers access to its personal document, other versions or a Storage URL.
alter table public.documents drop constraint documents_kind_check;
alter table public.documents add constraint documents_kind_check
 check(kind in ('material','chat','cv','certificate','contract','invoice','avatar'));

create function private.validate_avatar_document_metadata() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.kind='avatar' and (new.scope<>'personal' or new.owner_id<>new.uploaded_by
   or new.mime_type<>'image/png' or new.size_bytes>2097152) then
  raise exception 'Invalid avatar metadata' using errcode='22023';
 end if;
 return new;
end;$$;
create function private.validate_avatar_version_metadata() returns trigger
language plpgsql set search_path='' as $$
begin
 if exists(select 1 from public.documents d where d.id=new.document_id and d.kind='avatar')
   and (new.mime_type<>'image/png' or new.size_bytes>2097152) then
  raise exception 'Invalid avatar metadata' using errcode='22023';
 end if;
 return new;
end;$$;
create trigger documents_avatar_metadata before insert or update of kind,scope,owner_id,uploaded_by,mime_type,size_bytes
 on public.documents for each row execute function private.validate_avatar_document_metadata();
create trigger versions_avatar_metadata before insert or update of document_id,mime_type,size_bytes
 on public.document_versions for each row execute function private.validate_avatar_version_metadata();
revoke all on function private.validate_avatar_document_metadata(),private.validate_avatar_version_metadata() from public,anon,authenticated;

create table public.profile_avatars (
 user_id uuid primary key references public.profiles(id) on delete cascade,
 document_version_id uuid not null references public.document_versions(id),
 updated_at timestamptz not null default now()
);
create index profile_avatars_version on public.profile_avatars(document_version_id);
alter table public.profile_avatars enable row level security;
revoke all on public.profile_avatars from public,anon,authenticated;
grant select on public.profile_avatars to authenticated;
grant all on public.profile_avatars to service_role;
create policy profile_avatars_own on public.profile_avatars for select to authenticated
 using((select private.actor_active()) and user_id=(select auth.uid()));

create function private.profile_avatar(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.can_read_person(p_user_id) then
  raise exception 'Profile access denied' using errcode='42501';
 end if;
 return (select jsonb_build_object('version_id',v.id,'updated_at',a.updated_at)
  from public.profile_avatars a
  join public.document_versions v on v.id=a.document_version_id
  join public.documents d on d.id=v.document_id
  where a.user_id=p_user_id and d.owner_id=a.user_id and d.kind='avatar'
   and d.scope='personal' and d.deleted_at is null and v.status='clean'
   and v.mime_type='image/png' and v.size_bytes<=2097152 and v.sha256 is not null);
end;$$;
create function public.profile_avatar(p_user_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$select private.profile_avatar(p_user_id);$$;

create function private.set_profile_avatar(p_version_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare previous uuid;
begin
 -- The same profile row also serialises suspension. Recheck activity after
 -- obtaining the lock, including when a concurrent administrator held it first.
 perform 1 from public.profiles where id=auth.uid() for update;
 if not private.actor_active() then
  raise exception 'Active login required' using errcode='42501';
 end if;
 -- Failed uploads never displace a previously selected clean exact version.
 select document_version_id into previous from public.profile_avatars where user_id=auth.uid();
 if p_version_id is not null and not exists(
  select 1 from public.document_versions v join public.documents d on d.id=v.document_id
  where v.id=p_version_id and d.owner_id=auth.uid() and d.uploaded_by=auth.uid()
   and d.scope='personal' and d.kind='avatar' and d.deleted_at is null
   and v.status='clean' and v.sha256 is not null and v.mime_type='image/png' and v.size_bytes<=2097152
 ) then
  raise exception 'Own clean avatar version required' using errcode='42501';
 end if;
 if previous is distinct from p_version_id then
  if p_version_id is null then
   delete from public.profile_avatars where user_id=auth.uid();
  else
   insert into public.profile_avatars(user_id,document_version_id) values(auth.uid(),p_version_id)
   on conflict(user_id) do update set document_version_id=excluded.document_version_id,updated_at=now();
  end if;
  insert into public.audit_events(actor_id,action,resource_id,details)
   values(auth.uid(),case when p_version_id is null then 'profile.avatar_removed' else 'profile.avatar_selected' end,
    auth.uid(),jsonb_build_object('version_id',p_version_id));
 end if;
 return private.profile_avatar(auth.uid());
end;$$;
create function public.set_profile_avatar(p_version_id uuid default null) returns jsonb
language sql security invoker set search_path='' as $$select private.set_profile_avatar(p_version_id);$$;

revoke all on function private.profile_avatar(uuid),public.profile_avatar(uuid),private.set_profile_avatar(uuid),public.set_profile_avatar(uuid)
 from public,anon,authenticated;
grant execute on function private.profile_avatar(uuid),public.profile_avatar(uuid),private.set_profile_avatar(uuid),public.set_profile_avatar(uuid)
 to authenticated;
commit;
