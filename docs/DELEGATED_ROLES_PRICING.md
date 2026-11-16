# Delegated roles and private compensation

The current user requirement supersedes the earlier freely editable per-offer commission default. Real commercial percentages are private operational configuration. This public repository contains no initial production policy and never guesses one. A fresh install requires an administrator with verified MFA to set the intended policy in the administration interface before publishing a commissioned offer. The acceptance-only fixtures use clearly fictional settings, gated to the owned disposable test stack.

## Delegation boundary

The server reads current database roles and MFA. Owner may assign administration and lower roles; administration may assign management and lower roles; management may assign senior lecturer, lecturer, company, participant and guest. Actors cannot change their own roles or activation state, or change an equal/higher account, including a target with several roles. Guest grants no additional permissions. Existing owner and participant semantics are retained.

`account_role_catalog` returns an `assignable` flag for each role. Account-directory entries return `can_assign_roles` and `can_change_active`. These flags guide the UI; the same rules are enforced independently in role, suspension, invitation and membership routines.

Management can invite a company account without an organisation grant. Linking/removing an organisation, or inviting an account with an organisation attached, requires administrative gross-finance permission and MFA. Completion checks the inviter's current authority again. Removing a company role revokes active organisation memberships; restoring that role cannot restore those grants. The membership and role mutation routines share the account lifecycle lock.

A company role cannot be combined with lecturer, senior lecturer or management roles on a non-administrative account. Defensive organisation checks also reject pre-existing conflicting combinations. This prevents one login from composing the private customer gross projection with a personal lecturer quote. Private messages, calendar entries and unrelated personal contracts retain their existing ownership rules.

## Private policy and offer snapshots

`private.compensation_policy` is an RLS-enabled, unexposed singleton with no seed row. `configure_compensation_policy` requires administrative gross-finance permission, MFA and the expected current version. Concurrent edits use a shared policy lock and reject stale versions. Audit records contain the new version, without rates.

`commission_access` exposes policy percentages and version only to a current administrative MFA session. Other roles receive capability flags and whether setup is complete. `commission_offer_policy` gives that administrator the captured policy for one offer, so a newer global policy cannot mislabel an existing quote.

Every new commissioned offer captures its own policy version and both percentages in the private offer ledger. Later global changes affect future offers. An explicit administrative reprice is allowed only before any claim history and advances the offer consent version. Original gross currency/unit, residual-conserving cents and the accepted private revenue ledger remain intact.

On upgrade, offers with no claim history move to the role-dependent model and their consent version advances. Their old public rate columns become zero sentinels. Initial policy setup enables their still-empty private policy snapshots. Offers with accepted or cancelled claim history retain their historical pricing model, and every accepted claim/revenue row remains unchanged. No database migration writes a real production policy.

## Quote and claim confidentiality

`job_offers()` returns the existing job DTO with nested sessions/requirements. An eligible lecturer sees only their current applicable net amount, derived from the private offer snapshot and actual server role. The current lecturer-actor predicate also includes administrator and owner roles; management alone does not qualify and receives `null` monetary values for role-dependent offers. An account with additional eligible roles follows the current server predicate, not its visible navigation label. The directly queryable `jobs` table stores no default or alternate lecturer rate for those offers. Company projections expose only their authorised organisations' gross amounts. Revenue and captured-policy RPCs remain administrative.

The displayed `terms_version` of a role-dependent quote is a composite of the base consent version and a role discriminator. The discriminator carries no percentage. Claiming locks the actor profile, validates the current quote token, then delegates to the existing atomic capacity/conflict/contract transaction. Role mutations take the matching profile lock. A stale quote after a role change or reprice returns `terms_changed`; claiming cannot silently accept a different amount. Claim and revenue triggers independently calculate and validate the accepted net and conserved private revenue. Accepted claims retain the base document/terms version and an immutable compensation snapshot.

Same-request retries first pass the current active-actor and lecturer-eligibility checks. An allowed retry for the same job returns the existing claim identity and its current status, preserving the original accepted terms and amounts. It does not create a fresh confirmed allocation after cancellation, and an old request key grants no retry access after suspension or loss of eligibility. A later senior promotion, global policy edit, cancellation or new quote never rewrites an accepted deal. Offline/optimistic confirmation remains prohibited.

## Reading monetary values correctly

Three different states must remain distinct:

| Value and source                                                                     | Meaning                                                                                                                                           | Required handling                                                                                                               |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Numeric `0` in the directly readable job columns for a role-dependent offer          | A storage sentinel; it is not the current actor's quote.                                                                                          | Read the authorised `job_offers()` projection instead of calculating a displayed fee from the table.                            |
| `null` in an authorised prospective quote                                            | No applicable monetary quote is available to that actor, including nonlecturer management or an offer whose private policy is not yet configured. | Preserve `null`, show restricted compensation and disable an unpriced claim. Never coerce absence to zero.                      |
| A numeric amount, including a genuine numeric zero, returned by the authorised quote | The actor's applicable prospective compensation under that offer's captured policy.                                                               | Display the returned value without treating all numeric zeros as missing. The server still decides whether a claim is eligible. |

The nullable monetary fields belong to the prospective `Job` DTO. Accepted `Claim` amounts are separate immutable snapshots, not placeholders to recompute from a later role or policy. The detail page uses an existing own claim for its accepted terms display.

Consent is more than a checked boolean or the base job version. The current detail page records the displayed job ID, quoted terms version, amount, total, currency, rate unit and terms as one consent fingerprint. A refreshed display cannot reuse consent for different values. The request sends the quoted version and idempotency key to `claim_job`; it sends neither an asserted lecturer role nor a client-calculated accepted price. The server locks and rechecks the actor before accepting the current quote, and stores the accepted base terms version with the actual immutable compensation snapshot.

Management budgets are another projection. For role-priced offers, `job_lifecycle` returns `max_net_budget` only with current `finance.gross.read` and MFA: it uses the rounded captured senior-tier total per position multiplied by capacity. A legacy offer retains its stored net total multiplied by capacity. This is not the requesting manager's personal quote multiplied by capacity. An explicit `null` budget remains protected and must not fall back to a cached personal price. The UI separately handles an absent field for compatibility with an older backend. None of these values gives access to a different lecturer's accepted contracts, invoices or private calendar.

## Current source ownership

This guide describes the released role-pricing implementation. The relevant reading path is:

| Source                                                                                                               | Owning contract                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Private role-pricing migration](../supabase/migrations/20261116020953_delegated_roles_and_private_role_pricing.sql) | Current policy/offer snapshots, `job_offers`, role-specific quote versions, claim checks/triggers and the role-aware lifecycle budget. Read its later definitions after the earlier migrations. |
| [Shared queries](../src/lib/queries.ts)                                                                              | `jobsQuery` calls `job_offers()` through the authenticated client; browser role labels do not supply quote authority.                                                                           |
| [Shared DTOs](../src/lib/types.ts)                                                                                   | Prospective `Job.amount` and `Job.total_amount` are nullable; accepted `Claim` amounts remain separate numeric snapshots.                                                                       |
| [Job list and detail](../src/features/jobs/jobs.tsx)                                                                 | Restricted-price rendering, loaded-result filters, the full displayed-consent fingerprint and the online claim request.                                                                         |
| [Lifecycle API](../src/features/jobs/lifecycle-api.ts) and [lifecycle UI](../src/features/jobs/lifecycle.tsx)        | Read the server budget, preserve an explicitly protected `null` and perform versioned lifecycle actions.                                                                                        |
| [Commercial pricing UI](../src/features/commercial/pricing.tsx)                                                      | Uses the permission-scoped financial APIs for the captured offer policy; the ordinary job projection does not disclose policy percentages.                                                      |

The current marketplace filters the loaded authorised offer set in the browser. It does not implement the separately pending paginated server discovery, saved-view or quote-context cursor work. A filter result is not an allocation or a replacement for final server checks.

## Pending compatibility requirements for later discovery

If paginated discovery, exact-detail endpoints, dashboard projections or saved searches are integrated later, they must preserve the quote contract above. These are integration requirements, not a claim that those additions are implemented on this main baseline:

- Derive each returned price and consent version from the current authorised actor and the offer's captured policy. Do not use the public-table sentinel, another tier or the latest global percentages to reprice an existing offer.
- Keep restricted values nullable through SQL, JSON, DTOs and rendering. Apply price bounds and monetary ordering to the same visible quote; unknown amounts must not become zero-price matches.
- Bind any new price-order cursor to its filters and current quote context. A role/policy change must not silently continue incompatible pages; cached browser role state cannot authorise a response.
- Preserve the full displayed-consent fingerprint, fresh claim checks and immutable accepted snapshots. Keep management budget projections distinct from prospective personal quotes.
- Add source-bound SQL/API/component and retained-data evidence for the actual integrated implementation. An anticipated migration or authored test is not a shipped feature or a passed acceptance run.

## Verification

`scripts/delegated-pricing-db-tests.mjs` replays the previous schema, creates a historical accepted commission, applies the migration, and verifies exact historical claim/revenue preservation. Its disposable PostgreSQL cases cover subordinate delegation, guest permissions, equal/higher/self protection, invitation rechecks, financial-grant composition, policy setup/CAS/privacy, direct-table sentinels, role-bound consent, mixed-role capacity claims, exact rounding, idempotent accepted receipts and future-only policy changes. Existing accounts, commission, CBW and capacity suites retain independent checks. Native API/browser evidence is reported separately in the work log and QA results.

The current [job component regressions](../src/features/jobs/jobs.test.tsx) check restricted compensation and renewed consent after either a version change or a displayed quote change. [Lifecycle regressions](../src/features/jobs/lifecycle.test.tsx) check the server's maximum budget and refusal to replace an explicitly protected budget with a cached personal quote. These targeted commands use existing component fixtures:

```bash
npx --no-install vitest run src/features/jobs/jobs.test.tsx src/features/jobs/lifecycle.test.tsx
node --test scripts/runtime-documentation.test.mjs
```

Run mutating [delegated-pricing SQL checks](../scripts/delegated-pricing-db-tests.mjs), [commission API checks](../scripts/commission-api-check.mjs) and [role/pricing browser journeys](../tests/e2e/roles-pricing.spec.ts) only through the owned isolated acceptance environment described in [LOCAL_DEVELOPMENT](LOCAL_DEVELOPMENT.md), normally `./portal test`. The SQL, actual Auth/REST/browser and native retained-data stages are distinct evidence. This documentation lists their entry points without asserting a new execution, operational policy setup, deployment or complete security/legal certification.
