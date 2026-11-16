begin;
-- Additive customer brief: teaching time is independent of commercial prices.
create table private.client_request_briefs (
 request_id uuid primary key references private.client_course_requests(id) on delete cascade,
 content jsonb not null, version integer not null default 1 check(version>0),
 updated_at timestamptz not null default clock_timestamp()
);
create table private.client_request_revisions (
 id bigint generated always as identity primary key,
 request_id uuid not null references private.client_course_requests(id) on delete cascade,
 actor_id uuid references public.profiles(id) on delete set null,
 event text not null, snapshot jsonb not null, created_at timestamptz not null default clock_timestamp()
);
create index client_request_revisions_request on private.client_request_revisions(request_id,id desc);
alter table private.client_request_briefs enable row level security;
alter table private.client_request_revisions enable row level security;
revoke all on private.client_request_briefs,private.client_request_revisions from public,anon,authenticated;

-- Current database membership and fresh gross-finance/MFA authority are the only read boundary.
create function private.client_request_access(p_request_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.actor_active() and exists(select 1 from private.client_course_requests r join public.organisations o on o.id=r.organisation_id where r.id=p_request_id and o.archived_at is null and (private.has_permission('finance.gross.read') or private.client_has_organisation(r.organisation_id)));
$$;
-- Append a transactional snapshot for initial, lifecycle and brief changes; no history mutation API exists.
create function private.record_client_request_revision() returns trigger language plpgsql security definer set search_path='' as $$
declare target uuid; r private.client_course_requests; b private.client_request_briefs;
begin
 if tg_table_name='client_course_requests' then target:=new.id;else target:=new.request_id;end if;
 select * into r from private.client_course_requests where id=target;
 select * into b from private.client_request_briefs where request_id=target;
 insert into private.client_request_revisions(request_id,actor_id,event,snapshot) values(target,auth.uid(),case when tg_table_name='client_request_briefs' then 'brief_saved' when tg_op='INSERT' then 'submitted' else r.status end,jsonb_build_object('payload',r.payload,'status',r.status,'job_id',r.job_id,'brief',b.content,'brief_version',coalesce(b.version,0)));
 return new;
end;$$;
create trigger client_request_revision after insert or update of payload,status,job_id on private.client_course_requests for each row execute function private.record_client_request_revision();
create trigger client_brief_revision after insert or update on private.client_request_briefs for each row execute function private.record_client_request_revision();
-- Existing requests gain an accurately labelled baseline; no past events are invented.
insert into private.client_request_revisions(request_id,event,snapshot) select id,'baseline',jsonb_build_object('payload',payload,'status',status,'job_id',job_id,'brief',null,'brief_version',0) from private.client_course_requests;

-- Validate teaching duration and exact clean own-material references without changing commercial prices.
create function private.normalise_client_request_brief(p_request_id uuid,p_brief jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.client_course_requests; old_content jsonb; units integer; unit_minutes integer; planned numeric; required jsonb:='[]'; docs jsonb:='[]'; item jsonb; label text; v public.document_versions; d public.documents; category text;
begin
 select * into r from private.client_course_requests where id=p_request_id;
 if not found or not private.client_request_access(p_request_id) then raise exception 'Client request access required' using errcode='42501';end if;
 select content into old_content from private.client_request_briefs where request_id=p_request_id;
 if jsonb_typeof(p_brief) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_brief) k where k not in('teaching_units','unit_minutes','instructions','required_documents','documents')) then raise exception 'Invalid request brief' using errcode='22023';end if;
 if jsonb_typeof(p_brief->'teaching_units') is distinct from 'number' or (p_brief->>'teaching_units') !~ '^[1-9][0-9]{0,3}$' or jsonb_typeof(p_brief->'unit_minutes') is distinct from 'number' or (p_brief->>'unit_minutes') not in('45','60') then raise exception 'Whole teaching units and 45/60 minute unit required' using errcode='22023';end if;
 units:=(p_brief->>'teaching_units')::integer;unit_minutes:=(p_brief->>'unit_minutes')::integer;
 select sum(extract(epoch from ((s->>'ends_at')::timestamptz-(s->>'starts_at')::timestamptz))/60) into planned from jsonb_array_elements(r.payload->'sessions') s;
 if units*unit_minutes>coalesce(planned,0) then raise exception 'Required teaching minutes exceed planned session duration' using errcode='22023';end if;
 if jsonb_typeof(coalesce(p_brief->'instructions','""'))<>'string' or length(coalesce(p_brief->>'instructions',''))>4000 or jsonb_typeof(coalesce(p_brief->'required_documents','[]'))<>'array' or jsonb_array_length(coalesce(p_brief->'required_documents','[]'))>30 or jsonb_typeof(coalesce(p_brief->'documents','[]'))<>'array' or jsonb_array_length(coalesce(p_brief->'documents','[]'))>20 then raise exception 'Invalid request requirements' using errcode='22023';end if;
 for item in select value from jsonb_array_elements(coalesce(p_brief->'required_documents','[]')) loop
  label:=trim(item#>>'{}');
  if jsonb_typeof(item)<>'string' or length(label) not between 1 and 300 then raise exception 'Required document description invalid' using errcode='22023';end if;
  required:=required||jsonb_build_array(label);
 end loop;
 for item in select value from jsonb_array_elements(coalesce(p_brief->'documents','[]')) loop
  if jsonb_typeof(item)<>'object' or exists(select 1 from jsonb_object_keys(item) k where k not in('version_id','category')) or coalesce(item->>'category','') not in('material','report') then raise exception 'Explicit material/report sharing required' using errcode='22023';end if;
  select * into v from public.document_versions where id=(item->>'version_id')::uuid and status='clean' and sha256 ~ '^[0-9a-f]{64}$';
  if not found then raise exception 'Scanned exact version required' using errcode='42501';end if;
  select * into d from public.documents where id=v.document_id and deleted_at is null and kind='material' and scope='personal';
  if not found or (d.owner_id<>auth.uid() and not exists(select 1 from jsonb_array_elements(coalesce(old_content->'documents','[]')) old where old->>'version_id'=v.id::text)) then raise exception 'Own material or an already shared request version required' using errcode='42501';end if;
  category:=item->>'category';
  if exists(select 1 from jsonb_array_elements(docs) previous where previous->>'version_id'=v.id::text) then raise exception 'Duplicate request version' using errcode='22023';end if;
  docs:=docs||jsonb_build_array(jsonb_build_object('version_id',v.id,'category',category));
 end loop;
 return jsonb_build_object('teaching_units',units,'unit_minutes',unit_minutes,'instructions',coalesce(p_brief->>'instructions',''),'required_documents',required,'documents',docs);
end;$$;

-- Serialize against publication, enforce pre-publication CAS and append the confirmed new snapshot.
create function private.save_client_request_brief(p_request_id uuid,p_brief jsonb,p_expected_version integer) returns integer language plpgsql security definer set search_path='' as $$
declare r private.client_course_requests; current_version integer; normalized jsonb;
begin
 if not private.client_request_access(p_request_id) then raise exception 'Client request access required' using errcode='42501';end if;
 -- Same row lock as publication/cancellation makes the draft-only boundary atomic.
 select * into r from private.client_course_requests where id=p_request_id for update;
 if r.status<>'submitted' or r.job_id is not null then raise exception 'Only unpublished submitted requests can be revised' using errcode='55000';end if;
 select version into current_version from private.client_request_briefs where request_id=p_request_id;
 current_version:=coalesce(current_version,0);
 if p_expected_version is distinct from current_version then raise exception 'Request brief version conflict' using errcode='40001';end if;
 normalized:=private.normalise_client_request_brief(p_request_id,p_brief);
 insert into private.client_request_briefs(request_id,content,version) values(p_request_id,normalized,current_version+1) on conflict(request_id) do update set content=excluded.content,version=excluded.version,updated_at=clock_timestamp();
 return current_version+1;
end;$$;
create function public.save_client_request_brief(p_request_id uuid,p_brief jsonb,p_expected_version integer) returns integer language sql security invoker set search_path='' as $$select private.save_client_request_brief(p_request_id,p_brief,p_expected_version);$$;

-- Create request and brief atomically, preserving the existing normalized-payload retry contract.
create function private.create_client_request_with_brief(p_organisation_id uuid,p_payload jsonb,p_client_id uuid,p_brief jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare target uuid; existing jsonb; initial_brief jsonb; normalized jsonb;
begin
 target:=private.create_client_request(p_organisation_id,p_payload,p_client_id);
 select content into existing from private.client_request_briefs where request_id=target;
 normalized:=private.normalise_client_request_brief(target,p_brief);
 if existing is not null then
  -- A retry must match creation, not a later successful CAS revision by another member.
  select snapshot->'brief' into initial_brief from private.client_request_revisions where request_id=target and event='brief_saved' and snapshot->>'brief_version'='1' order by id limit 1;
  if initial_brief is distinct from normalized then raise exception 'Request brief idempotency conflict' using errcode='22023';end if;
 else perform private.save_client_request_brief(target,normalized,0);end if;
 return target;
end;$$;
create function public.create_client_request_with_brief(p_organisation_id uuid,p_payload jsonb,p_client_id uuid,p_brief jsonb) returns uuid language sql security invoker set search_path='' as $$select private.create_client_request_with_brief(p_organisation_id,p_payload,p_client_id,p_brief);$$;

-- Return bounded decreasing-cursor history only after current organisation authorization.
create function private.client_request_history(p_request_id uuid,p_before bigint default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.client_request_access(p_request_id) then raise exception 'Client request access required' using errcode='42501';end if;
 return coalesce((select jsonb_agg(to_jsonb(h) order by h.id desc) from (select id,event,snapshot,created_at from private.client_request_revisions where request_id=p_request_id and (p_before is null or id<p_before) order by id desc limit 25) h),'[]');
end;$$;
create function public.client_request_history(p_request_id uuid,p_before bigint default null) returns jsonb language sql stable security invoker set search_path='' as $$select private.client_request_history(p_request_id,p_before);$$;
-- Expose brief facts and reviewed file names/hashes, never private Storage object paths.
create function private.client_request_brief(p_request_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare b private.client_request_briefs; r private.client_course_requests;
begin
 if not private.client_request_access(p_request_id) then raise exception 'Client request access required' using errcode='42501';end if;
 select * into r from private.client_course_requests where id=p_request_id;
 select * into b from private.client_request_briefs where request_id=p_request_id;
 return jsonb_build_object('version',coalesce(b.version,0),'brief',b.content,'editable',r.status='submitted' and r.job_id is null,'documents',coalesce((select jsonb_agg(jsonb_build_object('version_id',v.id,'category',item->>'category','name',v.original_name,'sha256',v.sha256) order by v.original_name,v.id) from jsonb_array_elements(coalesce(b.content->'documents','[]')) item join public.document_versions v on v.id=(item->>'version_id')::uuid join public.documents d on d.id=v.document_id where v.status='clean' and d.deleted_at is null and d.kind='material'),'[]'));
end;$$;
create function public.client_request_brief(p_request_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$select private.client_request_brief(p_request_id);$$;
-- Resolve an explicitly shared exact version; Edge repeats this check after reading bytes.
create function private.client_request_document_access(p_request_id uuid,p_version_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.client_request_access(p_request_id) or not exists(select 1 from private.client_request_briefs b cross join lateral jsonb_array_elements(b.content->'documents') item where b.request_id=p_request_id and item->>'version_id'=p_version_id::text) then raise exception 'Request document unavailable' using errcode='42501';end if;
 return (select jsonb_build_object('id',v.id,'document_id',d.id,'object_path',v.object_path,'name',v.original_name,'mime_type',v.mime_type,'sha256',v.sha256) from public.document_versions v join public.documents d on d.id=v.document_id where v.id=p_version_id and v.status='clean' and d.kind='material' and d.scope='personal' and d.deleted_at is null);
end;$$;
create function public.client_request_document_access(p_request_id uuid,p_version_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$select private.client_request_document_access(p_request_id,p_version_id);$$;

create or replace function private.repeat_client_request(p_request_id uuid,p_sessions jsonb,p_client_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare request private.client_course_requests; brief jsonb;
begin
 select * into request from private.client_course_requests where id=p_request_id;
 if not found or not private.client_has_organisation(request.organisation_id) or request.job_id is null or not exists(select 1 from public.job_sessions where job_id=request.job_id) or exists(select 1 from public.job_sessions where job_id=request.job_id and ends_at>now()) then raise exception 'Own delivered client course required' using errcode='42501';end if;
 select content||jsonb_build_object('documents','[]'::jsonb) into brief from private.client_request_briefs where request_id=p_request_id;
 if brief is null then return private.create_client_request(request.organisation_id,request.payload||jsonb_build_object('sessions',p_sessions),p_client_id);end if;
 return private.create_client_request_with_brief(request.organisation_id,request.payload||jsonb_build_object('sessions',p_sessions),p_client_id,brief);
end;$$;

do $$declare f record;begin for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private') and p.proname in('client_request_access','record_client_request_revision','normalise_client_request_brief','save_client_request_brief','create_client_request_with_brief','client_request_history','client_request_brief','client_request_document_access') loop execute format('revoke execute on function %s from public,anon,authenticated',f.signature);end loop;end;$$;
grant execute on function private.save_client_request_brief(uuid,jsonb,integer),public.save_client_request_brief(uuid,jsonb,integer),private.create_client_request_with_brief(uuid,jsonb,uuid,jsonb),public.create_client_request_with_brief(uuid,jsonb,uuid,jsonb),private.client_request_history(uuid,bigint),public.client_request_history(uuid,bigint),private.client_request_brief(uuid),public.client_request_brief(uuid),private.client_request_document_access(uuid,uuid),public.client_request_document_access(uuid,uuid) to authenticated;
commit;
