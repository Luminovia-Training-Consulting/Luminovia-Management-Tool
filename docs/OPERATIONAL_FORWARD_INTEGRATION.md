# Operational notification and handover integration

The forward migration `20261116121605_operational_module_notification_handover_integration.sql`
keeps preparation, support, delivery and replacement inbox destinations available
when independent operational modules are combined. It preserves the installed
core resolver when the smart-operations module is absent. When that module is
installed, it captures its trusted private resolver from the current function or
the known preceding enquiry/change aliases, including workbench, course,
timesheet, qualification, waitlist and directed-substitution targets.

The current resolver is replaced in place. Its captured fallback is owner-only;
all destinations first require an active actor and then the actual resource
authority. Enquiry and formal-change destinations use exact optional private
signatures and catalog-derived dynamic SQL. An absent optional module returns
an empty destination. A present smart module without its expected resolver
aborts installation explicitly instead of losing its targets.

No email/push preferences, category allowlists, worker configuration or queues
are enabled or expanded by this migration. An inbox destination does not grant
access to the destination's API or expose submitted enquiry content.

## Directed and marketplace transfers

When an installed directed-substitution workflow commits its accepted state,
an `AFTER UPDATE` trigger closes an open marketplace offer for the same original
claim as cancelled, incrementing its version. It records the substitution and
both claim references in the audit. It does not create another claim, rewrite
accepted terms or replay notifications.

Both workflows already serialize the business mutation on the job. The helper
uses job, original claim, substitution and marketplace rows in that order and
acquires no later lecturer/profile locks. It deliberately does not close offers
on ordinary claim cancellation: the marketplace cancels its own source claim
inside its transfer transaction before completing its offer. Failed transactions
roll back reconciliation and its audit together.

The same helper repairs pre-existing accepted directed handovers during an
upgrade. Its audit uses the current repair time. Since the audit schema requires
an actor, historical repair attributes the real accepted decision's target
lecturer and explicitly records `migration_reconciliation: true`; it does not
impersonate that lecturer's session. Repeated reconciliation makes no further
writes. Already cancelled/completed marketplace offers remain unchanged.

## Migration ownership and order

The current released forward migration is `20261116121605`; it follows the accepted smart-operations prefix. Its version was reconciled before release. The migration was designed to support both presence and absence of the smart module; the current complete application includes that module. No released SQL is renamed or modified.

Historical combined-fixture evidence below pins committed PR17 source `00eaa5249a163618887f72683da362e785a5957f`. Its then-current withdrawal migration was `20261116051736_substitution_withdrawal_permission_recheck.sql`; the current released counterpart is `20261116091026`. These historical identifiers are not interchangeable source digests. Tests discover the present forward source by its suffix.

The trigger is installed only when the directed table exists. If another branch
is delivered later and overwrites the resolver or adds that table after this
migration has already run, that branch must provide a newer forward composition
migration. This migration cannot automatically integrate future schema changes.
Unreleased sibling stacks must keep their actual delivery history monotonic;
the tests discover files by suffix rather than assuming P2 version numbers.

## Verification

The normal automatically discovered SQL suite works with the first four
operational modules alone. The separate manual combined gate refuses missing
smart-module prerequisites. Run only against an owned local test container:

```sh
PORTAL_DB_CONTAINER=YOUR_OWNED_DISPOSABLE_CONTAINER node scripts/operational-forward-db-tests.mjs
PORTAL_DB_CONTAINER=YOUR_OWNED_DISPOSABLE_CONTAINER node scripts/operational-pr17-integration.mjs
```

Each suite creates and drops random UUID databases. Fresh replay and populated
upgrade checks cover current root destinations, the public inbox, optional P2
destinations/explicit absence, private execution grants, suspension, strict
`plpgsql_check` diagnostics and existing external-category denial. The combined
gate additionally checks actual smart destinations, directed reconciliation,
transaction rollback, historical repair attribution and idempotency.

Local evidence on 2026-11-16: the independent first-four source at `e34a5bf`
passed 8 groups; the all-seven source using only the three committed P2 migration
overlays from `ffa5a20` passed 8 groups; adding the pinned committed PR17 migration
overlay passed all 10 combined groups. Actual `plpgsql_check` function diagnostics
were empty in each mode, including the installed trigger in combined mode.
ESLint, Prettier and whitespace checks passed for these deliverables.

Fixtures contain only fictional SQL metadata and persisted transition evidence.
They do not certify native Auth, Storage scanning, actual network delivery,
production deployment or an external formal review. Full directed/marketplace
RPC races and chat/document transfer composition have separate integration gates.
