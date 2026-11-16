# Course Readiness Centre

The preparation centre extends existing course runs, confirmed assignments, contract versions, qualification attestations, scanned files and customer records. `/readiness` lists accessible preparations; `/readiness/:id` shows the checklist, authorised documents, meeting or venue, instructions and tasks. The dashboard widget reads the same server projection. It complements personal teaching preparation and does not replace that separate private workflow.

## Authoritative calculation

No percentage or readiness state can be edited. PostgreSQL recalculates applicable checks from current records for every response. The percentage is the number of complete applicable checks divided by applicable checks, rounded to a whole percentage. Customer organisation and contact are distinct checks so missing contact information is visible.

The checks cover every course session and every required lecturer position, an applicable documented agreement, verified qualifications covering the assignment, clean current teaching materials available to each assigned lecturer, HTTPS meeting or physical venue, active customer/contact records, explicit confirmation of the current schedule, acknowledgements of the current instruction version and required preparation tasks. Mandatory job contract prerequisites cannot be waived in preparation settings. An incomplete course never reaches 100% or Ready.

Management selects requirements for internal/external courses, materials and instructions. Unconfigured courses default to requiring materials, a customer/contact and a documented agreement. Online courses always require a meeting URL; physical courses always require a venue. Agreement and qualification coverage use each assignment's interval, preserving independently allocated portions of a course. Schedule confirmation stores a source fingerprint; changing source session identifiers or intervals invalidates that confirmation automatically. Missing lecturer, agreement, qualification, venue or schedule confirmation blocks readiness; other missing requirements require attention and become blocking when their deadline passes.

Preparation completed means every applicable check passes and the scheduled course end lies in the past. This is explicitly labelled as preparation, **not teaching delivery**. Attendance and proof-of-delivery use a separate auditable workflow.

## Responsibility, instructions and history

Management with current `courses.manage` and MFA configures preparation, confirms schedules and creates/edits/archives tasks. A task can be assigned to the acting manager or a currently assigned active lecturer. Assigned lecturers can acknowledge only their own current instructions and complete or revoke completion of their own tasks. Management can document completion too. Changing task title or responsible person clears the current completion and preserves its previous value in private history. Archiving retains the row and history.

Instruction receipts bind the exact numbered version. Editing instructions or changing their acknowledgement requirement advances that version, retaining older receipts. A new assigned lecturer does not inherit another lecturer's receipt. All writes use optimistic versions and request UUIDs. Matching uncertain retries return the original result; changed payloads cannot reuse the same request. The UI retains a request UUID while retrying an unchanged form. No mutation reports success before the online server response.

## Privacy and integration

Preparation is accessible only to current course managers with MFA or currently confirmed assigned lecturers. The existing broad visibility of published courses is deliberately insufficient. Participants, unrelated lecturers and customer memberships do not grant preparation access. Suspension/cancellation is checked on every read and write. Private tables have RLS enabled and no browser table grants; public RPC wrappers use invoker security and narrowly granted private implementations fix an empty search path.

The lecturer projection exposes agreement/qualification validity rather than other people's contract identifiers, documents or prices. Customer contact existence is evaluated without returning private email, telephone or notes. Teaching documents must have a clean current version and be available through job scope or a current lecturer-course room membership. Personal CVs, contracts and manager-only files cannot satisfy teaching-material readiness. Rendering reuses the authenticated file attachment/download boundary; no reusable signed Storage URL or offline cache is introduced. Existing authorisation still governs the linked course, calendar, profile, job and file screens.

Queries refresh on focus/reconnect and every 30 seconds while the centre is open. The dashboard shares the same cache without another timer. A denied refresh removes retained preparation content. Mutation handlers invalidate readiness only after server success; database recomputation remains authoritative regardless of browser invalidation. The implementation preserves DE/EN interface strings, authored content, intended IANA time zones, system/light/dark tokens and responsive layouts.

## API and schema

The additive `20261116034641_course_readiness.sql` migration creates five private RLS-enabled ledgers: settings, tasks, instruction receipts, request idempotency and preparation events. Historical migrations are unchanged. These public authenticated functions form the API:

| RPC                                                                         | Purpose                                                                                                                                                                      |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `course_readiness(p_course_run_id?)`                                        | Authorised current snapshots; an explicit inaccessible ID fails closed. The overview bounds results to 250 nonarchived courses, excluding those ended more than 30 days ago. |
| `save_readiness_settings(run, payload, expected_version, request_id)`       | Versioned applicability, instructions, meeting and deadline.                                                                                                                 |
| `confirm_course_sessions(run, expected_version, request_id)`                | Confirm the current source schedule fingerprint.                                                                                                                             |
| `save_readiness_task(run, task_id?, payload, expected_version, request_id)` | Create/edit/archive a responsible task.                                                                                                                                      |
| `complete_readiness_task(task, completed, expected_version, request_id)`    | Record or revoke completion with history.                                                                                                                                    |
| `acknowledge_course_instructions(run, instruction_version, request_id)`     | Own exact-version instruction receipt.                                                                                                                                       |

Preparation events keep detailed before/after records privately. Company-wide audit rows contain only safe action and course identifiers, without authored instructions or private contract content. The general audit viewer's reviewed action allowlist is a separate integration boundary.

## Verification status

Executed focused evidence at the initial source checkpoint: 16 actual PostgreSQL groups in an owned networkless disposable fixture; 13 unit/component/API-adapter cases; whole-project TypeScript; focused ESLint. These cover incomplete courses, applicability, agreement/qualification revocation, clean/current material and membership rules, exact scheduling, stale/concurrent settings, idempotent retries, instruction versioning, task permissions/corrections, customer contact privacy, suspension/cancellation, private-ledger/anonymous denial, literal authored content, offline mutations, server failures, DE/EN draft preservation and untrusted links.

`scripts/readiness-api-check.mjs` additionally exercises actual native Auth/MFA/REST, a real Edge/ClamAV/Storage material upload, instruction/task flows and immediate suspension. `tests/e2e/readiness.spec.ts` exercises actual management and lecturer UI, outsider denial, DE/EN, light/dark, responsive overflow, axe checks and offline refusal on desktop/mobile. At authoring time these native/browser cases are **authored but not executed**; the canonical isolated `./portal test` run and exact PR CI must supply their actual results. The whole regression, native upgrade/retention, PWA and deployment status is recorded separately in the work log and PR, not inferred from these focused checks.

No hosted database, real customer, production service, SMTP recipient or public marketing website was changed for this feature. X-platform installation and legal acceptance are not claimed.
