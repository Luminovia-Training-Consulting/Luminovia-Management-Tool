#!/usr/bin/env bash
# Legacy startup alias retained for older local setup instructions.
# The portal CLI owns lifecycle and persistent data; forward its exit status unchanged.
set -euo pipefail
cd "$(dirname "$0")/.."
# Compatibility entry point: the owned supervisor starts the complete local stack
# on its verified loopback-only Docker network, including Edge Functions.
exec ./portal start
