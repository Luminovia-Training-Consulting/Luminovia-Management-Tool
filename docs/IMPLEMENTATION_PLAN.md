# Persistent implementation plan

Updated: 16 November 2026 (Australia/Brisbane). On continuation read [WORKLOG](WORKLOG.md), then the verbatim [master specification](UNIVERSAL_MASTER_PROMPT.txt), source and actual test evidence. The full target remains required. A local working slice is not production approval.

## Current checkpoint — persistent full local system and M2

M1 is locally verified and was merged by Carina in PR #1. This continuation is on `codex/local-system-and-collaboration` in [draft PR #2](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/2). This continuation adds a single-command persistent local runtime and complete isolated verification command, followed by actual collaboration, documents, knowledge, directory/course and commercial slices. The complete isolated command passed: 42 source, 7 runtime, 11 Edge, 78 SQL, all actual API/Mailpit suites, 40 browser workflows and 2 built-PWA checks. A later visual hidden-input overflow correction has a separate targeted acceptance record; exact submitted source is verified by CI. See WORKLOG/QA_RESULTS. No mocked authentication or decorative module placeholders are used.

| Work item | Implemented slice | Acceptance source |
| --- | --- | --- |
| Persistent local runtime | `./portal start/up/status/stop/restart/credentials`; real PostgreSQL/Auth/Storage/Realtime/Edge/Mailpit/ClamAV/Vite, no startup reset | Actual password/MFA/profile/private-event/object-byte restart probe; runtime safety tests |
| Isolated complete verification | `./portal test`, random project, separate credentials/ports/volumes, scoped cleanup; CI same command | Complete invocation result in latest work log |
| Core M1 | Auth/invites/MFA, roles, profiles/expertise, managerial verification/suspension, single-slot atomic jobs, private calendar | Original 22 source / 25 SQL / 7 Edge / 20 browser / 2 PWA checks; regressions retained |
| Private documents | Actual scan/quarantine, limits, live-authorised download, preview, immutable version history, replace/rename/archive, profile evidence and job/chat attachments | Real Auth/Storage/ClamAV API, SQL and browser checks; scanner outage included in isolated suite |
| Realtime chats | DMs, groups/general/separate course rooms, membership, persisted messages/reactions/history/search/read/mute, files | 17 real SQL cases, actual WebSocket positive/revocation/suspension tests, component/browser flows |
| Wiki/forum | Safe rich-text/code editor, draft/publish/history, categories, threads/replies/accept/report/lock/pin/archive/subscriptions | 14 real SQL cases, Auth/MFA API, content-boundary and browser checks |
| Customers/courses | Private directory/contacts/notes/tags/archive; reusable templates, real runs/sessions/publication/safe copy | 11 real Auth/MFA API cases, component/privacy/read-only checks plus isolated browser journeys |
| Contracts/finance | Executed PDF/version/hash/receipt/addenda, applicable-contract prerequisite, immutable earnings/invoice/payment records and scoped CSV | Commercial SQL/API/component and isolated browser checks recorded in latest work log |
| Global search/calendar | Permission-filtered jobs/files/messages/safe wiki/forum/contacts; explicitly published course sessions in global calendar | Real API boundaries plus desktop/mobile journeys; no search over private draft bodies |
| Managed staging | No connected project available at reconnaissance | Configuration/access pending; local work proceeds independently |
| Production | No deployment performed or authorised | Requires complete release gates and explicit approval |

## Full phase board

- [x] Phase 0: repository/environment and brand reconnaissance, verbatim project specification, persistent plan and work log.
- [ ] Phase 0: resolve managed staging/production project ownership, SMTP, EU region/privacy and approved hosting configuration.
- [ ] Phase 1: production-complete Auth lifecycle, invitations/admin MFA/revocation, all shell states, DE/EN/theme/mobile accessibility and PWA platform verification.
- [ ] Phase 2: complete profiles/evidence, editable verified expertise taxonomy, customer/contact directory, reusable courses/runs/sessions, job filters/saved views/Kanban/attachments/capacity, robust claims/cancellation/reopening/substitutes, private availability and published global calendar.
- [ ] Phase 3: secure realtime DMs/groups/course channels, file centre/quarantine/scanning/versioning/revocation, wiki/forum and permission-aware global search, notification preferences/delivery.
- [ ] Phase 4: executed contracts/versioned acceptance, compensation/invoices/payment/export workflows, administration/audit/bulk recovery/retention and verification.
- [ ] Phase 5: full end-to-end/adversarial/accessibility/platform sweep, monitored staging acceptance, backups of DB and storage plus restore drill/rollback, operational handoff and separately approved production release.

## Module completeness ledger — full remaining scope

| Module | Current functioning slice | Required follow-up |
| --- | --- | --- |
| A Dashboard/navigation | Authenticated branded responsive shell, core metrics, all module routes, permission-filtered search, mobile More | Rich personalised matching, pending-contract/recent-file/calendar/chat widgets; authorised management availability/cost overview; extend resource search |
| B Users/Auth/profiles | Invites/recovery/MFA, roles, suspend/reactivate, bilingual profile/timezone/phone, expertise attestation, scanned CV/certificates | Avatar, detailed education/experience/country/languages/rate and visibility preferences; evidence-linked verification/expiry; role editor; full lifecycle/recovery hardening |
| C Taxonomy | Data-backed topic labels and selection, protected verification/expiry | Hierarchy/aliases/tools/languages/catalogue CRUD and related-course management UI |
| D Organisations | Search/edit/archive, types/industry/location/timezone/tags, permissioned contacts and private notes, linked course runs | Organisation-scoped files and richer topic/filter/contact actions; no automatic customer user accounts |
| E Courses | Reusable descriptions/syllabus/prerequisites/topics; actual customer/delivery/venue/precise sessions; safe duplicate and publication | Standalone participant-group administration, lecturer assignment/resource links, document/course navigation; independent split-job editor |
| F Jobs/claims | Combined list filters, details/current consent, single-slot whole-block transaction, immutable snapshot, pre/post-claim documents | Capacity >1, editing/duplication/deadlines UI, saved/advanced filters/sorting, accessible dnd-kit Kanban, audited cancellation/reopen/substitutes without changing accepted terms |
| G Calendar | Private event CRUD, confirmed jobs, explicit published courses/global data, month/week/day/agenda/timezone handling | Availability/block-out model/editor, global-event management, richer files/links, invitations/reminders and drag/edit as appropriate; ICS later |
| H Chat | Private DMs/groups/staff general and separate course participant rooms; persisted realtime/history/search/reactions/edit/delete/read/mute/files; immediate future-event revocation | Profile click-to-DM, mentions and corresponding deduplicated alerts; presence/typing if practical; disclosed moderation and richer group administration |
| I Files | Authenticated private scope, actual scanner/quarantine, validated PDF/Office/images/text, limits/progress, preview/download/version/hash/rename/archive, evidence/chat/job contexts | Course/organisation-specific resource UX, tags/folders/classification, sharing/expiry links, approved restricted archives, retention/purge tools; large videos stay external |
| J Contracts | Personal/master/addenda/version PDF/hash, immutable receipt (no signature claim), effective/expiry/revocation and claim prerequisites | Renewal reminders, assignment-confirmation documents, configurable privacy/legal/retention documents, approved legal/e-sign review if needed |
| K Wiki/forum | Safe Tiptap content/code language labels, DE/EN categories, wiki revisions/draft/publish, forum acceptance/subscriptions/moderation | Authorised attachments and course-template links, finer editorial workflow and richer search/presentation |
| L Finance | Original-currency expected/completed/invoiced/paid earnings; claim-derived invoice PDFs, review/reject, partial/full payments/void, scoped formula-safe CSV | Richer management client/course reports and downloadable statements; no payroll/accounting/tax/bank claims |
| M Notifications | Committed claim/chat/forum in-app records, unread/read and chat mute state | Full inbox links/preferences/quiet hours; matching/cancellation/contract/session alerts and announcement banners; durable approved email delivery/retry; web push later |
| N Administration | Invites/MFA/suspension/verification, customers/courses/job publication, knowledge/group owners, contracts/invoices/payments | Roles/capability/taxonomy/brand settings, audit/report/retention/bulk/recovery/status UI, operational backups and restore workflow |

## Next continuation actions

1. Check the exact latest [PR #2 CI](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/2) status when continuing; its run was pending at the signed documentation checkpoint. The complete local command and six later targeted attachment/overflow cases passed. Preserve the normal development records.
2. Reconcile docs, visually review current fictional screenshots, verify no server credentials in source/build, signed commit/push existing branch and observe the exact PR CI result. Never merge or deploy production implicitly.
3. Continue the outstanding vertical slices above, prioritising audited job lifecycle/capacity, availability, taxonomy/profile completeness and notification preferences over cosmetic additions.
4. Configure separate approved managed staging/SMTP only when access and ownership are available. Complete hosted/manual/cross-browser/physical-PWA, privacy, monitoring, DB + actual Storage restore and rollback acceptance before a concrete production approval request.
