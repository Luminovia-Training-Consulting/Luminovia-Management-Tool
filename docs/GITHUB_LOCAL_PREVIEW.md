# Try the latest GitHub version locally

Local execution is the default development workflow. Run `./portal check` for
fast quality/coverage/build feedback and `./portal test` in your own checkout for
complete isolated acceptance before delivery. Use `./portal github test` to
fetch and verify the latest `main` on this PC. Neither command publishes a
GitHub deployment or requires registering the PC as an Actions runner.
Automatic GitHub quality/security checks remain additional independent evidence.

```bash
./portal github
```

This command fetches the current `main` from **Luminovia-Training-Consulting/Luminovia-Management-Tool**, displays its full commit ID and starts it as a separate local portal at **http://127.0.0.1:5373**. Your current checkout and uncommitted changes are preserved. It does not run `git pull` in your development branch or reset an existing database.

Requirements are the same as for [local development](LOCAL_DEVELOPMENT.md): Linux, Node/npm, Git, Docker Engine/Compose, Python 3 and util-linux `flock`. The first start downloads the locked dependencies, Supabase services and scanner signatures. Concurrent development and preview environments each need memory for their own scanner; complete QA needs additional resources.

### Local-only administrator

The separately owned GitHub preview creates a fictional account at startup. On
`http://127.0.0.1:5373`, sign in with username **admin** and password **admin**.
The shortcut is available only when the browser and API are on the dedicated
loopback preview addresses. Supabase Auth still authenticates the account and
normal administrator MFA requirements apply. This intentionally weak account
must never be created on a hosted instance or copied into any non-test database.

The account is separate from the existing `admin@example.invalid` fixture. If
the preview account already exists, its password and MFA are retained, so a
later password change is not reset to the original value. The ordinary local
development stack, PR previews and isolated QA stacks do not create this
account. The existing generated fixture credentials remain available through
`./portal github credentials`.

## Commands

| Command                                      | Effect                                                                                                                                   |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `./portal github` or `./portal github start` | Fetch the current GitHub version, update the owned preview if necessary and start it.                                                    |
| `./portal github update`                     | Fetch the current version, apply an update without resetting data and start it.                                                          |
| `./portal github status`                     | Show the saved commit ID, actual supervisor phase and local addresses; no network fetch.                                                 |
| `./portal github stop`                       | Stop only the managed preview; preserve its data.                                                                                        |
| `./portal github credentials`                | Deliberately display the original password for your fictional preview accounts. Do not share it.                                         |
| `./portal github plan`                       | Show the current GitHub version, new migrations and review requirements without updating or stopping a running preview.                  |
| `./portal github test`                       | Run the complete `./portal test` against the latest commit in a separate test checkout. A running preview stays on its existing version. |

Every start, update or test invocation must successfully fetch the current main branch. Network and Git errors are reported: the launcher does not claim to be current or start an older fallback version. A failed fetch does not stop an already running preview. `status`, `stop` and `credentials` do not need a GitHub fetch.

## Separate services and persistent test data

| Environment        | Portal | Supabase API | PostgreSQL | Mailpit |
| ------------------ | ------ | ------------ | ---------- | ------- |
| Normal development | `5173` | `54321`      | `54322`    | `54324` |
| GitHub preview     | `5373` | `56321`      | `56322`    | `56324` |
| Complete QA        | `5273` | `55321`      | `55322`    | `55324` |

All addresses bind to loopback. The preview receives its own stable Supabase project, `luminovia-portal-github-…`, derived from the launcher directory. New empty previews receive only the existing fictional sample accounts. Passwords, MFA, profiles, appointments and Storage files are not reinitialized by stop/start or successful forward updates. No credentials or real data are copied from your normal development environment.

The managed source is under `.local/github-preview/source/`. Its own ignored `.local/` and environment files survive updates. Git records the exact main-branch commit; only `supabase/config.toml` receives a documented local project/port adjustment. The launcher verifies its fingerprint before every update. This source copy is for trying the application: make your own code changes in a normal development branch. Modified or foreign files in the managed source are rejected rather than overwritten.

GitHub test checkouts are separate, under `.local/github-preview/test-<full-commit-ID>/`. The canonical test launcher still creates a random, short-lived QA database there and uses the shared system-wide QA lock. Reports remain in that checkout's `.local/tests/`. Test checkouts and installed dependencies consume additional disk space; they are not automatically deleted along with potentially useful diagnostics.

A local Docker volume is not a backup. This tool does not synchronize production data or perform a hosted installation.

## Migrations and interrupted updates

The existing local runtime applies new additive migrations during normal startup. Rewound Git history, changed or removed historical migrations, backdated migrations, a different PostgreSQL major version or a changed remote address are rejected before any data change.

For new migrations, the preview plan uses the existing updater's SQL compatibility check. Changes requiring review are rejected **before stopping services**. Inspect the named SQL files at the specific commit and back up any preview data you need. Only after reviewing them should you accept the exact displayed plan:

```bash
./portal github plan
./portal github update --accept-migration-plan DISPLAYED_SHA256_DIGEST
```

Replace `DISPLAYED_SHA256_DIGEST` with the full displayed digest. It binds the target commit, previous state and new migration sources. A version that changes in the meantime requires a new plan. Acceptance is a local operator decision only: it is not production approval and does not bypass history checks or the PostgreSQL major-version restriction. It does not automatically undo business-data changes made by a deliberately accepted migration.

A private transition record detects interruptions between Git checkout and writing the local port configuration. Only the recorded old or new commit with unchanged source files is normalized. Unknown changes are rejected. The launcher does not reset the database or silently roll it back. If a subsequent service startup fails, the owned source, data and private logs remain available for diagnosis.

## Launcher development and acceptance

The eleven `runtime-github.test.mjs` cases use real temporary Git repositories and real Node subprocesses. They check version changes, retained fictional password/file bytes, untouched development changes, data/history boundaries, separate test checkouts, existing and dangling symlinks, interrupted configuration transitions and release of the kernel lock after process exit. Their service adapter is explicitly a fixture; these cases do not replace a real Supabase Auth/Storage restart acceptance check.

```bash
node --test scripts/runtime-github.test.mjs
```

The regular complete command discovers these cases automatically. Actual complete/native checks and the real preview restart are recorded separately in [QA evidence](QA_RESULTS.md).

## Executed M6 upgrade checkpoint — 16 November 2026

The official preview was actually upgraded from main `5f89986` with 18 migrations to the accepted main merge `dc8e9a7` with 24 migrations. The six new migration sources were reviewed and their exact plan digest accepted; the update returned exit 0. Status and database history independently confirmed that SHA and 24 migrations on the separate `5373`/`563xx` project. A subsequent real stop/start probe returned exit 0 and preserved the password, verified MFA, edited profile/timezone, private event and exact private Storage bytes; only its fictional probe records/bucket were removed. Normal `5173`/`543xx` and hosted databases were not targeted. These historical values are evidence, not a digest to reuse for a later update: always review the newly displayed plan.
