begin;

-- Extend the reviewed impact graph; never change the authority or confirmation protocol.
alter function private.deletion_scope(text,uuid) rename to deletion_scope_before_owned_cascade;
create function private.deletion_scope(p_kind text,p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb:=private.deletion_scope_before_owned_cascade(p_kind,p_id); ref record; entry jsonb; pred text; parent_pred text; existing text; join_sql text; i integer:=0; processed oid[]:='{}'; job_pred text; parent_alias text; frozen jsonb:='[]'::jsonb; key_columns text; identities text;
begin
 if p_kind not in('account','organisation') then return result;end if;
 if p_kind='organisation' then
  job_pred=format('x.course_run_id in(select id from public.course_runs where organisation_id=%L::uuid) or x.id in(select job_id from private.client_course_requests where organisation_id=%L::uuid union select job_id from private.job_commission_offers where organisation_id=%L::uuid union select job_id from private.claim_revenue_ledger where organisation_id=%L::uuid)',p_id,p_id,p_id,p_id);
  result=private.deletion_add_scope(result,'public.jobs',job_pred);
  -- A general lecturer agreement or a multi-company invoice is shared history.
  -- Include only records exclusively attached to this organisation's own jobs.
  result=private.deletion_add_scope(result,'public.contracts',format('x.id in(select c.contract_id from public.job_claims c join public.jobs j on j.id=c.job_id where %s) and not exists(select 1 from public.job_claims c join public.jobs j on j.id=c.job_id where c.contract_id=x.id and not (%s))',replace(job_pred,'x.','j.'),replace(job_pred,'x.','j.')));
  result=private.deletion_add_scope(result,'public.invoices',format('exists(select 1 from public.invoice_items it join public.job_claims c on c.id=it.claim_id join public.jobs j on j.id=c.job_id where it.invoice_id=x.id and (%s)) and not exists(select 1 from public.invoice_items it join public.job_claims c on c.id=it.claim_id join public.jobs j on j.id=c.job_id where it.invoice_id=x.id and not (%s))',replace(job_pred,'x.','j.'),replace(job_pred,'x.','j.')));
  result=private.deletion_add_scope(result,'public.documents',format('exists(select 1 from public.document_versions cascade_version join public.contracts cascade_contract on cascade_contract.document_version_id=cascade_version.id where cascade_version.document_id=x.id and (%s)) or exists(select 1 from public.document_versions cascade_version join public.invoices cascade_invoice on cascade_invoice.document_version_id=cascade_version.id where cascade_version.document_id=x.id and (%s))',replace(private.deletion_selector(result,'public.contracts'),'x.','cascade_contract.'),replace(private.deletion_selector(result,'public.invoices'),'x.','cascade_invoice.')));
 end if;
 -- Visit every declared ownership relationship once. For accounts, actor/
 -- reviewer attribution never establishes ownership of somebody else's record.
 while i<jsonb_array_length(result) loop
  entry=result->i;i=i+1;
  parent_pred=private.deletion_selector(result,entry->>'table');
  for ref in select c.oid,c.conrelid,c.confrelid,c.conkey,c.confkey,
    format('%I.%I',n.nspname,t.relname) child
   from pg_catalog.pg_constraint c join pg_catalog.pg_class t on t.oid=c.conrelid join pg_catalog.pg_namespace n on n.oid=t.relnamespace
   where c.contype='f' and c.confrelid=(entry->>'table')::regclass and n.nspname in('public','private') order by n.nspname,t.relname,c.conname loop
   if ref.oid=any(processed) then continue;end if;processed=array_append(processed,ref.oid);
   if ref.child='public.audit_events' or ref.conrelid=ref.confrelid then continue;end if;
   if ref.child='public.documents' and ref.confrelid='public.document_versions'::regclass then continue;end if;
   if ref.confrelid='public.profiles'::regclass and not (
    exists(select 1 from unnest(ref.conkey) k join pg_catalog.pg_attribute a on a.attrelid=ref.conrelid and a.attnum=k where a.attname in('user_id','lecturer_id','sender_id','reviewer_id','reporter_id','auth_user_id'))
    or (ref.child='public.documents' and exists(select 1 from unnest(ref.conkey) k join pg_catalog.pg_attribute a on a.attrelid=ref.conrelid and a.attnum=k where a.attname='owner_id'))
   ) then continue;end if;
   parent_alias='cascade_'||ref.oid::text;
   select string_agg(format('x.%I=%s.%I',a.attname,parent_alias,b.attname),' and ' order by k.n) into join_sql
    from unnest(ref.conkey,ref.confkey) with ordinality k(a,b,n) join pg_catalog.pg_attribute a on a.attrelid=ref.conrelid and a.attnum=k.a join pg_catalog.pg_attribute b on b.attrelid=ref.confrelid and b.attnum=k.b;
   pred=format('exists(select 1 from %s %s where (%s) and %s)',entry->>'table',parent_alias,replace(parent_pred,'x.',parent_alias||'.'),join_sql);
   existing=private.deletion_selector(result,ref.child);
   if existing is null then result=private.deletion_add_scope(result,ref.child,pred);
   else
    select coalesce(jsonb_agg(case when e->>'table'=ref.child then jsonb_set(e,'{predicate}',to_jsonb('('||(e->>'predicate')||') or ('||pred||')')) else e end order by n),'[]'::jsonb) into result from jsonb_array_elements(result) with ordinality a(e,n);
   end if;
  end loop;
 end loop;
 -- Freeze the reviewed graph to primary-key identities. Dynamic parent joins
 -- must not stop matching a commercial file after its contract is deleted.
 for entry in select value from jsonb_array_elements(result) loop
  select string_agg(format('x.%I',a.attname),',' order by k.n) into key_columns
   from pg_catalog.pg_constraint c cross join lateral unnest(c.conkey) with ordinality k(att,n) join pg_catalog.pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.att
   where c.contype='p' and c.conrelid=(entry->>'table')::regclass;
  if key_columns is null then raise exception 'Owned deletion relation requires a primary key';end if;
  execute format('select string_agg(quote_literal(row(%s)::text),'','' order by row(%s)::text) from %s x where %s',key_columns,key_columns,entry->>'table',entry->>'predicate') into identities;
  frozen=private.deletion_add_scope(frozen,entry->>'table',case when identities is null then 'false' else format('row(%s)::text in (%s)',key_columns,identities) end);
 end loop;
 return frozen;
end;$$;
revoke all on function private.deletion_scope_before_owned_cascade(text,uuid),private.deletion_scope(text,uuid) from public,anon,authenticated,service_role;

-- A lecturer may own a shared discussion. Preserve its participants/messages,
-- fingerprint the ownership transfer in the same confirmed impact plan.
alter function private.deletion_snapshot(text,uuid) rename to deletion_snapshot_before_owned_cascade;
create function private.deletion_snapshot(p_kind text,p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb:=private.deletion_snapshot_before_owned_cascade(p_kind,p_id); rooms integer; digest text;
begin
 if p_kind='account' then
  select count(*),md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' order by r.id),'')) into rooms,digest from public.chat_rooms r where r.owner_id=p_id;
  result=jsonb_set(result,'{blockers}',coalesce((select jsonb_agg(b) from jsonb_array_elements(result->'blockers') b where b->>'kind'<>'public.chat_rooms'),'[]'::jsonb));
  result=jsonb_set(result,'{counts}',(result->'counts')||jsonb_build_object('released_chat_ownership',rooms));
  result=jsonb_set(result,'{hashes}',(result->'hashes')||jsonb_build_object('released_chat_ownership',digest));
 end if;
 return result;
end;$$;
revoke all on function private.deletion_snapshot_before_owned_cascade(text,uuid),private.deletion_snapshot(text,uuid) from public,anon,authenticated,service_role;

-- Save shared job identities before claims disappear. The existing worker still
-- handles documents, Storage, account Auth deletion, receipts and retry permits.
alter function private.deletion_apply(uuid,uuid) rename to deletion_apply_before_owned_cascade;
create function private.deletion_apply(p_operation_id uuid,p_permit_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare op private.deletion_operations:=private.deletion_require_permit(p_operation_id,p_permit_id); affected uuid[]; result jsonb; target uuid; remaining integer; previous_status text;
begin
 if op.kind='account' and not op.applied then
  select array_agg(distinct job_id order by job_id) into affected from public.job_claims where lecturer_id=op.target_id;
  perform 1 from public.jobs where id=any(affected) order by id for update;
  perform set_config('private.deletion_operation',op.id::text,true);
  update public.chat_rooms r set owner_id=(select m.user_id from public.chat_members m where m.room_id=r.id and m.user_id<>op.target_id and m.removed_at is null and private.chat_staff(m.user_id) order by m.user_id limit 1) where r.owner_id=op.target_id;

 end if;
 result=private.deletion_apply_before_owned_cascade(p_operation_id,p_permit_id);
 foreach target in array coalesce(affected,'{}'::uuid[]) loop
  select status into previous_status from public.jobs where id=target;
  if previous_status in('published','filled') then
   select count(*) into remaining from public.job_claims where job_id=target and status='confirmed';
   update public.jobs set status=case when remaining>=capacity then 'filled' else 'published' end where id=target;
  end if;
 end loop;
 return result;
end;$$;
revoke all on function private.deletion_apply_before_owned_cascade(uuid,uuid),private.deletion_apply(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.deletion_apply(uuid,uuid) to service_role;

-- Retained commercial files cannot be soft-deleted. They are instead fenced
-- atomically by the confirmed operation, then removed by the same worker after
-- their in-scope contract/invoice references disappear. Preserve the general
-- commercial-file protection for every ordinary update and upload path.
do $migration$
declare source text; original text := $$execute format('update public.documents x set deleted_at=coalesce(deleted_at,clock_timestamp()) where %s',entry->>'predicate');$$;
 replacement text := $$execute format('update public.documents x set deleted_at=coalesce(deleted_at,clock_timestamp()) where (%s) and not exists(select 1 from public.document_versions v join public.contracts c on c.document_version_id=v.id where v.document_id=x.id) and not exists(select 1 from public.document_versions v join public.invoices i on i.document_version_id=v.id where v.document_id=x.id)',entry->>'predicate');$$;
begin
 select pg_catalog.pg_get_functiondef('private.deletion_confirm(uuid,uuid,text)'::regprocedure) into source;
 if strpos(source,original)=0 then raise exception 'Unexpected deletion confirmation implementation';end if;
 execute replace(source,original,replacement);
end;$migration$;

commit;
