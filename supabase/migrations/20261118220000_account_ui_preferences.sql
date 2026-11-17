begin;

-- Personal presentation state. The actor is always taken from the JWT, never from a payload.
create table private.account_ui_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  theme text not null default 'system' check (theme in ('system','light','dark')),
  sidebar_collapsed boolean not null default false,
  version integer not null default 0 check (version >= 0),
  updated_at timestamptz not null default now()
);
alter table private.account_ui_preferences enable row level security;
revoke all on private.account_ui_preferences from public, anon, authenticated;

create function private.ui_preferences() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not (private.actor_active() or private.guest_actor()) then raise exception 'Active account required' using errcode='42501'; end if;
  select jsonb_build_object('language',p.locale,'theme',coalesce(u.theme,'system'),
    'sidebar_collapsed',coalesce(u.sidebar_collapsed,false),'version',coalesce(u.version,0))
    into result from public.profiles p left join private.account_ui_preferences u on u.user_id=p.id
    where p.id=auth.uid();
  return result;
end;$$;
create function public.ui_preferences() returns jsonb
language sql stable security invoker set search_path='' as $$select private.ui_preferences();$$;

create function private.save_ui_preferences(p_patch jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare current_state private.account_ui_preferences;
begin
  if not (private.actor_active() or private.guest_actor()) then raise exception 'Active account required' using errcode='42501'; end if;
  if p_patch is null or jsonb_typeof(p_patch)<>'object' or p_patch='{}'::jsonb
    or exists(select 1 from jsonb_object_keys(p_patch) k where k not in ('language','theme','sidebar_collapsed'))
    or (p_patch?'language' and (jsonb_typeof(p_patch->'language')<>'string' or p_patch->>'language' not in ('de','en')))
    or (p_patch?'theme' and (jsonb_typeof(p_patch->'theme')<>'string' or p_patch->>'theme' not in ('system','light','dark')))
    or (p_patch?'sidebar_collapsed' and jsonb_typeof(p_patch->'sidebar_collapsed')<>'boolean') then
    raise exception 'Invalid UI preferences' using errcode='22023';
  end if;
  -- Serialise first-write and patch updates for this account without exposing table grants.
  perform 1 from public.profiles where id=auth.uid() and active for update;
  insert into private.account_ui_preferences(user_id) values(auth.uid()) on conflict do nothing;
  select * into current_state from private.account_ui_preferences where user_id=auth.uid() for update;
  update private.account_ui_preferences set
    theme=case when p_patch?'theme' then p_patch->>'theme' else current_state.theme end,
    sidebar_collapsed=case when p_patch?'sidebar_collapsed' then (p_patch->>'sidebar_collapsed')::boolean else current_state.sidebar_collapsed end,
    version=current_state.version+1, updated_at=now()
    where user_id=auth.uid();
  if p_patch?'language' then
    update public.profiles set locale=p_patch->>'language' where id=auth.uid();
  end if;
  return private.ui_preferences();
end;$$;
create function public.save_ui_preferences(p_patch jsonb) returns jsonb
language sql security invoker set search_path='' as $$select private.save_ui_preferences(p_patch);$$;

revoke all on function private.ui_preferences(),public.ui_preferences(),private.save_ui_preferences(jsonb),public.save_ui_preferences(jsonb) from public,anon,authenticated;
grant execute on function private.ui_preferences(),public.ui_preferences(),private.save_ui_preferences(jsonb),public.save_ui_preferences(jsonb) to authenticated;

-- The guest gateway admits only own-profile and own-presentation calls.
create or replace function public.require_portal_access() returns void
language plpgsql stable security invoker set search_path='' as $$
declare path text:=coalesce(current_setting('request.path',true),'');
begin
  if current_setting('role',true)='authenticated' and not private.actor_active() then
    if not private.guest_actor() or path not in
      ('/profiles','/user_roles','/rpc/portal_access','/rpc/get_my_permissions',
       '/rpc/account_me','/rpc/save_account_profile','/rpc/ui_preferences','/rpc/save_ui_preferences') then
      raise exception 'Operational portal access required' using errcode='42501';
    end if;
  end if;
end;$$;

commit;
