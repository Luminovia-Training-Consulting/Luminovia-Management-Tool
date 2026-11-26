begin;

create or replace function private.calendar_subscription_snapshot(p_token_hash text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  s private.calendar_subscriptions;
  items jsonb;
begin
  if not private.recheck_calendar_subscription(p_token_hash) then
    return null;
  end if;

  select * into s
  from private.calendar_subscriptions
  where token_hash = p_token_hash;

  select coalesce(jsonb_agg(to_jsonb(item) order by item.starts_at, item.id), '[]'::jsonb)
  into items
  from (
    select * from (
      select a.id, 'assignment'::text kind, j.title, a.starts_at, a.ends_at, j.time_zone
      from public.assignment_sessions a
      join public.job_claims c on c.id = a.claim_id
      join public.jobs j on j.id = c.job_id
      where c.lecturer_id = s.user_id
        and a.lecturer_id = s.user_id
        and c.status = 'confirmed'
        and a.released_at is null
        and a.starts_at < now() + interval '365 days'
        and a.ends_at > now() - interval '30 days'
        and private.lecturer_user(s.user_id)
        and not private.job_lecturer_blocked(j.id, s.user_id)
      union all
      select e.id, 'private'::text kind, e.title, e.starts_at, e.ends_at, e.time_zone
      from public.personal_events e
      where s.include_private
        and e.user_id = s.user_id
        and e.starts_at < now() + interval '365 days'
        and e.ends_at > now() - interval '30 days'
    ) available
    order by starts_at, id
    limit 2001
  ) item;

  if jsonb_array_length(items) > 2000 then
    raise exception 'Calendar feed size limit reached' using errcode = '54000';
  end if;

  return jsonb_build_object('label', s.label, 'items', items);
end;
$$;

commit;