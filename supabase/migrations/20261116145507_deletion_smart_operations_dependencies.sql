-- Integrate deletion with accepted smart-operation ownership. Historical migration
-- bytes remain unchanged. Existing function privileges and caller checks survive
-- replacement; shared evidence and uncertain external deliveries remain blockers.

create or replace function private.deletion_scope(p_kind text,p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb:='[]'::jsonb;root text:=private.deletion_registry()->>p_kind;entry jsonb;ref record;pred text;join_sql text;i integer:=0;
begin
 if root is null or p_id is null then raise exception 'Unknown deletion kind' using errcode='22023';end if;
 result=private.deletion_add_scope(result,root,format('x.id=%L::uuid',p_id));
 if p_kind='document' then
  result=private.deletion_add_scope(result,'public.document_versions',format('x.document_id=%L::uuid',p_id));
  result=private.deletion_add_scope(result,'public.profile_avatars',format('x.document_version_id in(select id from public.document_versions where document_id=%L::uuid)',p_id));
 elsif p_kind='account' then
  -- Shared commercial records and somebody else's uploaded documents are not
  -- owned children. Their foreign keys deliberately become explicit blockers.
  result=private.deletion_add_scope(result,'public.personal_events',format('x.user_id=%L::uuid',p_id));
  result=private.deletion_add_scope(result,'public.lecturer_availability',format('x.user_id=%L::uuid',p_id));
  result=private.deletion_add_scope(result,'public.notifications',format('x.user_id=%L::uuid',p_id));
  result=private.deletion_add_scope(result,'public.chat_members',format('x.user_id=%L::uuid',p_id));
  result=private.deletion_add_scope(result,'public.message_reactions',format('x.user_id=%L::uuid',p_id));
  result=private.deletion_add_scope(result,'public.client_organisation_memberships',format('x.user_id=%L::uuid',p_id));
  result=private.deletion_add_scope(result,'public.invitation_requests',format('x.auth_user_id=%L::uuid',p_id));
  result=private.deletion_add_scope(result,'private.notification_push_outbox',format('x.notification_id in(select id from public.notifications where user_id=%L::uuid) or x.subscription_id in(select id from private.push_subscriptions where user_id=%L::uuid)',p_id,p_id));
 elsif p_kind='assignment' then
  result=private.deletion_add_scope(result,'public.assignment_sessions',format('x.claim_id=%L::uuid',p_id));
  result=private.deletion_add_scope(result,'public.claim_events',format('x.claim_id=%L::uuid',p_id));
  result=private.deletion_add_scope(result,'public.notifications',format('(x.resource_id=%L::uuid and x.kind in(''claim_confirmed'',''claim_cancelled'')) or (x.kind=''session_reminder'' and x.resource_id in(select id from public.assignment_sessions where claim_id=%L::uuid))',p_id,p_id));
  result=private.deletion_add_scope(result,'private.job_lifecycle_requests',format('x.result=%L::uuid or x.payload->>''claim_id''=%L',p_id,p_id::text));
 elsif p_kind='job' then
  result=private.deletion_add_scope(result,'public.notifications',format('x.resource_id=%L::uuid and x.kind in(''job_matching'',''job_reopened'',''job_waitlist_available'')',p_id));
  result=private.deletion_add_scope(result,'private.client_course_requests',format('x.job_id=%L::uuid',p_id));
  result=private.deletion_add_scope(result,'private.job_commission_offers',format('x.job_id=%L::uuid',p_id));
  result=private.deletion_add_scope(result,'private.course_run_job_requests',format('x.job_id=%L::uuid',p_id));
  result=private.deletion_add_scope(result,'private.job_lifecycle_requests',format('x.result=%L::uuid or x.payload->>''job_id''=%L',p_id,p_id::text));
 elsif p_kind='message' or p_kind='chat_room' then
  if p_kind='chat_room' then
   result=private.deletion_add_scope(result,'public.chat_members',format('x.room_id=%L::uuid',p_id));
   result=private.deletion_add_scope(result,'public.messages',format('x.room_id=%L::uuid',p_id));
  end if;
  pred=case when p_kind='message' then format('x.message_id=%L::uuid',p_id) else format('x.message_id in(select id from public.messages where room_id=%L::uuid)',p_id) end;
  result=private.deletion_add_scope(result,'public.message_reactions',pred);
  result=private.deletion_add_scope(result,'public.chat_message_revisions',pred);
 elsif p_kind='resource_comment' then
  result=private.deletion_add_scope(result,'private.resource_comment_revisions',format('x.comment_id=%L::uuid',p_id));
 end if;
 -- Accepted personal preferences, subscription credentials, inbox delivery
 -- bookkeeping, waitlists, preparation and a request's own brief history are
 -- explicitly owned children. Course evidence, shared tasks, substitutions and
 -- finance rows deliberately remain protected inbound relationships.
 -- Follow only declared ownership cascades. Other inbound relationships are
 -- reported; they never silently grow the user's confirmed deletion scope.
 while i<jsonb_array_length(result) loop
  entry=result->i;i=i+1;
  for ref in select c.oid,c.conrelid::regclass::text child,c.conkey,c.confkey,c.confrelid
   from pg_catalog.pg_constraint c where c.contype='f' and c.confdeltype='c' and c.confrelid=(entry->>'table')::regclass
   and c.connamespace in('public'::regnamespace,'private'::regnamespace) loop
   if not ((ref.child||'->'||(entry->>'table'))=any(array['public.user_roles->public.profiles','public.lecturer_topics->public.profiles','public.profile_details->public.profiles','public.profile_avatars->public.profiles','public.job_sessions->public.jobs','public.job_requirements->public.jobs','public.organisation_private_details->public.organisations','public.organisation_contacts->public.organisations','public.course_template_topics->public.course_templates','public.wiki_revisions->public.wiki_pages','public.forum_posts->public.forum_threads','public.forum_post_revisions->public.forum_posts','public.forum_subscriptions->public.forum_threads','public.forum_reports->public.forum_posts','private.notification_preferences->public.profiles','private.welcome_progress->public.profiles','private.chat_content_versions->public.messages','private.chat_mention_versions->private.chat_content_versions','private.chat_mention_requests->public.profiles','private.document_organisation->public.profiles','private.document_organisation->public.documents','private.saved_job_views->public.profiles','private.attention_preferences->public.profiles','private.announcement_revisions->private.portal_announcements','private.announcement_publications->private.announcement_revisions','private.announcement_acknowledgements->public.profiles','private.announcement_acknowledgements->private.announcement_revisions','private.announcement_requests->public.profiles','private.global_event_requests->public.profiles','private.qualification_states->public.profiles','private.qualification_evidence->public.profiles','private.qualification_evidence->public.document_versions','private.qualification_events->public.profiles','private.qualification_events->private.qualification_evidence','private.qualification_requests->public.profiles','private.delivery_preferences->public.profiles','private.dashboard_preferences->public.profiles','private.staff_contact_visibility->public.profiles','private.push_subscriptions->public.profiles','private.calendar_subscriptions->public.profiles','private.personal_favourites->public.profiles','private.job_waitlist->public.profiles','private.job_waitlist->public.jobs','private.course_notebooks->public.profiles','private.course_resource_acknowledgements->public.profiles','private.notification_email_outbox->public.notifications','private.notification_push_outbox->public.notifications','private.notification_push_outbox->private.push_subscriptions','private.teaching_preparation->public.job_claims','private.client_request_briefs->private.client_course_requests','private.client_request_revisions->private.client_course_requests'])) or private.deletion_selector(result,ref.child) is not null then continue;end if;
   select string_agg(format('x.%I=parent%s.%I',a.attname,i,b.attname),' and ' order by k.n) into join_sql
    from unnest(ref.conkey,ref.confkey) with ordinality k(a,b,n)
    join pg_catalog.pg_attribute a on a.attrelid=ref.child::regclass and a.attnum=k.a
    join pg_catalog.pg_attribute b on b.attrelid=ref.confrelid and b.attnum=k.b;
   pred=format('exists(select 1 from %s parent%s where (%s) and %s)',entry->>'table',i,replace(entry->>'predicate','x.','parent'||i::text||'.'),join_sql);
   result=private.deletion_add_scope(result,ref.child,pred);
  end loop;
 end loop;
 return result;
end;$$;

create or replace function private.deletion_snapshot(p_kind text,p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare scope jsonb:=private.deletion_scope(p_kind,p_id);entry jsonb;ref record;counts jsonb:='{}'::jsonb;hashes jsonb:='{}'::jsonb;blockers jsonb:='[]'::jsonb;n bigint;digest text;join_sql text;excluded text;root text:=private.deletion_registry()->>p_kind;present boolean;active_deliveries bigint:=0;
begin
 execute format('select exists(select 1 from %s x where x.id=$1)',root) into present using p_id;
 if not present then raise exception 'Deletion target unavailable' using errcode='22023';end if;
 for entry in select value from jsonb_array_elements(scope) loop
  execute format('select count(*),md5(coalesce(string_agg(md5(to_jsonb(x)::text),'''' order by md5(to_jsonb(x)::text)),'''')) from %s x where %s',entry->>'table',entry->>'predicate') into n,digest;
  counts=counts||jsonb_build_object(entry->>'table',n);hashes=hashes||jsonb_build_object(entry->>'table',digest);
  if entry->>'table' in('private.notification_email_outbox','private.notification_push_outbox') then
   -- An expired lease or unknown transport outcome does not prove an external
   -- sender stopped. Never turn a timer into permission to erase its barrier.
   execute format('select count(*) from %s x where (%s) and x.state in(''leased'',''sending'',''uncertain'')',entry->>'table',entry->>'predicate') into n;
   active_deliveries=active_deliveries+n;
  end if;
  for ref in select c.oid,c.conrelid::regclass::text child,c.conkey,c.confkey,c.confrelid
   from pg_catalog.pg_constraint c where c.contype='f' and c.confrelid=(entry->>'table')::regclass and not(c.conrelid='public.audit_events'::regclass and c.conname='audit_events_actor_id_fkey') loop
   select string_agg(format('x.%I=y.%I',a.attname,b.attname),' and ' order by k.n) into join_sql
    from unnest(ref.conkey,ref.confkey) with ordinality k(a,b,n)
    join pg_catalog.pg_attribute a on a.attrelid=ref.child::regclass and a.attnum=k.a
    join pg_catalog.pg_attribute b on b.attrelid=ref.confrelid and b.attnum=k.b;
   excluded=private.deletion_selector(scope,ref.child);
   execute format('select count(*) from %s x where exists(select 1 from %s y where (%s) and %s)%s',ref.child,entry->>'table',replace(entry->>'predicate','x.','y.'),join_sql,case when excluded is null then '' else ' and not ('||excluded||')' end) into n;
   if n>0 then blockers=blockers||jsonb_build_array(jsonb_build_object('code','referenced','kind',ref.child,'count',n));end if;
  end loop;
 end loop;
 if active_deliveries>0 then
  blockers=blockers||jsonb_build_array(jsonb_build_object('code','referenced','kind','pending_external_deliveries','count',active_deliveries));
 end if;
 if p_kind='payment' then
  -- Booked and voided payment records are retained financial history. Corrections
  -- use the existing audited void operation, never physical removal.
  blockers=blockers||jsonb_build_array(jsonb_build_object('code','referenced','kind','protected_payment_history','count',1));
 end if;
 if p_kind='account' then
  select count(*),md5(coalesce(string_agg(md5(to_jsonb(a)::text),'' order by md5(to_jsonb(a)::text)),'')) into n,digest from public.audit_events a where a.actor_id=p_id;
  counts=counts||jsonb_build_object('audit_attributions',n);hashes=hashes||jsonb_build_object('audit_attributions',digest);
  select count(*) into n from private.deletion_operations where actor_id=p_id and authority in('owner','scoped') and status<>'completed';
  if n>0 then blockers=blockers||jsonb_build_array(jsonb_build_object('code','referenced','kind','pending_personal_deletions','count',n));end if;
 end if;
 return jsonb_build_object('scope',scope,'counts',counts,'hashes',hashes,'blockers',blockers);
end;$$;

create or replace function private.deletion_apply(p_operation_id uuid,p_permit_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare o private.deletion_operations:=private.deletion_require_permit(p_operation_id,p_permit_id);remaining jsonb;next_remaining jsonb;entry jsonb;progress boolean;affected_job_id uuid;affected_lecturer_id uuid;job public.jobs;other_claims integer;active_deliveries bigint;
begin
 if o.applied or o.status='completed' then return private.deletion_operation_view(o.id);end if;
 if o.kind='payment' then raise exception 'Payment history must be corrected through audited voiding' using errcode='23503';end if;
 -- All outbox row states were fingerprinted again under confirmation's
 -- relation locks. Recheck under row locks before granting the execution fence
 -- bypass, even if an internal repair changed a sender state after confirmation.
 for entry in select value from jsonb_array_elements(o.scope) where value->>'table' in('private.notification_email_outbox','private.notification_push_outbox') order by value->>'table' loop
  execute format('select 1 from %s x where %s for update',entry->>'table',entry->>'predicate');
  execute format('select count(*) from %s x where (%s) and x.state in(''leased'',''sending'',''uncertain'')',entry->>'table',entry->>'predicate') into active_deliveries;
  if active_deliveries>0 then raise exception 'External delivery settlement pending' using errcode='55000';end if;
 end loop;
 if private.deletion_pending_uploads(o.scope)>0 then raise exception 'Upload cleanup pending' using errcode='55000';end if;
 perform set_config('private.deletion_operation',o.id::text,true);
 if o.kind='assignment' then
  select c.job_id,c.lecturer_id into affected_job_id,affected_lecturer_id from public.job_claims c where c.id=o.target_id;
  select * into job from public.jobs where id=affected_job_id for update;
 end if;
 -- Resolve the document/version cycle without modifying retained commercial
 -- versions. The preview has already rejected contracts/invoices outside scope.
 for entry in select value from jsonb_array_elements(o.scope) where value->>'table'='public.documents' loop
  execute format('update public.documents x set current_version_id=null where %s',entry->>'predicate');
 end loop;
 remaining=o.scope;
 while jsonb_array_length(remaining)>0 loop
  progress=false;next_remaining='[]'::jsonb;
  for entry in select value from jsonb_array_elements(remaining) with ordinality e(value,n) order by n desc loop
   begin
    execute format('delete from %s x where %s',entry->>'table',entry->>'predicate');progress=true;
   exception when foreign_key_violation then next_remaining=next_remaining||jsonb_build_array(entry);
   end;
  end loop;
  if not progress then raise exception 'Protected deletion dependency changed' using errcode='23503';end if;
  remaining=next_remaining;
 end loop;
 if affected_job_id is not null then
  -- Match cancellation's room-before-member lock order. A historical claim
  -- deletion cannot revoke a newer confirmed allocation for the same lecturer.
  perform 1 from public.chat_rooms where job_id=affected_job_id and kind='lecturer_course' for update;
  if not exists(select 1 from public.job_claims where job_id=affected_job_id and lecturer_id=affected_lecturer_id and status='confirmed') then
   update public.chat_members m set removed_at=clock_timestamp() from public.chat_rooms r where r.job_id=affected_job_id and r.kind='lecturer_course' and m.room_id=r.id and m.user_id=affected_lecturer_id and m.removed_at is null;
   update public.chat_rooms r set owner_id=(select other.lecturer_id from public.job_claims other join public.chat_members member on member.room_id=r.id and member.user_id=other.lecturer_id and member.removed_at is null where other.job_id=affected_job_id and other.status='confirmed' and private.chat_staff(other.lecturer_id) order by other.created_at,other.id limit 1) where r.job_id=affected_job_id and r.kind='lecturer_course' and r.owner_id=affected_lecturer_id;
  end if;
 end if;
 if affected_job_id is not null and job.status<>'archived' then
  select count(*) into other_claims from public.job_claims where job_claims.job_id=affected_job_id and status='confirmed';
  update public.jobs set status=case when other_claims=0 then 'draft' when job.status in('published','filled') then case when other_claims>=job.capacity then 'filled' else 'published' end else job.status end where id=affected_job_id;
  insert into public.audit_events(actor_id,action,resource_id,details) values((select actor_id from private.deletion_permits where id=p_permit_id),'assignment.deletion.applied',affected_job_id,jsonb_build_object('operation_id',o.id,'remaining_confirmed',other_claims));
 end if;
 update private.deletion_operations set applied=true where id=o.id;
 return private.deletion_operation_view(o.id);
end;$$;
