# Architecture and decisions

Status: M1/M2 locally accepted and merged; the approved M3 account/profile/commission extension passed complete isolated verification and was merged in PR #3. See QA_RESULTS for executed evidence. The complete product is specified in [PRODUCT_SPEC.md](PRODUCT_SPEC.md). Current primary documentation/version checks are in [REFERENCE_SOURCES.md](REFERENCE_SOURCES.md). Database-specific API/security notes are maintained in `BACKEND*.md` where present; migration SQL and actual tests own the schema truth. The authorised self-hosted KVM1 development instance is online at cms.luminovia.org; the combined M3/hosting source is being validated before automatic adoption. Full product and production acceptance remain outstanding.


## ADR-001 — separate private portal and static frontend

Use the existing `Luminovia-Training-Consulting/Luminovia-Management-Tool` repository. The public `Website` is solely a brand reference. React/TypeScript/Vite supplies the static SPA; no independent Node/Express application service is required. The original 15 November hosting decision used managed Supabase and reserved Docker/Supabase CLI for development. That hosting decision is historical: the user subsequently authorised the official Supabase Docker distribution on the Hostinger VPS as described in ADR-012.

**Hosting superseded on 16 November:** the user explicitly chose complete Supabase self-hosting at Hostinger. ADR-012 and [HOSTINGER_DEVELOPMENT](HOSTINGER_DEVELOPMENT.md) own the actual deployment; the security and static-frontend decisions remain applicable.

## ADR-002 — source-of-truth and feature boundaries

TanStack Query manages remote state through `@supabase/supabase-js`; no duplicated browser database or fake-auth runtime. React Router protects private screens and preserves deep links, while RLS/API checks remain authoritative. React Hook Form and Zod validate forms accessibly; database constraints revalidate security-critical data. i18next/react-i18next provide German/English text; browser locale/theme preferences may be persisted, private records may not. Tailwind/shadcn primitives and Lucide icons use verified brand tokens. FullCalendar owns calendar rendering; future permissioned Kanban uses dnd-kit. Wiki/forum use Tiptap with a strict stored/rendered JSON whitelist and code-block language highlighting.

M1 public API contract (subject to migration ownership): `get_my_permissions()` returns capability names; own `profiles` uses `id`, `display_name`, `bio_de`, `bio_en`, `phone`, `time_zone`, `locale`, `active` with restricted self-edit fields. `topics` and `lecturer_topics` distinguish self-selected expertise from protected verification. Jobs expose nested `job_sessions`/`job_requirements`. `set_job_status(p_job_id, p_status)` allows audited draft/published/archived transitions and refuses silent changes to filled work. `claim_job(p_job_id, p_idempotency_key, p_terms_version)` returns a truthful status and optional claim ID. `create_job(p_payload jsonb)` requires `jobs.manage` and AAL2 and creates the complete supported block atomically. Private events stay owner-only. Check backend notes for the final full payload, validation and result codes before adding callers.

Current routes: `/login`, `/auth/callback`, `/auth/password`, `/`, `/jobs`, `/jobs/:id`, `/calendar`, `/profile`, `/security`, `/admin`, `/admin/people`, `/chats`, `/files`, `/wiki`, `/forum`, `/clients`, `/courses`, `/contracts`, `/finance`, `/search`. The plan distinguishes their implemented slices from outstanding target requirements.

Feature flow: component → validated form/query/mutation → Supabase Auth/data API/RPC → permission/RLS + constraints → committed database records → query invalidation/refetch. Claims, messages and uploads show success only after server confirmation. A failed write never becomes a local confirmed allocation.

## ADR-003 — invitation-only Auth and granular capabilities

Production public signup is disabled. Supabase manages credentials, sessions, password recovery and invitation consumption. Privileged operations require a verified MFA assurance level, an active profile, and a database-managed capability; editable user metadata never grants authority. Users may have several explicit roles, mapped to granular permissions. Senior lecturers inherit no commercial access. Deactivation is checked at the API/database boundary rather than relying solely on JWT expiry.

User self-service edits must not change identity, verified qualification fields, role, capability, contract status or sensitive commercial data. Auth administration and invitation sending belong in tightly permissioned Edge Functions with server-only credentials, not browser administration APIs.

## ADR-004 — PostgreSQL owns claims and scheduling

M1 deliberately implements one available slot per job. A claim transaction authenticates the current actor, checks active eligibility and accepted terms/version, locks the job and the actor's scheduling boundary, rejects deadlines/filled jobs/missing qualifications or contract prerequisites, and detects conflicts across every offered session. It writes the complete claim, all session allocations, immutable compensation/currency/terms snapshot, audit event and deduplicated committed notification atomically. Database uniqueness/exclusion constraints defend against concurrent requests independent of the UI. Retry keys identify the same actor/job request; retries must not duplicate allocations or notifications.

Never use a Kanban status update as an allocation API. Publishing/editing future offers may not rewrite a previously accepted snapshot. Cancellation, substitutes, reopening, capacity expansion and accepted-work changes require explicit audited workflows before being enabled.

Where privileged routines are unavoidable, implementation lives in a non-exposed private schema, with a fixed/empty search path, current-actor checks, no browser-supplied actor identity, narrow grants and reviewed public SECURITY INVOKER wrappers. Do not solve RLS problems with a blanket administrator bypass. Follow migration definitions for exact grants and locking order.

## M1 implemented schema boundary

The first migration contains 22 core RLS-enabled public tables: `profiles`, `user_roles`, `role_permissions`, `topics`, `lecturer_topics`, `organisations`, `course_templates`, `course_runs`, `course_sessions`, `jobs`, `job_sessions`, `job_requirements`, `contracts`, `job_claims`, `assignment_sessions`, `personal_events`, `global_events`, `notifications`, `claim_events`, `audit_events`, `chat_rooms`, `chat_members`. It separates own-only events/allocations and lecturer commercial records from management capabilities. Column grants exclude self-assigned activation, verification and accepted deal mutation.

Course-chat membership and committed claim notifications are infrastructure; messaging/inbox completion is separate. Contract rows support prerequisite/version lookup but do not implement executed-document storage/hash/acceptance. The atomic job creation RPC creates organisation/template/run/session records for that block; independent full directory/course CRUD remains required. M1 refuses silent reopening of filled work; cancellation, substitutes and multi-slot capacity remain pending.

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

Uploads reserve immutable version metadata, undergo bounded MIME/magic validation and private quarantine, then actual ClamAV INSTREAM scanning. Only clean bytes are copied into the clean private bucket. Failure/outage remains unavailable. Old versions keep their hashes and exact bytes. A restrictive Storage policy blocks direct download/signing, including by an authenticated owner; Edge performs live authorisation. Each scope has its own predicate; room removal removes the uploader's access too. Course/job materials use room or pre/post-claim job scope. Archives, expiry links and wiki attachments remain pending, rather than weakening private-file access.

Commercial records link exact clean PDF versions/hashes. Externally executed contracts and addenda are registered by an AAL2-capable manager; lecturer receipt is an immutable acknowledgement, never asserted to be a legal signature. Claim prerequisites serialize on the lecturer lock and select the applicable contract chain. Accepted terms stay immutable. Invoices derive amounts from owned accepted claims, retain original currencies, and support audited review/payment corrections. Linked legal/financial versions cannot be silently removed. This is compensation/invoice tracking, not accounting, payroll, tax or a bank integration.

## ADR-011 — account API, client tenancy and private commission

Individual identities use native Supabase Auth and current database roles. The versioned Account Edge façade validates real bearer identities and delegates business mutations to the caller-authenticated SQL API. Invitations alone use a server credential for Auth delivery/completion; the original lecturer endpoint delegates to the same durable reservation ledger. Administrative role/status mutations share one lock to protect the last active administrator. The generated [API reference](API_REFERENCE.md) is taken from actual migrated PostgreSQL metadata, and an automated surface check binds delivered frontend RPC names to executable SQL functions.

Client membership is explicit per active organisation and rechecked on every scoped request/report. Customer gross quotes, configurable platform percentages and immutable accepted gross/platform/net snapshots remain in the unexposed private schema. Lecturer-facing job, claim and invoice amounts remain lecturer compensation. Accepted historical net-only deals retain unknown gross, rather than guessed commission. Admin/owner receives full financial reporting with MFA; management retains its explicit net invoice/payment capabilities. See [commission boundaries](CLIENT_COMMISSION_SECURITY.md).

Separate profile-detail and review projections share only intentional authored biography/expertise/labels. Course history derives its phase from real confirmed assignment instants; links appear only when the viewer can open the course. Optional learners are enrolled by authorised management and may review a real assigned teacher only after recorded completion. Reviews use optimistic versions, identity-safe public projections and reasoned MFA moderation. Neither the administrator functional-role fallback nor profile access grants private DM/calendar membership. See [profile boundaries](PROFILES_REVIEWS.md).

## ADR-013 — verified automatic development releases

The user requested automatic GitHub updates without repeated cloning. Successful exact-main CI builds a public, immutable, content-hashed release; the VPS checks every five minutes and keeps its credentials/data locally. Installation pauses backend writers for a backup, preserves historical migration source and private configuration, applies eligible incremental SQL, and promotes a static release through the stable mounted parent. PostgreSQL major changes and unsafe/out-of-order migrations require operator review. OS security updates share a lock with application deployments. This is an authorised development release path, not automatic production publishing or uncontrolled dependency/engine upgrades. See [automatic update policy](HOSTINGER_AUTOMATIC_UPDATES.md).
