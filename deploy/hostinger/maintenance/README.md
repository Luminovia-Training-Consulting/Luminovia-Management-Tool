# Daily verified maintenance

The authorised KVM1 development instance checks official stable application and runtime dependencies daily. It never deploys an untested `latest` tag or rebuilds software on the small VPS. CI tests candidates on GitHub runners; the VPS pulls bounded immutable releases.

## Update sequence

`.github/workflows/daily-maintenance.yml` runs at 02:41 UTC and supports manual dispatch. Each npm ecosystem group, lockfile refresh, Node compiler, runtime image and Edge JSR pin has an independent candidate. Coordinated peers stay together. Prereleases and downgrades are excluded. A rebuilt multi-platform index matching the installed amd64 image is a no-op. The vendor Supabase bundle remains a preserved reference; the active composition is maintained separately.

Every changed candidate must pass `./portal test` and the actual ten-container self-hosted baseline-to-candidate check using retained fictional password-only accounts, current database permissions and file bytes. The check also confirms that no Auth factors are enrolled. Passing components are combined and tested again. Failed candidates remain on the working version and are retried on later daily scans. Failed combined verification uses a separately re-tested single passing candidate as a bounded fallback; it does not force conflicting packages together.

The PR publisher accepts only fixed dependency/version/image files with exact tested base hashes and an unchanged main parent. It cannot change scripts, workflows, authorisation code or runtime secrets. It creates or reuses a deterministic separate maintenance branch, verifies GitHub's signed commit and exact parent, and opens or reuses the matching PR with `type:dependencies`, `area:devops` and `risk:high`. Retries must not create duplicate update PRs or overwrite changed branch content.

An existing open same-repository `codex/daily-maintenance-*` PR carrying the maintenance marker blocks publication of a second update PR with `maintenance_existing_pr_requires_resolution`. The publisher never automatically rewrites or closes a reviewed or human-edited PR. If main advances and the PR becomes outdated, a maintainer closes it; the next daily scan retests and regenerates the candidate against actual current main. Strict up-to-date CI blocks merging the old base.

The maintenance App has no main-rule exception. Native auto-merge waits for an independent review, latest-push approval, resolved conversations, all 15 required CI/security checks and an up-to-date PR. An already clean, ready PR may instead use the normal PR merge endpoint bound to its exact expected head SHA; the same native rules remain authoritative. The publisher never writes the main ref or dispatches main CI before merge. The protected `maintenance-signing` environment supplies a short-lived repository-scoped App token; the publisher token needs only `contents: write` and `pull_requests: write`. The existing App/environment credentials are present and the additional PR permission was approved and granted for the single selected repository. Real token/publication workflow acceptance remains pending at this checkpoint. See [GitHub operational status](../../../DEVELOPMENT.md#activation-still-pending). Active branch protection stays enforced while setup is pending.

After the normal PR merge, main CI again verifies the application and actual self-host images. The user-authorised automatic CMS publisher releases exact current main only after both complete application and security push workflows pass; daily maintenance itself does not dispatch CI or publish a release because one is absent. An unchanged scan skips the privileged publisher job entirely. The existing five-minute server timer installs only the release for exact current main with successful whole CI, immutable tag/assets and every archive hash checked. Transient network failures back off without permanently suppressing that revision.

Convert the pending maintenance PR to draft to keep it paused across future daily scans. Closing declines that exact candidate; after main changes, a later scan may publish a freshly tested candidate on the new base. Disabling native auto-merge alone cancels the current queue, but a later publisher retry can enable it again. No custom hold label is interpreted.

The manual `signature_probe_only` input checks the existing App credentials through a signed temporary branch and a real draft PR. It confirms PR classification, closes the draft and removes its branch; it never queues the diagnostic PR for merge. Its output identifies the probe PR/commit for operator inspection. Lost branch/PR responses are recovered only through the exact owned identity; existing refs, changed heads or unconfirmed commits are preserved for inspection and never reported as a successful cleanup. Normal PR workflows may start for that temporary commit; observing or canceling those diagnostic runs is separate from claiming complete application acceptance. The application source must already have passed its own required checks.

## Retained accepted compensation and invoices

The candidate-owned `candidate-upgrade-probe.mjs` runs against both source phases.
Before upgrading, the lecturer uploads their own scanned executed-contract PDF;
an active password-authenticated administrator registers it and records the lecturer's receipt. The same
real Auth sessions accept a two-session legacy net-only job and submit an own
scanned invoice through the business APIs. A
commission-capable baseline additionally creates and accepts a second complete
job using that baseline's existing policy. The probe never chooses percentages,
changes policy or runs the candidate-only bootstrap before retention is checked.

After upgrading, fresh password-only sessions must reproduce the same accepted
amounts, original AUD currency, conditions/version, exact session digests,
gross/platform/net ledger, contract receipt, invoice/item/status/payment rows and
exact PDF hashes/bytes. Own RLS and business projections are compared with a
read-only physical snapshot. A separate lecturer must still receive no guessed
claim/invoice rows or contract/invoice metadata/bytes. Existing password,
roles, private-event and scanned-file checks also remain required. Credentials
and captured records stay in the owned scratch directory's private ledger;
published summaries contain only anonymous counts, completed-check flags and the
canonical snapshot digest, never credentials or captured rows.

Older invoice-capable baselines without private role pricing may use their
existing exact, RLS-protected job projection when `job_offers()` does not yet
exist. Private role-pricing schemas must provide their actor-quote API; an API
error never falls back to raw price sentinels. A baseline predating invoice
support fails explicitly instead of claiming invoice retention. New schema
columns are allowed, while missing or changed pre-existing financial values fail
verification. A newly introduced revenue table must not fabricate legacy gross.

Focused contract/orchestration cases run with
`node --test deploy/hostinger/maintenance/candidate-upgrade-probe.test.mjs` and are
discovered by the canonical maintenance-test inventory. They use controlled SDK
fixtures; **the new combined native retained-data run remains required** before
claiming this witness passed on real Auth, PostgreSQL, Storage and the scanner.

The current accepted baseline is main
`1de544d872706eebc95a942a1956254ed87ae40d`, with **36** released migration files.
Their bytes remain unchanged by this witness. The historical native pass on
`5876224200fc72d5d7fb312f03eb5e58a582d8c1` used the older 26-migration baseline
`e048edb7785bb40c29ddc2d5a76bd40b02580062`; it does not establish native acceptance
of this current integration. Under the shared QA lock, archive the exact current
accepted baseline separately and run the candidate checkout's controller:

```sh
node deploy/hostinger/maintenance/selfhost-candidate-check.mjs --run \
  --baseline-root "$BASELINE_ROOT" \
  --baseline-commit 1de544d872706eebc95a942a1956254ed87ae40d
```

Record the exact tested candidate commit, baseline, discovered migration/API-suite
counts, both equal financial receipts and checked owned cleanup. The 36-migration
native run is still pending. An unchanged database image is a retained-data/source
upgrade check, not proof of a PostgreSQL image-version upgrade.

## PostgreSQL and automatic recovery

PostgreSQL stays on the supported Supabase 17 series. A future 17.x pin needs a real retained-data candidate proof bound to both image digests and the exact migration inventory. PostgreSQL 18 requires a separately designed major migration. An unavailable or incompatible latest candidate is held visibly rather than labelled installed.

For full updates the server closes the public API, stops all six backend writers and makes its existing update backup. `atomic_recovery.py` then captures a private physical checkpoint of the stopped PostgreSQL cluster and its keys, Storage, Mailpit and affected persistent runtime volumes. Caddy is briefly paused for coherent TLS/config capture; unchanged ClamAV stays running. Exact Compose labels, known mount paths, same-device layout, free space and copy hashes are required. The privileged Docker controller uses ProtectSystem=full (read-only /usr, /etc and /boot); separate writable bind-mount carve-outs would break cross-directory atomic renames even on one filesystem. The helper itself accepts only the fixed owned mount paths.

An engine change additionally runs `pg_preflight.py`: while the public API is fenced, it copies a stopped whole cluster, resumes the old engine, and starts the candidate only against the private copy, with no network or published ports. All connectable databases, data/role/policy/function digests and actual collation versions must agree. The development gate currently caps this physical probe at 1 GiB PGDATA; larger clusters require reviewed capacity work.

Before opening access, every runtime container, private Auth health/JWKS and exact HTTPS frontend must pass. If activation fails before public access resumes, source and physical checkpoint are restored automatically, old services are recreated, and private health must pass before reopening. Failed candidate data remain privately preserved. Once public writers have been allowed, an automatic database rewind is forbidden: it could discard new user writes. Such a later unresolved fault retains maintenance and recovery evidence for an operator. The system does not claim it can repair arbitrary incompatible upstream changes.

Static/controller-only releases keep the existing zero-restart path, without a database backup or service stop.

## Daily OS and complete recovery sets

[Complete encrypted backups](../backups/README.md) run at 02:00 UTC with a persistent timer. `configure-os-daily.sh --apply` configures official Ubuntu stable/security/updates packages at 03:00 UTC, including distribution-provided Docker. No distribution release upgrade, proposed/backports or additional repository is enabled. A fresh complete verified backup is required before maintenance; failed backup creation blocks OS updates. The global maintenance lock coordinates OS, app, complete backup and database work.

A separate required-reboot timer runs under the same maintenance lock with a fresh complete backup; unattended-upgrade itself cannot schedule an asynchronous reboot. A /run marker fences new maintenance until boot. Necessary reboots are scheduled for 03:30 UTC (04:30 Frankfurt winter / 13:30 Brisbane). This activates newly installed kernels and can briefly interrupt the development portal. Do not describe a scheduled reboot as an already tested reboot. The OS installer validates the effective APT policy and a genuine unattended dry run before enabling the timer.

Daily encrypted sets are local to the VPS unless separately configured off-site; the first desktop recovery drill is an independent off-server copy. The paid Hostinger daily full-VM backup requires its specific purchase approval. No recurring desktop upload is promised while the desktop is offline. Preserve the off-server age recovery identity securely.

## Operations

Inspect `systemctl list-timers luminovia-update.timer luminovia-complete-backup.timer apt-daily-upgrade.timer luminovia-required-reboot.timer`, their service journals, `private/updates/state.json` and `private/backups/state.json`. GitHub daily workflow summaries identify held/failed candidates. Never print environment values, role dumps or secret configuration. Normal operation needs no Git clone on the VPS and introduces no new resident update daemon.
