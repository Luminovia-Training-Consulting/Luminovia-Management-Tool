begin;
-- Resolve invoice titles and links at read time using current resource authority.
alter function private.notification_target(text,uuid) rename to notification_target_before_finance_inbox;
create function private.notification_target(p_kind text,p_resource uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare heading text;
begin
 if p_kind in('invoice_submitted','invoice_approved','invoice_paid','invoice_rejected','invoice_cancelled','payment_received') then
  select number into heading from public.invoices where id=p_resource and private.can_read_invoice(id);
  return jsonb_build_object('href',case when found then '/finance' else null end,'title',coalesce(heading,''));
 end if;
 return private.notification_target_before_finance_inbox(p_kind,p_resource);
end;$$;
revoke all on function private.notification_target_before_finance_inbox(text,uuid),private.notification_target(text,uuid) from public,anon,authenticated,service_role;
create function private.notify_invoice_activity() returns trigger
language plpgsql security definer set search_path='' as $$
declare activity_kind text;
begin
 if tg_op='UPDATE' and old.status=new.status then return new;end if;
 activity_kind='invoice_'||new.status;
 insert into public.notifications(user_id,kind,resource_id) values(new.user_id,activity_kind,new.id)
 on conflict(user_id,kind,resource_id) do update set created_at=clock_timestamp(),read_at=null;
 return new;
end;$$;
create trigger invoice_inbox_activity after insert or update of status on public.invoices for each row execute function private.notify_invoice_activity();
create function private.notify_invoice_payment() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.voided_at is null then
  insert into public.notifications(user_id,kind,resource_id)
   select user_id,'payment_received',id from public.invoices where id=new.invoice_id
  on conflict(user_id,kind,resource_id) do update set created_at=clock_timestamp(),read_at=null;
 end if;
 return new;
end;$$;
create trigger payment_inbox_activity after insert on public.payment_records for each row execute function private.notify_invoice_payment();
revoke all on function private.notify_invoice_activity(),private.notify_invoice_payment() from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
