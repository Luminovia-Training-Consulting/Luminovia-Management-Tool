#!/usr/bin/env bash
# Kompatibler Einstieg für ältere lokale Startanleitungen.
# Die zentrale Portal-CLI besitzt Dienste und Daten; hier entsteht kein zweiter Startpfad.
set -euo pipefail
cd "$(dirname "$0")/.."
# Compatibility entry point: the owned supervisor starts the complete local stack
# on its verified loopback-only Docker network, including Edge Functions.
exec ./portal start
