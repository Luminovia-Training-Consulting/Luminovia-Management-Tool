# Reading and safely extending SQL migrations

The first **24 entries describe the accepted main baseline** without changing its SQL bytes. The operational extension below adds five separately versioned migrations; its presence in source does not claim installation. Accepted migrations form part of the local preview, update and recovery fingerprints. Even an added SQL comment would produce a different source hash. New migrations are added separately; extend this guide and the relevant feature guides when that happens.

The running database reflects **all migrations applied in order**. A later `create or replace function` replaces the earlier implementation. To understand a current RPC, find every definition and read the newest one last. [API_REFERENCE](API_REFERENCE.md) inventories the API, parameters and grants actually read from a migration replay; this guide is not a second authoritative, automatically maintained API inventory. [ERD](ERD.md), [DEVELOPER_GUIDE](DEVELOPER_GUIDE.md) and the relevant feature guides explain how the parts connect.

## Order and purpose

The test files below are existing feature entry points. Listing them does not claim that this documentation pass reran a complete database acceptance test. Run mutating checks only in their own isolated stack through `./portal test`.

### 01. Foundation schema and atomic immediate assignment

Source: [20261115111133_portal_foundation.sql](../supabase/migrations/20261115111133_portal_foundation.sql).

Profiles, roles/capabilities, courses, jobs, claims, calendar snapshots and private events. The initial claim contract serializes access to the lecturer and offer; interval and uniqueness rules protect complete reservation. RLS and column grants limit direct writes. Later migrations replace individual functions, so this first version alone does not describe the current contract.

Test entry point: [db-rpc-tests.mjs](../scripts/db-rpc-tests.mjs).

### 02. Durable invitation reservations

Source: [20261115112053_lecturer_invitations.sql](../supabase/migrations/20261115112053_lecturer_invitations.sql).

`reserve_invitation` and `complete_invitation` separate an authorized reservation from external Auth delivery. Invitation status comes from the durable server ledger. The accounts extension below unifies both entry paths.

Test entry point: [accounts-db-tests.mjs](../scripts/accounts-db-tests.mjs).

### 03. Verification and activation

Source: [20261115113559_lecturer_verification_and_suspension.sql](../supabase/migrations/20261115113559_lecturer_verification_and_suspension.sql).

Management verifies an already declared qualification with an expiry date and can deactivate/reactivate specific accounts. This confirmation does not replace certificate review. Current roles/capabilities and privileged MFA remain required.

Test entry point: [db-rpc-tests.mjs](../scripts/db-rpc-tests.mjs).

### 04. Private document metadata and versions

Source: [20261115121732_private_documents.sql](../supabase/migrations/20261115121732_private_documents.sql).

`documents` and `document_versions` store ownership, context and scan status. `reserve_document` reserves a version; `can_access_document` checks current resource rights. Storage objects are not directly available to browser roles. The Edge gateway serves the bytes actually authorized for the caller.

Test entry point: [documents-db-tests.mjs](../scripts/documents-db-tests.mjs).

### 05. Chat access through membership

Source: [20261115121922_secure_chat_collaboration.sql](../supabase/migrations/20261115121922_secure_chat_collaboration.sql).

Rooms, members, messages, reactions and their revision history share an access boundary. DMs have no blanket administrator access. Course teaching-team and participant chats remain separate. Reads, writes, reactions and read state go through checked routines.

Test entry point: [chat-db-tests.mjs](../scripts/chat-db-tests.mjs).

### 06. Chat attachments with document authorization

Source: [20261115123659_document_chat_attachment_authorization.sql](../supabase/migrations/20261115123659_document_chat_attachment_authorization.sql).

Replaces the initially denying adapter with a check of the clean document and its specific room. A valid document identifier or former room membership alone is insufficient.

Test entry point: [chat-db-tests.mjs](../scripts/chat-db-tests.mjs).

### 07. Versioned knowledge and a moderated forum

Source: [20261115123853_wiki_forum_knowledge.sql](../supabase/migrations/20261115123853_wiki_forum_knowledge.sql).

A restricted Tiptap JSON structure replaces arbitrary HTML. The server validates nodes and derives search text. Wiki drafts, published revisions and revision history remain separate. Forum replies, reports, moderation and subscriptions have distinct permissions; this historical version is staff-only.

Test entry point: [knowledge-db-tests.mjs](../scripts/knowledge-db-tests.mjs).

### 08. Organizations, templates and course runs

Source: [20261115125144_customer_course_operations.sql](../supabase/migrations/20261115125144_customer_course_operations.sql).

Private contacts and notes are stored separately. Reusable templates and actual course runs/sessions are different resources. Read rights follow publication/assignment; copying does not carry over unwanted personal data.

Test entry point: [operations-api-check.mjs](../scripts/operations-api-check.mjs).

### 09. Executed contracts, invoices and payments

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

### 25. Derived course readiness and scoped preparation

Source: [20261116034641_course_readiness.sql](../supabase/migrations/20261116034641_course_readiness.sql).

Private settings/tasks/instruction receipts complement live assignment, agreement, qualification, material, contact and schedule checks. No percentage setter exists. Reads require current course management/MFA or assignment ownership; historical or published visibility alone does not grant preparation access. Writers lock the run before the preparation advisory lock, and compare reviewed versions. A thin wrapper reuses current standalone job creation and fills its newly created run's mode/venue; it never rewrites existing authored runs.

Tests: [readiness-db-tests.mjs](../scripts/readiness-db-tests.mjs), [readiness-api-check.mjs](../scripts/readiness-api-check.mjs).

### 26. Private support tickets and dedicated attachments

Source: [20261116034757_internal_support_desk.sql](../supabase/migrations/20261116034757_internal_support_desk.sql).

Own ticket history and explicit MFA support authority replace an administrator-wide shortcut. Replies, internal notes, transitions, version checks and retry receipts stay private; internal notes/files are withheld from requesters. Clean single-version evidence becomes dedicated/frozen and the ticket ACL takes precedence over ordinary personal-document ownership, including after role revocation.

Tests: [support-db-tests.mjs](../scripts/support-db-tests.mjs), [support-api-check.mjs](../scripts/support-api-check.mjs).

### 27. Whole-block replacement without premature release

Source: [20261116034812_replacement_marketplace.sql](../supabase/migrations/20261116034812_replacement_marketplace.sql).

Open/selected emergency searches keep the original confirmed allocation. Sorted profile/lecturer locks precede job/claim/offer locks. The existing current claim implementation executes inside a subtransaction; every failed handover restores the original, while success retains old financial/schedule history and transfers current calendar/chat/file authority. Optional role-price helpers are discovered by exact trusted signatures and missing quotes fail closed. Started/invoiced/partial-work orchestration and ordered notifications remain explicit limitations.

Tests: [replacements-db-tests.mjs](../scripts/replacements-db-tests.mjs), [replacements-api-check.mjs](../scripts/replacements-api-check.mjs).

### 28. Immutable lecturer delivery evidence

Source: [20261116034826_attendance_delivery.sql](../supabase/migrations/20261116034826_attendance_delivery.sql).

Assignment sessions own drafts, immutable submitted revisions and independent review/customer events. Version/request locks protect concurrent changes. Customer projections omit draft/private notes/invoice IDs; existing accepted fees and invoices never change when evidence is corrected. The feature records freelance teaching delivery and does not introduce payroll or clock-in processing.

Tests: [delivery-db-tests.mjs](../scripts/delivery-db-tests.mjs), [delivery-api-check.mjs](../scripts/delivery-api-check.mjs).

### 29. Current-authority operational inbox targets

Source: [20261116035802_operations_notification_integration.sql](../supabase/migrations/20261116035802_operations_notification_integration.sql).

Preserves the prior resolver and composes readiness/support/delivery/replacement destinations under current access. Assigned preparation reminders respect preferences and actual task changes. Removed memberships, cancelled allocations and revoked capabilities cannot turn an old notification into a private-resource link. No mail service or public cache is added.

Strict non-trigger body diagnostics are additionally checked by [operations-lint-db-tests.mjs](../scripts/operations-lint-db-tests.mjs); canonical SQL lint/advisor/trigger and actual Auth/browser checks remain mandatory. [The extension ledger](OPERATIONS_EXTENSION_STATUS.md) distinguishes executed focused checks from full acceptance and release status.

### 30. Private website enquiry intake and course planning

Source: [20261116041140_website_enquiry_intake.sql](../supabase/migrations/20261116041140_website_enquiry_intake.sql).

The existing Edge/gateway architecture accepts only an explicitly enabled trusted sender with a separate server credential and configured privacy-notice version. A service-only RPC validates and records minimal intake, sender limits and duplicate-safe receipts; public responses disclose no internal directory data. Current MFA organisation management handles private notes, responsibility, customer/contact creation and transactional conversion into an existing-style course run. No price or invoice is inferred from an enquiry. The inbox composes its current-authority resolver with all prior feature destinations. Public Website activation remains a separate transport/approval boundary.

Tests: [enquiries-db-tests.mjs](../scripts/enquiries-db-tests.mjs), [enquiries-api-check.mjs](../scripts/enquiries-api-check.mjs), the Edge handler cases and actual isolated gateway checks. [Operating/configuration guide](WEBSITE_ENQUIRIES.md).

## The critical data flows

**A job is claimed:** browser draft and idempotency key → public `claim_job` invoker → latest private implementation → current actor, locks, contract/qualification/capacity/time-conflict checks → immutable claim/schedule/revenue snapshots, memberships and notifications → transaction commit → confirmed UI. An error cannot leave a partially successful multi-day booking. Kanban calls permitted lifecycle actions; dragging a card does not create a claim.

**A file is uploaded:** authenticated Edge request → bounded and validated bytes → version reserved under caller permissions → immutable quarantine bytes → actual scan → fresh current-permission check → clean exact version. A download checks current rights again; a saved notification or avatar ID is not a permanent access token. SQL metadata alone does not prove an actual object transfer or a clean scan.

**A private projection is read:** authenticated actor → current capability/MFA and resource rights → explicitly bounded result. A `public` wrapper is an API boundary, not proof of public visibility. An internal `security definer` implementation technically bypasses RLS, so it must retain its own actor/resource checks and precise grants. Administrative overviews do not implicitly grant access to private DMs, calendars or contracts.

## Before changing SQL

1. Find the definition, later replacements, triggers, RLS/grants and every API caller. An internal trigger or documented RPC without a browser import is not automatically dead code.
2. Create a **new additive migration** with the installed Supabase CLI. Do not rewrite existing SQL files, production history or accepted snapshots.
3. Comment new tables, functions, lock ordering, actor/MFA checks, `search_path`, versioning/idempotency and grants directly in the new SQL source. New internal helpers need explicit EXECUTE revokes; do not broadly expand wrapper/definer boundaries.
4. Check a fresh replay, actual RLS/concurrency and the affected Auth/API/browser flows. Updating an existing database and preserving actual Storage bytes require separate evidence. Use the existing isolated full verification command and document the stages actually reached.
5. Update the API reference only through its intended actual replay; also update this guide, feature documentation, plan and work log. Hosted migrations follow the existing operations and approval path.
