begin;
-- A private appointment retains the existing owner-only RLS and column grants.
-- The export/feed/offline snapshots deliberately continue to expose only the
-- previously approved minimal fields; these new details are not added there.
create function private.personal_event_https_url(p_value text) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(length(p_value)<=2000 and p_value~'^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?([/?#][^[:space:]<>"\\]*)?$'
 and p_value!~'[[:cntrl:]]'
 and coalesce(substring(p_value from '^https://[^/:?#]+:([0-9]{1,5})(?:[/?#]|$)')::integer between 1 and 65535,true),false);
$$;
revoke all on function private.personal_event_https_url(text) from public,anon;
grant execute on function private.personal_event_https_url(text) to authenticated,service_role;
alter table public.personal_events
 add column description text not null default '' check(length(description)<=10000),
 add column meeting_url text not null default '' check(meeting_url='' or private.personal_event_https_url(meeting_url));
grant insert(description,meeting_url), update(description,meeting_url) on public.personal_events to authenticated;
commit;
