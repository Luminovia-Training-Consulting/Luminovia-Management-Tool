begin;

-- The signed-in inbox preview and history both count currently visible unread
-- notifications. Index only unread rows so that read history is skipped.
create index notifications_unread_inbox
  on public.notifications (user_id, created_at desc, id desc)
  include (kind, resource_id)
  where read_at is null;

-- Keep the time index for the unfiltered activity view and the retention job.
-- A filtered page can seek directly to its action and ordered cursor.
create index administration_activity_action_time
  on private.administration_activity (action, created_at desc, id desc);

-- Analytics looks up both the first active session and overlapping active
-- sessions by claim. The general claim index also covers released sessions.
create index assignment_sessions_active_claim_start
  on public.assignment_sessions (claim_id, starts_at)
  include (ends_at)
  where released_at is null;

commit;
