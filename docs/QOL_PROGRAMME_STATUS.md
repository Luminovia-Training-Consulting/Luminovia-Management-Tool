# Quality-of-life programme status

Source: user-provided [QoL master prompt](QOL_MASTER_PROMPT.txt), preserved verbatim on 17 November 2026. This supplements, and does not replace, `UNIVERSAL_MASTER_PROMPT.txt`. The user requested one integrated PR rather than the source document's suggested focused PRs. Baseline inspected: main `08f65719ad2464b567809e3b27499f6c4fd01a23`. This is an initial inventory, not a completed feature-by-feature audit.

| Module / requirement | Observed status | Evidence and remaining work |
|---|---|---|
| Chat: direct/group/course rooms, member controls, message edit, reactions and moderation | Existing implementation; complete acceptance against the new prompt not yet assessed | `src/features/chat`, current migrations and tests. Audit lifecycle, permissions, deletion and realtime end to end. |
| Chat: copy message text | Implemented in programme branch | Component tests cover success, rejection and deleted message; `./portal check` passes 743 tests plus source/build checks. `./portal test` failed before database/API/browser acceptance because the isolated Deno binary was missing (ENOENT); full acceptance remains pending. No server mutation. |
| Group descriptions, invitations, ownership, discoverability, pinning, personal deletion, replies and other chat actions | Not yet classified | Compare each prompt item against current source, migrations, tests and active branches before implementing. |
| Contacts and profiles | Not yet classified | Audit visibility, actions, direct-message navigation and access controls. |
| Jobs, courses and calendars | Not yet classified | PR #37 separately implements withdrawal requests; assess its actual current status and avoid duplicate work. Audit all remaining actions and cross-module flows. |
| Documents, wiki and forum | Not yet classified | Audit CRUD, versioning, linkages, scanning and private access. PR #45 separately addresses personal contract access. |
| Administration, customers, contracts and finance | Not yet classified | Inspect existing authority and commercial history protections; PR #45 is relevant. |
| Notifications, preferences, common UX and PWA | Not yet classified | Audit individual notification categories, personal settings, navigation, accessibility, offline and responsive behavior. |
| Required test matrix | Incomplete | Map every feature to actual unit, database, integration, browser, security, language, theme and mobile/PWA results. Do not infer a pass from the presence of a test. |

Open PRs at initial inspection: #37, #43, #44 and #45. They may change independently; check current heads and main before integration. No PR or merge is claimed for this programme. Continue by completing the detailed inventory and implementing missing secure workflows, then run `./portal check`, `./portal test` and required exact-head CI and review. Real deployment, mail, production data and DNS remain outside the authorised scope.
