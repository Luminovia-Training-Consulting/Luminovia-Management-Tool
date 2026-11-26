# LMS delivery backlog

This ledger tracks the educational-only LMS extension from the implementation directive. It extends the existing Luminovia course run, enrolment, assessment, document, attendance, certificate and analytics authorities; it does not create parallel registries. The authoring baseline was `main` at `9d1dbdba`; the catalogue branch starts at `26431400`, now on `main`. This document distinguishes source implementation, local verification, browser verification, external interoperability and production acceptance.

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

- **Priority / status:** P0 · partially implemented. The existing exact-version Materials Library now supports versioned titles, descriptions, subjects, tags, languages and licence notes in DE/EN. Search covers filename, title, description, subject and tags; course and category filters remain available.
- **Dependencies / affected modules:** `material-library.tsx`, the existing material library RPC and native API contracts, `private.course_material_metadata_revisions`, and the existing document/version/scan authorities. Curriculum insertion depends on LMS-P0-01 and a resource usage model.
- **Data and security:** Append-only writes through the authenticated `set_course_material_metadata` RPC keep independent metadata per share and audit the actor and revision. Stale changes cannot overwrite newer edits. Metadata is projected only to the existing file audience; no change to the file, scan status, audience or download gateway. Internal editing uses existing scoped course staff rights; Academy edits are active-licence only and scoped to the upload owner. Grace is read-only.
- **Acceptance / local evidence:** All 1,918 Vitest tests passed, including conflict recovery. The isolated PostgreSQL replay passed 15 course-workspace groups, 11 API-surface checks and the document suite in both Academy editions. It covers editable and read-only roles, duplicate tags, identical retries, concurrent edits, historical revisions and revocation. The focused Materials Library flow passed in desktop and mobile Chromium with an isolated stack, scan-to-download, staff-only search exclusion and exact-byte verification. Full browser, CI and accessibility acceptance remain open.
- **Commits / remaining work:** `codex/lms-p0-material-catalogue`, based on authoring commit `26431400`. Central masters, cross-course pinning and copies, usage and history UI, review dates, learning objectives/competencies, archive and broader library scopes still need implementation and verification.

### LMS-P0-03 — gradebook and configurable grading policies

- **Priority / status:** P0 · planned; current quiz result and course completion facts exist, but are not a comprehensive gradebook.
- **Dependencies / affected modules:** Existing quiz, exam, assignment, enrolment and reporting records; course assessment and analytics owners.
- **Data and security:** Versioned deterministic grading policy, grade history and moderation record; participant reads limited to own published results; server-authorised staff writes, audited changes and correction rather than silent final-grade overwrite.
- **Tasks / acceptance:** Implement categories, weight/threshold rules, optional/mandatory/bonus/excused/missing cases, supported configurable scales, tabular and individual views, publication/moderation, import preview/error recovery and exports. Test reproducibility, rounding, concurrent edits, imports, finalisation, privacy and RLS.
- **Test results / commits / limitations:** Not implemented or tested; no commit. Do not infer grades from attendance or presence.

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
