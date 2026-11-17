begin;
-- Keep guest access owner-scoped while evaluating auth.uid() once per query.
alter policy portal_members_only on public.profiles
using (
  (select private.actor_active())
  or ((select private.guest_actor()) and id=(select auth.uid()))
)
with check (
  (select private.actor_active())
  or ((select private.guest_actor()) and id=(select auth.uid()))
);

alter policy portal_members_only on public.user_roles
using (
  (select private.actor_active())
  or ((select private.guest_actor()) and user_id=(select auth.uid()))
)
with check (
  (select private.actor_active())
  or ((select private.guest_actor()) and user_id=(select auth.uid()))
);
commit;
