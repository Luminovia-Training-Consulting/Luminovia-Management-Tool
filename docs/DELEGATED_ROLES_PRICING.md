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

`job_offers()` returns the existing job DTO with nested sessions/requirements. A lecturer sees only their current applicable net amount, derived from the private offer snapshot and actual server role. Management sees `null` monetary values for role-dependent offers. The directly queryable `jobs` table stores no default or alternate lecturer rate for those offers. Company projections expose only their authorised organisations' gross amounts. Revenue and captured-policy RPCs remain administrative.

The displayed `terms_version` of a role-dependent quote is a composite of the base consent version and a role discriminator. The discriminator carries no percentage. Claiming locks the actor profile, validates the current quote token, then delegates to the existing atomic capacity/conflict/contract transaction. Role mutations take the matching profile lock. A stale quote after a role change or reprice returns `terms_changed`; claiming cannot silently accept a different amount. Claim and revenue triggers independently calculate and validate the accepted net and conserved private revenue. Accepted claims retain the base document/terms version and an immutable compensation snapshot.

Same-request retries return the original committed receipt. A later senior promotion, global policy edit, cancellation or new quote never rewrites an accepted deal. Offline/optimistic confirmation remains prohibited.

## Verification

`scripts/delegated-pricing-db-tests.mjs` replays the previous schema, creates a historical accepted commission, applies the migration, and verifies exact historical claim/revenue preservation. Its disposable PostgreSQL cases cover subordinate delegation, guest permissions, equal/higher/self protection, invitation rechecks, financial-grant composition, policy setup/CAS/privacy, direct-table sentinels, role-bound consent, mixed-role capacity claims, exact rounding, idempotent accepted receipts and future-only policy changes. Existing accounts, commission, CBW and capacity suites retain independent checks. Native API/browser evidence is reported separately in the work log and QA results.
