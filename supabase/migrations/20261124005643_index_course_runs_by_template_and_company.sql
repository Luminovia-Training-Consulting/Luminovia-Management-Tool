begin;

-- Template access checks look up its runs and compare their owning companies.
-- Keep that lookup bounded as the course history grows.
create index course_runs_template_organisation_idx
  on public.course_runs(template_id, organisation_id);

commit;
