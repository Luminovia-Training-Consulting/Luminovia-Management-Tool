# Reading and safely extending SQL migrations

This guide inventories **36 SQL files: 27 immutable released main migrations and nine incoming M7/M8 extensions**. The nine pending files are reversioned with the installed CLI after the released prefix without changing their SQL bytes or dependency order. Accepted SQL forms part of local preview, update and recovery fingerprints, so even a comment changes source identity. File identity/order checks do not replace fresh or retained-data replay. New business changes use separate additive migrations and matching guide updates.

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

### 17. Source-linked course templates and teaching offers

Source version: `20261115155208` in [the immutable migration directory](../supabase/migrations). Its historical filename and bytes remain unchanged; public guidance uses the version identifier.

The building block and exact source revision remain separate from editable templates. Hashes, filenames and page references record provenance without shipping the original PDFs. `course_run_job_defaults` and `create_course_run_job` bind the current source revision, actual session IDs and idempotent financial inputs.

Test entry point: [course-building-blocks-db-tests.mjs](../scripts/course-building-blocks-db-tests.mjs).

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

Only new offers explicitly priced per position receive 1–20 positions. Legacy, client and course-originated offers retain their single-position meaning. `claim_job` locks the person and offer, checks available positions and reserves every session atomically. Lifecycle, cancellation, invoice review and client/revenue projections account for active positions while preserving history.

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

### 27. Customer-neutral catalogue labels and reusable templates

Source: [20261116032005_customer_neutral_course_catalogue.sql](../supabase/migrations/20261116032005_customer_neutral_course_catalogue.sql).

The catalogue namespace describes curriculum, independently of the customer organisation selected for each actual run. The forward transaction replaces the original single-provider CHECK with a trimmed namespace of 1–80 characters; provider/code uniqueness and the existing read/write permissions remain unchanged.

Exact original SHA-256 value digests guard changes to curated provider, description and notes fields. Default template titles/descriptions are replaced only when their source identifiers and all original teaching fields still match, they have no course run or topic links, they are not archived, and no authored-save audit exists. Edited, saved, used, archived and copied templates are retained. The generated seed DML inserts missing canonical identities and fills only an unset default-template link; it does not overwrite existing authored content.

All 22 canonical block identities and 24 exact source revisions remain intact. Original source filename/hash/page/date references, actual organisation memberships, run/session/job links and accepted fee/contract/revenue records are not rewritten. No original PDFs or local personal paths are published. [Course building blocks](COURSE_BUILDING_BLOCKS.md) explains the import and customer-independent workflow.

The constraint replacement and bounded data changes retain the hosted operator-review gate. Installation requires the existing reviewed maintenance/writer-stop and verified backup/recovery procedure; neither this guide, generated SQL nor a local test result applies the migration or approves production. Do not edit earlier migration sources or bypass the ordinary update classifier.

Test entry points: [upgrade/preservation rehearsal](../scripts/course-catalogue-preservation-db-tests.mjs), [building-block SQL groups](../scripts/course-building-blocks-db-tests.mjs) and [catalogue/reproducibility regressions](../scripts/runtime-course-catalogue.test.mjs). These fixtures distinguish fresh catalogue state from two independent customers sharing a template, edited/used templates and an accepted pre-upgrade agreement; actual full application/hosted outcomes remain separately recorded.

### 28. Versioned structured chat mentions

Source: [20261116080730_chat_structured_mentions.sql](../supabase/migrations/20261116080730_chat_structured_mentions.sql).

Adds message content versions, version-bound mention targets and actor/request retry records without removing the earlier message APIs. A mention is an explicit selection of at most 20 distinct current, active, role-eligible room members; text resembling `@name` is not authorization. Message send/edit and the selected mentions commit together. Edits use the expected content version, the existing sender/edit-window rules and a payload-bound retry identity. Profile/role, room and member locks protect the membership checks against concurrent revocation. Reads and history retain current room access; first explicit mentions can renew a notice or override a room mute, while the global notification category and attention rules still apply.

Private version/request tables have RLS and no browser table grants; internal trigger/helpers are not public APIs. See [CHAT](CHAT.md) for message/history contracts and [NOTIFICATIONS](NOTIFICATIONS.md) for notice filtering.

Test entry point: [chat-mentions-db-tests.mjs](../scripts/chat-mentions-db-tests.mjs).

### 29. Server-paged files and private personal organisation

Source: [20261116080732_file_discovery_personal_organisation.sql](../supabase/migrations/20261116080732_file_discovery_personal_organisation.sql).

`document_discovery` applies literal filename search, owner/kind/job filters and own tag/folder filters before paging by descending `(created_at,id)`. Each page contains at most 100 rows and rechecks `can_access_document`; paging does not raise the Data API row cap or provide an enduring download grant. The separate `document_organisation` rows belong to an account/document pair, with their own RLS and no direct authenticated table grants. Tags and virtual folders are personal annotations, not shared document metadata or Storage paths.

Saving annotations locks the active profile, then the document, then the account/document writer and annotation row. The expected version starts at 0 for an absent row; stale writes fail with `40001`. This serializes ordinary concurrent saves and document archiving/replacement while preserving the existing upload, quarantine, exact-version and authenticated byte-download checks. See [FILES](FILES.md).

Test entry point: [files-discovery-db-tests.mjs](../scripts/files-discovery-db-tests.mjs).

### 30. Bounded job discovery, summaries and own saved views

Source: [20261116080735_job_discovery_and_saved_views.sql](../supabase/migrations/20261116080735_job_discovery_and_saved_views.sql).

Adds server-side literal discovery, validated criteria/sorts, exact job resolution, scoped assignment titles and dashboard summaries. The discovery cursor binds its sort position to the normalized filter fingerprint; pages permit 1–100 offers and recheck the current lecturer or `jobs.manage` capability/MFA boundary. Commercial projections retain their existing net/gross permissions. Search, summaries and a selected job do not confirm claim eligibility or reserve any session.

Saved views contain only the current account's normalized criteria, with RLS, private table access, a 20-view bound, unique personal names and expected versions. Both save/remove enter as volatile mutations, lock the acting profile before a separate current role/permission check and then lock the target state; saves additionally serialize the account's view writers. An identical initial-create retry can return the same view, while changed/stale versions and foreign IDs fail. See [JOB_DISCOVERY](JOB_DISCOVERY.md); the original all-session `claim_job` transaction remains authoritative.

Test entry point: [job-discovery-db-tests.mjs](../scripts/job-discovery-db-tests.mjs).

### 31. Own in-app attention preferences

Source: [20261116080737_notification_attention_preferences.sql](../supabase/migrations/20261116080737_notification_attention_preferences.sql).

Adds a separate private daily quiet-period preference using explicit IANA time zones and local minute boundaries, including overnight/DST behavior. It leaves the existing four category switches independent. `notification_inbox` retains its prior arguments and adds the server-calculated `quiet_active` and, only while quiet, `attention_count`. Quiet hours change the bell's attention count, not the retained unread events or explicit read state. Binding claim/cancellation/contract notices remain counted; the announcement migration below adds currently readable important announcements.

Own preference writes lock the active profile, serialize first saves through an account-bound transaction lock and use the preference row/CAS version, initially 0 without a stored row. Forged actor fields, equal endpoints and invalid times/zones are rejected. Direct table access and anonymous helper/API execution remain closed. This migration supplies no SMTP, push or delivery scheduler. See [NOTIFICATIONS](NOTIFICATIONS.md).

Test entry point: [attention-db-tests.mjs](../scripts/attention-db-tests.mjs).

### 32. Immutable announcement drafts, publication and acknowledgements

Source: [20261116080739_portal_announcements.sql](../supabase/migrations/20261116080739_portal_announcements.sql).

Adds `announcements.manage` to the existing owner/admin/management roles and private, RLS-protected announcement, revision, publication, acknowledgement and retry records. Draft revisions and publication records are immutable. Saving a bilingual draft preserves the separately published text, role audience and finite display window. Active readers must satisfy the current publication, archive, audience and time checks; management uses the current capability and MFA rather than a client-supplied role.

Management locks the acting profile/roles, rechecks permission, then applies request-payload idempotency and the announcement row's expected version. Publication is explicit; future-start drafts require a later manual publication, not an assumed scheduler. Important published revisions create deduplicated inbox notices. Acknowledgements are own, current-revision operations with idempotent timestamps; archive/recover retains the publication and acknowledgement identity. The migration extends the notice destination/quiet-attention helpers and safe administrative action allowlist while preserving the earlier families. See [ANNOUNCEMENTS](ANNOUNCEMENTS.md) and [NOTIFICATIONS](NOTIFICATIONS.md).

Test entry point: [announcements-db-tests.mjs](../scripts/announcements-db-tests.mjs).

### 33. Purpose-bound administrative job and course pickers

Source: [20261116080741_scoped_administrative_job_pickers.sql](../supabase/migrations/20261116080741_scoped_administrative_job_pickers.sql).

`job_picker` returns bounded metadata for two closed purposes: `job_attachment` requires current `jobs.manage`/MFA; `participant_course` requires current `courses.manage`/MFA. These match the existing file-registration and channel-management actions. The course projection contains template/organisation/schedule metadata and one representative real job binding per course run, without exposing that job's hidden commercial text. The helper does not silently apply lecturer marketplace, contract or claim-qualification gates to administrative choices.

Literal search and cursor fingerprints bind purpose/search to stable job/run ordering; each page permits 1–100 choices and rechecks current rights. The optional exact selected item is resolved under the same purpose independently of the visible page. Public wrappers retain invoker security; the internal candidate helper explicitly revokes browser execution. No new reservation, file grant or chat membership is created by selecting metadata. See [JOB_PICKERS](JOB_PICKERS.md).

Test entry point: [job-picker-db-tests.mjs](../scripts/job-picker-db-tests.mjs).

### 34. Published global-calendar management

Source: [20261116080743_global_calendar_publications.sql](../supabase/migrations/20261116080743_global_calendar_publications.sql).

Extends the existing global-event rows with versions, archive state and a private request ledger. The global read policy permits ordinary active accounts only explicitly published, nonarchived events; `courses.manage`/MFA permits management of drafts. The range API enforces finite intervals of at most 93 days, bounded literal search, stable cursors and pages of 1–100 events. Descriptions remain authored plain text; optional HTTPS links and instants/IANA zones are validated before saving or publishing.

The volatile mutation locks the actor profile before its current permission check, then uses an actor/request transaction lock, exact payload retry binding and event-row/CAS locking. Editing returns an existing event to draft; publish/unpublish/archive/recover are explicit versioned actions. The audit allowlist adds five reduced calendar actions without returning descriptions or links. None of these grants reveal another person's private calendar. See [CALENDAR](CALENDAR.md).

Test entry point: [calendar-global-db-tests.mjs](../scripts/calendar-global-db-tests.mjs).

### 35. Explicit qualification evidence and attestation history

Source: [20261116080746_qualification_evidence_and_attestation_history.sql](../supabase/migrations/20261116080746_qualification_evidence_and_attestation_history.sql).

Adds private RLS-protected topic state, evidence bindings, decision/history events and request records. A lecturer explicitly shares an own clean personal certificate version for a selected topic; the sharing grant identifies that exact version rather than whichever replacement is newest. Current `qualifications.verify`/MFA authorizes targeted review and download, replacing blanket foreign-certificate access. The existing separate `users.manage`/MFA CV exception and contract/finance scopes remain intact. Upload registration also stops another account's certificate upload. Existing manual `verify_lecturer_topic` delegates to the same attestation/history core.

Mutations lock the active actor profile before fresh role/permission checks, then serialize request and selected-topic/state/evidence locks with CAS. Exact retries return currently sanitized state, not old private metadata. Withdrawal, topic removal or file archiving ends the prior download grant; re-adding a topic does not restore it. History grants no historical byte access, and old verifications receive no invented retrospective events. The Edge gateway rechecks the narrow evidence binding around Storage retrieval. Evidence sharing/upload does not itself verify a qualification or change accepted claim snapshots. See [QUALIFICATIONS](QUALIFICATIONS.md) and [FILES](FILES.md).

Test entry point: [qualifications-db-tests.mjs](../scripts/qualifications-db-tests.mjs).

### 36. Role-aware prospective job discovery

Source: [20261116080748_role_aware_job_discovery.sql](../supabase/migrations/20261116080748_role_aware_job_discovery.sql).

Adds private quote/context helpers and replaces only the latest discovery candidate, item and page implementations. Role-priced offers derive the current lecturer's prospective amount and consent version from each offer's captured private policy. Actors without lecturer eligibility receive no alternative prospective quote. Legacy net-only offers retain their original amounts, and accepted claims/revenue are not rewritten. The internal helpers have explicit execution revokes and current active-actor/read checks.

Price bounds and sorting use those authorized amounts instead of the raw public zero sentinels. Unknown quotes remain null in items, fail money bounds and use only internal ordering sentinels. Detail and dashboard suggestions share the item projection. The cursor fingerprint additionally binds the actor's role/tier and current policy context, so an old monetary order cannot silently continue after authority changes. Paging remains bounded and claim eligibility/reservation remains the existing online transaction.

Test entry points: [role-aware-job-discovery-db-tests.mjs](../scripts/role-aware-job-discovery-db-tests.mjs), [role-aware-job-discovery-api-check.mjs](../scripts/role-aware-job-discovery-api-check.mjs) and [job-discovery-db-tests.mjs](../scripts/job-discovery-db-tests.mjs). Their presence is not a claim that the final integrated native checks have passed. See [JOB_DISCOVERY](JOB_DISCOVERY.md) and [DELEGATED_ROLES_PRICING](DELEGATED_ROLES_PRICING.md).

## The critical data flows

**A job is claimed:** browser draft and idempotency key → public `claim_job` invoker → latest private implementation → current actor, locks, contract/qualification/capacity/time-conflict checks → immutable claim/schedule/revenue snapshots, memberships and notifications → transaction commit → confirmed UI. An error cannot leave a partially successful multi-day booking. Kanban calls permitted lifecycle actions; dragging a card does not create a claim.

**A file is uploaded:** authenticated Edge request → bounded and validated bytes → version reserved under caller permissions → immutable quarantine bytes → actual scan → fresh current-permission check → clean exact version. A download checks current rights again; a saved notification or avatar ID is not a permanent access token. SQL metadata alone does not prove an actual object transfer or a clean scan.

**A private projection is read:** authenticated actor → current capability/MFA and resource rights → explicitly bounded result. A `public` wrapper is an API boundary, not proof of public visibility. An internal `security definer` implementation technically bypasses RLS, so it must retain its own actor/resource checks and precise grants. Administrative overviews do not implicitly grant access to private DMs, calendars or contracts.

## Before changing SQL

1. Find the definition, later replacements, triggers, RLS/grants and every API caller. An internal trigger or documented RPC without a browser import is not automatically dead code.
2. Create a **new additive migration** with the installed Supabase CLI. Include an explicit outer BEGIN/COMMIT envelope for exact-source atomic history replay. Do not rewrite released SQL files, production history or accepted snapshots.
3. Comment new tables, functions, lock ordering, actor/MFA checks, `search_path`, versioning/idempotency and grants directly in the new SQL source. New internal helpers need explicit EXECUTE revokes; do not broadly expand wrapper/definer boundaries.
4. Check a fresh replay, actual RLS/concurrency and the affected Auth/API/browser flows. Updating an existing database and preserving actual Storage bytes require separate evidence. Use the existing isolated full verification command and document the stages actually reached.
5. Update the API reference only through its intended actual replay; also update this guide, feature documentation, plan and work log. Hosted migrations follow the existing operations and approval path.
