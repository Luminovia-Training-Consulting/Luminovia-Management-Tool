#!/usr/bin/env bash
# Legacy alias for the full local stack; it does not own a separate Edge process.
# The shared supervisor owns database, Edge and frontend startup.
set -euo pipefail
cd "$(dirname "$0")/.."
# Compatibility entry point: the owned supervisor starts the complete local stack
# on its verified loopback-only Docker network, including Edge Functions.
exec ./portal start
