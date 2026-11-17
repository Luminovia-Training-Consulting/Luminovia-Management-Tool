# GitHub checks, security and coverage

> Reviewed source policy and latest integration readback: all three `main` rulesets are active. Only CarinaSchoppe's personal account (`User:29256704`) has a `pull_request` review exception; every other user and App needs independent/latest-push approval. History/signatures and all15strict producer-bound checks have no bypass. A temporary disabled review-layer drift was observed and subsequently restored through a separate coordinated operational action, then independently read back. Committing these source snapshots does not itself activate a rule; the [live server rules](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/rules) remain authoritative.

Every PR retains quality/build, full-source unit coverage, CodeQL, dependency
review and metadata. The checked-out two-parent merge determines the work below;
labels and caller-supplied paths cannot select a cheaper profile. Missing Git
history, invalid paths and unknown source locations conservatively select full.

| Change profile                                                                                                                | Acceptance beyond quality/coverage/security                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Documentation/templates only                                                                                                  | Runtime/Edge/audit checks; no SQL or native run is claimed.                                                                                                  |
| Ordinary frontend/static changes                                                                                              | Runtime/Edge/audit plus every existing SQL migration/RLS/race suite, split exhaustively between two separate digest-pinned, networkless PostgreSQL clusters. |
| Backend, Auth, private file/chat access, shared app/cache code, dependencies, test/delivery infrastructure or unknown changes | All system/SQL/API and desktop/mobile/PWA stages on separate isolated runners, plus the actual native retained-data rehearsal and both SQL workers.          |
| Every main push or manual run                                                                                                 | Complete unchanged application and native retained-data acceptance in parallel.                                                                              |

The required verification jobs start after the small scope job instead of waiting
for the quality matrix. Their first shell step independently rejects a failed,
missing or invalid scope, and rejects every non-full main/manual profile. Thus a
broken selector cannot convert a required check into a successful skipped job.
No required context is removed and no threshold, race count or security assertion
is reduced. A manual branch run remains available for full pre-merge acceptance.

Sensitive PRs split the complete runner into explicit `--phase system` and
`--phase browser` invocations. Each owns a fresh random stack, database, test
snapshot, credentials, ports, lock and cleanup on a separate runner. Both start
the real services and exercise persistence before seeding fictional commercial
fixtures. The system phase retains every native SQL, lint/advisor, runtime,
Edge, backup and real API check; the browser phase retains every desktop/mobile
journey, production build and built-PWA check. Tests remain sequential inside each
browser stack with no retries. Neither phase claims complete acceptance alone.
The required preview gate rejects failure, cancellation, skipping or a missing
result from either phase. Main/manual/local `./portal test` still executes the
complete original sequence in one owned stack.

Each SQL worker has its own engine, connection limit, random ownership label and
UUID databases. No host ports/mounts or network are available. Cancellation stops
the peer and both owned cleanup paths settle before failure is reported. Only the
PR fixture disables JIT compilation; durability/transaction settings stay unchanged.
Per-suite timings appear in logs and the job summary. SQL uses existing emulated
Auth helpers; actual Auth/Storage/browser/PWA/retention is covered by the full profile.
The historical selfhost check name is retained for required-check compatibility.
Preview manifests and bilingual instructions record the actual verification profile.

Publication still requires explicit exact-main approval and both complete gates.
Local complete acceptance, daily maintenance and repository protections remain unchanged.
Npm dependency caching and cancellation of superseded PR runs were already present;
no credentials, database state or generated QA files are cached.

Actual baseline [43827354265](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/actions/runs/43827354265) took about28minutes, including21minutes application then6minutes native upgrade. The first optimized [PR34 run43855915270](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/actions/runs/43855915270) on signed608687f passed in **11minutes36seconds**, approximately59%less elapsed time. Quality/coverage took26–48seconds, runtime/Edge/audit39seconds, and the serial SQL job10minutes30seconds with351PASS groups. All15required contexts passed after the missing metadata labels were corrected. The subsequent signed8f29147 run43860971674 also passed every required check, with two-worker SQL5m07s (about50%less than the earlier10m10.6s), complete native/retained-data acceptance and114desktop/mobile plus2built-PWA cases. Its sensitive-PR full run took32m35s. PR34 merged as signedmain c528100. Those timings belong to the named earlier architecture. The system/browser split is now implemented in the checked-in workflow; its own exact-source outcomes must be read from the corresponding run rather than inferred from these earlier measurements.

Development and testing use the local PC by default. `./portal check` runs fast
quality, coverage and build checks without starting services; `./portal test`
provides complete isolated acceptance of the working source before delivery, `./portal github test` verifies freshly fetched `main` locally,
and `./portal github` starts a separate persistent preview. No GitHub deployment
or self-hosted Actions runner is needed. GitHub checks remain independent
verification; a successful check or merge is not a publication request.

## Visible checks

| Check                                                             | What it verifies                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build                                                             | Production frontend and PWA bundling using only synthetic public Supabase configuration. The parallel Typecheck gate validates TypeScript; the build does not repeat it.                                                                                                                    |
| Typecheck                                                         | TypeScript project checks through `npm run typecheck`, run in parallel with the production bundle.                                                                                                                                                                                          |
| Lint                                                              | ESLint with no warnings allowed.                                                                                                                                                                                                                                                            |
| Formatting                                                        | Existing source formatting and GitHub configuration.                                                                                                                                                                                                                                        |
| Code quality                                                      | Existing compiler-based checks for reachable modules, exports and connections.                                                                                                                                                                                                              |
| Tests and coverage                                                | All Vitest unit/component tests, V8 coverage and enforced thresholds; downloadable HTML/LCOV/JSON artifacts.                                                                                                                                                                                |
| verify                                                            | Docs/ordinary PR: runtime guards, Edge lint/types/tests and production audit. Sensitive PR: system/SQL/API phase; parallel required quality/coverage jobs are not repeated. Main/manual: complete system and browser/PWA acceptance with the same required quality/coverage jobs delegated. |
| Isolated browser acceptance                                       | Sensitive PR: all desktop/mobile/build/PWA checks on a separate fresh stack. Other PRs explicitly record their narrower profile. Its success is required by the preview gate.                                                                                                               |
| Actual isolated selfhost image compatibility                      | Ordinary PR: two isolated PostgreSQL workers. Sensitive PR/main/manual: actual native images and retained data; docs records its narrower scope.                                                                                                                                            |
| PR preview package                                                | Package the committed tested application and upload its real runnable local preview artifact; required before PR merge.                                                                                                                                                                     |
| PR metadata                                                       | Current PR labels and matching repository/commit identity.                                                                                                                                                                                                                                  |
| CodeQL (javascript-typescript), CodeQL (python), CodeQL (actions) | Completion of each configured language analysis.                                                                                                                                                                                                                                            |
| Dependency review                                                 | Newly introduced vulnerable dependencies on the PR.                                                                                                                                                                                                                                         |
| CodeQL                                                            | Generated findings check, separate from successful scanner execution.                                                                                                                                                                                                                       |

All 15 existing server-required contexts remain mandatory before a PR can merge. The additional browser phase is enforced through the required preview gate, which rejects a failed, skipped, cancelled or missing browser result; no repository rule is weakened. The strict rule also requires the PR to be up to date with `main`. Neither maintainers, administrators nor the maintenance App can bypass these checks.

The release job runs only for an authorised manual `Portal checks` dispatch on
`main` with `publish_release=true` and the exact current `main` SHA supplied as
`expected_commit`. Pushes, ordinary manual verification and daily-maintenance
verification do not publish releases. The fast quality gates and both complete
application/selfhost gates remain required; failed checks do not produce a
publication package. VPS automation still verifies that the entire CI run
for the exact main commit succeeded. The existing five-minute VPS polling timer
is unchanged; changing publication policy does not claim a hosted timer change.

The `PR preview deployments` workflow is manual-only. The verified downloadable
PR package remains an artifact, independent of optional deployment metadata.
See [PR_PREVIEWS](PR_PREVIEWS.md) for that explicit publication and cleanup path.

[CodeQL](../.github/workflows/security.yml) additionally analyses JavaScript/TypeScript, Python and GitHub Actions on PRs/main and on Mondays at 05:23 UTC (15:23 Brisbane). This is static security analysis, not a replacement for real RLS/auth/file-access tests. Findings appear under GitHub Security/Code scanning; a successfully completed scan does not by itself mean there are no warnings. Its three language analyses, Dependency review and the generated CodeQL finding result are mandatory PR checks. Fourteen contexts are bound to GitHub Actions integration `15368`, and generated CodeQL to `57789`. This separate Security workflow is currently not an additional release `needs` gate; publication conditions are explicitly defined in `ci.yml`.

## Interpreting source and integration evidence

The checked-in migration inventory and generated [API reference](API_REFERENCE.md) describe current source. Counts in earlier 24-, 27-, 32- or 36-migration checkpoints below remain historical measurements. They are not current inventory or acceptance of a later composition. The current module-to-suite map is [FUNCTIONAL_ACCEPTANCE](FUNCTIONAL_ACCEPTANCE.md); actual executed outcomes belong in [QA_RESULTS](QA_RESULTS.md).

Documentation and metadata checks cover their own scope. API-generator, test, workflow or infrastructure changes conservatively select full acceptance. The required suite must pass on the final submitted source; neither collection, an earlier green revision nor a merged PR proves hosted installation.

## Running and interpreting coverage

```bash
npm ci
npm run test:coverage
```

The local HTML report is `coverage/index.html`; machine-readable output is in `coverage/coverage-summary.json` and `coverage/lcov.info`. In GitHub Actions, download the coverage report from the run's Artifacts section. `coverage/` is intentionally not versioned.

Coverage includes **all executable `src` TS/TSX files and `scripts/public-config.ts`**, including modules not imported by tests. Tests, test setup and declarations are excluded. V8 coverage comes from unit/component tests; SQL, Edge, Python/Node maintenance and real browser workflows are not combined into an invented overall percentage.

The historical PR11 measurement with its additional cases passed **197 tests in 46 files**: statements 47.09%, branches 41.61%, functions 37.07%, lines 48.89% across 106 source files. Global thresholds 46.5/41/36.5/48 limit regressions against this measured baseline with a small allowance for variation. Untested UI paths remain visible; files are not excluded to manufacture an arbitrary 80% result.

The 32-migration checkpoint before Demo integration, including the preserved PR11 cases and six additional download-contract regressions, passed **342 tests in 54 files**: statements **55.78%**, branches **50.40%**, functions **46.94%**, lines **57.60%**. File API coverage is **98.92% lines / 96.29% functions**; every configured global and critical-file threshold passed. This measured unit/component result is not complete native acceptance. The canonical `./portal test` now runs this same coverage command and retains its reports with the private test artifacts.

The later functional preflight integrating accepted Main16/Demo source, the Calendar correction and the scoped picker fixes passed **372/372 Vitest cases in 57 files**: statements **57.65%**, branches **52.32%**, functions **49.11%**, lines **59.46%**; every configured floor passed. This is actual unit/component evidence for that functional checkpoint. Documentation integration and complete native acceptance still require a fresh combined run; these percentages are not an overall system-coverage or production claim.

Critical areas have stricter gates: 100% for browser-key configuration, time-zone/DST/date logic and scheduling; separate high statement/branch/function/line thresholds for file transfer and safe knowledge content. Exact values are in [vite.config.ts](../vite.config.ts). Future improvements should raise measured coverage; thresholds are not automatically lowered.

New real cases check uploads only after online/auth confirmation, progress capped at 95% until clean status is confirmed, quarantine/timeouts/retry context, exact-version `no-store` downloads and rejection of secret browser keys. The test run needs no real user or customer file.

## Dependabot and security features

[dependabot.yml](../.github/dependabot.yml) adds updates for SHA-pinned GitHub Actions (Mondays 04:17 UTC / 14:17 Brisbane) and npm security fixes (daily configuration 04:47 UTC / 14:47 Brisbane). Regular npm/Node/JSR/container versions remain with the existing daily full candidate-verification path, avoiding two uncoordinated systems handling the same regular updates. Vitest and `@vitest/*` are treated there as one family with matching exact peers.

Dependabot PRs receive suitable existing type/area/risk labels and run through the same checks. There is no blanket automatic merge of unverified dependencies. Dependabot alerts were already enabled; security-update PRs, Secret Scanning and Push Protection have now been enabled and read back on the public repository. The initially disabled dependency graph was enabled in repository settings; the real Dependency Review retry and comparison of 12 changed dependencies passed. No paid service was added. Full npm audit still reports the four previously documented low-severity build-tool findings in the unchanged `deepmerge`/Workbox chain; the production audit is separate. Dependency review evaluates newly introduced findings and does not declare this existing debt fixed.

## Maintainers and server-side rules

The history and required-check rules remain active, with all15current-base contexts, required signatures and no bypass actors. The versioned review policy is an active-policy snapshot granting only CarinaSchoppe's personal account (`User:29256704`) a `pull_request` exception; other users and Apps require independent/latest-push approval and resolved conversations under that reviewed contract. The executing account, not authorship or repository role, determines the exception. A later check observed that separate review layer temporarily disabled; the coordinated operational restoration returned it to active with every other field unchanged, followed by independent readback. The resulting three active layers match the reviewed source contract. This documentation correction itself performs no setting mutation. [GITHUB_WORKFLOW](GITHUB_WORKFLOW.md) records the distinction and remaining operational App setup.

The initial quality setup was merged through [PR11](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/11) under the previous policy, which allowed an early maintainer merge while long-running tests were active. That historical result is not the current merge policy. The scanner job and generated CodeQL findings check were verified separately; the initial test-fixture finding was fixed by checking the exact URL origin. The first complete main scan additionally reported existing operations/test-script findings. They are individually assessed in [CODE_SCANNING_TRIAGE](CODE_SCANNING_TRIAGE.md); a successful PR-diff scan does not imply a main scan without warnings.

Official references: [GitHub CodeQL](https://docs.github.com/en/code-security/code-scanning/introduction-to-code-scanning/about-code-scanning-with-codeql), [Dependabot](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependabot-version-updates), [Vitest coverage](https://vitest.dev/guide/coverage.html). Exact executed checks and GitHub runs are recorded in [QA evidence](QA_RESULTS.md).

The earlier English-guide branch CI covered its 24-migration baseline. It does not accept the later 32-migration product integration. Exact CI43794921492 on `9c42730` passed 316 SQL cases, 26 actual business API suites and restart persistence, but failed 2 of 94 browser journeys. The independent local run of the same `9c42730` source reproduced those two failures after the same 316 SQL/26 API/46 Edge checks and real restart persistence passed. Focused Calendar correction `bf09f19` passes 12 Calendar cases; the combined corrected 32-migration/Demo/guide source still needs a fresh complete run. See [QA_RESULTS](QA_RESULTS.md).

## Current governance boundary

The source policies retain all fifteen mandatory checks without a CI or history/signature exception. The accepted maintenance publisher creates a signed PR and must satisfy its required checks and review; it has no technical rule exception. Live server rules may change independently and must be read back before merging. [Current rules and evidence](GITHUB_WORKFLOW.md).
