# Reading and safely extending SQL migrations

## PR25 integration on accepted main

PR24 is accepted as main `99add7de8598bf415977c7cae79f1c5f6993626d` with 68 published SQL files. The unpublished enquiry source is resequenced with the installed CLI as `20261116143242_website_enquiry_intake.sql`, after that complete prefix. All 68 released files remain byte-identical. This produces 69 sources; source presence does not claim hosted installation.

The enquiry helper is discovered by main's existing owner-only notification resolver. The obsolete resolver rename/wrapper and authenticated EXECUTE grant are removed from the unpublished source, preserving the accepted resolver's identity, fallback branches and restricted ACL. Current SQL tests exercise the actual inbox projection and denied direct helper calls. HTTP fixtures must validate either the canonical disposable backend or the exact ownership-checked native candidate, including its private TLS trust; ordinary services remain excluded.

This guide inventories **68 SQL files: 62 unchanged published Main17 migrations and six pending PR24 operational additions**. Actual accepted main is `4cc20874edc1f865b71106b7bb1299e16fec5aad`. All 62 published bodies remain byte-identical, and the six pending files retain their CLI-created dependency order. Their post-wait authority corrections and the two notification files’ owner-only resolver boundary remain recorded in [WORKLOG](WORKLOG.md). Earlier 36-, 42- and candidate-prefix counts describe their named pre-merge checkpoints.

Application, SQL, E2E, database helper, generated API and package/lock bytes remain identical to the complete local `2c850fc488165e37887807a74e92414e4fa0a25e` pass, which replayed all 68 migrations and real APIs before 150 application browser and 4 built-PWA cases and checked cleanup. Accepted Main36 runner routing and Main17’s 30-minute browser aggregate are newer executor evidence; no repeated complete local run is claimed for that delta. Accidental accounting integration remains excluded through the history-preserving signed revert.

Published SQL participates in preview, update and recovery fingerprints and must never be rewritten. New business changes require separate additive migrations and matching guide updates. Source identity does not establish what a hosted database has applied. Final current-head full system, browser, actual native and all 15 required CI checks remain mandatory before PR24 delivery. Ordinary `./portal test` stays complete; one split CI phase is not a full pass. Manual-only publication remains unchanged.

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

Read `private.job_offers`, `private.role_net` and `private.role_quote_version` together with the later `private.claim_job` and claim/revenue triggers in this file. A numeric zero in a role-dependent job's public columns is a storage sentinel, whereas `null` in the authorised JSON quote means no prospective monetary value is available. An authorised numeric zero can still be a real quote. The nullable `Job` DTO and list/detail rendering preserve those distinctions; they do not calculate the quote from public columns. Frontend consent captures the exact displayed values and quoted version before the server checks that version under the actor lock. An accepted claim retains its base terms version and immutable amounts.

The later `private.job_lifecycle` definition also returns an authorised `max_net_budget`; an explicit protected `null` must not be replaced by the viewer's personal quote times capacity. These policy, claim and budget functions remain owned by migration 25. Migration 30 introduces the discovery interfaces, and migration 36 supplies their current private quote projection and cursor replacements without changing this released source. [Current source map](DELEGATED_ROLES_PRICING.md#current-source-ownership) explains the connected SQL/DTO/UI ownership and shared quote, null and consent boundaries.

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

`private.job_discovery_quote` reads current actor/job access and returns the applicable amount, total and role-specific terms version. `private.job_discovery_quote_context` supplies the actor/tier and global policy-version context for the cursor fingerprint. Both internal helpers explicitly revoke execution from PUBLIC, anon, authenticated and service-role callers. The existing public invoker signatures and saved-view operations from migration 30 remain in place; its `job_detail` and `job_dashboard` implementations reuse the replaced `private.job_discovery_item` rather than independently reconstructing a price.

Price bounds and sorting use those authorized amounts instead of the raw public zero sentinels. Unknown quotes remain null in items, fail money bounds even when the minimum is zero and sort after known amounts in either monetary direction using only internal ordering sentinels. A genuine authorised numeric zero remains a valid numeric quote. No gross price, policy percentage or alternative tier is added to the response. Original-currency and fee-unit requirements remain unchanged.

The cursor fingerprint binds canonical filters to the current actor, lecturer eligibility/tier marker and global policy version. A cursor from a different such context is rejected; other permission changes are enforced by current read checks rather than by hashing every permission. A newer global policy does not rewrite an existing offer's captured quote. Observed role changes also reset the client's infinite-page query key; unobserved changes remain subject to server cursor validation. The TypeScript DTO preserves null without coercion, cards/detail render restricted prices honestly, and the detail checkbox captures all displayed quote fields before submitting the quoted terms version to the original claim transaction. Management `max_net_budget` remains the separate migration-25 projection. Paging remains bounded and provides neither a frozen cross-request snapshot nor confirmed eligibility/reservation.

Test entry points: [role-aware-job-discovery-db-tests.mjs](../scripts/role-aware-job-discovery-db-tests.mjs), [role-aware-job-discovery-api-check.mjs](../scripts/role-aware-job-discovery-api-check.mjs) and [job-discovery-db-tests.mjs](../scripts/job-discovery-db-tests.mjs). Their presence is not a claim that the final integrated native checks have passed. See [JOB_DISCOVERY](JOB_DISCOVERY.md) and [DELEGATED_ROLES_PRICING](DELEGATED_ROLES_PRICING.md).

### 37. Private email preferences and committed-event outbox

Source: [20261116091007_notification_email_outbox.sql](../supabase/migrations/20261116091007_notification_email_outbox.sql).

Own email/quiet-hour/zone preferences are versioned and disabled by default. Notification occurrences enter a private deduplicated outbox; service-only lease/prepare/finish routines separate current eligibility from provider submission. Accepted, suppressed, failed and uncertain outcomes do not imply inbox deletion or an automatic retry after ambiguous SMTP acceptance. Credentials do not belong in these tables.

Test entry point: [notification-delivery-db-tests.mjs](../scripts/notification-delivery-db-tests.mjs).

### 38. Private dashboard layout and teaching-day preparation

Source: [20261116091009_personal_dashboard_and_teaching_day.sql](../supabase/migrations/20261116091009_personal_dashboard_and_teaching_day.sql).

Own allowed widget order/visibility uses CAS. Teaching-day data derives current confirmed, unreleased allocations in the profile zone; an own claim-bound preparation checklist is separate from shared customer progress. Neither preferences nor admin status expose another person's private checklist or files.

Test entry point: [dashboard-personal-db-tests.mjs](../scripts/dashboard-personal-db-tests.mjs).

### 39. Bounded own calendar-file projection

Source: [20261116091010_calendar_file_export.sql](../supabase/migrations/20261116091010_calendar_file_export.sql).

The security-invoker export reads only current-owner confirmed/unreleased allocations and explicitly included own private events. It accepts finite windows and fails beyond 500 events. IANA identity/instants remain explicit; the browser produces ICS from fresh checked data. No calendar copy table is added.

Test entry point: [calendar-export-db-tests.mjs](../scripts/calendar-export-db-tests.mjs).

### 40. Explicit staff-directory contact visibility

Source: [20261116091011_staff_contact_visibility.sql](../supabase/migrations/20261116091011_staff_contact_visibility.sql).

Own email/phone consent defaults off and uses current identity/CAS. The separate contact projection admits active staff to opted-in current Auth email/profile phone; clients/participants and administrative consent overrides are excluded. Existing people/profile projections stay narrow.

Test entry point: [staff-contact-db-tests.mjs](../scripts/staff-contact-db-tests.mjs).

### 41. Waitlist interest and atomic explicit substitution

Source: [20261116091012_assignment_waitlist_and_substitution.sql](../supabase/migrations/20261116091012_assignment_waitlist_and_substitution.sql).

Private waitlist rows record interest without reserving capacity. Substitution proposals fix the original claim, target, quote/hash, expiry and retry identity. Explicit target acceptance serializes both lecturer schedules, rechecks current eligibility and atomically releases/recreates the complete block while retaining original accepted history.

Test entry point: [assignment-handover-db-tests.mjs](../scripts/assignment-handover-db-tests.mjs).

### 42. Device opt-in and committed Web Push delivery

Source: [20261116091013_web_push_notifications.sql](../supabase/migrations/20261116091013_web_push_notifications.sql).

A private configuration singleton, owner-bound provider subscriptions and occurrence/device outbox separate browser consent from external delivery. Endpoint/encryption validation, active-device expiry, service-only worker leases and recipient eligibility fail closed. VAPID private material is operating configuration; source does not establish actual device permission or delivery.

Test entry point: [web-push-db-tests.mjs](../scripts/web-push-db-tests.mjs).

### 43. Shared course and participant learning workspace

Source: [20261116091015_course_learning_workspace.sql](../supabase/migrations/20261116091015_course_learning_workspace.sql).

Adds scoped preparation/contact settings, exact material/report resources and receipts, audited attendance, staff/learner Q&A, private notebooks, identity-protected feedback aggregates, immutable quiz versions/eligible attempts and frozen completion facts. The workspace derives current manager/assignment/enrolment/client scope. Repeat booking creates a fresh future request; later brief integration copies requirements without private learner data.

Test entry point: [course-workspace-db-tests.mjs](../scripts/course-workspace-db-tests.mjs).

### 44. Private favourites, versioned tasks and reusable workflows

Source: [20261116091016_personal_workbench_and_tasks.sql](../supabase/migrations/20261116091016_personal_workbench_and_tasks.sql).

Private/operations tasks retain CAS history, exact creation retries and bounded all-or-none bulk changes. Templates/applications bind a selected revision and retry key. Message-derived tasks require continuing current source-room access; neither manager access nor a copied description bypasses private scope. Favourites/recommendations re-resolve current resource/eligibility rights.

Test entry point: [workbench-db-tests.mjs](../scripts/workbench-db-tests.mjs).

### 45. Audited teaching time, printable finance facts and Control Center

Source: [20261116091017_timesheets_finance_and_control_center.sql](../supabase/migrations/20261116091017_timesheets_finance_and_control_center.sql).

Timesheets bind actual assignment sessions, bounded intervals/breaks, nonoverlap and audited review/retry state. Accepted compensation remains unchanged. Current capability/MFA gates own/all printable stable-hash facts, original-currency forecasts and date-bounded operational exceptions; customer gross requires its separate capability. No accounting, bank, payroll or legal-signature integration is implied.

Test entry point: [timesheets-finance-db-tests.mjs](../scripts/timesheets-finance-db-tests.mjs).

### 46. Revocable private calendar capabilities

Source: [20261116091018_private_calendar_subscriptions.sql](../supabase/migrations/20261116091018_private_calendar_subscriptions.sql).

Own creation/rotation/revocation binds CAS/retry keys and stores only a token hash plus explicit private-event inclusion and expiry. Service-only snapshot/recheck routines validate current active owner and the capability before/after rendering. The exact GET calendar-feed endpoint is the reviewed JWT exception; all other function authentication remains unchanged.

Test entry point: [calendar-subscriptions-db-tests.mjs](../scripts/calendar-subscriptions-db-tests.mjs).

### 47. Current-permission unified search

Source: [20261116091019_permission_aware_unified_search.sql](../supabase/migrations/20261116091019_permission_aware_unified_search.sql).

Adds a checked paginated union across the actual authorized modules, with kind/title/UUID cursor and bounded input/page size. Selected wiki revisions, current chat/task access and commercial capability checks prevent a search index from becoming a new read grant. No global materialized search table or all-pages browser download is added.

Test entry point: [unified-search-db-tests.mjs](../scripts/unified-search-db-tests.mjs).

### 48. Cross-feature notification targets and delivery rechecks

Source: [20261116091020_smart_operations_notifications.sql](../supabase/migrations/20261116091020_smart_operations_notifications.sql).

Replaces earlier target/category/prepare/reminder/attention definitions with the combined course, task, waitlist/substitution, timesheet and existing notification model. Committed changes emit scoped generic notifications; current recipient, channel, quiet-window and resource rights are checked again at delivery. Read this latest definition after the initial inbox/email/Push migrations.

Test entry point: [smart-notifications-db-tests.mjs](../scripts/smart-notifications-db-tests.mjs).

### 49. Direct current-authorisation task lookup

Source: [20261116091022_workbench_direct_task_lookup.sql](../supabase/migrations/20261116091022_workbench_direct_task_lookup.sql).

Resolves an explicit task deep link through the same current task/source-message helper used by paged tasks. Finding a private task by UUID never widens its visibility and avoids fetching every history page in the browser. No new table is created.

Test entry point: [workbench-db-tests.mjs](../scripts/workbench-db-tests.mjs).

### 50. Versioned customer teaching briefs and immutable request snapshots

Source: [20261116091023_client_request_brief_and_history.sql](../supabase/migrations/20261116091023_client_request_brief_and_history.sql).

Adds explicit whole teaching units of 45/60 minutes, required-document descriptions and exact scanned material/report attachments without changing original prices. Required minutes must fit planned sessions. Atomic creation retries compare the immutable first brief; edits share the publication row lock and CAS boundary before publication. Current organisation history uses stable pages, while repeat booking copies requirements/time but no attachments or learner records.

Test entry point: [client-request-brief-db-tests.mjs](../scripts/client-request-brief-db-tests.mjs).

### 51. Own qualification passport facts

Source: [20261116091024_own_qualification_passport.sql](../supabase/migrations/20261116091024_own_qualification_passport.sql).

The invoker API accepts locale and a bounded current snapshot instant, derives its subject from the actual active lecturer and returns explicit facts plus SHA-256. Verified/unverified/expired eligibility, current evidence availability and historical attestation provenance remain separate. It neither exports certificate bytes/private paths nor creates verification decisions. The protected PDF gateway repeats the same facts/access read before releasing generated bytes.

Test entry points: [qualification-passport-db-tests.mjs](../scripts/qualification-passport-db-tests.mjs), [qualification-passport-api-check.mjs](../scripts/qualification-passport-api-check.mjs).

### 52. Recipient-role substitution pricing and unknown forecast costs

Source: [20261116091025_role_aware_handover_and_forecast.sql](../supabase/migrations/20261116091025_role_aware_handover_and_forecast.sql).

Captures the recipient's own private role-pricing context and net quote. Acceptance rechecks that context under the existing locks, then independently verifies the inserted claim and revenue snapshot. Original accepted fees and customer gross remain immutable. Other lecturers and ordinary management cannot inspect the recipient's fee/hash. Role-dependent prospective costs remain unknown (`null`) with an explicit count rather than presenting the raw privacy sentinel as a zero cost.

Test entry points: [role-aware-handover-db-tests.mjs](../scripts/role-aware-handover-db-tests.mjs), [role-aware-handover-api-check.mjs](../scripts/role-aware-handover-api-check.mjs).

### 53. Withdrawal authority after concurrent role edits

Source: [20261116091026_substitution_withdrawal_permission_recheck.sql](../supabase/migrations/20261116091026_substitution_withdrawal_permission_recheck.sql).

Rechecks current manager withdrawal capability after the profile, schedule, job, claim and offer locks. A request queued behind a role edit cannot use its former permission. Immutable proposer/source ownership remains a separate active-account right. No released substitution implementation is edited.

Test entry point: [role-aware-handover-db-tests.mjs](../scripts/role-aware-handover-db-tests.mjs), including an observed blocked-session negative-control regression.

### 54. Current course context in the own Teaching Day

Source: [20261116091027_teaching_day_course_workspace.sql](../supabase/migrations/20261116091027_teaching_day_course_workspace.sql).

Extends the existing own-day projection with the current nonarchived course, its explicitly selected same-organisation shared contact, shared preparation totals and bounded exact authorised clean resource versions. The active lecturer must still own a confirmed, unreleased assignment session. Internal contacts/notes, another organisation's contact and private document versions remain excluded. Shared progress stays distinct from the lecturer's three private checklist items.

Test entry points: [teaching-day-course-db-tests.mjs](../scripts/teaching-day-course-db-tests.mjs), [dashboard-personal-api-check.mjs](../scripts/dashboard-personal-api-check.mjs).

### 55. Current resulting assignment on accepted retries

Source: [20261116091029_substitution_receipt_current_status.sql](../supabase/migrations/20261116091029_substitution_receipt_current_status.sql).

An exact accepted-offer retry reads the resulting claim's current owner, job and status under the existing locks. A subsequently cancelled assignment returns `cancelled`, without new reservations, notifications or audit events. Exact quote hash and explicit terms consent remain mandatory. Historical accepted-offer state alone no longer fabricates a current confirmation.

Test entry points: [role-aware-handover-db-tests.mjs](../scripts/role-aware-handover-db-tests.mjs), [role-aware-handover-api-check.mjs](../scripts/role-aware-handover-api-check.mjs).

### 56. Current lecturer authority on accepted retries

Source: [20261116091030_substitution_retry_current_lecturer_authority.sql](../supabase/migrations/20261116091030_substitution_retry_current_lecturer_authority.sql).

After the existing profile/workflow locks and exact consent checks, accepted retries require current lecturer authority. An active account that lost its teaching role receives `not_eligible`; a suspended account is denied. Tests observe both role and activation mutations holding the profile lock, then verify the waiting request uses the newly committed authority without changing business history or creating notices.

Test entry points: [role-aware-handover-db-tests.mjs](../scripts/role-aware-handover-db-tests.mjs), [role-aware-handover-api-check.mjs](../scripts/role-aware-handover-api-check.mjs). The vulnerable52910-only negative control fails the new role-revocation regression.

### 57. Explicit PL/pgSQL initializer types and quiz index

Source: [20261116091031_smart_operations_explicit_plpgsql_types.sql](../supabase/migrations/20261116091031_smart_operations_explicit_plpgsql_types.sql).

The strict complete-CI lint gate found implicit text-to-UUID-array/JSONB initializer conversions and a shadowed quiz loop index/unused local row. This forward migration explicitly types the three empty values, removes the unused declaration and gives the automatic loop index its own name. Independent exact-definition comparison confirms every other business, permission, lock, retry and grant remains unchanged. All three replacement routines pass actual `plpgsql_check` with ordinary/extra warnings enabled; focused course/workbench/brief SQL flows pass. The complete CI gate is retained.

Test entry points: [course-workspace-db-tests.mjs](../scripts/course-workspace-db-tests.mjs), [workbench-db-tests.mjs](../scripts/workbench-db-tests.mjs), [client-request-brief-db-tests.mjs](../scripts/client-request-brief-db-tests.mjs).

### 58. Effective accepted amendments and active forecast months

Source: [20261116091032_amendment_aware_finance_forecast.sql](../supabase/migrations/20261116091032_amendment_aware_finance_forecast.sql).

An internal, ungranted adapter resolves the optional Formal Amendments module's actual `effective_assignment(uuid)` at read time. Current accepted lecturer cost and margin use that effective net; only unreleased allocations choose the month. Original claims and customer-gross ledger rows remain immutable. Valid accepted zero fees are supported; missing, negative and nonfinite snapshots fail. The original-currency, nullable prospective-price and current finance/MFA boundaries stay effective.

Test entry point: [amendment-forecast-db-tests.mjs](../scripts/amendment-forecast-db-tests.mjs). Default replay verifies the current source; explicit pinned local amendment fixtures exercise real consent/application in both installation orders. The executed21 focused groups and14 existing finance groups are separate from full native/Auth/browser acceptance. [Contract and evidence](AMENDMENT_FORECAST_BRIDGE.md).

### 59. Dedicated private document isolation at course boundaries

Source: [20261116091034_course_document_dedicated_registry_isolation.sql](../supabase/migrations/20261116091034_course_document_dedicated_registry_isolation.sql).

Optional Support, enquiry and customer-invoice registries are checked dynamically on course selection, sharing, current resource reads and exact download facts. An unconditional course-resource trigger and shared document/version locks serialize cross-domain registration. Removed share history still prevents reusing the same document for a private enquiry. Normal authorised exact-version teaching resources retain their course audience access. Existing routine identities, unrelated action branches and private execution grants are preserved.

Test entry point: [course-document-privacy-db-tests.mjs](../scripts/course-document-privacy-db-tests.mjs). Its self-contained, hash-bound contract metadata and exact enquiry RPC excerpt exercise18 groups in both module orders, including observed lock races. These fixtures do not claim full foreign-module or actual Edge/Auth acceptance. [Boundary and evidence](COURSE_DOCUMENT_PRIVACY.md).

### 60. Current waitlist authority after a profile-lock wait

Source: [20261116091534_waitlist_current_authority_after_profile_lock.sql](../supabase/migrations/20261116091534_waitlist_current_authority_after_profile_lock.sql).

Replaces only the existing private waitlist mutation implementation, preserving its public API and grants. Immediately after the existing profile `FOR SHARE` lock, it rechecks current account activation and, for joining, current lecturer authority. A request that waited behind a committed suspension may neither join nor leave using the earlier authority result; the waitlist and corresponding notice remain unchanged. An active former lecturer may still withdraw their own existing interest. No assignment, capacity reservation or accepted commercial snapshot is changed.

Test entry point: [waitlist-authority-db-tests.mjs](../scripts/waitlist-authority-db-tests.mjs). Four deterministic real PostgreSQL cases observe the profile-lock wait and verify suspended join/leave denial, downgraded-role join denial and permitted active-former-lecturer withdrawal. The vulnerable original routine fails the suspension regression before this correction; all four cases pass with the new migration. These focused results do not replace current combined native/Auth/browser acceptance. The preceding 59 SQL files remain byte-identical.

### 61. Metadata-private waitlist withdrawal and retained interest

Source: [20261116100136_waitlist_private_withdrawal_receipts.sql](../supabase/migrations/20261116100136_waitlist_private_withdrawal_receipts.sql).

An idempotent leave request is own-state cleanup, not a foreign job lookup. After the current active-account/profile-lock checks, a caller without their own interest receives the same empty-title receipt for guessed private or missing job IDs before any foreign job lookup or row lock. Null job IDs remain denied. All successful leave receipts omit the title, including when removing a genuine own row, and preserve the permitted withdrawal by an active former lecturer.

Stored own interest does not grant access to later private job edits. Exact and own-list projections redact draft/archived titles unless the caller currently has ordinary job-read authority. The existing reduced published/filled marketplace projection remains intact. The UI labels hidden interest generically, omits its job-detail link and retains its own leave action; no private title or job-existence oracle is introduced by withdrawal. The preceding 60 migration files and public API/grant identities remain unchanged.

Test entry point: [waitlist-authority-db-tests.mjs](../scripts/waitlist-authority-db-tests.mjs). All eight focused authority/privacy PostgreSQL groups pass on the 61-source fixture, including the existing observed profile-lock races, guessed-ID withdrawal, retained-interest private-title changes and own-notice cleanup. Restoring the vulnerable 60-source leave implementation makes the new metadata regression fail. These bounded results are separate from full 61-source native/Auth/browser acceptance; exact broader outcomes belong in [QA_RESULTS](QA_RESULTS.md) and [WORKLOG](WORKLOG.md).

### 62. Explicit safe-update targets for service-only Push configuration

Source: [20261116101427_web_push_safe_update_targets.sql](../supabase/migrations/20261116101427_web_push_safe_update_targets.sql).

Preserves the existing private `configure_web_push` signature, public invoker wrapper, service-only execution grants and public-key validation. A changed VAPID public key invalidates only currently active subscriptions with an explicit `WHERE active` predicate. The configuration write targets its existing singleton with `WHERE singleton=true`. Inactive device history is retained; the database's safe-update protection remains enabled rather than being disabled to permit unbounded updates.

The preceding 61 SQL files remain unchanged, and no API or browser privilege is added. All six focused [safe-update PostgreSQL groups](../scripts/web-push-safeupdate-db-tests.mjs) passed with the actual installed safe-update module loaded and enabled in the RPC backend. They cover initial/same-key configuration, active-only rotation with unchanged inactive history, disable/re-enable behavior, validation and service-only grants. Restoring the original routine reproduces `21000` under the same test. Existing [Push PostgreSQL checks](../scripts/web-push-db-tests.mjs) and [actual Auth/PostgREST acceptance](../scripts/web-push-api-check.mjs) exercise configuration and device behavior. Exact safe-update negative-control and corrected-source results belong in [QA_RESULTS](QA_RESULTS.md) and [WORKLOG](WORKLOG.md); a focused source/SQL pass does not establish the full 62-source application/native gate or external Push delivery.

### 63. Derived course readiness and scoped preparation

Source: [20261116121554_course_readiness.sql](../supabase/migrations/20261116121554_course_readiness.sql).

Private settings/tasks/instruction receipts complement live assignment, agreement, qualification, material, contact and schedule checks. No percentage setter exists. Reads require current course management/MFA or assignment ownership; historical or published visibility alone does not grant preparation access. Writers lock the run before the preparation advisory lock, and compare reviewed versions. A thin wrapper reuses current standalone job creation and fills its newly created run's mode/venue; it never rewrites existing authored runs.

Tests: [readiness-db-tests.mjs](../scripts/readiness-db-tests.mjs), [readiness-api-check.mjs](../scripts/readiness-api-check.mjs).

### 64. Private support tickets and dedicated attachments

Source: [20261116121556_internal_support_desk.sql](../supabase/migrations/20261116121556_internal_support_desk.sql).

Own ticket history and explicit MFA support authority replace an administrator-wide shortcut. Replies, internal notes, transitions, version checks and retry receipts stay private; internal notes/files are withheld from requesters. Clean single-version evidence becomes dedicated/frozen and the ticket ACL takes precedence over ordinary personal-document ownership, including after role revocation.

Tests: [support-db-tests.mjs](../scripts/support-db-tests.mjs), [support-api-check.mjs](../scripts/support-api-check.mjs).

The support migration also rejects existing/removed optional course-resource references and guards the reverse registry insertion with the same document lock. The automatically discovered [support/course contract tests](../scripts/support-course-registry-db-tests.mjs) distinguish synthetic optional-schema contracts from the strict manual actual-module gate. [Chronology and evidence](SUPPORT_COURSE_RESOURCE_REGRESSION.md).

### 65. Whole-block replacement without premature release

Source: [20261116121558_replacement_marketplace.sql](../supabase/migrations/20261116121558_replacement_marketplace.sql).

Open/selected emergency searches keep the original confirmed allocation. Sorted profile/lecturer locks precede job/claim/offer locks. The existing current claim implementation executes inside a subtransaction; every failed handover restores the original, while success retains old financial/schedule history and transfers current calendar/chat/file authority. Optional role-price helpers are discovered by exact trusted signatures and missing quotes fail closed. Started/invoiced/partial-work orchestration and ordered notifications remain explicit limitations.

Tests: [replacements-db-tests.mjs](../scripts/replacements-db-tests.mjs), [replacements-api-check.mjs](../scripts/replacements-api-check.mjs).

### 66. Immutable lecturer delivery evidence

Source: [20261116121600_attendance_delivery.sql](../supabase/migrations/20261116121600_attendance_delivery.sql).

Assignment sessions own drafts, immutable submitted revisions and independent review/customer events. Version/request locks protect concurrent changes. Customer projections omit draft/private notes/invoice IDs; existing accepted fees and invoices never change when evidence is corrected. The feature records freelance teaching delivery and does not introduce payroll or clock-in processing.

Tests: [delivery-db-tests.mjs](../scripts/delivery-db-tests.mjs), [delivery-api-check.mjs](../scripts/delivery-api-check.mjs).

### 67. Current-authority operational inbox targets

Source: [20261116121603_operations_notification_integration.sql](../supabase/migrations/20261116121603_operations_notification_integration.sql).

Preserves the prior resolver and composes readiness/support/delivery/replacement destinations under current access. Assigned preparation reminders respect preferences and actual task changes. Removed memberships, cancelled allocations and revoked capabilities cannot turn an old notification into a private-resource link. No mail service or public cache is added.

Strict non-trigger body diagnostics are additionally checked by [operations-lint-db-tests.mjs](../scripts/operations-lint-db-tests.mjs); canonical SQL lint/advisor/trigger and actual Auth/browser checks remain mandatory. [The extension ledger](OPERATIONS_EXTENSION_STATUS.md) distinguishes executed focused checks from full acceptance and release status.

### 68. Optional forward notification and handover composition

Source: [20261116121605_operational_module_notification_handover_integration.sql](../supabase/migrations/20261116121605_operational_module_notification_handover_integration.sql).

Replaces the current inbox target in place and retains an owner-only trusted core/smart fallback. Readiness, delivery, support and marketplace targets retain their own current resource checks; exact optional enquiry/amendment helpers fail closed when absent. Where directed substitutions are installed, an accepted transition atomically closes competing open marketplace offers, with idempotent historical repair. No email/push category is activated. Later modules that replace this resolver must preserve its composition in their own newer migration.

Tests: automatically discovered [operational-forward-db-tests.mjs](../scripts/operational-forward-db-tests.mjs); strict optional [operational-pr17-integration.mjs](../scripts/operational-pr17-integration.mjs). [Integration, chronology and actual evidence](OPERATIONAL_FORWARD_INTEGRATION.md).

## The critical data flows

**A job is claimed:** browser draft and idempotency key → public `claim_job` invoker → latest private implementation → current actor, locks, contract/qualification/capacity/time-conflict checks → immutable claim/schedule/revenue snapshots, memberships and notifications → transaction commit → confirmed UI. An error cannot leave a partially successful multi-day booking. Kanban calls permitted lifecycle actions; dragging a card does not create a claim.

**A file is uploaded:** authenticated Edge request → bounded and validated bytes → version reserved under caller permissions → immutable quarantine bytes → actual scan → fresh current-permission check → clean exact version. A download checks current rights again; a saved notification or avatar ID is not a permanent access token. SQL metadata alone does not prove an actual object transfer or a clean scan.

**A private projection is read:** authenticated actor → current capability/MFA and resource rights → explicitly bounded result. A `public` wrapper is an API boundary, not proof of public visibility. An internal `security definer` implementation technically bypasses RLS, so it must retain its own actor/resource checks and precise grants. Administrative overviews do not implicitly grant access to private DMs, calendars or contracts.

**A substitution is accepted:** targeted quote/hash and explicit acceptance → current actor/resource checks → stable profile/scheduling/job/claim lock order → renewed qualification/contract/conflict/invoice checks → complete old block release plus new immutable claim/allocation → commit. The waitlist does not allocate or bypass this protocol.

**A brief is revised or repeated:** current organisation scope → request publication row lock → expected brief version → whole teaching-time and exact scanned-version validation → append immutable snapshot → commit. A creation retry compares the immutable first brief; later revisions remain intact. Repetition requests new future dates and never copies learner records or document consent.

**A protected printable document is downloaded:** caller JWT/current Auth → reviewed SQL facts/exact share → private Storage bytes or bounded deterministic PDF rendering → SHA-256 and repeat current Auth/permission/fact checks → private/no-store response. Vendored fonts/runtime and the release archive are separate source assets, not a migration or a legal signature.

**An external notice is delivered:** committed business event → deduplicated occurrence/device outbox → service-only bounded lease → fresh current recipient/preference/quiet-window/resource preparation → provider submission → explicit outcome. An uncertain handoff does not become a fabricated success or an automatic duplicate retry. Worker installation/provider/device acceptance is separate from database replay.

<a id="unreleased-branch-version-reconciliation"></a>

## Historical pre-release source version reconciliation

At this historical pre-PR17-release checkpoint, the accepted main prefix contained 36 published SQL files. The table retains its status at that time; actual Main17 now publishes all 62 files described above. Nine shared branch sources are byte-identical to their published canonical files and are represented once. The 23 still-undelivered PR17 files were assigned new forward identifiers with the installed CLI, preserving every SQL byte, SHA-256 and relative dependency order. This is source-file reconciliation before release, not an installed-database history repair. No ordinary or hosted database was reset, backdated or given fabricated migration records. The separate 60th source adds the post-lock waitlist authority correction described above; it does not rewrite those 59 files.

| Earlier branch version | Current source version | Status                   |
| ---------------------- | ---------------------- | ------------------------ |
| 20261116021141         | 20261116091007         | Pending PR17 file        |
| 20261116021232         | 20261116091009         | Pending PR17 file        |
| 20261116022220         | 20261116091010         | Pending PR17 file        |
| 20261116022729         | 20261116091011         | Pending PR17 file        |
| 20261116022730         | 20261116080730         | Published canonical file |
| 20261116022731         | 20261116080732         | Published canonical file |
| 20261116022732         | 20261116080735         | Published canonical file |
| 20261116022733         | 20261116080737         | Published canonical file |
| 20261116022734         | 20261116080739         | Published canonical file |
| 20261116022735         | 20261116080741         | Published canonical file |
| 20261116022736         | 20261116080743         | Published canonical file |
| 20261116022737         | 20261116080746         | Published canonical file |
| 20261116031429         | 20261116091012         | Pending PR17 file        |
| 20261116031533         | 20261116091013         | Pending PR17 file        |
| 20261116031728         | 20261116091015         | Pending PR17 file        |
| 20261116032008         | 20261116091016         | Pending PR17 file        |
| 20261116032842         | 20261116091017         | Pending PR17 file        |
| 20261116034053         | 20261116091018         | Pending PR17 file        |
| 20261116034638         | 20261116091019         | Pending PR17 file        |
| 20261116040854         | 20261116091020         | Pending PR17 file        |
| 20261116041354         | 20261116091022         | Pending PR17 file        |
| 20261116042100         | 20261116091023         | Pending PR17 file        |
| 20261116044535         | 20261116091024         | Pending PR17 file        |
| 20261116045011         | 20261116091025         | Pending PR17 file        |
| 20261116045609         | 20261116080748         | Published canonical file |
| 20261116051736         | 20261116091026         | Pending PR17 file        |
| 20261116052704         | 20261116091027         | Pending PR17 file        |
| 20261116052910         | 20261116091029         | Pending PR17 file        |
| 20261116054135         | 20261116091030         | Pending PR17 file        |
| 20261116055929         | 20261116091031         | Pending PR17 file        |
| 20261116063201         | 20261116091032         | Pending PR17 file        |
| 20261116065156         | 20261116091034         | Pending PR17 file        |

A private experimental database that applied earlier unmerged identifiers needs separate inspection; never reset or falsify its history. Actual hosted history and any planned installation require the existing exact-source migration review, backup, writer-stop and recovery gates. The reviewed updater plan is an operating-controller extension, not a migration; [REVIEWED_MIGRATION_PLANS](REVIEWED_MIGRATION_PLANS.md) documents its release/history binding and one-shot approval. Source documentation proves no live activation or complete acceptance.

## Before changing SQL

1. Find the definition, later replacements, triggers, RLS/grants and every API caller. An internal trigger or documented RPC without a browser import is not automatically dead code.
2. Create a **new additive migration** with the installed Supabase CLI. Include an explicit outer BEGIN/COMMIT envelope for exact-source atomic history replay. Do not rewrite released SQL files, production history or accepted snapshots.
3. Comment new tables, functions, lock ordering, actor/MFA checks, `search_path`, versioning/idempotency and grants directly in the new SQL source. New internal helpers need explicit EXECUTE revokes; do not broadly expand wrapper/definer boundaries.
4. Check a fresh replay, actual RLS/concurrency and the affected Auth/API/browser flows. Updating an existing database and preserving actual Storage bytes require separate evidence. Use the existing isolated full verification command and document the stages actually reached.
5. Update the API reference only through its intended actual replay; also update this guide, feature documentation, plan and work log. Hosted migrations follow the existing operations and approval path.
