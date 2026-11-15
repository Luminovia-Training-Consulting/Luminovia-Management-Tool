# KVM1 development performance

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
