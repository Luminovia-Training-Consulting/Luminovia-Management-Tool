# LMS packages and installation rights

This matrix records the target package boundaries and the existing paths to
verify. Academy means either managed or self-hosted White Label. Its signed
installation licence still controls availability. Active permits authorised
writes, grace permits the existing approved reads, and expiry denies access.
Individual package changes do not amend signed licence terms.

| Function | Package | Portal and Academy navigation | API and current gate | Authority and data |
| --- | --- | --- | --- | --- |
| Course templates, drafts, publication and archiving | Standard | Courses, calendar, templates, enquiries and reuse | Existing course creator and template RPCs, plus Academy course creation gateway | Company or course manager scope. Preserve origin, revision and date/time zone. Offer preparation and publication are separate. |
| Series and schedule | Standard | Courses → Series | Existing course series preview and save commands | Scope to the company. Preview changes, retain exact existing sessions and reject stale saves. |
| Classes and accounts | Standard | Courses → Class, Companies → Participants, Accounts & Access | `course_class_options`, `set_course_class`, participant reservation and placement RPCs. Internal paths historically checked Premium. | Staff or scoped company authority. Existing account creation, invitation acceptance and linking checks still apply. |
| Enrolment and invitations | Standard | Company participants, course workspace, learner invitations | `course_enrolments`, `manage_course_enrolment`, `assign_company_participant_courses` and invitation RPCs | Own organisation and permitted course. Only verified or explicitly associated accounts. |
| Curriculum | Standard | Learning → Course → Curriculum | `course_content_studio`, `course_content_action` and publication queue. Historically gated by `lms_enabled` and Premium lock. | Assigned staff and enrolled learners. Keep pinned published versions, archived modules, review state and audited version changes. |
| Materials | Standard | Materials library and course workspace | `search_course_materials`, course resource commands, material review, file gateway | Existing ownership, scan policy and exact share/version permissions. |
| Attendance and basic progress | Standard | Course register and learning workspace | `save_course_session_attendance`, attendance import, redacted single-session export and scoped learner workspace | Current register authority, verified attendance separate from self-report. Basic enrolment completion is not a formal receipt. |
| Programme structure and progress | Standard | Learning → Programmes | `learning_programs`, `configure_learning_program_curriculum`, `start_learning_program_course` | Same-company course and membership only. Preserve required/elective rules, sequence, exceptions and progress. |
| Quiz, exams and question bank | Premium | Learning → Course → Exams | Course exam and quiz attempt RPCs, question bank, time allowances and moderation | Current role and course authority. Keep immutable versions and protect answers and marks. |
| Graded assignments and results | Premium | Learning → Assignments, Ratings, Gradebook | Assignment, rubric, grade release and reviewed grade import/export RPCs | Staff editor and own released learner results. Retain existing releases and revision history. |
| Competencies, portfolio and formal receipts | Premium | Course results, portfolio, receipt download | Competency, portfolio, completion issue and restricted document RPCs | Retain scoped evidence and revocation history. No new formal receipt on Standard. |
| SCORM | Standard static content. Premium interactive runtime and formal evidence. | Curriculum packages | `course_scorm_packages`, `course_scorm_download` and `course_scorm_action` use the Standard course context for static versions. `read_course_scorm_runtime` and `save_course_scorm_runtime` retain Premium in the internal portal. | Staff publish an exact package version. Learners receive course-scoped packages and their own runtime state. Static content keeps exact-version validation and inert playback. Progress first recorded in Standard stays out of xAPI even after an upgrade. |
| H5P | Standard ungraded practice. Premium question import, assessed playback and evidence. | Curriculum packages and question bank | `course_h5p_packages`, `course_h5p_download` and `course_h5p_action` use the shared course-content context for publications explicitly marked as practice. `course_h5p_question_import`, `course_h5p_collection_import` and interaction export keep their existing gates. | Staff review imports. Learners receive course-scoped packages. Practice progress stores completion without scores and is excluded from xAPI exports. Existing assessed publications retain their mode. |
| LTI | Standard basic manual resource registration and launch. Premium grade services and existing Advantage workflows. | Course LTI tools | `course_lti_tools`, `save_course_lti_tool` and `prepare_lti_launch` use the shared course scope. Internal Standard exposes basic manual tools without Advantage settings, selected placements or grading records. Deep Linking review and dynamic registration preserve their existing gates. AGS uses `configure_course_lti_ags`, `course_lti_ags_grades` and `lti_ags_service`. | Tool deployment, selected resource, launch receipt and role scope bind access. Grade exchange is separate from launch. `lti_resource_memberships` keeps its own roster disclosure checks. |
| xAPI | Standard native progress. Premium integration evidence and delivery. | Learning and integrations | `course_xapi_statements`, `course_xapi_delivery_monitor` and `report_course_xapi_delivery` protect exports and delivery. Existing records include released grades, package completions and interactions. | Standard enrolment state supplies native progress without writing statements. Exports and reporting preserve staff scope, destination and event identity. |

## Routes by installation

| Area | Luminovia portal | White Label Academy |
| --- | --- | --- |
| Course planning | `/courses` with the calendar at `/calendar`, templates in `/courses?tab=templates` and reviewed enquiries at `/enquiries`. Saved copies and series can open `/courses?editRun=<id>`. | `/learning` contains authorised draft creation and the shared series form. `/courses` redirects to the Academy course hub. |
| Company and learner access | Company participants at `/clients` or `/admin/clients`. Accounts at `/admin/accounts`. Course assignments, withdrawal and attendance use the authorised workspace at `/courses/<id>/workspace`. | Academy account roles and participant management apply to the current installation. Authorised staff manage the course roster and attendance at `/courses/<id>/workspace`. |
| Content, materials and programmes | `/courses/<id>/workspace`, `/learning?view=materials` and `/learning?view=programmes`. Standards-based packages use the same workspace as the ordinary files and curriculum. | The same workspace and learning routes use the signed installation's existing access gate. |
| Assessment and evidence | The workspace exposes authorised Premium assessments, results and evidence. Personal evidence views use their own role and ownership checks. | The same learning routes expose the licensed Academy views. Grace and expiry continue to be decided by the installation licence. |

The Academy's signed licence currently controls installation access. Selection of Standard or Premium for an individual Academy still needs implementation. Current Academy licence terms still apply. See the product roadmap for outstanding editor and acceptance work.

The current implementation moves the internal participant invitation, class
placement, enrolment, attendance register, ordinary course materials, curriculum and programme operations
to Standard. The material picker lists eligible clean versions for course managers.
Material metadata editing and reuse continue to use their existing server gates. Standard programme progress can use a completed enrolment
where there is no formal receipt history. If a receipt exists, its revocation
still withdraws the corresponding credit.

The series creation form accepts a per-run teaching-day count and daily
start/end override in the shared time zone. The variant applies only to the
reviewed drafts being created. Course detail combines visible sessions with
the recorded creation and archive dates. Internal course managers can preview and confirm archive or restore for 2–50
courses. The server applies the batch atomically and rejects stale rows and
locked courses. Edits to saved series patterns, other timeline event sources,
Academy bulk actions and remaining creator entry points require further work.
