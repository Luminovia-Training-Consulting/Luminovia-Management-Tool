# Course building blocks, source references and teaching offers

The approved curriculum catalogue contains **22 distinct building blocks from 24 supplied PDF versions**. Every block already has one reusable course template after the additive migration runs. Startup does not need OneDrive, Poppler or the original PDFs, and does not reset edited templates.

## Customer-independent operation

A building block describes reusable teaching content, not a customer account. Source provenance does not assign an organisation, user membership, contract or commercial agreement. Create the actual customer under **Customers**, select that organisation when planning each course run, and reuse the same teaching template for other customers as needed.

Administration may invite client users and grant explicit organisation memberships. The server checks current membership and permissions for organisation requests and financial projections; client access is not a general catalogue, private-contact or teaching-discussion entitlement. This describes the existing organisation-scoped model, not a claim that every product module has a separate tenant workspace. See [customer/course operations](OPERATIONS.md) and [client access](CLIENT_COMMISSION_SECURITY.md).

Public documentation, examples and screenshots must use neutral descriptions or fictional organisations. Actual customer names, contacts and other business records are configured privately in the application and are not included as public provenance or product branding. Historical migration versions remain immutable; review the source hashes in the [M4 review](REVIEWED_M4_MIGRATIONS.md) rather than rewriting installed history.

## Daily workflow

1. Open **Courses → Course building blocks**, search by code, title or curriculum and inspect the source. The detail shows the source filename, document revision/creation dates, content pages and complete SHA-256 fingerprint. Original PDFs are not publicly hosted and filenames are not broken download links.
2. Authorised management with MFA chooses **Plan course run**. The source template is preselected. Select the actual customer, display time zone, delivery/venue and dates. The explicit weekday planner suggests the source's ten teaching days with editable daily times. It skips weekends; holidays, breaks and exceptions remain a planning decision. Save validates each actual time instant and DST ambiguity rather than silently shifting it.
3. Open the saved course and choose **Create teaching offer**. The administrator form shows trusted content, customer and exact source sessions as a stable read-only preview. Enter the financial terms and publish/draft choice. Changing content or scheduling belongs in course planning.
4. Administration enters the full customer fee under the privately configured compensation policy. Management without gross permission enters only the permitted lecturer compensation. The database derives the resulting job from the locked course; it never trusts browser-submitted titles, customers or session IDs.
5. A lecturer sees only their compensation and the source reference. Claiming reserves every actual session immediately through the existing atomic claim transaction. Gross offers appear in the appropriate client's request/spend list; net-only offers retain unknown gross and do not fabricate customer quotes.

Building-block/template discussions are attached to the actual reusable template, so teaching notes persist across runs of that template. Job discussions remain attached to the individual job. These are teaching-team discussions; clients/learners do not receive their bodies. Course enrolment, invoices and private commercial/DM/calendar boundaries remain independent and enforced.

## Source identity and editorial decisions

The record's **Kurzzeichen** determines identity. The supplied `Bausteinbeschreibung-LPIC3.pdf` and `Bausteinbeschreibung_LPC3.pdf` both identify **LPC3** and contain the same curriculum after layout whitespace is normalised. The equivalent LPIC4/LPC4 pair identifies **LPC4**. Their PDF bytes differ and both versions are retained, rather than creating duplicate courses or pretending the files are identical. The LPIC-named variants have document revision 09 September 2026; the underscore LPC variants have 05 September 2025. The newer version is the primary catalogue reference.

The maintained course naming is authoritative: LPC3 and LPC4 are module codes which together prepare for LPIC-1 102-500 after already completed 101-500 content, with LPC4 following LPC3. That project instruction is recorded in prerequisites/notes. Historical source titles and curriculum, including old certification identifiers, are preserved visibly; this import does not certify that those documents match current external exam requirements.

All other supplied codes remain separate: BVMM1, CIS2–CIS5, COS1–COS2, DLO2, EAA1–EAA2, GLCC, GRDB, ITE1, KIE1, LPC1–LPC4, MASL1–MASL2 and PTE1–PTE2. No CIS1 file was supplied and no missing course is invented. Source authors, book prices, ISBNs and room-preparation sections are not imported as curriculum. Wrapped lines and the repeated adjacent DLO2 bullet are normalised for reading; course content is otherwise left in its authored language.

## Data and authority

| Owning entity                                                | Purpose                                                                                                                                      |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `data/course-building-blocks.json`                           | Reviewed import artifact with 22 source-derived curriculum definitions and 24 exact-byte source versions; no PDFs or absolute personal paths |
| `building_blocks`                                            | Curated source curriculum, identity, stated duration, notes and default reusable template                                                    |
| `building_block_sources`                                     | Immutable filename/hash/page/date versions; only the primary-selector flag can change                                                        |
| `course_templates`                                           | Editable teaching content derived from the source, with a matching building-block/source foreign-key pair                                    |
| `course_runs` / `course_sessions`                            | Actual customer/delivery/time-zone and precise dates; reused directly by a job                                                               |
| `private.course_run_job_requests`                            | Actor/request UUID binding for durable retries of both financial modes; never exposed in lecturer APIs                                       |
| Existing private commission/request/accepted-revenue records | Real gross agreement and client linkage when known; accepted snapshots and old net semantics remain unchanged                                |

Source curriculum and editable teaching templates intentionally have different responsibilities. Editing a template does not rewrite the original catalogue definition. A template copy retains its exact source link, while run duplication continues to omit jobs, contracts, learners and chat members. Once an offer exists, source lineage cannot be rewritten through template/source/run/job relinking. New source editions require an additive reviewed source and template version; accepted work does not follow a mutable “latest document” pointer.

Staff may browse the approved source catalogue. Management writes require `courses.manage` and verified MFA; the new offer API also requires `jobs.manage`. Clients do not gain a general curriculum browse permission. Learners can read the source associated with their actual enrolled/completed course, and lose it upon revocation. No content import grants verified expertise, eligibility, a contract, attendance or a review automatically.

## Developer APIs and invariants

- `course_run_job_defaults(p_course_run_id uuid)` returns the trusted run/template/source/customer/delivery/topic/session DTO with a `source_revision`. Exact source session IDs are named `source_course_session_id` in this preview and stored as `job_sessions.course_session_id`.
- `create_course_run_job(p_course_run_id uuid, p_payload jsonb, p_platform_percent numeric default null, p_client_id uuid)` returns one job UUID. `p_client_id` is a required fresh request/idempotency UUID, retained unchanged for retries; it is not an organisation or client-account ID. The closed payload contains `source_revision`, currency, fee unit, terms, contract requirement, draft/published status and optional explicit deadline; amounts are either gross amounts for authorised admin/owner or net amounts for management. Source identity, customer, title, location and dates cannot be injected.
- The source fingerprint covers trusted curriculum/context/topic values and exact session IDs/epoch instants. It is independent of the SQL display time zone and excludes financial values. It is checked after course/template/organisation locks. A source changed after preview yields `course_run_source_changed`; the app preserves the entered financial draft and asks the user to inspect/reopen the latest course.
- The actor/request lock is acquired before the run lock. A matching retry returns the original UUID, changed request parameters conflict, and different actors racing the same run produce one complete offer. A current draft/published/filled offer yields `course_run_offer_exists`. This initial slice offers the whole run at capacity one; split-job/cancellation/capacity expansion remains in the product plan.
- The run needs an active actual customer (`course_run_customer_required`). Missing, past, nonfinite or overlapping sessions and deadlines after the first session are rejected without partial writes. Creating the job copies existing source session IDs and requirements without creating another organisation, template or run.
- Gross calculation delegates to the existing authoritative commission function inside the transaction; the lecturer job/claim/invoice remains net-only. The immutable claim/revenue transaction, qualifications, contract prerequisites and overlap protections are reused unchanged.
- `job_building_block_reference(p_job_id uuid)` returns only authorised source identifiers. It uses the same current job-access predicate as the marketplace/comments. `JobBuildingBlockReference` and `BuildingBlockReference` share the source display component; no second source-of-truth UI is maintained.

The typed frontend contract is `src/features/operations/building-blocks-api.ts`. Native catalogue queries live beside the existing operations queries; server wrappers are security invokers and privileged implementations stay unexposed. Every new exposed table has RLS, direct authenticated writes are denied, and source/schema/provenance guards also protect against accidental privileged edits.

## Reproduce and maintain the import

```bash
node scripts/course-catalogue.mjs
node scripts/course-catalogue.mjs --source-dir "/path/to/the/provided/Building Blocks"
```

The second command reads originals with system Poppler `pdftotext`, checks every PDF hash and curriculum mapping and compares the reviewed artifact. It does not change a PDF or database. `--write` explicitly rewrites the catalogue artifact only after a human-readable diff review. `--sql` emits the deterministic current insert-only DML; a regression checks it against the forward migration's generated section. After an applied release, preserve old migration files and introduce a new migration for additional/changed sources. Updating an existing code to a different curriculum deliberately requires manual version review, not silent alias dedupe. Changing the primary source for a used template requires a new template version.

The current sources are `scripts/course-catalogue.mjs`, `data/course-building-blocks.json` and the [customer-neutral forward migration](../supabase/migrations/20261116032005_customer_neutral_course_catalogue.sql). Historical migration `20261115155208` in [the migration directory](../supabase/migrations) remains byte-identical. The catalogue has no dependency on the user's absolute filesystem path at runtime. Its deterministic insert-only import is safe to reapply to missing initial rows and never replaces user-authored template text. Original files remain in the user's existing folder.

## Customer-neutral correction and installation boundary

The forward migration removes the original single-provider restriction and uses a bounded catalogue namespace independent of customer organisations. It neutralises only exact original catalogue labels and pristine default templates with no course runs, authored edits, topic changes, archive state or save-audit record. Historical used/edited templates, all source revision identifiers and accepted job/financial records remain unchanged. The same reviewed source can be reused for different customer organisations without creating another course identity.

The five actual PostgreSQL upgrade groups verify two independent customer organisations sharing one template, scoped offers and an accepted claim before the change, exact retained records, edited templates and another neutral catalogue namespace. The existing 16 catalogue SQL groups and six catalogue unit checks also pass. Eight historical branded screenshots have been removed from public documentation. Exact PR23 CI passed the HTTP/SQL and persistence stages but failed two mobile pointer actions (82/84 browsers). Strict pointer readiness and safe geometry diagnostics were added; the next complete outcome is recorded on PR23. The initial local canonical command had refused another checkout's shared QA lock. The historical results below describe their recorded source revisions only.

This migration replaces a constraint and includes bounded data changes, so it retains the existing operator-review gate. A source change or these local checks do not install it on any hosted instance. Do not rewrite historical migration files or bypass that gate.

## Verification status

The complete canonical application run 03 passed in `.local/tests/0260b044/RESULT.txt`, completed **2026-11-15T16:43:20.241Z** (16 November Australia/Brisbane). It included all 16 course-building-block PostgreSQL cases and the actual `course-building-blocks-api-check.mjs` Auth/TOTP/REST journey, followed by both complete course-building-block browser journeys (desktop 7.8s, mobile 7.8s). The entire integrated run passed 52/52 browser cases, production build, 2/2 built-PWA cases and checked isolated cleanup. Root WORKLOG/QA_RESULTS own the full aggregate source/runtime/Edge/SQL/API counts and exact submitted-revision CI status.

The course-building-block browser flow exercised catalogue search, DE/EN switching without losing the filter, dark/light rendering, exact source versions/checksum, literal template comments, generated ten-session run, authoritative financial-only offer, reused customer/template/run/source-session IDs, hidden customer gross and a real ten-session lecturer claim. Automated axe and document overflow assertions passed. Final desktop/mobile fictional screenshots were visually inspected: source metadata is styled/readable, the intended palette accent is visible and desktop compensation stays beside the first content. No original PDF, real person, credential or MFA QR was captured.

Visual review of run 02 found that a direct lecturer job route did not load source-card CSS from the lazy course page. Shared `building-blocks.css` now loads from its actual shared component; source/planner rules were moved rather than duplicated. An undefined brand variable was corrected to the real palette token. Run 03's direct-navigation source-border and catalogue-accent assertions passed on desktop/mobile. The prior 02 screenshots are not final style evidence.

Five Node catalogue/provenance/reproducibility checks and three schedule tests passed incrementally. The catalogue SQL-generator guard was strengthened during run 03's already frozen application snapshot to reject both nested SQL dollar delimiters in future supplied source content. The new synthetic case first reproduced the missing exception, then all 5 Node checks passed; read-only original-source verification again matched 24 PDFs/22 blocks and the generated migration/data reproducibility case passed. Only the import utility/test changed after that snapshot: no application, schema, reviewed JSON or embedded migration changed. Root records this narrow targeted correction separately, and exact submitted-revision CI runs the full current command.

All mutating API/browser checks use the random disposable stack and checked scoped cleanup. Normal/hosted data and original PDFs are untouched. Local Chromium/axe/source metadata acceptance does not assert current external exam requirements, hosted release readiness or a complete manual accessibility assessment.

Combined hosting/application acceptance also passed in canonical04 (`4c7c897`,17:31 UTC, exit 0): all new feature SQL/API/desktop/mobile journeys plus the full regression suite. See [QA_RESULTS](QA_RESULTS.md). This is local acceptance; the [M4 hosted migration review](REVIEWED_M4_MIGRATIONS.md) remains a separate gate.
