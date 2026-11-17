begin;

-- Notifications are recipient-owned inbox rows, not durable audit history.
-- A deleted account must not be blocked by its remaining inbox entries.
alter table public.notifications
  drop constraint notifications_user_id_fkey,
  add constraint notifications_user_id_fkey
    foreign key (user_id) references public.profiles(id) on delete cascade;

commit;
