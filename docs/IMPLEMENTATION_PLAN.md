# Persistent implementation plan

Updated: 15 November 2026 (Australia/Brisbane). Read [WORKLOG.md](WORKLOG.md) first on continuation, then the complete [master specification](UNIVERSAL_MASTER_PROMPT.txt). Status labels describe evidence, not aspiration. The full target remains required after the first usable milestone.

## Current milestone — M1: secure teaching-job allocation

**M1 is complete and verified as a local development milestone. The complete production product remains unfinished.** Includes the authentic responsive DE/EN shell and PWA foundation, actual Supabase Auth/session handling, own profile/expertise, permissioned customer/course/job creation and publication, combined job search/detail, atomic whole-job claiming with immutable terms, private calendar/confirmed allocations, invitations/MFA, managerial expertise attestation and account suspension/reactivation. Capacity one is the first testable slice; multi-slot jobs, cancellation and substitutes remain explicit follow-ups. No browser fake-login path in delivered application.

| Work item | Status | Exit evidence |
| --- | --- | --- |
| Inspect repository/environment and preserve original work | Complete | Existing management repository selected; original `main` commit `1a61cb0`; work on `codex/portal-foundation`. |
| Preserve authoritative prompt and continuation instructions | Complete | Verbatim prompt plus root `AGENTS.md`. |
| Verify actual brand/assets without modifying marketing site | Complete | Remote `Website` main SHA and file hashes in brand guide. |
| Foundation app, localised shell, forms, theme and PWA | Verified locally | 22 source tests, 20 desktop/mobile workflows and 2 current-build PWA checks passed; scanned screens had no axe violations. Native installation remains unverified. |
| Actual Auth/session/recovery/invitation consumption | Verified locally | Actual Edge delivery/deduplication, custom token-hash invitation acceptance/password/new login and bilingual PKCE recovery passed. Hosted SMTP/template setup pending. |
| Profiles, roles/capabilities and expertise | Verified locally within M1 scope | Own bilingual profile persistence and declared/verified expertise; capability/MFA and forged-role/metadata checks passed at SQL/API/browser layers. Evidence uploads/full profile scope pending. |
| Customer/course/session/job creation and publication | Verified locally within M1 scope | Real administrator TOTP + five-session publishing UI passed; atomic related-record creation and denied lecturer writes tested. Independent full CRUD remains pending. |
| Atomic single-slot claim, retries, complete allocations and snapshots | Verified locally | 25 SQL tests, 50 distinct concurrent SQL actors/one winner; real 50-request Auth/REST race and desktop/mobile complete-block UI journey passed. |
| Own events, confirmed assignment calendar and timezone formatting | Verified locally within M1 scope | Real private-calendar browser path; admin/peer denial and races at DB/API; six time/DST/money tests passed. |
| Managerial verification and account lifecycle | Verified locally | Real desktop/mobile verification→suspend→existing-session denial→reactivate passed; 25 SQL tests include self/last-admin/race protection; 5 focused UI tests passed. |
| CI, security validation and deployment preparation | Local checks and GitHub application CI verified | Full-stack reset and disposable harness replay all three migrations; 25 SQL + 7 Edge + 22 source + 20 UI + 2 PWA checks passed. CI includes source/backend/browser with no deploy action; application CI passed for `6d0bbf2` and `22dc052`; final workflow-trigger cleanup is checked on PR #1. |
| Managed staging Supabase/environment | Blocked on configuration | Connected project inventory returned no projects. No hosted project provisioned. Local development can continue independently. |
| Production deployment | Not authorised | Requires completed release gates and explicit production approval. |

## Full phase board

- [x] Phase 0: repository/environment and brand reconnaissance, verbatim project specification, persistent plan and work log.
- [ ] Phase 0: resolve managed staging/production project ownership, SMTP, EU region/privacy and approved hosting configuration.
- [ ] Phase 1: production-complete Auth lifecycle, invitations/admin MFA/revocation, all shell states, DE/EN/theme/mobile accessibility and PWA platform verification.
- [ ] Phase 2: complete profiles/evidence, editable verified expertise taxonomy, customer/contact directory, reusable courses/runs/sessions, job filters/saved views/Kanban/attachments/capacity, robust claims/cancellation/reopening/substitutes, private availability and published global calendar.
- [ ] Phase 3: secure realtime DMs/groups/course channels, file centre/quarantine/scanning/versioning/revocation, wiki/forum and permission-aware global search, notification preferences/delivery.
- [ ] Phase 4: executed contracts/versioned acceptance, compensation/invoices/payment/export workflows, administration/audit/bulk recovery/retention and verification.
- [ ] Phase 5: full end-to-end/adversarial/accessibility/platform sweep, monitored staging acceptance, backups of DB and storage plus restore drill/rollback, operational handoff and separately approved production release.

## Module completeness ledger

| Module | First slice | Remaining required scope |
| --- | --- | --- |
| A Dashboard/navigation | Real local dashboard and core routes | Real chat/file/contract alerts, richer matching, admin KPI authorisation, global resource search. |
| B Users/Auth/profiles | Local own profile, Auth/MFA/invitation and suspend/reactivate slice | Production invites/SMTP, complete profile/evidence/preferences, admin lifecycle and security hardening. |
| C Taxonomy | Data-backed expertise selection and management attestation | Taxonomy CRUD/hierarchy/alias UI, uploaded evidence and evidence review lifecycle. |
| D Organisations | Customer records created with job blocks | Contact people/private notes/files/tags and full search/contact actions. |
| E Courses | Atomic template/run/session creation with job blocks | Full syllabus/content/groups/assignment UI and safe duplication. |
| F Jobs/claims | Locally verified single-slot whole-block flow | Multi-capacity allocation, advanced/saved filters, Kanban, attachment phases, cancellation/reopening/substitutes and complete audit workflows. |
| G Calendar | Own events, allocations and published-global-event read | Availability editor, published global events, rich event links/files, invitations/reminders and all views; ICS later. |
| H Chat | Pending | All messaging, membership/realtime isolation and revocation, attachments and moderation. |
| I Files | Pending | Private authorised storage, quarantine/scan limits, previews/versioning/expiry and retention. |
| J Contracts | Verified prerequisite/version metadata reference | Personal downloads, executed document/version/acceptance lifecycle and reminders. |
| K Wiki/forum | Pending | Authoring/revisions/search/code safety and permissioned moderation. |
| L Finance | Immutable accepted compensation snapshot | Earnings states, invoices/PDF/payment records and authorised CSV/reporting. |
| M Notifications | Committed-claim in-app notification/read state | Inbox/preferences/quiet hours, matching/session/email notifications and delivery retries. |
| N Administration | Job publishing, lecturer invitations, expertise attestation and account status | Role/capability editor, catalogue/moderation/report/retention/export, operational audit UI, backups and broader recovery tools. |

## Next continuation actions

1. Read the latest work-log entry and run the exact recorded verification commands against unchanged source to establish current health only when needed.
2. Check the actual GitHub branch/CI outcome if the latest work log has not yet recorded it. Local M1 source/browser/PWA and all-three-migration replay are verified; preserve these tests and fixes. Fresh fixtures are available without test claims/invitations/MFA factors.
3. Configure a separate managed staging Supabase project and transactional SMTP only with appropriate authorisation/access; apply versioned migrations, keep real data out of fixtures.
4. Extend the next complete vertical slice, preserving all outstanding scope above. Record exact tests and limitations. Do not call the entire product production-ready until Phase 5 acceptance is evidenced.
