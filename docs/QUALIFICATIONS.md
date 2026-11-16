# Qualification evidence and verification

The M8 source adds explicit sharing of a **specific own certificate version for a selected topic** to the existing manual management attestation. The evidence picker searches server-side with actual page cursors (20 entries, at most 50). Upload and quarantine remain in the existing Files/ClamAV pipeline. A file, upload or sharing grant alone does not verify a qualification.

In your own profile, select a topic, choose a clean certificate version, confirm the sharing text and save. Management opens the evidence/review-history view for that topic, downloads exactly that version if needed and confirms verification with an optional future UTC expiry. The existing manual review path remains available. A new upload/file replacement does not change an existing sharing grant. Replacing or withdrawing evidence changes neither an existing verification nor accepted assignments. A professionally required revocation is an explicit management decision; its validity continues to affect future claims through the final course end.

## Permissions and file versions

`qualifications.verify` with current MFA authorises the targeted evidence workflow, no longer blanket reading of other people's certificates. The new Files action `qualification_evidence_download` requires the current binding ID. It checks permission, owner, personal certificate type, clean exact version, size and SHA-256 before downloading and rechecks the sharing grant after Storage retrieval. It creates neither general document/version rights nor a reusable Storage URL. Revocation or an error hides cached evidence details in the interface; private files are not retained offline.

Existing separate permissions remain: `users.manage` with MFA can still read other people's CVs; contract/finance permissions retain their previous scope. The qualification feature adds no CV, contract or invoice access. Uploads of another person's certificates are now rejected before reservation. The supported path is own upload and explicit sharing for a topic.

Withdrawal, replacement, document archiving or removal of a topic ends the former evidence download grant. Adding a topic again does not restore an old grant. Review history contains decision/basis and events; a historical entry grants no historical download access. Existing verifications are not assigned invented retrospective history.

## Database and APIs

New CLI migration: `20261116080746_qualification_evidence_and_attestation_history.sql`. Existing migrations remain unchanged. Private tables `qualification_states`, `qualification_evidence`, `qualification_events` and `qualification_requests` have RLS and no browser table grants. Current topic selections remain in `lecturer_topics`; the new core does not alter underlying job claims, accepted terms or calendar allocations.

| RPC                              | Contract                                                                                             |
| -------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `own_qualification_certificates` | Only own clean personal certificate versions, literal search and a bounded cursor.                   |
| `qualification_review`           | Current topic state, CAS version and only currently shared version metadata.                         |
| `save_qualification_evidence`    | Own explicit binding; `p_version_id=null` withdraws access; CAS and request ID required.             |
| `attest_qualification`           | Current management permission/MFA, CAS/request ID, optional exact current binding.                   |
| `verify_lecturer_topic`          | Unchanged legacy signature; delegates manual attestation to the same internal decision/history core. |
| `qualification_history`          | Bounded history with a cursor for the owner or a currently authorised reviewer.                      |
| `qualification_evidence_access`  | Current narrowly scoped version for the authenticated download adapter, never a storage path.        |

Mutations first lock the active acting profile, then check its current role/permission. Role management and suspension use the same profile lock. Waiting calls cannot bypass an already committed role revocation with an old JWT. Topic/CAS state and evidence are then locked consistently. Reusing a request ID with a changed payload is rejected; confirmed retries write no additional decision and return the **currently sanitised state**, excluding revoked private metadata. At most 30 new changes per actor/minute; retries consume no second change.

History is immutable to browsers. Only privileged server-side cleanup can delete it: owner/account deletion cascades own private data, deleting a reviewer account removes its personal reference, and server-side version purge removes affected evidence references and their events. Normal startup, profile changes, soft archiving and the UI perform no such purge. This controlled boundary also supports existing UUID-scoped test-fixture cleanup; it is not a delivered retention interface.

## Verification and boundaries

Focused executable checks:

```bash
PORTAL_DB_CONTAINER=supabase_db_luminovia-portal-test-m7 node scripts/qualifications-db-tests.mjs
node_modules/.bin/deno test --allow-env supabase/functions/files/qualification-download_test.ts
npx vitest run src/features/qualifications/evidence.test.tsx src/features/admin/people.test.tsx
```

Executed in the M8 working source: **16 actual PostgreSQL groups**, **22 component cases** (16 new and six People cases), **four Edge download tests**, Edge typecheck/lint, TypeScript and scoped ESLint passed. All six API-surface groups also passed after actual replay of the current migrations.

SQL cases use an owned random temporary database in the authorised local scratch container. They check actual lock barriers for role revocation through both old and new decision paths, CAS/retry/rollback, only explicitly shared versions, topic removal, MFA and controlled cleanup. Edge tests exercise the actual download logic, including version/hash/owner mismatches and withdrawal during object retrieval. Component cases check explicit consent, lost responses, expiry, cache disposal and targeted queries.

`qualifications-api-check.mjs` and `tests/e2e/qualifications.spec.ts` are intended for the canonical isolated `./portal test` environment. Their existence is not yet executed Auth/scanner/browser evidence. Root documents complete native acceptance after the actual run. No external issuer authenticity check, signature validation, automatic email or legal-compliance certification is claimed.
