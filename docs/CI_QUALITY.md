# GitHub checks, security and coverage

> Status verified on 16 November 2026: all three `main` rulesets are active. Every change requires a PR, including maintenance-App changes. Only `CarinaSchoppe` (User 29256704) has a personal `pull_request` exception in the review rules. Nobody can bypass the 15 mandatory CI/security checks or strict up-to-date testing. The history/check rules and maintenance App have no bypass exception. [Live rules](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/rules).

Workflows run for pull requests and `main`; manual execution is also available. They need no VPS credentials, private Supabase keys or production data. Existing real application/database/API/browser checks remain in place.

Development and testing use the local PC by default. `./portal check` runs fast
quality, coverage and build checks without starting services; `./portal test`
provides complete isolated acceptance of the working source before delivery, `./portal github test` verifies freshly fetched `main` locally,
and `./portal github` starts a separate persistent preview. No GitHub deployment
or self-hosted Actions runner is needed. GitHub checks remain independent
verification; a successful check or merge is not a publication request.

## Visible checks

| Check                                                             | What it verifies                                                                                                             |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Build                                                             | Production compilation and PWA build using only synthetic public Supabase configuration. It does not access a real instance. |
| Typecheck                                                         | TypeScript project checks through `npm run typecheck`.                                                                       |
| Lint                                                              | ESLint with no warnings allowed.                                                                                             |
| Formatting                                                        | Existing source formatting and GitHub configuration.                                                                         |
| Code quality                                                      | Existing compiler-based checks for reachable modules, exports and connections.                                               |
| Tests and coverage                                                | All Vitest unit/component tests, V8 coverage and enforced thresholds; downloadable HTML/LCOV/JSON artifacts.                 |
| verify                                                            | `./portal test`: real isolated SQL/RLS/API/Edge/browser/PWA, security, restart and maintenance checks.                       |
| Actual isolated selfhost image compatibility                      | Real pinned Supabase images and retained data from the previous source revision.                                             |
| PR preview package                                                | Package the committed tested application and upload its real runnable local preview artifact; required before PR merge.      |
| PR metadata                                                       | Current PR labels and matching repository/commit identity.                                                                   |
| CodeQL (javascript-typescript), CodeQL (python), CodeQL (actions) | Completion of each configured language analysis.                                                                             |
| Dependency review                                                 | Newly introduced vulnerable dependencies on the PR.                                                                          |
| CodeQL                                                            | Generated findings check, separate from successful scanner execution.                                                        |

All 15 listed checks are mandatory before a PR can merge. The strict rule also requires the PR to be up to date with `main`. Neither maintainers, administrators nor the maintenance App can bypass these checks.

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

[CodeQL](../.github/workflows/security.yml) additionally analyses JavaScript/TypeScript, Python and GitHub Actions on PRs/main and on Mondays at 05:23 UTC (15:23 Brisbane). This is static security analysis, not a replacement for real RLS/auth/file-access tests. Findings appear under GitHub Security/Code scanning; a successfully completed scan does not by itself mean there are no warnings. Its three language analyses, `Dependency review` and the generated `CodeQL` finding check are now required for PR merges. The fourteen workflow-produced statuses are bound to GitHub Actions integration `15368`; the generated `CodeQL` status is bound to integration `57789`. The separate Security workflow is not an additional release-job `needs` gate; publication conditions remain explicitly defined in `ci.yml`.

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

The history, review and required-check rules are active. The only current review bypass actor is `CarinaSchoppe` (User 29256704), with mode `pull_request`; it does not allow direct pushes or skipped checks. Maintainer or administrator role membership alone grants no review exception. Other contributors and the maintenance App must satisfy the independent/latest-push review and resolved-conversation rules as well as every check. The history and required-check rules have no bypass actors, and the App has no bypass entry in any policy. Versioned JSON snapshots can predate the current live exception; the server-side rules are authoritative. [GITHUB_WORKFLOW](GITHUB_WORKFLOW.md) documents the readback and remaining operational App setup.

The initial quality setup was merged through [PR11](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/11) under the previous policy, which allowed an early maintainer merge while long-running tests were active. That historical result is not the current merge policy. The scanner job and generated CodeQL findings check were verified separately; the initial test-fixture finding was fixed by checking the exact URL origin. The first complete main scan additionally reported existing operations/test-script findings. They are individually assessed in [CODE_SCANNING_TRIAGE](CODE_SCANNING_TRIAGE.md); a successful PR-diff scan does not imply a main scan without warnings.

Official references: [GitHub CodeQL](https://docs.github.com/en/code-security/code-scanning/introduction-to-code-scanning/about-code-scanning-with-codeql), [Dependabot](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependabot-version-updates), [Vitest coverage](https://vitest.dev/guide/coverage.html). Exact executed checks and GitHub runs are recorded in [WORKLOG](WORKLOG.md).

The earlier English-guide branch CI covered its 24-migration baseline. It does not accept the later 32-migration product integration. Exact CI43794921492 on `9c42730` passed 316 SQL cases, 26 actual business API suites and restart persistence, but failed 2 of 94 browser journeys. The independent local run of the same `9c42730` source reproduced those two failures after the same 316 SQL/26 API/46 Edge checks and real restart persistence passed. Focused Calendar correction `bf09f19` passes 12 Calendar cases; the combined corrected 32-migration/Demo/guide source still needs a fresh complete run. See [QA_RESULTS](QA_RESULTS.md) and [WORKLOG](WORKLOG.md).

## Current governance boundary

The source policies retain all fifteen mandatory checks without a CI or history/signature exception. The accepted maintenance publisher creates a signed PR and must satisfy its required checks and review; it has no technical rule exception. Live server rules may change independently and must be read back before merging. [Current rules and evidence](GITHUB_WORKFLOW.md).
