begin;

-- Anonymous API requests pass through the public invoker wrapper. Schema usage
-- exposes no data; only the no-op-for-anon pre-request helper is executable.
grant usage on schema private to anon;

commit;
