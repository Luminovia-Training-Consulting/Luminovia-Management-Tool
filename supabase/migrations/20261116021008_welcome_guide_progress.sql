-- Welcome progress is personal presentation state, never an authorisation source.
-- No target user ID is accepted by either RPC and no administrator bypass exists.
create table private.welcome_progress (
 user_id uuid primary key references public.profiles(id) on delete cascade,
 step text not null check(step in ('welcome','profile','security','jobs','availability','client','calendar','collaboration','files','contracts','notifications','administration','finish')),
 status text not null check(status in ('active','paused','completed','skipped')),
 version integer not null check(version>0),
 updated_at timestamptz not null default now()
);
alter table private.welcome_progress enable row level security;
create policy welcome_progress_own on private.welcome_progress to authenticated
 using(user_id=(select auth.uid()) and (select private.actor_active()))
 with check(user_id=(select auth.uid()) and (select private.actor_active()));
revoke all on private.welcome_progress from public,anon,authenticated;

create function private.get_welcome_progress() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare p private.welcome_progress;
begin
 if auth.uid() is null or not private.actor_active() then raise exception 'Active account required' using errcode='42501';end if;
 select * into p from private.welcome_progress where user_id=auth.uid();
 return jsonb_build_object('step',coalesce(p.step,'welcome'),'status',coalesce(p.status,'active'),'version',coalesce(p.version,0));
end;$$;
create function public.get_welcome_progress() returns jsonb
language sql stable security invoker set search_path='' as $$select private.get_welcome_progress();$$;

create function private.save_welcome_progress(p_step text,p_status text,p_expected_version integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare saved integer;
begin
 if auth.uid() is null or not private.actor_active() then raise exception 'Active account required' using errcode='42501';end if;
 if p_expected_version is null or p_expected_version<0 or p_expected_version>=2147483647
 or p_step is null or p_step not in ('welcome','profile','security','jobs','availability','client','calendar','collaboration','files','contracts','notifications','administration','finish')
 or p_status is null or p_status not in ('active','paused','completed','skipped') then
  raise exception 'Invalid welcome progress' using errcode='22023';
 end if;
 if p_expected_version=0 then
  insert into private.welcome_progress(user_id,step,status,version) values(auth.uid(),p_step,p_status,1)
   on conflict(user_id) do nothing returning version into saved;
 else
  update private.welcome_progress set step=p_step,status=p_status,version=version+1,updated_at=now()
   where user_id=auth.uid() and version=p_expected_version returning version into saved;
 end if;
 if saved is null then raise exception 'Welcome progress changed; reload current version' using errcode='40001';end if;
 return private.get_welcome_progress();
end;$$;
create function public.save_welcome_progress(p_step text,p_status text,p_expected_version integer) returns jsonb
language sql security invoker set search_path='' as $$select private.save_welcome_progress(p_step,p_status,p_expected_version);$$;

revoke all on function private.get_welcome_progress(),public.get_welcome_progress(),
 private.save_welcome_progress(text,text,integer),public.save_welcome_progress(text,text,integer) from public,anon;
grant execute on function private.get_welcome_progress(),public.get_welcome_progress(),
 private.save_welcome_progress(text,text,integer),public.save_welcome_progress(text,text,integer) to authenticated;
