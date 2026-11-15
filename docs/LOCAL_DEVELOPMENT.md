# Local application and persistence

The supported entry point is the executable `./portal` in the repository root. It orchestrates the actual React/Vite frontend, PostgreSQL, Supabase Auth, Storage, Realtime, Edge Functions and Mailpit. The required local malware scanner is started before Edge Functions when its script is present. This is a development environment, never a production deployment.

## One-command start

```bash
./portal start
```

Requirements: a Linux host (CachyOS locally / Ubuntu CI), Node.js >=22.12 (26 LTS tested), npm, a running Docker Engine and Docker Compose 2.20.2 or later with healthcheck `start_interval` support. Full verification additionally needs Python 3 for the updater fixtures and util-linux `flock` for the shared host/user QA lock. Complete encrypted-backup guards require official `age`/`age-keygen`1.x (tested1.3.2) on PATH, or the explicit `AGE_TEST_BINARY`/`AGE_KEYGEN_TEST_BINARY` fixture paths; missing tools fail before crypto tests can skip. The launcher installs exact lockfile dependencies when required, starts the local services, applies new migrations without resetting tables, initializes fictional fixtures only for an empty first bootstrap, waits for the actual invitation handler and frontend to be ready, and prints the local URLs.

- Portal: <http://127.0.0.1:5173>
- Supabase API: <http://127.0.0.1:54321>
- Local email capture: <http://127.0.0.1:54324>
- Fresh bootstrap accounts: `admin@example.invalid`, `carina@example.invalid` (owner demonstration), `client@example.invalid` (fictional organisation), `lecturer01@example.invalid` through `lecturer11@example.invalid`, `participant@example.invalid` — 15 distinct Auth identities. Populated instances retain existing records and are never automatically reseeded.

The first start needs Docker image downloads and may take several minutes. The scanner needs additional RAM for signature loading; see the scanner documentation. Ports must be free; the launcher does not kill an unrelated process occupying a port.

The launcher creates only its own labelled `portal_network_<project>` Docker bridge with `com.docker.network.bridge.host_binding_ipv4=127.0.0.1`, then passes that network explicitly to Supabase startup and Edge Functions. It inspects the effective container port bindings before reporting readiness: PostgreSQL, the API and Mailpit must publish only to loopback; ClamAV publishes no host port. It refuses an unowned network and never changes the Docker daemon configuration. The legacy `scripts/local-start.sh` and `scripts/local-functions.sh` both delegate to the same managed launcher. This uses the documented [Docker bridge binding option](https://docs.docker.com/engine/network/drivers/bridge/#default-host-binding-address) and [Supabase CLI network flag](https://supabase.com/docs/reference/cli/introduction#global-flags).

To inspect the generated local fixture password deliberately in your own terminal:

```bash
./portal credentials
```

The password is stored in the permission-restricted ignored `.local/ACCOUNTS.txt`; server credentials stay in ignored `.env.test.local`. Start/status output and runtime logs do not print keys or passwords. A password changed through the app remains changed; the credentials file describes the original bootstrap password, not a password-reset mechanism. If the credentials file was lost while database volumes remain, existing passwords are not overwritten: use the known password or local Mailpit recovery.

## Repeated use preserves data

```bash
./portal status
./portal stop
./portal start
```

`stop` shuts down only this project's managed processes and containers. It keeps PostgreSQL/Auth/Storage volumes and the scanner signature volume. Profile edits, roles, suspensions, verified expertise, passwords, MFA factors, accepted assignments, calendar events, messages and actual uploaded file objects remain in local persistent storage. Startup never invokes `db reset`, never uses `--no-backup`, and never rotates the fixture password or overwrites existing profiles. The supervisor verifies a PID/session identity before signalling a recorded process, so stale PID reuse cannot kill an unrelated process.

An empty owned Docker network is removed after its containers stop. Data volumes are independent of this disposable network. A network still used by a container is left in place with an error; the launcher never detaches unrelated containers to force cleanup.

Use `./portal restart` for a data-preserving stop/start, or `./portal up` to stay attached and stop with Ctrl+C. Local services started with `start` remain running until `stop`, system shutdown or a fatal child-service failure. Source/plan/work log persist independently in Git; a process is not a substitute for durable source.

Do not manually delete Docker volumes or `.local` credentials if their data are needed. A volume is persistence, not an off-site backup. Production backup of PostgreSQL and Storage objects, retention and restore drills remain separate release requirements.

## One-command complete local verification

```bash
./portal test
```

This command creates a sanitized temporary checkout with its own random Supabase project ID and its own ports. It never resets or mutates the normal development database:

| Service       | Development | Isolated tests |
| ------------- | ----------- | -------------- |
| Frontend      | 5173        | 5273           |
| Built preview | —           | 4273           |
| Supabase API  | 54321       | 55321          |
| PostgreSQL    | 54322       | 55322          |
| Mailpit       | 54324       | 55324          |

Tests use separate PostgreSQL/Auth/Storage and scanner volumes. Package files are reused, while Vite caches, `.env` files, credentials, reports, build output and process state are independent. Inherited Supabase/E2E/Vite environment values are stripped before test subprocess configuration, and all mutating harnesses restrict targets to loopback. Only one updated checkout at a time can hold the shared kernel QA lock, because test ports are fixed. Its persistent lock file is private under the OS temporary directory; kernel ownership is released when the process closes or dies, and diagnostic PID metadata cannot steal it. A separate per-checkout marker remains for local recovery. Before any snapshot/proxy/service activity the runner also refuses occupied test ports from older checkouts or unrelated processes; it never stops those listeners.

When the hosted-development source is present, the same command also discovers reviewed migration/package Node tests and runs Python updater, private Envoy routing and Caddy ingress checks using only fixtures and owned containers. It never invokes the hosted updater or uses hosted credentials.

The command runs source lint/typecheck/formatting, runtime safety tests, component/unit tests, dependency audit, Edge handler tests/typechecks, real services, actual stop/start persistence with password/MFA/profile/private-event/Storage-byte verification, SQL/RLS/concurrency tests, real HTTP/Edge/Mailpit journeys, desktop/mobile browsers, production build and separate built-PWA checks. The main browser suite excludes the built-PWA cases because those run after the production build against its separate preview.

Results and private failure artifacts are stored under `.local/tests/<run>/`. Reports can contain local Auth traces; do not publish them. The test supervisor and only the randomly named test stack/volumes are removed in `finally` cleanup, including on a failing check. Normal development can remain running while tests execute. If the process is killed forcibly before cleanup, inspect its explicitly named test project and lock before removing only that test project's resources.

New test harnesses must honour `PORTAL_DB_CONTAINER`, `E2E_BASE_URL`, `E2E_MAILPIT_URL`, `PORTAL_APP_ORIGIN` and the current checkout's `.env.test.local`; never hard-code the normal development ports. `scripts/*-api-check.mjs` are automatically included in the complete command. Tests must not call hosted URLs or real email recipients.

## Honest limits

A complete local command does not mean every target-product module already exists. The full product scope and remaining work stay in `IMPLEMENTATION_PLAN.md`. The local environment does not prove hosted SMTP deliverability, Hostinger headers, GDPR/legal acceptance, physical iOS/Safari PWA installation or a tested production disaster-recovery process.

## Runtime verification checkpoint — 15 November 2026

Executed locally during this continuation:

- `./portal start` started the real PostgreSQL/Auth/Storage/Realtime/Mailpit/Edge/Vite stack and applied the new complete document/chat migrations without resetting the existing database. An immediate repeated start returned the same ready instance.
- `node scripts/runtime-persistence-check.mjs` created an ephemeral fictional account and private bucket, performed an actual managed stop/start with ClamAV, and passed checks for the same password, verified TOTP factor, edited profile/timezone, private appointment and exact stored object bytes. Probe data were cleaned afterwards; the existing thirteen fixtures were not edited.
- `node --test scripts/runtime-safety.test.mjs` passed seven checks: redaction of CLI secret formats, inherited-environment isolation, loopback URL boundaries, unrelated-PID protection, protected environment writes, unfinished-migration/digest handling, and Docker binding/network ownership boundaries.
- The actual normal stack was moved without data loss to the owned bridge; Docker inspection confirmed only `127.0.0.1` on API54321, database54322 and Mailpit54324, with no scanner host port. The real Auth/MFA/profile/private-event/Storage-byte persistence check passed after this change; existing thirteen fixtures remained untouched.
- Targeted ESLint, Node syntax checks and shell syntax checks passed for the runtime files.

The complete isolated `./portal test` invocation is executed after concurrent SQL/UI files are frozen; see the latest WORKLOG/QA_RESULTS checkpoint for actual aggregate results. An empty migration is intentionally refused before starting a fresh stack. Source-only checks and the persistence rehearsal above are not a substitute for that final whole-command run; the integrated result belongs in the main work log and QA record.

## Complete command acceptance

The complete command passed on 2026-11-15 at 13:53:47 UTC, report `.local/tests/999c091e/RESULT.txt`: 42 source, 7 runtime, 11 Edge, 78 SQL, all actual API/Mailpit suites, 40 desktop/mobile workflows, current build and 2 built-PWA checks, followed by successful owned cleanup. Temporary persistence records are removed with checked results. A targeted later mobile-input visual correction and exact GitHub revision status are recorded in WORKLOG/QA_RESULTS.

Development HMR ignores generated QA reports, private `.local` state, coverage and documentation. A real filesystem-watcher regression keeps actual source changes watched while report HTML no longer triggers application reloads.

The inherited actual selfhost image/retained-data compatibility gate remains a separate CI job after the same complete application command. It is required before a development release is published. Offline maintenance/backup guards belong to `./portal test`; separately running a native encrypted three-database restore remains an explicit operation.
