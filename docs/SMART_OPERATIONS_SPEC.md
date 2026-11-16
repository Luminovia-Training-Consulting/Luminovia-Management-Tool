# Smart operations — approved product extension

Requested on 16 November 2026 (Australia/Brisbane). This extends the verbatim [master specification](UNIVERSAL_MASTER_PROMPT.txt) and [accounts specification](ACCOUNTS_REVENUE_SPEC.md); it does not replace either with a reduced product. All items below remain target scope. Existing means inspected source, not a new production acceptance. New source remains subject to the current integration evidence in WORKLOG/QA_RESULTS.

## Delivery and communication

Hostinger Mail, with `info@luminovia.org` as the intended sender, supplies application email. Credentials belong only in private server configuration. The supplied chat credential has deliberately not been copied to source, examples, logs or documentation. [Worker and activation](NOTIFICATION_MAIL_OPERATIONS.md).

Notifications must originate from committed business events, including cancellations, confirmed claims, matching/reopened jobs and due session/contract reminders. In-app receipts remain available independently of optional external channels. Users choose categories, email opt-in, quiet hours and their intended IANA time zone. Before dispatch, validate the current recipient, active account and current preferences. Retry known temporary failures with bounded backoff; ambiguous SMTP acceptance requires reconciliation, never blind resend. SMTP acceptance is not proof of inbox delivery. Push must later use per-device consent, removable subscriptions, minimal generic payloads and honestly documented platform support; no universal mobile-delivery promise.

Lecturers should offer contact options using their selected business email and phone, with intentional visibility. Existing private Auth/contact data must not become directory-wide by an administrative bypass. Explicit opt-in sharing, current staff eligibility and safe mailto/tel actions preserve that boundary.

## Complete requested feature map

| Requested capability | Inspected baseline / this implementation | Remaining target and acceptance |
| --- | --- | --- |
| Notification Center, smart alerts, automatic email | Existing own inbox/category preferences; new durable email outbox, opt-in/quiet hours, generic DE/EN Hostinger worker and bounded automatic reminders | Actual authorised server activation/provider delivery and queue monitoring; additional event categories as their workflows land |
| Mobile/PWA Push | Existing installable shell and safe offline fallback | Consent/device subscription, Web Push delivery/revocation, platform acceptance; no push service is represented as running |
| Personal dashboard | New account-private show/hide/order for preview cards, server persistence and conflict detection | Extend configurable operational widgets as their underlying workflows become available |
| Course feedback and quality management | Existing completed-enrolment reviews with history and permissioned moderation | Customer evaluation, quality trends, follow-up actions and closure workflow |
| Unified global search | Existing permission-filtered jobs/files/wiki/forum/chat/people search | Complete authorised course/customer/task/contract metadata search, stable pagination and filters; never index private content through admin bypass |
| Timesheets and invoice preparation | Existing claim-derived invoice preparation, original-currency earnings and PDF/payment tracking | Enter/review actual hours per teaching day, period totals, immutable approved timesheets linked to invoice preparation; no tax/payroll engine |
| Client self-service | Existing scoped accounts, organisation membership, course requests, assigned teachers and spend | Request documents/hours detail, preparation progress, agreed materials/reports, programme evaluation and repeat booking |
| Course preparation checklist | New personal assignment checklist for materials, venue/link and contact readiness | Shared course/customer milestones, evidence and completion history with explicit customer visibility; personal tick boxes are not shared completion proof |
| Reusable demo course | Existing fictional local/CBW catalogue fixtures | Use an explicitly selected owned reference for a complete demo workflow; do not import personal students/customer records or alter teaching-material delivery rules |
| Comprehensive Control Center | Existing authorised dashboard follow-ups, job board, requests and finite administrative audit | Unified unstaffed courses, missing documents, cancellations, overdue tasks, request pipeline and actionable filters |
| Reusable workflow templates | Existing reusable course templates, no general workflow engine | Versioned preparation/task templates, safe instantiation and ownership |
| Bulk actions | Existing bounded specialised batches, not a general task/course bulk UI | Preview selected records, capability/revision checks, per-item outcomes and recoverable mistakes |
| Certificate/contract expiry | Existing qualification expiry eligibility and personal contract reminders; new scheduled email reminder source | Evidence-linked qualification passports, certificate expiry monitor and authorised management follow-ups |
| Advanced financial forecasting | Existing immutable original-currency fees, platform splits, earnings and revenue | Clearly labelled forecast scenarios, timing assumptions, cancellations/probability and currency-separated projections |
| Advanced change history | Existing immutable commercial/claim history, wiki/file revisions and capability-scoped audit | Resource timeline, field-level safe changes, authorised comparison/export and retention |
| My Teaching Day | New own committed current-day sessions in profile zone, safe teaching link, authorised files and personal preparation | Explicitly shared customer contact and broader agreed course resources; no private contact bypass |
| Find a replacement | Existing audited whole-assignment cancellation/reopening, preserving accepted snapshots | Qualified available substitute proposal/acceptance and atomic transfer with consent, resource/calendar revocation and new immutable deal |
| Assignment waitlist | Not implemented | Join/leave once per account/job, notified availability, capacity/race tests; waiting never pretends to reserve a place or bypass claim validation |
| Smart job recommendations | Existing final-transaction topic/qualification matching notifications | Explainable ranking with availability, qualifications, favourites and deadlines; final claim always revalidates |
| Calendar files/subscriptions | New authenticated, fresh bounded personal ICS snapshot; UTC instants, original zone metadata; private events require explicit inclusion | Revocable read-only subscription tokens, scoped calendar feeds, caching and Google/Outlook/manual platform acceptance |
| Qualification passport | Existing expertise/verification/expiry and scanned private evidence | Structured qualifications, exact evidence versions, expiry monitoring and intentional share/export |
| Personal earnings | Existing own expected/completed/invoiced/paid totals and invoice preparation | Scoped period statements and richer trends; preserve accepted compensation and original currencies |
| Favourite customers/topics and saved filters | Not implemented | Private persisted favourites, named versioned filters and recommendation integration |
| Customer course requests | Existing title/topics/dates/delivery/fee/session request pipeline | Required hours/documents, explicit preparation requirements and request revision history |
| Customer preparation tracking/course area | Existing resource-scoped course information and assigned lecturer | Agreed milestones/materials/contact projection and organisation-isolation/revocation tests |
| Customer evaluation/reports/repeat booking | Not implemented as complete workflows | Post-course review; authorised attendance/deliverable downloads; new request from past course without copying personal attendance/contracts |
| Participant current course | Existing explicitly managed enrolments and scoped course/lecturer information | Cohesive participant start page with current agenda and authorised resources |
| Digital attendance | Not implemented | Timestamped self check-in/lecturer correction with audit, eligibility and customer report permissions |
| Participant Q&A/course chat/notebook | Existing separate participant course chat and forum basics | Course Q&A, personal/course notebook and exact visibility rules |
| Anonymous feedback | Existing eligible reviews hide author identity from ordinary readers | Separately specified anonymity policy and aggregate thresholds; current backend-linked reviews are not claimed truly anonymous |
| Mini quiz and completion document | Not implemented | Authored question sets, attempts/evaluation, completion rules and scoped generated/downloaded certificate; no fabricated completion |
| Chat messages into tasks | Not implemented | Explicit message-linked task creation, assignee/due date/status and ongoing access checks; no private DM content copied into wider tasks |
| Document versioning and acknowledgement | Existing scanned version/hash history and contract-version receipt | General document acknowledgement against exact versions, deadlines and authorised outstanding acknowledgements |
| Offline-ready schedule | Existing offline shell only | Explicit opt-in minimal schedule snapshot, visible freshness, account/logout clearing and threat-modelled device storage; private files/messages never broadly cached |

## Validation and rollout boundaries

Every implemented vertical requires real PostgreSQL ownership/concurrency tests, authenticated REST checks and desktop/mobile DE/EN browser journeys. External delivery additionally requires a specifically authorised provider test recipient and review of Hostinger quota/DNS deliverability prerequisites. Source tests and local loopback SMTP do not establish live delivery, physical PWA installation, production rollout or legal compliance.

Keep source, migration history and native acceptance independent from the concurrently developed preview/welcome/role work. Integration with that work must preserve both branches and rerun the combined gates. The public Website repository, production data, DNS and real mailboxes are outside these source changes.
