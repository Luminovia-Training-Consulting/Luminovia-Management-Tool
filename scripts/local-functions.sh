#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
mkdir -p .local
chmod 700 .local
if [[ ! -f .local/functions.env ]]; then
  cat > .local/functions.env <<'EOF'
PORTAL_INVITES_ENABLED=true
PORTAL_ALLOWED_ORIGINS=http://127.0.0.1:5173,http://localhost:5173
PORTAL_APP_ORIGIN=http://127.0.0.1:5173
EOF
fi
# Supabase injects local server credentials into its Edge runtime; none enter Vite.
exec npm exec --yes --package=supabase@3.1.0 -- supabase functions serve --env-file .local/functions.env
