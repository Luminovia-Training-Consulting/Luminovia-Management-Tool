begin;
-- Preserve the guest's own-profile/role access inside the existing policies.
-- Separate permissive policies are ORed by PostgreSQL and trigger advisor
-- warnings; the explicit guest predicate keeps the same narrow access.
alter policy profile_read on public.profiles using(
 (select private.actor_active()) and
 (id=(select auth.uid()) or (select private.has_permission('users.manage')))
 or ((select private.guest_actor()) and id=(select auth.uid()))
);
alter policy profile_edit on public.profiles using(
 ((select private.actor_active()) and id=(select auth.uid()))
 or ((select private.guest_actor()) and id=(select auth.uid()))
) with check(
 ((select private.actor_active()) and id=(select auth.uid()))
 or ((select private.guest_actor()) and id=(select auth.uid()))
);
alter policy own_roles on public.user_roles using(
 ((select private.actor_active()) and user_id=(select auth.uid()))
 or ((select private.guest_actor()) and user_id=(select auth.uid()))
);
drop policy guest_own_profile_read on public.profiles;
drop policy guest_own_profile_edit on public.profiles;
drop policy guest_own_roles on public.user_roles;
notify pgrst,'reload schema';
commit;
