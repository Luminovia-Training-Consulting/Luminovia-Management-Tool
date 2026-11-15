begin;

-- Job visibility is shared with its discussion. This preserves the existing
-- marketplace policy rather than inventing a second, broader comment ACL.
create function private.can_read_job(p_job_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select private.actor_active() and exists(
  select 1 from public.jobs j where j.id=p_job_id and (
   private.has_permission('jobs.manage')
   or (j.status='published' and private.lecturer_actor())
   or exists(select 1 from public.job_claims c where c.job_id=j.id and c.lecturer_id=auth.uid())
  )
 );
$$;
alter policy jobs_read on public.jobs using(private.can_read_job(id));
revoke all on function private.can_read_job(uuid) from public,anon;
grant execute on function private.can_read_job(uuid) to authenticated;

create table private.resource_comments (
 id uuid primary key default gen_random_uuid(),
 job_id uuid references public.jobs(id) on delete restrict,
 template_id uuid references public.course_templates(id) on delete restrict,
 author_id uuid not null references public.profiles(id) on delete restrict,
 request_id uuid not null,
 body text not null check(length(body)<=5000),
 version integer not null default 1 check(version>0),
 hidden boolean not null default false,
 moderation_reason text not null default '' check(length(moderation_reason)<=1000),
 deleted_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 constraint comment_one_resource check(num_nonnulls(job_id,template_id)=1),
 unique(author_id,request_id)
);
create index resource_comments_job_cursor on private.resource_comments(job_id,created_at desc,id desc) where job_id is not null;
create index resource_comments_template_cursor on private.resource_comments(template_id,created_at desc,id desc) where template_id is not null;
create index resource_comments_author_rate on private.resource_comments(author_id,created_at desc);
create table private.resource_comment_revisions (
 id bigint generated always as identity primary key,
 comment_id uuid not null references private.resource_comments(id) on delete restrict,
 version integer not null,
 actor_id uuid not null references public.profiles(id) on delete restrict,
 previous_body text not null,
 action text not null check(action in('edit','withdraw','hide','restore')),
 reason text not null default '',
 created_at timestamptz not null default clock_timestamp(),
 unique(comment_id,version)
);
alter table private.resource_comments enable row level security;
alter table private.resource_comment_revisions enable row level security;
revoke all on private.resource_comments,private.resource_comment_revisions from public,anon,authenticated;

-- These are staff discussions. Seeing an enrolled course or a client quote does
-- not grant access to teaching staff's comments or their commercial discussion.
create function private.comment_resource_access(p_kind text,p_id uuid,p_post boolean default false) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare allowed boolean:=false; archived boolean:=true;
begin
 if not private.actor_active() or p_id is null or p_kind is null or p_kind not in('job','template') then return false;end if;
 if p_kind='job' then
  allowed:=(private.lecturer_actor() or private.has_permission('jobs.manage')) and private.can_read_job(p_id);
  select status='archived' into archived from public.jobs where id=p_id;
 else
  allowed:=(private.lecturer_actor() or private.has_permission('courses.manage')) and private.can_read_course_template(p_id);
  select archived_at is not null into archived from public.course_templates where id=p_id;
 end if;
 return coalesce(allowed,false) and (not p_post or not coalesce(archived,true));
end;$$;
create function private.comment_can_moderate(p_kind text) returns boolean
language sql stable security definer set search_path='' as $$
 select case p_kind when 'job' then private.has_permission('jobs.manage') when 'template' then private.has_permission('courses.manage') else false end;
$$;
create function private.comment_context(p_kind text,p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.comment_resource_access(p_kind,p_id) then raise exception 'Discussion access denied' using errcode='42501';end if;
 return jsonb_build_object('can_post',private.comment_resource_access(p_kind,p_id,true),'can_moderate',private.comment_can_moderate(p_kind));
end;$$;
create function public.comment_context(p_kind text,p_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$select private.comment_context(p_kind,p_id);$$;

create function private.resource_comments(p_kind text,p_id uuid,p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 40) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.comment_resource_access(p_kind,p_id) then raise exception 'Discussion access denied' using errcode='42501';end if;
 if p_limit is null or p_limit not between 1 and 100 or (p_before_at is null)<>(p_before_id is null) or (p_before_at is not null and not isfinite(p_before_at)) then raise exception 'Invalid comment cursor' using errcode='22023';end if;
 return coalesce((select jsonb_agg(to_jsonb(row_data) order by row_data.created_at desc,row_data.id desc) from (
  select c.id,c.author_id,p.display_name author_name,
   case when c.deleted_at is not null then '' else c.body end body,
   c.version,c.hidden,c.deleted_at is not null withdrawn,
   case when c.hidden and (c.author_id=auth.uid() or private.comment_can_moderate(p_kind)) then c.moderation_reason else '' end moderation_reason,
   c.created_at,c.updated_at,c.author_id=auth.uid() mine
  from private.resource_comments c join public.profiles p on p.id=c.author_id
  where (case p_kind when 'job' then c.job_id=p_id else c.template_id=p_id end)
   and (not c.hidden or c.author_id=auth.uid() or private.comment_can_moderate(p_kind))
   and (p_before_at is null or (c.created_at,c.id)<(p_before_at,p_before_id))
  order by c.created_at desc,c.id desc limit p_limit
 ) row_data),'[]'::jsonb);
end;$$;
create function public.resource_comments(p_kind text,p_id uuid,p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 40) returns jsonb
language sql stable security invoker set search_path='' as $$select private.resource_comments(p_kind,p_id,p_before_at,p_before_id,p_limit);$$;

create function private.add_resource_comment(p_kind text,p_id uuid,p_body text,p_request_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare old private.resource_comments; result uuid;
begin
 if not private.comment_resource_access(p_kind,p_id,true) then raise exception 'Discussion write denied' using errcode='42501';end if;
 if p_request_id is null or p_body is null or length(trim(p_body)) not between 1 and 5000 or p_body~'[\x01-\x08\x0B\x0C\x0E-\x1F]' then raise exception 'Invalid comment' using errcode='22023';end if;
 -- One actor lock makes retries and rate checks atomic across all resources.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('resource-comment:'||auth.uid()::text,0));
 select * into old from private.resource_comments where author_id=auth.uid() and request_id=p_request_id;
 if found then
  if old.job_id is distinct from (case when p_kind='job' then p_id end) or old.template_id is distinct from (case when p_kind='template' then p_id end) or old.body is distinct from p_body or old.version<>1 then raise exception 'Comment retry conflict' using errcode='22023';end if;
  return old.id;
 end if;
 if (select count(*) from private.resource_comments where author_id=auth.uid() and created_at>clock_timestamp()-interval '1 minute')>=10
 or (select count(*) from private.resource_comments where author_id=auth.uid() and created_at>clock_timestamp()-interval '1 day')>=100 then raise exception 'Comment rate limit' using errcode='54000';end if;
 insert into private.resource_comments(job_id,template_id,author_id,request_id,body)
 values(case when p_kind='job' then p_id end,case when p_kind='template' then p_id end,auth.uid(),p_request_id,p_body) returning id into result;
 insert into public.audit_events(actor_id,action,resource_id) values(auth.uid(),'comment.created',result);
 return result;
end;$$;
create function public.add_resource_comment(p_kind text,p_id uuid,p_body text,p_request_id uuid) returns uuid
language sql security invoker set search_path='' as $$select private.add_resource_comment(p_kind,p_id,p_body,p_request_id);$$;

create function private.edit_resource_comment(p_comment_id uuid,p_body text,p_version integer) returns void
language plpgsql security definer set search_path='' as $$
declare c private.resource_comments; kind text; resource uuid;
begin
 select * into c from private.resource_comments where id=p_comment_id for update;
 kind:=case when c.job_id is not null then 'job' else 'template' end;resource:=coalesce(c.job_id,c.template_id);
 if not found or c.author_id<>auth.uid() or not private.comment_resource_access(kind,resource,true) then raise exception 'Own accessible discussion required' using errcode='42501';end if;
 if p_version is null or c.version<>p_version or c.deleted_at is not null then raise exception 'Comment version conflict' using errcode='40001';end if;
 if p_body is null or length(trim(p_body)) not between 1 and 5000 or p_body~'[\x01-\x08\x0B\x0C\x0E-\x1F]' then raise exception 'Invalid comment' using errcode='22023';end if;
 if p_body=c.body then return;end if;
 insert into private.resource_comment_revisions(comment_id,version,actor_id,previous_body,action) values(c.id,c.version,auth.uid(),c.body,'edit');
 -- Author edits never unhide moderated content or discard its reason.
 update private.resource_comments set body=p_body,version=version+1,updated_at=clock_timestamp() where id=c.id;
 insert into public.audit_events(actor_id,action,resource_id) values(auth.uid(),'comment.edited',c.id);
end;$$;
create function public.edit_resource_comment(p_comment_id uuid,p_body text,p_version integer) returns void
language sql security invoker set search_path='' as $$select private.edit_resource_comment(p_comment_id,p_body,p_version);$$;

create function private.withdraw_resource_comment(p_comment_id uuid,p_version integer) returns void
language plpgsql security definer set search_path='' as $$
declare c private.resource_comments; kind text; resource uuid;
begin
 select * into c from private.resource_comments where id=p_comment_id for update;
 kind:=case when c.job_id is not null then 'job' else 'template' end;resource:=coalesce(c.job_id,c.template_id);
 if not found or c.author_id<>auth.uid() or not private.comment_resource_access(kind,resource) then raise exception 'Own accessible discussion required' using errcode='42501';end if;
 if p_version is null or c.version<>p_version then raise exception 'Comment version conflict' using errcode='40001';end if;
 if c.deleted_at is not null then return;end if;
 insert into private.resource_comment_revisions(comment_id,version,actor_id,previous_body,action) values(c.id,c.version,auth.uid(),c.body,'withdraw');
 update private.resource_comments set body='',deleted_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp() where id=c.id;
 insert into public.audit_events(actor_id,action,resource_id) values(auth.uid(),'comment.withdrawn',c.id);
end;$$;
create function public.withdraw_resource_comment(p_comment_id uuid,p_version integer) returns void
language sql security invoker set search_path='' as $$select private.withdraw_resource_comment(p_comment_id,p_version);$$;

create function private.moderate_resource_comment(p_comment_id uuid,p_hidden boolean,p_reason text,p_version integer) returns void
language plpgsql security definer set search_path='' as $$
declare c private.resource_comments; kind text; resource uuid;
begin
 select * into c from private.resource_comments where id=p_comment_id for update;
 kind:=case when c.job_id is not null then 'job' else 'template' end;resource:=coalesce(c.job_id,c.template_id);
 if not found or not private.comment_resource_access(kind,resource) or not private.comment_can_moderate(kind) then raise exception 'Discussion moderation and MFA required' using errcode='42501';end if;
 if p_version is null or c.version<>p_version or c.deleted_at is not null then raise exception 'Comment version conflict' using errcode='40001';end if;
 if p_hidden is null or p_reason is null or length(trim(p_reason)) not between 1 and 1000 then raise exception 'Moderation reason required' using errcode='22023';end if;
 if c.hidden=p_hidden and c.moderation_reason=trim(p_reason) then return;end if;
 insert into private.resource_comment_revisions(comment_id,version,actor_id,previous_body,action,reason) values(c.id,c.version,auth.uid(),c.body,case when p_hidden then 'hide' else 'restore' end,trim(p_reason));
 update private.resource_comments set hidden=p_hidden,moderation_reason=trim(p_reason),version=version+1,updated_at=clock_timestamp() where id=c.id;
 insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),case when p_hidden then 'comment.hidden' else 'comment.restored' end,c.id,jsonb_build_object('reason',trim(p_reason)));
end;$$;
create function public.moderate_resource_comment(p_comment_id uuid,p_hidden boolean,p_reason text,p_version integer) returns void
language sql security invoker set search_path='' as $$select private.moderate_resource_comment(p_comment_id,p_hidden,p_reason,p_version);$$;

revoke all on function private.comment_resource_access(text,uuid,boolean),private.comment_can_moderate(text) from public,anon,authenticated;
revoke all on function private.comment_context(text,uuid),public.comment_context(text,uuid),private.resource_comments(text,uuid,timestamptz,uuid,integer),public.resource_comments(text,uuid,timestamptz,uuid,integer),private.add_resource_comment(text,uuid,text,uuid),public.add_resource_comment(text,uuid,text,uuid),private.edit_resource_comment(uuid,text,integer),public.edit_resource_comment(uuid,text,integer),private.withdraw_resource_comment(uuid,integer),public.withdraw_resource_comment(uuid,integer),private.moderate_resource_comment(uuid,boolean,text,integer),public.moderate_resource_comment(uuid,boolean,text,integer) from public,anon,authenticated;
grant execute on function private.comment_context(text,uuid),public.comment_context(text,uuid),private.resource_comments(text,uuid,timestamptz,uuid,integer),public.resource_comments(text,uuid,timestamptz,uuid,integer),private.add_resource_comment(text,uuid,text,uuid),public.add_resource_comment(text,uuid,text,uuid),private.edit_resource_comment(uuid,text,integer),public.edit_resource_comment(uuid,text,integer),private.withdraw_resource_comment(uuid,integer),public.withdraw_resource_comment(uuid,integer),private.moderate_resource_comment(uuid,boolean,text,integer),public.moderate_resource_comment(uuid,boolean,text,integer) to authenticated;
commit;
