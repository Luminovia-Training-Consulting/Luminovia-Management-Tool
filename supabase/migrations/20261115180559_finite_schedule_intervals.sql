begin;
-- PostgreSQL accepts +/-infinity as timestamps. Scheduling those values creates
-- an unreadable calendar interval and can block a lecturer indefinitely, even
-- through the original create_job/claim API. Enforce the invariant at storage
-- boundaries so every current and future writer receives the same protection.
-- These checks deliberately validate existing rows. An invalid historical row
-- stops this transaction for operator review; no accepted work is rewritten.
alter table public.course_sessions add constraint course_sessions_finite_interval
  check (isfinite(starts_at) and isfinite(ends_at));
alter table public.job_sessions add constraint job_sessions_finite_interval
  check (isfinite(starts_at) and isfinite(ends_at));
alter table public.assignment_sessions add constraint assignment_sessions_finite_interval
  check (isfinite(starts_at) and isfinite(ends_at));
alter table public.personal_events add constraint personal_events_finite_interval
  check (isfinite(starts_at) and isfinite(ends_at));
alter table public.global_events add constraint global_events_finite_interval
  check (isfinite(starts_at) and isfinite(ends_at));
-- An offer without a deadline remains representable as NULL, never infinity.
alter table public.jobs add constraint jobs_finite_claim_deadline
  check (claim_deadline is null or isfinite(claim_deadline));
commit;
