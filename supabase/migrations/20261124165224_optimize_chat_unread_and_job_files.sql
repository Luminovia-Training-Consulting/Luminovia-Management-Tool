begin;

-- Chat room summaries count live unread messages after each member's cursor.
-- Keep the sender in the index so filtering out the actor's own messages does
-- not require reading the message body. The history index still covers deleted rows.
create index messages_live_unread_cursor
  on public.messages (room_id, created_at desc, id desc)
  include (sender_id)
  where deleted_at is null;

-- Job attachment lists and scoped document discovery read the newest live
-- documents for a single job. The broader job index still supports cleanup.
create index documents_live_job_cursor
  on public.documents (job_id, created_at desc, id desc)
  where job_id is not null and deleted_at is null;

commit;
