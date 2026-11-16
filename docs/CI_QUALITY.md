# GitHub checks, security and coverage

Workflows run for pull requests and `main`; manual execution is also available. They need no VPS credentials, private Supabase keys or production data. Existing real application/database/API/browser checks remain in place.

## Visible checks

| Check                                        | What it verifies                                                                                                             |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Build                                        | Production compilation and PWA build using only synthetic public Supabase configuration. It does not access a real instance. |
| Typecheck                                    | TypeScript project checks through `npm run typecheck`.                                                                       |
| Lint                                         | ESLint with no warnings allowed.                                                                                             |
| Formatting                                   | Existing source formatting and GitHub configuration.                                                                         |
| Code quality                                 | Existing compiler-based checks for reachable modules, exports and connections.                                               |
| Tests and coverage                           | All Vitest unit/component tests, V8 coverage and enforced thresholds; downloadable HTML/LCOV/JSON artifacts.                 |
| verify                                       | `./portal test`: real isolated SQL/RLS/API/Edge/browser/PWA, security, restart and maintenance checks.                       |
| Actual isolated selfhost image compatibility | Real pinned Supabase images and retained data from the previous source revision.                                             |
| PR metadata                                  | Current PR labels and matching repository/commit identity.                                                                   |
| CodeQL (javascript-typescript)               | Static security analysis of JavaScript and TypeScript.                                                                       |
| CodeQL (python)                              | Static security analysis of Python.                                                                                          |
| CodeQL (actions)                             | Static security analysis of GitHub Actions.                                                                                  |
| Dependency review                            | Newly introduced dependency vulnerabilities in pull requests.                                                                |
| CodeQL                                       | Generated findings check, separate from successful scanner execution.                                                        |

The release job requires the fast quality gates and both complete application/selfhost gates. The active required-check rule requires all fourteen checks against the current base before a human maintainer can merge a PR, including the separate Security outcomes. VPS automation still verifies that the entire CI run for the exact main commit succeeded.

[CodeQL](../.github/workflows/security.yml) additionally analyses JavaScript/TypeScript, Python and GitHub Actions on PRs/main and on Mondays at 05:23 UTC (15:23 Brisbane). This is static security analysis, not a replacement for real RLS/auth/file-access tests. Findings appear under GitHub Security/Code scanning; a successfully completed scan does not by itself mean there are no warnings. Its three language analyses, `Dependency review` and the generated `CodeQL` finding check are now required for PR merges. The thirteen workflow-produced statuses are bound to GitHub Actions integration `15368`; the generated `CodeQL` status is bound to integration `57789`. The separate Security workflow is not an additional release-job `needs` gate; publication conditions remain explicitly defined in `ci.yml`.

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

Live readback after 02:45 UTC on 16 November 2026 confirms that the review and required-check rules are active. Maintainers and administrators have `pull_request` bypass on the review rule only: they can bypass independent approval through a PR, but must wait for all fourteen checks against the current base. The required-check rule grants no human bypass. Ordinary write access grants no review exception. The history/signature rule has no bypass actors, including for maintainers, administrators or the maintenance App.

The maintenance App, integration `5776881`, has `always` exceptions on review and checks. This configuration does not by itself prove its token/workflow delivery on current main. See [GITHUB_WORKFLOW](GITHUB_WORKFLOW.md#activation-still-pending) for active rule settings, separate App evidence and remaining source delivery.

The initial setup was merged through [PR11](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/11). All six new quality/coverage checks and the corrected security run passed on the actual PR revision; the maintainer merge succeeded while the long-running tests were still active under the earlier rules. That historical proof does not describe the current stricter required-check rule. Main checks then run again and remain a publication condition. The scanner job and generated CodeQL findings check were verified separately; the initial test-fixture finding was fixed by checking the exact URL origin. The first complete main scan additionally reports existing operations/test-script findings. They are individually assessed in [CODE_SCANNING_TRIAGE](CODE_SCANNING_TRIAGE.md); a successful PR-diff scan does not imply a main scan without warnings.

Official references: [GitHub CodeQL](https://docs.github.com/en/code-security/code-scanning/introduction-to-code-scanning/about-code-scanning-with-codeql), [Dependabot](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependabot-version-updates), [Vitest coverage](https://vitest.dev/guide/coverage.html). Exact executed checks and GitHub runs are recorded in [WORKLOG](WORKLOG.md).

The earlier English-guide branch CI covered its 24-migration baseline. It does not accept the later 32-migration product integration. Exact CI43794921492 on `9c42730` passed 316 SQL cases, 26 actual business API suites and restart persistence, but failed 2 of 94 browser journeys. The independent local run of the same `9c42730` source reproduced those two failures after the same 316 SQL/26 API/46 Edge checks and real restart persistence passed. Focused Calendar correction `bf09f19` passes 12 Calendar cases; the combined corrected 32-migration/Demo/guide source still needs a fresh complete run. See [QA_RESULTS](QA_RESULTS.md) and [WORKLOG](WORKLOG.md).

## Current governance boundary

All three rule layers are active. Maintain and Repository-admin roles have PR-only exceptions in the review ruleset. Human accounts have no CI or history/signature exception. The repository-scoped maintenance App has the separately tested technical review/check exception; it must still create valid signed commits and pass the candidate/exact-main release gates. [Current rules and evidence](GITHUB_WORKFLOW.md).
