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
| Attendance and basic progress | Standard | Course register and learning workspace | `save_course_session_attendance`, attendance import and scoped learner workspace | Current register authority, verified attendance separate from self-report. Basic enrolment completion is not a formal receipt. |
| Programme structure and progress | Standard | Learning → Programmes | `learning_programs`, `configure_learning_program_curriculum`, `start_learning_program_course` | Same-company course and membership only. Preserve required/elective rules, sequence, exceptions and progress. |
| Quiz, exams and question bank | Premium | Learning → Course → Exams | Course exam and quiz attempt RPCs, question bank, time allowances and moderation | Current role and course authority. Keep immutable versions and protect answers and marks. |
| Graded assignments and results | Premium | Learning → Assignments, Ratings, Gradebook | Assignment, rubric, grade release and reviewed grade import/export RPCs | Staff editor and own released learner results. Retain existing releases and revision history. |
| Competencies, portfolio and formal receipts | Premium | Course results, portfolio, receipt download | Competency, portfolio, completion issue and restricted document RPCs | Retain scoped evidence and revocation history. No new formal receipt on Standard. |
| SCORM | Standard content target, Premium assessed runtime/evidence | Curriculum packages | Existing static package validation/playback, active isolated runtime and completion record RPCs | Keep package origin isolation. Separate read/playback from recorded scored attempts before changing runtime gates. |
| H5P | Standard ungraded content target, Premium assessed questions and evidence | Curriculum, question bank | Existing playback, question import, collections and interaction/xAPI RPCs | Only explicitly ungraded content may use Standard. Preserve moderated imports and authorised statement access. |
| LTI | Standard ungraded resource target, Premium grade services | Course LTI tools | Existing resource launch, Deep Linking, AGS and roster services | Grade-enabled bindings and callbacks remain Premium. Roster disclosure keeps its own role and privacy requirements. |
| xAPI | Standard native progress, Premium integration evidence | Learning and integrations | Existing released grades, package completion, interaction export and delivery monitoring | Standard progress can use enrolment without emitting a statement. Keep destination, actor and event scope. |

Integration rows describe the target partition. Existing integration gates and
licence promises stay in effect until each capability is independently split
and verified. See the product roadmap for outstanding editor and acceptance work.

The current implementation moves the internal participant invitation, class
placement, enrolment, attendance register, curriculum and programme operations
to Standard. The existing Academy licence rules and current integration gates
remain in force. Standard programme progress can use a completed enrolment
where there is no formal receipt history. If a receipt exists, its revocation
still withdraws the corresponding credit.

The series creation form accepts a per-run teaching-day count and daily
start/end override in the shared time zone. The variant applies only to the
reviewed drafts being created. Course detail combines visible sessions with
the recorded creation and archive dates. Bulk operations, edits to saved
series patterns, other timeline event sources and remaining creator entry
points require further work.
