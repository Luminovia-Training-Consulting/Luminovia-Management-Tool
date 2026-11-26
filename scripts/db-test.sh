#!/usr/bin/env bash
# SQL-only entry point for real RPC cases, lint and advisors.
# The canonical full runner supplies its own disposable project context.
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/db-rpc-tests.mjs
node scripts/company-lecturer-access-db-tests.mjs
node scripts/crm-pipeline-db-tests.mjs
node scripts/course-authoring-db-tests.mjs
node scripts/academy-course-authoring-db-tests.mjs
npx --no-install supabase db lint --schema public,private --fail-on warning
npx --no-install supabase db advisors --type all --level warn --fail-on warn
