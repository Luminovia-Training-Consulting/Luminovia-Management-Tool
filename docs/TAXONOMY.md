# Shared topic and tool catalogue

The catalogue at `/topics` connects the same topic identifiers to profile expertise, course templates and job requirements. The three kinds are topic, tool and programming language; spoken profile languages remain a separate field. Entries have German and English labels and descriptions, up to 20 search aliases and an optional parent. Related course templates appear only when the current account may actually read them; links open the existing template details.

Active authenticated accounts can search and read. Search covers both labels and aliases, treats search characters literally and returns at most 500 entries. The interface waits 200 ms after text input and aborts superseded requests. Actor-bound query keys prevent reuse of another account's catalogue cache. The unfiltered list and parent selector share the same request.

## Management and history

`taxonomy.manage` is assigned to the existing `owner`, `admin` and `management` roles. Changes require this current database permission and verified MFA (`aal2`). Browser roles and editable Auth metadata do not authorise access. Even an MFA administrator receives no direct write grants on `topics`.

Creation and editing use the complete form data. Changes and archive transitions check the observed version number; stale edits cannot overwrite newer information. The form draft remains visible on conflict. The explicit **Reload current version** action reloads data and closes the draft; the current version can then be opened. An error or pending request is never displayed as a successful save.

A short global write lock on the small catalogue prevents two apparently valid concurrent parent moves from jointly creating a cycle. Self-references and descendants as parents are rejected. The migration validates existing hierarchies and aborts atomically for legacy cycles; it does not rewrite historical relationships.

Archiving preserves the identifier, existing course/job links and existing expertise with verification status and expiry. Active children must be archived first. New associations of an archived entry are blocked at the database boundary for profile expertise, course templates and jobs. Restoration requires an active parent. Archiving is not a confidentiality level: existing references may continue displaying their label.

## API and checks

Public functions are invoker-only entry points into restricted private functions with an empty search path and explicit execution grants:

- `taxonomy_catalogue(p_search, p_kind, p_include_archived)` returns catalogue entries and permitted course templates. Archived search results require management permission.
- `save_taxonomy_topic(p_id, p_payload, p_version)` creates with `p_id = null` and version `0`, or updates an observed active version.
- `set_taxonomy_topic_archived(p_id, p_archived, p_version)` archives or restores an observed version.

Sources are in `src/features/taxonomy/` and the additive migration `20261115203718_taxonomy_catalogue_management.sql`. Existing migrations are not replaced. The meaning and scope of database permissions are documented in [ARCHITECTURE](ARCHITECTURE.md).

Focused checks:

```bash
npx vitest run src/features/taxonomy
PORTAL_DB_CONTAINER=supabase_db_luminovia-portal-test-m6 node scripts/taxonomy-db-tests.mjs
```

The SQL check creates and removes only its own temporary databases inside the local test container. Ten actual PostgreSQL groups cover MFA/roles, structured validation, literal search, opposing concurrent parent changes, course/participant access and revocation, legacy qualifications, stale versions, all three archived-association boundaries and atomic refusal of an invalid legacy hierarchy. An actually failing test found the original UPDATE name-resolution defect; acceptance checks passed only after its correction.

`scripts/taxonomy-api-check.mjs` adds actual Auth, TOTP and REST checks in the explicitly isolated combined project. `tests/e2e/taxonomy.spec.ts` contains real desktop/mobile journeys covering DE/EN draft preservation, archive/restore, a read-only account, offline operation and axe. These checks must run only through the isolated complete command. An authored browser/API test alone is not a passed run; actual acceptance status is in [QA_RESULTS](QA_RESULTS.md).
