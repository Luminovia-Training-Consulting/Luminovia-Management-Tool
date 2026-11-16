#!/usr/bin/env bash
# Kompatibler Einstieg für den vollständigen lokalen Dienstverbund.
# Edge Functions werden durch denselben Supervisor wie Datenbank und Frontend gestartet.
set -euo pipefail
cd "$(dirname "$0")/.."
# Compatibility entry point: the owned supervisor starts the complete local stack
# on its verified loopback-only Docker network, including Edge Functions.
exec ./portal start
