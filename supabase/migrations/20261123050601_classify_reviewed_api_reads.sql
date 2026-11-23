begin;

-- These invoker wrappers delegate exclusively to their stable private reads.
-- This exposes no new privileges and preserves the existing POST contracts.
alter function public.course_submissions(uuid, uuid) stable;
alter function public.lecturer_reviews(uuid) stable;
alter function public.managed_profile(uuid) stable;
alter function public.own_profile_details() stable;
alter function public.people_directory(text, text, uuid) stable;
alter function public.person_profile(uuid) stable;
alter function public.profile_courses(uuid) stable;
alter function public.reviewable_courses() stable;
alter function public.taxonomy_catalogue(text, text, boolean) stable;

commit;
