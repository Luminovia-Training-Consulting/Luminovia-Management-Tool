begin;

-- Combine equivalent permissive SELECT branches. The restrictive portal
-- policies and profile write policies still apply independently.
alter policy profile_read on public.profiles using (
  ((select private.actor_active()) and
    (id = (select auth.uid()) or (select private.has_permission('users.manage'))))
  or (((select private.guest_actor()) or (select private.participant_actor()))
    and id = (select auth.uid()))
);
drop policy participant_own_profile_read on public.profiles;

alter policy own_roles on public.user_roles using (
  ((select private.actor_active()) or (select private.guest_actor()) or
    (select private.participant_actor()))
  and user_id = (select auth.uid())
);
drop policy participant_own_role_read on public.user_roles;

commit;
