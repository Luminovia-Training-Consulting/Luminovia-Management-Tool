begin;

-- Actual teaching time is evidence; it never recalculates an accepted fee.
create table private.teaching_timesheets (
 id uuid primary key,
 session_id uuid not null unique references public.assignment_sessions(id),
 lecturer_id uuid not null references public.profiles(id),
 starts_at timestamptz not null,
 ends_at timestamptz not null,
 break_minutes integer not null default 0 check(break_minutes>=0),
 note text not null default '' check(length(note)<=2000),
 state text not null default 'draft' check(state in('draft','submitted','approved','rejected')),
 version integer not null default 1 check(version>0),
 reviewed_by uuid references public.profiles(id),
 reviewed_at timestamptz,
 review_note text not null default '' check(length(review_note)<=1000),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(isfinite(starts_at) and isfinite(ends_at) and ends_at>starts_at and ends_at-starts_at<=interval '24 hours'),
 check(break_minutes<floor(extract(epoch from ends_at-starts_at)/60)),
 exclude using gist(lecturer_id with =,tstzrange(starts_at,ends_at,'[)') with &&) where(state<>'rejected')
);
create index timesheets_lecturer_start on private.teaching_timesheets(lecturer_id,starts_at,id);
create index timesheets_review on private.teaching_timesheets(state,starts_at,id);
create index timesheets_reviewer on private.teaching_timesheets(reviewed_by) where reviewed_by is not null;
create table private.teaching_timesheet_history (
 id uuid primary key default gen_random_uuid(),
 timesheet_id uuid not null references private.teaching_timesheets(id),
 actor_id uuid not null references public.profiles(id),
 action text not null,
 before_state jsonb,
 after_state jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
create index timesheet_history_entry on private.teaching_timesheet_history(timesheet_id,created_at,id);
create index timesheet_history_actor on private.teaching_timesheet_history(actor_id);
create table private.teaching_timesheet_requests (
 actor_id uuid not null references public.profiles(id),
 request_id uuid not null,
 payload jsonb not null,
 result jsonb not null,
 primary key(actor_id,request_id)
);
alter table private.teaching_timesheets enable row level security;
alter table private.teaching_timesheet_history enable row level security;
alter table private.teaching_timesheet_requests enable row level security;
revoke all on private.teaching_timesheets,private.teaching_timesheet_history,private.teaching_timesheet_requests from public,anon,authenticated,service_role;

create function private.finance_period(p_from date,p_until date) returns void language plpgsql immutable set search_path='' as $$
begin
 if p_from is null or p_until is null or not isfinite(p_from) or not isfinite(p_until) or p_until<=p_from or p_until-p_from>93 then
  raise exception 'Finite exclusive date period up to 93 days required' using errcode='22023';end if;
end;$$;
create function private.timesheet_json(p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select to_jsonb(t)||jsonb_build_object('claim_id',c.id,'job_id',j.id,'title',j.title,'lecturer_name',p.display_name,
  'time_zone',j.time_zone,'minutes',floor(extract(epoch from t.ends_at-t.starts_at)/60)::integer-t.break_minutes)
 from private.teaching_timesheets t join public.assignment_sessions s on s.id=t.session_id
 join public.job_claims c on c.id=s.claim_id join public.jobs j on j.id=c.job_id join public.profiles p on p.id=t.lecturer_id where t.id=p_id;
$$;
create function private.timesheets(p_from date,p_until date,p_all boolean default false) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare zone text;begins timestamptz;ends timestamptz;result jsonb;
begin
 if not private.actor_active() or (p_all and not private.has_permission('finance.manage')) then raise exception 'Own account or finance.manage and MFA required' using errcode='42501';end if;
 if p_all is null then raise exception 'Explicit timesheet scope required' using errcode='22023';end if;
 perform private.finance_period(p_from,p_until);
 select time_zone into zone from public.profiles where id=auth.uid();begins=p_from::timestamp at time zone zone;ends=p_until::timestamp at time zone zone;
 result=jsonb_build_object('time_zone',zone,'can_review',private.has_permission('finance.manage'),
  'items',coalesce((select jsonb_agg(private.timesheet_json(t.id) order by t.starts_at desc,t.id)
   from (select id,starts_at from private.teaching_timesheets where (lecturer_id=auth.uid() or p_all)
    and starts_at<ends and ends_at>begins order by starts_at desc,id limit 501)t),'[]'::jsonb),
  'sessions',coalesce((select jsonb_agg(to_jsonb(item) order by item.starts_at,item.id) from (
   select s.id,c.id claim_id,j.id job_id,j.title,s.starts_at,s.ends_at,j.time_zone,
    not exists(select 1 from public.invoice_items i where i.claim_id=c.id) editable
   from public.assignment_sessions s join public.job_claims c on c.id=s.claim_id join public.jobs j on j.id=c.job_id
   where s.lecturer_id=auth.uid() and c.lecturer_id=auth.uid() and c.status='confirmed' and s.released_at is null
    and s.starts_at<ends and s.ends_at>begins and s.starts_at<now()
   order by s.starts_at,s.id limit 501)item),'[]'::jsonb));
 if jsonb_array_length(result->'items')>500 or jsonb_array_length(result->'sessions')>500 then raise exception 'Too many records; select a shorter time period' using errcode='54000';end if;
 return result;
end;$$;
create function public.timesheets(p_from date,p_until date,p_all boolean default false) returns jsonb language sql stable security invoker set search_path='' as $$select private.timesheets(p_from,p_until,p_all);$$;

create function private.save_timesheet(p_id uuid,p_payload jsonb,p_expected_version integer default 0) returns jsonb
language plpgsql security definer set search_path='' as $$
declare previous private.teaching_timesheets;s public.assignment_sessions;c public.job_claims;starts timestamptz;ends timestamptz;
 pause integer;v_note text;result jsonb;
begin
 if not private.lecturer_actor() then raise exception 'Active lecturer required' using errcode='42501';end if;
 if p_id is null or p_expected_version is null or p_expected_version<0 or jsonb_typeof(p_payload) is distinct from 'object'
 or (select count(*) from jsonb_object_keys(p_payload))<>5 or not(p_payload ?& array['session_id','starts_at','ends_at','break_minutes','note'])
 or jsonb_typeof(p_payload->'session_id')<>'string' or jsonb_typeof(p_payload->'starts_at')<>'string' or jsonb_typeof(p_payload->'ends_at')<>'string'
 or jsonb_typeof(p_payload->'break_minutes')<>'number' or jsonb_typeof(p_payload->'note')<>'string' then raise exception 'Exact timesheet fields required' using errcode='22023';end if;
 if (p_payload->>'starts_at')!~'(Z|[+-][0-9]{2}:[0-9]{2})$' or (p_payload->>'ends_at')!~'(Z|[+-][0-9]{2}:[0-9]{2})$'
 or (p_payload->>'break_minutes')!~'^[0-9]{1,4}$' then raise exception 'Explicit offset instants and integral break minutes required' using errcode='22023';end if;
 starts=(p_payload->>'starts_at')::timestamptz;ends=(p_payload->>'ends_at')::timestamptz;pause=(p_payload->>'break_minutes')::integer;v_note=p_payload->>'note';
 if not isfinite(starts) or not isfinite(ends) or ends<=starts or ends>clock_timestamp() or ends-starts>interval '24 hours'
 or floor(extract(epoch from ends-starts)/60)-pause<=0 or length(v_note)>2000 then raise exception 'Valid completed teaching interval required' using errcode='22023';end if;
 perform 1 from public.profiles where id=auth.uid() and active for share;
 if not found then raise exception 'Active lecturer required' using errcode='42501';end if;
 -- Same lecturer mutex as claims, cancellation, invoice submission and review.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text,0));
 select * into s from public.assignment_sessions where id=(p_payload->>'session_id')::uuid;
 select * into c from public.job_claims where id=s.claim_id for update;
 if s.id is null or s.lecturer_id<>auth.uid() or c.lecturer_id<>auth.uid() or c.status<>'confirmed' or s.released_at is not null then raise exception 'Own confirmed teaching session required' using errcode='42501';end if;
 if starts<s.starts_at or ends>s.ends_at then raise exception 'Actual teaching time must fit its accepted session' using errcode='22023';end if;
 if exists(select 1 from public.invoice_items where claim_id=c.id) then raise exception 'Invoiced work time is frozen, including invoice history' using errcode='22023';end if;
 select * into previous from private.teaching_timesheets where id=p_id for update;
 if found then
  if previous.lecturer_id<>auth.uid() or previous.session_id<>s.id then raise exception 'Timesheet access denied' using errcode='42501';end if;
  if p_expected_version=0 and previous.version=1 and previous.state='draft' and row(previous.starts_at,previous.ends_at,previous.break_minutes,previous.note) is not distinct from row(starts,ends,pause,v_note) then return private.timesheet_json(p_id);end if;
  if previous.version<>p_expected_version then raise exception 'Timesheet changed; reload' using errcode='40001';end if;
  if previous.state not in('draft','rejected') then raise exception 'Submitted and approved versions are immutable' using errcode='22023';end if;
  update private.teaching_timesheets set starts_at=starts,ends_at=ends,break_minutes=pause,note=v_note,state='draft',version=version+1,updated_at=clock_timestamp(),reviewed_by=null,reviewed_at=null,review_note='' where id=p_id;
 else
  if p_expected_version<>0 then raise exception 'Timesheet unavailable' using errcode='42501';end if;
  insert into private.teaching_timesheets(id,session_id,lecturer_id,starts_at,ends_at,break_minutes,note) values(p_id,s.id,auth.uid(),starts,ends,pause,v_note);
 end if;
 result=private.timesheet_json(p_id);
 insert into private.teaching_timesheet_history(timesheet_id,actor_id,action,before_state,after_state) values(p_id,auth.uid(),'saved',case when previous.id is null then null else to_jsonb(previous) end,result);
 insert into public.audit_events(actor_id,action,resource_id) values(auth.uid(),'timesheet.saved',p_id);
 return result;
end;$$;
create function public.save_timesheet(p_id uuid,p_payload jsonb,p_expected_version integer default 0) returns jsonb language sql security invoker set search_path='' as $$select private.save_timesheet(p_id,p_payload,p_expected_version);$$;

create function private.manage_timesheet(p_id uuid,p_action text,p_expected_version integer,p_request_id uuid,p_reason text default '') returns jsonb
language plpgsql security definer set search_path='' as $$
declare t private.teaching_timesheets;c public.job_claims;request private.teaching_timesheet_requests;payload jsonb;result jsonb;
begin
 if not private.actor_active() then raise exception 'Active account required' using errcode='42501';end if;
 if p_action is null or p_action not in('submit','approve','reject','request_correction') or p_expected_version is null or p_request_id is null
 or p_reason is null or length(p_reason)>1000 or (p_action in('reject','request_correction') and length(trim(p_reason))<5) then raise exception 'Valid explicit timesheet action and reason required' using errcode='22023';end if;
 select * into t from private.teaching_timesheets where id=p_id;
 if t.id is null or (p_action='submit' and (t.lecturer_id<>auth.uid() or not private.lecturer_actor()))
 or (p_action<>'submit' and not private.has_permission('finance.manage')) then raise exception 'Own submission or finance.manage and MFA required' using errcode='42501';end if;
 perform 1 from public.profiles where id in(auth.uid(),t.lecturer_id) order by id for share;
 if not private.actor_active() then raise exception 'Active account required' using errcode='42501';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('timesheet-request:'||auth.uid()::text||p_request_id::text,0));
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(t.lecturer_id::text,0));
 payload=jsonb_build_object('id',p_id,'action',p_action,'version',p_expected_version,'reason',p_reason);
 select * into request from private.teaching_timesheet_requests where actor_id=auth.uid() and request_id=p_request_id;
 if found then if request.payload<>payload then raise exception 'Timesheet action idempotency conflict' using errcode='22023';end if;return request.result;end if;
 select c0.* into c from public.job_claims c0 join public.assignment_sessions s on s.claim_id=c0.id where s.id=t.session_id for update of c0;
 select * into t from private.teaching_timesheets where id=p_id for update;
 if t.version<>p_expected_version then raise exception 'Timesheet changed; reload' using errcode='40001';end if;
 if c.status<>'confirmed' or exists(select 1 from public.invoice_items where claim_id=c.id) then raise exception 'Cancelled or invoiced work is frozen' using errcode='22023';end if;
 if (p_action='submit' and t.state<>'draft') or (p_action in('approve','reject') and t.state<>'submitted') or (p_action='request_correction' and t.state<>'approved') then raise exception 'Invalid timesheet state transition' using errcode='22023';end if;
 update private.teaching_timesheets set state=case when p_action='submit' then 'submitted' when p_action='approve' then 'approved' else 'rejected' end,
  version=version+1,reviewed_by=case when p_action='submit' then null else auth.uid() end,reviewed_at=case when p_action='submit' then null else clock_timestamp() end,
  review_note=p_reason,updated_at=clock_timestamp() where id=p_id;
 result=private.timesheet_json(p_id);
 insert into private.teaching_timesheet_history(timesheet_id,actor_id,action,before_state,after_state) values(p_id,auth.uid(),p_action,to_jsonb(t),result);
 insert into private.teaching_timesheet_requests(actor_id,request_id,payload,result) values(auth.uid(),p_request_id,payload,result);
 insert into public.audit_events(actor_id,action,resource_id) values(auth.uid(),'timesheet.'||p_action,p_id);
 if p_action<>'submit' then insert into public.notifications(user_id,kind,resource_id) values(t.lecturer_id,'timesheet_reviewed',p_id)
  on conflict(user_id,kind,resource_id) do update set read_at=null,created_at=clock_timestamp();end if;
 return result;
end;$$;
create function public.manage_timesheet(p_id uuid,p_action text,p_expected_version integer,p_request_id uuid,p_reason text default '') returns jsonb language sql security invoker set search_path='' as $$select private.manage_timesheet(p_id,p_action,p_expected_version,p_request_id,p_reason);$$;

create function private.timesheet_history(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.actor_active() or not exists(select 1 from private.teaching_timesheets t where t.id=p_id and (t.lecturer_id=auth.uid() or private.has_permission('finance.manage'))) then raise exception 'Timesheet history access denied' using errcode='42501';end if;
 return coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at,h.id) from private.teaching_timesheet_history h where timesheet_id=p_id),'[]'::jsonb);
end;$$;
create function public.timesheet_history(p_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$select private.timesheet_history(p_id);$$;

create function private.assignment_confirmation(p_claim_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c public.job_claims;data jsonb;
begin
 if not private.actor_active() then raise exception 'Active account required' using errcode='42501';end if;
 select * into c from public.job_claims where id=p_claim_id;
 if c.id is null or not(c.lecturer_id=auth.uid() or private.has_permission('jobs.manage')) then raise exception 'Assignment confirmation unavailable' using errcode='42501';end if;
 select jsonb_build_object('type','assignment_confirmation','claim_id',c.id,'status',c.status,'accepted_at',c.created_at,
  'lecturer_name',p.display_name,'title',j.title,'customer_name',j.customer_name,'time_zone',j.time_zone,
  'amount',c.amount,'total_amount',c.total_amount,'currency',c.currency,'rate_unit',c.rate_unit,'terms',c.terms,'terms_version',c.terms_version,
  'sessions',coalesce((select jsonb_agg(jsonb_build_object('starts_at',s.starts_at,'ends_at',s.ends_at,'released_at',s.released_at) order by s.starts_at,s.id) from public.assignment_sessions s where s.claim_id=c.id),'[]'::jsonb)) into data
 from public.jobs j join public.profiles p on p.id=c.lecturer_id where j.id=c.job_id;
 return jsonb_build_object('data',data,'hash',encode(sha256(convert_to(data::text,'UTF8')),'hex'));
end;$$;
create function public.assignment_confirmation(p_claim_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$select private.assignment_confirmation(p_claim_id);$$;


create function private.claim_paid_amount(p_claim uuid) returns numeric language sql stable security definer set search_path='' as $$
 with invoices as(
  select i.id,i.total_amount,coalesce((select sum(p.amount) from public.payment_records p where p.invoice_id=i.id and p.voided_at is null),0) paid
  from public.invoice_items item join public.invoices i on i.id=item.invoice_id where item.claim_id=p_claim and item.active and i.status not in('cancelled','rejected')
 ), raw as(
  select invoice.id invoice_id,item.claim_id,invoice.paid,invoice.paid*c.total_amount/invoice.total_amount*100 cents
  from invoices invoice join public.invoice_items item on item.invoice_id=invoice.id and item.active join public.job_claims c on c.id=item.claim_id
 ), allocated as(
  select r.*,floor(cents) base_cents,row_number() over(partition by invoice_id order by cents-floor(cents) desc,claim_id) priority,
   round(paid*100)-sum(floor(cents)) over(partition by invoice_id) remaining from raw r
 )select coalesce(sum((base_cents+case when priority<=remaining then 1 else 0 end)/100) filter(where claim_id=p_claim),0) from allocated;
$$;
revoke all on function private.claim_paid_amount(uuid) from public,anon,authenticated,service_role;

create function private.finance_statement(p_from date,p_until date,p_all boolean default false) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare data jsonb;claims jsonb;totals jsonb;minutes jsonb;zone text;begins timestamptz;ends timestamptz;person text;
begin
 if not private.actor_active() or (p_all and not private.has_permission('finance.manage')) then raise exception 'Own statement or finance.manage and MFA required' using errcode='42501';end if;
 if p_all is null then raise exception 'Explicit statement scope required' using errcode='22023';end if;
 perform private.finance_period(p_from,p_until);
 select time_zone,display_name into zone,person from public.profiles where id=auth.uid();begins=p_from::timestamp at time zone zone;ends=p_until::timestamp at time zone zone;
 with entries as(
  select c.id claim_id,c.lecturer_id,p.display_name lecturer_name,j.title,j.customer_name,c.status,c.amount,c.total_amount,c.currency,c.rate_unit,c.created_at accepted_at,
   sessions.starts_at,sessions.ends_at,
   case when c.status='cancelled' then 'cancelled' when sessions.ends_at<=now() then 'completed' else 'expected' end stage,
   bill.id invoice_id,bill.number invoice_number,bill.status invoice_status,bill.due_on,
   private.claim_paid_amount(c.id) paid_amount
  from public.job_claims c join public.jobs j on j.id=c.job_id join public.profiles p on p.id=c.lecturer_id
  cross join lateral(select min(starts_at) starts_at,max(ends_at) ends_at from public.assignment_sessions where claim_id=c.id)sessions
  left join lateral(select i.* from public.invoice_items item join public.invoices i on i.id=item.invoice_id where item.claim_id=c.id and item.active and i.status not in('rejected','cancelled') order by i.created_at desc,i.id limit 1)bill on true
  where (p_all or c.lecturer_id=auth.uid()) and sessions.starts_at>=begins and sessions.starts_at<ends
  order by sessions.starts_at,c.id limit 1001
 )select coalesce(jsonb_agg(to_jsonb(e) order by e.starts_at,e.claim_id),'[]'::jsonb) into claims from entries e;
 if jsonb_array_length(claims)>1000 then raise exception 'Too many assignments; select a shorter statement period' using errcode='54000';end if;
 select coalesce(jsonb_agg(to_jsonb(t) order by t.currency),'[]'::jsonb) into totals from(
  select x->>'currency' currency,
   coalesce(sum((x->>'total_amount')::numeric) filter(where x->>'stage'='expected'),0) expected,
   coalesce(sum((x->>'total_amount')::numeric) filter(where x->>'stage'='completed'),0) completed,
   coalesce(sum((x->>'total_amount')::numeric) filter(where x->>'status'='confirmed' and x->>'invoice_id' is not null),0) invoiced,
   coalesce(sum((x->>'paid_amount')::numeric),0) paid
  from jsonb_array_elements(claims)x group by x->>'currency')t;
 select coalesce(jsonb_agg(to_jsonb(t) order by t.claim_id),'[]'::jsonb) into minutes from(
  select s.claim_id,sum(floor(extract(epoch from t.ends_at-t.starts_at)/60)::integer-t.break_minutes)::integer minutes
  from private.teaching_timesheets t join public.assignment_sessions s on s.id=t.session_id
  where t.state='approved' and (p_all or t.lecturer_id=auth.uid()) and exists(select 1 from jsonb_array_elements(claims)c where (c->>'claim_id')::uuid=s.claim_id)
  group by s.claim_id)t;
 data=jsonb_build_object('type','finance_statement','from',p_from,'until',p_until,'time_zone',zone,'scope',case when p_all then 'management' else 'own' end,
  'account_name',person,'period_basis','assignment_start','claims',claims,'totals',totals,'approved_minutes',minutes);
 return jsonb_build_object('data',data,'hash',encode(sha256(convert_to(data::text,'UTF8')),'hex'));
end;$$;
create function public.finance_statement(p_from date,p_until date,p_all boolean default false) returns jsonb language sql stable security invoker set search_path='' as $$select private.finance_statement(p_from,p_until,p_all);$$;

create function private.finance_forecast(p_from date,p_until date,p_pipeline_probability numeric default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;can_gross boolean;zone text;begins timestamptz;ends timestamptz;
begin
 if not private.has_permission('finance.manage') then raise exception 'finance.manage and MFA required' using errcode='42501';end if;
 perform private.finance_period(p_from,p_until);
 if p_pipeline_probability is null or p_pipeline_probability<0 or p_pipeline_probability>1 or p_pipeline_probability::text in('NaN','Infinity','-Infinity') then raise exception 'Explicit pipeline probability from zero to one required' using errcode='22023';end if;
 can_gross=private.has_permission('finance.gross.read');select time_zone into zone from public.profiles where id=auth.uid();
 begins=p_from::timestamp at time zone zone;ends=p_until::timestamp at time zone zone;
 with accepted as(
  select date_trunc('month',sessions.starts_at at time zone zone)::date as month,c.currency,c.total_amount cost,
   case when can_gross then l.gross_total_amount end gross,
   case when can_gross and l.claim_id is not null then l.gross_total_amount-c.total_amount end margin,
   case when l.claim_id is null then 1 else 0 end unknown_gross
  from public.job_claims c cross join lateral(select min(starts_at) starts_at from public.assignment_sessions where claim_id=c.id)sessions
  left join private.claim_revenue_ledger l on l.claim_id=c.id where c.status='confirmed' and sessions.starts_at>=begins and sessions.starts_at<ends
 ), offers as(
  select date_trunc('month',sessions.starts_at at time zone zone)::date as month,j.currency,
   (j.capacity-(select count(*) from public.job_claims c where c.job_id=j.id and c.status='confirmed'))::numeric slots,j.total_amount cost,
   case when can_gross then fee.gross_total_amount end gross
  from public.jobs j cross join lateral(select min(starts_at) starts_at from public.job_sessions where job_id=j.id)sessions
  left join private.job_commission_offers fee on fee.job_id=j.id where j.status='published' and (j.claim_deadline is null or j.claim_deadline>now())
   and sessions.starts_at>now() and sessions.starts_at>=begins and sessions.starts_at<ends
 ), requests as(
  select date_trunc('month',(r.payload->'sessions'->0->>'starts_at')::timestamptz at time zone zone)::date as month,r.payload->>'currency' currency,
   case when can_gross then (r.payload->>'gross_total_amount')::numeric end gross
  from private.client_course_requests r where can_gross and r.job_id is null and r.status='submitted'
   and (r.payload->'sessions'->0->>'starts_at')::timestamptz>now() and (r.payload->'sessions'->0->>'starts_at')::timestamptz>=begins and (r.payload->'sessions'->0->>'starts_at')::timestamptz<ends
 ), payment_entries as(
  select date_trunc('month',p.paid_at at time zone zone)::date as month,p.currency,p.amount
  from public.payment_records p where p.voided_at is null and p.paid_at>=begins and p.paid_at<ends
 ), buckets as(select a.month,a.currency from accepted a union select o.month,o.currency from offers o union select r.month,r.currency from requests r union select p.month,p.currency from payment_entries p)
 select coalesce(jsonb_agg(jsonb_build_object('month',b.month,'currency',b.currency,
  'accepted_lecturer_cost',coalesce((select sum(cost) from accepted a where a.month=b.month and a.currency=b.currency),0),
  'accepted_gross_known',case when can_gross then coalesce((select sum(gross) from accepted a where a.month=b.month and a.currency=b.currency),0) end,
  'accepted_margin_known',case when can_gross then coalesce((select sum(margin) from accepted a where a.month=b.month and a.currency=b.currency),0) end,
  'unknown_gross_claims',case when can_gross then coalesce((select sum(unknown_gross) from accepted a where a.month=b.month and a.currency=b.currency),0) end,
  'pipeline_lecturer_cost_known',coalesce((select round(sum(cost*slots)*p_pipeline_probability,2) from offers o where o.month=b.month and o.currency=b.currency),0),
  'pipeline_gross_known',case when can_gross then coalesce((select round(sum(gross*slots)*p_pipeline_probability,2) from offers o where o.month=b.month and o.currency=b.currency),0)+coalesce((select round(sum(gross)*p_pipeline_probability,2) from requests r where r.month=b.month and r.currency=b.currency),0) end,
  'lecturer_invoice_payments',coalesce((select sum(amount) from payment_entries p where p.month=b.month and p.currency=b.currency),0)) order by b.month,b.currency),'[]'::jsonb) into result from buckets b;
 return jsonb_build_object('from',p_from,'until',p_until,'time_zone',zone,'pipeline_probability',p_pipeline_probability,'gross_authorized',can_gross,
  'payment_basis','lecturer_invoice_payment_records','months',result);
end;$$;
create function public.finance_forecast(p_from date,p_until date,p_pipeline_probability numeric default 0) returns jsonb language sql stable security invoker set search_path='' as $$select private.finance_forecast(p_from,p_until,p_pipeline_probability);$$;

create function private.control_center(p_from date,p_until date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare zone text;begins timestamptz;ends timestamptz;result jsonb;
begin
 if not private.has_permission('jobs.manage') then raise exception 'jobs.manage and MFA required' using errcode='42501';end if;
 perform private.finance_period(p_from,p_until);
 select time_zone into zone from public.profiles where id=auth.uid();begins=p_from::timestamp at time zone zone;ends=p_until::timestamp at time zone zone;
 result=jsonb_build_object('from',p_from,'until',p_until,'time_zone',zone,
 'unstaffed',coalesce((select jsonb_agg(to_jsonb(x) order by x.starts_at,x.id) from(
  select j.id,j.title,j.customer_name,first_session.starts_at,j.capacity-(select count(*) from public.job_claims c where c.job_id=j.id and c.status='confirmed') open_positions
  from public.jobs j cross join lateral(select min(starts_at) starts_at from public.job_sessions where job_id=j.id)first_session
  where j.status='published' and first_session.starts_at>=begins and first_session.starts_at<ends
   and (select count(*) from public.job_claims c where c.job_id=j.id and c.status='confirmed')<j.capacity order by first_session.starts_at,j.id limit 200)x),'[]'::jsonb),
 'missing_documents',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from(
  select j.id,j.title from public.jobs j where j.status in('published','filled')
   and exists(select 1 from public.job_sessions s where s.job_id=j.id and s.starts_at>=begins and s.starts_at<ends)
   and not exists(select 1 from public.documents d where d.job_id=j.id and d.kind='material' and d.status='clean' and d.deleted_at is null)
  order by j.id limit 200)x),'[]'::jsonb),
 'cancellations',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id) from(
  select c.id,j.id job_id,j.title,c.lecturer_id,e.event_type,e.created_at from public.claim_events e join public.job_claims c on c.id=e.claim_id join public.jobs j on j.id=c.job_id
  where e.event_type in('cancelled','substituted_out') and e.created_at>=begins and e.created_at<ends order by e.created_at desc,c.id limit 200)x),'[]'::jsonb),
 'overdue_tasks',coalesce((select jsonb_agg(to_jsonb(x) order by x.due_at,x.id) from(
  select t.id,t.title,t.due_at,t.state,t.assignee_id from private.work_tasks t where t.state in('open','doing') and t.due_at<now()
   and t.due_at>=begins and t.due_at<ends and private.can_read_work_task(t.id) order by t.due_at,t.id limit 200)x),'[]'::jsonb),
 'requests',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id) from(
  select r.id,r.organisation_id,o.name organisation_name,r.payload->>'title' title,r.status,r.job_id,r.created_at
  from private.client_course_requests r join public.organisations o on o.id=r.organisation_id where r.created_at>=begins and r.created_at<ends
   order by r.created_at desc,r.id limit 200)x),'[]'::jsonb),
 'contracts_expiring',case when private.has_permission('contracts.read') then coalesce((select jsonb_agg(to_jsonb(x) order by x.expires_at,x.id) from(
  select c.id,c.user_id,c.expires_at from public.contracts c where c.status='active' and c.revoked_at is null and c.expires_at>=begins and c.expires_at<ends order by c.expires_at,c.id limit 200)x),'[]'::jsonb) else '[]'::jsonb end,
 'qualifications_expiring',case when private.has_permission('qualifications.verify') then coalesce((select jsonb_agg(to_jsonb(x) order by x.valid_until,x.user_id,x.topic_id) from(
  select t.user_id,t.topic_id,topic.label_de,topic.label_en,t.valid_until from public.lecturer_topics t join public.topics topic on topic.id=t.topic_id
  where t.verified and t.valid_until>=begins and t.valid_until<ends order by t.valid_until,t.user_id,t.topic_id limit 200)x),'[]'::jsonb) else '[]'::jsonb end,
 'preparation',case when private.has_permission('courses.manage') then coalesce((select jsonb_agg(to_jsonb(x) order by x.run_id) from(
  select p.run_id,count(*) total,count(*) filter(where done) complete,count(*) filter(where client_visible) customer_visible from private.course_preparation_items p
  where exists(select 1 from public.course_sessions s where s.course_run_id=p.run_id and s.starts_at>=begins and s.starts_at<ends) group by p.run_id order by p.run_id limit 200)x),'[]'::jsonb) else '[]'::jsonb end,
 'quality',case when private.has_permission('courses.manage') then coalesce((select jsonb_agg(to_jsonb(x) order by x.run_id) from(
  select f.run_id,count(*) responses,case when count(*)>=3 then round(avg(rating),2) end average_rating from private.course_feedback f
  where exists(select 1 from public.course_sessions s where s.course_run_id=f.run_id and s.starts_at>=begins and s.starts_at<ends) group by f.run_id order by f.run_id limit 200)x),'[]'::jsonb) else '[]'::jsonb end);
 return result;
end;$$;
create function public.control_center(p_from date,p_until date) returns jsonb language sql stable security invoker set search_path='' as $$select private.control_center(p_from,p_until);$$;

revoke all on function private.finance_statement(date,date,boolean),public.finance_statement(date,date,boolean),private.finance_forecast(date,date,numeric),public.finance_forecast(date,date,numeric),private.control_center(date,date),public.control_center(date,date) from public,anon,authenticated;
grant execute on function private.finance_statement(date,date,boolean),public.finance_statement(date,date,boolean),private.finance_forecast(date,date,numeric),public.finance_forecast(date,date,numeric),private.control_center(date,date),public.control_center(date,date) to authenticated;


create function private.timesheet_notification_target(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare heading text;day date;zone text;
begin
 if not private.actor_active() then return null;end if;
 select p.time_zone into zone from public.profiles p where p.id=auth.uid();
 select j.title,(t.starts_at at time zone zone)::date into heading,day from private.teaching_timesheets t
  join public.assignment_sessions s on s.id=t.session_id join public.job_claims c on c.id=s.claim_id join public.jobs j on j.id=c.job_id
  where t.id=p_id and (t.lecturer_id=auth.uid() or private.has_permission('finance.manage'));
 if not found then return null;end if;
 return jsonb_build_object('title',heading,'href','/timesheets?from='||day::text||'&until='||(day+1)::text||'&timesheet='||p_id::text);
end;$$;
revoke all on function private.timesheet_notification_target(uuid) from public,anon,authenticated,service_role;

revoke all on function private.finance_period(date,date),private.timesheet_json(uuid) from public,anon,authenticated,service_role;
revoke all on function private.timesheets(date,date,boolean),public.timesheets(date,date,boolean),private.save_timesheet(uuid,jsonb,integer),public.save_timesheet(uuid,jsonb,integer),
 private.manage_timesheet(uuid,text,integer,uuid,text),public.manage_timesheet(uuid,text,integer,uuid,text),private.timesheet_history(uuid),public.timesheet_history(uuid),
 private.assignment_confirmation(uuid),public.assignment_confirmation(uuid) from public,anon,authenticated;
grant execute on function private.timesheets(date,date,boolean),public.timesheets(date,date,boolean),private.save_timesheet(uuid,jsonb,integer),public.save_timesheet(uuid,jsonb,integer),
 private.manage_timesheet(uuid,text,integer,uuid,text),public.manage_timesheet(uuid,text,integer,uuid,text),private.timesheet_history(uuid),public.timesheet_history(uuid),
 private.assignment_confirmation(uuid),public.assignment_confirmation(uuid) to authenticated;
commit;
