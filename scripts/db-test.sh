#!/usr/bin/env bash
# Lokaler PostgreSQL-Prüfeinstieg: echte RPC-Fälle, Lint und Advisors.
# Der eigentliche Gesamtprüflauf ruft Datenbanktests in seinem eigenen Testprojekt auf.
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/db-rpc-tests.mjs
npx --no-install supabase db lint --schema public,private --fail-on warning
npx --no-install supabase db advisors --type all --level warn --fail-on warn
