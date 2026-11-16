# KVM1 development performance

Historical measurement report for the 15 November 2026 development rollout. The measurements and installed revisions below are evidence for that rollout, not a current hosted benchmark or health readback. The versioned Compose configuration remains the source for present healthcheck settings.

The purchased KVM1 has one CPU, 4 GB RAM and 50 GB disk. PostgreSQL, Auth, REST, Realtime, Storage, all three application Edge functions, Envoy, Caddy, ClamAV and private development Mailpit remain available. These adjustments reduce background work while preserving the existing authentication, database, scanning and readiness checks.

## Health scheduling

All nine existing container healthchecks now run every 30 seconds after startup. Their commands and five-second timeouts remain unchanged. Previously, five services checked every five seconds and two every ten seconds, alongside two already checking every 30 seconds. This changes the nominal steady rate from approximately 76 to 18 probe launches per minute, about 76% fewer. This is a schedule calculation, not a measured CPU or throughput improvement.

Fast startup checks run every five seconds during each startup grace period. The first successful check still opens the Compose readiness gate; startup does not wait for the normal 30-second interval. All services use three consecutive failures before becoming unhealthy.

| Services                                               | Startup grace | Startup interval | Normal interval | Failures |
| ------------------------------------------------------ | ------------- | ---------------- | --------------- | -------- |
| PostgreSQL, Auth, REST, Realtime, Storage, Edge, Envoy | 60 seconds    | 5 seconds        | 30 seconds      | 3        |
| Private Mailpit                                        | 30 seconds    | 5 seconds        | 30 seconds      | 3        |
| ClamAV                                                 | 180 seconds   | 5 seconds        | 30 seconds      | 3        |

The tradeoff is slower detection than the former five-second checks: approximately 90 seconds for three failed checks after a service was healthy, plus probe execution and scheduling time. A service that never starts can take approximately 150 seconds with a 60-second grace, compared with approximately 120 seconds previously. Realtime previously allowed twelve failures at a 30-second cadence; its new failure window is shorter. Docker health status itself does not restart containers. Existing process restart policies and deployment readiness checks remain in force.

The fast startup interval requires Docker Compose 2.20.2 or newer and Docker Engine 25 or newer. The configuration validator checks both Compose files and the complete timing policy without printing rendered credentials. Official behavior is documented in [Compose healthcheck](https://docs.docker.com/reference/compose-file/services/#healthcheck) and [Dockerfile HEALTHCHECK](https://docs.docker.com/reference/dockerfile/#healthcheck).

## Request logging

The Edge router no longer writes a normal request's worker path through `console.error`. Authentication failures, worker errors, retries and memory-pressure diagnostics retain their existing handling. Caddy and Envoy continue to omit access logs containing authentication query strings. Existing Docker log rotation remains five MiB per file with two files per container.

## Actual validation

The full offline cryptography, generated-secret separation, Compose mounts, private networking, Auth boundaries and health-policy validator passed. An isolated container using the actual pinned Mailpit image and its configured health command passed `docker compose up --wait`: its first successful health probe completed 5.115 seconds after container startup with the final five-second startup interval and three-retry policy. The container exposed no host ports; its temporary container, network and data were removed afterwards. This demonstrates the real startup gate rather than inferring startup performance from configuration text.

Local verification used Docker Engine 29.9.3 and Compose 5.7.1. Read-only inspection confirmed the VPS uses Engine 29.7.2 and Compose 2.40.3, which also support the required startup interval. Hosted deployment and before/after CPU, memory and application acceptance are recorded separately after observation; this local result does not establish KVM1 throughput, maximum-file performance or the future 100 GB document capacity.

## Release-selection recovery

The actual rollout found that GitHub returned an older release before the newest one. The updater now reads the exact current-main SHA and fetches its corresponding tag, with a normal wait when that release is not yet published. The observed ordering and HTTP error cases are covered by28 updater tests. The first performance release required the documented operator path because the installed discovery code could not find it; its current-main, tag, full CI, immutable assets and hashes were independently verified before installation. Further exact-main release and no-restart proof are recorded from live results in QA_RESULTS.

Full backend activation reconciles both persistent support services, PostgreSQL and private Mailpit, before restarting the six writers. This ensures a changed Mailpit health/image/configuration is applied while unchanged services are retained. The live Mailpit adjustment is checked against actual Engine metadata, not merely the Compose text.

## Observed hosted results after the health configuration

The30-second before/after snapshots reported91.96%/95.11% host CPU idle and5.95%/4.05% summed container CPU usage. Available memory was1805/1755MiB; this includes different warmed application caches after functional checks. Swap used was328/296KiB, with no observed swap I/O or container OOMs. These are short observations, not a controlled benchmark or guaranteed speed improvement. Actual nine-probe metadata confirms76→18 scheduled launches/minute. Approximately1.7GiB RAM remained available, and the disk remained mostly free.

The actual post-rollout suite passed all eight HTTP groups, clean/EICAR scanning, captured invitation/recovery,50 claims with one complete winner, accounts/privacy and real WSS revocation. A targeted mail follow-up passed after explicit Mailpit recreation. Three accounts, fourteen migrations, one private file and10GiB/1GiB quotas were preserved. Twenty concurrent authenticated reads succeeded20/20 before and after; network-inclusive median/p95 changed1196/1310ms to1031/1124ms. This single comparison is not sustained15–25-member or maximum-file acceptance.

## Actual corrected update without container restarts

Signed controller source `69c81a12267ea239f9a72c26527b7f91754bb5b6` passed [exact CI43738585027](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/actions/runs/43738585027). Independent public download verification checked immutable metadata, both asset digests, all98 member hashes and14 migrations. Compared with A, only the controller and service worker differ in the package.

The installed discovery defect required a one-time controller bootstrap from that fully verified release. Before installation, the new controller itself selected the exact current-main release through its normal anonymous GitHub checks. The application update then used the normal network/systemd path and completed at2026-11-15T17:11:25UTC in `site_controller` mode. All ten container IDs/start times/image IDs/restart counters and health configurations matched the saved pre-update snapshot. Existing backup names/manifest hashes and `lastBackup` were unchanged; no data backup, SQL migration or maintenance mode was created. HTTPS200 served the exact verified new entrypoint. CMS and both apt timers are active, no systemd units failed, and the optional dispatcher remains disabled. The private machine-readable proof is `.local/hostinger/fast-update-acceptance.json`.

PostgreSQL/Auth/REST/Storage/Realtime/Functions/Envoy, web delivery, file scanning and private captured-mail functionality remain available. The full future product,100GB capacity, external SMTP, recurring encrypted off-site retention and production acceptance remain separate from this tested development setup.

Final accounts/CORS/private-file/WSS checks passed again after that fast update. Original three accounts, fourteen migrations, private file and quotas remained intact; owned test sessions and fixtures were removed. The optional OS dispatcher can be restored with `systemctl enable --now networkd-dispatcher.service` if executable event hooks are later needed. Its package was retained. No other mandatory service or security feature was disabled.
