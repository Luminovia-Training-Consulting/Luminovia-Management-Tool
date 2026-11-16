# File centre: search, personal tags and virtual folders

The file centre at `/files` searches server-side across all documents the current account may actually read. The previous workflow first loaded a list and then searched only in the browser. Because local and self-hosted REST queries are intentionally limited to 1,000 rows, older files remained invisible. A component probe that failed before the correction reproduced exactly this empty state with 1,001 metadata rows. The limit remains; the new search filters before the page boundary.

## Search and loading

`document_discovery` uses literal filename search, optional owner/category/job filters and personal tag/folder filters. `%` and `_` are ordinary search characters. The interface waits 250 ms after input, aborts superseded transports and preserves input focus. The existing `/files?q=…` entry point, for example from the dashboard, remains available.

A page contains 40 rows; the API permits at most 100. The cursor contains `created_at` **and** the document UUID. Equal timestamps therefore do not lose or duplicate entries. **Load more files** actually loads the next server page and merges IDs without duplicates. There is no invented global result total; the display counts loaded files. Every fetch rechecks `private.can_access_document` and the current active account. An empty job/owner filter grants no additional access.

The discovery query loads no file contents and does not periodically poll every loaded page. Focus, reconnect, explicit refresh and existing document mutations revalidate results. The attachment job catalogue is requested only when upload is open in an authorised job context. Existing subject/job views and attachments retain their metadata/scan/version queries; this document does not claim new pagination for every embedded legacy view.

## My organisation only

Each account can give a **currently accessible** document up to 20 personal tags of 60 characters each and a personal virtual-folder label of up to 80 characters, independently of other readers. Tags are normalised with the existing label validator and stored without case-insensitive duplicates. One tag per input line preserves commas within a label. An empty folder means unfiled; the special filter option finds exactly those files.

The association is a private account/document pair in `private.document_organisation`. Another lecturer or administrator receives neither these tags nor the folder. Two accounts can organise the same shared file differently. Filters apply across all currently accessible files, not only pages already loaded. Tag/folder filters compare complete labels case-insensitively.

A virtual folder is a personal label, not a Storage directory or hierarchical folder manager. It moves no bytes, changes neither ownership nor sharing and claims neither security classification nor DLP. Private contract/invoice/chat/profile files receive no new administrative grant.

`save_document_organisation` derives the account only from `auth.uid()`. The API accepts only document identifier, `tags`, `folder` and expected version. Version `0` represents an absent own association. Concurrent changes have exactly one winner; a stale version is rejected with `40001`. The draft remains visible. **Reload current organisation and close draft** explicitly discards it and reloads current metadata before another edit.

Archiving, revoked room/job permissions or account suspension prevent the association from acting as substitute permission. Hidden documents also disappear from searches through personal tags and cannot be organised further. A current server error stops displaying retained discovery data. The existing Auth account switch additionally clears the in-memory cache; query keys include the account. There is no persistent offline cache.

## Stable dialogs and current resource access

A pending filter fetch replaces result rows but preserves an already open archive/version/edit dialog and personal organisation drafts. New results use their own rows; data from other filters or accounts is not adopted. A legitimate empty filter result does not end a started operation.

Only actually opened targets receive a bounded exact-metadata check through the existing `documentQuery`. Account, document identifier, successful list observation and focus generation separate this check from old responses. Writes remain disabled while a check is unresolved. `null`, deleted/wrong target identifiers and permission errors discard the affected modal and its protected drafts. This also covers individual room-access revocation where the list response succeeds but is empty. Subject/job file lists use the same protection.

A previously blocked filename must not reappear from an old search cache or a merely appended page. Only an actually new complete response from the current observer can renew this quarantine. Network and version conflicts preserve permitted drafts; `42501` discards the original target. Late successes or failures from an old operation do not close a different draft opened in the meantime. There are neither per-result-row queries nor an additional polling loop.

This correction was reproduced first and checked by **47 passing file-component cases** with controlled transport barriers, cache/paging/focus transitions and exact write counts. Native complete acceptance remains separately recorded in [QA_RESULTS](QA_RESULTS.md).

## Preserved file pipeline

Upload, byte/MIME/size validation, quarantine and actual ClamAV scanning, private Storage, version history, preview Blob lifetime, rename and archive remain connected. Downloads continue using the existing authenticated file gateway with current resource checks and the selected version; tags or folders provide neither a public URL nor a Storage bypass. A metadata row is not evidence of an existing scanned file.

The additive CLI-generated migration is `20261116022731_file_discovery_personal_organisation.sql`. The previous 24 migrations are not replaced. The new table has RLS, no client write grants and no admin exception. Public RPCs remain invoker entry points into restricted private implementations with an empty search path and explicit execution grants. A timestamp/UUID index supports discovery pages and an account-bound folder index supports private filters.

## Verification and continuation

```bash
npx vitest run src/features/files
PORTAL_DB_CONTAINER=<owned-test-container> node scripts/files-discovery-db-tests.mjs
```

Before combined M7 acceptance, focused checks passed 18 file component/unit cases, six actual discovery PostgreSQL groups and six generic API-surface groups. The API-surface run found no anonymously executable application functions; this does not claim actual native Auth/REST/browser acceptance. TypeScript, scoped ESLint/format checks and script syntax also passed.

Focused SQL checks use owned temporary UUID databases. They show the old 1,000-row problem and check more than 1,000 accessible metadata records, literal search, complete pagination with equal timestamps and concurrent records, foreign/admin access, private shared-file associations, CAS races, invalid payloads, archiving, revoked permissions and existing suspended token identities. Component checks cover deep links, focus during a pending response, actual cursor forwarding, DE/EN drafts, pending saves, conflicts, offline operation and hiding old data. Existing scan-polling, version and exact-download checks remain.

`scripts/files-discovery-api-check.mjs` reproduces the actual REST row cap with more than 1,000 fictional metadata records and checks the new API with actual Auth accounts. `tests/e2e/file-discovery.spec.ts` adds desktop/mobile, actual pages, a real scanned upload and byte-identical download after organisation, role boundaries, DE/EN, dark mode, offline operation, archive and axe. Authored native API/browser cases are **not** passed runs. The combined checks actually executed are documented in [WORKLOG](WORKLOG.md) and [QA_RESULTS](QA_RESULTS.md).

Independent course/organisation file contexts, hierarchical shared folders, expiring sharing links, restricted archive formats and retention/purge tools remain further master-prompt work. This change creates no external storage, public sharing or new infrastructure.
