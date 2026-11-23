-- Share the receiver event ID with authorised readers of delivery history.
-- Keep the existing delivery ID, function signature, grants and scope.
begin;

create or replace function private.company_course_webhook_list(p_organisation uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.company_course_webhook_admin() then raise insufficient_privilege; end if;
  return coalesce((
    select jsonb_agg(
      (to_jsonb(summary) - 'accounting_events') ||
        case when summary.accounting_events then jsonb_build_object('accounting_events',true) else '{}'::jsonb end
      order by summary.active desc,summary.created_at desc,summary.id
    )
    from (
      select s.id,s.destination,s.created_at,s.premium_events,k.label as integration_label,
        s.accounting_issuer is not null as accounting_events,
        private.company_course_webhook_has_scope(k,s) as active,
        (select coalesce(jsonb_agg(to_jsonb(recent) order by recent.occurred_at desc,recent.id),'[]'::jsonb)
         from (select id,event_id,event_type,occurred_at,attempts,
           case when state = 'pending' and (not private.company_course_webhook_has_scope(k,s)
                or not private.company_course_webhook_delivery_current(k.organisation_id,d.premium_version,d.academy_release_commit)) then 'cancelled'
                when state = 'pending' and available_at <= statement_timestamp()
                    and (attempts >= 5 or occurred_at < statement_timestamp()-interval '1 day') then 'failed'
                else state end as state
           from private.company_course_webhook_deliveries d where d.subscription_id = s.id
           order by d.occurred_at desc,d.id desc limit 10) recent) as deliveries
      from private.company_course_webhooks s join private.company_integration_keys k on k.id = s.integration_id
      where k.organisation_id = p_organisation
        and (s.accounting_issuer is null or private.company_accounting_webhook_issuer(auth.uid()))
      order by active desc,s.created_at desc,s.id limit 100
    ) summary
  ),'[]'::jsonb);
end;
$$;

commit;
