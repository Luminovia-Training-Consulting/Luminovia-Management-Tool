#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
mkdir -p .local
chmod 700 .local
if ! npm exec --yes --package=supabase@3.1.0 -- supabase start --exclude studio,postgres-meta,edge-runtime,logflare,vector,imgproxy,supavisor > .local/supabase-start.log 2>&1; then
  echo 'Local Supabase startup failed. Inspect the private .local/supabase-start.log file.' >&2
  exit 1
fi
node scripts/local-env.mjs
# Successful CLI output can contain local credentials; retain only a neutral status.
printf 'Local Supabase startup succeeded; credential output removed.\n' > .local/supabase-start.log
echo 'Local Supabase is running. Apply migrations, then run node scripts/local-seed.mjs.'
