# GitHub checks, security and coverage

Workflows run on pull requests and `main`; manual execution is also available. They require no VPS credentials, private Supabase keys or production data. Existing real application/database/API/browser checks remain in place.

## Visible jobs

| Check                                        | Actual verification                                                                                              |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Build                                        | Production compilation and PWA build with synthetic public Supabase configuration only. No real instance access. |
| Typecheck                                    | TypeScript project validation with `npm run typecheck`.                                                          |
| Lint                                         | ESLint with no allowed warnings.                                                                                 |
| Formatting                                   | Existing source formatting and GitHub configuration.                                                             |
| Code quality                                 | Existing compiler-based checks for reachable modules, exports and connections.                                   |
| Tests and coverage                           | All Vitest unit/component tests, V8 coverage and actual thresholds; downloadable HTML/LCOV/JSON artifacts.       |
| verify                                       | `./portal test`: genuinely isolated SQL/RLS/API/Edge/browser/PWA, security, restart and maintenance checks.      |
| Actual isolated selfhost image compatibility | Real pinned Supabase images and retained-data upgrade from the previous source revision.                         |
| PR metadata                                  | Current PR labels and matching repository/commit identity.                                                       |

The release job requires the fast quality gates and both complete application/selfhost gates. An early maintainer merge can bypass repository rules but cannot publish a failed package. VPS automation still requires a successful complete CI run on exact main.

[CodeQL](../.github/workflows/security.yml) additionally analyzes JavaScript/TypeScript, Python and GitHub Actions on PRs/main and Mondays at 05:23 UTC (15:23 Brisbane). This is static security analysis and does not replace actual RLS/Auth/file-access tests. Findings appear in GitHub Security/Code scanning; a successfully completed scan alone does not mean there are no warnings. This separate Security workflow is currently not an additional release `needs` gate; publication conditions are explicit in `ci.yml`.

## Running and interpreting coverage

```bash
npm ci
npm run test:coverage
```

Local reports are in `coverage/index.html`, with machine-readable output in `coverage/coverage-summary.json` and `coverage/lcov.info`. GitHub Actions provides the coverage report under each run's Artifacts. `coverage/` is deliberately untracked.

Coverage includes **all executable `src` TS/TSX files and `scripts/public-config.ts`**, including unimported modules. Tests, test setup and declarations are excluded. V8 coverage comes from unit/component tests; SQL, Edge, Python/Node maintenance and real browser workflows are never combined into an invented overall percentage.

The first complete measurement with the added cases passes with **197 tests in 46 files**: statements 47.09%, branches 41.61%, functions 37.07% and lines 48.89% across 106 measured source files. Global thresholds of 46.5/41/36.5/48 prevent regression from this honest baseline with a small measurement margin. Untested UI paths stay visible; an arbitrary 80% target is not achieved by excluding them.

Critical areas have stronger gates: 100% for browser-key configuration, timezone/DST/date logic and scheduling, plus high separate statement/branch/function/line limits for file transfer and safe knowledge content. Exact values are in [vite.config.ts](../vite.config.ts). Future improvements raise measured coverage; thresholds are not automatically lowered.

New meaningful cases check uploads only after online/Auth confirmation, progress capped at 95% before confirmed clean status, quarantine/timeout/retry context, exact-version `no-store` downloads and rejection of secret browser keys. These tests require no real user/customer files.

## Dependabot and security features

[dependabot.yml](../.github/dependabot.yml) adds updates for SHA-pinned GitHub Actions (Mondays 04:17 UTC / 14:17 Brisbane) and npm security corrections (daily configuration 04:47 UTC / 14:47 Brisbane). Ordinary npm/Node/JSR/container versions stay in the existing daily complete candidate-verification path, avoiding competing systems for the same regular updates. Vitest and `@vitest/*` are treated as one exact peer family there.

Dependabot PRs receive appropriate existing type/area/risk labels and run the same checks. There is no blanket automatic merge of unverified dependencies. Dependabot alerts were already active; security-update PRs, Secret Scanning and Push Protection were enabled and read back on this public repository. The initially disabled Dependency Graph was enabled in repository settings; the real Dependency Review retry and comparison of 12 changed dependencies passed. No paid service was added. The full npm audit retains the four previously documented low build-tool findings in the unchanged `deepmerge`/Workbox chain; the production audit is separate. Dependency Review evaluates newly introduced findings and does not declare this historical issue fixed.

## Maintainers and server-side rules

Maintainers and administrators receive `always` exceptions; ordinary write permission receives no bypass. The active rule already included these roles. Both additionally prepared review/check rules were synchronized with the same current instruction but remain disabled until the maintenance App path is proved. Details and actual activation status: [GITHUB_WORKFLOW](GITHUB_WORKFLOW.md).

The setup merged in [PR #11](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/11). All six new quality/coverage jobs and the corrected security run passed on the actual PR revision; the maintainer merge succeeded while long-running tests were still active. Main checks run again afterward and remain the publication condition. Scanner jobs and generated CodeQL finding checks were inspected separately; the initial test-fixture finding was fixed through an exact URL-origin check. The first complete main scan also reports existing operating/test-script hints, individually classified in [CODE_SCANNING_TRIAGE](CODE_SCANNING_TRIAGE.md). A successful PR diff scan does not mean a warning-free main scan.

Official references: [GitHub CodeQL](https://docs.github.com/en/code-security/code-scanning/introduction-to-code-scanning/about-code-scanning-with-codeql), [Dependabot](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependabot-version-updates), [Vitest coverage](https://vitest.dev/guide/coverage.html). Exact executed checks and GitHub runs are recorded in [WORKLOG](WORKLOG.md).
