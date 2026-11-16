# System audit: functionality, performance and failure paths

As of 16 November 2026, Australia/Brisbane. Baseline: PR #4 / `b9cdcc8`. This report preserves that historical audit's examined contracts, concrete findings and measurements; its module and migration counts are not the current inventory. For the current migration inventory and later feature additions, see the [migration guide](MIGRATION_GUIDE.md) and [documentation index](README.md). Actual complete acceptance is recorded in [QA_RESULTS](QA_RESULTS.md); the entire remaining product scope stays in [roadmap](../ROADMAP.md).

## Scope and traceable entry points

The audit covers delivered frontend feature modules, Auth/data/file/realtime interfaces, all application migrations, local process management, the isolated test launcher and release/proxy boundaries. At this audit checkpoint the compiler inventory identified **85 connected frontend modules, 25 routes and 175 runtime exports**, with no unreachable modules, unused runtime exports, missing relative imports/static assets or invalid literal routes. Computed dynamic paths still require their own business checks.

At this audit checkpoint, the existing 17 migrations remained unchanged; the finite-interval correction below added the 18th. Headless APIs, CLI/test entry points and the documented, unchanged Supabase vendor reference are deliberate interfaces. Missing browser imports alone do not make them dead code. The API check binds actual literal frontend calls to migrated functions and checks the invoker boundary, RLS in public/private schemas, anonymous execution rights and empty privileged search paths.

| Area             | Owning files                                                 | Added check/correction                                                                                                      |
| ---------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Account identity | `app/app`, existing Auth provider                            | A direct A→B change also clears the shell search draft; token refresh preserves it and public Auth callbacks remain stable. |
| Language/theme   | `lib/preferences`, `lib/i18n`, `app/shell`                   | Blocked/full browser storage prevents neither startup nor changes; invalid stored themes follow the system.                 |
| File metadata    | `features/files/api`, `document-attachment`                  | Actor keys, shared observers, abort signal, honest loading state and hidden revoked data.                                   |
| File versions    | `features/files/files`                                       | Replacement invalidates version history; preview/download use the exact reviewed version.                                   |
| Profile pictures | `features/profile/avatar`                                    | Immutable bytes are not fetched again on focus; selection and current rights are checked separately.                        |
| Chat             | `features/chat/thread`, `realtime`                           | Failed read receipts remain retryable; visible/reconnected tabs and bounded event coalescing without late stale callbacks.  |
| File gateway     | `functions/files/validation`                                 | Office macro markers are searched directly in existing bytes without full ZIP string copies.                                |
| Sessions/claims  | New migration `20261115180559_finite_schedule_intervals.sql` | Finite intervals/deadlines at the database boundary; complete rollback instead of unbounded bookings.                       |
| Local processes  | `scripts/runtime-lib`, `runtime-cli`                         | Timeout/cancellation is not success; controlled SIGTERM→SIGKILL escalation and acknowledged cleanup.                        |

## Reproduced defects and performance findings

A further test using the actual application/shell/AuthProvider structure showed that a direct native A→B account switch cleared the query cache but retained the shell search draft. Only the protected outlet is now remounted by user ID. Three new cases also check preserved drafts on same-account token refresh and an unchanged mounted public invitation/recovery callback. This did not demonstrate a blob leak.

The regressions first ran against faulty behavior. Four new browser-storage cases failed; seven additional before/after sign-out/preference cases confirmed the connected UI contract. One faulty test initially used an invented theme selector; it was corrected to the actual existing label.

A shared list/attachment scenario made **eight metadata requests in 20 seconds** despite no changes. The same component experiment now needs **two initial requests**, including shared metadata for duplicate attachments. Active scans initially poll every three seconds. Scans unchanged for two minutes, and settled/empty/temporarily failed states, switch to 60 seconds; explicitly forbidden or removed attachment data stop interval polling. Focus/reconnect retain normal stale-data revalidation and own mutations invalidate immediately. External renames can therefore take up to 60 seconds to appear in an uninterrupted idle tab. Every byte request checks current server permissions; this protection was not replaced by longer caching.

The complete browser run also includes an actual 12-second observation of a settled file list across the former ten-second interval, including DE/EN/theme changes without document reload. Another browser check starts with an actually throwing `localStorage` getter and checks visible, usable DE/EN/dark-mode controls plus the retained form draft. These cases passed in complete local run 04 on both layouts; actual counts are in QA_RESULTS.

Refocusing after 31 seconds reloaded identical profile-picture bytes. The exact actor/target/version key now retains these immutable bytes only in memory; the selection/permission query still revalidates. Revocation, version changes, offline state and unmount hide or revoke blob URLs.

**20 chat INSERT hints previously triggered 40 immediate query invalidations.** A fixed 150 ms window now coalesces them into one message refresh and one room refresh. This is a measured invalidation count, not an asserted HTTP measurement. Continuing events do not continually postpone the fixed deadline. Membership revocation removes cache rows immediately and discards pending/stale refreshes. Realtime payloads never become authoritative cached messages.

Existing chat fallbacks remain at three seconds for rooms, five for members and ten for messages. Message checks revalidate loaded historical pages; the number of loaded pages grows only through explicit user action. This freshness/revocation behavior was preserved. Larger chat histories and higher future user counts need separate load measurements; this change does not promise constant work for arbitrarily large histories.

For a fictional **96 MiB OOXML file**, three independent local Deno processes per revision measured **180–189 ms** and **546552–547292 KiB** peak process memory before the change, then **52–54 ms** and **248900–249668 KiB** afterward. The new search preserves case handling, MIME, ZIP end-marker checks and macro rejection. This measures local validation, not a complete upload or hosted throughput. The large synthetic file was removed.

## Finite calendar data and safe migration

A real confirmed job created through `create_job` with `ends_at: "infinity"` was demonstrated; the former API created an unbounded assignment. A private appointment also allowed this. PostgreSQL accepts these special time values, but a valid portal session requires concrete finite instants.

The new 18th migration adds validated CHECKs to `course_sessions`, `job_sessions`, `assignment_sessions`, `personal_events`, `global_events` and the optional job deadline. An absent deadline remains `NULL`. Invalid historical rows stop the entire migration atomically; accepted sessions, compensation, roles and IDs are never automatically rewritten.

Six real temporary PostgreSQL cases check rollback of the entire invalid job graph, private inserts/updates, both infinite deadlines, valid adjacent sessions/accepted snapshots, all five write boundaries and atomic migration refusal on invalid historical rows. The real HTTP suite additionally checks REST rejection with `23514` and preservation of earlier event instants.

SHA-256: `6af0a55e86a352b1448bafc95378b7d3b72884b8a5551916cac261445ac7af92`.

## Processes and tests

One subprocess could ignore SIGTERM and continue beyond its timeout. Another exited with code 0 after timing out and was treated as successful. Cancellation could remove the timer before actual termination. The shared process function now waits for actual closure, escalates after a bounded grace period and preserves timeout/cancellation as failure. Tests use real, unambiguously owned child processes with an additional backstop.

`stop` requires a matching PID/session/`stopped` acknowledgment from the supervisor. A vanished process or explicit cleanup error is not success. Runtime version 3 causes a data-preserving supervisor replacement at the next normal startup. The three stop fixtures use temporary scripts and fake Docker only; the complete command additionally verifies real restart behavior.

The new tests are discovered automatically by `./portal test`. Coverage includes source/graph, components, Edge, real PostgreSQL transactions, native Auth/MFA/REST/Storage/Realtime/ClamAV/Mailpit, browsers/axe and the built PWA. A written test or local synthetic measurement does not replace a completely passed run.

## Concurrent checkouts and unintended development reloads

A second complete acceptance attempt encountered occupied test ports. PID, session, working directory and package symlinks proved an active check from the original daily-maintenance worktree owned them. This was not a demonstrated abandoned audit process and it was not terminated. The former per-checkout lock could not prevent that conflict.

Before snapshot or proxy/database operations, the launcher now acquires a shared kernel lock using Linux util-linux `flock`, then checks the fixed test ports. The private persistent lock file is never removed; the kernel holds/releases its ownership. Stale PID notes cannot take over the lock. Four real process/network cases check competing checkouts, release after SIGKILL, symlink protection and an unrelated listener that continues unchanged. Older running versions do not yet participate in this protocol; their natural completion is awaited. After forced termination, test services or the local recovery marker can still require controlled inspection.

The Vite log also showed full-page reloads when `playwright-report/*.html` was generated. A real file-watcher test reproduced events for report/private HTML files. Server configuration now ignores reports, `.local`, coverage and documentation, while the test uses an actual `index.html` change to confirm application sources remain watched. This corrects development HMR; it is not a production network measurement.

## Operational boundaries

This audit changes no normal data, hosting, DNS, real email or bank orders. M4 operator review remains in place. The [historical M4 reviewer](REVIEWED_M4_MIGRATIONS.md) is deliberately limited to 14→17 sources and rejects an 18-migration manifest; it is not an installer for this newer revision. Later hosted acceptance must determine the actual installed state: four sources require review from the historical 14-migration state, or only the new 18th migration after M4/17. This includes finite historical data, database plus actual object backups and separate instance acceptance. No new apply/bypass path was added.

Physical PWA installation, other browsers, manual accessibility, concurrent large hosted uploads/load, real SMTP delivery, legal retention and the complete remaining master-specification scope retain separate release gates. The examined data flows have stronger safeguards; general freedom from defects for all possible inputs is not claimed.

## Actual acceptance checkpoint

Complete local run 04 on signed `7abad7e` finished at 2026-11-15T19:02:50.239Z with exit 0: 117 source tests/34 files, 33 runtime, 42 Edge, 18 migrations, 174 SQL, 12 real API suites plus Mailpit, 54 browser cases, build, 2 PWA cases and verified cleanup. Subsequent integration of main `11448e4` changes no application TS/SQL file. Additionally, 38 updater, 13 maintenance and 25 backup Python cases passed without skips, alongside 60 Node guards and Deno lint on ten production/seven test files. Complete combined/native CI is the final acceptance evidence for the submitted revision.

Edge sources are now linted separately because frontend ESLint intentionally excludes them. Pinned npm imports and control-character rejection regexes remain explicitly allowed. The require-await rule stays active for production; only promise-contract test doubles do not require actual I/O awaits. Initial default test-lint warnings were style findings, not demonstrated runtime defects. This separation runs in the shared verification command.
