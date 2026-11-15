#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/db-rpc-tests.mjs
npx --no-install supabase db lint --schema public,private --fail-on warning
npx --no-install supabase db advisors --type all --level warn --fail-on warn
