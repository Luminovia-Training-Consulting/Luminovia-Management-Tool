begin;

-- An offer captures the regular/senior rates accepted under the compensation
-- policy. A lecturer without a personal override must keep that captured rate;
-- otherwise the personal-profile default silently replaces it with 50 percent.
create or replace function private.lecturer_job_quote(p_user_id uuid,p_job_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare cfg private.lecturer_compensation;j public.jobs;o private.job_commission_offers;
        n numeric;total numeric;days integer;units numeric;quote_percent numeric;
begin
 select * into j from public.jobs where id=p_job_id;
 if not found or not private.lecturer_user(p_user_id) then return null;end if;
 select * into o from private.job_commission_offers where job_id=p_job_id;
 if o.job_id is null or o.pricing_mode<>'role_split' then
  return jsonb_build_object('amount',j.amount,'total_amount',j.total_amount,'currency',j.currency,'rate_unit',j.rate_unit);
 end if;
 select * into cfg from private.lecturer_compensation where user_id=p_user_id;
 if coalesce(cfg.mode,'percent')='percent' then
  quote_percent:=case when cfg.user_id is not null then cfg.percent
   when exists(select 1 from public.user_roles where user_id=p_user_id and role='senior_lecturer') then o.senior_percent
   else o.regular_percent end;
  n=round(o.gross_amount*coalesce(quote_percent,50)/100,2);
  total=round(o.gross_total_amount*coalesce(quote_percent,50)/100,2);
 else
  if cfg.currency<>j.currency then return null;end if;
  select count(distinct d::date) into days from public.job_sessions s
   cross join lateral generate_series((s.starts_at at time zone j.time_zone)::date,
    ((s.ends_at-interval '1 microsecond') at time zone j.time_zone)::date,interval '1 day') d
   where s.job_id=j.id;
  if days<1 then return null;end if;
  total=round(cfg.daily_rate*days,2);
  units=case when j.rate_unit='fixed_total' then 1 when j.rate_unit='per_day' then days
   else (select sum(extract(epoch from ends_at-starts_at))/3600 from public.job_sessions where job_id=j.id) end;
  if units is null or units<=0 then return null;end if;
  n=round(total/units,2);
 end if;
 if n is null or total is null or n>o.gross_amount or total>o.gross_total_amount then return null;end if;
 return jsonb_build_object('amount',n,'total_amount',total,'currency',j.currency,'rate_unit',j.rate_unit);
end;$$;

commit;
