begin;

-- Job discovery, matching notices and assignment checks repeatedly test a
-- candidate's private calendar for overlap with an individual session. Index
-- both the owner and the range so long histories are not scanned per session.
create index personal_events_user_overlap on public.personal_events
  using gist (user_id, tstzrange(starts_at, ends_at, '[)'));

create index lecturer_unavailable_user_overlap on public.lecturer_availability
  using gist (user_id, tstzrange(starts_at, ends_at, '[)'))
  where kind = 'unavailable';

commit;
