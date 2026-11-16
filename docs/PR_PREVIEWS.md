# PR checks and local preview packages

Every pull request receives the existing build, TypeScript, style, coverage, security, application and native selfhost checks. This includes forks and Dependabot. GitHub may still require approval for first-time external workflow runs. Missing required labels continue to fail `PR metadata`; a preview package replaces neither this classification nor the separate security analysis.

The new `PR preview package` job waits for all five quality jobs, coverage, `verify` and `Actual isolated selfhost image compatibility`. Only then does it create a downloadable package of the commit actually tested. Its own fresh checkout contains no credentials or reports from the preceding test run. The package contains:

- `portal-source.tar.gz`: tracked application sources only, including migrations and the local launcher.
- `manifest.json`: the PR head, tested merge commit, workflow run and attempt, and the source archive's SHA-256.
- `README.txt`: German/English startup instructions and prerequisites.
- `preview.mjs`: the entry point for a separate local PR runtime with persistent data.

## Try a package

Open the link in the `PR preview package` job summary or the `pr-<number>-local-preview` GitHub deployment. The link points to a GitHub Actions artifact; downloading it normally requires signing in to GitHub. It is explicitly **not an internet-hosted portal instance**. GitHub retains the package for seven days unless it is deleted earlier.

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

The [pr-previews.yml](../.github/workflows/pr-previews.yml) workflow executes only the publisher from the trusted default branch. It has `deployments: write` and read-only permissions for sources, Actions and PR metadata. It does not install packages, download artifacts or execute PR code, and it receives no hosting secrets. The `pull_request_target` event is also used only to clean up metadata for a closed PR.

The publisher reconfirms the repository, actual workflow path, PR head, current workflow attempt and every expected successful job through GitHub's API. It reads only the metadata of the uniquely named, unexpired artifact, including its GitHub-provided digest. A newer run or a changed/closed PR must prevent an old result from being published as current. Fork payloads without a direct PR association are resolved through the associated commit API. Free-form PR text is never used as commands or URLs.

The deployment is marked transient and non-production. Its status is `in_progress` during checks and `failure` when checks fail. Here, `success` explicitly means **“local preview package available for download”**; the supplied link points to the actual artifact. Closing a PR or publishing a newer preview deactivates older records. A daily metadata run deactivates expired, deleted or superseded packages. Other deployment tasks and production environments remain unchanged.

The new trusted publisher becomes active through `workflow_run` only once its workflow and script files are on the default branch. The PR that first introduces it can already build its package. After reviewing the source, an authorised person can perform its first deployment publication once, using the same tested metadata publisher against the actual fully successful PR run. The process requires `GITHUB_REPOSITORY`, `GITHUB_EVENT_NAME=workflow_run`, a private event path containing the real run ID and attempt number, and a `GH_TOKEN` passed in process memory; the publisher reconfirms every value through the API. It receives no artifact contents and executes no contribution code. This first publication requires separate evidence; it does not activate the automatic default-branch workflow ahead of time. Without this actual step or a later automatic run, local tests or valid YAML files must not be described as a completed remote publication.

## Hosted previews and existing releases

The existing development installation at `cms.luminovia.org` remains a separate environment with persistent data for successfully tested `main`. It is not reused for unmerged contributions. The existing release job and independent security and metadata checks are preserved; the local PR package receives neither production keys nor access to that data.

A persistently browser-accessible portal for each PR requires a separately configured preview host with isolated Auth, database, Storage and email environments, plus controlled cleanup. A static frontend copy with an invented backend would not provide working login and business workflows. This implementation registers no such service and claims no public PR URL.

References: [GitHub deployment API](https://docs.github.com/en/rest/deployments/deployments), [deployment statuses](https://docs.github.com/en/rest/deployments/statuses) and [security boundaries for privileged workflows](https://docs.github.com/en/actions/reference/security/secure-use).
