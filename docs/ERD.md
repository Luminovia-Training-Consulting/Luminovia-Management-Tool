# Relational model and permission boundaries

## Added operational records

Readiness settings/tasks/instruction receipts/events reference course_runs and currently assigned profiles; percentages derive from current source records. Delivery records reference assignment_sessions, with immutable submissions and events plus actor/request receipts. Replacement offers link original job_claims to a new accepted job_claim only after atomic handover; allocation history remains in assignment_sessions. Support tickets link their requester, optional authorised course/claim/organisation and support assignee; separate messages/events/attachments enforce hidden internal entries. All new persistent operational tables are private, RLS-enabled and accessed by reviewed invoker RPCs over scoped implementations. [Schema/workflow guides](OPERATIONS_EXTENSION_STATUS.md) and additive migration source own exact columns and acceptance.

The target diagrams retain the complete product map. They are not a claim that every target table already exists. The implemented diagrams below use the actual names in `supabase/migrations/*.sql`, including the current local collaboration, files, knowledge, customer/course and commercial migrations. Migration source, RLS policies and executed API/database tests are authoritative for exact columns and behaviour. A local migration does not imply hosted deployment or production acceptance.

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
  PROFILES ||--o{ GLOBAL_EVENTS : publishes_with_permission
  PROFILES ||--o{ NOTIFICATIONS : receives
  PROFILES ||--o{ INVITATION_REQUESTS : reserves_as_actor
  PROFILES ||--o{ AUDIT_EVENTS : acts
```

Roles and permission identifiers are text values in the implemented joins, rather than separate `roles`/`permissions` tables. `lecturer_topics` stores self-selection and separately managed verification; the target's separate expertise/qualification entities are not additional current tables. Availability rules and persisted general preferences remain broader target scope. In this schema each `contracts` row is one executed version; there is no separate implemented `contract_versions` table.

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

`PRIVATE_*` entities in this diagram name actual `private.client_course_requests`, `private.job_commission_offers` and `private.claim_revenue_ledger`; they are not public REST tables. Only authorised security-invoker wrappers call the private implementations. The accepted ledger is one snapshot per claim. A client request may create a draft or published job; reports count publication from the actual job state. Invoice labels change metadata only; PDF versions, accepted compensation and payment history keep their original invariants.

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

## Required constraints and ownership

- Stable UUID foreign keys with explicit deletion behaviour; no accidental cascading deletion of executed contracts or accepted assignments. Unique role/permission/expertise and room membership joins. Verification is server-managed independently of lecturer self-selected expertise.
- Templates contain reusable course content; runs contain actual delivery/customer context; sessions contain canonical instants and intended display zone. A job includes one or more complete sessions. Jobs initially have capacity one, with one active claim per available slot. Future capacity cannot weaken conflict/atomicity constraints.
- Claims own immutable accepted amount/currency/rate unit/terms and the applicable executed-contract row. Its immutable file reference/hash fixes the agreement evidence when present. Idempotency keys are scoped to actor/request; claim events and notifications deduplicate by committed event. A later job edit never rewrites accepted terms.
- Allocation intervals use non-overlap protection per lecturer across jobs, together with transaction locking; private events/availability are included in server-side eligibility. Every session reserves or the entire transaction rolls back.
- Personal events belong solely to their creator. Global events require explicit publication. Business contacts/internal notes, contracts, CVs/evidence and invoices need separate capabilities or resource membership. Private room membership is not implied by admin status.
- Every exposed relation requires RLS and explicit least-privilege grants. Private schema objects are unexposed and execution-locked. User IDs/roles are derived from verified Auth/current database authority, never editable metadata.
- Implemented indexes include job publication/requirements, assignment exclusion ranges, owner/member and cursor lookups, wiki/forum searchable text, invoice active-claim uniqueness and scoped payment history. Search always runs under actor authorisation. Search/list limits are documented in the feature security notes; full-scale pagination remains part of the target.

## Implemented permission matrix

| Resource/action                  | Owner / eligible lecturer                                                                                   | Ordinary peer                                      | Privileged management                                                                   |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Own profile self-service fields  | Read/edit                                                                                                   | Only intentionally public fields, when implemented | Explicit management capability where needed                                             |
| Roles and verification           | Read own applicable grants; no self-promotion                                                               | No mutation                                        | Explicit capability plus MFA; audited                                                   |
| Published jobs                   | Read when authorised/eligible; claim through RPC                                                            | Same permission-based rules                        | Manage with `jobs.manage` and MFA                                                       |
| Accepted assignment snapshot     | Read own                                                                                                    | No                                                 | Explicit commercial/resource permission                                                 |
| Private calendar event           | Read/edit own                                                                                               | Denied                                             | Denied unless actual owner                                                              |
| Executed contract/file/receipt   | Read own; receipt own exact hash                                                                            | Denied                                             | Specific `contracts.read`/`contracts.manage` plus MFA; receipt cannot impersonate owner |
| Private DM/messages/revisions    | Current room member only                                                                                    | Denied                                             | No implicit access; DM membership is not administratively editable                      |
| Group/channel and room files     | Current nonremoved membership plus current role constraints                                                 | Denied outside membership                          | Owner or explicit capability within accessible room; no room bypass                     |
| Personal files                   | Owner; clean bytes only                                                                                     | Denied                                             | CV/certificate/contract/invoice each require their separate capability plus MFA         |
| Customer contacts/private notes  | No implicit lecturer access                                                                                 | Denied                                             | `organisations.manage` plus MFA                                                         |
| Course catalogue                 | Published/assigned; participants explicitly enrolled through managed enrolment or course-channel membership | Denied otherwise                                   | `courses.manage` plus MFA for changes                                                   |
| Wiki drafts/history              | Author and current wiki managers                                                                            | Published revisions only for staff                 | `wiki.manage` plus MFA for publish/archive                                              |
| Forum/report/revision            | Staff; own reports, own post revisions                                                                      | Staff discussion only                              | `forum.moderate` plus MFA for moderation/reports                                        |
| Earnings/invoice/payment history | Own original-currency records                                                                               | Denied                                             | `finance.manage` plus MFA; mutations audited                                            |

See `CHAT_SECURITY.md`, `KNOWLEDGE_SECURITY.md`, `COMMERCIAL_SECURITY.md`, `OPERATIONS.md` and `BACKEND_SECURITY_REVIEW.md` for actual tested boundaries and outstanding acceptance. Tombstones, archives and audit revisions preserve data; none is a production legal-erasure or retention-policy guarantee.
