# Accounting interoperability

Status: separately deliverable source is integrated on `codex/accounting-delivery` with current main and the first-four operational modules, without a website-intake dependency. Navigation and shared job-state invalidation are connected. Focused evidence is recorded below; actual Auth/scanner/browser/CI/merge/installation remain distinct gates. This guide does not claim production approval or a certified accounting importer.

## What is recorded and exported

`/accounting` lists an actor's lecturer invoices, current MFA finance management's lecturer-invoice overview, or currently permitted customer invoices. Cursor pagination exposes older records explicitly. A user selects up to 100 invoices and requests JSON or CSV. The server captures a durable immutable snapshot only after checking every selected invoice and locking source invoices against concurrent payment changes. The browser downloads only a validated, confirmed server response. Export retries retain the original receipt; new requests with unchanged contents reuse the same snapshot, while changed payments produce a new content checksum and snapshot.

Exports preserve invoice numbers/dates/due dates, original EUR/AUD currency, recorded totals, actual recorded payments/reversals, outstanding totals, status and authorized assignment/customer references. Monetary values are exact two-decimal strings; frontend validation uses integer cents. No exchange rate or currency conversion is invented. CSV reuses the existing formula-safe cell encoder, including invoice numbers, organisation names and payment references.

The known lecturer compensation is not automatically labelled a tax net amount. Likewise, a full commercial customer charge is not automatically a VAT gross amount. Current invoice data has no authoritative tax breakdown; `tax.status` is `not_recorded`, with net/gross/VAT fields null in JSON and empty in CSV. A rejected/cancelled lecturer invoice retains its actual status and original amount, without fabricating a credit note or negative tax adjustment.

## Externally issued customer invoices

Current gross-finance authority with MFA can register an **already issued** customer invoice. The form collects its actual number, invoice/due dates, exact original-currency total and a dedicated scanned PDF. The actor explicitly checks those values against the supplied document. Selected accepted customer agreements must exist in the immutable revenue ledger, belong to one organisation/currency and not already have a customer invoice. The transaction preserves their original charge total separately. If the supplied invoice total differs, an explicit reason is required; the accepted agreements and lecturer compensation remain unchanged.

Registration neither generates a legal invoice nor sends anything. It records existing evidence and the supplied values. The schema does not infer VAT from a difference or declare that the PDF is legally sufficient. Customer invoice cancellation/credit-note issuance and validated tax-field capture remain future evidence workflows; the UI states that limitation.

Customer payments document known receipts using exact decimal values and explicit canonical payment instants. Invoice locking prevents concurrent overpayment. A correction appends an equal reversal pointing to the original payment and retains the reason. Original invoice/payment rows are immutable. This records payment information and does not initiate transfers.

## File and commercial privacy

An unregistered customer PDF uploads through the existing reservation/quarantine/scan gateway as **personal material**, visible only to its owner. Uploading it initially as an ordinary lecturer `invoice` would expose its contents to net-finance staff before registration, so this path deliberately avoids that disclosure window.

Registration requires an owner-uploaded, current, clean, dedicated single-version PDF with a recorded SHA-256. Its document classification changes atomically with the customer-invoice registration. After commit, the customer-invoice ACL takes precedence over the ordinary lecturer-invoice ACL. Only current gross-finance authority or the invoice organisation's active customer membership can read it. Ordinary net-finance management does not gain the full customer document. The document and its sole version are frozen, and the PDF cannot be reused as a lecturer invoice. Existing support attachment mutation guards also prevent registering an already attached support file.

The migration preserves the exact trusted `can_access_document` body installed by earlier migrations in a private fallback that has **no authenticated/anonymous EXECUTE grant**. It replaces the original function in place, retaining the OID used by existing RLS policies. The new wrapper checks customer invoices first and otherwise delegates unchanged. Therefore, when integrated after support/document extensions, their already-installed ACL remains authoritative. A direct call to the fallback cannot bypass the new customer restriction. Combined source/storage acceptance must still verify this integration.

Customer exports omit private accepted-charge comparisons, discrepancy notes and lecturer claim identifiers. Saved exports are exporter-owned and checked again against current invoice access before retrieval. Snapshots containing gross-finance fields retain an explicit `requires_gross` flag: an account later converted to a customer cannot retrieve its old administrative snapshot merely by obtaining narrower organisation access. Removal of membership, capability or active account status denies later reads/downloads. Previously downloaded bytes cannot be recalled.

## Data and SQL API

All five new tables are in the unexposed private schema, have RLS enabled and revoke public/anonymous/authenticated table privileges:

| Table                          | Purpose                                                                                   |
| ------------------------------ | ----------------------------------------------------------------------------------------- |
| `accounting_customer_invoices` | Immutable supplied external invoice values, exact PDF/hash and accepted-charge references |
| `accounting_customer_items`    | One customer invoice per referenced accepted claim                                        |
| `accounting_customer_payments` | Immutable payment and reversal ledger                                                     |
| `accounting_exports`           | Immutable actor/scope/content snapshots, required disclosure level and content SHA-256    |
| `accounting_operations`        | Actor/request identity and exact idempotent operation receipts                            |

Public RPCs are invokers around empty-search-path private implementations. `accounting_access()` returns current UI capabilities. `accounting_invoices(p_source, p_before_at, p_before_id, p_limit)` returns authorized cursor pages; `p_source` is `own`, `lecturer_all` or `customer`. `accounting_customer_claims()` supplies the gross-only registration picker.

`register_customer_invoice(p_payload,p_request_id)` requires exactly `claim_ids`, `number`, `issued_on`, `due_on`, `currency`, `total_amount`, `document_version_id` and `difference_reason`. Totals are decimal strings, not floating-point inputs. Dates are actual calendar dates. Claims, documents and current authority are validated in the transaction.

`record_customer_invoice_payment(p_invoice_id,p_amount,p_paid_at,p_reference,p_request_id)` and `reverse_customer_invoice_payment(p_invoice_id,p_payment_id,p_reason,p_request_id)` append payment history. `create_accounting_export(p_source,p_invoice_ids,p_request_id)` returns a validated immutable snapshot; `accounting_export(p_id)` retrieves it under current authority.

The wire identifier is `luminovia.accounting/1`. JSON contains stable field names; CSV contains stable machine headers. DE/EN applies to all UI, labels, help, errors and confirmations; user-authored invoice text remains in its original language. `sha256` hashes the stored invoice array's PostgreSQL JSONB text representation, not the entire downloaded wrapper/file and not a digital signature. A JSON round trip, original-currency totals and CSV formula escaping are covered by the export contract tests.

## Electronic invoicing evaluation

The implementation does **not** emit unsupported XML. The current record model lacks verified seller/buyer tax identity, invoice-line/tax breakdowns, electronic addressing/payment details and a configured standards validation profile. Its custom JSON/CSV is useful interchange data; no DATEV or other third-party importer compatibility has been demonstrated.

Primary sources checked on 16 November 2026:

- [KoSIT validator](https://github.com/itplr-kosit/validator) validates XML using schema/Schematron and produces validation reports. The official [XRechnung configuration usage](https://github.com/itplr-kosit/validator-configuration-xrechnung/blob/master/docs/usage.md) documents validator 1.6.3 and the XRechnung 3.0.2 configuration dated 31 August 2026. An actual conforming invoice requires both complete business data and the appropriate tested rules/configuration.
- [FeRD ZUGFeRD 2.5.2](https://www.ferd-net.de/en/downloads/publications/details/zugferd-252-english) identifies the 4 August 2026 package, effective from 1 September 2026, with profile-specific XSD/Schematron artifacts and hybrid PDF/XML representation. No registration/download form or service account was submitted.
- [Mustangproject](https://github.com/ZUGFeRD/mustangproject) is an established Java library/validator for ZUGFeRD/Factur-X and CII XRechnung. It is a candidate for a future approved offline validation step after mandatory source data exists. No extra application server, paid service or new runtime dependency is introduced now.

Before enabling XRechnung/ZUGFeRD output, add actual mandatory fields and proper invoice lines, choose/version an established writer/validator, run genuine positive/negative reference invoices and importer acceptance, preserve validation reports and review the accounting/legal operating requirements. This source does not claim legal compliance.

## Actual checks and remaining acceptance

Focused local execution uses the owned networkless/no-published-port container `supabase_db_luminovia-portal-test-extensions-20261116` and isolated random databases removed by the fixture. **10 PostgreSQL groups pass**, covering direct/anonymous/fallback denial, decimal/currency preservation, export retry/content deduplication, immutable history, real source payments, customer registration/documents, concurrent payments/reversals, organisation isolation, current revocation, narrower-role replay denial and malformed historical evidence. The actual `plpgsql_check` extension reports **10 new non-trigger function bodies with zero errors/warnings**.

**8 unit/component cases across 2 files** cover exact cents, full numeric range, canonical round trips, malformed totals/currencies/tax fields, formula injection, unconfirmed/offline responses, capability visibility, bilingual forms and hiding stale protected projections. TypeScript and scoped ESLint/Prettier pass on the final source when recorded in the delivery checkpoint.

The complete existing frontend coverage suite also passes **234 cases in 51 files**, with unchanged thresholds: statements48.97%, branches43.98%, functions39.11%, lines50.84%. That frontend run does not replace the pending connected API/browser/native gates.

```bash
PORTAL_DB_CONTAINER=supabase_db_luminovia-portal-test-extensions-20261116 node scripts/accounting-db-tests.mjs
PORTAL_DB_CONTAINER=supabase_db_luminovia-portal-test-extensions-20261116 node scripts/accounting-lint-db-tests.mjs
npx vitest run src/features/accounting
npx tsc -b
npx eslint src/features/accounting scripts/accounting*.mjs scripts/testing/accounting-pdf.mjs tests/e2e/accounting.spec.ts --max-warnings 0
```

An initial syntax-only replay accidentally omitted the container environment and used the test helper's default local container. It created/dropped only a random `accounting_migration` database; no existing data, roles, credentials or migrations were changed. It is not counted as intended owned-container acceptance. Subsequent cited SQL/body checks use the explicitly owned container above.

`scripts/accounting-api-check.mjs` is authored for real fictional Auth/MFA/REST, actual scanner/Storage PDF bytes, scoped registration, export/payment totals and revoked membership downloads. `tests/e2e/accounting.spec.ts` is authored for the connected customer-invoice form, actual upload, payment, JSON/CSV downloads, customer PDF isolation, DE/EN, dark mode, axe, keyboard-accessible controls and mobile overflow. Neither is claimed passed before the canonical combined `./portal test` executes. Its own guarded fixtures and immutable evidence are removed only from the owned disposable stack.

Root integration must add the route/navigation and relevant migration-guide/schema/API/user-guide entries, preserve the prior support/file ACL, execute the complete combined command plus native retained-data/security CI, obtain independent review and verify eligible merged source. Physical PWA/other browsers, validated e-invoice formats, third-party accounting importers and the future credit-note/tax workflows remain explicitly unverified or pending.
