begin;
insert into public.role_permissions(role,permission) values('admin','reviews.manage'),('management','reviews.manage'),('owner','reviews.manage') on conflict do nothing;
create table public.profile_details (
 user_id uuid primary key references public.profiles(id) on delete cascade,
 country text not null default '' check(length(country)<=100),
 languages text[] not null default '{}',
 teaching_experience text not null default '' check(length(teaching_experience)<=4000),
 labels text[] not null default '{}',
 updated_at timestamptz not null default now()
);
create table public.course_enrolments (
 course_run_id uuid not null references public.course_runs(id),
 user_id uuid not null references public.profiles(id),
 status text not null default 'enrolled' check(status in('enrolled','completed','removed')),
 enrolled_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 primary key(course_run_id,user_id)
);
create index course_enrolments_enrolled_by on public.course_enrolments(enrolled_by);
create index course_enrolments_user_status on public.course_enrolments(user_id,status,course_run_id);
create table public.course_reviews (
 id uuid primary key default gen_random_uuid(),
 course_run_id uuid not null references public.course_runs(id),
 lecturer_id uuid not null references public.profiles(id),
 reviewer_id uuid not null references public.profiles(id),
 rating integer not null check(rating between 1 and 5),
 comment text not null default '' check(length(comment)<=2000),
 version integer not null default 1 check(version>0),
 hidden boolean not null default false,moderation_reason text not null default '' check(length(moderation_reason)<=1000),
 deleted_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(course_run_id,lecturer_id,reviewer_id),check(lecturer_id<>reviewer_id),
 foreign key(course_run_id,reviewer_id) references public.course_enrolments(course_run_id,user_id)
);
create index course_reviews_lecturer on public.course_reviews(lecturer_id,created_at desc);
create index course_reviews_reviewer on public.course_reviews(reviewer_id);
alter table public.profile_details enable row level security;
alter table public.course_enrolments enable row level security;
alter table public.course_reviews enable row level security;
revoke all on public.profile_details,public.course_enrolments,public.course_reviews from public,anon,authenticated;
grant select on public.profile_details,public.course_enrolments,public.course_reviews to authenticated;
grant all on public.profile_details,public.course_enrolments,public.course_reviews to service_role;
create policy profile_details_own on public.profile_details for select to authenticated using((select private.actor_active()) and user_id=(select auth.uid()));
create policy course_enrolments_scoped on public.course_enrolments for select to authenticated using((select private.actor_active()) and (user_id=(select auth.uid()) or (select private.has_permission('courses.manage'))));
-- Detailed reviewer identity is intentionally not exposed to other lecturers/clients.
create policy course_reviews_private on public.course_reviews for select to authenticated using((select private.actor_active()) and (reviewer_id=(select auth.uid()) or (select private.has_permission('reviews.manage'))));
-- Fold enrolled access into the existing read policies, preserving one policy per action.
alter policy runs_read on public.course_runs using(private.can_read_course_run(id) or ((select private.actor_active()) and exists(select 1 from public.course_enrolments e where e.course_run_id=course_runs.id and e.user_id=(select auth.uid()) and e.status in('enrolled','completed'))));
alter policy course_sessions_read on public.course_sessions using(private.can_read_course_run(course_run_id) or ((select private.actor_active()) and exists(select 1 from public.course_enrolments e where e.course_run_id=course_sessions.course_run_id and e.user_id=(select auth.uid()) and e.status in('enrolled','completed'))));
alter policy templates_read on public.course_templates using(private.can_read_course_template(id) or ((select private.actor_active()) and exists(select 1 from public.course_runs r join public.course_enrolments e on e.course_run_id=r.id where r.template_id=course_templates.id and e.user_id=(select auth.uid()) and e.status in('enrolled','completed'))));


create function private.profile_staff(p_user_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p join public.user_roles r on r.user_id=p.id where p.id=p_user_id and p.active and r.role in('lecturer','senior_lecturer','admin','owner','management'));
$$;
create function private.can_read_profile_course(p_lecturer_id uuid,p_run_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.actor_active() and (auth.uid()=p_lecturer_id or private.profile_staff(auth.uid())
 or exists(select 1 from public.course_enrolments e where e.user_id=auth.uid() and e.course_run_id=p_run_id and e.status in('enrolled','completed'))
 or exists(select 1 from public.course_runs r where r.id=p_run_id and private.client_has_organisation(r.organisation_id)));
$$;
create function private.can_read_person(p_user_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.actor_active() and (p_user_id=auth.uid() or (private.profile_staff(p_user_id) and (private.profile_staff(auth.uid()) or exists(select 1 from public.job_claims c join public.jobs j on j.id=c.job_id where c.lecturer_id=p_user_id and c.status='confirmed' and private.can_read_profile_course(p_user_id,j.course_run_id)))));
$$;
create function private.profile_labels(p_labels jsonb,p_max integer,p_length integer) returns text[] language plpgsql immutable set search_path='' as $$
declare result text[];
begin
 if jsonb_typeof(p_labels)<>'array' or jsonb_array_length(p_labels)>p_max or exists(select 1 from jsonb_array_elements(p_labels) x where jsonb_typeof(x)<>'string') then raise exception 'Invalid labels' using errcode='22023';end if;
 if exists(select 1 from jsonb_array_elements_text(p_labels) x where length(trim(x)) not between 1 and p_length or x~'[[:cntrl:]]') then raise exception 'Invalid labels' using errcode='22023';end if;
 select coalesce(array_agg(value order by lower(value)),'{}'::text[]) into result from(select distinct on(lower(trim(x))) trim(x) value from jsonb_array_elements_text(p_labels) x order by lower(trim(x)),trim(x)) s;
 return result;
end;$$;
create function private.save_profile_details(p_payload jsonb) returns void language plpgsql security definer set search_path='' as $$
declare labels text[];languages text[];
begin
 if not private.actor_active() then raise exception 'Active login required' using errcode='42501';end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or length(coalesce(p_payload->>'country',''))>100 or length(coalesce(p_payload->>'teaching_experience',''))>4000 then raise exception 'Invalid profile details' using errcode='22023';end if;
 if exists(select 1 from jsonb_object_keys(p_payload) k where k not in('country','languages','teaching_experience','labels')) or (p_payload?'country' and jsonb_typeof(p_payload->'country') not in('string','null')) or (p_payload?'teaching_experience' and jsonb_typeof(p_payload->'teaching_experience') not in('string','null')) then raise exception 'Invalid profile details' using errcode='22023';end if;
 labels:=private.profile_labels(coalesce(p_payload->'labels','[]'::jsonb),20,40);languages:=private.profile_labels(coalesce(p_payload->'languages','[]'::jsonb),15,50);
 insert into public.profile_details(user_id,country,languages,teaching_experience,labels) values(auth.uid(),trim(coalesce(p_payload->>'country','')),languages,coalesce(p_payload->>'teaching_experience',''),labels)
 on conflict(user_id) do update set country=excluded.country,languages=excluded.languages,teaching_experience=excluded.teaching_experience,labels=excluded.labels,updated_at=now();
 insert into public.audit_events(actor_id,action,resource_id) values(auth.uid(),'profile.details.saved',auth.uid());
end;$$;
create function public.save_profile_details(p_payload jsonb) returns void language sql security invoker set search_path='' as $$select private.save_profile_details(p_payload);$$;
create function private.own_profile_details() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.actor_active() then raise exception 'Active login required' using errcode='42501';end if;
 return coalesce((select jsonb_build_object('country',country,'languages',languages,'teaching_experience',teaching_experience,'labels',labels) from public.profile_details where user_id=auth.uid()),jsonb_build_object('country','','languages','[]'::jsonb,'teaching_experience','','labels','[]'::jsonb));
end;$$;
create function public.own_profile_details() returns jsonb language sql security invoker set search_path='' as $$select private.own_profile_details();$$;
create function private.lecturer_reviews(p_user_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.can_read_person(p_user_id) then raise exception 'Profile access denied' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'course_run_id',v.course_run_id,'course_title',t.title,'rating',v.rating,'comment',v.comment,'version',v.version,'created_at',v.created_at,'updated_at',v.updated_at,'mine',v.reviewer_id=auth.uid(),'reviewer_label',case when v.reviewer_id=auth.uid() then 'self' else 'participant' end,'reviewer_id',case when v.reviewer_id=auth.uid() or private.has_permission('reviews.manage') then v.reviewer_id end,'hidden',v.hidden,'moderation_reason',case when v.reviewer_id=auth.uid() or private.has_permission('reviews.manage') then v.moderation_reason else '' end) order by v.created_at desc)
 from public.course_reviews v join public.course_runs r on r.id=v.course_run_id join public.course_templates t on t.id=r.template_id join public.course_enrolments e on e.course_run_id=v.course_run_id and e.user_id=v.reviewer_id
 where v.lecturer_id=p_user_id and v.id in(select latest.id from public.course_reviews latest where latest.lecturer_id=p_user_id order by latest.created_at desc,latest.id limit 100) and v.deleted_at is null and e.status='completed' and private.can_read_profile_course(p_user_id,v.course_run_id) and (not v.hidden or v.reviewer_id=auth.uid() or private.has_permission('reviews.manage'))),'[]'::jsonb);
end;$$;
create function public.lecturer_reviews(p_user_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.lecturer_reviews(p_user_id);$$;
create function private.profile_courses(p_user_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.can_read_person(p_user_id) then raise exception 'Profile access denied' using errcode='42501';end if;
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.starts_at desc) from(
 select r.id course_run_id,t.title,r.time_zone,min(s.starts_at) starts_at,max(s.ends_at) ends_at,
 case when max(s.ends_at)<=now() then 'past' when min(s.starts_at)>now() then 'upcoming' else 'current' end state,
 (private.can_read_course_run(r.id) or exists(select 1 from public.course_enrolments own_enrolment where own_enrolment.course_run_id=r.id and own_enrolment.user_id=auth.uid() and own_enrolment.status in('enrolled','completed'))) can_open,
 coalesce((select array_agg(distinct top.id) from public.course_template_topics ct join public.topics top on top.id=ct.topic_id where ct.template_id=t.id),'{}'::uuid[]) topic_ids
 from public.job_claims c join public.jobs j on j.id=c.job_id join public.course_runs r on r.id=j.course_run_id join public.course_templates t on t.id=r.template_id join public.assignment_sessions s on s.claim_id=c.id
 where c.lecturer_id=p_user_id and c.status='confirmed' and private.can_read_profile_course(p_user_id,r.id) group by r.id,t.id) x),'[]'::jsonb);
end;$$;
create function public.profile_courses(p_user_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.profile_courses(p_user_id);$$;

create function private.profile_rating_summary(p_user_id uuid) returns table(rating_average numeric,review_count bigint) language sql stable security definer set search_path='' as $$
 select coalesce(avg(v.rating),0),count(*) from public.course_reviews v join public.course_enrolments e on e.course_run_id=v.course_run_id and e.user_id=v.reviewer_id
 where private.can_read_person(p_user_id) and v.lecturer_id=p_user_id and v.deleted_at is null and not v.hidden and e.status='completed' and private.can_read_profile_course(p_user_id,v.course_run_id);
$$;
create function private.people_directory(p_search text default '',p_label text default '',p_topic_id uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.actor_active() or length(coalesce(p_search,''))>100 or length(coalesce(p_label,''))>40 then raise exception 'Invalid directory request' using errcode='22023';end if;
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.display_name,x.id) from(select p.id,p.display_name,p.bio_de,p.bio_en,p.time_zone,coalesce(d.country,'') country,coalesce(d.languages,'{}'::text[]) languages,coalesce(d.labels,'{}'::text[]) labels,
 coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'label_de',t.label_de,'label_en',t.label_en,'kind',t.kind,'verified',lt.verified and (lt.valid_until is null or lt.valid_until>now()))) from public.lecturer_topics lt join public.topics t on t.id=lt.topic_id where lt.user_id=p.id),'[]'::jsonb) topics,
 stats.rating_average,stats.review_count
 from public.profiles p left join public.profile_details d on d.user_id=p.id cross join lateral private.profile_rating_summary(p.id) stats
 where private.profile_staff(p.id) and private.can_read_person(p.id) and (coalesce(p_search,'')='' or p.display_name ilike '%'||p_search||'%' or p.bio_de ilike '%'||p_search||'%' or p.bio_en ilike '%'||p_search||'%') and (coalesce(p_label,'')='' or exists(select 1 from unnest(d.labels) l where lower(l)=lower(trim(p_label)))) and (p_topic_id is null or exists(select 1 from public.lecturer_topics lt where lt.user_id=p.id and lt.topic_id=p_topic_id))
 order by p.display_name,p.id limit 200) x),'[]'::jsonb);
end;$$;
create function public.people_directory(p_search text default '',p_label text default '',p_topic_id uuid default null) returns jsonb language sql security invoker set search_path='' as $$select private.people_directory(p_search,p_label,p_topic_id);$$;
create function private.person_profile(p_user_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not private.can_read_person(p_user_id) then raise exception 'Profile access denied' using errcode='42501';end if;
 select jsonb_build_object('id',p.id,'display_name',p.display_name,'bio_de',p.bio_de,'bio_en',p.bio_en,'time_zone',p.time_zone,'country',coalesce(d.country,''),'languages',coalesce(d.languages,'{}'::text[]),'labels',coalesce(d.labels,'{}'::text[]),'teaching_experience',coalesce(d.teaching_experience,''),'can_moderate',private.has_permission('reviews.manage'),
 'topics',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'label_de',t.label_de,'label_en',t.label_en,'kind',t.kind,'verified',lt.verified and (lt.valid_until is null or lt.valid_until>now()))) from public.lecturer_topics lt join public.topics t on t.id=lt.topic_id where lt.user_id=p.id),'[]'::jsonb)) into result
 from public.profiles p left join public.profile_details d on d.user_id=p.id where p.id=p_user_id and p.active;
 if result is null then raise exception 'Profile access denied' using errcode='42501';end if;
 return result;
end;$$;
create function public.person_profile(p_user_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.person_profile(p_user_id);$$;

create function private.course_enrolments(p_course_run_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.has_permission('courses.manage') then raise exception 'courses.manage and MFA required' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('user_id',e.user_id,'display_name',p.display_name,'status',e.status,'updated_at',e.updated_at) order by p.display_name) from public.course_enrolments e join public.profiles p on p.id=e.user_id where e.course_run_id=p_course_run_id),'[]'::jsonb);
end;$$;
create function public.course_enrolments(p_course_run_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.course_enrolments(p_course_run_id);$$;
create function private.enrolment_candidates() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.has_permission('courses.manage') then raise exception 'courses.manage and MFA required' using errcode='42501';end if;
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.display_name,x.id) from(select p.id,p.display_name from public.profiles p where p.active and exists(select 1 from public.user_roles r where r.user_id=p.id and r.role in('participant','admin','owner')) order by p.display_name,p.id limit 500) x),'[]'::jsonb);
end;$$;
create function public.enrolment_candidates() returns jsonb language sql security invoker set search_path='' as $$select private.enrolment_candidates();$$;
create function private.manage_course_enrolment(p_course_run_id uuid,p_user_id uuid,p_status text) returns void language plpgsql security definer set search_path='' as $$
declare previous text;ends timestamptz;
begin
 if not private.has_permission('courses.manage') then raise exception 'courses.manage and MFA required' using errcode='42501';end if;
 perform 1 from public.course_runs where id=p_course_run_id for update;if not found then raise exception 'Invalid course' using errcode='22023';end if;
 perform 1 from public.profiles where id=p_user_id and active for share;
 if not found or not exists(select 1 from public.user_roles where user_id=p_user_id and role in('participant','admin','owner')) or p_status is null or p_status not in('enrolled','completed','removed') then raise exception 'Invalid participant' using errcode='22023';end if;
 select max(ends_at) into ends from public.course_sessions where course_run_id=p_course_run_id;
 if p_status='completed' and (ends is null or ends>now()) then raise exception 'Course has not completed' using errcode='22023';end if;
 select status into previous from public.course_enrolments where course_run_id=p_course_run_id and user_id=p_user_id;
 insert into public.course_enrolments(course_run_id,user_id,status,enrolled_by) values(p_course_run_id,p_user_id,p_status,auth.uid())
 on conflict(course_run_id,user_id) do update set status=excluded.status,updated_at=now();
 insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),'course.enrolment.changed',p_course_run_id,jsonb_build_object('user_id',p_user_id,'previous',previous,'status',p_status));
end;$$;
create function public.manage_course_enrolment(p_course_run_id uuid,p_user_id uuid,p_status text) returns void language sql security invoker set search_path='' as $$select private.manage_course_enrolment(p_course_run_id,p_user_id,p_status);$$;
create function private.reviewable_courses() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.actor_active() then raise exception 'Active login required' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('course_run_id',r.id,'title',t.title,'lecturer_id',p.id,'lecturer_name',p.display_name,'ends_at',s.ends_at,'review',case when v.id is not null then jsonb_build_object('id',v.id,'rating',v.rating,'comment',v.comment,'version',v.version,'hidden',v.hidden,'moderation_reason',v.moderation_reason,'deleted',v.deleted_at is not null) end) order by s.ends_at desc,p.display_name)
 from public.course_enrolments e join public.course_runs r on r.id=e.course_run_id join public.course_templates t on t.id=r.template_id
 join lateral(select max(ends_at) ends_at from public.course_sessions where course_run_id=r.id) s on s.ends_at<=now()
 join lateral(select distinct c.lecturer_id from public.jobs j join public.job_claims c on c.job_id=j.id where j.course_run_id=r.id and c.status='confirmed') teachers on true
 join public.profiles p on p.id=teachers.lecturer_id and p.active
 left join public.course_reviews v on v.course_run_id=r.id and v.lecturer_id=p.id and v.reviewer_id=auth.uid()
 where e.user_id=auth.uid() and e.status='completed' and p.id<>auth.uid()),'[]'::jsonb);
end;$$;
create function public.reviewable_courses() returns jsonb language sql security invoker set search_path='' as $$select private.reviewable_courses();$$;
create function private.submit_course_review(p_course_run_id uuid,p_lecturer_id uuid,p_rating integer,p_comment text,p_version integer default 0) returns uuid language plpgsql security definer set search_path='' as $$
declare previous public.course_reviews;target uuid;ends timestamptz;
begin
 if not private.actor_active() then raise exception 'Active login required' using errcode='42501';end if;
 if p_lecturer_id=auth.uid() or p_rating is null or p_rating not between 1 and 5 or p_comment is null or length(p_comment)>2000 or p_version is null or p_version<0 then raise exception 'Invalid review' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('course-review:'||p_course_run_id::text||':'||auth.uid()::text||':'||p_lecturer_id::text,0));
 perform 1 from public.course_enrolments where course_run_id=p_course_run_id and user_id=auth.uid() and status='completed' for share;
 select max(ends_at) into ends from public.course_sessions where course_run_id=p_course_run_id;
 if ends is null or ends>now() or not exists(select 1 from public.course_enrolments where course_run_id=p_course_run_id and user_id=auth.uid() and status='completed') or not exists(select 1 from public.jobs j join public.job_claims c on c.job_id=j.id where j.course_run_id=p_course_run_id and c.lecturer_id=p_lecturer_id and c.status='confirmed') or not private.profile_staff(p_lecturer_id) then raise exception 'Completed enrolment and assigned lecturer required' using errcode='42501';end if;
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
create function public.submit_course_review(p_course_run_id uuid,p_lecturer_id uuid,p_rating integer,p_comment text,p_version integer default 0) returns uuid language sql security invoker set search_path='' as $$select private.submit_course_review(p_course_run_id,p_lecturer_id,p_rating,p_comment,p_version);$$;
create function private.delete_course_review(p_review_id uuid,p_version integer) returns void language plpgsql security definer set search_path='' as $$
declare previous public.course_reviews;
begin
 select * into previous from public.course_reviews where id=p_review_id for update;
 if not private.actor_active() or not found or previous.reviewer_id<>auth.uid() then raise exception 'Review access denied' using errcode='42501';end if;
 if previous.version<>p_version then raise exception 'review_version_conflict' using errcode='40001';end if;
 update public.course_reviews set comment='',deleted_at=now(),version=version+1,updated_at=now() where id=p_review_id;
 insert into public.audit_events(actor_id,action,resource_id) values(auth.uid(),'course.review.deleted',p_review_id);
end;$$;
create function public.delete_course_review(p_review_id uuid,p_version integer) returns void language sql security invoker set search_path='' as $$select private.delete_course_review(p_review_id,p_version);$$;
create function private.moderate_course_review(p_review_id uuid,p_hidden boolean,p_reason text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.has_permission('reviews.manage') then raise exception 'reviews.manage and MFA required' using errcode='42501';end if;
 if p_hidden is null or p_reason is null or length(trim(p_reason)) not between 1 and 1000 then raise exception 'Moderation reason required' using errcode='22023';end if;
 update public.course_reviews set hidden=p_hidden,moderation_reason=trim(p_reason),version=version+1,updated_at=now() where id=p_review_id and deleted_at is null;
 if not found then raise exception 'Review not found' using errcode='22023';end if;
 insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),'course.review.moderated',p_review_id,jsonb_build_object('hidden',p_hidden,'reason',trim(p_reason)));
end;$$;
create function public.moderate_course_review(p_review_id uuid,p_hidden boolean,p_reason text) returns void language sql security invoker set search_path='' as $$select private.moderate_course_review(p_review_id,p_hidden,p_reason);$$;
do $$declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private') and p.proname in('profile_rating_summary','profile_staff','can_read_profile_course','can_read_person','profile_labels','save_profile_details','own_profile_details','lecturer_reviews','profile_courses','people_directory','person_profile','course_enrolments','enrolment_candidates','manage_course_enrolment','reviewable_courses','submit_course_review','delete_course_review','moderate_course_review') loop
 execute format('revoke execute on function %s from public,anon',f.signature);execute format('grant execute on function %s to authenticated',f.signature);
 end loop;
end;$$;
commit;
