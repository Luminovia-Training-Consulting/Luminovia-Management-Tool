# Quality-of-life programme status

Source: user-provided [QoL master prompt](QOL_MASTER_PROMPT.txt), preserved verbatim on 17 November 2026. This supplements, and does not replace, `UNIVERSAL_MASTER_PROMPT.txt`. The user requested one integrated PR rather than the source document's suggested focused PRs. Baseline inspected: main `08f65719ad2464b567809e3b27499f6c4fd01a23`. The [454-item feature checklist](QOL_FEATURE_MATRIX.md) preserves individual requests; most items remain unassessed. This is not a completed feature-by-feature audit.

| Module / requirement | Observed status | Evidence and remaining work |
|---|---|---|
| Chat: direct/group/course rooms, member controls, message edit, reactions and moderation | Existing implementation; complete acceptance against the new prompt not yet assessed | `src/features/chat`, current migrations and tests. Audit lifecycle, permissions, deletion and realtime end to end. |
| Chat: copy message text | Implemented in programme branch | Component tests cover success, rejection and deleted message; Initial `./portal test` failed before database/API/browser acceptance because the isolated Deno binary was missing (ENOENT). The exact-version approval fixed clean installation; a rerun completed full local acceptance including real SQL/API, 164 browser and four PWA cases on the earlier frozen source (`.local/tests/7fdfb692/RESULT.txt`). The combined source passes `./portal check` with 765 frontend tests plus source/build checks; full integrated acceptance remains pending. No server mutation. |
| Group descriptions, invitations, ownership, discoverability, pinning, personal deletion, replies and other chat actions | Not yet classified | Compare each prompt item against current source, migrations, tests and active branches before implementing. |
| Contacts and profiles | Not yet classified | Audit visibility, actions, direct-message navigation and access controls. |
| Jobs, courses and calendars | Not yet classified | PR #37 separately implements withdrawal requests; assess its actual current status and avoid duplicate work. Audit all remaining actions and cross-module flows. |
| Documents, wiki and forum | Not yet classified | Audit CRUD, versioning, linkages, scanning and private access. PR #45 separately addresses personal contract access. |
| Administration, customers, contracts and finance | Not yet classified | Inspect existing authority and commercial history protections; PR #45 is relevant. |
| Notifications, preferences, common UX and PWA | Not yet classified | Audit individual notification categories, personal settings, navigation, accessibility, offline and responsive behavior. |
| Required test matrix | Incomplete | Map every feature to actual unit, database, integration, browser, security, language, theme and mobile/PWA results. Do not infer a pass from the presence of a test. |

Open PRs at initial inspection: #37, #43, #44 and #45. They may change independently; check current heads and main before integration. No PR or merge is claimed for this programme. Continue by completing the detailed inventory and implementing missing secure workflows, then run `./portal check`, `./portal test` and required exact-head CI and review. Real deployment, mail, production data and DNS remain outside the authorised scope.

## Initial cross-module source review

These observations identify code to verify; they do not assert whole-workflow acceptance:

- Contacts and profiles provide directory, direct chat navigation, course/expertise references and contact links (`src/features/people`); existing contact-visibility controls cover email/telephone, with separately configurable qualification/document visibility still to assess.
- Job discovery has saved filters and several sort options; customer/topic sort is not present in its current schema (`src/features/jobs/discovery-api.ts`). PR #37 owns the separate short-notice withdrawal request.
- Personal and published calendars, ICS/subscriptions and optional offline schedule exist (`src/features/calendar`). The existing guide explicitly lists global-event attachments/invitations and private drag editing as pending. Course templates/runs, readiness and delivery are present (`src/features/operations`, `readiness`, `delivery`); cross-module actions need individual checks.
- Document scanning, search and personal tags, wiki publication/versioning, and forum discussion/moderation exist (`src/features/files`, `knowledge`). The user guide lists wiki/forum attachments and course-template references as pending. Personal organisation is not evidence of shared document move support.
- Administration, contracts and invoice workflows exist (`src/features/admin`, `commercial`); PR #45 separately changes contract access. Review bulk, renewal and retention actions individually.
- Notification inbox, read state, categories, quiet hours and push settings exist (`src/features/notifications`). These are not evidence of actual email or device delivery.

### Attachment boundary

Existing room-scoped files may have independent uses or multiple message references. The new message-only attachment design distinguishes newly reserved chat uploads from old room-shared files; the latter keep their original access rules. An isolated PostgreSQL suite passed on the candidate implementation, including reservation concurrency, deletion/re-send and readiness checks. HTTP, download-race and browser acceptance remain pending. Access revocation is not a claim that downloaded copies or backups are erased.
