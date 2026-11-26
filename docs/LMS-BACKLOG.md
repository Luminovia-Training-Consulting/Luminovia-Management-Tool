# LMS delivery backlog

This ledger tracks the educational-only LMS extension from the implementation directive. It extends the existing Luminovia course run, enrolment, assessment, document, attendance, certificate and analytics authorities; it does not create parallel registries. This document distinguishes source implementation, local verification, browser verification, external interoperability and production acceptance.

## Coordination and ownership

- Shared course, enrolment, migration and API ownership: LMS maintainers; migrations must preserve the existing `course_runs` and `course_enrolments` authority.
- Work packages are sequential at P0, then P1, then P2. Do not parallelise changes to shared grade calculations, enrolment versions or completion decisions without an assigned owner and agreed migration/API boundary.
- No AI functionality, privileged executable lesson HTML, production deployment, external provider activation or destructive migration is in scope.
- The first authoring implementation is in `0ef0eb77`; autosave verification is in `c51efa32`. The copy, move and narrow-preview follow-up is on the same branch, `codex/lms-p0-course-authoring`.

## P0 — essential professional LMS

### LMS-P0-01 — course authoring and immutable curriculum revisions

- **Priority / status:** P0 · partially implemented in source; locally verified by unit/component, PostgreSQL gateway and focused desktop/mobile Chromium tests; full browser and CI acceptance pending.
- **Existing implementation:** Course runs, course workspaces, enrolments, welcome content, scanned course resources and versioned quiz documents are authoritative and remain in use.
- **Delivered scope:** Course workspace authoring section; nested modules and lessons with objectives and duration; independently editable copies of modules or lessons; keyboard reordering and lesson moves between modules; existing Tiptap editor and sanitisation reused; wide and narrow participant previews; German/English labels; manual and automatic draft saving with stale-write rejection, a reload choice and unsaved-change warnings; immutable published JSON revisions; restore-as-new-draft; explicit per-active-enrolment migration; a stable course revision pinned to enrolments; revision audit events.
- **Affected modules / data:** `src/features/learning/{learning.tsx,course-authoring.tsx,course-authoring-schema.ts,api.ts,i18n.ts,learning.css}`, `private.course_content_{drafts,revisions}`, and additive `course_enrolments.course_content_version` with FK and enrolment trigger. Public RPCs are `course_content_studio` and `course_content_action`.
- **Security and dependencies:** RLS-enabled private tables have no client grants; RPCs recheck current course context, LMS entitlement and staff authority; Academy path retains active/grace read gates and active-only writes; private drafts/history are never projected to learners; link schemes and editor node/size/depth limits are validated both client- and server-side. Existing course files remain on their scanned exact-version gateway.
- **Implementation tasks:** Extend the initial editor into the full block/resource authoring requirements; add module/lesson archiving, schedule/approval workflow, content comparisons, and integration with the reusable library; complete responsive/accessibility review.
- **Acceptance and tests:** Unit tests cover sanitisation, independent copy IDs and bounded moves; component tests cover editing copies, draft isolation, narrow preview, save, publish and explicit migration; PostgreSQL tests cover stale draft, hidden draft, version pinning, completed enrolment preservation, restore, migration, unsafe URLs and revoked membership; browser test covers create → copy → move → auto-save → publish → learner view. Full DE/EN, retained-data CI and accessibility acceptance remain required.
- **Actual results:** The follow-up passed all 1,914 local unit/component tests (44 focused), TypeScript and lint. The earlier isolated PostgreSQL replay passed the authoring integration suite, all 11 API-surface checks and active/grace/expired Academy gateway tests for both editions. The targeted author-to-learner flow passed on desktop and mobile Chromium against a fresh isolated Supabase stack. The complete browser run reached 34 passing desktop cases before cancellation at the time limit; it was not accepted. CI and production acceptance are not claimed.
- **Commits / limitations:** See the branch and implementation commit above. Scope is modules/lessons only; not all required block types, programme hierarchy, editor collaboration, approval, scheduling or library reuse are implemented.

### LMS-P0-02 — shared educational content library

- **Priority / status:** P0 · partially implemented on the separate `codex/lms-p0-material-catalogue` branch; this gradebook change does not include it.
- **Dependencies / affected modules:** LMS-P0-01 and existing document/version/virus-scan owners; `src/features/learning/resources.tsx`, document discovery and secure course-document gateways; additive metadata/indexing only after defining canonical resource ownership.
- **Data and security:** Reuse exact scanned file versions and existing audience permissions; define master/reference versus independent copy without changing historical course evidence; keep lecturer-only solutions out of participant projections.
- **Tasks / acceptance:** Add categories, subjects, tags, language, owner, review/licensing metadata, search/preview, reuse/copy, consumer usage view, revision comparison, outdated review and archive. Verify organisation/course/private scopes, exact-version downloads, malware quarantine, permissions after revocation and historical snapshots.
- **Test results / commits / limitations:** `94872d32` adds locally verified metadata revisions and search to exact course shares. Cross-course reuse still needs a canonical resource identity and usage model.

### LMS-P0-03 — gradebook and configurable grading policies

- **Priority / status:** P0 · partially implemented and locally verified. The course workspace has a bilingual quiz-gradebook view, not a comprehensive gradebook.
- **Dependencies / affected modules:** The LMS assessment maintainers own `course-gradebook.tsx`, `course_gradebook` and the `gradebook_*` operations in `course_workspace_action` and `academy_learning_action`. The gradebook reads existing course enrolments, attempts and published quiz revisions; it does not grade answers or change certificate eligibility.
- **Data and security:** Private RLS-enabled tables store immutable course policy versions and append-only grade revisions. The preview uses the highest score for the learner on the current published quiz; ties prefer the latest attempt and then the lowest attempt ID. The policy either displays the percentage or uses the label for the highest threshold reached. An explicit publication checks the reviewed attempt and policy; a correction requires the current grade revision and an internal reason. The participant projection shows only that person's published grade, not the roster, answers or correction reasons. Academy grace is read-only.
- **Acceptance and tests:** 1,919 local Vitest tests passed, plus lint, application/E2E TypeScript and 7 documentation checks. A fresh isolated PostgreSQL replay passed 16 course-workspace groups, both Academy document/learning edition suites and 11 API checks. These include stale changes, concurrent publication, correction/privacy, retained grades and current membership checks. The Playwright workflow is registered for desktop/mobile Chromium but was not run because the canonical isolated runner was locked. CI and production acceptance are not claimed.
- **Commits / limitations:** See the `codex/lms-p0-03-gradebook` change. Categories, weights, other assessment types, independent passing policies, moderation and history UI, class/programme reporting, grade notifications, and validated spreadsheet imports/exports remain open. Formal accessibility acceptance is pending.

### LMS-P0-04 — reusable question bank and examination builder

- **Priority / status:** P0 · planned; existing quiz revisions and examination files remain authoritative.
- **Dependencies / affected modules:** Existing course quizzes, scanned examination documents, assignment submission and authorisation gateways.
- **Data and security:** Immutable question revisions referenced by attempts; objective scoring stays deterministic; answer keys and model answers withheld until their explicit release condition; no AI grading.
- **Tasks / acceptance:** Add question taxonomy, objective/manual question types, rubrics/blueprints, pools, server-generated randomisation, time/attempt rules, answer autosave, recovery, manual grading, moderation and exports. Test question-version integrity, timing/expiry, duplicate and concurrent submit, answer exposure and cross-tenant access.
- **Test results / commits / limitations:** Not implemented or tested; no commit. Standards-based exam import and proctoring are not implied.

### LMS-P0-05 — rubrics, assignments, resubmission and feedback

- **Priority / status:** P0 · planned; current private participant submissions and quiz results are partial foundations.
- **Dependencies / affected modules:** Existing course submissions, file scanner, notifications, assessment records and authoring.
- **Data and security:** Preserve each submission/attempt and rubric version; validate every workflow transition server-side; separate participant-visible feedback from private staff notes; use exact scanned file versions.
- **Tasks / acceptance:** Add rubric criteria/levels, assignment publication/deadlines/attempts, individual/group rules, extensions, revision requests, resubmission, grading and feedback revision/publication notifications. Test timezone deadlines, participant-only access, private notes, malware scans, concurrent submissions and history.
- **Test results / commits / limitations:** Not implemented or tested; no commit. Existing generic submission controls do not count as full assignment lifecycle.

### LMS-P0-06 — authoritative completion and next-step engine

- **Priority / status:** P0 · planned; current programme progress and certificate rules remain the completion authority until an explicit compatible extension is designed.
- **Dependencies / affected modules:** Course enrolments/programmes, quiz pass facts, verified attendance, assignments, certificates and existing analytics.
- **Data and security:** Versioned, explainable requirement rules; do not use page views or enrolment as completion evidence; preserve existing certificates and historical outcomes.
- **Tasks / acceptance:** Add required activity/assessment/attendance/competency/lecturer-verification conditions, status projection, missing requirements and deadlines, deterministic prerequisites and exception audit. Test invalid/circular paths, timezones, revoked access, old certificates and multiple requirement combinations.
- **Test results / commits / limitations:** Not implemented or tested; no commit. Do not silently change current certificate eligibility.

### LMS-P0-07 — education permissions, accommodations and accessibility

- **Priority / status:** P0 · planned; existing role/resource checks are the baseline, not a complete LMS permission matrix.
- **Dependencies / affected modules:** LMS-P0-02–06, existing capability system, Academy edition gates and WCAG 2.2 AA conventions.
- **Data and security:** Least-privilege course/assessment/grade scope; accommodations are sensitive and narrowly projected; no blanket administrator access to private portfolios or learner notes.
- **Tasks / acceptance:** Map author/reviewer/teacher/assessor/moderator/learner capabilities; add appropriate scoped accommodation fields and UI; audit keyboard, screen-reader, focus, contrast, time extension and mobile exam controls. Test cross-organisation, revoked membership, direct RPC manipulation and DE/EN.
- **Test results / commits / limitations:** Not implemented as a complete matrix; no commit. The new authoring slice has keyboard module ordering but no formal WCAG audit yet.

### LMS-P0-08 — P0 end-to-end and regression acceptance

- **Priority / status:** P0 · partial test scaffolding added; complete lifecycle gate is open.
- **Dependencies / affected modules:** LMS-P0-01–07 and all existing course, assessment, notification, certificate and analytics owners.
- **Data and security:** Fictional fixtures only; replay migrations from supported baselines; preserve existing records and CI checks.
- **Tasks / acceptance:** Complete author → publish → enrol → learn → submit → assess → feedback → competency → completion → certificate → report journey; add SQL/RLS/API, browser, concurrency, accessibility, responsive and language coverage; document actual local/CI/external evidence separately.
- **Actual results:** See LMS-P0-01 for local authoring, API and desktop/mobile browser results. Complete lifecycle, full browser suite, accessibility and CI remain pending.
- **Commits / limitations:** Authoring coverage is on `codex/lms-p0-course-authoring`. This work package cannot pass until packages LMS-P0-02–07 are integrated and tested.

## P1 — advanced functionality and interoperability

| ID                           | Priority / status | Existing implementation and dependencies                                                    | Required work, acceptance and test owner                                                                                                                         | Results / limitations                                                           |
| ---------------------------- | ----------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| LMS-P1-01 Competencies       | P1 · planned      | Existing qualification/expertise and course outcomes; after P0 policies.                    | Versioned organisation frameworks, competencies, levels, evidence and authorised assessment; test decision history, evidence access and mappings.                | Not implemented or tested; no national qualification claim.                     |
| LMS-P1-02 Conditional paths  | P1 · planned      | Existing ordered learning programmes; after completion engine.                              | Deterministic prerequisites, alternatives/remediation and audited exceptions; test cycles, impossible rules, concurrency and lockout explanation.                | Not implemented or tested.                                                      |
| LMS-P1-03 SCORM              | P1 · planned      | No conformance claimed; after authoring, progress, secure file handling and package review. | Isolated package imports/runtime for verified SCORM versions; archive limits, sandbox, CSP, CORS/origin and representative package testing.                      | Not implemented or externally verified; only claim versions actually validated. |
| LMS-P1-04 LTI                | P1 · planned      | No external tool launch authority; after organisation integration/security review.          | LTI 1.3 registration, OIDC/JWT/key handling, role/context minimisation, replay protection, deep links and permitted AGS/NRPS; test authorised reference sandbox. | Not implemented or provider-tested.                                             |
| LMS-P1-05 xAPI               | P1 · planned      | Existing LMS facts are authoritative; after event mapping agreement.                        | Validated/deduplicated statements, bounded retry/monitoring and LRS credentials; verify statement mapping and privacy.                                           | Not implemented or LRS-conformance verified.                                    |
| LMS-P1-06 H5P                | P1 · planned      | No package execution in privileged origin; after package isolation and licensing review.    | Safe package/library management and supported interaction tracking with sandbox/size/licensing controls; test representative packages.                           | Not implemented or authoring-integrated.                                        |
| LMS-P1-07 Learning analytics | P1 · planned      | Existing course, attendance and completion analytics.                                       | Add versioned metric definitions, grade/submission/competency/attempt aggregates and scoped CSV/XLSX/print reports; test privacy, exports and calculations.      | Not implemented as comprehensive report set.                                    |

## P2 — additional learning functionality

| ID                                          | Priority / status | Dependencies and acceptance                                                                                                                                                                         | Results / limitations      |
| ------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| LMS-P2-01 Digital portfolios                | P2 · planned      | After evidence/resource scopes; personal private entries, deliberate sharing, versioned evidence and export, with denial tests for admin/staff without share.                                       | Not implemented or tested. |
| LMS-P2-02 Peer assessment                   | P2 · planned      | After gradebook/rubrics; deterministic assignment, no self-review unless configured, moderation/dispute and accessibility/safeguarding checks. Peer feedback does not set a final grade by default. | Not implemented or tested. |
| LMS-P2-03 Institution-specific enhancements | P2 · planned      | After P0/P1 configuration model; each additional scope receives a separately approved work package and tests.                                                                                       | Not implemented or tested. |

## Verification vocabulary

- **Planned:** no integrated source implementation.
- **Partially implemented in source:** functionality exists but its package acceptance criteria are incomplete.
- **Locally verified:** actual named local command/test passed.
- **CI verified:** reviewed canonical CI for the relevant commit passed.
- **External integration verified:** named, authorised external sandbox or provider acceptance passed.
- **Production accepted:** separately authorised production rollout and monitoring evidence exists.

Source presence, a passing focused local test, a browser mock, or a migration replay does not imply later categories.
