# Executed contracts, compensation and invoice tracking

This slice records executed documents and compensation. It is not payroll, accounting, a tax calculation service, banking, or an electronic-signature provider. Registration means authorised management attests that a document was executed externally. A lecturer's portal acknowledgement records receipt of a particular version/hash; it does not create or claim a legally sufficient signature. Production use still needs the organisation's legal/retention review.

## Contract versions

Each existing `contracts` row represents an immutable executed agreement version. New rows reference a specific clean PDF `document_versions.id` and SHA-256, not the document's replaceable current-version pointer. Addenda point to a prior executed version for the same lecturer. Owners can read their own records; other users need the specific `contracts.read`/`contracts.manage` capability with AAL2. Ordinary senior lecturers gain no access to other people's contracts.

Only `contracts.manage` with MFA can register or explicitly change active/expired status. Registration and status changes use the same per-lecturer transaction lock as claiming. The claim routine preserves its all-or-nothing allocation logic but selects the **newest applicable** contract first and then checks status, revocation and whole-block expiry coverage. An expired/revoked replacement cannot fall back to an older active row. Explicit ancestor revocation also blocks its addenda. Claiming holds an active-profile share lock so suspension serialises against a claim already committing.

Receipt acknowledgements are owner-only and bind the stored contract hash. Retried requests return the original receipt; rows cannot be edited in place. Legacy fictional M1 contract metadata may have no PDF/hash; it cannot be acknowledged as an executed file until a real version is registered.

## Original-currency compensation and invoices

`finance_earnings` returns only the actor's accepted claims unless `finance.manage` with MFA explicitly requests the wider view. Expected/completed stages follow actual assignment instants; invoiced/paid stages follow current invoice links. EUR and AUD remain separate original amounts. CSV serializers must neutralise spreadsheet formula prefixes in authored text cells; the API returns permission-scoped JSON, not an unescaped CSV string.

A lecturer submits their own scanned invoice PDF with selected accepted claims. The database derives compensation from immutable claim snapshots, rejects mixed currencies, other people's claims and a second active invoice for a claim. It does not parse the PDF's tax totals. The recorded amount is agreed compensation; VAT/GST or invoice legal correctness are external review responsibilities. Invoice number/date/PDF/claim references and amounts cannot be changed in place.

Authorised finance management approves/rejects/cancels unpaid records. Rejected/cancelled links release claims. Restoring approval must satisfy the unique active-claim constraint, so it cannot create double billing after a claim was re-submitted elsewhere. Paid or partially paid invoices cannot be silently reclassified. A corrected legal invoice/number workflow beyond this tracking slice remains a future enhancement.

Payment records are tracking entries only; no funds are transferred. Amounts must use the invoice's original currency, positive two-decimal values and cannot exceed outstanding compensation. Concurrent managers serialise on the invoice, and client UUIDs deduplicate retries. Partial payments leave the invoice approved; only the exact full sum marks it paid. Erroneous entries are voided with a mandatory reason and an audit record, preserving the original amount/date/reference. Claims remain invoiced until the whole invoice is paid; the system does not invent an allocation of partial payment between separate claims.

## File evidence and revocation

Contracts/invoices retain exact historical versions. Referenced file versions cannot be mutated, and ordinary document soft-deletion cannot hide linked commercial evidence. A new current version is independent of the accepted older version. The authenticated file gateway supports explicit old-version download, rechecks current actor/document authorisation and does not issue irrevocable signed links. Account suspension denies records, receipts and file reads with existing tokens through fresh active-profile checks. Operators with server/database credentials remain trusted infrastructure actors and need separate operational controls/backups.

## Actual verification

- `node scripts/commercial-db-tests.mjs`: **14 real PostgreSQL checks passed** in a disposable database replaying all migrations. Covers executed PDF ownership/MFA; private contract and senior-lecturer boundaries; hash-bound immutable receipts; replacement/ancestor revocation; accepted-contract links; original-currency earnings; invalid/mixed/foreign invoices; server-derived immutable compensation; invoice/idempotency/RLS; partial/full payment, overpay and void history; old-version retention/replacement; rejected-link restoration constraints; two-manager payment race; suspension/anonymous denial.
- `node scripts/commercial-api-check.mjs`: **passed** using actual Supabase Auth, a genuinely enrolled/verified management TOTP factor, actual Storage and ClamAV-scanned PDF binaries. Verifies external-execution metadata, owner receipt, contract-gated claims, private original-fee invoices, retry safety, partial/full tracking payments, audited correction, and exact older PDF download after replacing the document. UUID-scoped accounts/business records/storage objects are cleaned; existing development records are preserved.
- Original `node scripts/db-rpc-tests.mjs`: **25 passed again** after the claim-version change, including the 50-contender allocation and conflict/security regressions.
- SQL lint and advisor checks are run on the full integrated schema. Browser authoring/payment/accessibility checks are a separate frontend acceptance source.

Production email/hosting, tax/legal decisions, invoice corrections, retention/export approval and disaster recovery are separate gates. No real agreement, invoice, customer data or payment was used by these tests.
