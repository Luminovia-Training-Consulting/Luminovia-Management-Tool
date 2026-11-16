# Architecture and decisions

Status: the accepted M6 application baseline contains 24 migrations; its executed local/CI evidence is recorded in [QA_RESULTS](QA_RESULTS.md) and [WORKLOG](WORKLOG.md). The M7 source adds five additive migrations, bringing the source set to 29. Its focused checks and authored native Auth/API/browser tests are not a completed M7 canonical or production acceptance. Migration source and owning tests define actual schema behavior; [ERD](ERD.md) maps physical relations and [API_REFERENCE](API_REFERENCE.md) inventories interfaces. The full target remains [PRODUCT_SPEC](PRODUCT_SPEC.md) and the authoritative [master prompt](UNIVERSAL_MASTER_PROMPT.txt). Hosted installation state is a separate operational record in [HOSTINGER_DEVELOPMENT](HOSTINGER_DEVELOPMENT.md) and [WORKLOG](WORKLOG.md); local source does not prove deployment.

## ADR-001 — separate private portal and static frontend

Use the existing `Luminovia-Training-Consulting/Luminovia-Management-Tool` repository. The public `Website` is solely a brand reference. React/TypeScript/Vite supplies the static SPA; no independent Node/Express application service is required. The original 15 November hosting decision used managed Supabase and reserved Docker/Supabase CLI for development. That hosting decision is historical: the user subsequently authorised the official Supabase Docker distribution on the Hostinger VPS as described in ADR-012.

**Hosting superseded on 16 November:** the user explicitly chose complete Supabase self-hosting at Hostinger. ADR-012 and [HOSTINGER_DEVELOPMENT](HOSTINGER_DEVELOPMENT.md) own the actual deployment; the security and static-frontend decisions remain applicable.

## ADR-002 — source-of-truth and feature boundaries

TanStack Query manages remote state through `@supabase/supabase-js`; no duplicated browser database or fake-auth runtime. React Router protects private screens and preserves deep links, while RLS/API checks remain authoritative. React Hook Form and Zod validate forms accessibly; database constraints revalidate security-critical data. i18next/react-i18next provide German/English text; browser locale/theme preferences may be persisted, private records may not. Tailwind/shadcn primitives and Lucide icons use verified brand tokens. FullCalendar owns calendar rendering; the M6 permissioned job Kanban uses dnd-kit with keyboard controls and explicit status-action fallbacks. Wiki/forum use Tiptap with a strict stored/rendered JSON whitelist and code-block language highlighting.

M1 public API contract (subject to migration ownership): `get_my_permissions()` returns capability names; own `profiles` uses `id`, `display_name`, `bio_de`, `bio_en`, `phone`, `time_zone`, `locale`, `active` with restricted self-edit fields. `topics` and `lecturer_topics` distinguish self-selected expertise from protected verification. Jobs expose nested `job_sessions`/`job_requirements`. `set_job_status(p_job_id, p_status)` allows audited draft/published/archived transitions and refuses silent changes to filled work. `claim_job(p_job_id, p_idempotency_key, p_terms_version)` returns a truthful status and optional claim ID. `create_job(p_payload jsonb)` requires `jobs.manage` and AAL2 and creates the complete supported block atomically. Private events stay owner-only. Check backend notes for the final full payload, validation and result codes before adding callers.

Current routes include Auth, dashboard, jobs/detail, calendar, chats, files, knowledge, client/people/course and commercial screens. M6 adds `/topics`, `/availability`, `/notifications`, `/settings` and `/admin/audit`; M7 adds `/announcements` and `/admin/announcements`. The actual route definitions are in `src/app/app.tsx`; a route or navigation item is not evidence that the full target module is complete.

Feature flow: component → validated form/query/mutation → Supabase Auth/data API/RPC → permission/RLS + constraints → committed database records → query invalidation/refetch. Claims, messages and uploads show success only after server confirmation. A failed write never becomes a local confirmed allocation.

## ADR-003 — invitation-only Auth and granular capabilities

Production public signup is disabled. Supabase manages credentials, sessions, password recovery and invitation consumption. Privileged operations require a verified MFA assurance level, an active profile, and a database-managed capability; editable user metadata never grants authority. Users may have several explicit roles, mapped to granular permissions. Senior lecturers inherit no commercial access. Deactivation is checked at the API/database boundary rather than relying solely on JWT expiry.

User self-service edits must not change identity, verified qualification fields, role, capability, contract status or sensitive commercial data. Auth administration and invitation sending belong in tightly permissioned Edge Functions with server-only credentials, not browser administration APIs.

## ADR-004 — PostgreSQL owns claims and scheduling

The original M1 single-position API remains compatible. M6 adds explicit capacity 1–20 for new standalone per-position administrative offers. Existing offers, CBW run offers and client requests retain their capacity-one commercial meaning. `claim_job` still authenticates the current actor, checks qualifications, the applicable contract and current terms, locks the lecturer scheduling boundary and job, and allocates every session atomically. Confirmed claims are unique per job/lecturer, confirmed count cannot exceed capacity, and only unreleased intervals participate in the per-lecturer exclusion constraint. The final free position closes the offer. No UI drag operation confirms a booking.

Accepted compensation, currency, contract, sessions and revenue remain immutable history. `cancel_job_assignment` requires current management permission/MFA and an explicit reason, refuses started or invoiced work, releases the complete interval block and updates intended course-room membership. Cancellation closes the offer to `draft`; replacement requires the separate audited `manage_job_offer` reopen action. Existing other confirmed positions remain accepted. Invoice submission and cancellation share the lecturer mutex, preventing a late invoice from attaching to a concurrently cancelled claim. These operations record tracking/audit state, not bank refunds or transfers. See [JOB_LIFECYCLE](JOB_LIFECYCLE.md).

Private appointments and unavailable windows share the profile→lecturer advisory-lock boundary with assignment writes. Management sees only explicitly shared reduced availability metadata; neither availability sharing nor administrative role grants another person's private calendar. See [AVAILABILITY](AVAILABILITY.md).

Where privileged routines are unavoidable, implementation lives in a non-exposed private schema, with a fixed/empty search path, current-actor checks, no browser-supplied actor identity, narrow grants and reviewed public SECURITY INVOKER wrappers. Do not solve RLS problems with a blanket administrator bypass. Follow migration definitions for exact grants and locking order.

## Historical M1 schema boundary

The first migration contains 22 core RLS-enabled public tables: `profiles`, `user_roles`, `role_permissions`, `topics`, `lecturer_topics`, `organisations`, `course_templates`, `course_runs`, `course_sessions`, `jobs`, `job_sessions`, `job_requirements`, `contracts`, `job_claims`, `assignment_sessions`, `personal_events`, `global_events`, `notifications`, `claim_events`, `audit_events`, `chat_rooms`, `chat_members`. It separates own-only events/allocations and lecturer commercial records from management capabilities. Column grants exclude self-assigned activation, verification and accepted deal mutation.

At the M1 checkpoint, course-chat membership and committed notifications were infrastructure; later collaboration, contract PDF/receipt, directory/course and M6 lifecycle/capacity migrations extend that baseline. The original atomic job creation RPC creates organisation/template/run/session records for its block. Its historical one-slot/no-reopen limitation does not describe the current M6 implementation above. Broader substitute orchestration remains target work.

A second migration adds `invitation_requests` (23 exposed RLS-enabled tables in total) and scoped invitation reservation/completion RPCs. The browser-facing `invite-lecturer` Edge Function requires current Auth, `users.manage`, AAL2 and an approved exact origin. A durable database reservation precedes the external Auth email send; one email address is reserved across administrators, idempotency prevents repeat sends and each inviter is limited to five new reservations per fifteen minutes. The browser cannot choose a privileged role: completed invitations grant only `lecturer`. Completion is server-only. A send timeout/failure is held for manual reconciliation rather than automatically retried into duplicate emails. Actual local Edge/Auth/Mailpit delivery and idempotency have been verified separately from handler unit tests. The custom token-hash invitation callback, password setup, sign-out/new-password login and PKCE recovery were subsequently verified in actual local browser tests. The actual self-hosted CMS later passed captured invitation/password setup and PKCE recovery through private Mailpit. External SMTP deliverability remains unconfigured and untested.

A third migration adds `verify_lecturer_topic(p_user_id, p_topic_id, p_verified, p_valid_until)` and `set_user_active(p_user_id, p_active)` without adding an exposed table. Verification requires `qualifications.verify` plus AAL2, an active lecturer target and an existing self-selected topic; false clears expiry. It records a management attestation, not an uploaded-certificate assertion. Activation requires `users.manage` plus AAL2, protects self-deactivation/last active admin and serializes concurrent changes. Audit details retain the target, topic where relevant, old/new values and attestation basis. Browser table-column grants remain restricted; no direct verified/active writes are introduced.

## ADR-005 — resource-level privacy and files

Every exposed table has RLS plus explicit table/column/function grants. Profiles, role assignments, verification, jobs, claims and private events use distinct policies. Private events are owner-only even for an ordinary admin. DMs use active membership, not admin status. Course lecturer discussion and participant discussion are separate rooms. Search, realtime and storage must apply equivalent resource authorisation, including after revocation.

Storage is private by default. Authorised metadata precedes access; sensitive downloads pass through the authenticated Edge Function with a fresh metadata permission check before and after fetching bytes; the client receives no reusable signed Storage URL. Uploaded content stays quarantined until scanning succeeds. No uploads are considered production-complete until type/size/rate limits, scan processing, audit, retention and cross-user denial are tested. Database backups alone do not include Storage binaries.

## ADR-006 — time, money and content

Persist start/end as canonical `timestamptz` instants with the intended IANA time zone retained. End must follow start. A Berlin wall-clock time during a DST gap/overlap requires explicit disambiguation; display conversion must not assume a fixed UTC offset. Brisbane has no Berlin DST shift. The database compares actual instants for conflicts. Use localised UI formatting with an explicit display zone.

Money uses exact numeric amounts and original ISO currency, with an enumerated fee unit (`per_day`, `per_teaching_unit`, `per_hour`, `fixed_total`). Never silently convert EUR/AUD. An assignment preserves its accepted terms/rate/currency independently of editable future job offers. Authored text stays in its original language; UI translation does not purport to translate content.

## ADR-007 — PWA and deployment safety

Service-worker precache is limited to the public app shell and public brand assets. No runtime cache of authenticated API responses, contracts, messages, invoices or private files; online writes require server acknowledgement. Update handling must avoid losing unsaved forms and indicate when a new app version is available. Production requires HTTPS, correct manifest/icons and supported-platform install testing.

GitHub CI validates source and migrations; it does not automatically publish to production. Separate staging/production credentials, approved migrations/hosting changes, actual DB+storage backups, restore drill and rollback gate production. Deployment instructions are in [DEPLOYMENT_RUNBOOK.md](DEPLOYMENT_RUNBOOK.md).

## External configuration and present limits

The connected Supabase project inventory returned no projects on 15 November 2026. No hosted project, real user invitation, production deployment or Hostinger change has been made by this milestone's reconnaissance. Local Supabase/test infrastructure can validate the usable slice independently; local validation is not managed-staging, SMTP or production acceptance.

That paragraph describes the initial reconnaissance. Actual authorised self-hosted development, DNS and hosted acceptance on 16 November are recorded in [WORKLOG](WORKLOG.md); the existing free Cloud project is unused.

## ADR-008 — persistent local orchestration and disposable verification

The executable `./portal` is the sole complete local entry point. `start` supervises loopback Vite, local Supabase, Edge Functions, Mailpit and internal-network ClamAV. Locked migrations apply incrementally; insert-only fictional bootstrap never resets existing passwords, MFA, profiles or business data. Database/Auth/Storage and scanner signatures persist in Docker volumes through `stop`/`restart`. Local credentials and process state are private ignored files; PID/session ownership prevents stopping unrelated processes. See [LOCAL_DEVELOPMENT](LOCAL_DEVELOPMENT.md).

`./portal test` copies source without development credentials into a random disposable project, uses separate ports/volumes, and runs actual Auth/MFA/Storage persistence, SQL/RLS/concurrency, WebSocket/HTTP, Mailpit and browser/PWA checks. Cleanup targets only that random test project. CI runs the same command. Its later release job publishes only the explicitly authorised CMS development artifacts; production is separate.

## ADR-012 — user-requested self-hosting at Hostinger

The user explicitly replaced the managed-backend preference with a single-provider, self-hosted architecture. A pinned official Supabase Docker bundle supplies PostgreSQL/Auth/PostgREST/Storage/Realtime/Edge and its Envoy gateway on a private network; optional Studio/meta/analytics/pooler are omitted. Caddy serves the static React build at `cms.luminovia.org` and exposes only reviewed API routes under `/backend`. Private ClamAV TCP needs no additional application server. The optional authenticated HTTPS scanner adapter remains available in source but is not an active service here.

The current authorised environment is development on purchased KVM 1, with private Mailpit instead of real SMTP, fictional accounts and explicit small quotas. No paid capacity upgrade is authorised. Approximately 100 GB of documents and 15–25 members are future sizing requirements, not current load acceptance. RLS, granular capabilities/AAL2, immutable snapshots, atomic online claims, private messages and private calendar/file boundaries remain authoritative in the database.

The active database image is `supabase/postgres:17.12.0.000@sha256:8630950b489ecc70563300180287a98c192a4a48f5ae00b4febdaeea1abe85de`, measured as PostgreSQL 17.12 after a controlled same-major patch. The original vendor bundle and 17.6 pin remain historical provenance. A real off-site database/object backup passed original-image and 17.12-candidate restores with exact roles/grantors/options, RLS/counts/quotas and private object hashes; the candidate additionally matched all eleven stored migration SQL sources to repository files. Actual post-patch CMS Auth/MFA/PKCE/file/50-way-claim and WSS delivery/revocation checks passed separately. Stored and actual database ICU versions match 153.121; no collation rebuild was required. [Patch provenance](../deploy/hostinger/selfhost/postgres-upgrade-provenance.json) records the exact scope and limits.

The web service bind-mounts the stable `/opt/luminovia-portal/www` parent. Caddy reads the SPA shell from `/srv/current`, a symlink into `www/releases`, and immutable assets from shared `/srv/assets`; changing the release pointer preserves access for already loaded older clients. Private runtime configuration and PostgreSQL/Storage/Mailpit data are outside the web directory. `www/maintenance.enabled` reversibly makes the public API return 503; it is an operational control, not proof that internal writers are quiescent.

Use the official production self-hosted bundle, never the CLI development stack, for this hosted instance. Separate private server configuration from public frontend build settings, preserve keys during endpoint changes, keep backend ports unpublished and back up the database plus actual object files. Source/image provenance, concrete commands, executed acceptance and operational limits are maintained in [HOSTINGER_DEVELOPMENT](HOSTINGER_DEVELOPMENT.md).

## ADR-009 — collaboration and rich-content boundaries

Chat membership is the common authorisation predicate for room metadata, messages, reactions and room-scoped files. A removed member can observe only their own removal tombstone so the client clears the room, while Postgres Realtime rechecks message access for future events. Staff/lecturer and participant course rooms are distinct; administration grants no DM membership. Message idempotency prevents duplicate uncertain retries. See [CHAT_SECURITY](CHAT_SECURITY.md).

Wiki public snapshots are separate from private newer drafts; lists/search never expose unpublished revision bodies to other staff. Allowed editor JSON nodes/attributes/links are validated on both boundaries, with React rendering rather than authored HTML. Forum moderation requires its explicit capability/MFA; authors retain scoped edit rights. See [KNOWLEDGE_SECURITY](KNOWLEDGE_SECURITY.md).

## ADR-010 — immutable documents and commercial tracking

Uploads reserve immutable version metadata, undergo bounded MIME/magic validation and private quarantine, then actual ClamAV INSTREAM scanning. Only clean bytes are copied into the clean private bucket. Failure/outage remains unavailable. Old versions keep their hashes and exact bytes. A restrictive Storage policy blocks direct download/signing, including by an authenticated owner; Edge performs live authorisation. Each scope has its own predicate; room removal removes the uploader's access too. Course/job materials use room or pre/post-claim job scope. Existing soft deletion/archive checks remain authoritative; richer shared folders, expiry links and wiki attachments remain target work. Personal M7 organization below does not change those scopes.

Commercial records link exact clean PDF versions/hashes. Externally executed contracts and addenda are registered by an AAL2-capable manager; lecturer receipt is an immutable acknowledgement, never asserted to be a legal signature. Claim prerequisites serialize on the lecturer lock and select the applicable contract chain. Accepted terms stay immutable. Invoices derive amounts from owned accepted claims, retain original currencies, and support audited review/payment corrections. Linked legal/financial versions cannot be silently removed. This is compensation/invoice tracking, not accounting, payroll, tax or a bank integration.

## ADR-011 — account API, client tenancy and private commission

Individual identities use native Supabase Auth and current database roles. The versioned Account Edge façade validates real bearer identities and delegates business mutations to the caller-authenticated SQL API. Invitations alone use a server credential for Auth delivery/completion; the original lecturer endpoint delegates to the same durable reservation ledger. Administrative role/status mutations share one lock to protect the last active administrator. The generated [API reference](API_REFERENCE.md) is taken from actual migrated PostgreSQL metadata, and an automated surface check binds delivered frontend RPC names to executable SQL functions.

Client membership is explicit per active organisation and rechecked on every scoped request/report. Customer gross quotes, configurable platform percentages and immutable accepted gross/platform/net snapshots remain in the unexposed private schema. Lecturer-facing job, claim and invoice amounts remain lecturer compensation. Accepted historical net-only deals retain unknown gross, rather than guessed commission. Admin/owner receives full financial reporting with MFA; management retains its explicit net invoice/payment capabilities. See [commission boundaries](CLIENT_COMMISSION_SECURITY.md).

Separate profile-detail and review projections share only intentional authored biography/expertise/labels. Course history derives its phase from real confirmed assignment instants; links appear only when the viewer can open the course. Optional learners are enrolled by authorised management and may review a real assigned teacher only after recorded completion. Reviews use optimistic versions, identity-safe public projections and reasoned MFA moderation. Neither the administrator functional-role fallback nor profile access grants private DM/calendar membership. See [profile boundaries](PROFILES_REVIEWS.md).

## ADR-013 — verified automatic development releases

The user requested automatic GitHub updates without repeated cloning. Successful exact-main CI builds a public, immutable, content-hashed release; the VPS checks every five minutes and keeps its credentials/data locally. Installation pauses backend writers for a backup, preserves historical migration source and private configuration, applies eligible incremental SQL, and promotes a static release through the stable mounted parent. PostgreSQL major changes and unsafe/out-of-order migrations require operator review. OS security updates share a lock with application deployments. This is an authorised development release path, not automatic production publishing or uncontrolled dependency/engine upgrades. See [automatic update policy](HOSTINGER_AUTOMATIC_UPDATES.md).

## ADR-014 — reusable CBW provenance, teaching discussions and scoped avatars

CBW course content is a versioned source catalogue, not a set of duplicated job drafts. The reviewed JSON represents 24 originals under 22 canonical Kurzzeichen. Each source stores filename/hash/pages/dates; raw PDFs, source authors and machine-local paths are excluded. Course templates reference exact source versions; actual runs keep customer/delivery/session identity. New offers derive from locked existing resources and require the reviewed source revision. Stable source links freeze once a job exists, while a different edition uses a new template. Existing accepted monetary/term snapshots are unchanged.

Staff discussions use one resource-comment implementation for jobs and course templates. Job visibility is shared through private.can_read_job; authorised enrolled/client course access does not grant staff discussion. Text, author/version/idempotency, cursor limits, withdrawals and MFA moderation live in private rows/revisions. React renders literal text; a resource/actor switch resets unsent drafts. No comment rewrites accepted terms.

Profile pictures reuse clean immutable private document versions. The editor rasterises a bounded metadata-free PNG; the server independently validates its structure/dimensions and actual ClamAV result. A separate selected-avatar projection uses current person visibility, and the file gateway rechecks selection/access after retrieving bytes. Generic personal-document ACLs remain unchanged. Actor-bound Blob URLs are memory-only and revoked on identity/version/offline/unmount changes.

[Developer guide](DEVELOPER_GUIDE.md), [CBW details](CBW_TEMPLATES.md), [comment contract](RESOURCE_COMMENTS.md), [avatar boundary](PROFILE_AVATARS.md) and [functional audit](FUNCTIONAL_CODE_AUDIT.md) record the owning implementation and verification. Compiler-based source/export/RPC and documentation-link checks supplement actual SQL/API/browser tests; they do not replace runtime authorisation.

## ADR-015 — shared local QA ownership and bounded revalidation

All checkouts of this user/machine share fixed isolated test ports. A per-checkout marker cannot exclude another worktree, as an actual concurrent test demonstrated. Acquire a private kernel flock before snapshots/proxy/service work, retain its inode, then probe the fixed ports to refuse legacy/unrelated listeners. The kernel releases ownership on process exit; PID metadata is diagnostic. Linux util-linux is an explicit prerequisite. A forced termination can still leave services/local recovery state requiring ownership inspection.

Application data remain memory-only and actor-scoped. Settled files use bounded revalidation; active scans have a two-minute fast-check window. Exact avatar bytes are immutable by actor/target/version while selection/permission revalidation stays separate. Realtime hints batch for 150 ms and still fetch authorised rows; removal stays synchronous. A user-ID key on the protected Outlet clears local drafts on account switch while preserving same-actor refresh and public callback continuity. Full rationale/measurements: [SYSTEM_AUDIT](SYSTEM_AUDIT.md).

## ADR-016 — bounded M7 discovery and private saved state

Jobs and files now use authorized server-side cursor pages instead of treating the
Data API's first 1,000 rows as the complete catalogue. `job_discovery` accepts a
closed validated filter object, sort and filter-bound cursor; `document_discovery`
accepts its documented literal filters and timestamp/UUID cursor. Both return
`items`, `has_more` and `next_cursor`, with at most 100 rows per call. The job UI
requests 50; files request 40. Pages load on explicit demand, never by silently
collecting the full catalogue. Stable UUID tie-breaking covers equal timestamps
and prices. Each page rechecks current permissions; cursors are not frozen
multi-request database snapshots.

`job_detail` fetches one authorized UUID independently of list bounds.
`job_dashboard` supplies full authorized scalar counts plus at most two suggestions
and five own upcoming assignment rows. Counts do not come from a truncated preview.
`assignment_job_titles` resolves only requested own confirmed assignments, including
in an administrator's calendar; an empty assignment list starts no title query.
Pure client/learner screens do not issue lecturer discovery/dashboard queries.
Money bounds/sorting require an explicit currency; rate comparisons additionally
require a unit. Date filters use actual session overlap with local calendar-day
boundaries in the selected IANA zone. Availability filtering never reserves work
or replaces the online claim checks.

`private.document_organisation` stores each account's tags/virtual folder for an
accessible document. It changes no shared filename, bytes, Storage path or access
policy. `private.saved_job_views` stores at most 20 own named canonical filters.
`save_document_organisation`, `save_job_view` and `remove_job_view` use observed
versions, reject competing stale changes with `40001`, and derive the actor from
Auth. Saved-view creation uses version 0 and a stable operation UUID within the
same uncertain-response dialog; cancelling and opening a genuinely new dialog
creates a fresh UUID. An authoritative `42501` unmounts captured private view
content, including during an automatic query retry; an ordinary network error or
version conflict preserves the draft. Only a successful authorized refresh clears
the denial boundary. Nothing is persisted in browser storage.

Saved-view mutations first lock the actor profile `FOR SHARE`, then check current
activity/lecturer-or-management capability in a separate statement, then lock the
view row (save also takes its actor quota mutex). The entry points remain
`VOLATILE`, so a wait behind `set_account_roles`' profile `FOR UPDATE` observes the
committed role withdrawal before authorization. Saved views confer no broader job
or calendar access and have no administrator read exception. See
[JOB_DISCOVERY](JOB_DISCOVERY.md) and [FILES](FILES.md).

## ADR-017 — versioned mentions reuse existing chat authority

`messages.content_version` and private content/mention version rows bind structured
recipients to the current body. `send_message_with_mentions` and
`edit_message_with_mentions` commit the message, at most 20 current eligible room
members, optional notices and the exact actor/request ledger together. Edits use
an expected content version; plain legacy edits produce a new version without
retaining earlier structured recipients. The request ledger binds exact normalized
parameters and never appears in ordinary history or administrative audit.

`chat_mention_candidates` loads eligible members on demand;
`chat_messages_with_mentions` projects current authorized recipients and a
room-scoped moderation flag. Target profile/role locks precede room/member locks;
a private DM never becomes visible through a moderation role. The first ever
message/recipient mention may renew its one existing `chat_message` notice, even
if an ordinary notice was already read. Repeating, editing or remove/re-add does
not renew it again. Explicit mentions may override room mute, while the global
chat-category filter still applies. Quiet hours change attention counts only;
they do not suppress or defer notice persistence. Drag/drop uses the existing
clean-file gateway, with one upload and no send before scan confirmation. See
[CHAT](CHAT.md) and [CHAT_SECURITY](CHAT_SECURITY.md).

## ADR-018 — attention preferences and published announcement revisions

`private.attention_preferences` is separate from M6's four-category
`private.notification_preferences`. `attention_preferences` and
`save_attention_preferences` expose only the active caller's versioned daily
wall-clock window, including overnight and IANA/DST behavior. The existing
category RPC payload/version contract is unchanged. `notification_inbox` adds
`quiet_active` and, only while quiet, `attention_count`; `unread_count`, rows and
read state remain intact. Committed `claim_confirmed`, `claim_cancelled` and
`contract_available` receipts retain attention. Important announcement notices
also count while their exact publication remains currently readable. The shell
uses its existing 30-second inbox revalidation, not a new per-card timer or
notification transport. See [NOTIFICATIONS](NOTIFICATIONS.md).

Announcements separate mutable parent pointers from immutable draft revisions and
publication receipts. `manage_announcement` requires current
`announcements.manage`/MFA and an observed version; `save` cannot replace the
public snapshot. Explicit `publish` atomically commits the publication, optional
important-notice fanout, safe audit event and exact actor/request result. A future
start requires later manual publication; no scheduler is implemented.
`archive`/`recover` retain original publication and acknowledgement identities.
Ordinary `announcements` pages and exact `announcement` reads require an active
account, current database-role audience, current publication and live display
window. A new draft is never an ordinary-reader response.

`acknowledge_announcement` binds the caller to one published revision, returns the
same timestamp on exact retry and marks only that corresponding own inbox notice
read. A newly published revision requires its own acknowledgement. Management and
ACK writes take the actor profile lock before current role/MFA/audience checks,
then publication state locks. Important notices use revision UUID plus recipient
for deduplication; later audience joins can read a current publication without
retroactive fanout. Old/unavailable inbox targets are redacted on fresh reads.
Private bodies, role arrays and retry payloads are not public REST tables or
administrative audit details. See [ANNOUNCEMENTS](ANNOUNCEMENTS.md).

## Current scope and evidence boundaries

The 24 accepted M6 migrations remain unchanged. The five M7 additions are
`20261115230301_chat_structured_mentions`,
`20261115230604_file_discovery_personal_organisation`,
`20261115230702_job_discovery_and_saved_views`,
`20261115231704_notification_attention_preferences` and
`20261115232824_portal_announcements`. Their private tables use RLS and revoke
direct PUBLIC/anon/authenticated access. Public invoker wrappers call scoped
private implementations with empty search paths and explicit authenticated
execution grants; pure internal trigger/filter helpers revoke browser execution. Private routines
needed by public wrappers retain their own current-actor/resource checks. Service credentials remain server-only. [ERD](ERD.md) records physical
keys and exceptions rather than inferring grants from schema placement.

The old job picker used by file uploads and chat group creation remains on the
compatible bounded `jobsQuery`; complete paginated picker integration is pending.
The administrative job board honestly displays only the newest 500 offers. Global
search and other modules retain their own bounds; M7 does not raise the global
1,000-row setting. Scheduled publication/delivery, richer resource folders and
knowledge attachments, complete substitute orchestration, retention/erasure and
production-scale/platform acceptance remain product work. Existing authored M7
native Auth/API/browser scenarios require a complete canonical execution; focused
SQL/component passes and the earlier M6 acceptance do not establish that result.
Current actual outcomes belong in [QA_RESULTS](QA_RESULTS.md) and
[WORKLOG](WORKLOG.md).
