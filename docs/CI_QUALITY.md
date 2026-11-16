# GitHub checks, security and coverage

> Server snapshot verified on 16 November 2026 at 06:42:36 UTC: all three `main` rulesets are active. Every change requires a PR, including maintenance-App changes. Only `CarinaSchoppe` (`User:29256704`) has a personal PR-only review exception (`bypass_mode: pull_request`). No repository role, other user, bot or App has that exception. All fifteen required checks and the separate history/signature rules remain mandatory. Live server rules are authoritative. [Live rules](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/rules).

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
| PR preview package                           | Gated downloadable source package for the tested PR revision; no hosted portal is implied.                                   |
| CodeQL (javascript-typescript)               | Static security analysis of JavaScript and TypeScript.                                                                       |
| CodeQL (python)                              | Static security analysis of Python.                                                                                          |
| CodeQL (actions)                             | Static security analysis of GitHub Actions.                                                                                  |
| Dependency review                            | Newly introduced dependency vulnerabilities in pull requests.                                                                |
| CodeQL                                       | Generated findings check, separate from successful scanner execution.                                                        |

The release job requires the fast quality gates and both complete application/selfhost gates. The active required-check rule requires all fifteen checks against the current base before any identity can merge a PR, including the separate Security outcomes. VPS automation still verifies that the entire CI run for the exact main commit succeeded.

[CodeQL](../.github/workflows/security.yml) additionally analyses JavaScript/TypeScript, Python and GitHub Actions on PRs/main and on Mondays at 05:23 UTC (15:23 Brisbane). This is static security analysis, not a replacement for real RLS/auth/file-access tests. Findings appear under GitHub Security/Code scanning; a successfully completed scan does not by itself mean there are no warnings. Its three language analyses, `Dependency review` and the generated `CodeQL` finding check are now required for PR merges. The fourteen workflow-produced statuses are bound to GitHub Actions integration `15368`; the generated `CodeQL` status is bound to integration `57789`. The separate Security workflow is not an additional release-job `needs` gate; publication conditions remain explicitly defined in `ci.yml`.

Current `main` still publishes development packages automatically after its explicit CI dependencies succeed. The requested local-first, manual-only publication path remains proposed in [PR #27](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/27); it is not yet merged or part of the combined PR13/PR23 source. Successful checks alone provide no new deployment or publication authorization.

## Current integration evidence boundary

The combined PR13/PR23 source includes the customer-neutral course catalogue, related application/test changes and the additive 27th migration. It is not a documentation-only change. See [course building blocks](COURSE_BUILDING_BLOCKS.md) for the current catalogue paths and preservation contract. Earlier 24- or 26-migration results remain historical and do not accept this complete 27-migration composition. Documentation and metadata checks cover their own scope; all required application, database, browser, security and retained-data checks must pass on the exact final source before merging.

## Running and interpreting coverage

```bash
npm ci
npm run test:coverage
```

The local HTML report is `coverage/index.html`; machine-readable output is in `coverage/coverage-summary.json` and `coverage/lcov.info`. In GitHub Actions, download the coverage report from the run's Artifacts section. `coverage/` is intentionally not versioned.

Coverage includes **all executable `src` TS/TSX files and `scripts/public-config.ts`**, including modules not imported by tests. Tests, test setup and declarations are excluded. V8 coverage comes from unit/component tests; SQL, Edge, Python/Node maintenance and real browser workflows are not combined into an invented overall percentage.

The first complete measurement with the additional cases passed **197 tests in 46 files**: statements 47.09%, branches 41.61%, functions 37.07%, lines 48.89% across 106 source files. Global thresholds 46.5/41/36.5/48 limit regressions against this measured baseline with a small allowance for variation. Untested UI paths remain visible; files are not excluded to manufacture an arbitrary 80% result.

Critical areas have stricter gates: 100% for browser-key configuration, time-zone/DST/date logic and scheduling; separate high statement/branch/function/line thresholds for file transfer and safe knowledge content. Exact values are in [vite.config.ts](../vite.config.ts). Future improvements should raise measured coverage; thresholds are not automatically lowered.

New real cases check uploads only after online/auth confirmation, progress capped at 95% until clean status is confirmed, quarantine/timeouts/retry context, exact-version `no-store` downloads and rejection of secret browser keys. The test run needs no real user or customer file.

## Dependabot and security features

[dependabot.yml](../.github/dependabot.yml) adds updates for SHA-pinned GitHub Actions (Mondays 04:17 UTC / 14:17 Brisbane) and npm security fixes (daily configuration 04:47 UTC / 14:47 Brisbane). Regular npm/Node/JSR/container versions remain with the existing daily full candidate-verification path, avoiding two uncoordinated systems handling the same regular updates. Vitest and `@vitest/*` are treated there as one family with matching exact peers.

Dependabot PRs receive suitable existing type/area/risk labels and run through the same checks. There is no blanket automatic merge of unverified dependencies. Dependabot alerts were already enabled; security-update PRs, Secret Scanning and Push Protection have now been enabled and read back on the public repository. The initially disabled dependency graph was enabled in repository settings; the real Dependency Review retry and comparison of 12 changed dependencies passed. No paid service was added. Full npm audit still reports the four previously documented low-severity build-tool findings in the unchanged `deepmerge`/Workbox chain; the production audit is separate. Dependency review evaluates newly introduced findings and does not declare this existing debt fixed.

## Maintainers and server-side rules

The reviewed server snapshot on 16 November 2026 at 06:42:36 UTC records all three rulesets as active with fifteen mandatory statuses. Source snapshots preserve that reviewed configuration; live server rules are authoritative and may later differ. Only `CarinaSchoppe` (`User:29256704`) has a personal PR-only review exception (`bypass_mode: pull_request`). No repository role, other user, bot or App has that exception. All fifteen required checks and the separate history/signature rules remain mandatory. The review ruleset contains only its pull-request rule; security statuses and history/code-quality restrictions remain enforced in their separate layers.

No App has a review or required-check exception. Earlier App-token tests belong to their recorded historical rules. See [GITHUB_WORKFLOW](GITHUB_WORKFLOW.md#active-rule-layers) for the current configuration.

The initial setup was merged through [PR11](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/11). All six new quality/coverage checks and the corrected security run passed on the actual PR revision; the maintainer merge succeeded while the long-running tests were still active under the earlier rules. That historical proof does not describe the current stricter required-check rule. Main checks then run again and remain a publication condition. The scanner job and generated CodeQL findings check were verified separately; the initial test-fixture finding was fixed by checking the exact URL origin. The first complete main scan additionally reports existing operations/test-script findings. They are individually assessed in [CODE_SCANNING_TRIAGE](CODE_SCANNING_TRIAGE.md); a successful PR-diff scan does not imply a main scan without warnings.

Official references: [GitHub CodeQL](https://docs.github.com/en/code-security/code-scanning/introduction-to-code-scanning/about-code-scanning-with-codeql), [Dependabot](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependabot-version-updates), [Vitest coverage](https://vitest.dev/guide/coverage.html). Exact executed checks and GitHub runs are recorded in [WORKLOG](WORKLOG.md).
