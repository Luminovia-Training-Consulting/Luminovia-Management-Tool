begin;

alter table private.notification_email_outbox
  add column academy_release_commit text check (academy_release_commit ~ '^[0-9a-f]{40}$'),
  add column academy_authorized_at timestamptz;

create function private.academy_email_release()
returns text language sql stable security definer set search_path = '' as $$
  select access.release_commit
  from private.academy_course_access access
  where private.academy_course_access_status() = 'active'
    and exists (select 1 from private.mail_transport_settings settings
      where settings.singleton and settings.smtp_enabled and settings.smtp_secret_id is not null);
$$;

-- Apply the same recipient-specific course checks as the inbox. Use a scoped
-- identity only within this worker check and restore the original request.
create function private.academy_notification_email_current(
  p_user uuid, p_kind text, p_resource uuid, p_release text
) returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare
  claims text := current_setting('request.jwt.claims', true);
  subject text := current_setting('request.jwt.claim.sub', true);
  permitted boolean;
begin
  if p_release is null or private.academy_email_release() is distinct from p_release
     or p_kind not in ('chat_message','academy_course_enrolled','course_resource_shared','course_attendance_updated')
     or not exists (
       select 1 from private.delivery_preferences preferences
       join public.profiles profile on profile.id = preferences.user_id and profile.active
       join auth.users identity on identity.id = profile.id and identity.email_confirmed_at is not null
       where preferences.user_id = p_user and preferences.email_enabled
     )
     or (p_kind = 'chat_message' and (
       not private.email_category_enabled(p_user, p_kind) or not exists (
         select 1 from public.messages message
         join public.chat_members member on member.room_id = message.room_id and member.user_id = p_user
           and member.removed_at is null and not member.muted
         where message.id = p_resource and message.deleted_at is null
       )
     )) then return false; end if;
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  permitted := private.academy_notification_target(p_kind, p_resource) is not null;
  perform set_config('request.jwt.claims', coalesce(claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(subject, ''), true);
  return permitted;
exception when others then
  perform set_config('request.jwt.claims', coalesce(claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(subject, ''), true);
  raise;
end;
$$;

-- The private SMTP listener calls this once after authenticating the upstream
-- provider, immediately before its SMTP DATA command.
create function private.authorize_academy_notification_email(
  p_id uuid, p_lease_token uuid, p_recipient text, p_transport_version integer
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  outbox private.notification_email_outbox;
begin
  perform private.require_email_worker();
  select * into outbox from private.notification_email_outbox where id = p_id for update;
  if not found or outbox.state <> 'sending' or outbox.lease_token is distinct from p_lease_token
     or outbox.lease_until <= now() or outbox.academy_release_commit is null
     or outbox.academy_authorized_at is not null
     or not exists (select 1 from private.mail_transport_settings settings
       where settings.singleton and settings.version = p_transport_version)
     then return false; end if;
  if not exists (
    select 1 from public.notifications notice
    join auth.users identity on identity.id = notice.user_id and identity.email_confirmed_at is not null
    join private.delivery_preferences preferences on preferences.user_id = notice.user_id
    where notice.id = outbox.notification_id and notice.created_at = outbox.occurrence_at
      and identity.email = p_recipient
      and private.email_quiet_until(preferences.time_zone, preferences.quiet_start, preferences.quiet_end, now()) is null
      and private.academy_notification_email_current(notice.user_id, notice.kind, notice.resource_id, outbox.academy_release_commit)
  ) then return false; end if;
  update private.notification_email_outbox set academy_authorized_at = now() where id = outbox.id;
  return true;
end;
$$;
create function public.authorize_academy_notification_email(
  p_id uuid, p_lease_token uuid, p_recipient text, p_transport_version integer
) returns boolean language sql security invoker set search_path = '' as $$
  select private.authorize_academy_notification_email(p_id, p_lease_token, p_recipient, p_transport_version);
$$;

revoke all on function private.academy_email_release(),
  private.academy_notification_email_current(uuid,text,uuid,text),
  private.authorize_academy_notification_email(uuid,uuid,text,integer),
  public.authorize_academy_notification_email(uuid,uuid,text,integer)
  from public,anon,authenticated,service_role;
grant execute on function private.authorize_academy_notification_email(uuid,uuid,text,integer),
  public.authorize_academy_notification_email(uuid,uuid,text,integer) to service_role;

create function private.academy_notification_worker_request_allowed()
returns boolean language sql stable security definer set search_path = '' as $$
  select current_setting('role',true) = 'service_role'
    and current_setting('request.method',true) = 'POST'
    and (
      current_setting('request.path',true) = '/rpc/finish_notification_email'
      or (private.academy_email_release() is not null and current_setting('request.path',true) in (
        '/rpc/lease_notification_emails','/rpc/prepare_notification_email','/rpc/authorize_academy_notification_email'
      ))
    )
    and coalesce(coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb->>'accept-profile','public') = 'public'
    and coalesce(coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb->>'content-profile','public') = 'public';
$$;
revoke all on function private.academy_notification_worker_request_allowed() from public,anon,authenticated,service_role;
grant execute on function private.academy_notification_worker_request_allowed() to service_role;

do $migration$
declare
  source text;
  change record;
  internal_only constant text := ' if (select edition from private.installation_identity) <> ''internal'' then return new; end if;';
  category_guard constant text := 'or not private.email_category_enabled(n.user_id,n.kind) or not private.notification_delivery_allowed(n.user_id,n.kind,n.resource_id)';
  user_guard constant text := 'if not private.actor_active() then raise exception ''Account inactive'' using errcode=''42501''; end if;';
  worker_guard constant text := ' perform private.require_email_worker();';
  admin_anchor constant text := '  licence_status := private.academy_course_access_status();';
  service_anchor constant text := '      perform private.require_academy_human_login_access();';
begin
  for change in select * from (values
    ('private.queue_notification_email()'::regprocedure, internal_only,
      $queue$ if (select edition from private.installation_identity) <> 'internal' then
  if tg_op = 'UPDATE' and new.created_at is not distinct from old.created_at then return new; end if;
  insert into private.notification_email_outbox(notification_id,occurrence_at,academy_release_commit)
  select new.id,new.created_at,access.release_commit from private.academy_course_access access
  where private.academy_notification_email_current(new.user_id,new.kind,new.resource_id,access.release_commit)
  on conflict do nothing;
  return new;
 end if;$queue$),
    ('private.lease_notification_emails(integer)'::regprocedure, worker_guard,
      worker_guard || $lease$
 if (select edition from private.installation_identity) <> 'internal' and private.academy_email_release() is null then
  return '[]'::jsonb;
 end if;$lease$),
    ('private.lease_notification_emails(integer)'::regprocedure, 'last_outcome=null',
      'last_outcome=null,academy_authorized_at=null'),
    ('private.prepare_notification_email(uuid,uuid)'::regprocedure, category_guard,
      $prepare$or not (case when (select edition from private.installation_identity) = 'internal' then
  o.academy_release_commit is null and private.email_category_enabled(n.user_id,n.kind)
    and private.notification_delivery_allowed(n.user_id,n.kind,n.resource_id)
  else n.created_at = o.occurrence_at and
    private.academy_notification_email_current(n.user_id,n.kind,n.resource_id,o.academy_release_commit)
 end)$prepare$),
    ('private.finish_notification_email(uuid,uuid,text,text)'::regprocedure,
      $finish$ if o.last_outcome=p_outcome then return true; end if;$finish$,
      $finish$ if o.last_outcome=p_outcome then return true; end if;
 if o.academy_release_commit is not null and p_outcome='accepted'
    and o.academy_authorized_at is null then return false; end if;$finish$),
    ('private.refresh_notification_reminders(integer)'::regprocedure, worker_guard,
      worker_guard || $reminders$
 if (select edition from private.installation_identity) <> 'internal' then return 0; end if;$reminders$),
    ('private.delivery_preferences()'::regprocedure, user_guard,
      $read$if (select edition from private.installation_identity) <> 'internal' then
  if not private.learning_actor() or
     not coalesce(private.academy_course_access_status() in ('active','grace'),false) then
    raise insufficient_privilege;
  end if;
 else
  if not private.actor_active() then raise insufficient_privilege; end if;
 end if;$read$),
    ('private.save_delivery_preferences(jsonb,integer)'::regprocedure, user_guard,
      $save$if (select edition from private.installation_identity) <> 'internal' then
  perform private.lock_academy_course_access();
  if not private.learning_actor() then raise insufficient_privilege; end if;
 else
  if not private.actor_active() then raise insufficient_privilege; end if;
 end if;$save$),
    ('private.require_academy_course_access()'::regprocedure, admin_anchor,
      admin_anchor || $gate$
  if request_method = 'POST' and (
    (licence_status in ('active','grace') and request_path = '/rpc/delivery_preferences')
    or (licence_status = 'active' and request_path = '/rpc/save_delivery_preferences')
  ) then return; end if;$gate$),
    ('public.require_portal_access()'::regprocedure, service_anchor,
      $gate$      if private.academy_notification_worker_request_allowed() then return; end if;
$gate$ || service_anchor)
  ) as changes(routine,anchor,replacement)
  loop
    source := pg_get_functiondef(change.routine);
    if cardinality(string_to_array(source,change.anchor)) <> 2 then
      raise exception 'Expected one academy notification email boundary in %',change.routine;
    end if;
    execute replace(source,change.anchor,change.replacement);
  end loop;
end;
$migration$;

notify pgrst, 'reload schema';
commit;
