# Luminovia — White-Label LMS & Commercial Editions Roadmap

> **Status:** Included in the owner's current implementation scope. Dedicated customer release and production approval remain outstanding.
> **Baseline:** Repository `Luminovia-Training-Consulting/Luminovia-Management-Tool`, main at `6a2a16d9cfb9f6ffdbba738940cfd15b22c7fb96` (checked 19 November 2026).  
> **Dependency:** Customer releases depend on verified Premium LMS, examinations, attendance, workspace and permission acceptance in [`ROADMAP.md`](ROADMAP.md), plus the dedicated edition's acceptance below. Core and white-label source development can proceed in parallel.
> **Product:** One maintained codebase, separately configured editions, independent customer data, customer-controlled branding and permissions, a complete supported API, professional installation/update/recovery and commercial licensing.  
> **Original source:** Existing product and operations documentation; latest owner decisions on hosted learning, self-hosted software sales, company branding, removal of intermediary marketplace/commission features, username-or-email authentication and Swagger/OpenAPI.

### Source and acceptance review — 22 November 2026

- Both editions have built and tested customer-branded browser, OpenAPI and installation workflows. Administrators can publish an Academy name, logo, tab icon, accent and public links. Local administrators can also publish or restore app icons from the portal. Both editions serve the versioned icon set under the existing app identity. The browser and operating system control when the launcher refreshes an installed icon.
- The [Academy workflow examples](scripts/examples/README.md#academy-invitations-and-course-drafts--academy-einladungen-und-kursentwürfe) exercise existing role-scoped invitations, course draft options and idempotent draft creation. Complete exact-version transport and permission coverage remains an acceptance item.
- Current course managers, assigned lecturers and authorised contacts for the course company can scan and publish their own material in both Academy editions. PostgreSQL tests cover exact file versions, foreign-company denial and membership withdrawal during scanning.
- Both editions can enable private course-file submissions. PostgreSQL verifies exact versions, course and participant scope, the signed storage quota, read-only grace and expiry. The operator export includes eligible submissions with course and learner ownership. The signed browser packages and local TLS gateway were verified for both editions.
- The independent target's domain, SMTP, monitor, update/restore and installed PWA still require customer-target acceptance. Temporary external provider and receiver tests used fictional installations. Sales, contract and commercial handover are separate from this source review.

## 0. Goals, non-goals and critical boundaries

### Goals

Create an independently sellable and supportable complete LMS. Customers can either (1) purchase a licence and operate their own instance, or (2) buy a managed branded academy that Luminovia hosts and maintains. The existing Luminovia business edition remains functional and unchanged for its own customers. A customer who buys the white-label edition receives full **local** administration over their academy, not control of Luminovia's other customers, operating margins, vendor licence issuer or
servers.

The product must be **customer branded end to end**, use an authentic course/participant experience, support management of employees/lecturers and students, have a complete published **Swagger/OpenAPI** integration contract, permit **username OR email + password login**, and permit customers to run courses without any Luminovia broker/marketplace/commission dependency.

### Not part of the first white-label release

- The Luminovia-branded public `/demo` route. **This remains part of Luminovia Internal Edition and must be retained and redesigned under `ROADMAP.md`**; it is simply excluded from distributed customer white-label installations. An operator can explicitly include a customer-branded LMS sandbox at the same path by enabling `publicDemo` in the signed customer build. The sandbox uses fictional courses and omits vendor business modules.
- A new learning platform built in parallel to the existing one; reuse the completed LMS modules.
- Turning an ordinary company record into a trusted infrastructure tenant merely by giving it an admin role.
- Public access to Supabase service-role credentials, unrestricted SQL, private cross-company data or vendor account administration through Swagger UI.
- Online examination proctoring, fully automatic marking, extensive ecommerce, SCORM/xAPI/LTI or enterprise SSO merely because a file-based exam and API exist. These may be **separate future modules**.
- A single shared multi-tenant SaaS database as the default. Start with **one installation / isolated data plane per customer**; design shared-tenancy only after an independently reviewed isolation project.
- Automatic exposure of the Luminovia brokerage business model to the customer or making the customer pay for their own LMS through the **company Premium LMS switch**.

### Implementation starting points

This table records the reusable baseline and intended design. Use the current implementation summary and release sequence below to track delivery and acceptance.

| Current repository capability (source observed)                                             | Reusable foundation                          | White-label gap to implement                                                                                                  |
| ------------------------------------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| React + TypeScript + Vite + PWA + DE/EN + light/dark                                        | Browser application and course UI            | Runtime company branding; domain-specific PWA, title, logo, favicon, styles and templates; edition-aware navigation           |
| Supabase Auth, PostgreSQL, RLS, RPC and Edge functions                                      | Accounts and resource permissions            | First-admin provisioning per instance, username login alias, local installation roles and enforced edition policies           |
| Course templates, sessions, workspace, readiness/learning modules                           | LMS foundation after main roadmap completion | Academy-centric workflow that can run courses **without job marketplace or Luminovia framework agreements**                   |
| Participant group chats, scanned file gateways, attendance, quiz/feedback/completion source | Shared teaching functions                    | Reuse these and complete the main-roadmap Premium LMS before white-label release                                              |
| Internal customer organisations and lecturer marketplace/claims                             | Useful in **Luminovia Internal Edition**     | Replace brokerage-centric UI with local company course/lecturer administration; intermediary actions disabled server-side     |
| Lecturer pay, rates, commissions, contracts, invoices and forecasts                         | Luminovia business functions                 | Dedicated LMS editions omit these functions from the browser, API and teaching workflow.                                      |
| Versioned Accounts API + OpenAPI 3.1 document and business RPC reference                    | Authentication and domain API base           | Complete customer-facing v1 API, accurate schemas, Swagger UI, scoped integration keys, webhooks and compatibility guarantees |
| Self-hosted Supabase Compose, private secrets, updater, checksums and backup/recovery       | Deployment patterns                          | Parameterised, customer-neutral installer/packages; independent keys, domains, backups and exact-version customer upgrades    |
| Current proprietary source-available licence, historic GPLv3 versions                       | Licence notices/documented source ownership  | Commercial end-user licence, customer distribution rights, third-party obligations and support contracts                      |

**Audit evidence / implementation starting points:** [`README.md`](README.md), [`ROADMAP.md`](ROADMAP.md), [`PRODUCT.md`](PRODUCT.md), [`API_REFERENCE.md`](API_REFERENCE.md), [`AGENTS.md`](AGENTS.md), [`src/app/shell.tsx`](src/app/shell.tsx), [`src/app/app.tsx`](src/app/app.tsx), [`src/features/learning/`](src/features/learning/), [`supabase/functions/accounts/openapi.ts`](supabase/functions/accounts/openapi.ts), [`vite.config.ts`](vite.config.ts), [
`deploy/hostinger/selfhost/generate-env.mjs`](deploy/hostinger/selfhost/generate-env.mjs), [`deploy/hostinger/updates/package.mjs`](deploy/hostinger/updates/package.mjs), [`deploy/hostinger/updates/updater.py`](deploy/hostinger/updates/updater.py), [`deploy/hostinger/backups/README.md`](deploy/hostinger/backups/README.md), [`LICENSE`](LICENSE).

### Current white-label implementation

Both dedicated editions use validated customer branding in the shell, PWA assets and API documentation. A server-verified identity and signed licence bind the browser, database and enrolled customer to the exact release. The installer gives each academy its own domain, keys, database, storage, mail configuration and network. The internal edition continues to use its original packaging and commercial workflows. [Installation runbook](deploy/academy/README.md)

Academy administrators create local organisations and manage their instructors, learners and course managers. Staff can create, schedule and publish courses independently, assign their own lecturers, enrol learners, set meeting links, upload course materials, publish student and staff exam files, maintain attendance and export scoped attendance and participation reports. Learners can read and acknowledge materials, use course chat with scanned attachments, track private notes, submit assessments and feedback, receive course notifications and obtain the verified completion record. Local acceptance covers native authentication, current role and licence checks, exact private file bytes, desktop/mobile Chromium and offline cache separation. Read access continues during grace and access closes at expiry. [Current test evidence](docs/WORKLOG.md)

The dedicated OpenAPI 1.32 catalogue documents 90 paths with domain schemas, scoped course material publishing and the signed API allowance and maintenance response formats. Signed packages with the previous 1.30 and 1.31 catalogues remain verifiable. Both editions offer distinct keys for the published course index, enrolment and aggregate reports. The [signed webhook receiver](scripts/examples/README.md#signed-course-webhook-receiver) uses a separate signing secret, stores accepted events durably and handles retries. The [installation runbook](deploy/academy/README.md) distinguishes the locally tested setup from customer handoff.

Release gates still cover the complete target installation, public domain/TLS, SMTP and dedicated delivery, migration and recovery of retained customer data, operational handoff and commercial fulfilment. The acceptance matrix below tracks those separately.

## 1. Product editions and packaging

| Capability                                                | Luminovia Internal Edition                                                 | Customer Self-Hosted LMS                  | Luminovia-Managed Branded Academy                                                       |
| --------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------- |
| Hosting / database                                        | Luminovia-controlled                                                       | Dedicated customer-operated instance      | Dedicated Luminovia-managed customer instance initially                                 |
| Branding                                                  | Luminovia                                                                  | Customer name/logo/domain and theme       | Customer name/logo/domain and theme                                                     |
| General LMS                                               | Premium company entitlement ON/OFF (main roadmap)                          | **Included and enabled**                  | **Included and enabled**                                                                |
| Company-level Premium red/green switch                    | Admin-only, confirmed                                                      | **Not shown and not needed**              | **Not shown and not needed**                                                            |
| Public demo (`/demo`) | Luminovia practice workspace | Optional customer-branded LMS sandbox, default off | Optional customer-branded LMS sandbox, default off |
| Local academy administration                              | Luminovia admins + scoped company roles                                    | Customer instance administrators          | Customer administrators scoped to the academy; vendor handles agreed managed operations |
| Courses, lecturers, participants, chat, exams, attendance | Per existing permissions                                                   | Included                                  | Included                                                                                |
| Job marketplace and external commissioning                | Available internally                                                       | Disabled                                  | Disabled                                                                                |
| Luminovia fee split/margin/broker rates                   | Internal authorised views                                                  | **Never visible or callable**             | **Never visible or callable**                                                           |
| Lecturer pay, rates, contracts and invoices               | Internal business module                                                   | Disabled                                  | Disabled                                                                                |
| Customer API and Swagger                                  | Scoped existing/extended API                                               | Included full local LMS API               | Included scoped LMS API                                                                 |
| Licence and upgrades                                      | Internal operations                                                        | Per-installation software licence         | Managed service contract and deployments                                                |
| Vendor billing / issuing licences                         | Vendor-only                                                                | Never exposed through academy UI/API      | Never exposed through academy UI/API                                                    |

**An edition is a server-authoritative installation setting/licence entitlement, NOT an editable local user role or merely a React feature flag.** The academy administrator cannot promote their account into Luminovia vendor administration by changing edition metadata.

## 2. Roles, ownership and administrative model

1. **Luminovia Vendor Administrator:** manages commercial contracts, software licence issuance, supported packages, provisioning requests, distribution, vendor invoices and support across customers. Lives in a separate trusted control plane. **No automatic ability to read a customer's course messages or learner records**; time-bound customer-authorised support must be explicit and audited.
2. **Customer Installation Administrator:** manages ALL purchased LMS functions inside their own installation: branding, permitted accounts/roles, lecturers, participants, course templates and runs, course groups, materials, exams, attendance, own reports, APIs, integration credentials and relevant local settings. Cannot manipulate vendor licensing, update signing or another installation.
3. **Customer Management / Course Manager:** operationally manages the customer's courses, permitted instructor assignments and attendance according to local delegated permissions.
4. **Lecturer / Senior Lecturer:** delivers authorised courses, manages learner content/exams and allowed class attendance; does not get vendor business-margin data.
5. **Participant:** accesses own enrolled courses, allowed exam PDF, materials, group chat and learning actions; never company roster, staff-only solutions or private accounts.
6. **Service/integration identity:** non-human access with explicitly scoped, revocable permissions and full audit; no reusable human password or vendor superuser key.
7. **Support actor:** optional installation-local, expiry-bound, consented access for troubleshooting, with case ID, audit and rapid revocation. No blanket private-DM escalation.

Implement role/capability checks at both **installation AND resource** scope. In a dedicated single-customer instance an academy admin can manage its installed academy; it does not mean global access across other customers or to unrelated private direct messages. Preserve the current distinction between course-group administrative oversight and private DMs/notes.

An installation administrator can assign management, lecturer, participant and organisation-specific company access to one local account. Each granted role uses the same account and licence seat. Organisations, lecturer assignments and course enrolments still govern each resource. Removing one role preserves the other grants and historical course records.

### Admin-permission examples

| Operation                                            | Vendor admin                             | Customer installation admin | Customer course manager      | Lecturer          | Participant |
| ---------------------------------------------------- | ---------------------------------------- | --------------------------- | ---------------------------- | ----------------- | ----------- |
| Issue software licence, change signed edition        | Yes                                      | No                          | No                           | No                | No          |
| Configure own academy brand/domain settings          | Only via authorised provisioning/support | Yes                         | Optional delegation          | No                | No          |
| Create users and grant local management roles        | No automatic cross-instance scope        | Yes                         | Restricted subordinate roles | No                | No          |
| Create course and enrol learners                     | No automatic cross-instance scope        | Yes                         | Yes                          | Per course policy | No          |
| Upload public exam / edit exam-required              | No automatic cross-instance scope        | Yes                         | Yes                          | Assigned course   | No          |
| See class attendance / staff notes                   | No blanket access                        | Own academy                 | Own courses                  | Assigned courses  | No          |
| View Luminovia broker profit and platform commission | Vendor business authority only           | **No**                      | No                           | No                | No          |
| Rotate a local API key / manage local integrations   | No automatic access                      | Yes                         | If delegated                 | No                | No          |
| Access another installation's data                   | Never by local role                      | No                          | No                           | No                | No          |

## 3. Product-specific module removal, replacement and reuse

**Never delete historical financial/assignment records merely because an edition no longer exposes them.** Replace hard-coded business assumptions with explicit, tested edition policies and new customer-owned flows. Existing data remains in the Luminovia edition.

| Existing module                                                                     | Customer edition decision                                                                                     | Customer-specific replacement / preservation                                                                                                                                                                  |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Global Jobs marketplace and first-come-first-served lecturer claims                 | **Disabled / absent** by default                                                                              | Direct course creation, internal lecturer assignment and optional company-owned staffing queue; no dependence on third-party job posting                                                                      |
| Multiple external customer/company lead directory                                   | **Disabled** as Luminovia sales tool                                                                          | Customer's own departments/groups/locations and local organisational units, if relevant                                                                                                                       |
| Lecturer pay, rates, commissions and gross/platform/net split                       | Disabled in the dedicated app and API                                                                         | Course staffing uses local assignment and scheduling.                                                                                                                                                         |
| Lecturer contracts                                                                  | Excluded                                                                                                      | Employment contracts remain with the customer's own systems.                                                                                                                                                  |
| Invoice and payment administration                                                  | Excluded                                                                                                      | Academy reports cover courses, attendance and learning outcomes.                                                                                                                                              |
| Cross-company job brokerage notifications/replacements                              | **Disabled**                                                                                                  | Internal course staffing and attendee alerts; optional internal replacement workflow                                                                                                                          |
| Courses, plans, enrolment, materials, exams, attendance, completion, calendar, chat | **Included**                                                                                                  | Reuse the finished LMS's authoritative modules and adapt labels/permissions                                                                                                                                   |
| Personal calendars and private DMs                                                  | **Supported as applicable**                                                                                   | Preserve individual privacy boundaries, with scope-specific teacher/participant views                                                                                                                         |
| Knowledge/wiki/forum, notifications, support, search                                | **Included if relevant**                                                                                      | Academy-scoped content and edition-specific navigation                                                                                                                                                        |
| Public demo view (`/demo`)                                                          | Internal Luminovia demo; optional fictional customer LMS sandbox                                              | Standard customer packages omit the public route. Opted-in signed packages use the customer's packaged branding and academy roles, with isolated fictional state and no portal business requests. |
| Existing public & private REST/RPC operations                                       | **Scope-filtered**                                                                                            | Expose only explicitly allowed customer product API operations                                                                                                                                                |

Each dedicated installation is a Premium LMS for one customer. Local organisational units can scope training coordinators and enrolments. Staff assignment checks teaching authority and schedule conflicts. It creates no pay agreement, marketplace offer, invoice or job notification.

## 4. Brand and domain management — fully white-labelled

### 4.1 Vendor-side `Create Customer Academy` wizard

Required fields: legal customer display name; academy name; main administrator email/username invitation; hosting mode (self-host / managed dedicated); verified primary domain or safe temporary domain; language/time zone and locale; primary brand logo/icon; theme; installation ID; selected edition; agreed capacity/seats/storage and API plan; SMTP service choice; backup/retention setting; support terms and customer data location. Do not collect server passwords through ordinary public forms.

Wizard behaviour: validation and duplicate checks; draft → preview → customer/plan review → explicitly authorised provisioning; idempotent retry; observable progress; recoverable failures; no partial active setup; generated installation ID and audit events. Customer receives an invitation to create their own password, **not** a prepublished master admin password. A vendor wizard may create an installation record without acquiring ongoing private content access.

### 4.2 Customer brand settings panel

- Customer name, academy/product display name, header wordmark/mark, favicon, mobile/PWA install icons and maskable icons, login illustration/colour palette, light/dark themes and accessible contrast.
- Branded browser title, favicons, responsive logo/alt text, login/account recovery, invitation emails, notification sender, certificates/completion PDFs, course handouts, public page metadata, API docs/Swagger title, PWA manifest and push labels.
- Custom CSS/design tokens only within a safe allowlist; preview before saving; upload scan, MIME/type/image dimension verification, versioned assets and cache invalidation.
- Custom own domain with verified ownership, TLS automation, DNS guidance, canonical redirects, HSTS/cookie scope, Auth callback URLs and CORS. Never claim DNS changed without actual verification.
- Branded legal/consent links and contact/support details. Keep required licence/vendor/legal notices where the written licence requires them; remove unnecessary Luminovia advertising from customer-facing routes.
- Per-entity authored content remains authored in its own language; framework interface supports DE/EN and future locale catalogues without hard-coded brand strings.

### 4.3 Multi-brand support policies

For self-hosted and dedicated hosted editions, normally **one primary customer brand per installation**. More than one school, department or sub-brand inside an installation requires an additional, explicit hierarchical branding and data-scope design. Default behaviour must not pretend an `organisation_id` automatically means a securely separate hosted tenant.

## 5. Installer, provisioning and environment-neutral deployment

- Parameterise hostnames, API origins, storage directories, Docker/Compose project names, network names, service identities, PWA/public build values, callback/allowed origins, licences, monitoring names and file quotas. Do not change the existing vendor KVM instance while implementing customer packaging.
- Reuse the existing self-host secret generator, scanner, Supabase Compose, Caddy/Envoy and archive updater with **customer-neutral configuration templates**. Never blindly reuse static `cms.luminovia.org`, the Luminovia production API key, Hostinger hostnames, fixed volume names or published source environment identities.
- Provide a non-interactive preflight and guided installation process with OS/architecture/CPU/RAM/disk check, ports, domain/TLS, immutable runtime images, required CLI versions, PostgreSQL initialisation, Auth and Storage readiness, migration history and SMTP checks.
- First-run provisioning must be idempotent, write secrets privately, seed **no production demo accounts** and require a one-time initial administrator setup. Recovery or reinstall must detect existing data and refuse reset/secret regeneration without explicit reviewed recovery.
- Standardised environment health/status, installation fingerprint, exact installed Git commit/release manifest, bundled modules, user-facing support diagnostics and redacted safe errors.
- Provide air-gapped/offline self-hosted installation only if the licensed distribution supports it; document licence validation and dependency/image availability honestly.
- Support Linux system service/Compose restart persistence and explicit update/maintenance locks; no unmanaged auto-updates or emergency vendor remote access by default.

## 6. Licensing, editions and vendor/customer separation

- Implement a signed or otherwise trustworthy per-installation licence: edition, customer/installation identifier, permitted modules and versions, validity/renewal, optional seats/storage/API quotas, support/update rights, and allowed hosting mode. Validate this **server-side**. Never treat an editable database flag or hiding a button as a licence.
- Define trial-to-paid, expired licence, transient offline verification failures, grace/readonly policy, last-good validation and safe downgrade/renewal. An expiry cannot automatically delete exams, participants, contracts, course history or Storage objects. Customer should have a documented data-export/offboarding path.
- Admin can see their own local entitlements/usage and request renewal; only Luminovia's trusted vendor authority can issue or change licence rights. Licence checks should not provide an undisclosed vendor access path into customer content.
- Keep customer contract billing, subscriptions and vendor licence invoices in the vendor control plane.
- Review the repository's current proprietary source-available licence and [`docs/RELICENSING_STATUS.md`](docs/RELICENSING_STATUS.md) before distributing binaries/source: older GPLv3 grants remain for copies already received, and bundled assets/dependencies keep their own licences. Obtain appropriate legal review for redistribution, support warranty, subprocessors, export and customer data ownership. Never claim a new EULA overrides existing third-party or old licence rights.
- Establish signed versioned customer build/release artifacts with immutable provenance and an SBOM/dependency licence manifest. Separate customer release channels from the automatic CMS _development_ publication workflow.

## 7. User accounts and sign-in — username OR email + password

- Preserve existing Supabase Auth UUIDs and the separate stable, human-readable Luminovia User ID for account linking. Add a unique **username login alias** and a verified email login path. A username does not grant an Auth role, access to files or ability to associate another user's identity.
- Account owners may sign in using `username + password` **or** `email + password`, in the UI/PWA and an explicitly supported API login flow. Use one authoritative password store, no duplicate password hashes and no hardcoded fixture credentials in a commercial instance.
- Define case-insensitive username uniqueness, reserved name protection, account recovery/change, migration of existing email-only accounts and how usernames are namespaced in independently installed academies. Handle collisions, suspended users, throttling and non-enumerating error messages.
- Owner's requested password minimum is **8 characters**, not 12, consistently enforced in real account creation/reset/invitations. Apply secure hashing, TLS, throttling, breached-password checks when available, recovery-token expiry and secret-safe diagnostics.
- **Do not use username/email + password as a reusable permanent API key.** The credential authenticates the person; the API uses short-lived bearer access tokens with current role/resource checks. Third-party systems use dedicated scoped credentials/service accounts, not a shared human admin password.
- In managed hosting, correctly determine which organisation/academy an identity belongs to before authentication or scope selection; do not make an email/username in one customer automatically usable against another customer without an actual authorised identity/membership.

## 8. Full product API and Swagger / OpenAPI

**Requirement:** Every supported operation available in the installed edition's UI should have a supported, documented API counterpart unless a documented security-specific exception exists. This is **product parity**, not raw database superuser access.

### 8.1 Supported API surface

| Domain                | Examples of versioned API operations                                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and accounts | Sign-in/auth token, current identity/roles, username/email settings, profiles, invitations, suspend/deactivate, scoped user lookup     |
| Academy settings      | Branding, local administrators, feature/module licence status, locale, roles, support contact and allowed configurations               |
| Courses               | Templates, course run creation, sessions, publishing, internal teacher assignment, readiness, joining instructions and welcome content |
| Learners              | Company memberships, participant invitations, enrolment/cancellation, learner dashboard, allowed completion history                    |
| Course content        | Resources, upload/scan/version/share/removal, learner acknowledgements, staff-only files, private downloadable records                 |
| Exams and quizzes     | Exam-required setting, student-facing PDF publication, protected solutions/drafts, existing quiz/feedback/completion operations        |
| Attendance            | Authorised per-session roster, present/absent/excused, arrival/notes, correction, import/export and scanned evidence                   |
| Communication         | Scoped course groups/messages, announcements, notification preferences and event subscriptions                                         |
| Calendars             | Own/permitted events, sessions, timetable, subscriptions and timezone-correct information                                              |
| Knowledge/support     | Authored wiki/forum and course support interactions, under applicable access policies                                                  |
| Reports/analytics     | Only installed and permissioned course/activity/attendance reports, exports and job status                                             |
| Local licensing       | Installation licence validity, signed limits and current usage for authorised local administrators                                    |

### 8.2 API contract, documentation and developer experience

- The running Academy exposes **Swagger UI** at `/api/docs` and the edition-specific OpenAPI 3.1 document at `/api/openapi.json`. Calls use the backend URL in that document. The [API reference](API_REFERENCE.md) describes the shared platform contracts. The complete mapping of Academy UI actions to its published API remains an acceptance requirement.
- The running installation's Swagger UI must show **its exact product edition and installed API version**, precise request/response/error schemas, HTTP methods, fields, pagination, file upload flow, permissions, authentication, relevant DE/EN descriptions and safe fictional examples.
- Swagger's Authorize function can obtain or use a short-lived user token, but must never embed human passwords, persistent admin tokens, private instance keys or demo credentials in generated static files. Test interactive calls against a sandbox; require real permission for production try-it-out calls.
- Provide human-readable developer portal: getting started, how to obtain token, token/key rotation, rate limit policies, schemas, error codes, response examples, client generation/download, Python/TypeScript/curl snippets, sandbox seed/reference, changelog and compatibility/deprecation policy.
- Deliver a supported operations catalogue mapping every UI capability to the canonical backend operation. Avoid duplicated business rules between React, Edge and an invented parallel application server.
- Authentication, ordinary read/write, Storage exact-byte downloads, Realtime messaging and long-running tasks need documented contracts. An OpenAPI document alone does not fully specify WebSocket event semantics; document event payloads and subscription auth alongside the REST API.

### 8.3 Integration credential administration

- Customer administrator creates **named, scoped integrations** such as HR enrolment, website course sync, reporting or CRM; permissions are least-privilege per installation/course/resource/action. Admin can revoke/rotate and monitor own keys and webhooks.
- Use a protected API gateway/service layer as needed to safely expose existing RPC/Edge capabilities; keep Supabase service-role secret completely server-side. Enforce edition availability at **API and RLS** layers, not just Swagger or UI.
- Implement consistent validation, stable error envelopes, pagination, cursor bounds, idempotency keys, concurrency/version checks, rate limits, correlation IDs, async import/export/scan status and schema-version testing.
- Signed outgoing webhooks for committed changes (participant enrolment, course schedule, file scanned/published, exam released, attendance verified, completion issued/revoked). Support event IDs, filtered payloads, replay resistance, bounded retry, delivery history, secret rotation and status monitoring; do not infer an exactly-once delivery guarantee.
- Version compatibility must be independently tested across supported customer installations and release channels; contract-breaking changes require planned version bump, deprecation and migration guidance.

## 9. Customer learning workflows independent of brokerage

The current implementation priority is the standalone learning workflow. Branded desktop and mobile journeys already cover course drafts, direct instructor assignment, publication, confirmed enrolment and learner access in both editions. Course materials, student exam PDFs, versioned session registers, atomic CSV/XLSX imports and scoped notices have dedicated database or native transport evidence. The work log records the current verification and the remaining LMS tasks. Installation, customer branding and commercial release follow the LMS acceptance. See [the implementation plan](docs/IMPLEMENTATION_PLAN.md) and [work log](docs/WORKLOG.md).

The white-label customer must be able to execute this entire workflow **without** Luminovia internal assignments, broker rates or a company-level Premium switch:

1. Installation admin signs in through customer-branded account and configures academy settings.
2. Admin creates/invites local management, course lecturers and participant-only users; current identities and public IDs are preserved.
3. Course manager creates a template and course sessions or copies approved reusable content.
4. An authorised customer user assigns an internal lecturer directly to the course.
5. Participants are invited/associated with their academy and enrolled into the course; capacity, active account and course membership are checked transactionally.
6. Lecturer/company publish versioned Welcome Content and safe learning files; course participant group chat is available under current membership.
7. Lecturer/company configure `Exam required` per course and upload student-facing exam PDFs; clean scanned version becomes available to enrolled learners, private answer key never leaks.
8. Staff record per-session participant attendance (present/absent/excused, arrival times and notes) and may attach scanned roster evidence; learners do not see class register.
9. Participant sees own course, permitted files and notifications; authorised company staff access reports and completion records.

A hosted Luminovia-managed academy uses the same business workflow but its actual infrastructure, system updates and support responsibilities follow the managed contract.

## 10. Managed hosted academies and future commercial services

For dedicated managed hosting, implement vendor-side provisioning for an isolated customer's server/database/Auth/Storage/SMTP/domain/backup assets and customer admin handover. Maintain an inventory of customer installations and versions without centralising private student content by default. Monitor uptime, storage, failed scan jobs, queued mail, backup freshness and migration status per installation. Define named support access grants, incident communication, contracted service limits,
capacity planning and offboarding/data portability.

A future **hosted shared SaaS** edition requires a distinct design and security project: tenant identity/control plane, per-table policies, correct company/tenant FK propagation, isolation of Storage, Auth, notifications, Realtime, search, API keys, backups, metering, per-tenant encryption/key strategy, recovery blast radius and actual adversarial multi-tenant tests. The fact that an account can belong to more than one company does **not** prove this architecture is safe.

Optional separate sales/commerce extension: paid online course checkout, seat entitlement, invoice/tax handling via reviewed providers, verified payment webhooks, cancellation/refunds and customer management. **Course purchase must never grant vendor or customer installation admin rights.** Payment-triggered course access is distinct from manually enabling the company Premium entitlement in Luminovia Internal Edition.

## 11. Database and configuration changes — proposed, not migrations to apply now

Implement additive versioned SQL and private configuration based on the existing schema. Names below are conceptual; inspect exact current source and do not create conflicting duplicate tables:

- `installation_identity`: immutable installation UUID, deployed edition and customer-owner identifier, created/versioned status.
- `installation_branding`: company/academy title, logo/asset version IDs, theme tokens, locale, legal links, sender display and domain bindings.
- `installation_edition_entitlements`: verified licence identity, allowed modules, version, limits and expiry/grace policy; actual signed licence validated by trusted server component.
- `installation_module_policy`: current available edition modules; separate from the **Luminovia Internal Edition's company Premium flag**. Edition-granted LMS is always included for white-label.
- `user_login_aliases`: guarded username uniqueness and lookup mapping to existing Auth IDs; no password duplication or public account lookup endpoint.
- `academy_roles` / existing scoped memberships: customer-local admin/manager/lecturer/participant capabilities, with no vendor role escalation.
- `academy_integration_credentials`: hashed scoped key metadata (never plaintext recoverable secrets), creation/last use/expiry/revocation and permitted actions.
- `academy_webhook_subscriptions` / `webhook_deliveries`: signed event destinations, failure states, retries, audit and secret rotation.
- `installation_release_state`: signed release identity, exact migration inventory, supported API version and upgrade history.

**Critical:** The real implementation may extend current tables/permissions instead. Keep released migrations byte-identical, model live Auth/Storage dependencies, implement RLS and ACLs with every new record, and never reset/populate production as a convenience.

## 12. Engineering, security and operational non-negotiables

- Use one codebase with edition-aware, server-enforced module access. UI feature visibility **and backend refusal** must align. Attempting restricted actions via direct PostgREST, Edge, file gateway, WebSocket or old URLs must fail.
- Do not expose Luminovia finance margins, customer contracts, licence issuer, cross-company company lists or administrator identities to a customer by API, search, telemetry, docs, logs or backup files.
- Customer instance data isolation: dedicated PostgreSQL/Auth/Storage/keys plus unrelated backups and signed secrets for initial distribution; protect backups from other customers. Provide explicit consented support and traceability.
- Sensitive data requires per-resource authorisation. LMS admin oversight may include course groups, exams, staff attendance and managed files but **not blanket private DMs, notes, calendars or credentials**.
- Files must go through clean scanned exact-version gateways; prohibit public file buckets and permanent unrestricted student URLs. Prevent cross-tenant file path enumeration.
- Continuous security: rate limiting, password abuse handling, server-side edit validation, CSRF/CORS where relevant, safe templates, PWA cache isolation, access revocation on token/role/licence/membership change and secure log redaction.
- Customer updates must preserve **all** Auth identities/passwords, courses, learner memberships, chat, records, contracts/invoices and Storage file bytes. Migrations must be tested against an isolated restored retained-data copy; never execute demo reseeding or `supabase db reset` on populated customer servers.
- Release rollback must not rewind a database after newly accepted customer writes. Define forward migrations/compatibility and restore-assisted recovery where necessary. Upgrade preflight, maintenace windows, known-good static releases and post-upgrade smoke tests are mandatory.
- Maintain full German/English interface, accessible keyboard interactions, explicit loading/failure states, safe mobile layout and tested PWA installation. Branded themes must meet accessibility contrast requirements.

## 13. Implementation and customer-release sequence

Each milestone is a separate reviewable, fully tested piece. No percentage-complete claims without actual source + current test evidence.

### WL-00 — Prerequisite and architecture audit (blocker)

- [ ] Confirm ALL agreed [`ROADMAP.md`](ROADMAP.md) core and Premium LMS acceptance gates have passed, with the current exact-commit application/security CI green.
- [ ] Verify real source, current open PRs, API inventory, role/permission matrix, migration history, updater/backup tests and licensing prerequisites. Record `implemented/partial/missing/blocked` for every feature rather than trusting documentation alone.
- [ ] Decide dedicated self-hosted as initial sale and a separate dedicated managed-hosted offer. Write the edition and installer authority map before code changes.

### WL-01 — Edition & capabilities foundation (P0 for white-label)

- [x] Add trusted installation identity and customer edition/license capabilities. Internal per-company Premium switch remains internal; white-label LMS always included.
- [ ] Introduce immutable resource/role/business edition gates across UI, RPC, Edge, Storage, search, Realtime and notifications; independent data/finance boundaries.
- [x] Staff dedicated courses through direct lecturer assignment. Keep internal marketplace, contract and commission workflows scoped to the internal edition.

### WL-02 — Customer admin and normal academy workflow (P0)

- [x] Customer installation administrator and delegated manager, teacher and participant roles. The signed operator path binds a confirmed first administrator in the dedicated database.
- [x] Course creation, scheduling, own lecturer assignment, participant enrolment and daily LMS operations run through the dedicated academy without a marketplace or intermediary contract.

- [x] Group several course runs under a school class within the same organisation without creating implicit enrolments. Confirm the shared workspace in internal Premium and both dedicated editions on desktop and mobile.
- [x] Verify that several lecturers can teach the same scheduled course and that releasing one assignment preserves the other lecturer and existing enrolments.
- [x] Provide a current-role company switch and an administrator-wide switch for participant-chat spam protection. Verify concurrent text and scanned attachments, exact retries, and company isolation.

### WL-03 — Branding, domains & welcome (P0)

- [x] Preview management, lecturer, company and learner navigation under current academy administrator authority. Management can preview company and learner views. Each account can customise its own list on the current browser.
- [x] Offer a customer-branded public LMS sandbox through the signed build's optional `publicDemo` setting. The ordinary package omits the route.
- [x] Local administrators can publish the name, short name and accent. Both editions verify the anonymous sign-in and responsive academy pages.
- [x] Local administrators can preview and publish a scanned PNG for the Academy shell, sign-in, browser tab and invitations. The signed package supplies the fallback logo and favicon.
- [x] Publish or restore the PWA icon from Academy administration. A single scanned PNG produces three private, versioned variants exposed as public installation assets. The native database fixtures cover both editions and the pinned ingress exercises the update and signed fallback.
- [x] Provide a private offline vendor workflow to preview a dedicated academy draft and save an exact, explicitly approved receipt. The registry checks duplicate requests, domains and overlapping host paths.
- [x] Export a signed runtime handoff from the approved draft. The customer operator confirms the path and the trusted key before generating the independent local credentials. An exact retry preserves the existing configuration. [Operator handoff](deploy/academy/RUNTIME-HANDOFF.md)
- [x] Bind the approved draft, signed runtime handoff, issued licence and reviewed handover reference in the private vendor registry. [Fulfilment runbook](deploy/academy/FULFILMENT.md)
- [ ] Carry out live provisioning and commercial handover on the authorised customer target.
- [x] Allow each academy administrator to publish or remove local support, privacy, legal notice and terms links. Confirm safe public display before sign-in and edit denial for learners in both editions.
- [x] Scope dedicated Caddy/Envoy routing to the installed academy domain. Both edition configurations were validated with pinned Caddy and active TLS in isolation. CMS aliases remain in the internal edition.
- [ ] Confirm the customer's domain and DNS, public TLS and redirects, Auth callback URLs, verified sender and installed PWA cache on the independent target.

A temporary external HTTPS receiver passed the pinned TLS preflight and signature validation for a real course publication from each Academy edition. The receiver and its fictional records were deleted after verification. Both editions also sent one actual fictional enrolment notice through a disposable external SMTP provider. Independent mailbox readback verified the exact message IDs, language and absence of private course data.
- [x] Provide private SMTP administration for confirmed local administrators with encrypted credentials and exact TLS/STARTTLS connection checks. Verify saved configuration, refusal after role loss and read-only grace in both editions.
- [x] Render academy issuer, footer, metadata and accent colour on generated completion and attendance PDFs. Confirm exact issued-brand retention and separate current report branding in both dedicated editions.
- [x] Use neutral account identifier labels in both customer editions across profile, account and learner-management views. Keep the operational label in the CMS edition.
- [ ] Remove unnecessary Luminovia branding from all customer-facing surfaces; retain mandatory legal notices.

### WL-04 — Full API, username login and Swagger (P0)

- [x] Username or verified email with password sign-in resolves to the same Auth identity. Both editions passed native sign-in, alias edits and private account settings.
- [x] Send the automatically assigned username with the one-time invitation. Require a personal password before opening protected resources and support verified-email or username sign-in after setup. Initial passwords supplied by administrators require a first sign-in change.
- [x] Provision confirmed company contacts for one organisation. Allow them to request learner invitations from their own courses under the shared licensed seats and invitation budgets, with a scoped and opaque receipt.
- [x] Provide staged native authenticator pairing and enforce current TOTP proof for administrators and owners when the installation opts in. Support SMTP security notices about factor changes.
- [x] Publish the edition-specific versioned OpenAPI download and authenticated Swagger UI. Academy OpenAPI 1.30 records the actual Envoy `429` and Caddy maintenance `503` response formats with `Retry-After` alongside business responses. Verify the pinned ingress in both editions and preserve the historical signed 1.29 catalogue. The optional fictional sandbox remains available in signed customer packages.
- [x] Run the published course-index, idempotent enrolment and separate aggregate report examples against the Edge handler. Verify credentials, error bodies and argument validation. [Integration examples](scripts/examples/README.md)
- [x] Provide tested examples for local account invitations, company-scoped learner invitations, authorised course draft inputs and exact retry of course creation.
- [ ] Finish exact-release request, response and error coverage across HTTP, file transfers, Realtime and notifications.
- [x] Provide organisation-scoped signed course webhooks in both dedicated editions. Local administrators can configure subscriptions, revoke and reissue signing keys, and inspect delivery history. The shared worker retries stable event IDs and checks the licence and exact release before delivery.
- [x] Check the configured receiver's public DNS resolution and pinned TLS certificate for one alias before processing deliveries. The local TLS fixture exercises successful verification, a hostname mismatch and refusal of private or mixed DNS results.
- [x] Issue, rotate and revoke course-index credentials for one academy organisation. Native HTTP and Chromium verify the exact published-course scope and current revocation.
- [x] Keep course-alert email opt-in and off at installation by default. The private relay rechecks current rights, licence release, quiet hours and provider configuration before sending.
- [x] Issue a separate key for aggregate course reports or enrolment of existing confirmed organisation participants. Keep course-index keys and webhook signing secrets separate. Dedicated PostgreSQL tests cover both editions, cross-organisation denial, current issuer authority and exact retry.
- [ ] Verify external receiver onboarding on an independent customer installation.

### WL-05 — Self-hosted installation & update lifecycle (P0)

- [x] Customer-neutral runtime configuration and secret generation, independently scoped Compose and storage, explicit ingress and first-install staging of the exact signed licensed browser. Both built editions passed the isolated CLI, pinned Caddy/Envoy TLS and signed API allowance checks. [Installation runbook](deploy/academy/README.md)
- [x] Boot both fresh dedicated backends independently. For baseline `ef8a724f`, each private Compose stack started ten healthy services, replayed 259 migrations and activated the exact signed licence. Both confirmed a first administrator in native Auth and enabled the course profile.
- [x] Signed browser replacement, exact-source database migration and independent encrypted backup and restore commands. Initial browser staging, replacement and licence renewal apply explicit public-file modes under a private operator umask. Local verification includes retained sign-in, course enrolment, Storage bytes and a new isolated recovery target.
- [x] Replay the verified historical release in both dedicated edition databases with independent signed licences. Confirm that the exact retained participants, enrolments, private course chat and protected file metadata remain usable under current permissions.
- [ ] Independent full-stack startup and health confirmation on the final target, issuer-to-operator onboarding, DNS and ACME, real SMTP delivery and the full Docker upgrade and recovery rehearsal.
- [x] Read the dedicated installation, exact licensed revision, licence and course-profile state and latest migration ledger entry from the private operator command.
- [x] Provide a private local health command for either licensed edition. It checks the staged release, database licence and ledger, Docker service state, scanner signatures and encrypted recovery receipt. [Monitoring runbook](deploy/academy/README.md#monitor-a-dedicated-installation)
- [x] Produce and check a cold encrypted archive on a running local customer installation. The real Docker health report validates the backup digest, migration ledger and scanner. Recovery tests restore the expected Caddy volume modes into an empty target.
- [ ] Connect the report to the final target's monitor and rehearse support, maintenance and incident response.

### WL-06 — Licence sales & fulfilment operations (P1)

- [x] The private vendor registry records approved customers, editions, domains, capacity, support agreement references and the exact terms and signed envelope for each issuance. A serialised approval ledger supports initial trial and licensed terms, registration of an existing trusted licence, trial conversion and renewal. The seller can export the exact recorded licence for delivery. [Issuer runbook](deploy/academy/README.md#issue-convert-or-renew-a-customer-licence)
- [x] Preview and confirm the reviewed private fulfilment record bound to the exported licence and signed deployment handover. Handle concurrent confirmation, exact retries and historical receipts across renewals.
- [ ] Obtain commercial authorisation and complete the external customer handover.
- [x] Signed licence validation on the exact release with active, read-only grace and expiry gates. Local administrators can review validity, occupied and available seats, retained storage and the signed API allowance. Seat, Storage and ingress limits apply at their owning server boundary.
- [x] Apply a renewed licence and revised ingress allowance while keeping the exact browser release, existing course profile and retained customer data. Both editions passed the local licence and fresh PostgreSQL replacement checks. [Renewal runbook](deploy/academy/README.md#apply-a-renewed-licence-on-the-same-release)
- [x] Export a portable encrypted course, participant and approved-file archive after licence expiry. PostgreSQL and pinned Storage verify private role denial, isolation, direct attendance evidence and actual file bytes. [Customer export runbook](deploy/academy/OFFBOARDING.md)
- [ ] Rehearse issuance, renewal and offboarding with the customer's independent installation, operator and publication policy.
- [x] Prepare customer-neutral, editable [licence, operations/support and handover templates](docs/customer-handoff/README.md).
- [ ] Approve written customer licence/terms, third-party and historical licensing rights, security/privacy/retention responsibilities and the final support agreement for the particular customer.

### WL-07 — Managed branded hosting (P1)

- [x] Ship isolated managed academy runtime configuration, independent backups and local monitoring, configurable mail and scanner services, and a signed exact-release upgrade path.
- [ ] Verify live managed provisioning and infrastructure isolation, provider delivery, scheduled backups and monitored upgrades on an independent customer target.
- [ ] Contractually defined customer versus vendor responsibility, support authorisation and issue response; no blanket vendor access to private learner data.
- [ ] Domain handover, controlled migration from self-hosted to managed or reverse, and tested offboarding.

### WL-08 — Optional future expansion (separate roadmap review)

- [ ] Shared multi-tenant SaaS, online course payments/ecommerce, SCORM/xAPI/LTI, enterprise SSO/SAML/OIDC provider flows, richer assessment engine, additional languages, usage metering and reseller programme. Each requires separate threat modelling, architecture and acceptance.

### WL-09 — Final product acceptance (P0)

- [ ] All `WL-T01–WL-T41` tests below implemented and passing on actual target edition(s) with all required repo application/security CI green on the exact release commit.
- [ ] Real customer-neutral staging installer, independent upgrade + restore drill, verified licence and module gates, accurate docs, complete UI/API security, domain/TLS/SMTP/PWA and onboarding/offboarding acceptance.
- [ ] Commercial distribution only after written licensing/support/legal and operational approval. No premature customer rollout.

## 14. Mandatory acceptance test matrix

**All checked tests must be executable in canonical CI or a documented, independently reviewable operational test.** Preserve the existing `./portal check`, `./portal test`, migration, API and Playwright stacks; add edition matrix rather than replacing their current checks. Run exact-release commit verification for both internal and white-label configurations.

| Test ID | Test scenario                                   | Required assertion                                                                                                                                                                                                                                                                             |
| ------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WL-T01  | Internal edition upgrade regression             | Existing Luminovia marketplace, Premium admin-only switch, contract and finance behaviour preserved                                                                                                                                                                                            |
| WL-T02  | White-label edition provisioning                | LMS included, company Premium switch absent, licence/edition trusted at server                                                                                                                                                                                                                 |
| WL-T03  | Disable broker features                         | Job marketplace, global company procurement and Luminovia commission APIs denied, not only hidden                                                                                                                                                                                              |
| WL-T04  | Direct customer course creation                 | Customer admin can create/run a course without marketplace offer or Luminovia framework agreement                                                                                                                                                                                              |
| WL-T05  | Direct local lecturer assignment                | Existing course/session membership and permission recalculated, no brokerage claim required                                                                                                                                                                                                    |
| WL-T06  | Dedicated LMS excludes lecturer finance         | Role navigation, direct routes and API deny rates, lecturer fees, invoices and payments in both Academy editions. Local teaching and enrolment remain available.                                                                 |
| WL-T07  | Vendor billing and licence boundary             | Local customer admin cannot issue licence, alter signed edition, access vendor invoices or another instance                                                                                                                                                                                    |
| WL-T08  | Unique customer identities/data                 | No copied Auth accounts, SQL records, Storage objects, server keys or Luminovia production secrets                                                                                                                                                                                             |
| WL-T09  | Customer first admin invitation                 | Valid signed customer invitation and safe password setup; no permanent demo password                                                                                                                                                                                                           |
| WL-T10  | Internal and external role escalation           | Company managers and integration identities cannot impersonate vendor or installation superuser                                                                                                                                                                                                |
| WL-T11  | Username/email login parity                     | Both identifiers authenticate the same authorised Auth account, existing email-only users unaffected                                                                                                                                                                                           |
| WL-T12  | Password policy and brute-force                 | 7 rejected; 8 accepted; throttling, recovery and nonenumeration tests pass                                                                                                                                                                                                                     |
| WL-T13  | Username conflict/rename                        | Case-normalised uniqueness, reserved names and concurrent conflicts handled                                                                                                                                                                                                                    |
| WL-T14  | API token flow and expiry                       | Password exchanged for short-lived token; expired/revoked token denied; no password-as-key reuse                                                                                                                                                                                               |
| WL-T15  | Scoped integration credentials                  | Separate service identity permissions, key rotation/revocation and audit working                                                                                                                                                                                                               |
| WL-T16  | Complete API operation inventory                | Every supported edition UI business action has correct documented API or justified exception                                                                                                                                                                                                   |
| WL-T17  | OpenAPI contract accuracy                       | Schemas, methods, status and error responses match live handlers; version checks fail on drift                                                                                                                                                                                                 |
| WL-T18  | Swagger UI interactive use                      | Correct edition/API version, Authorize, try-it-out with permission; no visible secrets                                                                                                                                                                                                         |
| WL-T19  | API across roles                                | Learner, lecturer, manager, customer admin, unauthorised actor get exact permitted/denied responses                                                                                                                                                                                            |
| WL-T20  | API idempotency & concurrency                   | Duplicate enrolments/creates and stale writes prevented; bounded pagination/rate limit/errors correct                                                                                                                                                                                          |
| WL-T21  | API file scanning & exact bytes                 | Only clean, current, permitted course documents accessible; malware/bad MIME quarantined                                                                                                                                                                                                       |
| WL-T22  | API webhooks                                    | Signed/deduplicated/revocable scoped delivery; retries and reordering have defined safe outcomes                                                                                                                                                                                               |
| WL-T23  | Academy logo/name/favicon/PWA                   | Branded shell, title, icon, install name and both themes. Publish, replace and restore all PWA variants, then verify refresh of an existing installation on supported devices.                                                                                                                                                                                                                    |
| WL-T24  | Branding across PDFs, email, help, Swagger      | Customer assets/labels shown correctly and required legal credits retained                                                                                                                                                                                                                     |
| WL-T25  | Customer custom domain/TLS                      | Verified ownership, correct certificate, Auth callbacks, CORS, cookies and origin checks                                                                                                                                                                                                       |
| WL-T26  | Brand asset upload safety                       | Invalid/malicious assets fail; versions, scan, size limits and cache invalidation enforced                                                                                                                                                                                                     |
| WL-T27  | Standalone course chat                          | Eligible memberships, revocation, chat files and private-DM boundary enforce current permissions                                                                                                                                                                                               |
| WL-T28  | Course exams/attendance                         | Teacher/company file visibility, student solution denial and roster privacy remain correct                                                                                                                                                                                                     |
| WL-T29  | Cross-instance isolation                        | Account IDs/API keys/Storage paths/search/WebSocket cannot read another customer's data                                                                                                                                                                                                        |
| WL-T30  | Multi-company participant rules where supported | Exact owned course scope preserved, one company disabling access does not disable another's unrelated access                                                                                                                                                                                   |
| WL-T31  | Installation retries/failures                   | Provisioning is idempotent, partial failures safe, no orphaned active instance or secret disclosure                                                                                                                                                                                            |
| WL-T32  | Customer backup/restore                         | Independent PostgreSQL/Auth/Storage/secrets restore with matching hashes and permissions                                                                                                                                                                                                       |
| WL-T33  | Customer updater and migrations                 | Exact signed release, forward migrations once, retained database, rollback boundary documented                                                                                                                                                                                                 |
| WL-T34  | Unsupported licence/expiry/grace                | Server module enforcement follows documented policy without deleting customer data                                                                                                                                                                                                             |
| WL-T35  | Branding/privacy accessibility                  | DE/EN, desktop/mobile, keyboard, screen reader, colour contrast and dark/light themes pass                                                                                                                                                                                                     |
| WL-T36  | First installer/hosted operations               | Health, SMTP, scanner, Storage, monitoring, quotas, backups and actual deployed revision verified                                                                                                                                                                                              |
| WL-T37  | API backward compatibility                      | Existing supported SDKs/integrations survive nonbreaking update; deliberate breaks versioned/documented                                                                                                                                                                                        |
| WL-T38  | Customer data export/offboarding                | Authorised own course/participant/file data export and no cross-instance data in package                                                                                                                                                                                                       |
| WL-T39  | Vendor support opt-in                           | Support access requires current customer authorisation, expiry, audit; no default blanket private access                                                                                                                                                                                       |
| WL-T40  | Final release verification                      | All required application+security CI green for exact customer artifact; independent signoff and documented risks                                                                                                                                                                               |
| WL-T41  | Internal and optional customer LMS demos         | Verify that the internal demo uses fictional data. Verify brand, roles, local-only actions, responsive layout and PWA in both opted-in customer builds, plus absence of the route and demo assets when disabled. |

## 15. Definition of Done / release gate

- [ ] Base `ROADMAP.md` has reached documented accepted completion **before** these white-label changes are considered a finished deliverable.
- [ ] Internal edition passes all existing regression tests after edition extraction; no lost contracts, invoices, permissions or job claims.
- [ ] Customer product creates/operates courses, exams, attendance, participants, group chat, materials and APIs without global Luminovia brokerage.
- [ ] Customer administrator configures own name/logo/favicon/PWA/domain/themes/email and permitted local controls; Luminovia/vendor business settings hidden AND server-denied.
- [x] The internal edition retains its branded `/demo`. Both dedicated editions support a separate customer-branded sandbox at `/demo` when the operator opts in for the signed build. Locally signed packages passed the desktop and mobile demo and Chromium installability checks. The default package omits the public demo.
- [ ] Username OR email + password login and short-lived API tokens verified. OpenAPI + Swagger UI covers every supported edition action and matches reality.
- [ ] Customer installations have independently protected data, keys, backup/recovery, software licensing, updates and offboarding.
- [ ] `WL-T01–WL-T41` are passing on the actual exact release commit and targeted hosting scenario. CI cannot be bypassed; no test is claimed run without evidence.
- [ ] Third-party rights and customer licence, security/privacy, production operating responsibilities and service contract reviewed and approved.

**Implementation-agent rules:** Read `AGENTS.md`, `ROADMAP.md`, `PRODUCT.md`, `DEVELOPMENT.md`, `OPERATIONS.md`, relevant owning code/migrations/tests, and this file. Check source/main/PRs/CI before touching code. Allocate a focused PR per reviewed workstream, document exact code/tests/risks, keep existing migration bytes immutable, do not wipe real data or prematurely publish hosted services. Maintain one coherent codebase with explicit edition boundaries. Do not mark a checklist item complete
merely because documentation or source for it exists.
