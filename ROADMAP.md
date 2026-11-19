# Luminovia Portal — Complete Roadmap

**Repository:** [Luminovia Management Tool](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool) · **Existing roadmap on GitHub:** [ROADMAP.md](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/blob/main/ROADMAP.md) · **Source:** `Changes CMS Plattform(1).txt` and the subsequent explicit Premium LMS decisions.

**Single-file edition:** This document is designed to replace `ROADMAP.md` directly and contains the complete roadmap: current-source coverage, all requested general changes, complete Premium LMS scope, acceptance tests, release gates and AI-agent guidance. No second roadmap or external Premium specification is required.

**Planning baseline:** 19 November 2026 · **Desired real-user launch:** Tuesday, 1 December 2026 · **Status:** proposed roadmap update, **not** evidence of implementation, CI success or production approval.

**Authority and reading order:** Read the current implementation and tests, then the [product specification](PRODUCT.md), [original product brief](PRODUCT_BRIEF.txt), [operational extension](OPERATIONS_BRIEF.txt), and the **complete requested feature backlog (Section 9)** and **Premium LMS specification (Section 8)** included below in this same file. The latest explicit product decisions **in Sections 8 and 9 of this document** supersede contradictory older product targets once adopted and implemented; older descriptions of current source behaviour remain historical evidence, not an implementation of the new target. Keep historical product decisions in their original records; update the current summary rather than silently rewriting history. Development evidence belongs in `docs/WORKLOG.md` and relevant QA/PR artifacts.

This roadmap **distinguishes source that already exists from requested work and required acceptance**. Never mark a feature complete only because an implementation file, migration or test is present. The existing `cms.luminovia.org` Hostinger KVM deployment is documented as development; a successful development release is not a production sign-off.

## 1. Product direction and non-negotiable decisions

- One self-hosted, bilingual (German/English), responsive, accessible training-management platform for `admin`, `management`, `senior_lecturer`, `lecturer`, `client` and **re-enabled participant-only** accounts, with protected `owner`/`guest` semantics where applicable.
- Preserve all existing contract, financial, course, chat, Auth, Storage and audit data; no reset, destructive reseed or `docker compose down -v` on populated instances. Released migrations are byte-immutable; new changes use additive forward migrations and reviewed data changes.
- **Premium LMS is an organisation-scoped entitlement, default OFF. Only an actual `admin` account may turn it ON or OFF.** A red/green, text-labelled switch in company administration requires a confirmation on both operations and records an immutable audit event. `management`, lecturers and companies cannot change it. Existing data remain stored on OFF.
- ON enables that company's participant-only accounts and enrolments, scoped course workspace/chat/files/exam/attendance/learning functions and notifications. OFF hides them and denies their API, Realtime, file-byte and cached access **for that company**, not for other companies linked to the same participant.
- Every existing and future user keeps their immutable Auth UUID and also receives a stable, non-enumerable **Luminovia User ID** for authorised reference/linking. A company may create/invite or link **only participant-only users** with verified association. Multi-company membership is supported without privilege changes.
- Admin can inspect **all Premium LMS company/course business content**, including course group chats, files, exam documents, day-by-day attendance and retained history, with audit; existing private DMs, personal notes/calendars and credentials retain distinct privacy boundaries.
- A lecturer and an authorised company may both configure whether a Premium course requires an exam. Clean student-facing exam PDFs become visible to enrolled learners immediately after successful upload/scanning **when exams are enabled**. With exams disabled, participants have no exam area or direct file access; retained documents/answer keys remain protected.
- Attendance is recorded per course session/day and participant (`present`, `absent`, `excused`, optional arrival time/notes) and/or attached as scanned evidence. Only authorised lecturer/company/staff can view the class register; participants cannot see it.
- Reuse current authoritative course workspace, `participant_course` chats, file scanner, account facade, existing attendance and learning modules. Re-enable retired participant-only access deliberately; never build duplicate competing systems.

## 2. Source coverage and planned change areas

The following summary preserves the A–N structure of the original roadmap while adding the new Premium LMS areas. **Existing source** means components were found/documented in the repository, not that the new requirements have passed complete acceptance.

| Area | Existing source/reference | Remaining scope and acceptance |
|---|---|---|
| A — Dashboard/navigation | Role-aware shell, personalised dashboards, Teaching Day, search | FC-01–13: unified demo appearance, improved dark theme, accessible layout fixes, role-specific Courses and preview modes, practical calendar menu |
| B — Accounts/profiles | Auth, invitation/account facade, roles, profile/expertise and qualification evidence | FC-16–20, FC-24: 8-char minimum, admin-only elevated role assignment, self-selected expertise, stable public User IDs, secure participant-only account reinstatement |
| C — Taxonomy | DE/EN topic hierarchy and permissioned catalogue | FC-18–19, FC-25: directly selectable competencies and multi-checkbox job filters; retain explicit verified-qualification gate where mandatory |
| D — Organisations | Organisation membership, contacts, company requests, scoped workspaces | FC-20, FC-38–44: fictional demo companies; per-company Premium, verified participant linking, multiple-company membership, company-created participant-only accounts |
| E — Courses/workspaces | Course runs/sessions, readiness, private course workspaces, learning materials | FC-11, FC-32, FC-44, FC-47: role-specific courses, welcome content, participant dashboard, safe return of participant access |
| F — Jobs/claims | Atomic claim/offer lifecycle, waitlists, replacements, scoped pricing | FC-14–15, FC-25–30: lecturer rates, priority/sort/filter, visibility after claim/reopen, qualified notices, retained history and permission tests |
| G — Calendar | Own/private events, global publication, ICS/feed, offline schedule | FC-06–07, FC-12, FC-31: fix layout collisions, collapse tools, customer-source light colours, own colour preferences |
| H — Chat/collaboration | Direct and group rooms, lecturer/participant course room types, realtime, moderation | FC-08, FC-45, FC-53: automatically scoped learner/course rooms, admin LMS-group visibility, revocation on Premium OFF, private DM separation |
| I — Files/documents | Scan/quarantine, exact versions, restricted bytes, course resources | FC-09, FC-21–22, FC-46, FC-48, FC-51: contract drag/drop, staff contract upload, course file ownership, exam/attendance evidence, Premium byte enforcement |
| J — Contracts | Signed-PDF contract evidence, version/receipt, job prerequisite | FC-21–22: select/upload contracts on behalf of lecturer with auditable registration; legal confirmation remains distinct from signature |
| K — Knowledge/help | Wiki, forum, search, authorised sharing | FC-08: forum links within Chats and Knowledge & Help, consistent role-based discovery |
| L — Finance | Individual lecturer compensation, original-currency accepted fees, invoices/payments, timesheets/forecast | FC-33–37: scoped analytics; post-course invoice gate; PDFs, due-date/colour status and payment recording; no bank transfer or tax engine |
| M — Notifications | Own inbox, transactional delivery, quiet hours, optional Push | FC-23, FC-26, FC-53: secure SMTP/IMAP settings, re-opened job notices, Premium-aware delivery/revocation and real provider acceptance |
| N — Administration/operations | Permissions, account/role tools, audit, Control Center, migration, backup, updater | FC-10, FC-13, FC-17, FC-23, FC-38–40, FC-55–58: admin-only toggle with confirmation and audit; UI role previews, current green CI, production readiness |
| O — Premium LMS / participants **NEW** | Historical learner workspace/rooms/attendance source exists; participant-only role intentionally retired in current baseline | **LMS-01–LMS-07, LMS-10:** safe participant reinstatement, global public IDs, multi-company memberships, admin-only company flag, invitations, enrolments, dashboard, welcome content, chat/files and server-wide gating |
| P — Exams, daily attendance and learning **NEW** | Existing quiz/completion, document and attendance building blocks | **LMS-08–LMS-09:** exam-required switch, instant clean PDF publication, staff-only answer keys, per-session attendance, notes/arrival times, scanned/uploaded rosters, authorised company reporting |
| Q — QA, deployment and release **NEW** | GitHub required checks, isolated tests, migration controller, Hostinger dev updater and backups | **LMS-11, FC-55–58:** exhaustive automated and manual acceptance, retained-data migration rehearsal, real SMTP/backup restore, current-main green CI and separate production approval |

The earlier unfinished **formal change-request/contract-amendment workflow**, validated accounting interoperability (including applicable electronic invoice formats) and public Website-to-Portal enquiry integration remain on the roadmap. Existing work on client requests, CSV and lifecycle actions does not independently complete them. Do not silently remove these requirements.

### Continuity with the original GitHub roadmap

The original `ROADMAP.md` tracks source coverage and remaining work in modules A–N. The A–N mapping above carries those areas forward and adds Premium-specific workstreams O–Q. The existing source milestones below are **historical source claims from the original roadmap**, not assertions that the latest requested features now work:

- [x] Local owned preview administrator and interruption-safe bootstrap prepared without resetting existing passwords.
- [x] Automatic **development CMS** release publication prepared with exact-main application/security CI gates and a manual exact-SHA alternative; existing VPS migration/backup/recovery guards retained.
- [ ] Complete current-head local and CI acceptance, observe real browser login, and verify the actual five-minute Hostinger development updater and installed revision.

The original roadmap also retains **formal assignment change requests/amendments, validated accounting/electronic-invoice interoperability, and public Website-to-Portal enquiry connection** as unfinished work. Do not mark those complete merely because adjacent lifecycle, CSV or portal-side request features already exist. Maintain the original's privacy/processor review, off-site backup/recovery acceptance, supported browsers, calendar/Push tests and production approval boundaries.

## 3. Workstreams and dependencies

### R0 — Reconcile scope and verify source baseline (`P0`, first)

- [ ] Record exact current `main` commit, open PR overlap, CI status, current self-host installation revision, migration inventory and relevant security findings without changing live data.
- [ ] Reconcile `PRODUCT.md`, `ROADMAP.md`, `AGENTS.md`, guides, account/role model and tests against the renewed **participant-only** decision; make ownership of legacy features explicit.
- [ ] Map each FC-01–FC-58 and LMS-01–LMS-11 to existing code, required delta, tests, responsible branch/PR and source status (`present`, `partial`, `missing`, `blocked`, `accepted`).
- [ ] Preserve current working repository functionality; no broad rewrite, history overwrite or duplicate subsystem.

### R1 — Production-critical platform and finance (`P0`, before any real-user launch)

- [ ] FC-14–17: individual lecturer compensation, differentiated roles, 8-character minimum, safe account controls and strict elevated-role delegation.
- [ ] FC-19, FC-22–24: verified-qualification separation, controlled contract upload on behalf, secure outbound mail settings, IDs for all users.
- [ ] FC-26, FC-28–29: reopening/reassignment of jobs with notifications, atomic one-winner claim, correct assigned/company/management views.
- [ ] FC-34–35: invoices only after course completion (according to explicit business rules), confirmed PDF ownership, management review and real payment-record statuses.
- [ ] FC-04–07: no blocked workflows or overlapping essential controls at supported mobile and desktop sizes.
- [ ] FC-55–57: existing required GitHub CI/security checks, full persistence/migrations/backup/recovery and actual scoped customer privacy tested.
- [ ] Activate and prove real authorised transactional email on the intended production target; staging Mailpit does not count as external delivery.

### R2 — General product/UX completion (`P1/P2`, parallel, but without jeopardising P0)

- [ ] FC-01–03, FC-08–13: website footer translation (separate approval), coherent demo/dark design, references to Forum/Contracts, role-specific Courses and safe preview switch.
- [ ] FC-18, FC-20–21: expertise UX, fictional demo customers on **development-only** bootstrap, direct contract file picker/drag-drop.
- [ ] FC-25, FC-27, FC-30–33: accessible topic filters, chronological jobs, archive toggles, customer calendar colours, role-scope course sections and finance trends.
- [ ] FC-36–37: default 30-day payment term, true due-date sorting and accessible green/amber/red/purple status logic.
- [ ] Validate every page in DE/EN, both themes, keyboard, 390/768/1280/1920px, Safari/Firefox where required and installed PWA behaviour.

### R3 — Premium LMS foundation (`P1`, blocking any Premium customer activation)

- [ ] **LMS-01:** re-enable participant-only Auth/role, invitation, route and database permissions without exposing the operational lecturer/admin portal.
- [ ] **LMS-02:** add human-readable IDs to all existing/future users; build secure multi-company participant relationship and verified association flow. Companies create/link only participant-only accounts.
- [ ] **LMS-03:** add organisation Premium default-OFF flag, admin-only red/green accessible switch, explicit confirmation for ON/OFF, audited CAS transaction, required server-side enforcement. Management can see but cannot toggle.
- [ ] **LMS-04:** company participant directory, invitation/create/link by User ID, company-scoped enrolments/removals and multi-company rules.
- [ ] Confirm OFF blocks **UI + API/RLS + Storage bytes + WebSockets + notifications + old links + caches** for the company while retaining records and other-company access.

### R4 — Premium LMS course experience and collaboration (`P1`, after R3)

- [ ] **LMS-05:** participant dashboard, current/upcoming/completed courses, assigned lecturer, dates, online location, versioned Welcome Content Management, published course info and permitted learning materials.
- [ ] **LMS-06:** automatic course-room participant/lecturer membership, realtime message delivery and revocation, notifications, file uploads/downloads and company/staff visibility; preserve private-DM boundary.
- [ ] **LMS-07:** separate company-controlled course materials from lecturer/participant contributions; safe delete/replace/version/scanning, exact byte access and admin LMS review.
- [ ] Reuse existing quiz, feedback, completion and course-workspace code under the new organisation entitlement instead of building independent duplicates.

### R5 — Premium LMS exams and attendance (`P1`, after R3–R4)

- [ ] **LMS-08:** lecturer **and** authorised company may set `Exam required / No exam required`; exam window hidden for learners when not required, with direct API denial. Clean public exam PDFs uploaded by either become immediately student-visible when required. Staff solutions never auto-publish; all versions retained.
- [ ] **LMS-09:** one course-session/day attendance record per enrolled student, `present/absent/excused`, optional arrival/departure and note; staff/company can view and edit, participants cannot see the class register.
- [ ] Allow scanned PDF attendance evidence and, where offered, previewed/validated CSV/XLSX import; preserve audit/corrections and exact-file permissions.
- [ ] Check exam/attendance UI and storage disappear to an OFF company without deleting existing history, and reappear only to permitted actors when ON.

### R6 — Integrated acceptance and release (`P0 for real users; P1-specific gates for Premium ON`)

- [ ] **LMS-10–LMS-11:** complete DE/EN, security, permissions, migration, API, file, chat, notification, unit, component, SQL/RLS, integration and browser test matrix in Section 8.12 (Premium LMS test matrix below).
- [ ] Execute retained-data upgrade on a restored fixture including old user UUIDs, contracts, payment snapshots, chat, invoices and actual Storage bytes; test full Premium OFF→ON→OFF→ON behaviour for two companies sharing one participant.
- [ ] Require all current required **application + security CI checks green on the exact release commit**; no red, skipped critical jobs, waived permissions, stale status or silently accepted failed UI test.
- [ ] Verify on Hostinger the precise deployed revision, health checks, backup freshness, isolated recovery, migrations, external SMTP, monitoring, file scanner and supported clients. Do not assume automatic development publication is production.
- [ ] Record an explicit **go/no-go** and rollback/incident plan before real user onboarding. If Premium acceptance is incomplete, it **must remain OFF**; releasing a core-only product requires a conscious scope decision rather than claiming the LMS delivered.

## 4. Test coverage required for every planned feature

| Layer | Minimum evidence |
|---|---|
| Unit and component | Business logic, switches, validation, dates, role-specific layouts and interaction state |
| PostgreSQL/RLS | Exact permissions, cross-company isolation, concurrency/idempotency, immutable accepted contract/financial snapshots |
| HTTP/API/Auth | Real authenticated sessions, account invitations/role restrictions, boundaries for premium OFF, state conflicts |
| Storage/malware | Actual clean/quarantined/invalid files, exact version and bytes, forbidden downloads, controlled ownership |
| Realtime/notifications | Course chat membership revocation, no stale delivery, no duplicate email/Push after changed state |
| Browser E2E | Lecturer/company/participant/management/admin/outsider journeys, desktop and mobile, DE/EN |
| Accessibility and visual | Keyboard, screen reader labels, switch has colour **and** state text, contrast, spacing and responsive layout |
| Migration/persistence | Additive migration replay protection; restart and retained accounts, sessions, documents, payments, memberships |
| Operational | Current-main CI green, immutable release identity, actual Hostinger installation, rollback limits and verified backup restore |

**Mandatory Premium test IDs:** LMS-T01–LMS-T34 in **Section 8.12 below**. These are not optional merely because historical code contains a learner workspace. Add relevant tests to the repository's **existing** canonical test commands/protected CI rules; avoid separate test scripts that CI never runs.

## 5. Launch planning — target 1 December 2026 (conditional)

| Proposed window (Brisbane time) | Goal | Exit gate |
|---|---|---|
| **19–23 Nov** | Source audit, reconcile participant role decision, R1 P0 fixes and high-risk LMS foundation | Reviewable PRs, tests for changed surfaces |
| **24–26 Nov** | R2 and R3–R5 implementation as capacity permits; integration with current modules | Core and Premium test matrix run against changed source |
| **27–28 Nov** | Feature freeze, restored-data migration rehearsal and staging/browser validation | No unresolved P0; no unreviewed destructive migration |
| **29–30 Nov** | Final security/privacy/email/backup review and exact-commit full CI | Formal production go/no-go and evidence record |
| **Tue 1 Dec** | Desired production release/onboarding, only if independently approved | Verified target, actual deployment health and monitoring; Premium enabled only after its own all-green acceptance |

The target is ambitious given the reintroduced participant scope. Treat dates as **planning targets**, not approval to bypass CI or deploy untested learner features.

## 6. Deferred and adjacent roadmap (remain visible)

- Formal change requests and immutable commercial amendments to accepted assignments, with multi-party approval and conflict-safe application.
- Validated accounting exports/interoperability, where legally appropriate XRechnung/ZUGFeRD, without pretending to be a tax engine or banking system.
- Authorised public-website enquiry transport into the portal, anti-abuse controls and separate marketing-site deployment approval.
- Richer global calendar invitations and external provider/device acceptance; additional company reporting and forecasting after baseline correctness.
- Optional future LMS: online exam submission/grading, question banks, certificates beyond existing verified completion documents and richer learning content. **Not included solely by uploading exam PDFs.**
- Complete business privacy/retention/erasure procedures, off-site backup retention and realistic production-capacity acceptance before scale-up.

## 7. Completion policy

For every roadmap item record `feature ID`, `owner/PR`, `source locations`, `migration IDs`, `unit/DB/API/E2E test IDs`, `evidence commit`, `last passing CI`, `actual hosted acceptance`, `open risks` and `done/blocked` outcome in the existing worklog/PR process. Update this roadmap only after evidence. A green local test does not imply Hostinger is updated; a healthy development CMS does not imply production legal/security/operational acceptance.

**Release principle:** preserve real data, verify the exact deployable version, isolate every company/role correctly, and never enable the Premium LMS switch for a company until its functionality and full permission boundaries have passed all relevant tests.

---

## 8. Premium LMS — Full functional and technical scope

**Status:** Proposed specification for implementation and review (19 November 2026)
**Owner decision:** This specification supersedes the earlier decision to retire participant-only accounts, but only after the change is deliberately implemented and tested. It is not evidence of completed functionality or permission to deploy to production.
**Repository:** `Luminovia-Training-Consulting/Luminovia-Management-Tool`
**Related existing repository documents:** `PRODUCT.md`, `OPERATIONS.md`, `AGENTS.md`. **This same roadmap** contains detailed LMS acceptance tests in Section 8 and the full platform change/test list in Section 9.

### 8.1. Product objective and scope

Luminovia is a unified training-management and learning platform for administrators, management, companies, freelance lecturers and course participants. The **Premium LMS / Course Participation** entitlement is controlled **per company**. When enabled it unlocks that company's participant accounts and enrolments, participant-facing learning workspaces, course group chats, shared learning files, examinations, session-by-session attendance and associated notifications. When disabled, these features are **hidden and denied at the backend for that company**, with all existing data retained for later reactivation and authorised administration review.

The ordinary platform remains available when Premium is off: company requests, internal course and assignment management, lecturers, contracts, invoices, and appropriately scoped customer information. Premium must not change existing accepted fees, staffing assignments or contract terms.

**Re-use before building:** Inspect the existing course workspace (`src/features/learning/`), course/chat membership and room types (`src/features/chat/`), course document and malware-scanning gateways, course attendance and quiz/completion source, accounts/organisations, RLS and notifications. Some learner functionality exists in source but participant-only accounts and enrolment were subsequently retired. Restore/extend the existing authoritative modules; do not create duplicate chat, learner, file, attendance or user tables merely to implement this request.

### 8.2. Identity: one user, stable ID, multiple companies

1. Every account (`owner`, `admin`, `management`, `senior_lecturer`, `lecturer`, `client`, `participant`, `guest`) retains its existing immutable internal Auth/profile UUID. Do not replace existing primary or foreign keys.
2. Give **every account** a stable unique human-readable **Luminovia User ID** for support and authorised linking; issue it at account creation and backfill existing accounts without changing their UUIDs. Use an unguessable public identifier (for example, a generated alphanumeric code), not a sequentially enumerable ID granting access. The user can see/copy their own ID; administrators can search by it within their permissions.
3. A participant may belong to multiple companies through a separate `organisation_participant_memberships` relationship. Company membership is not an Auth role and does not transfer ownership of the global account. Company-specific participant/reference numbers may optionally coexist and must be unique **within that company**.
4. Companies may **create/invite only participant-only accounts** and link an existing account **only if its actual role is eligible for participant membership**. A company cannot invite or link an administrator, management account, lecturer, customer administrator or other privileged user as a participant by typing an ID. No role promotion/demotion is permitted through this workflow.
5. Linking an existing ID requires an invitation/acceptance or another verified association step. Do not expose names, email addresses, affiliation or account-existence information through unrestricted ID lookups. Prevent guessing, brute-force association and duplicate active memberships.
6. Accounts are provisioned through approved invitations/password setup, not emailed plaintext passwords. Track `invited`, `pending`, `active`, `revoked` status, audit actor and company/course relationship. Reactivation does not recreate or duplicate the account.
7. If a participant belongs to Company A (Premium off) and Company B (Premium on), access to A's LMS is removed immediately while B's permitted course access remains fully functional. If no enabled membership remains, show an appropriate empty/unavailable participant view without deleting the user or data.

### 8.3. Premium entitlement: strictly admin-only switch

**Location:** Administration > Companies / Organisations > [Company] > Premium LMS.

- Per-company persisted flag: `premium_lms_enabled`, default **false**, with `updated_at`, `updated_by`, version and audit trail. The flag is enforced by the server, not inferred from frontend display state.
- Visual switch: **green = enabled, red = disabled**, *also* clearly labelled `Enabled / Disabled` (DE: `Aktiv / Deaktiviert`) with an accessible switch role, text and keyboard interaction. Colour alone is insufficient.
- **Only an authenticated, active account holding the `admin` role may change the entitlement.** `management`, `owner` without explicit `admin`, `client`, lecturers and participants cannot activate/deactivate it. If the application's protected-owner model requires special handling, document and test it; do not silently widen the role gate.
- On **enable**, show a confirmation with company name, features activated and effective scope. On **disable**, show a confirmation warning that participant workspaces, course chats, shared LMS files, exam panels, attendance functions and LMS notifications will become unavailable for this company, while records are retained. Show the count of affected memberships/courses when reliably available. Require explicit confirmation for **both directions**.
- On the server, use a version-checked update (CAS or equivalent) with conflict handling, an atomic transaction, audit log and idempotent retry semantics. Never optimistically report success before the server confirms. Display a clear message if changed concurrently.
- Management may view status and manage course-level features for companies whose Premium is enabled, but may **not** change the Premium flag via UI, RPC, direct table write or service endpoint.
- The same switch governs **every Premium LMS feature**, including hidden routes, search, participant linking/invitations, course enrolment, chat membership and WebSockets, course resources and exact file downloads, exams, attendance UI/API, notifications, and offline/client caches. Do not create independent ungated paths.

#### Behaviour matrix

| Capability | Company Premium ON | Company Premium OFF |
|---|---|---|
| Ordinary company operations / jobs / finance | Unchanged base permissions | Unchanged base permissions |
| Company participant management, linking, invitations | Enabled for authorised company users | Hidden and API denied |
| Participant access to this company's courses | Authorised enrolled courses only | Hidden and API denied |
| Course group chat / real-time delivery | Enabled for enrolled members and authorised staff | Hidden; active channel access revoked and new delivery denied |
| Course learning files, downloads and participant uploads | Enabled with exact file permissions | Hidden and API/file download denied |
| Exam uploads and participant exam window | Controlled by course exam setting | Hidden and API denied |
| Attendance list and evidence | Authorised course staff/company only | Operational access disabled; records retained |
| LMS notifications/invitations | Sent only to currently eligible recipients | New delivery suppressed/cancelled safely; old links cannot grant access |
| Stored LMS records | Retained with versions/audit | Retained without deletion |
| Admin LMS review of historical records | Allowed and audited | Allowed in an explicit administrative read-only retained-data view |

**No global user deactivation:** The switch changes *company-scoped capabilities*, not the participant's password, login or memberships in other companies. Re-enable restores eligible access based on *current* memberships, enrolments, course state and content permissions; never automatically reactivate previously revoked invitations or memberships.

### 8.4. Actor and permission model

| Action | Admin | Management | Company-authorised contact | Assigned lecturer | Enrolled participant |
|---|---|---|---|---|---|
| Toggle company Premium | **Yes** | No | No | No | No |
| View all managed Premium course workspaces | **Yes, audited** | Yes, within management role | Own company only | Own assigned courses | Own enrolments only |
| View course group chats | **Yes, audited** | Authorised course management | Own company courses | Own assigned courses | Enrolled courses only |
| Create/invite/link participant-only accounts | Yes | Yes | **Own enabled company** | No | No |
| Enrol/remove participants | Yes | Yes | Own enabled company and own courses | No, unless specifically delegated later | Own permitted cancellation only |
| Upload course learning files | Yes | Yes | Own courses | Assigned courses | Own courses if submissions enabled |
| Delete company-controlled management files | Yes | Yes | Own company's files | **No** | No |
| Remove other permitted course materials | Yes | Yes | Own courses, according to ownership policy | Assigned courses if not company-controlled | Own submissions only, if allowed |
| Upload/replace exam PDF | Yes | Yes | Own courses | Assigned courses | No |
| Change course `Exam required` setting | Yes | Yes | Own courses | Assigned courses | No |
| View/edit daily attendance register | Yes | Yes | Own courses | Assigned courses | **No** |
| View own course schedule, lecturer, shared materials, exams when enabled | Yes | Yes | Own courses | Assigned courses | **Yes, scoped** |
| Access personal private DMs / another user's private notebook | No blanket bypass | No blanket bypass | No | No | No |

**Interpretation of “Admin sees everything”:** Admin may inspect **all Premium LMS business/course content**, group chats, participant directories, attendance, exam files, course materials, historical company records and audit events, even when Premium is disabled (in the administrative archive). This does **not** silently remove the existing privacy boundary for unrelated one-to-one private DMs, personal calendars, private notebook entries or credentials. Special administrative access must be explicit and audited.

Company users cannot assign/change elevated global roles. Assignment/enrolment/visibility is based on independently authorised organisation **and course** membership; displaying a link never itself grants access.

### 8.5. Participant experience and company administration

**Company participant centre:** Company dashboard presents its participant-only accounts, public user IDs, company-specific reference IDs, invitation state, linked courses, upcoming courses, attendance summaries for its own courses and scoped action logs. Company may invite/create a participant, link an existing valid participant ID with acceptance, enrol or remove them, and assign one participant to multiple permitted courses. Show duplicate/incompatible-role/disabled-Premium errors without exposing other organisations' records.

**Participant dashboard:** After login, show enabled company contexts, upcoming/current/completed enrolled courses, lecturer/contact information authorised for the course, dates/time zones, virtual classroom link, welcome text, shared learning materials, course group chat, allowed exam files, participant-relevant notifications and permitted learning activities. A participant cannot see the company-wide attendance roster, other participants' individual attendance notes, lecturer remuneration, customer contracts or company-private documents.

**Course welcome content management:** Admin/management, authorised company contact and assigned lecturer can edit a versioned title, welcome message, description, course objectives, schedule information, contact instructions, joining instructions and permitted attachments. Provide preview and clear publication/visibility. Company-owned instructions can be protected from deletion by lecturers. Participant sees only published content for an enabled company and enrolled course.

**Visibility:** Base company-course administration remains visible with Premium off. New participant-facing navigation (participant directory, enrolment, exam area, attendance roster, course group chat, learner file library) exists only while the company feature is on and the user is otherwise authorised. Admin settings and retained-data review remain available regardless of flag state.

### 8.6. Course group chat and collaboration

- Reuse the existing `participant_course`/`lecturer_course` room model, real-time infrastructure, moderation, upload scanner and file APIs.
- Course participant room membership derives from **active participant-only account + active company membership + active enrolment + Premium ON + correct course**. Assigned lecturer and authorised company/staff access follow their own scoped rules.
- Automatically maintain membership after enrolment, removal, reassignment, course cancellation, participant suspension and Premium deactivation. Never leave an orphaned room subscription or a still-valid download/share token after access is revoked.
- Re-verify permissions on every API read/write, WebSocket subscription, message fan-out and attachment download. Remove future delivery immediately on revocation; existing retained history follows the authorised course archive policy.
- Admin and permitted management may view/manage **course group** messages with a traceable administrative capability. Private 1:1 messages remain separate from group-chat audit access.
- Support messages, permitted attachments, moderation, notifications and room history under current security policies. Test message deletion/version history and attachment privacy. Do not duplicate a second course-messenger subsystem.

### 8.7. Files: course material library with clear ownership

- Maintain separate categories, e.g. `company_management`, `lecturer_material`, `participant_submission`, `exam_public`, `exam_solution_restricted`, `attendance_evidence`, `welcome_attachment`.
- Admin/management can view and manage all LMS course files under explicit audited capabilities. Authorised company contacts can manage their company's course files. Assigned lecturers can upload and remove permitted **non-company-management** materials; they cannot delete company-uploaded materials marked as course-administration/company-controlled. Participant self-submissions are controlled by course permissions; participants cannot delete others' submissions.
- Files are private; enforce organisation, course and role checks on **metadata and exact bytes**, not only routes. Apply current size/type quotas, malware scanning/quarantine, versions, retention and audit.
- Avoid unsafe “delete everything” semantics. Removal may unpublish/soft-delete current material; immutable versions referenced by historical acknowledgements, attendance or assessed work remain retained according to policy. Changes do not silently replace already acknowledged file versions.
- After Premium OFF, block URL guessing, previously opened downloads where possible, signed link refresh, API gateways, search projection and offline caches for that organisation. Test attempts using stale sessions/tokens and another company's memberships.

### 8.8. Exam document workflow (“Klausuren”)

**Scope is file-based exams, not an unrequested new online examination engine.** Keep existing online quizzes/feedback/completion modules separate.

- Each Premium course has a course-level setting `exam_required` (default **false** for new courses). Show a simple `Exam required / No exam required` control (DE: `Klausur erforderlich / Keine Klausur erforderlich`). Both the **assigned lecturer** and **authorised company contact** can change it for their course, as can admin/management. Audit actor, time, previous/new state and use version checking to avoid silent overwrite.
- When `exam_required=false`, the participant **exam tab/window is completely absent**. Direct participant API/file requests for exam-specific content must also be denied. Existing uploaded exam documents remain retained, not deleted.
- When `exam_required=true`, assigned lecturer or company may upload a properly scoped exam document (PDF as the baseline format) with title/version. Once upload **and malware/security scanning** succeed, the student-visible exam document becomes available **immediately** to currently enrolled participants. This is the requested automatic publication; show an explicit “visible to participants after successful upload” warning before commit.
- Files designated `exam_solution_restricted`, staff answer keys, marking schemes, drafts and unpublished assessments are **never** included in automatic student publication. Restrict them to authorised staff. An exam upload is not proof of an exam attempt, grade or attendance.
- Company and lecturer may update/replace through versioned records, never overwrite historical bytes. Participant visibility follows current enrolment, company Premium and course exam setting. Audit downloads/releases and notifications as appropriate; prevent duplicate notification deliveries.
- If the setting changes from required to not required, hide and deny the participant exam area immediately while retaining staff records. Re-enabling restores only the latest explicitly student-visible, clean version; never exposes staff solutions.
- Automated grading, question banks, proctoring, plagiarism analysis and online submissions are **future separately scoped features**, not inferred from document upload.

### 8.9. Day-by-day attendance and uploaded registers

- Create one record **per enrolled participant per scheduled course session/day**, referencing the canonical `course_session_id` and local date/time zone. Do not infer attendance from assignment claim or login alone.
- Support `not_marked`, `present`, `absent`, `excused` (and optionally `late` as an attribute rather than conflicting primary status). Provide one-click selections, optional arrival time, departure time, absence/excuse reason, free-text notes, recorder identity, modification timestamp and auditable corrections. Validate arrival/departure against the intended local date/time zone without silently altering canonical timestamps.
- Authorised **company contacts and assigned lecturers** can mark/modify their own course's attendance. Admin/management can see/manage all company LMS attendance under their scoped authorities. A participant **cannot see or download the class attendance list** or notes about anyone. If existing individual self-check-in is preserved, it must not expose the roster and must not become verified presence without authorised confirmation.
- Provide a session/day register screen with participant rows, bulk marking where safe, counts, filters and export as PDF/CSV for authorised staff/company.
- Support attaching an attendance-register PDF as scanned evidence. For structured CSV/XLSX imports, require a visible preview of matched participant IDs/session dates, validation of bad/duplicate/foreign-company rows and explicit confirm; never interpret arbitrary PDFs as trustworthy structured attendance without review.
- Maintain source evidence/version history and audit for imports and corrections. Company can see its own course's attendance and supporting documents; cannot see participants enrolled solely with other companies. A Premium OFF company cannot access live roster, but admin can review retained audit/history.
- Do not automatically mark completion, invoice delivery or create official certificates merely because somebody checks `present`; preserve existing distinct verification and completion policies.

### 8.10. Security, persistence and deployment

- **All operations must check actual database capabilities and current organisation/course resource membership**, with RLS, RPC/Edge protections and restricted Storage. Hiding UI is not security.
- Do not use elevated service-role credentials in browsers, ship SMTP/Storage secrets in bundles, or leak another tenant's account existence via public ID search.
- Preserve original Auth UUIDs, linked records, existing group messages, uploads, historical courses and migration ledger. Introduce new additive, timestamped SQL migrations; never rewrite migration files already released.
- Full OFF/ON lifecycle must preserve existing records and associated file bytes and hashes, and must not change other companies' access. Handle in-flight requests, cached queries, long-running WebSockets, old share URLs and stale browser tabs.
- Lock/unlock and enrolment should use transaction-safe updates, idempotency keys where relevant and explicit version/conflict handling. Log all privileged operations without disclosing private document contents, passwords or participant information in public logs.
- Stage/test with fictional accounts and an upgraded **retained-data** database. Before any change to existing hosted data, require validated complete backups (PostgreSQL, Auth, Storage files and recovery secrets), recovery drill and tested rollout. Database resets/fixture seeds are prohibited on populated servers.
- No Premium billing or automatic charging is in scope merely because the feature is called “Premium”; licensing/payment is a separate product decision.

### 8.11. Suggested implementation ownership

| ID | Deliverable | Existing authoritative area to inspect | Dependencies |
|---|---|---|---|
| LMS-01 | Re-enable participant-only role and safe authentication/route boundaries | Auth, profiles, permissions, router, invitation services | Security model and migrations |
| LMS-02 | Stable public User IDs + multi-company participant memberships | Accounts, organisations, profile migrations | LMS-01 |
| LMS-03 | Admin-only organisation Premium flag + confirmations + durable audit | Organisation administration, permissions, RLS | LMS-01, LMS-02 |
| LMS-04 | Company participant creation, ID linking and enrolments | Account facade, course membership | LMS-02, LMS-03 |
| LMS-05 | Participant dashboards, welcome content and course navigation | Existing learning/course workspace | LMS-03, LMS-04 |
| LMS-06 | Group chat/realtime and course file access propagation | Existing chat, Storage, scanned documents | LMS-03, LMS-04 |
| LMS-07 | File categories/ownership and lecturer deletion restrictions | Files, course resources, retention | LMS-06 |
| LMS-08 | Exam-required switch, safe immediate exam publication | Learning workspace, scanned files, audit | LMS-04, LMS-07 |
| LMS-09 | Daily attendance forms, evidence uploads/import and company visibility | Attendance/workspace and reporting | LMS-04, LMS-07 |
| LMS-10 | Notifications, lifecycle, opt-out/revocation and accessibility | Notification worker, PWA, frontend | LMS-03 through LMS-09 |
| LMS-11 | Full test matrix, retained-data rehearsal and current-main CI acceptance | Real DB/API/Playwright/Hostinger tests | All foregoing |

### 8.12. Mandatory acceptance tests / definition of done

A development agent must implement actual automated tests, not only describe them. Test categories: unit, React component, database/RLS, server/API/Storage, WebSocket and notification integration, desktop/mobile Playwright E2E, accessibility, visual regression, migration/persistence, deploy/recovery.

| Test ID | Scenario | Type | Required assertion |
|---|---|---|---|
| LMS-T01 | Existing users gain public IDs | SQL/API | IDs unique, stable, not guessable from UUID; existing foreign keys unchanged |
| LMS-T02 | Company links valid participant ID | API/E2E | Verified acceptance and correct company membership only |
| LMS-T03 | Company attempts to link admin/manager/lecturer ID | Permission/API | Rejected without role or information disclosure |
| LMS-T04 | Same participant in A and B | SQL/RLS/E2E | Correct independent scoped memberships; no cross-company leakage |
| LMS-T05 | Admin enables Premium with confirmation | E2E/API | Success, green labelled switch, audit entry and current version |
| LMS-T06 | Admin disables Premium with confirmation | E2E/API | Red labelled switch, company LMS hidden and denied, data retained |
| LMS-T07 | Management/client/lecturer/participant attempts toggle | Direct API/RLS | All rejected, not merely hidden buttons |
| LMS-T08 | Unconfirmed, cancelled and concurrent switch changes | Component/API | No mutation for cancel; version conflict safe; idempotent retry |
| LMS-T09 | A OFF / B ON for shared participant | Auth/E2E | A access revoked; B session, course and chat continue |
| LMS-T10 | OFF then ON after existing enrolments | DB/E2E | Existing data and eligible memberships restored without duplication |
| LMS-T11 | Stale browser, old signed link, guessed storage path | API/Storage | Access denied after OFF or unenrolment |
| LMS-T12 | Active WebSocket while Premium revoked | Integration | No further LMS messages/attachments delivered to former member |
| LMS-T13 | Company creates participant, invites, activates | Auth/Email/E2E | No plaintext password; correct company and participant-only role |
| LMS-T14 | Two companies attempt simultaneous participant link | Concurrency | Safe uniqueness and no duplicate unintended membership |
| LMS-T15 | Enrolment and course cancellation/reassignment | API/Integration | Exact course/chat/file rights updated transactionally |
| LMS-T16 | Admin/management views all LMS course group chats | RLS/E2E | Access allowed and audited; unrelated private DMs still denied |
| LMS-T17 | Company attempts foreign-course or staff-private file | RLS/Storage | Metadata and bytes denied |
| LMS-T18 | Lecturer deletes company-owned course material | API/E2E | Denied; other permitted material follows ownership policy |
| LMS-T19 | Upload PDF, invalid PDF, malware/quarantine | API/Storage | Only clean correct-type/version file becomes visible |
| LMS-T20 | Lecturer and company each set exam-required state | API/E2E | Both allowed on own course with version/audit; outsiders denied |
| LMS-T21 | Exam not required | E2E/API | No participant exam window; direct exam API denied; files retained |
| LMS-T22 | Clean exam uploaded while required | E2E/Storage | Immediately visible to currently enrolled students, not outsiders |
| LMS-T23 | Exam answer key or draft uploaded | API/Storage | Never automatically student-visible |
| LMS-T24 | Day-by-day attendance present/absent/excused/late | Unit/SQL/E2E | Correct per-session rows, arrival time and notes persisted |
| LMS-T25 | Participant tries to read attendance list | RLS/API/E2E | Entire roster and other learners' notes denied |
| LMS-T26 | Customer/lecturer/admin attendance access | API/E2E | Only authorised company/course staff can manage and view |
| LMS-T27 | Duplicate/foreign CSV attendance import | Unit/API | Preview, validation, reject invalid rows, atomic save |
| LMS-T28 | Attendance PDF upload and correction | Storage/SQL | Clean exact version, protected download and traceable history |
| LMS-T29 | Company course welcome content versioning | E2E/SQL | Only permitted editors, participant sees published content |
| LMS-T30 | Premium OFF notifications/queued deliveries | Integration | No new delivery, no duplicate after reactivation |
| LMS-T31 | DE/EN, red/green switch, mobile, keyboard, dark/light | Visual/A11y | Accessible names/states, non-colour cue, WCAG 2.2 AA target |
| LMS-T32 | Upgrade from retained historical learner data | Migration/recovery | Users, fees, contracts, invoices, files and audit preserved byte-for-byte where applicable |
| LMS-T33 | Exact current-main full CI suite | CI | Every mandatory job green, no blocked/failed/skipped critical gate |
| LMS-T34 | Verified Hostinger release/recovery | Operations | Correct commit/health, backup/restoration evidence, no reset or data loss |

#### Definition of done

- [ ] Explicit product decision and permissions matrix reflected in `PRODUCT.md`, `ROADMAP.md`, onboarding and operations documentation.
- [ ] Source implementation extends existing modules without duplicate authorities.
- [ ] All migrations additive/reviewed and validated against retained data.
- [ ] Every LMS-T01–LMS-T34 test implemented at an appropriate layer and passing (with actual logs/evidence).
- [ ] Required repo CI/security checks green on the exact release commit; no manual bypasses.
- [ ] Real production prerequisites separately accepted: privacy, SMTP, capacity, backups/off-site retention, restore drill and monitoring.

**Do not mark an item complete because code or a test file exists. Mark complete only after verified execution on the relevant commit/environment.**

---

## 9. Consolidated remaining changes and acceptance criteria

**Proposed release scope, 19 November 2026.** This is a rewritten, implementation-ready version of the user-supplied `Changes CMS Plattform(1).txt`, incorporating the subsequent Premium LMS decisions. It describes **requested behaviour**, not proof of implementation. Current source and tests must be inspected before development. Later explicit decisions here override older user requests where they conflict.

**Priority convention:** `P0` = must be correct before real-user operation; `P1` = desired Premium LMS/feature delivery and required for any company using that feature; `P2` = polish/extension that may be deferred only by an explicit release decision. All shipped features require the specified tests and green required CI on the exact commit.

### A. Appearance, navigation and usability

| ID | Priority | Clear requirement | Acceptance criterion |
|---|---|---|---|
| FC-01 | P2 | German/English site footer: translate `Jobs` and `LinkedIn` references appropriately and keep their links functional on the **separate public Luminovia website**. | Locale-based browser test in both languages; no changes deployed to marketing site without separate approval. |
| FC-02 | P1 | Make the demo view visually and structurally match the actual Luminovia Portal, avoiding a disconnected mock design. Use only fictional/safe data. | Desktop/mobile visual comparisons; interactive demo uses same design components and cannot mutate real records. |
| FC-03 | P1 | Improve dark-theme colour composition while preserving the successful colourful light theme. | Theme acceptance screenshots, contrast checks, DE/EN, readable focus/hover/disabled states. |
| FC-04 | P0 | Conduct end-to-end intuitive-workflow checks across onboarding, course assignment, calendar, contract upload, invoicing, company area and Premium LMS. | Role-based usability scripts complete without unexplained dead ends; all blocking accessibility issues resolved. |
| FC-05 | P0 | Fix overlapping tiles, forms, dialog actions and buttons across desktop/tablet/mobile. | Automated layout assertions and screenshots at 390/768/1280/1920px; no clipped critical controls. |
| FC-06 | P0 | Specifically fix private-calendar tile versus expanded calendar-subscription tile overlap. | Expand/collapse, focus and resize E2E tests show independent boundaries. |
| FC-07 | P0 | Specifically fix calendar-export button versus offline-teaching-schedule button overlap. | Buttons independently operable on desktop and mobile. |
| FC-08 | P2 | Add a discoverable Forum entry under Chats and a reference from Knowledge & Help, without a second forum database. | Two routes lead to the same permission-controlled forum. |
| FC-09 | P2 | Add a Contracts reference/link within Files; maintain the existing `/contracts` authority. | Navigation test; direct file/contract permissions unchanged. |
| FC-10 | P1 | Align `Edit roles` and `Permanently delete` actions in account administration. Do not add unnecessary user name text to the role-edit button. | Layout + keyboard + destructive confirmation tests. |
| FC-11 | P1 | Give lecturer/company/management separate role-appropriate **Courses** navigation. | Lecturer sees own assigned courses; company sees its requested/owned courses; staff sees authorised management list. |
| FC-12 | P1 | Collapse ICS import, calendar export and offline schedule download into a compact expandable menu so calendar stays visually central. | Hidden initially; accessible open/close and intact actions on mobile/desktop. |
| FC-13 | P1 | Offer management/admin a header view-mode switch (Management / Lecturer / Company) to simulate relevant navigation and scoped content for testing. | UI preview cannot elevate backend permissions or silently impersonate another identity; role-specific E2E. |

### B. Accounts, pricing, roles and contracts

| ID | Priority | Clear requirement | Acceptance criterion |
|---|---|---|---|
| FC-14 | P0 | Management/admin may configure an individual lecturer fee as fixed rate/period or percentage under a restricted profile setting. | Real accepted quote uses applicable saved setting, only permitted staff can see/change it; history remains immutable. |
| FC-15 | P0 | Distinguish lecturer from senior lecturer for pricing/offer logic, and allow individual overrides. | Correct quote for each role; current settings never retroactively change accepted assignments/invoices. |
| FC-16 | P0 | Minimum password length becomes **8** rather than 12, with safe rate limiting, recovery and breached-password checks where available. | 7 rejected, 8 accepted in all creation/reset paths; no auth security regression. |
| FC-17 | P0 | Only an authorised admin can assign `admin` or `management`. Management may grant other roles within its permissible scope. | Direct API/RLS tests reject unauthorised privileged role assignment, including self-escalation and owner/last-admin abuse. |
| FC-18 | P1 | Lecturers can directly add/select their expertise through their profile. | Save/reload/search test; qualification evidence remains separately tracked where necessary. |
| FC-19 | P0 | Ordinary self-selected expertise does not need explicit management verification simply to appear as a skill. Preserve *verified qualification* requirements where an assignment independently mandates them. | Skill visible immediately; regulated/explicit verification gates cannot be bypassed. |
| FC-20 | P1 | First-time **local/demo** installation includes fictional companies, admin, lecturers, and example courses. Rename labels to `Customers / Companies` as appropriate. | Idempotent demo bootstrap and no fictional accounts/data inserted into production or existing populated databases. |
| FC-21 | P1 | Contract registration form can choose an already uploaded signed PDF **or** upload through click/drag-and-drop in the same flow. | File picker, drag/drop, scanner failure, version and permission checks in real browser. |
| FC-22 | P0 | Authorised management and admins can upload/register framework agreements for a lecturer on their behalf. | Owner association, signer/evidence status, dates and audit validated; no false claim of electronic signature. |
| FC-23 | P0 | Under Administration, configure real outbound SMTP settings and optional IMAP inbound settings, including server, ports, TLS, sender, credentials and a safe connection test. | Credentials never exposed to frontend/logs; role-denied direct API; a real authorised-recipient email delivery test and worker monitoring. |
| FC-24 | P0 | Give **every account** a stable human-readable Luminovia User ID in addition to the existing internal UUID. | Unique/unpredictable IDs for existing/new accounts, safe display/search, no enumeration or FK migration/reset. |

### C. Marketplace, courses and calendar

| ID | Priority | Clear requirement | Acceptance criterion |
|---|---|---|---|
| FC-25 | P1 | Subject filters in the Jobs marketplace use directly clickable multiselect checkboxes. | Multi-select AND/OR semantics documented; results/reset and keyboard operation tested. |
| FC-26 | P0 | After a valid withdrawal/cancellation/release, an eligible available assignment returns to the marketplace and notifies matching eligible lecturers. | Atomic release, correct qualification/contract/availability recheck, no double assignment or duplicate notifications. |
| FC-27 | P1 | Order available Jobs marketplace cards by their next chronological start date. | Sorting does not depend on creation date; deterministic tied times/timezone test. |
| FC-28 | P0 | Claimed/allocated jobs disappear from the **open marketplace** for other lecturers. | Two-lecturer concurrency test; no stale or double-claim after refresh. |
| FC-29 | P0 | A claimed job remains visible under **My Assigned Courses** for the lecturer, and to its originating company and authorised administration/management. | DB RLS + browser: authorised roles retain lifecycle controls; unrelated actors see nothing. |
| FC-30 | P1 | Past, delivered, expired and archived courses are hidden from the normal open marketplace unless an explicit history filter is enabled. | History default off and archived results correct; open jobs remain unaffected. |
| FC-31 | P1 | Visually distinguish customer-created calendar events with a light background; allow users to customise colours on their own calendar. | Source colour accessibility and cross-theme contrast; personal colour preference persists and stays private. |
| FC-32 | P1 | Preserve a clear separation between public/open jobs, own assigned courses, company's own courses and management operational courses. | Search/filters/deep links return only resource-scoped results; no leaked job amounts or contacts. |

### D. Finance and invoices

| ID | Priority | Clear requirement | Acceptance criterion |
|---|---|---|---|
| FC-33 | P1 | Finance dashboard includes charts and trends tailored to lecturer (own), company (own), and management/admin (authorised aggregate). | All totals reconcile to immutable original-currency ledgers; RLS blocks cross-company/private gross/net access. |
| FC-34 | P0 | A lecturer can submit a PDF invoice for an accepted course **only after the last scheduled session of the accepted course block has ended (date/time eligibility)**. Provide a direct link in the course and `/finance`. | Pre-end submission denied at API and UI; post-end legitimate submission succeeds without an unrelated attendance/quiz prerequisite; cancelled/partially delivered work is referred for review; duplicate and cross-currency rules retained. |
| FC-35 | P0 | Management/admin can view/download submitted invoice PDFs, see upload date, approve/reject as supported, and mark **recorded** payment status; lecturer sees own open/paid state. | End-to-end invoice lifecycle with restricted document access, auditable corrections and no actual bank-transfer claim. |
| FC-36 | P1 | Default invoice payment term is 30 days after issue date **unless an explicit valid due date is supplied**; sort due soon/overdue invoices first. | Boundary dates and timezone-safe day comparisons; no implicit replacement of agreed due date. |
| FC-37 | P1 | Invoice status colours: green early, amber after half the payment term, red overdue, purple paid; status text/icons always visible. | Payment/expiry boundary unit tests, accessible colour + labels, partial-payment and reversed-payment accounting. |

### E. Premium LMS — complete integrated feature set

The authoritative detailed implementation and security contract is [LMS_PREMIUM_SCOPE.md](LMS_PREMIUM_SCOPE.md). These additions **supersede** the earlier request that management should be able to switch Premium: **only `admin` may toggle Premium**.

| ID | Priority | Clear requirement | Acceptance criterion |
|---|---|---|---|
| FC-38 | P1 | Add the green/red **Premium LMS** switch to each company under Admin > Companies, default OFF; require confirmation for enabling and disabling. | Only `admin` role permitted at UI/API/DB; both confirmations, audit and conflict tests. |
| FC-39 | P1 | Premium OFF **hides and disables all company LMS functionality without deleting it**, including participant management, enrolments, LMS course files, chats, exams, attendance, routes, API, notifications and real-time access. | Full OFF/ON/retained-data regression, old link/WS/Storage denial and no impact on base business features. |
| FC-40 | P1 | Premium ON activates all authorised LMS features for that company; management and company contacts can manage the scope but cannot change the subscription switch. | Role matrix and company-isolation tests; exact enabled company scoped to resources. |
| FC-41 | P1 | Re-enable standalone **participant-only** accounts using existing Auth/profile infrastructure; companies may create/invite **only participant-only** users. | No privilege assignment through company workflows; password setup and resource-scoped onboarding test. |
| FC-42 | P1 | Companies can link already-existing participant accounts using Luminovia User ID and verified association, including participants already associated with another company. | Multi-company membership, duplicate, invalid role, lookup-leak and acceptance tests. |
| FC-43 | P1 | Company contacts may add participants to their own course(s), remove them, view participant lists and manage course membership while Premium is ON. | Membership/role validation, atomic chat/file access changes and cross-company RLS. |
| FC-44 | P1 | Participants receive a role-specific dashboard showing only their enabled-company courses, dates, lecturer and appropriate learning materials. | User belongs to A OFF / B ON: A hidden, B remains; no financial or attendance-roster leakage. |
| FC-45 | P1 | Course group chats automatically include eligible enrolled participants and assigned lecturers, plus authorised company/staff access; admin can inspect every course group under audited administrative access. | WebSocket permission revocation after removal/toggle; private 1:1 chats remain protected. |
| FC-46 | P1 | Shared course file area supports authorised document upload and download, versioning, malware scanning and distinct file ownership. Lecturers cannot delete company-managed course documents. | Staff/lecturer/participant delete matrix; Storage/preview API and exact file-byte checks. |
| FC-47 | P1 | Create a versioned course welcome/info area for description, objectives, instructor, schedule, joining instructions and shared attachments. | Only approved editors; participant sees only published/allowed content. |
| FC-48 | P1 | Lecturer and company can upload **exam PDF files** to their course; when exams are enabled, scanned student-facing exams appear immediately to enrolled participants. Answer keys/marking materials stay staff-only. | File scanning, exact version, instant participant visibility and restricted solutions access. |
| FC-49 | P1 | Lecturer and company can toggle course-level **Exam required / No exam required**. If not required, the participant exam window is completely hidden and direct access denied; documents remain stored. | Versioned conflicting edits, both authorised roles, hidden UI + denied API + retained data. |
| FC-50 | P1 | Provide a daily/session attendance register with one-click `present`, `absent`, `excused`, optional arrival time and notes. Lecturer, company and staff can manage/see; participants **cannot see attendance roster**. | Per-session SQL + E2E, timezone boundaries, notes, corrections and participant denial. |
| FC-51 | P1 | Allow upload of a protected attendance sheet per session/day. PDF stored as evidence; structured CSV/XLSX import preview/validation may populate rows if explicitly confirmed. | Invalid/foreign/duplicate rows rejected, protected storage, byte/version/audit retention. |
| FC-52 | P1 | On Premium deactivation, existing participant accounts remain usable for other enabled companies; all historical course records are preserved and admin can inspect them in retained-data view. | Multi-company ON/OFF/ON; no user deletion, cross-tenant exposure, duplicate enrolment or stale link. |
| FC-53 | P1 | Premium-related notifications, searches, access to course chats and materials, service workers and stale browser sessions must respect current Premium state. | Revoke while logged in, cached link/WS recheck, notifications stop and safe re-enable. |
| FC-54 | P1 | Connect the existing quizzes, feedback, completion documents and learner course workspaces where permitted; do **not** silently expand PDF upload into a new online exam engine. | Reuse existing modules; source-of-truth mapping and integration/regression acceptance. |

### F. Tests, operations, production release

| ID | Priority | Clear requirement | Acceptance criterion |
|---|---|---|---|
| FC-55 | P0 | Every change has unit/component, SQL/RLS, API/integration and relevant Playwright tests; add source-specific security, desktop/mobile and accessibility tests. | Verified tests on exact current-main release commit; no required check skipped or overridden. |
| FC-56 | P0 | Preserve populated Hostinger data through code and schema upgrades. Apply additive migrations once; test risky migrations against restored retained records. | Migration ledger/digests, live-data retention witness, complete backup + tested isolated restore. |
| FC-57 | P0 | Verify release automation and production readiness separately from development CMS acceptance. | Actual Hostinger commit, service health, external SMTP, monitoring, capacity, backup age and recovery controls documented. |
| FC-58 | P0 | Before the desired **1 December 2026** real-user launch, perform a no-go/go review on the final exact commit; maintain a default-OFF flag for any unaccepted Premium implementation. | P0 source+CI+hosted security green; Premium only enabled where LMS test matrix and release acceptance are green. |

### Important reconciliation notes

1. **Earlier participant retirement is deliberately reversed by this proposed specification.** The old code/docs cannot be considered correct after adopting this decision. Safely add/update migrations, role routing, invitation policies and tests; do not turn on historical permissions without current checks.
2. **Admin-only toggle is the final requirement.** Management may administer permitted LMS content but cannot change Premium status, regardless of older text suggesting otherwise.
3. **Admin access is broad inside Premium LMS content.** It covers all course group chats, company learning documents, exams, attendance, membership and audits. It is not blanket access to unrelated private direct messages, notebooks or credentials.
4. **A human-readable User ID is not an authentication factor.** Use verified association/invitations when linking an existing participant. Internal UUID remains authoritative.
5. **One company switching OFF cannot affect another.** Memberships and LMS permissions must be evaluated in the context of each company and course.
6. **Exams and existing online quizzes are distinct.** Uploading a PDF is immediate student-visible publication only after scanning, only while course exams are required, and never publishes staff solutions.
7. **Attendance and lecturer delivery are distinct records.** Attendance is per course session and participant; it does not automatically mark delivery/invoice eligibility or issue a qualification.
8. **Not every requested feature is currently complete.** Code presence and historical passing tests do not establish current merged CI or actual live-hosted acceptance.

---

## 10. Implementation instructions for AI coding agents

Repository: `Luminovia-Training-Consulting/Luminovia-Management-Tool`.
Target: retain a green, protected CI pipeline and prepare for a *conditional* real-user release on 1 December 2026. No source changes or deployment are authorised by this brief alone.

**Start by reading** `AGENTS.md`, `PRODUCT.md`, `ROADMAP.md`, Sections 8 and 9 of this ROADMAP.md, `DEVELOPMENT.md`, `OPERATIONS.md`, the current migration guide and the relevant source/tests. Inspect current `main`, active branches/PRs, required CI jobs and actual Hostinger development installation before planning. Record a feature ownership matrix mapping FC-01–FC-58 and LMS-01–LMS-11 to `present / partial / missing / blocked / accepted`, source paths, owner PR and required automated tests. Do not duplicate code already owned by another workstream or silently erase older product requirements.

**Implement the exact updated decisions:** Only an active **admin** account may switch a company's Premium LMS ON/OFF. Display a green/red labelled accessible switch and ask for confirmation in both directions. The whole company-scoped LMS is hidden and server-denied when OFF, without deleting data. Participants with membership in another Premium-enabled company retain their other course access. Every account keeps its existing UUID and gets a stable public Luminovia User ID; companies may create/invite/link **participant-only** accounts through verified association, never grant elevated roles. Administration can inspect and audit all LMS company/course content, group chats, exams, attendance and retained history; unrelated private DMs and personal notes remain separately protected. Reuse existing course workspace, rooms, file-scanning and attendance features; safely reintroduce previously retired participant-only access. Lecturer and authorised company may both set `Exam required`, upload student-visible exam PDFs that publish immediately after clean scanning, and manage day/session attendance with present/absent/excused, arrival time, notes and protected uploaded registers. Student exam UI is absent when not required; student attendance roster is never visible.

**Implement the remaining agreed general features** according to FC-01–FC-58, especially role security, job assignment correctness, contracts, post-course invoicing, original-currency integrity, SMTP delivery, responsive UI and user-facing DE/EN controls. Preserve previously agreed immutable contracts, fees, file versions, messages and records. An ID/link/visible button never grants permissions by itself.

**Mandatory engineering safeguards:** Only additive reviewed SQL migrations, untouched released migration bytes, full retained-data rehearsal and independently recoverable database/Auth/Storage backup. Do not run resets, destructive re-seeding, `docker compose down -v`, production writes or an unapproved Hostinger/DNS change. The existing immutable release/update system should be extended, not replaced.

**Mandatory verification:** Unit, component, PostgreSQL constraints/RLS, Auth/API, file-byte/scanning, realtime/chat, notification, integration, concurrency, complete desktop/mobile Playwright E2E, bilingual/accessible visual checks and migration/recovery tests. Implement and pass all LMS-T01–LMS-T34. Add tests to the **existing canonical CI runners**, not an unconnected test suite. Run the full required application **and** security CI on the exact release commit. Do not call an old, skipped, failed, cancelled or manually waived check green. Report actual passing/failing evidence and the first blocking problem.

**Delivery:** Produce small reviewable PRs with ownership, migrations, tests, documentation updates and precise evidence. Keep production and the existing CMS development instance distinct. The Premium flag must default OFF and may only be enabled for real companies after its own integrated acceptance succeeds. On 30 November, provide an honest go/no-go decision for the 1 December launch; incomplete critical security/data/financial requirements block real-user release.
