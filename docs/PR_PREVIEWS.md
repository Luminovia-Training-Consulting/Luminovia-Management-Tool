# PR checks and local preview packages

Run `./portal check` on the local PC for fast feedback while editing, then
`./portal test` for complete isolated acceptance before delivery. To test the
latest `main` locally use `./portal github test`; `./portal github` starts its
persistent local preview. These commands require no GitHub deployment or
self-hosted Actions runner.

Every pull request receives build, TypeScript, style, coverage, security and metadata checks. Verified Draft documentation changes additionally run runtime/Edge/audit checks; ordinary Draft frontend changes also run all existing SQL migration/RLS/concurrency suites in two independent pinned PostgreSQL clusters. Sensitive/unknown changes and every ready PR require aggregate full system, browser and native retained-data acceptance. Full-PR system and browser phases use separate fresh stacks; neither phase alone is complete acceptance. Switching to Ready starts a fresh full run through `ready_for_review`, even without another commit. Main/manual always receives complete acceptance. See [CI profiles](CI_QUALITY.md). This includes forks and Dependabot. GitHub may still require approval for first-time external workflow runs. Missing required labels continue to fail `PR metadata`; a preview package replaces neither this classification nor the separate security analysis.

The `PR preview package` job waits for all five quality jobs, coverage, scope, `verify`, `Isolated browser acceptance` and `Actual isolated selfhost image compatibility`. Only then does it create a downloadable package of the commit actually tested. Drafts may carry a narrower documentation or SQL profile; ready PRs require the full system/browser/native profile, with actual completion of every phase. The manifest and bilingual README record the actual profile. Wait for the fresh Ready/full run before queuing a merge; a narrower Draft package does not certify complete acceptance. A manual Portal checks run on the branch can exercise full verification separately. Creating the artifact does not create a GitHub Deployment record. Its own fresh checkout contains no credentials or reports from the preceding test run. The package contains:

- `portal-source.tar.gz`: tracked application sources only, including migrations and the local launcher.
- `manifest.json`: the PR head, tested merge commit, workflow run and attempt, and the source archive's SHA-256.
- `README.txt`: German/English startup instructions and prerequisites.
- `preview.mjs`: the entry point for a separate local PR runtime with persistent data.

## Try a package

Open the link in the `PR preview package` job summary. If a maintainer explicitly publishes deployment metadata, its `pr-<number>-local-preview` record links to the same artifact. Downloading it normally requires signing in to GitHub. It is explicitly **not an internet-hosted portal instance**. GitHub retains the package for seven days unless it is deleted earlier.

Review an external contribution's source before running it locally. It executes on your computer, including package installation and development tools. Extract the artifact into a new, dedicated directory. In that directory, run:

```bash
tar -xzf portal-source.tar.gz
node preview.mjs start
node preview.mjs credentials
```

Prerequisites are Linux, Node.js 22.12 or later, npm, Docker Engine and Docker Compose 2.20.2 or later. Preview ports 5473/573xx must be available; the launcher does not terminate unrelated processes. These ports differ from normal development, full tests and the latest-main preview. Other prerequisites are documented in [LOCAL_DEVELOPMENT](LOCAL_DEVELOPMENT.md).

Use the wrapper; running `./portal start` in the extracted canonical source directory would use its unchanged normal development identity. The wrapper verifies the archive and configuration checksums, creates a separate private copy under `.preview/source`, and changes only that copy's project ID, Auth URLs and ports. The project ID includes the PR number and a hash of the tested source revision and package path; this also keeps database/Storage volumes separate from a stopped normal development environment. The unchanged archive and its canonical sources remain the reference. Modified project configurations, unrelated directories and symlinked private runtime state are refused.

The separate runtime installs the locked dependencies, starts the complete local application including Supabase and Mailpit, and creates fictional accounts in an initially empty environment. The portal opens at <http://127.0.0.1:5473>; the API and Mailpit use ports 57321/57324. Generated credentials are created locally only; actual email delivery is intercepted locally. Do not overwrite existing development directories with this package.

```bash
node preview.mjs stop
```

This command stops the separate preview while preserving its local data. `node preview.mjs status` checks this runtime; `node preview.mjs prepare` only creates and verifies the separate source copy, without starting a service. A successful package build does not prove that the preview has already started on every other computer.

## GitHub deployments and permissions

The [pr-previews.yml](../.github/workflows/pr-previews.yml) workflow is
**manual-only** and accepts dispatches on `main`. It has no automatic
`workflow_run`, PR or scheduled deployment trigger. In GitHub Actions, choose
`PR preview deployments` → `Run workflow` on `main`, then select:

- `action=publish`, with the successful `Portal checks` run's `run_id` and exact
  `run_attempt`, to publish its verified local artifact metadata.
- `action=cleanup` (the default), to deactivate stale/closed/expired metadata
  without publishing a new deployment. Run this deliberately when cleanup is
  needed; PR closure and the passage of time no longer schedule it automatically.

Publication requires an explicit user request. The workflow executes only the
publisher from the trusted default branch. It has `deployments: write` and
read-only permissions for sources, Actions and PR metadata. It does not install
packages, download artifacts or execute PR code, and receives no hosting secrets.

The publisher reconfirms the repository, actual workflow path, PR head, current workflow attempt and every expected successful job through GitHub's API. It reads only the metadata of the uniquely named, unexpired artifact, including its GitHub-provided digest. A newer run or a changed/closed PR must prevent an old result from being published as current. Fork payloads without a direct PR association are resolved through the associated commit API. Free-form PR text is never used as commands or URLs.

The deployment is transient and non-production. Its `success` means
**“local preview package available for download”**; the supplied link points to
the actual artifact. Publishing a current preview deactivates superseded records;
the manual cleanup action deactivates closed, expired, deleted or stale records.
Existing records are not claimed removed merely because the workflow changed.
Record actual publication/cleanup evidence separately from local test results.

## Hosted previews and existing releases

The development installation at `cms.luminovia.org` remains separate and holds persistent data. After exact-current-main push runs of both Portal checks and Security analysis succeed, the automatic CMS workflow may publish a verified immutable release for the existing VPS poller. The manual exact-SHA release path also remains available. Migrations, backups, health and rollback are still checked by the server updater; a successful workflow alone does not establish an installation. PR metadata publication remains separate and manual. The local PR package receives neither server keys nor hosted data.

A persistently browser-accessible portal for each PR requires a separately configured preview host with isolated Auth, database, Storage and email environments, plus controlled cleanup. A static frontend copy with an invented backend would not provide working login and business workflows. This implementation registers no such service and claims no public PR URL.

References: [GitHub deployment API](https://docs.github.com/en/rest/deployments/deployments), [deployment statuses](https://docs.github.com/en/rest/deployments/statuses) and [security boundaries for privileged workflows](https://docs.github.com/en/actions/reference/security/secure-use).
