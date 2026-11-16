# Try the latest GitHub revision locally

```bash
./portal github
```

The command fetches current `main` from **Luminovia-Training-Consulting/Luminovia-Management-Tool**, displays its full commit ID and starts it as a separate local portal at **http://127.0.0.1:5373**. Your current checkout and uncommitted changes remain intact. It neither runs `git pull` in your development branch nor resets an existing database.

Requirements match [local development](LOCAL_DEVELOPMENT.md): Linux, Node/npm, Git, Docker Engine/Compose, Python 3 and util-linux `flock`. First startup downloads locked dependencies, Supabase services and scanner signatures. Concurrent development and preview environments each require memory for their own scanner; complete QA needs additional resources.

## Commands

| Command                                      | Effect                                                                                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `./portal github` or `./portal github start` | Fetch current GitHub source, update the owned preview if necessary and start it.                                                      |
| `./portal github update`                     | Fetch current source, apply a newer revision while preserving data and start it.                                                      |
| `./portal github status`                     | Show the recorded commit ID, actual supervisor phase and local addresses; no network fetch.                                           |
| `./portal github stop`                       | Stop only the managed preview and retain its data.                                                                                    |
| `./portal github credentials`                | Deliberately display the original password for your fictional preview accounts. Do not share it.                                      |
| `./portal github plan`                       | Show current GitHub source, new migrations and review requirements without updating or stopping a running preview.                    |
| `./portal github test`                       | Verify the latest commit in a separate test checkout with complete `./portal test`. A running preview stays on its previous revision. |

Every start/update/test invocation must actually fetch the current main branch. Network/Git failures are reported; the launcher does not claim current source or start an older fallback. A failed fetch does not stop an already running preview. `status`, `stop` and `credentials` require no GitHub fetch.

## Separate services and persistent test data

| Environment        | Portal | Supabase API | PostgreSQL | Mailpit |
| ------------------ | ------ | ------------ | ---------- | ------- |
| Normal development | `5173` | `54321`      | `54322`    | `54324` |
| GitHub preview     | `5373` | `56321`      | `56322`    | `56324` |
| Complete QA        | `5273` | `55321`      | `55322`    | `55324` |

All addresses bind to loopback. The preview receives its own stable `luminovia-portal-github-…` Supabase project derived from the launcher directory. New empty previews receive only existing fictional sample accounts. Passwords, MFA, profiles, appointments and Storage files are not reinitialized by stop/start or successful forward updates. No credentials or real data are copied from normal development.

Managed source lives under `.local/github-preview/source/`. Its own ignored `.local/` and environment files survive updates. Git retains the exact main commit; only `supabase/config.toml` receives a documented local project/port adjustment. The launcher checks that adjustment's fingerprint before every update. This source copy is for evaluation: put your own code changes in a normal development branch. Modified or foreign files in managed source are rejected rather than overwritten.

GitHub test checkouts are separate under `.local/github-preview/test-<full-commit-ID>/`. Within them the canonical launcher still creates a random temporary QA database and acquires the shared system-wide QA lock. Reports remain in each checkout's `.local/tests/`. Test checkouts and installed dependencies use additional disk space; they are not automatically deleted together with possible diagnostics.

A local Docker volume does not replace a backup. This tool neither synchronizes production data nor performs a hosted installation.

## Migrations and interrupted updates

The existing local runtime applies new additive migrations during normal startup. Rewritten Git history, changed/removed historical migrations, backdated migrations, a different PostgreSQL major version or a retargeted remote address are rejected before data changes.

For new migrations, the preview plan uses the existing updater's SQL compatibility review. Changes requiring review are refused **before stopping services**. Inspect the named SQL files at the exact commit and back up relevant owned preview data. After deliberate review, accept exactly the displayed plan:

```bash
./portal github plan
./portal github update --accept-migration-plan DISPLAYED_SHA256_DIGEST
```

Replace the placeholder with the complete displayed digest. It binds target commit, previous state and new migration sources. A changed revision requires a new plan. This acknowledgment is solely a local operator decision; it is not production approval and bypasses neither history checks nor the PostgreSQL-major-version block. Business changes made by a deliberately accepted migration are not automatically undone.

A private transition record identifies interruption exactly between Git checkout and writing local port configuration. Only the recorded old/new commit with unchanged source files is normalized. Unknown changes are rejected. The launcher never resets the database or performs a hidden database rollback. If subsequent service startup fails, owned source, data and private logs remain for diagnosis.

## Launcher development and acceptance

The eleven `runtime-github.test.mjs` cases use real temporary Git repositories and real Node subprocesses. They check version changes, preserved fictional password/file bytes, untouched development changes, data/history boundaries, separate test checkouts, existing and dangling symlinks, interrupted configuration transitions and release of the kernel lock after process termination. Their service adapter is explicitly a fixture; these cases do not replace actual Supabase Auth/Storage restart acceptance.

```bash
node --test scripts/runtime-github.test.mjs
```

The regular complete command discovers these cases automatically. Actually executed full/native checks and the real preview restart are recorded separately in [WORKLOG](WORKLOG.md) and [QA_RESULTS](QA_RESULTS.md).

## Executed M6 upgrade checkpoint — 16 November 2026

The official preview was actually upgraded from main `5f89986` with 18 migrations to accepted main merge `dc8e9a7` with 24 migrations. The six new migration sources were reviewed and their exact plan digest accepted; the update returned exit 0. Status and database history independently confirmed that SHA and 24 migrations on the separate 5373/563xx project. A subsequent real stop/start probe returned exit 0 and preserved password, verified MFA, edited profile/timezone, private event and exact private Storage bytes; only its fictional probe records/bucket were removed. Normal 5173/543xx and hosted databases were not targeted. These historical values are evidence, not a digest to reuse for a later update: always review the newly displayed plan.
