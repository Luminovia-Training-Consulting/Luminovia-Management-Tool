begin;

-- Distinguish an actual per-person override from its role-based editor default.
-- The individual table remains private and no user's amount is returned without
-- the same gross-finance capability required by the existing public wrapper.
create or replace function private.lecturer_compensation(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  configured private.lecturer_compensation%rowtype;
  role_percent numeric(5,2);
begin
  if not private.has_permission('finance.gross.read') then
    raise exception 'Compensation administration required' using errcode = '42501';
  end if;
  if not private.lecturer_user(p_user_id) then
    raise exception 'Active lecturer required' using errcode = '22023';
  end if;
  select * into configured
  from private.lecturer_compensation
  where user_id = p_user_id;
  if found then
    return jsonb_build_object(
      'mode', configured.mode,
      'percent', configured.percent,
      'daily_rate', configured.daily_rate,
      'currency', configured.currency,
      'version', configured.version,
      'is_customized', true
    );
  end if;

  select case
    when exists (
      select 1 from public.user_roles
      where user_id = p_user_id and role = 'senior_lecturer'
    ) then coalesce((select senior_percent from private.compensation_policy where singleton), 50)
    else coalesce((select regular_percent from private.compensation_policy where singleton), 50)
  end into role_percent;
  return jsonb_build_object(
    'mode', 'percent',
    'percent', role_percent,
    'daily_rate', 200,
    'currency', 'EUR',
    'version', 1,
    'is_customized', false
  );
end;
$$;

-- Uncustomized lecturers inherit the role percentage captured on this offer;
-- saved per-person percentage or fixed-day settings remain stronger overrides.
-- The quote still uses the exact accepted job's currency, gross and sessions.
create or replace function private.lecturer_job_quote(
  p_user_id uuid, p_job_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  configured private.lecturer_compensation%rowtype;
  job_row public.jobs%rowtype;
  offer_row private.job_commission_offers%rowtype;
  customized boolean;
  role_percent numeric(5,2);
  net_amount numeric;
  net_total numeric;
  teaching_days integer;
  units numeric;
begin
  select * into job_row from public.jobs where id = p_job_id;
  if not found or not private.lecturer_user(p_user_id) then return null; end if;
  select * into offer_row
  from private.job_commission_offers where job_id = p_job_id;
  if offer_row.job_id is null or offer_row.pricing_mode <> 'role_split' then
    return jsonb_build_object(
      'amount', job_row.amount,
      'total_amount', job_row.total_amount,
      'currency', job_row.currency,
      'rate_unit', job_row.rate_unit
    );
  end if;

  select * into configured
  from private.lecturer_compensation where user_id = p_user_id;
  customized := found;
  if not customized or configured.mode = 'percent' then
    role_percent := case
      when customized then configured.percent
      when exists (
        select 1 from public.user_roles
        where user_id = p_user_id and role = 'senior_lecturer'
      ) then coalesce(offer_row.senior_percent, 50)
      else coalesce(offer_row.regular_percent, 50)
    end;
    net_amount := round(offer_row.gross_amount * role_percent / 100, 2);
    net_total := round(offer_row.gross_total_amount * role_percent / 100, 2);
  else
    if configured.currency <> job_row.currency then return null; end if;
    select count(distinct day_value::date) into teaching_days
    from public.job_sessions session
    cross join lateral generate_series(
      (session.starts_at at time zone job_row.time_zone)::date,
      ((session.ends_at - interval '1 microsecond') at time zone job_row.time_zone)::date,
      interval '1 day'
    ) day_value
    where session.job_id = job_row.id;
    if teaching_days < 1 then return null; end if;
    net_total := round(configured.daily_rate * teaching_days, 2);
    units := case
      when job_row.rate_unit = 'fixed_total' then 1
      when job_row.rate_unit = 'per_day' then teaching_days
      else (
        select sum(extract(epoch from ends_at - starts_at)) / 3600
        from public.job_sessions where job_id = job_row.id
      )
    end;
    if units is null or units <= 0 then return null; end if;
    net_amount := round(net_total / units, 2);
  end if;

  if net_amount is null or net_total is null or
     net_amount > offer_row.gross_amount or
     net_total > offer_row.gross_total_amount then
    return null;
  end if;
  return jsonb_build_object(
    'amount', net_amount,
    'total_amount', net_total,
    'currency', job_row.currency,
    'rate_unit', job_row.rate_unit
  );
end;
$$;

notify pgrst, 'reload schema';
commit;