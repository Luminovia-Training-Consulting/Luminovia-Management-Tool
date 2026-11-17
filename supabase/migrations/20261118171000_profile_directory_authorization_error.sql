begin;

create or replace function private.people_directory(
  p_search text default '',
  p_label text default '',
  p_topic_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path=''
as $$
begin
  if not private.actor_active() then
    raise exception 'Active account required' using errcode='42501';
  end if;
  if length(coalesce(p_search,''))>100 or length(coalesce(p_label,''))>40 then
    raise exception 'Invalid directory request' using errcode='22023';
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.display_name,x.id)
    from (
      select p.id,p.display_name,p.bio_de,p.bio_en,p.time_zone,
        coalesce(d.country,'') country,
        coalesce(d.languages,'{}'::text[]) languages,
        coalesce(d.labels,'{}'::text[]) labels,
        case when private.profile_topics_visible(p.id) then
          coalesce((
            select jsonb_agg(jsonb_build_object(
              'id',t.id,'label_de',t.label_de,'label_en',t.label_en,
              'kind',t.kind,'verified',lt.verified and
                (lt.valid_until is null or lt.valid_until>now())
            ))
            from public.lecturer_topics lt
            join public.topics t on t.id=lt.topic_id
            where lt.user_id=p.id
          ),'[]'::jsonb)
        else '[]'::jsonb end topics,
        stats.rating_average,stats.review_count
      from public.profiles p
      left join public.profile_details d on d.user_id=p.id
      cross join lateral private.profile_rating_summary(p.id) stats
      where private.profile_staff(p.id)
        and private.can_read_person(p.id)
        and (coalesce(p_search,'')='' or
          p.display_name ilike '%'||p_search||'%' or
          p.bio_de ilike '%'||p_search||'%' or
          p.bio_en ilike '%'||p_search||'%')
        and (coalesce(p_label,'')='' or exists(
          select 1 from unnest(d.labels) l
          where lower(l)=lower(trim(p_label))
        ))
        and (p_topic_id is null or (
          private.profile_topics_visible(p.id) and exists(
            select 1 from public.lecturer_topics lt
            where lt.user_id=p.id and lt.topic_id=p_topic_id
          )
        ))
      order by p.display_name,p.id
      limit 200
    ) x
  ),'[]'::jsonb);
end;
$$;

commit;
