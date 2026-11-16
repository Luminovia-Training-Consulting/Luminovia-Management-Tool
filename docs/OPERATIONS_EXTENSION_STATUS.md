# Seven additional operational modules

The authoritative additional user prompt is preserved verbatim in [OPERATIONS_EXTENSION_PROMPT.txt](OPERATIONS_EXTENSION_PROMPT.txt). It extends, and does not replace, [UNIVERSAL_MASTER_PROMPT.txt](UNIVERSAL_MASTER_PROMPT.txt). The [initial coordination audit](EXTENSION_COORDINATION.md) records current PR overlap, rules and the automatic development-release boundary. A partial checkpoint is not full delivery.

## Current checkpoint

Initial implementation source is isolated on `codex/operations-extensions`, initially from e75f55d and updated to accepted main d4c1f49. Existing unrelated changes in the original checkout remain untouched. All historical migrations remain unchanged; every new schema change is additive and CLI-generated.

| Requested module               | Backend/frontend/integration                                                                                                                                                                                     | Executed focused tests                | Unverified or remaining                                                                                                                           |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Course Readiness Centre        | Live scoped calculation, per-course requirements, clean accessible material checks, contracts/qualifications, schedule confirmation, instruction receipts, preparation tasks; DE/EN UI, navigation and dashboard | 16 PostgreSQL groups; 13 source cases | Actual HTTP/browser/PWA/complete regression and exact PR CI/review/merge still pending                                                            |
| Attendance & Proof of Delivery | Versioned drafts, immutable submissions/corrections/reviews, assigned-customer confirmation, hours comparison and existing invoice links, loaded-page CSV; DE/EN UI                                              | 12 PostgreSQL groups; 7 source cases  | Actual HTTP/browser/complete acceptance, CI/review/merge pending; no inferred SMTP or physical PWA acceptance                                     |
| Replacement marketplace        | Open/selected/emergency full future-block handover; existing claim/quote/eligibility/calendar/chat/file predicates; atomic rollback, original history retained; DE/EN UI                                         | 13 PostgreSQL groups; 4 source cases  | Started/partly completed/invoiced handovers, waitlist/ordered notices remain incomplete; actual HTTP/browser and role-pricing integration pending |
| Change requests                | Under investigation; existing confirmed commercial snapshots must remain immutable                                                                                                                               | None yet                              | Complete new request/versioned amendment/approval/apply workflow and all acceptance required                                                      |
| Website-to-Portal enquiries    | Website architecture inspected read-only: static React/Vite/Preact, mailto contact, GitHub Pages deployment                                                                                                      | None yet                              | Secure independently testable intake and management workflow; public site activation needs separate authorisation and secure anti-abuse transport |
| Accounting integration         | Reuse existing immutable original-currency invoice/payment records and safe CSV; new adapter under investigation                                                                                                 | None yet                              | Validated JSON/accounting exports, actual required customer-invoice data and e-invoice library/validator evaluation; never invent tax/FX          |
| Internal Support Desk          | Own ticket/search/replies/status/reopen/history; explicit support capability/MFA; hidden internal notes; dedicated scanned attachments and inbox; DE/EN UI                                                       | 12 PostgreSQL groups; 7 source cases  | Actual HTTP/scanner/browser/full acceptance and exact CI/review/merge still pending                                                               |

All four initial UIs use existing light/dark/system styles, online confirmed mutations and memory-only private query data. Authored API and browser tests are not counted as executed. Source compilation is not native service, hardware, platform, accessibility or PWA installation acceptance.

## Verification and release gates

The first source checkpoint passes whole-project TypeScript/ESLint, all257frontend tests and unchanged coverage floors (S52.04/B47.09/F42.28/L53.86%). The focused SQL suites use separately owned random databases, never normal/hosted records. `./portal test` refused before startup because another checkout owns the global QA lock. No foreign service was stopped. Run the unchanged canonical command once ownership becomes available, and correct actual failures.

Current live main requires signed history, strict checks, resolved findings and independent review/latest-push approval. The user's conditional feature merge authority remains subject to those gates. An additional coordination message, relaying Carina's explicit request, temporarily holds all main merges until the chat finishing PR15 sends its release. Branch work/tests may continue. Do not modify PR15's branch or bypass that hold.

Eligible main merges may trigger the existing authorised development VPS updater. Do not claim VPS installation without actual activation evidence. Production, public Website, DNS, hosting changes, real emails, purchases and new services keep their separate approval boundaries.

## Continuation

1. Finish/read the four feature guides and actual source; inspect current GitHub heads before integration.
2. Preserve a signed first-four checkpoint, then implement change requests, enquiry intake and accounting in isolated worktrees to avoid changing a running acceptance snapshot.
3. Integrate current main/role-pricing/qualification/notification/customer-neutral work by inspecting its owning PRs rather than recreating it.
4. Run complete canonical SQL/API/Auth/scanner/desktop/mobile/axe/PWA/retention acceptance; inspect screenshots. Extend tests for each completed P2 path.
5. Publish focused labelled PRs with exact evidence/limitations; wait for actual checks and independent review. Honour the temporary merge hold, then merge only eligible exact tested heads and verify merged source/development activation separately.

Feature guides: [readiness](COURSE_READINESS.md), [delivery](TEACHING_DELIVERY.md), [replacement](REPLACEMENT_MARKETPLACE.md), [support](SUPPORT_DESK.md). Keep the complete original product ledger in IMPLEMENTATION_PLAN; these additions do not close unrelated pending scope.
