begin;
alter table public.organisations add column industry text not null default '' check(length(industry)<=120),add column city text not null default '' check(length(city)<=120),add column tags text[] not null default '{}',add column archived_at timestamptz;
create table public.organisation_private_details(organisation_id uuid primary key references public.organisations(id) on delete cascade,private_notes text not null default '' check(length(private_notes)<=8000));
create table public.organisation_contacts(id uuid primary key default gen_random_uuid(),organisation_id uuid not null references public.organisations(id) on delete cascade,name text not null check(length(name) between 1 and 120),position text not null default '' check(length(position)<=120),email text not null default '' check(length(email)<=254),phone text not null default '' check(length(phone)<=50),notes text not null default '' check(length(notes)<=4000),archived_at timestamptz,created_at timestamptz not null default now());
create index organisation_contacts_parent on public.organisation_contacts(organisation_id);
alter table public.course_templates add column syllabus text not null default '' check(length(syllabus)<=30000),add column prerequisites text not null default '' check(length(prerequisites)<=8000),add column archived_at timestamptz;
alter table public.course_runs add column delivery_type text not null default 'online' check(delivery_type in('online','onsite')),add column venue text not null default '' check(length(venue)<=500),add column published boolean not null default false,add column archived_at timestamptz;
create table public.course_template_topics(template_id uuid not null references public.course_templates(id) on delete cascade,topic_id uuid not null references public.topics(id),primary key(template_id,topic_id));
create index course_template_topics_topic on public.course_template_topics(topic_id);
create index course_runs_public on public.course_runs(published,archived_at);
create index organisations_name on public.organisations(lower(name));
create trigger organisations_time_zone before insert or update of time_zone on public.organisations for each row execute function private.validate_time_zone();
create trigger course_runs_time_zone before insert or update of time_zone on public.course_runs for each row execute function private.validate_time_zone();

create function private.can_read_course_run(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.actor_active() and (
 private.has_permission('courses.manage')
 or (private.has_role(array['lecturer','senior_lecturer']) and exists(select 1 from public.course_runs r where r.id=p_id and r.published and r.archived_at is null))
 or exists(select 1 from public.jobs j join public.job_claims c on c.job_id=j.id where j.course_run_id=p_id and c.lecturer_id=auth.uid() and c.status='confirmed')
 or exists(select 1 from public.chat_rooms r where r.kind='participant_course' and r.course_run_id=p_id and private.can_access_chat_room(r.id))
 );
$$;
create function private.can_read_course_template(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.actor_active() and (private.has_permission('courses.manage') or exists(select 1 from public.course_runs r where r.template_id=p_id and private.can_read_course_run(r.id)));
$$;
-- Course descriptions are shared only through published/assigned/enrolled runs.
-- Private contact details and notes stay in separate, capability-restricted tables.
drop policy organisations_read on public.organisations;
create policy organisations_read on public.organisations for select to authenticated using((select private.has_permission('organisations.manage')) or exists(select 1 from public.course_runs r where r.organisation_id=organisations.id and private.can_read_course_run(r.id)));
drop policy templates_read on public.course_templates;
create policy templates_read on public.course_templates for select to authenticated using(private.can_read_course_template(id));
drop policy runs_read on public.course_runs;
create policy runs_read on public.course_runs for select to authenticated using(private.can_read_course_run(id));
drop policy course_sessions_read on public.course_sessions;
create policy course_sessions_read on public.course_sessions for select to authenticated using(private.can_read_course_run(course_run_id));
alter table public.organisation_private_details enable row level security;
alter table public.organisation_contacts enable row level security;
alter table public.course_template_topics enable row level security;
revoke all on public.organisation_private_details,public.organisation_contacts,public.course_template_topics from public,anon,authenticated;
grant select on public.organisation_private_details,public.organisation_contacts,public.course_template_topics to authenticated;
grant all on public.organisation_private_details,public.organisation_contacts,public.course_template_topics to service_role;
create policy private_organisation_notes on public.organisation_private_details for select to authenticated using((select private.has_permission('organisations.manage')));
create policy private_organisation_contacts on public.organisation_contacts for select to authenticated using((select private.has_permission('organisations.manage')));
create policy template_topics_read on public.course_template_topics for select to authenticated using(private.can_read_course_template(template_id));

create function private.save_organisation(p_id uuid,p_payload jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare target uuid:=coalesce(p_id,gen_random_uuid());v_tags text[];
begin
 if not private.has_permission('organisations.manage') then raise exception 'organisations.manage and MFA required' using errcode='42501';end if;
 if jsonb_typeof(p_payload)<>'object' or p_payload->>'name' is null or length(trim(p_payload->>'name')) not between 1 and 200 or length(coalesce(p_payload->>'country',''))>100 or length(coalesce(p_payload->>'private_notes',''))>8000 then raise exception 'Invalid organisation' using errcode='22023';end if;
 v_tags:=array(select jsonb_array_elements_text(coalesce(p_payload->'tags','[]'::jsonb)));if cardinality(v_tags)>20 or exists(select 1 from unnest(v_tags) t where length(t)>60) then raise exception 'Invalid tags' using errcode='22023';end if;
 if p_id is null then
 insert into public.organisations(id,name,country,time_zone,industry,city,tags,archived_at) values(target,trim(p_payload->>'name'),p_payload->>'country',coalesce(p_payload->>'time_zone','Europe/Berlin'),coalesce(p_payload->>'industry',''),coalesce(p_payload->>'city',''),v_tags,case when coalesce((p_payload->>'archived')::boolean,false) then now() end);
 else
 update public.organisations set name=trim(p_payload->>'name'),country=p_payload->>'country',time_zone=coalesce(p_payload->>'time_zone','Europe/Berlin'),industry=coalesce(p_payload->>'industry',''),city=coalesce(p_payload->>'city',''),tags=v_tags,archived_at=case when coalesce((p_payload->>'archived')::boolean,false) then coalesce(archived_at,now()) end where id=target;
 if not found then raise exception 'Organisation not found' using errcode='22023';end if;
 end if;
 insert into public.organisation_private_details(organisation_id,private_notes) values(target,coalesce(p_payload->>'private_notes','')) on conflict(organisation_id) do update set private_notes=excluded.private_notes;
 insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),'organisation.saved',target,jsonb_build_object('created',p_id is null));return target;
end;$$;
create function public.save_organisation(p_id uuid,p_payload jsonb) returns uuid language sql security invoker set search_path='' as $$select private.save_organisation(p_id,p_payload);$$;
create function private.save_organisation_contact(p_id uuid,p_organisation_id uuid,p_payload jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare target uuid:=coalesce(p_id,gen_random_uuid());
begin
 if not private.has_permission('organisations.manage') then raise exception 'organisations.manage and MFA required' using errcode='42501';end if;
 if jsonb_typeof(p_payload)<>'object' or length(trim(coalesce(p_payload->>'name',''))) not between 1 and 120 or length(coalesce(p_payload->>'email',''))>254 or (coalesce(p_payload->>'email','')<>'' and p_payload->>'email'!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then raise exception 'Invalid contact' using errcode='22023';end if;
 if not exists(select 1 from public.organisations where id=p_organisation_id) then raise exception 'Organisation not found' using errcode='22023';end if;
 if p_id is null then
 insert into public.organisation_contacts(id,organisation_id,name,position,email,phone,notes,archived_at) values(target,p_organisation_id,trim(p_payload->>'name'),coalesce(p_payload->>'position',''),coalesce(p_payload->>'email',''),coalesce(p_payload->>'phone',''),coalesce(p_payload->>'notes',''),case when coalesce((p_payload->>'archived')::boolean,false) then now() end);
 else
 update public.organisation_contacts set name=trim(p_payload->>'name'),position=coalesce(p_payload->>'position',''),email=coalesce(p_payload->>'email',''),phone=coalesce(p_payload->>'phone',''),notes=coalesce(p_payload->>'notes',''),archived_at=case when coalesce((p_payload->>'archived')::boolean,false) then coalesce(archived_at,now()) end where id=target and organisation_id=p_organisation_id;
 if not found then raise exception 'Contact not found' using errcode='22023';end if;
 end if;
 insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),'organisation.contact.saved',target,jsonb_build_object('organisation_id',p_organisation_id,'created',p_id is null));return target;
end;$$;
create function public.save_organisation_contact(p_id uuid,p_organisation_id uuid,p_payload jsonb) returns uuid language sql security invoker set search_path='' as $$select private.save_organisation_contact(p_id,p_organisation_id,p_payload);$$;

create function private.save_course_template(p_id uuid,p_payload jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare target uuid:=coalesce(p_id,gen_random_uuid());topic_ids uuid[];
begin
 if not private.has_permission('courses.manage') then raise exception 'courses.manage and MFA required' using errcode='42501';end if;
 if jsonb_typeof(p_payload)<>'object' or length(trim(coalesce(p_payload->>'title',''))) not between 1 and 200 or length(coalesce(p_payload->>'description',''))>12000 then raise exception 'Invalid course' using errcode='22023';end if;
 if p_id is not null and exists(select 1 from public.course_runs r join public.jobs j on j.course_run_id=r.id where r.template_id=p_id and j.status in('published','filled')) then raise exception 'course_locked' using errcode='22023';end if;
 topic_ids:=array(select distinct value::uuid from jsonb_array_elements_text(coalesce(p_payload->'topic_ids','[]'::jsonb)));if cardinality(topic_ids)>50 then raise exception 'Too many topics' using errcode='22023';end if;
 if p_id is null then insert into public.course_templates(id,title,description,syllabus,prerequisites,archived_at) values(target,trim(p_payload->>'title'),coalesce(p_payload->>'description',''),coalesce(p_payload->>'syllabus',''),coalesce(p_payload->>'prerequisites',''),case when coalesce((p_payload->>'archived')::boolean,false) then now() end);
 else update public.course_templates set title=trim(p_payload->>'title'),description=coalesce(p_payload->>'description',''),syllabus=coalesce(p_payload->>'syllabus',''),prerequisites=coalesce(p_payload->>'prerequisites',''),archived_at=case when coalesce((p_payload->>'archived')::boolean,false) then coalesce(archived_at,now()) end where id=target;if not found then raise exception 'Course not found' using errcode='22023';end if;end if;
 delete from public.course_template_topics where template_id=target;insert into public.course_template_topics(template_id,topic_id) select target,unnest(topic_ids);
 insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),'course.template.saved',target,jsonb_build_object('created',p_id is null));return target;
end;$$;
create function public.save_course_template(p_id uuid,p_payload jsonb) returns uuid language sql security invoker set search_path='' as $$select private.save_course_template(p_id,p_payload);$$;

create function private.save_course_run(p_id uuid,p_payload jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare target uuid:=coalesce(p_id,gen_random_uuid());item jsonb;starts timestamptz;ends timestamptz;session_count integer:=0;
begin
 if not private.has_permission('courses.manage') then raise exception 'courses.manage and MFA required' using errcode='42501';end if;
 if jsonb_typeof(p_payload)<>'object' or jsonb_typeof(p_payload->'sessions')<>'array' or jsonb_array_length(p_payload->'sessions') not between 1 and 60 then raise exception 'One to sixty sessions required' using errcode='22023';end if;
 if p_id is not null then
 perform 1 from public.course_runs where id=target for update;if not found then raise exception 'Run not found' using errcode='22023';end if;
 if exists(select 1 from public.jobs where course_run_id=target) then raise exception 'course_locked' using errcode='22023';end if;
 end if;
 if p_id is null then insert into public.course_runs(id,template_id,organisation_id,time_zone,delivery_type,venue,published,archived_at) values(target,(p_payload->>'template_id')::uuid,nullif(p_payload->>'organisation_id','')::uuid,coalesce(p_payload->>'time_zone','Europe/Berlin'),coalesce(p_payload->>'delivery_type','online'),coalesce(p_payload->>'venue',''),false,case when coalesce((p_payload->>'archived')::boolean,false) then now() end);
 else update public.course_runs set template_id=(p_payload->>'template_id')::uuid,organisation_id=nullif(p_payload->>'organisation_id','')::uuid,time_zone=coalesce(p_payload->>'time_zone','Europe/Berlin'),delivery_type=coalesce(p_payload->>'delivery_type','online'),venue=coalesce(p_payload->>'venue',''),published=false,archived_at=case when coalesce((p_payload->>'archived')::boolean,false) then coalesce(archived_at,now()) end where id=target;delete from public.course_sessions where course_run_id=target;end if;
 for item in select * from jsonb_array_elements(p_payload->'sessions') loop
 if item->>'starts_at' !~'(Z|[+-][0-9]{2}:[0-9]{2})$' or item->>'ends_at' !~'(Z|[+-][0-9]{2}:[0-9]{2})$' then raise exception 'Explicit instants required' using errcode='22023';end if;
 starts:=(item->>'starts_at')::timestamptz;ends:=(item->>'ends_at')::timestamptz;
 if starts is null or ends is null or ends<=starts or exists(select 1 from public.course_sessions where course_run_id=target and tstzrange(starts_at,ends_at,'[)')&&tstzrange(starts,ends,'[)')) then raise exception 'Invalid or overlapping sessions' using errcode='22023';end if;
 insert into public.course_sessions(course_run_id,starts_at,ends_at) values(target,starts,ends);session_count:=session_count+1;
 end loop;
 update public.course_runs set published=coalesce((p_payload->>'published')::boolean,false) where id=target;
 insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),'course.run.saved',target,jsonb_build_object('created',p_id is null,'session_count',session_count));return target;
end;$$;
create function public.save_course_run(p_id uuid,p_payload jsonb) returns uuid language sql security invoker set search_path='' as $$select private.save_course_run(p_id,p_payload);$$;

create function private.set_course_visibility(p_id uuid,p_published boolean,p_archived boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.has_permission('courses.manage') then raise exception 'courses.manage and MFA required' using errcode='42501';end if;
 perform 1 from public.course_runs where id=p_id for update;if not found or p_published is null or p_archived is null then raise exception 'Invalid course' using errcode='22023';end if;
 if p_archived and exists(select 1 from public.jobs where course_run_id=p_id and status in('published','filled')) then raise exception 'course_locked' using errcode='22023';end if;
 if p_published and not exists(select 1 from public.course_sessions where course_run_id=p_id) then raise exception 'Sessions required' using errcode='22023';end if;
 update public.course_runs set published=p_published,archived_at=case when p_archived then coalesce(archived_at,now()) end where id=p_id;
 insert into public.audit_events(actor_id,action,resource_id) values(auth.uid(),'course.visibility.changed',p_id);
end;$$;
create function public.set_course_visibility(p_id uuid,p_published boolean,p_archived boolean) returns void language sql security invoker set search_path='' as $$select private.set_course_visibility(p_id,p_published,p_archived);$$;
create function private.duplicate_course_template(p_id uuid,p_title text) returns uuid language plpgsql security definer set search_path='' as $$
declare original public.course_templates;target uuid:=gen_random_uuid();
begin
 if not private.has_permission('courses.manage') then raise exception 'courses.manage and MFA required' using errcode='42501';end if;
 select * into original from public.course_templates where id=p_id;if not found or length(trim(p_title)) not between 1 and 200 then raise exception 'Invalid template' using errcode='22023';end if;
 insert into public.course_templates(id,title,description,syllabus,prerequisites) values(target,trim(p_title),original.description,original.syllabus,original.prerequisites);
 insert into public.course_template_topics(template_id,topic_id) select target,topic_id from public.course_template_topics where template_id=p_id;
 insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),'course.template.duplicated',target,jsonb_build_object('source',p_id));return target;
end;$$;
create function public.duplicate_course_template(p_id uuid,p_title text) returns uuid language sql security invoker set search_path='' as $$select private.duplicate_course_template(p_id,p_title);$$;
create function private.duplicate_course_run(p_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare original public.course_runs;target uuid:=gen_random_uuid();
begin
 if not private.has_permission('courses.manage') then raise exception 'courses.manage and MFA required' using errcode='42501';end if;
 select * into original from public.course_runs where id=p_id;if not found then raise exception 'Run not found' using errcode='22023';end if;
 insert into public.course_runs(id,template_id,organisation_id,time_zone,delivery_type,venue,published) values(target,original.template_id,original.organisation_id,original.time_zone,original.delivery_type,original.venue,false);
 insert into public.course_sessions(course_run_id,starts_at,ends_at) select target,starts_at,ends_at from public.course_sessions where course_run_id=p_id;
 insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),'course.run.duplicated',target,jsonb_build_object('source',p_id));return target;
end;$$;
create function public.duplicate_course_run(p_id uuid) returns uuid language sql security invoker set search_path='' as $$select private.duplicate_course_run(p_id);$$;
revoke execute on function private.can_read_course_run(uuid),private.can_read_course_template(uuid),private.save_organisation(uuid,jsonb),private.save_organisation_contact(uuid,uuid,jsonb),private.save_course_template(uuid,jsonb),private.save_course_run(uuid,jsonb),private.set_course_visibility(uuid,boolean,boolean),private.duplicate_course_template(uuid,text),private.duplicate_course_run(uuid),public.save_organisation(uuid,jsonb),public.save_organisation_contact(uuid,uuid,jsonb),public.save_course_template(uuid,jsonb),public.save_course_run(uuid,jsonb),public.set_course_visibility(uuid,boolean,boolean),public.duplicate_course_template(uuid,text),public.duplicate_course_run(uuid) from public,anon;
grant execute on function private.can_read_course_run(uuid),private.can_read_course_template(uuid),private.save_organisation(uuid,jsonb),private.save_organisation_contact(uuid,uuid,jsonb),private.save_course_template(uuid,jsonb),private.save_course_run(uuid,jsonb),private.set_course_visibility(uuid,boolean,boolean),private.duplicate_course_template(uuid,text),private.duplicate_course_run(uuid),public.save_organisation(uuid,jsonb),public.save_organisation_contact(uuid,uuid,jsonb),public.save_course_template(uuid,jsonb),public.save_course_run(uuid,jsonb),public.set_course_visibility(uuid,boolean,boolean),public.duplicate_course_template(uuid,text),public.duplicate_course_run(uuid) to authenticated;
commit;
