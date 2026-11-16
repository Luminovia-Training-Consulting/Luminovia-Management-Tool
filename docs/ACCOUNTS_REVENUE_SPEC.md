# Accounts, course profiles and commission model

Approved extension: 16 November 2026 (Australia/Brisbane). Clients have individual accounts and administrators may perform every business role's functions. The latest instruction replaces the earlier shared compensation default with private role-specific lecturer compensation. Actual business percentages are configured only by Administration in the private database; this public repository intentionally contains no defaults for them. The user confirmed that income-bearing accounts mean lecturers; learner accounts are optional and may be assigned to courses by management/administration. See [delegated roles and private pricing](DELEGATED_ROLES_PRICING.md) for the current authoritative extension.

## Identity and administrative authority

Every person has a separate Supabase Auth identity. Roles are trusted database records, never editable user metadata. `owner` represents the platform lead/Carina; `admin` and `owner` have full business administration and can themselves teach or enrol when the ordinary course/qualification/contract rules are satisfied. Management retains explicitly granted operational capabilities. Privileged account, contract, financial and enrolment mutations require verified MFA.

Private DM membership and private calendar ownership are retained. Full administrative functionality does not fabricate attendance, rewrite accepted work, grant a private DM membership or bypass financial transaction safeguards. Last/self-administrator protections serialize activation and role changes under the same database lock.

New fictional local fixtures add `carina@example.invalid` (owner demonstration) and `client@example.invalid` alongside the eleven lecturers, admin and optional learner. They have distinct Auth IDs. The shared generated fixture password is local QA setup only; invitation recipients set their own passwords. Existing passwords, roles, profile edits, suspensions and revoked memberships are never reset by seeding/startup. Existing development data can retain its original fixture set until the explicit insert-only seed is run; startup never reseeds a populated instance automatically.

## Money and visibility

| Actor                      | Authorised view                                                                                                                                                                                             |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lecturer / senior lecturer | Offered and accepted **own lecturer compensation**, expected/completed/invoiced/paid amounts, own uploaded invoice PDFs and tracked payments. No customer gross or platform commission field is returned.   |
| Client                     | Their own organisation's requests, full customer offer, commissioned/assigned spend in original currency and assigned lecturer identity. No other organisation or private lecturer invoice/contract access. |
| Management                 | Explicit operational functions and authorised lecturer invoice/payment administration. Gross/platform reporting needs the separate capability reserved to admin/owner.                                      |
| Admin / owner              | Full customer gross, agreed lecturer net compensation and platform margin, original-currency reporting, operational administration and own lecturer functions.                                              |
| Learner                    | Explicitly enrolled course data and its lecturer; eligible own course feedback. No business financial data.                                                                                                 |

Gross, policy and platform data live in an unexposed private schema. Role-priced offers put zero sentinels in raw `jobs.amount/total_amount`; applications use `job_offers()` for their authorised current offer. Lecturers receive only their own applicable fee; Management receives null for protected compensation. Accepted claims and lecturer invoices retain immutable lecturer-compensation semantics. Compensation rounds to cents first and the platform receives the exact remainder, with no hidden EUR/AUD conversion. Each offer stores a private policy snapshot; policy edits apply to future offers. Explicit unclaimed-offer repricing advances its terms version. Current role-specific claim tokens and database locks prevent accepting an outdated role quote. Accepted gross/net/margin snapshots never change with later templates, roles or policy edits.

Existing net-only agreements remain unchanged. Their historical customer gross is **unknown**, represented as null/legacy rather than an invented double of net pay. Revenue reports distinguish offered/accepted values and preserve original currencies. A recorded lecturer payment does not prove customer funds were received, and does not initiate a bank transfer.

## Course and profile workflows

- Clients create scoped course requests with precise sessions and the full fee. Authorised administration publishes the lecturer offer. Eligible lecturers still claim immediately and atomically; no routine approval queue for lecturer claims is introduced.
- Staff profiles expose intentional biography, country/languages/teaching experience, authored labels, expertise and real upcoming/current/past assignments. Private contact details, CVs, contracts and rates are excluded. Client/learner profile projections are resource scoped. A full-course link appears only if the actor can open that course.
- Profile labels are self-authored and are not qualification verification or permissions. Directory filters use these labels and actual topics. Invoices have their own bounded labels and combined search/status/currency/label filters and exports.
- Managers/admins assign optional learners to courses. Reviews require confirmed completed enrolment and a real assigned lecturer, reject self reviews, preserve version history/audit and hide learner identity from ordinary readers. Moderation requires its capability, MFA and a reason. No fabricated attendance or manually invented reviews are seeded.

## API and acceptance

The versioned `/functions/v1/accounts/v1/` API covers own identity/profile, administrative account search, roles, activation, client organisation grants and invitations. Its OpenAPI document is served at `/functions/v1/accounts/openapi.json`. Supabase Auth supplies login/password/recovery/MFA. Domain operations use the same JWT through documented public RPCs and the existing authenticated document gateway; service keys never enter client code.

Required verification: direct REST/RPC and façade permission denials; own/cross-account and cross-organisation access; gross absent from lecturer responses; private policy configuration, role quotes and cent rounding; immutable old/accepted deals; concurrent claim/revenue and account lifecycle races; actual scanned net invoices/payment records; real course history/enrolment/reviews/moderation; mobile/DE/EN/keyboard/axe and fresh one-command/PWA checks. Planned acceptance is not a test result; see QA_RESULTS.
