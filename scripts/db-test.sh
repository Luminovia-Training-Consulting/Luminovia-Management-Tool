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
node scripts/course-curriculum-catalogue-db-tests.mjs
node scripts/course-question-bank-db-tests.mjs
node scripts/course-quiz-pool-db-tests.mjs
node scripts/academy-course-quiz-pool-db-tests.mjs
node scripts/course-text-exam-db-tests.mjs
node scripts/academy-course-text-exam-db-tests.mjs
node scripts/course-h5p-import-db-tests.mjs
node scripts/course-h5p-playback-db-tests.mjs
node scripts/academy-course-h5p-import-db-tests.mjs
node scripts/academy-question-bank-db-tests.mjs
node scripts/course-competency-db-tests.mjs
node scripts/academy-course-competency-db-tests.mjs
node scripts/course-completion-policy-db-tests.mjs
node scripts/course-scorm-runtime-db-tests.mjs
node scripts/course-peer-feedback-db-tests.mjs
node scripts/academy-course-peer-feedback-db-tests.mjs
npx --no-install supabase db lint --schema public,private --fail-on warning
npx --no-install supabase db advisors --type all --level warn --fail-on warn
