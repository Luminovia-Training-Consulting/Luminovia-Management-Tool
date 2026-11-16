# Reading and safely extending SQL migrations

This guide maps the **56 ordered SQL sources through `20261116055929_smart_operations_explicit_plpgsql_types.sql`** without changing their bytes. The earlier 26-source accepted main foundation remains intact. Eight M7/M8 sources and twenty-two smart-operations sources extend it. This is a source checkpoint, not an assertion that a hosted database has applied all 56 or that the current combined acceptance has passed. Accepted migrations form part of the local preview, update and recovery fingerprints. Even an added SQL comment would produce a different source hash. New migrations are added separately; extend this guide and the relevant feature guides when that happens.

The running database reflects **all migrations applied in order**. A later `create or replace function` replaces the earlier implementation. To understand a current RPC, find every definition and read the newest one last. [API_REFERENCE](API_REFERENCE.md) inventories the API, parameters and grants actually read from a migration replay; this guide is not a second authoritative, automatically maintained API inventory. [ERD](ERD.md), [DEVELOPER_GUIDE](DEVELOPER_GUIDE.md) and the relevant feature guides explain how the parts connect.

## Order and purpose

The test files below are existing feature entry points. Listing them does not claim that this documentation pass reran a complete database acceptance test. Run mutating checks only in their own isolated stack through `./portal test`.

### 1. Foundation schema and atomic immediate assignment

Source: [20261115111133_portal_foundation.sql](../supabase/migrations/20261115111133_portal_foundation.sql).

Profiles, roles/capabilities, courses, jobs, claims, calendar snapshots and private events. The initial claim contract serializes access to the lecturer and offer; interval and uniqueness rules protect complete reservation. RLS and column grants limit direct writes. Later migrations replace individual functions, so this first version alone does not describe the current contract.

Test entry point: [db-rpc-tests.mjs](../scripts/db-rpc-tests.mjs).

### 2. Durable invitation reservations

Source: [20261115112053_lecturer_invitations.sql](../supabase/migrations/20261115112053_lecturer_invitations.sql).

`reserve_invitation` and `complete_invitation` separate an authorized reservation from external Auth delivery. Invitation status comes from the durable server ledger. The accounts extension below unifies both entry paths.

Test entry point: [accounts-db-tests.mjs](../scripts/accounts-db-tests.mjs).

### 3. Verification and activation

Source: [20261115113559_lecturer_verification_and_suspension.sql](../supabase/migrations/20261115113559_lecturer_verification_and_suspension.sql).

Management verifies an already declared qualification with an expiry date and can deactivate/reactivate specific accounts. This confirmation does not replace certificate review. Current roles/capabilities and privileged MFA remain required.

Test entry point: [db-rpc-tests.mjs](../scripts/db-rpc-tests.mjs).

### 4. Private document metadata and versions

Source: [20261115121732_private_documents.sql](../supabase/migrations/20261115121732_private_documents.sql).

`documents` and `document_versions` store ownership, context and scan status. `reserve_document` reserves a version; `can_access_document` checks current resource rights. Storage objects are not directly available to browser roles. The Edge gateway serves the bytes actually authorized for the caller.

Test entry point: [documents-db-tests.mjs](../scripts/documents-db-tests.mjs).

### 5. Chat access through membership

Source: [20261115121922_secure_chat_collaboration.sql](../supabase/migrations/20261115121922_secure_chat_collaboration.sql).

Rooms, members, messages, reactions and their revision history share an access boundary. DMs have no blanket administrator access. Course teaching-team and participant chats remain separate. Reads, writes, reactions and read state go through checked routines.

Test entry point: [chat-db-tests.mjs](../scripts/chat-db-tests.mjs).

### 6. Chat attachments with document authorization

Source: [20261115123659_document_chat_attachment_authorization.sql](../supabase/migrations/20261115123659_document_chat_attachment_authorization.sql).

Replaces the initially denying adapter with a check of the clean document and its specific room. A valid document identifier or former room membership alone is insufficient.

Test entry point: [chat-db-tests.mjs](../scripts/chat-db-tests.mjs).

### 7. Versioned knowledge and a moderated forum

Source: [20261115123853_wiki_forum_knowledge.sql](../supabase/migrations/20261115123853_wiki_forum_knowledge.sql).

A restricted Tiptap JSON structure replaces arbitrary HTML. The server validates nodes and derives search text. Wiki drafts, published revisions and revision history remain separate. Forum replies, reports, moderation and subscriptions have distinct permissions; this historical version is staff-only.

Test entry point: [knowledge-db-tests.mjs](../scripts/knowledge-db-tests.mjs).

### 8. Organizations, templates and course runs

Source: [20261115125144_customer_course_operations.sql](../supabase/migrations/20261115125144_customer_course_operations.sql).

Private contacts and notes are stored separately. Reusable templates and actual course runs/sessions are different resources. Read rights follow publication/assignment; copying does not carry over unwanted personal data.

Test entry point: [operations-api-check.mjs](../scripts/operations-api-check.mjs).

### 9. Executed contracts, invoices and payments

Source: [20261115125912_contracts_finance_tracking.sql](../supabase/migrations/20261115125912_contracts_finance_tracking.sql).

Contract and invoice records bind an exact clean PDF version. Acknowledgment records receipt, not an electronic signature. Claims select the valid contract version; invoice items and payments retain immutable snapshots and projections scoped by role.

Test entry point: [commercial-db-tests.mjs](../scripts/commercial-db-tests.mjs).

### 10. Retry identity and owner quotas

Source: [20261115132410_document_reservation_retry_quota.sql](../supabase/migrations/20261115132410_document_reservation_retry_quota.sql).

Replaces only the private reservation implementation while preserving the public signature. The same client operation cannot be reinterpreted as another person's reservation; quotas are charged to the actual document owner.

Test entry point: [documents-db-tests.mjs](../scripts/documents-db-tests.mjs).

### 11. Client accounts and confidential fee allocation

Source: [20261115141620_client_commission_revenue.sql](../supabase/migrations/20261115141620_client_commission_revenue.sql).

Private client requests, offer allocations and the accepted revenue ledger separate the total client price, platform share and lecturer fee. Acceptance copies the valid state into an immutable snapshot. Functional admin/owner roles do not grant access to other people's private resources. Unknown historical total prices remain unknown.

Test entry point: [commission-db-tests.mjs](../scripts/commission-db-tests.mjs).

### 12. Profile details, enrolments and reviews

Source: [20261115141740_profiles_labels_reviews_enrolment.sql](../supabase/migrations/20261115141740_profiles_labels_reviews_enrolment.sql).

Extends personal profiles, safe people projections and optional managed enrolments. Reviews require actual eligibility for completed courses; other reviewers' identities are not generally disclosed. Participant read rights are explicitly integrated into existing course permissions.

Test entry point: [profiles-db-tests.mjs](../scripts/profiles-db-tests.mjs).

### 13. Versioned account and role management

Source: [20261115141856_account_roles_and_api.sql](../supabase/migrations/20261115141856_account_roles_and_api.sql).

The account projection, role changes, activation and both invitation entry points use current database permissions. A shared activation lock prevents concurrent removal of the last active administrator. Browser metadata is not a source of roles.

Test entry point: [accounts-db-tests.mjs](../scripts/accounts-db-tests.mjs).

### 14. Shared and individual storage quotas

Source: [20261115142130_document_storage_capacity.sql](../supabase/migrations/20261115142130_document_storage_capacity.sql).

Server-internal limits and bounded reservation protect total and per-owner capacity. Browser roles cannot change these limits. The 100 MiB file limit is also aligned with the private buckets; it is not a promise of future total capacity.

Test entry point: [documents-db-tests.mjs](../scripts/documents-db-tests.mjs).

### 15. Narrowly scoped avatar selection

Source: [20261115154942_profile_avatar_selection.sql](../supabase/migrations/20261115154942_profile_avatar_selection.sql).

An avatar references a specific clean image version owned by that user. Selection and removal are separate operations. The profile projection does not grant general access to the personal document, other versions or Storage URLs.

Test entry point: [avatars-db-tests.mjs](../scripts/avatars-db-tests.mjs).

### 16. Resource-specific teaching-team comments

Source: [20261115155038_resource_comments.sql](../supabase/migrations/20261115155038_resource_comments.sql).

`private.can_read_job` is shared between job RLS and discussions. Comment and revision data remain private; writing, editing, withdrawal and reasoned MFA moderation are versioned operations. Course participation or client access alone does not grant access to teaching-team discussions.

Test entry point: [comments-db-tests.mjs](../scripts/comments-db-tests.mjs).

### 17. CBW templates and offers linked to their sources

Source: [20261115155208_cbw_building_block_templates.sql](../supabase/migrations/20261115155208_cbw_building_block_templates.sql).

The building block and exact source revision remain separate from editable templates. Hashes, filenames and page references record provenance without shipping the original PDFs. `course_run_job_defaults` and `create_course_run_job` bind the current source revision, actual session IDs and idempotent financial inputs.

Test entry point: [cbw-db-tests.mjs](../scripts/cbw-db-tests.mjs).

### 18. Finite schedule intervals

Source: [20261115180559_finite_schedule_intervals.sql](../supabase/migrations/20261115180559_finite_schedule_intervals.sql).

Additional CHECK constraints reject PostgreSQL +/-infinity at storage boundaries. They validate existing records atomically and stop on invalid history rather than silently changing accepted work. An absent deadline remains NULL.

Test entry point: [schedule-db-tests.mjs](../scripts/schedule-db-tests.mjs).

### 19. Hierarchical German/English topic catalogue

Source: [20261115203718_taxonomy_catalogue_management.sql](../supabase/migrations/20261115203718_taxonomy_catalogue_management.sql).

Existing topic IDs remain historical references. Acquiring the catalogue lock before row locks prevents cycles formed by concurrent moves. CRUD and archiving are versioned; internal trigger helpers have no direct browser execution rights.

Test entry point: [taxonomy-db-tests.mjs](../scripts/taxonomy-db-tests.mjs).

### 20. Versioned offers, cancellation and reopening

Source: [20261115203956_job_lifecycle_audit.sql](../supabase/migrations/20261115203956_job_lifecycle_audit.sql).

Dedicated operation IDs and expected versions protect retries and stale drafts. Eligible future assignments are released in full without deleting accepted price, schedule or revenue history. Explicit audited reopening is required before replacement claims.

Test entry point: [jobs-lifecycle-db-tests.mjs](../scripts/jobs-lifecycle-db-tests.mjs).

### 21. Personal inbox and preferences

Source: [20261115204354_notification_inbox_and_preferences.sql](../supabase/migrations/20261115204354_notification_inbox_and_preferences.sql).

Preferences control future optional notifications; accepted work retains its receipts. Destinations are resolved against current permissions on every read. Deferred job notifications see the transaction's final set of requirements. Reminders are generated on an explicit refresh, not by an assumed scheduler.

Test entry point: [notifications-db-tests.mjs](../scripts/notifications-db-tests.mjs).

### 22. Private availability windows

Source: [20261115210134_lecturer_availability.sql](../supabase/migrations/20261115210134_lecturer_availability.sql).

Personal available/blocked windows are separate from private appointments. Sharing is opt-in and gives management only a reduced view. Locks and triggers serialize conflict checks with actual assignments; internal range/trigger helpers are not public RPCs.

Test entry point: [availability-db-tests.mjs](../scripts/availability-db-tests.mjs).

### 23. Explicit multi-position offers and management Kanban

Source: [20261115210814_job_capacity_and_board.sql](../supabase/migrations/20261115210814_job_capacity_and_board.sql).

Only new offers explicitly priced per position receive 1–20 positions. Legacy, client and CBW offers retain their single-position meaning. `claim_job` locks the person and offer, checks available positions and reserves every session atomically. Lifecycle, cancellation, invoice review and client/revenue projections account for active positions while preserving history.

Test entry point: [jobs-capacity-db-tests.mjs](../scripts/jobs-capacity-db-tests.mjs).

### 24. Bounded administrative audit projection

Source: [20261115213550_admin_audit_viewer.sql](../supabase/migrations/20261115213550_admin_audit_viewer.sql).

Requires the current `audit.read` capability and MFA; only explicitly reviewed action names are allowed. Private action families and `details` JSON are neither returned nor searched. Finite time windows and a timestamp/ID cursor bound the query without broadening the original table RLS.

Test entry point: [admin-audit-db-tests.mjs](../scripts/admin-audit-db-tests.mjs).

### 25. Subordinate roles and private role-specific compensation

Source: [20261116020953_delegated_roles_and_private_role_pricing.sql](../supabase/migrations/20261116020953_delegated_roles_and_private_role_pricing.sql).

Current database authority controls the assignable role catalogue, account lifecycle and invitation completion. Management can assign subordinate roles; self, equal and higher targets remain protected. Guest provides no business capability. Company budget memberships stay administrative, and incompatible staff/company combinations cannot combine private gross and net access.

Administration configures a private versioned compensation policy with current MFA; no business percentages are seeded. Commissioned offers capture their policy and keep raw public price sentinels at zero. `job_offers()` returns only the current actor's net quote, and claim consent binds that quote to the current role. Later role/policy changes do not rewrite accepted revenue, compensation or invoice history. Legacy net-only offers keep their original meaning.

Test entry points: [delegated-pricing-db-tests.mjs](../scripts/delegated-pricing-db-tests.mjs), [commission-api-check.mjs](../scripts/commission-api-check.mjs) and [roles-pricing.spec.ts](../tests/e2e/roles-pricing.spec.ts). [Detailed operating rules](DELEGATED_ROLES_PRICING.md).

### 26. Personal welcome progress

Source: [20261116021008_welcome_guide_progress.sql](../supabase/migrations/20261116021008_welcome_guide_progress.sql).

Own-account invoker RPCs read and version personal step/status state in the unexposed private schema. There is no target-user parameter or administrative bypass. Advancing, pausing or skipping the guide grants no role, MFA level or completed business action. The new source includes an outer BEGIN/COMMIT transaction so retained-data replay records the exact SQL and its history entry atomically; the native migration inventory regression checks this contract for every file.

Test entry points: [welcome-db-tests.mjs](../scripts/welcome-db-tests.mjs), [welcome-api-check.mjs](../scripts/welcome-api-check.mjs), [welcome-guide.spec.ts](../tests/e2e/welcome-guide.spec.ts) and [selfhost-candidate-check.test.mjs](../deploy/hostinger/maintenance/selfhost-candidate-check.test.mjs). [Welcome guide](WELCOME_GUIDE.md).

### 27. Private email preferences and committed-event outbox

Source: [20261116021141_notification_email_outbox.sql](../supabase/migrations/20261116021141_notification_email_outbox.sql).

Own email/quiet-hour/zone preferences are versioned and disabled by default. Notification occurrences enter a private deduplicated outbox; service-only lease/prepare/finish routines separate current eligibility from provider submission. Accepted, suppressed, failed and uncertain outcomes do not imply inbox deletion or an automatic retry after ambiguous SMTP acceptance. Credentials do not belong in these tables.

Test entry point: [notification-delivery-db-tests.mjs](../scripts/notification-delivery-db-tests.mjs).

### 28. Private dashboard layout and teaching-day preparation

Source: [20261116021232_personal_dashboard_and_teaching_day.sql](../supabase/migrations/20261116021232_personal_dashboard_and_teaching_day.sql).

Own allowed widget order/visibility uses CAS. Teaching-day data derives current confirmed, unreleased allocations in the profile zone; an own claim-bound preparation checklist is separate from shared customer progress. Neither preferences nor admin status expose another person's private checklist or files.

Test entry point: [dashboard-personal-db-tests.mjs](../scripts/dashboard-personal-db-tests.mjs).

### 29. Bounded own calendar-file projection

Source: [20261116022220_calendar_file_export.sql](../supabase/migrations/20261116022220_calendar_file_export.sql).

The security-invoker export reads only current-owner confirmed/unreleased allocations and explicitly included own private events. It accepts finite windows and fails beyond 500 events. IANA identity/instants remain explicit; the browser produces ICS from fresh checked data. No calendar copy table is added.

Test entry point: [calendar-export-db-tests.mjs](../scripts/calendar-export-db-tests.mjs).

### 30. Explicit staff-directory contact visibility

Source: [20261116022729_staff_contact_visibility.sql](../supabase/migrations/20261116022729_staff_contact_visibility.sql).

Own email/phone consent defaults off and uses current identity/CAS. The separate contact projection admits active staff to opted-in current Auth email/profile phone; clients/participants and administrative consent overrides are excluded. Existing people/profile projections stay narrow.

Test entry point: [staff-contact-db-tests.mjs](../scripts/staff-contact-db-tests.mjs).

### 31. Version-bound structured chat recipients

Source: [20261116022730_chat_structured_mentions.sql](../supabase/migrations/20261116022730_chat_structured_mentions.sql).

Current room recipients, message/recipient versions, author correction history and moderation remain under the existing chat ACL. Mentions are resolved for the accepted message version rather than trusting displayed names or stale client membership. This adds no administrator access to DMs.

Test entry point: [chat-mentions-db-tests.mjs](../scripts/chat-mentions-db-tests.mjs).

### 32. Paged file discovery and private personal organisation

Source: [20261116022731_file_discovery_personal_organisation.sql](../supabase/migrations/20261116022731_file_discovery_personal_organisation.sql).

Server keyset discovery applies current document permission before returning a page. Own tags/virtual-folder annotations retain a CAS version and do not relocate or share bytes. The UI preserves captured operations across changing filters but separately rechecks their exact current target; private response caching is not introduced.

Test entry point: [files-discovery-db-tests.mjs](../scripts/files-discovery-db-tests.mjs).

### 33. Paged job discovery and own saved views

Source: [20261116022732_job_discovery_and_saved_views.sql](../supabase/migrations/20261116022732_job_discovery_and_saved_views.sql).

Job discovery uses complete cursors and validated server filters; saved views belong to the active account. Eligibility, capacity and the final atomic claim remain separate checked operations. Neither paging nor a saved filter raises the REST row cap or grants commercial access.

Test entry point: [job-discovery-db-tests.mjs](../scripts/job-discovery-db-tests.mjs).

### 34. Own in-app attention windows

Source: [20261116022733_notification_attention_preferences.sql](../supabase/migrations/20261116022733_notification_attention_preferences.sql).

Versioned own quiet-window preferences alter in-app attention, not underlying notification history or another account's events. Later smart notification definitions deliberately preserve operational receipts and add current external-channel checks.

Test entry point: [attention-db-tests.mjs](../scripts/attention-db-tests.mjs).

### 35. Explicit published announcement revisions

Source: [20261116022734_portal_announcements.sql](../supabase/migrations/20261116022734_portal_announcements.sql).

Private draft and published revision lifecycles separate editing from audience/window publication. Acknowledgement binds the exact published revision and current active audience; it is not a general file or course grant.

Test entry point: [announcements-db-tests.mjs](../scripts/announcements-db-tests.mjs).

### 36. Purpose-scoped administrative job choices

Source: [20261116022735_scoped_administrative_job_pickers.sql](../supabase/migrations/20261116022735_scoped_administrative_job_pickers.sql).

Checked picker projections replace unpaged job choices for file attachments and participant-course channels. Each purpose requires its own current capability/MFA; course metadata does not leak hidden job fees/text. The supplied selected choice is resolved in the same bounded request. No new picker table is created.

Test entry point: [job-picker-db-tests.mjs](../scripts/job-picker-db-tests.mjs).

### 37. Versioned global-event publication

Source: [20261116022736_global_calendar_publications.sql](../supabase/migrations/20261116022736_global_calendar_publications.sql).

Extends the existing global-events lifecycle with explicit draft/publish/unpublish/archive/recovery, finite windows, cursor pages and a private retry ledger. Recovery does not republish automatically. No global-event role grants access to personal calendar rows.

Test entry point: [calendar-global-db-tests.mjs](../scripts/calendar-global-db-tests.mjs).

### 38. Explicit exact qualification evidence and attestation history

Source: [20261116022737_qualification_evidence_and_attestation_history.sql](../supabase/migrations/20261116022737_qualification_evidence_and_attestation_history.sql).

Own consent binds an exact clean personal certificate version/hash to a selected topic. Current qualification managers/MFA may review that evidence and record versioned decisions/history; the legacy verification signature delegates to the same attestation core. Blanket foreign certificate access/upload is removed. Withdrawal prevents future evidence download without silently rewriting earlier verification or accepted assignments.

Test entry point: [qualifications-db-tests.mjs](../scripts/qualifications-db-tests.mjs).

### 39. Waitlist interest and atomic explicit substitution

Source: [20261116031429_assignment_waitlist_and_substitution.sql](../supabase/migrations/20261116031429_assignment_waitlist_and_substitution.sql).

Private waitlist rows record interest without reserving capacity. Substitution proposals fix the original claim, target, quote/hash, expiry and retry identity. Explicit target acceptance serializes both lecturer schedules, rechecks current eligibility and atomically releases/recreates the complete block while retaining original accepted history.

Test entry point: [assignment-handover-db-tests.mjs](../scripts/assignment-handover-db-tests.mjs).

### 40. Device opt-in and committed Web Push delivery

Source: [20261116031533_web_push_notifications.sql](../supabase/migrations/20261116031533_web_push_notifications.sql).

A private configuration singleton, owner-bound provider subscriptions and occurrence/device outbox separate browser consent from external delivery. Endpoint/encryption validation, active-device expiry, service-only worker leases and recipient eligibility fail closed. VAPID private material is operating configuration; source does not establish actual device permission or delivery.

Test entry point: [web-push-db-tests.mjs](../scripts/web-push-db-tests.mjs).

### 41. Shared course and participant learning workspace

Source: [20261116031728_course_learning_workspace.sql](../supabase/migrations/20261116031728_course_learning_workspace.sql).

Adds scoped preparation/contact settings, exact material/report resources and receipts, audited attendance, staff/learner Q&A, private notebooks, identity-protected feedback aggregates, immutable quiz versions/eligible attempts and frozen completion facts. The workspace derives current manager/assignment/enrolment/client scope. Repeat booking creates a fresh future request; later brief integration copies requirements without private learner data.

Test entry point: [course-workspace-db-tests.mjs](../scripts/course-workspace-db-tests.mjs).

### 42. Private favourites, versioned tasks and reusable workflows

Source: [20261116032008_personal_workbench_and_tasks.sql](../supabase/migrations/20261116032008_personal_workbench_and_tasks.sql).

Private/operations tasks retain CAS history, exact creation retries and bounded all-or-none bulk changes. Templates/applications bind a selected revision and retry key. Message-derived tasks require continuing current source-room access; neither manager access nor a copied description bypasses private scope. Favourites/recommendations re-resolve current resource/eligibility rights.

Test entry point: [workbench-db-tests.mjs](../scripts/workbench-db-tests.mjs).

### 43. Audited teaching time, printable finance facts and Control Center

Source: [20261116032842_timesheets_finance_and_control_center.sql](../supabase/migrations/20261116032842_timesheets_finance_and_control_center.sql).

Timesheets bind actual assignment sessions, bounded intervals/breaks, nonoverlap and audited review/retry state. Accepted compensation remains unchanged. Current capability/MFA gates own/all printable stable-hash facts, original-currency forecasts and date-bounded operational exceptions; customer gross requires its separate capability. No accounting, bank, payroll or legal-signature integration is implied.

Test entry point: [timesheets-finance-db-tests.mjs](../scripts/timesheets-finance-db-tests.mjs).

### 44. Revocable private calendar capabilities

Source: [20261116034053_private_calendar_subscriptions.sql](../supabase/migrations/20261116034053_private_calendar_subscriptions.sql).

Own creation/rotation/revocation binds CAS/retry keys and stores only a token hash plus explicit private-event inclusion and expiry. Service-only snapshot/recheck routines validate current active owner and the capability before/after rendering. The exact GET calendar-feed endpoint is the reviewed JWT exception; all other function authentication remains unchanged.

Test entry point: [calendar-subscriptions-db-tests.mjs](../scripts/calendar-subscriptions-db-tests.mjs).

### 45. Current-permission unified search

Source: [20261116034638_permission_aware_unified_search.sql](../supabase/migrations/20261116034638_permission_aware_unified_search.sql).

Adds a checked paginated union across the actual authorized modules, with kind/title/UUID cursor and bounded input/page size. Selected wiki revisions, current chat/task access and commercial capability checks prevent a search index from becoming a new read grant. No global materialized search table or all-pages browser download is added.

Test entry point: [unified-search-db-tests.mjs](../scripts/unified-search-db-tests.mjs).

### 46. Cross-feature notification targets and delivery rechecks

Source: [20261116040854_smart_operations_notifications.sql](../supabase/migrations/20261116040854_smart_operations_notifications.sql).

Replaces earlier target/category/prepare/reminder/attention definitions with the combined course, task, waitlist/substitution, timesheet and existing notification model. Committed changes emit scoped generic notifications; current recipient, channel, quiet-window and resource rights are checked again at delivery. Read this latest definition after the initial inbox/email/Push migrations.

Test entry point: [smart-notifications-db-tests.mjs](../scripts/smart-notifications-db-tests.mjs).

### 47. Direct current-authorisation task lookup

Source: [20261116041354_workbench_direct_task_lookup.sql](../supabase/migrations/20261116041354_workbench_direct_task_lookup.sql).

Resolves an explicit task deep link through the same current task/source-message helper used by paged tasks. Finding a private task by UUID never widens its visibility and avoids fetching every history page in the browser. No new table is created.

Test entry point: [workbench-db-tests.mjs](../scripts/workbench-db-tests.mjs).

### 48. Versioned customer teaching briefs and immutable request snapshots

Source: [20261116042100_client_request_brief_and_history.sql](../supabase/migrations/20261116042100_client_request_brief_and_history.sql).

Adds explicit whole teaching units of 45/60 minutes, required-document descriptions and exact scanned material/report attachments without changing original prices. Required minutes must fit planned sessions. Atomic creation retries compare the immutable first brief; edits share the publication row lock and CAS boundary before publication. Current organisation history uses stable pages, while repeat booking copies requirements/time but no attachments or learner records.

Test entry point: [client-request-brief-db-tests.mjs](../scripts/client-request-brief-db-tests.mjs).

### 49. Own qualification passport facts

Source: [20261116044535_own_qualification_passport.sql](../supabase/migrations/20261116044535_own_qualification_passport.sql).

The invoker API accepts locale and a bounded current snapshot instant, derives its subject from the actual active lecturer and returns explicit facts plus SHA-256. Verified/unverified/expired eligibility, current evidence availability and historical attestation provenance remain separate. It neither exports certificate bytes/private paths nor creates verification decisions. The protected PDF gateway repeats the same facts/access read before releasing generated bytes.

Test entry points: [qualification-passport-db-tests.mjs](../scripts/qualification-passport-db-tests.mjs), [qualification-passport-api-check.mjs](../scripts/qualification-passport-api-check.mjs).

### 50. Recipient-role substitution pricing and unknown forecast costs

Source: [20261116045011_role_aware_handover_and_forecast.sql](../supabase/migrations/20261116045011_role_aware_handover_and_forecast.sql).

Captures the recipient's own private role-pricing context and net quote. Acceptance rechecks that context under the existing locks, then independently verifies the inserted claim and revenue snapshot. Original accepted fees and customer gross remain immutable. Other lecturers and ordinary management cannot inspect the recipient's fee/hash. Role-dependent prospective costs remain unknown (`null`) with an explicit count rather than presenting the raw privacy sentinel as a zero cost.

Test entry points: [role-aware-handover-db-tests.mjs](../scripts/role-aware-handover-db-tests.mjs), [role-aware-handover-api-check.mjs](../scripts/role-aware-handover-api-check.mjs).

### 51. Actor-specific discovery quotes and context-bound cursors

Source: [20261116045609_role_aware_job_discovery.sql](../supabase/migrations/20261116045609_role_aware_job_discovery.sql).

This is the authoritative current discovery bridge, superseding the earlier M7 raw-price implementation. All price filters/sorts/previews use the current actor's captured-offer quote. Unknown manager prices remain nullable, fail monetary bounds and sort last in either direction. The server-derived cursor context includes actor, role/tier and policy revision; stale monetary cursors fail after role or policy changes. Private helpers have explicit execution revokes.

Test entry points: [job-discovery-db-tests.mjs](../scripts/job-discovery-db-tests.mjs), [role-aware-job-discovery-db-tests.mjs](../scripts/role-aware-job-discovery-db-tests.mjs), including role-pricing, privacy, null ordering and cursor-revocation cases.

### 52. Withdrawal authority after concurrent role edits

Source: [20261116051736_substitution_withdrawal_permission_recheck.sql](../supabase/migrations/20261116051736_substitution_withdrawal_permission_recheck.sql).

Rechecks current manager withdrawal capability after the profile, schedule, job, claim and offer locks. A request queued behind a role edit cannot use its former permission. Immutable proposer/source ownership remains a separate active-account right. No released substitution implementation is edited.

Test entry point: [role-aware-handover-db-tests.mjs](../scripts/role-aware-handover-db-tests.mjs), including an observed blocked-session negative-control regression.

### 53. Current course context in the own Teaching Day

Source: [20261116052704_teaching_day_course_workspace.sql](../supabase/migrations/20261116052704_teaching_day_course_workspace.sql).

Extends the existing own-day projection with the current nonarchived course, its explicitly selected same-organisation shared contact, shared preparation totals and bounded exact authorised clean resource versions. The active lecturer must still own a confirmed, unreleased assignment session. Internal contacts/notes, another organisation's contact and private document versions remain excluded. Shared progress stays distinct from the lecturer's three private checklist items.

Test entry points: [teaching-day-course-db-tests.mjs](../scripts/teaching-day-course-db-tests.mjs), [dashboard-personal-api-check.mjs](../scripts/dashboard-personal-api-check.mjs).

### 54. Current resulting assignment on accepted retries

Source: [20261116052910_substitution_receipt_current_status.sql](../supabase/migrations/20261116052910_substitution_receipt_current_status.sql).

An exact accepted-offer retry reads the resulting claim's current owner, job and status under the existing locks. A subsequently cancelled assignment returns `cancelled`, without new reservations, notifications or audit events. Exact quote hash and explicit terms consent remain mandatory. Historical accepted-offer state alone no longer fabricates a current confirmation.

Test entry points: [role-aware-handover-db-tests.mjs](../scripts/role-aware-handover-db-tests.mjs), [role-aware-handover-api-check.mjs](../scripts/role-aware-handover-api-check.mjs).

### 55. Current lecturer authority on accepted retries

Source: [20261116054135_substitution_retry_current_lecturer_authority.sql](../supabase/migrations/20261116054135_substitution_retry_current_lecturer_authority.sql).

After the existing profile/workflow locks and exact consent checks, accepted retries require current lecturer authority. An active account that lost its teaching role receives `not_eligible`; a suspended account is denied. Tests observe both role and activation mutations holding the profile lock, then verify the waiting request uses the newly committed authority without changing business history or creating notices.

Test entry points: [role-aware-handover-db-tests.mjs](../scripts/role-aware-handover-db-tests.mjs), [role-aware-handover-api-check.mjs](../scripts/role-aware-handover-api-check.mjs). The vulnerable52910-only negative control fails the new role-revocation regression.

### 56. Explicit PL/pgSQL initializer types and quiz index

Source: [20261116055929_smart_operations_explicit_plpgsql_types.sql](../supabase/migrations/20261116055929_smart_operations_explicit_plpgsql_types.sql).

The strict complete-CI lint gate found implicit text-to-UUID-array/JSONB initializer conversions and a shadowed quiz loop index/unused local row. This forward migration explicitly types the three empty values, removes the unused declaration and gives the automatic loop index its own name. Independent exact-definition comparison confirms every other business, permission, lock, retry and grant remains unchanged. All three replacement routines pass actual `plpgsql_check` with ordinary/extra warnings enabled; focused course/workbench/brief SQL flows pass. The complete CI gate is retained.

Test entry points: [course-workspace-db-tests.mjs](../scripts/course-workspace-db-tests.mjs), [workbench-db-tests.mjs](../scripts/workbench-db-tests.mjs), [client-request-brief-db-tests.mjs](../scripts/client-request-brief-db-tests.mjs).

## The critical data flows

**A job is claimed:** browser draft and idempotency key → public `claim_job` invoker → latest private implementation → current actor, locks, contract/qualification/capacity/time-conflict checks → immutable claim/schedule/revenue snapshots, memberships and notifications → transaction commit → confirmed UI. An error cannot leave a partially successful multi-day booking. Kanban calls permitted lifecycle actions; dragging a card does not create a claim.

**A file is uploaded:** authenticated Edge request → bounded and validated bytes → version reserved under caller permissions → immutable quarantine bytes → actual scan → fresh current-permission check → clean exact version. A download checks current rights again; a saved notification or avatar ID is not a permanent access token. SQL metadata alone does not prove an actual object transfer or a clean scan.

**A private projection is read:** authenticated actor → current capability/MFA and resource rights → explicitly bounded result. A `public` wrapper is an API boundary, not proof of public visibility. An internal `security definer` implementation technically bypasses RLS, so it must retain its own actor/resource checks and precise grants. Administrative overviews do not implicitly grant access to private DMs, calendars or contracts.

**A substitution is accepted:** targeted quote/hash and explicit acceptance → current actor/resource checks → stable profile/scheduling/job/claim lock order → renewed qualification/contract/conflict/invoice checks → complete old block release plus new immutable claim/allocation → commit. The waitlist does not allocate or bypass this protocol.

**A brief is revised or repeated:** current organisation scope → request publication row lock → expected brief version → whole teaching-time and exact scanned-version validation → append immutable snapshot → commit. A creation retry compares the immutable first brief; later revisions remain intact. Repetition requests new future dates and never copies learner records or document consent.

**A protected printable document is downloaded:** caller JWT/current Auth → reviewed SQL facts/exact share → private Storage bytes or bounded deterministic PDF rendering → SHA-256 and repeat current Auth/permission/fact checks → private/no-store response. Vendored fonts/runtime and the release archive are separate source assets, not a migration or a legal signature.

**An external notice is delivered:** committed business event → deduplicated occurrence/device outbox → service-only bounded lease → fresh current recipient/preference/quiet-window/resource preparation → provider submission → explicit outcome. An uncertain handoff does not become a fabricated success or an automatic duplicate retry. Worker installation/provider/device acceptance is separate from database replay.

## Unreleased branch version reconciliation

The eight M7/M8 migrations were still unmerged and unapplied on the authorised CMS target. Their original branch identifiers preceded the accepted PR18 welcome migration and the initial PR17 snapshot. A retained-data rehearsal correctly rejected that order. Before release, only those eight filenames were assigned the following forward identifiers; every SQL byte/SHA-256 remained identical. The24accepted foundation sources and PR17's four initial sources were unchanged. No live history was repaired or reset; strict updater/native order checks remain enabled.

| Original branch version | Release version |
| ----------------------- | --------------- |
| 20261115230301          | 20261116022730  |
| 20261115230604          | 20261116022731  |
| 20261115230702          | 20261116022732  |
| 20261115231704          | 20261116022733  |
| 20261115232824          | 20261116022734  |
| 20261116003728          | 20261116022735  |
| 20261116003733          | 20261116022736  |
| 20261116004358          | 20261116022737  |

A private experimental database that applied old unmerged identifiers needs separate inspection; do not reset or falsify its history. The actual CMS has18 earlier versions. Accepted main and the initial PR17 snapshot remain forward baselines.

The reviewed updater plan is an operating-controller extension, not a migration. See [REVIEWED_MIGRATION_PLANS](REVIEWED_MIGRATION_PLANS.md) for exact release/history binding, one-shot private approval and backup/checkpoint/rollback. Source documentation does not establish live activation or combined acceptance.

## Before changing SQL

1. Find the definition, later replacements, triggers, RLS/grants and every API caller. An internal trigger or documented RPC without a browser import is not automatically dead code.
2. Create a **new additive migration** with the installed Supabase CLI. Include an explicit outer BEGIN/COMMIT envelope for exact-source atomic history replay. Do not rewrite released SQL files, production history or accepted snapshots.
3. Comment new tables, functions, lock ordering, actor/MFA checks, `search_path`, versioning/idempotency and grants directly in the new SQL source. New internal helpers need explicit EXECUTE revokes; do not broadly expand wrapper/definer boundaries.
4. Check a fresh replay, actual RLS/concurrency and the affected Auth/API/browser flows. Updating an existing database and preserving actual Storage bytes require separate evidence. Use the existing isolated full verification command and document the stages actually reached.
5. Update the API reference only through its intended actual replay; also update this guide, feature documentation, plan and work log. Hosted migrations follow the existing operations and approval path.
