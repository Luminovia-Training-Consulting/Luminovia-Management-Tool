# Relational model and permission boundaries

The target diagrams retain the complete product map; conceptual target entities are not claims that every table exists. Implemented diagrams use physical names from `supabase/migrations/*.sql`, with `PRIVATE_*` aliases mapped below. The accepted M6 baseline contains 24 migrations. M7 adds five migrations (29 total), followed by three M8 migrations (32 total). The combined native 32-migration acceptance, including the M7 file-dialog correction, remains pending. SQL, explicit grants/RLS and owning tests remain authoritative. Source relations do not prove hosted installation or production acceptance. See [ARCHITECTURE](ARCHITECTURE.md), [QA_RESULTS](QA_RESULTS.md) and [WORKLOG](WORKLOG.md).

## Core target relations

```mermaid
erDiagram
  AUTH_USERS ||--|| PROFILES : has
  PROFILES ||--o{ USER_ROLES : receives
  ROLES ||--o{ USER_ROLES : assigns
  ROLES ||--o{ ROLE_PERMISSIONS : maps
  PERMISSIONS ||--o{ ROLE_PERMISSIONS : grants
  PROFILES ||--o{ LECTURER_QUALIFICATIONS : owns
  PROFILES ||--o{ LECTURER_EXPERTISE : selects
  TAXONOMY ||--o{ LECTURER_EXPERTISE : labels
  ORGANISATIONS ||--o{ ORGANISATION_CONTACTS : has
  COURSE_TEMPLATES ||--o{ COURSE_RUNS : instantiates
  ORGANISATIONS ||--o{ COURSE_RUNS : commissions
  COURSE_RUNS ||--o{ COURSE_SESSIONS : schedules
  COURSE_RUNS ||--o{ JOBS : divides
  JOBS ||--o{ JOB_SESSIONS : offers
  COURSE_SESSIONS ||--o{ JOB_SESSIONS : includes
  JOBS ||--o{ JOB_REQUIREMENTS : requires
  JOBS ||--o{ JOB_CLAIMS : allocates
  PROFILES ||--o{ JOB_CLAIMS : claims
  JOB_CLAIMS ||--o{ ASSIGNMENT_ALLOCATIONS : reserves
  JOB_CLAIMS ||--o{ CLAIM_EVENTS : audits
  CONTRACT_VERSIONS ||--o{ JOB_CLAIMS : underpins
  CONTRACTS ||--o{ CONTRACT_VERSIONS : versions
  PROFILES ||--o{ CONTRACTS : holds
  CONTRACT_VERSIONS ||--o{ CONTRACT_ACCEPTANCES : records
  PROFILES ||--o{ PERSONAL_EVENTS : owns
  PROFILES ||--o{ LECTURER_AVAILABILITY : defines
  COURSE_RUNS ||--o{ GLOBAL_EVENTS : publishes
```

## Collaboration and commercial target relations

```mermaid
erDiagram
  CHAT_ROOMS ||--o{ CHAT_MEMBERS : authorises
  PROFILES ||--o{ CHAT_MEMBERS : joins
  CHAT_ROOMS ||--o{ MESSAGES : stores
  MESSAGES ||--o{ MESSAGE_REACTIONS : receives
  MESSAGES ||--o{ MESSAGE_ATTACHMENTS : links
  DOCUMENTS ||--o{ DOCUMENT_VERSIONS : versions
  DOCUMENTS ||--o{ DOCUMENT_LINKS : scopes
  DOCUMENT_VERSIONS ||--o{ MESSAGE_ATTACHMENTS : attaches
  WIKI_PAGES ||--o{ WIKI_REVISIONS : versions
  FORUM_CATEGORIES ||--o{ FORUM_THREADS : contains
  FORUM_THREADS ||--o{ FORUM_POSTS : contains
  JOB_CLAIMS ||--o{ INVOICES : billed
  INVOICES ||--o{ PAYMENT_RECORDS : records
  PROFILES ||--o{ NOTIFICATIONS : receives
  PROFILES ||--|| PREFERENCES : configures
  PROFILES ||--o{ AUDIT_EVENTS : acts
```

## Implemented core and course relations

```mermaid
erDiagram
  AUTH_USERS ||--|| PROFILES : provisions
  PROFILES ||--o{ USER_ROLES : receives
  USER_ROLES }o--o{ ROLE_PERMISSIONS : resolves_by_role
  PROFILES ||--o{ LECTURER_TOPICS : selects_and_is_verified
  TOPICS ||--o{ LECTURER_TOPICS : classifies
  ORGANISATIONS ||--o| ORGANISATION_PRIVATE_DETAILS : restricts
  ORGANISATIONS ||--o{ ORGANISATION_CONTACTS : restricts
  ORGANISATIONS o|--o{ COURSE_RUNS : commissions
  COURSE_TEMPLATES ||--o{ COURSE_RUNS : instantiates
  COURSE_TEMPLATES ||--o{ COURSE_TEMPLATE_TOPICS : classifies
  TOPICS ||--o{ COURSE_TEMPLATE_TOPICS : labels
  COURSE_RUNS ||--o{ COURSE_SESSIONS : schedules
  COURSE_RUNS o|--o{ JOBS : contextualises
  JOBS ||--o{ JOB_SESSIONS : offers
  COURSE_SESSIONS o|--o{ JOB_SESSIONS : identifies_source
  JOBS ||--o{ JOB_REQUIREMENTS : requires
  TOPICS ||--o{ JOB_REQUIREMENTS : specifies
  JOBS ||--o{ JOB_CLAIMS : allocates
  PROFILES ||--o{ JOB_CLAIMS : accepts
  JOB_CLAIMS ||--o{ ASSIGNMENT_SESSIONS : reserves
  JOB_CLAIMS ||--o{ CLAIM_EVENTS : audits
  CONTRACTS o|--o{ JOB_CLAIMS : fixes_accepted_agreement
  PROFILES ||--o{ PERSONAL_EVENTS : owns_privately
  PROFILES ||--o{ NOTIFICATIONS : receives
  PROFILES ||--o{ INVITATION_REQUESTS : reserves_as_actor
  PROFILES ||--o{ AUDIT_EVENTS : acts
```

Roles and permission identifiers are text values in the implemented joins, rather than separate `roles`/`permissions` tables. `lecturer_topics` stores self-selection and separately managed verification; there is no separate public `lecturer_qualifications` table. M8 adds the private evidence/state/history relations below without replacing that eligibility record. M6 adds actual `lecturer_availability` and private notification preferences; M7 adds the separate own attention preference below. Broader scheduling and settings remain target scope. In this schema each `contracts` row is one executed version; there is no separate implemented `contract_versions` table.

## Implemented collaboration and files

```mermaid
erDiagram
  JOBS o|--o| CHAT_ROOMS : lecturer_course_room
  COURSE_RUNS o|--o{ CHAT_ROOMS : participant_course_rooms
  PROFILES o|--o{ CHAT_ROOMS : owns_group
  CHAT_ROOMS ||--o{ CHAT_MEMBERS : authorises_current_members
  PROFILES ||--o{ CHAT_MEMBERS : joins
  CHAT_ROOMS ||--o{ MESSAGES : persists
  PROFILES ||--o{ MESSAGES : sends
  MESSAGES ||--o{ MESSAGE_REACTIONS : aggregates
  MESSAGES ||--o{ CHAT_MESSAGE_REVISIONS : retains_private_audit
  DOCUMENTS o|--o{ MESSAGES : attaches_one_document
  PROFILES ||--o{ DOCUMENTS : owns
  CHAT_ROOMS o|--o{ DOCUMENTS : scopes_room_files
  JOBS o|--o{ DOCUMENTS : scopes_before_after_files
  DOCUMENTS ||--|{ DOCUMENT_VERSIONS : versions
  DOCUMENT_VERSIONS o|--o| DOCUMENTS : points_to_current
```

`chat_rooms.kind` distinguishes DMs, lecturer general chat, staff topics, lecturer job rooms and participant course channels. A participant room references the course run and keeps `job_id` null. It does not expose the commercial job relation. DM pair keys are unique; `(room_id,user_id)` memberships carry removal tombstones, monotone read state and mute preference. Messages retain sender-scoped retry UUIDs, edit/delete state and stable cursor order. Reactions use removal tombstones. There are no separate current `message_attachments` or `document_links` tables: a message has one optional `document_id`, while a document has a validated personal/room/job-before/job-after scope. Ordinary chat attachments follow that document's current clean version; commercial evidence instead fixes an exact historical version below.

`documents.current_version_id` is updated as versions are reserved. Versions carry the immutable storage object key, original filename/MIME/size, SHA-256 and scanner result/version. Metadata RLS is independent of scan state; binary download additionally requires a clean requested version. Quarantine and clean buckets are private, and restrictive Storage policies deny direct anonymous/authenticated object access. Files flow through the authenticated Edge gateway; they are not public or durable signed URLs.

Reservation retry UUIDs bind the create/replace operation and exact replacement document. Owner-scoped quota locks serialise both self uploads and uploads by different authorised managers on that owner's behalf. Those constraints are enforced in the follow-up migration `20261115132410_document_reservation_retry_quota.sql`, preserving the earlier applied migration files.

## Implemented knowledge and commercial relations

```mermaid
erDiagram
  KNOWLEDGE_CATEGORIES ||--o{ WIKI_REVISIONS : categorises_wiki
  PROFILES ||--o{ WIKI_PAGES : owns_drafts
  WIKI_PAGES ||--|{ WIKI_REVISIONS : versions
  WIKI_REVISIONS ||--o| WIKI_PAGES : current_revision
  WIKI_REVISIONS o|--o| WIKI_PAGES : published_revision
  KNOWLEDGE_CATEGORIES ||--o{ FORUM_THREADS : categorises_forum
  FORUM_THREADS ||--|{ FORUM_POSTS : contains
  FORUM_POSTS o|--o| FORUM_THREADS : accepted_answer
  FORUM_POSTS ||--o{ FORUM_POST_REVISIONS : retains_audit
  FORUM_THREADS ||--o{ FORUM_SUBSCRIPTIONS : notifies
  PROFILES ||--o{ FORUM_SUBSCRIPTIONS : subscribes
  FORUM_POSTS ||--o{ FORUM_REPORTS : receives_private_report
  PROFILES ||--o{ CONTRACTS : holds_executed_versions
  CONTRACTS o|--o{ CONTRACTS : parent_addenda
  DOCUMENT_VERSIONS o|--o{ CONTRACTS : fixes_pdf_and_hash
  CONTRACTS ||--o{ CONTRACT_ACCEPTANCES : records_receipt
  PROFILES ||--o{ INVOICES : submits
  DOCUMENT_VERSIONS ||--o{ INVOICES : fixes_invoice_pdf
  INVOICES ||--|{ INVOICE_ITEMS : groups
  JOB_CLAIMS ||--o{ INVOICE_ITEMS : bills_accepted_compensation
  INVOICES ||--o{ PAYMENT_RECORDS : tracks_partial_full_and_void
```

Wiki/forum categories share one `knowledge_categories` table with a kind discriminator. Wiki current and published version pointers are separate composite foreign keys, so an author's newer draft cannot replace the published reader snapshot. Bodies use server-validated Tiptap JSON plus server-derived searchable text, not stored arbitrary HTML. Wiki and forum are staff-only at this checkpoint; participant knowledge ACLs and knowledge attachments remain pending.

Executed contract rows fix a `document_versions.id` and SHA-256, with optional same-owner parent addendum. Legacy fictional contract metadata can have no PDF and cannot receive a file receipt. `contract_acceptances.kind` is explicitly `receipt_acknowledgement`, not a legal electronic signature. Accepted claims keep their immutable contract reference and original amount/currency/terms. Invoices join claims through `invoice_items`, with a unique active invoice per claim. Payment rows track the original currency; corrections void entries with audit rather than overwrite amounts. Referenced commercial file versions and agreement/invoice snapshots are immutable, and linked documents cannot be hidden through ordinary soft deletion.

## Implemented M3 account, profile and financial extension

```mermaid
erDiagram
  PROFILES ||--o| PROFILE_DETAILS : owns_authored_fields
  PROFILES ||--o{ CLIENT_ORGANISATION_MEMBERSHIPS : receives_explicit_scope
  ORGANISATIONS ||--o{ CLIENT_ORGANISATION_MEMBERSHIPS : restricts
  ORGANISATIONS ||--o{ PRIVATE_CLIENT_COURSE_REQUESTS : receives
  PRIVATE_CLIENT_COURSE_REQUESTS o|--o| JOBS : publishes_once
  JOBS ||--o| PRIVATE_JOB_COMMISSION_OFFERS : defines_gross_platform_net
  JOB_CLAIMS ||--o| PRIVATE_CLAIM_REVENUE_LEDGER : freezes_accepted_split
  PROFILES ||--o{ COURSE_ENROLMENTS : attends
  COURSE_RUNS ||--o{ COURSE_ENROLMENTS : enrols
  COURSE_RUNS ||--o{ COURSE_REVIEWS : contextualises
  PROFILES ||--o{ COURSE_REVIEWS : teaches
```

`PRIVATE_*` entities in this diagram name actual `private.client_course_requests`, `private.job_commission_offers` and `private.claim_revenue_ledger`; they are not public REST tables. Only authorised security-invoker wrappers call the private implementations. The accepted ledger is one snapshot per claim. A client request may create a draft or published capacity-one job; reports count publication from the actual job state. M6 permits several historical revenue-ledger rows for a job, one immutable row per accepted claim, and sums current accepted position revenue without counting that course several times. Invoice labels change metadata only; PDF versions, accepted compensation and payment history keep their original invariants.

`profile_details` separates the new authored country/languages/experience/labels from private contacts/evidence. `course_enrolments` keeps current membership/completion/removal, while `course_reviews` carries course/actual lecturer/author, versioned text/rating and moderation/withdrawal state. Direct review table reads are denied; identity-safe RPCs project each reader's authorised view. Existing `invitation_requests` now binds the requested role/organisation/display name; both invitation handlers use this single lifecycle. Exact schema/arguments are in [API_REFERENCE](API_REFERENCE.md) and the three additive M3 migrations.

## Implemented M4 source catalogue, avatars and discussions

```mermaid
erDiagram
  BUILDING_BLOCKS ||--|{ BUILDING_BLOCK_SOURCES : records_exact_versions
  BUILDING_BLOCKS ||--o{ COURSE_TEMPLATES : underlies
  BUILDING_BLOCK_SOURCES ||--o{ COURSE_TEMPLATES : fixes_provenance
  COURSE_TEMPLATES ||--o{ COURSE_RUNS : plans
  COURSE_RUNS ||--o{ JOBS : offers_existing_sessions
  PROFILES ||--o{ PRIVATE_COURSE_RUN_JOB_REQUESTS : retries_safely
  JOBS ||--o| PRIVATE_COURSE_RUN_JOB_REQUESTS : binds_result
  PROFILES ||--o| PROFILE_AVATARS : selects
  DOCUMENT_VERSIONS ||--o{ PROFILE_AVATARS : fixes_clean_png
  JOBS o|--o{ PRIVATE_RESOURCE_COMMENTS : discusses
  COURSE_TEMPLATES o|--o{ PRIVATE_RESOURCE_COMMENTS : discusses
  PROFILES ||--o{ PRIVATE_RESOURCE_COMMENTS : authors
  PRIVATE_RESOURCE_COMMENTS ||--o{ PRIVATE_RESOURCE_COMMENT_REVISIONS : audits_changes
```

A comment references exactly one job or template, enforced by a database constraint. Cursor indexes order each resource; actor request UUIDs deduplicate concurrent submissions and actor locks serialize rate checks. Private revisions are not ordinary reader data. A profile avatar selects an exact immutable clean image version; its owner-only metadata table does not grant peers the underlying personal document. Peer display uses the separate current-profile projection and authenticated gateway.

Source versions have stable provider/code/file/hash identity. LPC3/LPC4 each retain two real PDF variants under one block. Template/run provenance freezes when a linked job exists. The private course-offer request ledger binds the original financial request and resulting existing-run job; client full-fee requests remain in the existing client ledger when actually known. No new duplicate source columns are added to job/claim snapshots. See [CBW_TEMPLATES](CBW_TEMPLATES.md), [RESOURCE_COMMENTS](RESOURCE_COMMENTS.md) and [PROFILE_AVATARS](PROFILE_AVATARS.md).

## Implemented M6 operations additions

```mermaid
erDiagram
  TOPICS o|--o{ TOPICS : optional_parent
  PROFILES ||--o{ LECTURER_AVAILABILITY : owns_private_windows
  PROFILES ||--o| PRIVATE_NOTIFICATION_PREFERENCES : owns_categories
  PROFILES ||--o{ PRIVATE_JOB_LIFECYCLE_REQUESTS : binds_operation_key
```

These entities map to `public.topics`, `public.lecturer_availability`,
`private.notification_preferences` and `private.job_lifecycle_requests`.
Topics retain shared IDs across expertise, course templates and job requirements;
archive/version/parent guards do not rewrite existing references. Availability
keeps finite instants, IANA zone, own notes and default-false explicit management
sharing. The direct table read policy remains owner-only; the shared RPC exposes
only its reduced opt-in projection. Notification preferences have one profile-FK
primary key and the four independent `chat`, `forum`, `job_updates`, `reminders`
booleans with optimistic versioning.

`private.job_lifecycle_requests` has primary key `(actor_id,request_id)` and a
profile FK. Its `result` UUID binds the operation result through checked RPC logic;
it is **not** a declared job foreign key. Job lifecycle metadata/board/audit reads
are projections, not additional storage tables. [JOB_LIFECYCLE](JOB_LIFECYCLE.md),
[TAXONOMY](TAXONOMY.md), [AVAILABILITY](AVAILABILITY.md),
[NOTIFICATIONS](NOTIFICATIONS.md) and [ADMIN_AUDIT](ADMIN_AUDIT.md) describe the
scoped APIs.

M6 replaces the original single-confirmed-claim-per-job index with partial unique
`(job_id,lecturer_id) WHERE status='confirmed'`. Job capacity is 1–20;
`capacity_basis='single_position'` requires capacity 1, while an explicitly new
per-position offer may have several positions. The transactional job lock guards
its remaining count. `assignment_sessions.released_at` preserves cancelled
intervals; only unreleased rows participate in the GiST lecturer/time exclusion.
Cancellation preserves accepted claim/fee/session/revenue history and closes the
offer to draft until audited reopening. Shared lecturer locking prevents invoice
submission racing cancellation. There is no new refund or bank-payment relation.

## Implemented M7 private personal organization

```mermaid
erDiagram
  PROFILES ||--o{ PRIVATE_DOCUMENT_ORGANISATION : owns_annotations
  DOCUMENTS ||--o{ PRIVATE_DOCUMENT_ORGANISATION : annotates_accessible_resource
  PROFILES ||--o{ PRIVATE_SAVED_JOB_VIEWS : owns_filters
  PROFILES ||--o| PRIVATE_ATTENTION_PREFERENCES : owns_quiet_window
```

| Diagram entity / physical table                                   | Key and actual foreign keys                                                              | Stored invariant / API                                                                                                                                                                                |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PRIVATE_DOCUMENT_ORGANISATION` / `private.document_organisation` | PK `(user_id,document_id)`; FKs to `profiles.id` and `documents.id`, both delete-cascade | Own tags/folder/version only; `document_discovery`, `save_document_organisation`. No Storage path or shared-file move.                                                                                |
| `PRIVATE_SAVED_JOB_VIEWS` / `private.saved_job_views`             | PK `id`; `user_id` FK to `profiles.id`, delete-cascade; unique `(user_id,lower(name))`   | At most 20 canonical closed-JSON views per actor, checked under quota lock; `saved_job_views`, `save_job_view`, `remove_job_view`. Filter IDs inside JSON are validated by the API, not declared FKs. |
| `PRIVATE_ATTENTION_PREFERENCES` / `private.attention_preferences` | PK/FK `user_id` to `profiles.id`, delete-cascade                                         | Separate versioned daily minute window/IANA zone; `attention_preferences`, `save_attention_preferences`. Missing row reads as version 0 without insertion.                                            |

All three tables enable RLS and revoke direct PUBLIC/anon/authenticated access.
The first two explicitly grant service-role table access; this is not a browser
permission or an administrator read bypass. Scoped invoker RPCs/private definers
check the current actor and resource. Personal document metadata requires current
underlying document access, including after room revocation. Saved views confer
no access to a filtered job. Quiet settings confer no access to another inbox.

`job_discovery`, `job_detail`, `job_dashboard` and `assignment_job_titles` are
projections of existing job/claim/session/profile data, **not** duplicated job or
dashboard tables. Discovery cursors include stable sort/UUID values and a filter
fingerprint. File discovery orders by `(created_at,id)`. Both page on the server;
neither raises the global 1,000-row Data API setting. Dashboard totals are
server-authorized aggregates, not counts of a preview page. Calendar title lookup
returns only requested own confirmed assignment jobs. See [JOB_DISCOVERY](JOB_DISCOVERY.md)
and [FILES](FILES.md).

Both saved-view mutations take actor profile `FOR SHARE` **before** the separate
current-role/capability check and saved-view row lock. The volatile entry's new
statement snapshot observes a role withdrawal that held profile `FOR UPDATE`.
A stale expected view version fails with `40001`; an authoritative `42501` hides
and discards captured private editor/list data. Network errors retain the draft.
Operation UUID reuse is limited to retries of the same open create dialog.

## Implemented M7 chat content and mention versions

```mermaid
erDiagram
  MESSAGES ||--|{ PRIVATE_CHAT_CONTENT_VERSIONS : identifies_body_revision
  PRIVATE_CHAT_CONTENT_VERSIONS ||--o{ PRIVATE_CHAT_MENTION_VERSIONS : binds_recipients
  PROFILES ||--o{ PRIVATE_CHAT_MENTION_VERSIONS : is_target
  PROFILES ||--o{ PRIVATE_CHAT_MENTION_REQUESTS : binds_exact_retry
```

| Physical table                  | Key / relation                                                                                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `private.chat_content_versions` | PK `(message_id,version)`; message FK delete-cascade. Records version identity/time; existing private message revisions retain body audit.                               |
| `private.chat_mention_versions` | PK `(message_id,version,user_id)`; composite FK to content versions, delete-cascade; target profile FK. Index `(message_id,user_id)` supports first-ever mention lookup. |
| `private.chat_mention_requests` | PK `(actor_id,request_id)`; actor profile FK delete-cascade; exact normalized payload/result JSON, not ordinary chat history.                                            |

`messages.content_version` changes with body/edit/deletion state, including legacy
API edits; only the current version's authorized recipients appear in
`chat_messages_with_mentions`. A legacy edit does not carry forward an earlier
structured selection. `send_message_with_mentions` and
`edit_message_with_mentions` atomically bind current eligible room members and
exact retry parameters; `chat_mention_candidates` is a current-room projection.
Internal helpers and these three RLS-enabled private tables have no direct browser
grants. Normal chat membership/role predicates still apply to reads, edits,
moderation, attachments and Realtime; administrator status does not open DMs.

Notifications reuse unique `(user_id,kind,resource_id)` with kind `chat_message`
and the message UUID. The **first ever** committed structured message/recipient
mention can renew that same notice; retries and remove/re-add cycles do not.
History retains that fact even if category preference suppressed delivery.
Room mute may be overridden by an explicit mention; the global category opt-out
still applies. Quiet hours affect attention only. The polymorphic notification
`resource_id` has no message FK; current target resolution supplies authorization.
See [CHAT](CHAT.md) and [CHAT_SECURITY](CHAT_SECURITY.md).

## Implemented M7 announcement snapshots and acknowledgements

```mermaid
erDiagram
  PROFILES ||--o{ PRIVATE_PORTAL_ANNOUNCEMENTS : creates
  PRIVATE_PORTAL_ANNOUNCEMENTS ||--o{ PRIVATE_ANNOUNCEMENT_REVISIONS : owns_snapshots
  PRIVATE_ANNOUNCEMENT_REVISIONS o|--o| PRIVATE_PORTAL_ANNOUNCEMENTS : current_draft
  PRIVATE_ANNOUNCEMENT_REVISIONS o|--o| PRIVATE_PORTAL_ANNOUNCEMENTS : current_publication
  PRIVATE_ANNOUNCEMENT_REVISIONS ||--o| PRIVATE_ANNOUNCEMENT_PUBLICATIONS : explicitly_publishes
  PROFILES ||--o{ PRIVATE_ANNOUNCEMENT_PUBLICATIONS : publishes
  PRIVATE_ANNOUNCEMENT_REVISIONS ||--o{ PRIVATE_ANNOUNCEMENT_ACKNOWLEDGEMENTS : receives
  PROFILES ||--o{ PRIVATE_ANNOUNCEMENT_ACKNOWLEDGEMENTS : acknowledges_own
  PROFILES ||--o{ PRIVATE_ANNOUNCEMENT_REQUESTS : binds_exact_operation
```

| Physical table                          | Keys and state boundary                                                                                                                                                                                              |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `private.portal_announcements`          | UUID PK; creator profile FK; optimistic parent `version`, archive state, separate draft/published revision pointers.                                                                                                 |
| `private.announcement_revisions`        | UUID PK; parent FK delete-cascade; unique `(announcement_id,revision)` and `(announcement_id,id)`; creator profile FK. Immutable DE/EN title/body, importance, role audience, finite display instants and IANA zone. |
| `private.announcement_publications`     | PK/FK `revision_id` delete-cascade; publisher profile FK; immutable publication timestamp. A draft alone has no publication receipt.                                                                                 |
| `private.announcement_acknowledgements` | PK `(user_id,revision_id)`; profile/revision FKs delete-cascade; exact retry preserves original acknowledgement timestamp.                                                                                           |
| `private.announcement_requests`         | PK `(actor_id,request_id)`; actor profile FK delete-cascade; exact action/version/payload and original result. No JSON-result FK is implied.                                                                         |

Parent `(id,draft_revision_id)` and `(id,published_revision_id)` are separate
**composite**, initially deferred FKs to revision `(announcement_id,id)`. Thus a
parent cannot point to another announcement's revision. Saving a new immutable
draft leaves the published snapshot intact. Update guards protect revisions and
publication receipts. Ordinary reads start from the current published pointer;
older, draft, archived, expired and newly unauthorized revisions fail exact reads.

`manage_announcement` uses current `announcements.manage`/MFA, profile-first locks,
parent version and exact request binding. Publication, optional important inbox
fanout, safe audit and retry result commit atomically. Future-start publication is
explicitly refused until manually due. `announcements` and `announcement` return
only currently authorized display-window publications;
`admin_announcements`/`admin_announcement` expose the separately permissioned
editor. `acknowledge_announcement` locks the actor profile before current audience
checks, binds only that actor/revision and marks only its corresponding own inbox
row read. Archive/recover preserves existing ACK/notice identity; a new published
revision is a new acknowledgement target.

All five private tables enable RLS and revoke direct PUBLIC/anon/authenticated
access; internal helpers are also execution-restricted. Audience roles come from
current database grants, never user metadata. Important notices use
`portal_announcement` plus revision UUID in the existing notification uniqueness
key. These are logical references, not additional FKs. Important current readable
publications add quiet-hour attention; ordinary inbox rows and full unread count
remain unchanged. The older four-category preference table/API is not replaced.
No scheduler, email delivery, push transport or history-purge policy is implied.
See [ANNOUNCEMENTS](ANNOUNCEMENTS.md) and [NOTIFICATIONS](NOTIFICATIONS.md).

## Implemented M8 qualification evidence and decisions

```mermaid
erDiagram
  PROFILES ||--o{ PRIVATE_QUALIFICATION_STATES : owns_topic_state
  TOPICS ||--o{ PRIVATE_QUALIFICATION_STATES : identifies_topic
  PROFILES ||--o{ PRIVATE_QUALIFICATION_EVIDENCE : explicitly_shares
  TOPICS ||--o{ PRIVATE_QUALIFICATION_EVIDENCE : contextualises
  DOCUMENT_VERSIONS ||--o{ PRIVATE_QUALIFICATION_EVIDENCE : pins_exact_clean_version
  PRIVATE_QUALIFICATION_EVIDENCE o|--o{ PRIVATE_QUALIFICATION_STATES : current_grant
  PROFILES ||--o{ PRIVATE_QUALIFICATION_EVENTS : receives_history
  PROFILES o|--o{ PRIVATE_QUALIFICATION_EVENTS : acted
  TOPICS ||--o{ PRIVATE_QUALIFICATION_EVENTS : identifies_topic
  PRIVATE_QUALIFICATION_EVIDENCE o|--o{ PRIVATE_QUALIFICATION_EVENTS : records_basis
  PROFILES ||--o{ PRIVATE_QUALIFICATION_REQUESTS : binds_retry
```

| Physical table                   | Keys and actual foreign-key behavior                                                                                                                                                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `private.qualification_states`   | PK `(user_id,topic_id)`; profile FK delete-cascade; topic FK; optional evidence FK delete-set-null. Current nonnegative CAS version and current binding.                                                                                   |
| `private.qualification_evidence` | UUID PK; owner profile FK delete-cascade; topic FK; exact `document_version_id` FK delete-cascade; stored SHA-256 and withdrawal instant.                                                                                                  |
| `private.qualification_events`   | UUID PK; unique `(user_id,topic_id,version)`; owner profile FK delete-cascade, actor profile FK delete-set-null, topic FK and optional evidence FK delete-cascade. Bind/withdraw/deselect/attest events retain decision, expiry and basis. |
| `private.qualification_requests` | PK `(actor_id,request_id)`; actor profile FK delete-cascade; exact-command fingerprint. No stored result/document FK is implied.                                                                                                           |

The same `(user_id,topic_id)` coordinates current `lecturer_topics` and private
state through RPC/trigger logic; it is **not** a new composite FK to
`lecturer_topics`. Owner/topic consistency of evidence bindings is checked by the
mutators, not a diagram-implied extra constraint. Evidence/version/topic and
cursor/actor-rate indexes support these references. All four private tables enable
RLS, revoke PUBLIC/anon/authenticated table access and explicitly grant service-role
access. Normal browser calls use reviewed invoker wrappers/private implementations.
They cannot directly change protected history or promote themselves as verified.

`save_qualification_evidence` accepts only a selected topic and one own clean
personal certificate version; null withdraws access. `qualification_review`,
`qualification_history` and `qualification_evidence_access` project only permitted
current state/history. `attest_qualification` uses observed version/request identity;
legacy `verify_lecturer_topic` keeps its signature and uses the same manual
attestation/history core. Both own and review mutations take actor profile SHARE
before fresh current-role/MFA checks. Unchanged expiry fields retain the original
instant, and captured dirty drafts retain their observed CAS/evidence identity.
Retries append no event and return current sanitized state rather than old private
metadata. Earlier verifications are not backfilled with invented decisions.

The binding grants **one version**, not `documents` or all `document_versions`
reads. The existing users-manage CV policy remains, as do separate contracts and
finance policies. Qualification permission alone grants none of those. Files Edge
`qualification_evidence_download` performs current caller ACL before and after
fetching/hash-checking exact bounded bytes. Withdrawal, document archive and topic
deselection stop subsequent reads; historical event IDs grant no historical byte
access. Re-adding expertise does not restore an old grant. Existing verified state,
accepted claims/compensation and assignments are not rewritten by evidence changes.

History is immutable to browser users; trusted server purges retain explicit
cascade/set-null cleanup semantics. Topic FKs do not silently cascade history on
physical taxonomy deletion. Normal taxonomy uses archive; normal file UI uses
soft deletion, not a privileged version purge. This is not a shipped retention
policy or tamper-proof archival claim. See [QUALIFICATIONS](QUALIFICATIONS.md).

## Implemented M8 global-event lifecycle and picker projections

```mermaid
erDiagram
  GLOBAL_EVENTS {
    uuid id PK
    boolean published
    integer version
  }
  PROFILES ||--o{ PRIVATE_GLOBAL_EVENT_REQUESTS : binds_exact_command
```

`public.global_events` is the existing physical event table, extended with
`description`, `link_url`, `archived_at`, positive `version` and `updated_at`.
There is no duplicate global-calendar table or announcement-revision pointer.
The event table has no creator-profile or course-run FK; the actor is recorded
in the request/audit records, and published course sessions are a separate
calendar projection.
`private.global_event_requests` adds PK `(actor_id,request_id)`, profile FK
with delete-cascade, exact payload and original result JSON. Its JSON result is
not an event FK. The ledger enables RLS and revokes browser table access. Event
rows retain public RLS: ordinary active readers see published/nonarchived records;
management access requires its current capability/MFA.

`global_calendar_events` checks actual interval overlap in a finite window of at
most 93 days and returns timestamp/UUID pages (maximum 100). `manage_global_event`
uses profile-first fresh role checks, parent row/version locks and exact retry
binding. Save creates/unpublishes a draft; publish/unpublish/archive/recover are
explicit, and recovery is unpublished. Audit rows expose only reviewed safe
metadata. Descriptions/HTTPS links do not expose private appointments, attach
files or trigger remote fetching. Existing course-session calendar queries remain
separately authorized and retain their own bounds. See [CALENDAR](CALENDAR.md).

The new `job_picker` and private `job_picker_candidates` are **projections**, not
new tables or relationships. `job_attachment` follows `jobs.manage`/MFA;
`participant_course` follows `courses.manage`/MFA and returns one course run with
an existing representative job UUID for compatibility. Course labels/search use
permitted template/organization metadata plus first-session/IANA information,
not hidden job text or fees. Its selected item is resolved in the same bounded
request. Purpose/search-bound cursors and job/run/session lookup indexes replace
the last two unpaged `jobsQuery` callers without widening commercial rights or
changing claim/upload/channel mutation APIs. No per-option RPC or all-pages loop
is added. The administrative board remains separately limited to 500. See
[JOB_PICKERS](JOB_PICKERS.md).

The three additive sources are `20261116003728_scoped_administrative_job_pickers`,
`20261116003733_global_calendar_publications` and
`20261116004358_qualification_evidence_and_attestation_history`. Together with the
29 earlier migration sources this is a 32-migration source model. Focused source,
SQL/component/Edge checks do not establish the pending combined native acceptance.

## Required constraints and ownership

- Stable UUID foreign keys with explicit deletion behaviour; no accidental cascading deletion of executed contracts or accepted assignments. Unique role/permission/expertise and room membership joins. Verification is server-managed independently of lecturer self-selected expertise.
- Templates contain reusable course content; runs contain actual delivery/customer context; sessions contain canonical instants and intended display zone. A job includes one or more complete sessions. Legacy/client/CBW jobs keep capacity one; explicit new administrative per-position jobs support 1–20. Job locks, confirmed-count checks and unique active job/lecturer claims protect capacity without partial multi-session allocation.
- Claims own immutable accepted amount/currency/rate unit/terms and the applicable executed-contract row. Its immutable file reference/hash fixes the agreement evidence when present. Idempotency keys are scoped to actor/request; claim events and notifications deduplicate by committed event. A later job edit never rewrites accepted terms.
- Allocation intervals use non-overlap protection per lecturer across jobs, together with transaction locking; private events/availability are included in server-side eligibility. Every session reserves or the entire transaction rolls back.
- Personal events belong solely to their creator. Global events require explicit publication. Business contacts/internal notes, contracts, CVs/evidence and invoices need separate capabilities or resource membership. Private room membership is not implied by admin status.
- Every exposed relation requires RLS and explicit least-privilege grants. Private schema objects are unexposed and execution-locked. User IDs/roles are derived from verified Auth/current database authority, never editable metadata.
- Implemented indexes include job publication/requirements, assignment exclusion ranges, owner/member and cursor lookups, wiki/forum searchable text, invoice active-claim uniqueness and scoped payment history. Search always runs under actor authorisation. Search/list limits are documented in feature notes. M7 job/file discovery pages beyond 1,000; M8 replaces the legacy file/chat job pickers with bounded purpose-specific pages, while the administrative board retains its explicit newest-500 bound. Other unconverted lists are not claimed unbounded.

## Implemented permission matrix

| Resource/action                  | Owner / eligible lecturer                                                                                   | Ordinary peer                                          | Privileged management                                                                                       |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Own profile self-service fields  | Read/edit                                                                                                   | Only intentionally public fields, when implemented     | Explicit management capability where needed                                                                 |
| Roles and verification           | Read own applicable grants; no self-promotion                                                               | No mutation                                            | Explicit capability plus MFA; audited                                                                       |
| Published jobs                   | Read when authorised/eligible; claim through RPC                                                            | Same permission-based rules                            | Manage with `jobs.manage` and MFA                                                                           |
| Accepted assignment snapshot     | Read own                                                                                                    | No                                                     | Explicit commercial/resource permission                                                                     |
| Private calendar event           | Read/edit own                                                                                               | Denied                                                 | Denied unless actual owner                                                                                  |
| Executed contract/file/receipt   | Read own; receipt own exact hash                                                                            | Denied                                                 | Specific `contracts.read`/`contracts.manage` plus MFA; receipt cannot impersonate owner                     |
| Private DM/messages/revisions    | Current room member only                                                                                    | Denied                                                 | No implicit access; DM membership is not administratively editable                                          |
| Group/channel and room files     | Current nonremoved membership plus current role constraints                                                 | Denied outside membership                              | Owner or explicit capability within accessible room; no room bypass                                         |
| Personal files                   | Owner; clean bytes only                                                                                     | Denied                                                 | CV/certificate/contract/invoice each require their separate capability plus MFA                             |
| Customer contacts/private notes  | No implicit lecturer access                                                                                 | Denied                                                 | `organisations.manage` plus MFA                                                                             |
| Course catalogue                 | Published/assigned; participants explicitly enrolled through managed enrolment or course-channel membership | Denied otherwise                                       | `courses.manage` plus MFA for changes                                                                       |
| Wiki drafts/history              | Author and current wiki managers                                                                            | Published revisions only for staff                     | `wiki.manage` plus MFA for publish/archive                                                                  |
| Forum/report/revision            | Staff; own reports, own post revisions                                                                      | Staff discussion only                                  | `forum.moderate` plus MFA for moderation/reports                                                            |
| Earnings/invoice/payment history | Own original-currency records                                                                               | Denied                                                 | `finance.manage` plus MFA; mutations audited                                                                |
| Private file tags/virtual folder | Own annotation for a currently accessible document                                                          | Other account's annotation denied                      | No annotation read bypass                                                                                   |
| Saved job views / quiet window   | Own active actor; saved views additionally require current lecturer/manage access                           | Denied                                                 | Only own records under the same rules                                                                       |
| Qualification evidence / review  | Own explicit exact certificate-version sharing/withdrawal                                                   | No foreign grant                                       | Current `qualifications.verify`/MFA for the selected shared version; no blanket document/CV/contract access |
| Global events                    | Published, unarchived records only; private appointments remain separate                                    | Same public-event policy                               | `courses.manage`/MFA for bounded drafts/lifecycle; no private-calendar bypass                               |
| Scoped resource choices          | Only the current action's capability/MFA                                                                    | No privileged query from ordinary personal/topic flows | Job attachment vs participant-course metadata; no additional financial rights                               |
| Structured chat recipients       | Current eligible room members, current message version                                                      | Denied outside room                                    | Room-scoped moderation only; no DM/history bypass                                                           |
| Published announcements / ACK    | Current active-account audience/window; own exact-revision ACK                                              | Same current audience rules                            | Management drafts/publication need `announcements.manage` and MFA                                           |

See [CHAT_SECURITY](CHAT_SECURITY.md), [KNOWLEDGE_SECURITY](KNOWLEDGE_SECURITY.md), [COMMERCIAL_SECURITY](COMMERCIAL_SECURITY.md), [OPERATIONS](OPERATIONS.md) and [BACKEND_SECURITY_REVIEW](BACKEND_SECURITY_REVIEW.md) for tested boundaries and outstanding acceptance. The combined native 32-migration gate remains pending; authored tests do not establish a passed run. Tombstones, archives and audit revisions preserve data; none is a production legal-erasure or retention-policy guarantee.
