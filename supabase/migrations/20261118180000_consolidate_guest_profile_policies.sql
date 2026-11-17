begin;
-- Guest access stays owner-scoped by the restrictive portal policies. Merge
-- guest checks into the existing permissive profile/role policies to avoid
-- redundant policies for the same authenticated actions.
drop policy guest_own_profile_read on public.profiles;
drop policy guest_own_profile_edit on public.profiles;
drop policy guest_own_roles on public.user_roles;

alter policy profile_read on public.profiles
using (
  ((select private.actor_active()) and
    (id=(select auth.uid()) or (select private.has_permission('users.manage'))))
  or ((select private.guest_actor()) and id=(select auth.uid()))
);

alter policy profile_edit on public.profiles
using (
  ((select private.actor_active()) or (select private.guest_actor()))
  and id=(select auth.uid())
)
with check (
  ((select private.actor_active()) or (select private.guest_actor()))
  and id=(select auth.uid())
);

alter policy own_roles on public.user_roles
using (
  ((select private.actor_active()) or (select private.guest_actor()))
  and user_id=(select auth.uid())
);
commit;
