\set ON_ERROR_STOP on
begin isolation level repeatable read read only;
set local search_path = '';
set local statement_timeout = '5min';
set local time zone 'UTC';

\echo @metadata
select pg_catalog.json_build_object(
  'installation_id', identity.installation_id,
  'edition', identity.edition,
  'release', licence.terms->>'release_commit',
  'captured_at', transaction_timestamp()
)
from private.installation_identity identity
join private.installation_verified_licence licence using (installation_id)
where identity.singleton and identity.edition in ('customer-managed', 'customer-self-hosted');

\echo @organisations
select row_to_json(item) from (
  select id, name, country, time_zone, created_at, archived_at
  from public.organisations order by id
) item;

\echo @templates
select row_to_json(item) from (
  select template.id, template.title,
    case when template.building_block_source_id is null then template.description end as description,
    case when template.building_block_source_id is null then template.syllabus end as syllabus,
    case when template.building_block_source_id is null then template.prerequisites end as prerequisites,
    template.building_block_source_id is not null as bundled_template,
    template.created_at, template.archived_at
  from public.course_templates template
  where template.building_block_source_id is null
    or exists (select from public.course_runs course where course.template_id = template.id)
  order by template.id
) item;

\echo @courses
select row_to_json(item) from (
  select id, template_id, organisation_id, time_zone, created_at,
    delivery_type, venue, published, archived_at
  from public.course_runs order by id
) item;

\echo @classes
select row_to_json(item) from (
  select id, organisation_id, name from private.course_classes order by organisation_id, id
) item;

\echo @class_assignments
select row_to_json(item) from (
  select course_id, organisation_id, class_id, version
  from private.course_class_assignments order by course_id
) item;

\echo @sessions
select row_to_json(item) from (
  select id, course_run_id, starts_at, ends_at
  from public.course_sessions order by course_run_id, starts_at, id
) item;

\echo @participants
select row_to_json(item) from (
  select profile.id, profile.display_name, account.email, profile.luminovia_user_id,
    profile.locale, profile.time_zone, profile.active, profile.created_at
  from public.profiles profile
  join auth.users account on account.id = profile.id
  where exists (select from public.course_enrolments enrolment where enrolment.user_id = profile.id)
    or exists (select from private.company_participant_memberships membership where membership.user_id = profile.id)
  order by profile.id
) item;

\echo @participant_memberships
select row_to_json(item) from (
  select organisation_id, user_id, status, joined_at, removed_at, version
  from private.company_participant_memberships order by organisation_id, user_id
) item;

\echo @enrolments
select row_to_json(item) from (
  select course_run_id, user_id, status, created_at, updated_at
  from public.course_enrolments order by course_run_id, user_id
) item;

\echo @instructor_assignments
select row_to_json(item) from (
  select assignment.course_id, assignment.instructor_id, profile.display_name,
    assignment.created_at, assignment.released_at
  from private.academy_course_instructors assignment
  join public.profiles profile on profile.id = assignment.instructor_id
  order by assignment.course_id, assignment.instructor_id, assignment.claim_id
) item;

\echo @attendance
select row_to_json(item) from (
  select session_id, user_id, state, minutes, register_status, arrival_at, departure_at, version, updated_at
  from private.course_attendance order by session_id, user_id
) item;

\echo @completion
select row_to_json(item) from (
  select id, run_id, user_id, snapshot, created_at, revoked_at
  from private.course_completion_records order by run_id, user_id, id
) item;

\echo @attendance_evidence
select row_to_json(item) from (
  select id, session_id, resource_id, version_id, source, attached_at
  from private.course_attendance_evidence order by session_id, id
) item;

\echo @file_links
select row_to_json(item) from (
  select id, run_id, version_id, audience, category, created_at, removed_at
  from private.course_resources
  union all
  select id, run_id, version_id, audience, 'exam', created_at, removed_at
  from private.course_exam_documents
  order by run_id, id
) item;

\echo @files
select row_to_json(item) from (
  select version.id, version.document_id, version.version, version.object_path,
    version.original_name, version.mime_type, version.size_bytes, version.sha256
  from public.document_versions version
  join public.documents document on document.id = version.document_id
  where version.status = 'clean' and document.deleted_at is null and document.kind = 'material' and (
    exists (select from private.course_resources resource where resource.version_id = version.id)
    or exists (select from private.course_exam_documents exam where exam.version_id = version.id)
    or exists (
      select from private.course_attendance_evidence evidence
      join public.course_sessions session on session.id = evidence.session_id
      cross join lateral private.academy_attendance_evidence_version(
        session.course_run_id, session.id, evidence.version_id
      ) approved
      where evidence.version_id = version.id and evidence.source = 'academy_scan'
    )
  )
  order by version.id
) item;

commit;
\echo @complete
