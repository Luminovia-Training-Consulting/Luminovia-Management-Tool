# GitHub checks, security and coverage

Workflows run for pull requests and `main`; manual execution is also available. They need no VPS credentials, private Supabase keys or production data. Existing real application/database/API/browser checks remain in place.

Development and testing use the local PC by default. `./portal check` runs fast
quality, coverage and build checks without starting services; `./portal test`
provides complete isolated acceptance of the working source before delivery, `./portal github test` verifies freshly fetched `main` locally,
and `./portal github` starts a separate persistent preview. No GitHub deployment
or self-hosted Actions runner is needed. GitHub checks remain independent
verification; a successful check or merge is not a publication request.

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

The release job runs only for an authorised manual `Portal checks` dispatch on
`main` with `publish_release=true` and the exact current `main` SHA supplied as
`expected_commit`. Pushes, ordinary manual verification and daily-maintenance
verification do not publish releases. The fast quality gates and both complete
application/selfhost gates remain required; an early maintainer merge does not
publish a failed package. VPS automation still verifies that the entire CI run
for the exact main commit succeeded. The existing five-minute VPS polling timer
is unchanged; changing publication policy does not claim a hosted timer change.

The `PR preview deployments` workflow is manual-only. The verified downloadable
PR package remains an artifact, independent of optional deployment metadata.
See [PR_PREVIEWS](PR_PREVIEWS.md) for that explicit publication and cleanup path.

[CodeQL](../.github/workflows/security.yml) additionally analyses JavaScript/TypeScript, Python and GitHub Actions on PRs/main and on Mondays at 05:23 UTC (15:23 Brisbane). This is static security analysis, not a replacement for real RLS/auth/file-access tests. Findings appear under GitHub Security/Code scanning; a successfully completed scan does not by itself mean there are no warnings. This separate Security workflow is currently not an additional release `needs` gate; publication conditions are explicitly defined in `ci.yml`.

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

Maintainers and administrators receive `always` exceptions; ordinary write access does not receive a bypass. The active rule already included these roles. The two additional prepared review/check rules were synchronised with the same current instruction but remain disabled until the maintenance App path is proven. See [GITHUB_WORKFLOW](GITHUB_WORKFLOW.md) for details and actual activation status.

The setup was merged through [PR11](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/11). All six new quality/coverage checks and the corrected security run passed on the actual PR revision; the maintainer merge succeeded while the long-running tests were still active. Main checks then run again and remain a publication condition. The scanner job and generated CodeQL findings check were verified separately; the initial test-fixture finding was fixed by checking the exact URL origin. The first complete main scan additionally reports existing operations/test-script findings. They are individually assessed in [CODE_SCANNING_TRIAGE](CODE_SCANNING_TRIAGE.md); a successful PR-diff scan does not imply a main scan without warnings.

Official references: [GitHub CodeQL](https://docs.github.com/en/code-security/code-scanning/introduction-to-code-scanning/about-code-scanning-with-codeql), [Dependabot](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependabot-version-updates), [Vitest coverage](https://vitest.dev/guide/coverage.html). Exact executed checks and GitHub runs are recorded in [WORKLOG](WORKLOG.md).
