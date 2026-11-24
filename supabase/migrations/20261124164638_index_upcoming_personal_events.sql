begin;

-- The dashboard asks for the next five appointments, including events in
-- progress. Seek from the owner's end-time cutoff to avoid reading expired
-- history before the small start-time sort.
create index personal_events_user_end
  on public.personal_events (user_id, ends_at);

commit;
