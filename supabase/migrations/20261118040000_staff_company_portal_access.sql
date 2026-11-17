begin;
-- Participant and guest records remain as history; only operational roles enter.
create or replace function private.actor_active() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null
 and exists(select 1 from public.profiles where id=auth.uid() and active)
 and exists(select 1 from public.user_roles where user_id=auth.uid() and role in ('owner','admin','management','lecturer','senior_lecturer','client'));
$$;
create function public.portal_access() returns boolean language sql stable security invoker set search_path='' as $$select private.actor_active();$$;
revoke all on function public.portal_access() from public,anon,service_role;
grant execute on function public.portal_access() to authenticated;
-- These restrictive fences compose with every existing resource policy.
do $$declare target record;begin
 for target in select n.nspname,c.relname from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p') and c.relrowsecurity and (n.nspname='public' or (n.nspname='storage' and c.relname='objects')) loop
  execute format('create policy portal_members_only on %I.%I as restrictive for all to authenticated using ((select private.actor_active())) with check ((select private.actor_active()))',target.nspname,target.relname);
 end loop;
end$$;
-- Definer RPCs legitimately bypass resource RLS, so retained participant JWTs
-- are also rejected at the REST request boundary. Anonymous and service paths
-- keep their existing resource permissions.
create function public.require_portal_access() returns void language plpgsql stable security invoker set search_path='' as $$
begin
 if current_setting('role',true)='authenticated' then
  if not private.actor_active() then
   raise exception 'Portal access requires an active lecturer, company or staff account' using errcode='42501';
  end if;
 end if;
end;$$;
revoke all on function public.require_portal_access() from public,anon,service_role;
grant execute on function public.require_portal_access() to authenticated,anon,service_role;
do $$begin
 if exists(select 1 from pg_catalog.pg_roles where rolname='authenticator') then
  execute 'alter role authenticator set pgrst.db_pre_request = ''public.require_portal_access''';
 end if;
end$$;
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
-- Reviews now belong to company contacts, who are not participant enrolments.
-- Existing reviews remain linked to their original course, lecturer and author.
alter table public.course_reviews drop constraint course_reviews_course_run_id_reviewer_id_fkey;
create or replace function private.reviewable_courses() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.actor_active() then raise exception 'Active login required' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('course_run_id',r.id,'title',t.title,'lecturer_id',p.id,'lecturer_name',p.display_name,'ends_at',s.ends_at,'review',case when v.id is not null then jsonb_build_object('id',v.id,'rating',v.rating,'comment',v.comment,'version',v.version,'hidden',v.hidden,'moderation_reason',v.moderation_reason,'deleted',v.deleted_at is not null) end) order by s.ends_at desc,p.display_name)
 from public.course_runs r join public.course_templates t on t.id=r.template_id
 join lateral(select max(ends_at) ends_at from public.course_sessions where course_run_id=r.id) s on s.ends_at<=now()
 join lateral(select distinct c.lecturer_id from public.jobs j join public.job_claims c on c.job_id=j.id where j.course_run_id=r.id and c.status='confirmed') teachers on true
 join public.profiles p on p.id=teachers.lecturer_id and p.active
 left join public.course_reviews v on v.course_run_id=r.id and v.lecturer_id=p.id and v.reviewer_id=auth.uid()
 where private.client_has_organisation(r.organisation_id) and p.id<>auth.uid()),'[]'::jsonb);
end;$$;

create or replace function private.submit_course_review(p_course_run_id uuid,p_lecturer_id uuid,p_rating integer,p_comment text,p_version integer default 0) returns uuid language plpgsql security definer set search_path='' as $$
declare previous public.course_reviews;target uuid;ends timestamptz;
begin
 if not private.actor_active() then raise exception 'Active login required' using errcode='42501';end if;
 if p_lecturer_id=auth.uid() or p_rating is null or p_rating not between 1 and 5 or p_comment is null or length(p_comment)>2000 or p_version is null or p_version<0 then raise exception 'Invalid review' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('course-review:'||p_course_run_id::text||':'||auth.uid()::text||':'||p_lecturer_id::text,0));
 perform 1 from public.profiles where id=auth.uid() for share;
 perform 1 from public.client_organisation_memberships where user_id=auth.uid() and organisation_id=(select organisation_id from public.course_runs where id=p_course_run_id) and removed_at is null for share;
 select max(ends_at) into ends from public.course_sessions where course_run_id=p_course_run_id;
 if ends is null or ends>now() or not exists(select 1 from public.course_runs r where r.id=p_course_run_id and private.client_has_organisation(r.organisation_id)) or not exists(select 1 from public.jobs j join public.job_claims c on c.job_id=j.id where j.course_run_id=p_course_run_id and c.lecturer_id=p_lecturer_id and c.status='confirmed') or not private.profile_staff(p_lecturer_id) then raise exception 'Company membership, completed course and assigned lecturer required' using errcode='42501';end if;
 select * into previous from public.course_reviews where course_run_id=p_course_run_id and lecturer_id=p_lecturer_id and reviewer_id=auth.uid() for update;
 if found then
 if previous.version<>p_version then raise exception 'review_version_conflict' using errcode='40001';end if;
 update public.course_reviews set rating=p_rating,comment=trim(p_comment),version=version+1,deleted_at=null,updated_at=now() where id=previous.id returning id into target;
 else
 if p_version<>0 then raise exception 'review_version_conflict' using errcode='40001';end if;
 insert into public.course_reviews(course_run_id,lecturer_id,reviewer_id,rating,comment) values(p_course_run_id,p_lecturer_id,auth.uid(),p_rating,trim(p_comment)) returning id into target;
 end if;
 insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),'course.review.saved',target,jsonb_build_object('course_run_id',p_course_run_id,'lecturer_id',p_lecturer_id,'version',p_version+1));return target;
end;$$;

commit;
