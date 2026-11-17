begin;
-- Preserve existing directory behavior until the profile owner explicitly changes it.
alter table private.staff_contact_visibility add column topics_visible boolean not null default true;
alter table private.staff_contact_visibility add column topics_version integer not null default 0 check(topics_version>=0);
create function private.profile_topics_visible(p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select private.actor_active() and (p_user=auth.uid() or private.has_permission('qualifications.verify') or coalesce((select v.topics_visible from private.staff_contact_visibility v where v.user_id=p_user),true));
$$;
revoke all on function private.profile_topics_visible(uuid) from public,anon,authenticated,service_role;
create function private.profile_topic_preferences() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.actor_active() then raise exception 'Active account required' using errcode='42501';end if;
 return jsonb_build_object('visible',coalesce((select topics_visible from private.staff_contact_visibility where user_id=auth.uid()),true),
 'version',coalesce((select topics_version from private.staff_contact_visibility where user_id=auth.uid()),0),
 'can_share',private.profile_staff(auth.uid()));
end $$;
create function public.profile_topic_preferences() returns jsonb language sql stable security invoker set search_path='' as $$select private.profile_topic_preferences();$$;
create function private.save_profile_topic_preferences(p_visible boolean,p_expected_version integer) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v private.staff_contact_visibility;
begin
 -- Role/suspension writers lock the same actor profile; check current authority after waiting.
 perform 1 from public.profiles where id=auth.uid() and active for share;
 if not found or not private.actor_active() then raise exception 'Active account required' using errcode='42501';end if;
 if p_visible is null or p_expected_version is null or p_expected_version<0 then raise exception 'Invalid preference' using errcode='22023';end if;
 if p_visible and not private.profile_staff(auth.uid()) then raise exception 'Active staff role required' using errcode='42501';end if;
 insert into private.staff_contact_visibility(user_id) values(auth.uid()) on conflict do nothing;
 select * into v from private.staff_contact_visibility where user_id=auth.uid() for update;
 if v.topics_version<>p_expected_version then raise exception 'Preference changed; reload' using errcode='40001';end if;
 update private.staff_contact_visibility set topics_visible=p_visible,topics_version=topics_version+1,updated_at=clock_timestamp() where user_id=auth.uid();
 return private.profile_topic_preferences();
end $$;
create function public.save_profile_topic_preferences(p_visible boolean,p_expected_version integer) returns jsonb language sql volatile security invoker set search_path='' as $$select private.save_profile_topic_preferences(p_visible,p_expected_version);$$;
revoke all on function private.profile_topic_preferences(),public.profile_topic_preferences(),private.save_profile_topic_preferences(boolean,integer),public.save_profile_topic_preferences(boolean,integer) from public,anon,authenticated;
grant execute on function private.profile_topic_preferences(),public.profile_topic_preferences(),private.save_profile_topic_preferences(boolean,integer),public.save_profile_topic_preferences(boolean,integer) to authenticated;

-- Retain the same current permission gates, labels, limits, ordering and all
-- other projected fields. Topic filtering cannot become a hidden-data oracle.
create or replace function private.people_directory(p_search text default '',p_label text default '',p_topic_id uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.actor_active() or length(coalesce(p_search,''))>100 or length(coalesce(p_label,''))>40 then raise exception 'Invalid directory request' using errcode='22023';end if;
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.display_name,x.id) from(select p.id,p.display_name,p.bio_de,p.bio_en,p.time_zone,coalesce(d.country,'') country,coalesce(d.languages,'{}'::text[]) languages,coalesce(d.labels,'{}'::text[]) labels,
 case when private.profile_topics_visible(p.id) then coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'label_de',t.label_de,'label_en',t.label_en,'kind',t.kind,'verified',lt.verified and (lt.valid_until is null or lt.valid_until>now()))) from public.lecturer_topics lt join public.topics t on t.id=lt.topic_id where lt.user_id=p.id),'[]'::jsonb) else '[]'::jsonb end topics,
 stats.rating_average,stats.review_count
 from public.profiles p left join public.profile_details d on d.user_id=p.id cross join lateral private.profile_rating_summary(p.id) stats
 where private.profile_staff(p.id) and private.can_read_person(p.id) and (coalesce(p_search,'')='' or p.display_name ilike '%'||p_search||'%' or p.bio_de ilike '%'||p_search||'%' or p.bio_en ilike '%'||p_search||'%') and (coalesce(p_label,'')='' or exists(select 1 from unnest(d.labels) l where lower(l)=lower(trim(p_label)))) and (p_topic_id is null or (private.profile_topics_visible(p.id) and exists(select 1 from public.lecturer_topics lt where lt.user_id=p.id and lt.topic_id=p_topic_id)))
 order by p.display_name,p.id limit 200) x),'[]'::jsonb);
end $$;
create or replace function private.person_profile(p_user_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not private.can_read_person(p_user_id) then raise exception 'Profile access denied' using errcode='42501';end if;
 select jsonb_build_object('id',p.id,'display_name',p.display_name,'bio_de',p.bio_de,'bio_en',p.bio_en,'time_zone',p.time_zone,'country',coalesce(d.country,''),'languages',coalesce(d.languages,'{}'::text[]),'labels',coalesce(d.labels,'{}'::text[]),'teaching_experience',coalesce(d.teaching_experience,''),'can_moderate',private.has_permission('reviews.manage'),
 'topics',case when private.profile_topics_visible(p.id) then coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'label_de',t.label_de,'label_en',t.label_en,'kind',t.kind,'verified',lt.verified and (lt.valid_until is null or lt.valid_until>now()))) from public.lecturer_topics lt join public.topics t on t.id=lt.topic_id where lt.user_id=p.id),'[]'::jsonb) else '[]'::jsonb end) into result
 from public.profiles p left join public.profile_details d on d.user_id=p.id where p.id=p_user_id and p.active;
 if result is null then raise exception 'Profile access denied' using errcode='42501';end if;
 return result;
end $$;
commit;
