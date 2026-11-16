# Accepted amendment forecast integration

Migration `20261116091032_amendment_aware_finance_forecast.sql` keeps the
existing `public.finance_forecast(date,date,numeric)` response and permission
boundary. Accepted lecturer cost comes from the latest effective accepted
agreement; only unreleased assignment sessions choose its month. Original
claim and revenue records remain unchanged.

The independently delivered Formal Amendments module defines
`private.effective_assignment(uuid) -> jsonb`. Its `total_amount` is the latest
immutable `private.assignment_amendments.accepted` value ordered by amendment
version, or the original claim total when no amendment exists. The bridge's
ungranted `private.forecast_assignment_total(uuid)` resolves that exact helper
at runtime. Without the module it reads the original claim. Valid zero net
compensation remains zero, including a captured role policy share of 0%.
Null, negative and nonfinite effective totals fail rather than falling back to
an obsolete agreement. Both install
orders work without a captured predecessor or optional installation hook.

The commissioned amendment contract in migration
`20261116055116_commissioned_and_customer_amendments.sql` retains the original
customer gross charge in `private.claim_revenue_ledger` and records the new
balanced net/platform allocation in immutable
`private.assignment_financial_amendments`. Consequently forecast margin is
original gross minus effective net. This bridge does not invent a customer
charge amendment, reinterpret lecturer invoice payments as customer receipts,
combine currencies or guess the role mix of open work. Gross values retain
the existing `finance.gross.read` and MFA checks.

## Local evidence

`scripts/amendment-forecast-db-tests.mjs` uses `withTestDatabase` and fictional
online publication, claims and amendment RPCs. Its default run checks current
source, including the fallback when Formal Amendments is absent. With the
actual module installed, it also checks independent consent/application,
price and month changes, multiple amendment versions, preserved original
claim/revenue/session history, and separate original currencies. All modes also
exercise a real zero-share online claim and rollback-only invalid snapshot
faults, without changing actual accepted evidence or the installed helper.

The formal-amendment module is absent from the current 68-file inventory. To rehearse both installation orders before integrating it, place its exact
two public source migrations (`*_formal_change_requests.sql` and
`*_commissioned_and_customer_amendments.sql`) in a private local fixture
directory and run:

```sh
PORTAL_DB_CONTAINER=supabase_db_luminovia-portal-test-m7 \
PORTAL_FORECAST_AMENDMENT_FIXTURES=/absolute/owned/fixture-directory \
node scripts/amendment-forecast-db-tests.mjs
```

The test prints each fixture's SHA-256. It does not fetch or modify foreign
source. A historical root ceiling permits exact order replay; the current-source
run uses the complete local migration inventory. Strict `plpgsql_check`
diagnostics run both with and without the optional helper. Only the owned UUID
database receives the diagnostic extension via the local database operator;
business assertions use ordinary current actor identities. Every owned database
is dropped in the test helper's `finally` block. This targeted evidence does not
replace native Auth/REST, browser, full canonical QA or deployment acceptance.
