begin;

-- Invoker security retains RLS, with an additional fixed current-owner scope.
-- A bounded snapshot is downloaded deliberately, never cached by the PWA.
create function public.export_my_calendar(p_from timestamptz,p_until timestamptz,p_include_private boolean default false)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if not private.actor_active() then raise exception 'Active account required' using errcode='42501'; end if;
 if p_from is null or p_until is null or not isfinite(p_from) or not isfinite(p_until)
 or p_until<=p_from or p_until-p_from>interval '93 days' or p_include_private is null then
  raise exception 'Export period must be finite and at most 93 days' using errcode='22023';
 end if;
 select coalesce(jsonb_agg(to_jsonb(item) order by item.starts_at,item.id),'[]'::jsonb) into result
 from (
  select * from (
   select s.id,'assignment'::text as kind,j.title,s.starts_at,s.ends_at,j.time_zone
   from public.assignment_sessions s join public.job_claims c on c.id=s.claim_id join public.jobs j on j.id=c.job_id
   where s.lecturer_id=auth.uid() and c.lecturer_id=auth.uid() and c.status='confirmed' and s.released_at is null
    and s.starts_at<p_until and s.ends_at>p_from
   union all
   select e.id,'private'::text,e.title,e.starts_at,e.ends_at,e.time_zone
   from public.personal_events e where p_include_private and e.user_id=auth.uid()
    and e.starts_at<p_until and e.ends_at>p_from
  ) available order by starts_at,id limit 501
 ) item;
 if jsonb_array_length(result)>500 then
  raise exception 'Too many events; choose a shorter export period' using errcode='54000';
 end if;
 return result;
end;$$;
revoke all on function public.export_my_calendar(timestamptz,timestamptz,boolean) from public,anon,service_role;
grant execute on function public.export_my_calendar(timestamptz,timestamptz,boolean) to authenticated;
commit;
