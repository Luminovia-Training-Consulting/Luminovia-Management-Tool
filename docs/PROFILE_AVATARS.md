# Profile pictures and their permission boundary

This feature extends the existing real private document/ClamAV pipeline. It does not publish pictures on the internet or make a personal-document bucket readable to peers. Original teaching materials and unrelated local pictures are not imported.

## Data and API

- `profile_avatars` stores one selected immutable `document_versions.id` for each user. Its direct RLS grants only the active owner a read; clients do not directly write selections. The version foreign key is indexed.
- `set_profile_avatar(p_version_id uuid default null)` selects an owned, clean, nonarchived personal document of kind `avatar`, or removes the current selection when passed null. Metadata, bytes and ownership remain separate. Repeating the same selection does not create another audit event. A failed new upload leaves the previous selection unchanged.
- `profile_avatar(p_user_id uuid)` returns only `{version_id, updated_at}` or null for a permitted profile with no available image. It reuses `private.can_read_person`: current staff peers see intentional staff profiles; clients and enrolled learners see only their actual assigned teacher. Existing private contact/evidence/contract/calendar/DM boundaries remain intact. Suspended actors or inaccessible people receive a permission error.
- `POST /functions/v1/files` with JSON `{ "action": "avatar", "user_id": "…" }` uses the caller's actual Auth identity, active account and selected-profile RPC. It retrieves the exact clean version server-side and rechecks current visibility and selection after Storage before returning PNG bytes. Headers include `no-store, private`, `nosniff`, no-referrer and a restrictive content policy. No public/signed URL is produced. Generic `action: download` retains its existing personal-document rules, including for administrators.

## Image safety and privacy

The profile editor accepts PNG/JPEG/WebP input up to 10 MiB, checks encoded dimensions before browser decoding (edge ≤8192 and ≤16 million pixels), centre-crops a square, resizes to at most 512 px and creates a new PNG. Original filenames, EXIF/GPS data, comments and compressed colour-profile metadata are not copied. This is a normal rasterisation step; it is not a promise to remove information visibly present in the image itself.

API callers upload this **canonical PNG** through the normal multipart document endpoint with `scope=personal`, `kind=avatar`, a fresh `client_id` and file field. The stored output is ≤2 MiB, ≤512 px per edge, 8-bit RGB/RGBA, noninterlaced PNG. The server validates PNG signature, CRCs, chunk order, complete bounded zlib scanlines/filter bytes and permits only image data, colour intent and pixel-density chunks. It rejects textual/EXIF/ICC chunks, oversized images, malformed/truncated/trailing data and inflation bombs. Database guards independently enforce personal ownership, canonical MIME and byte-size limits; actual bytes additionally require normal quarantine and a real clean ClamAV result. Original general-file formats and access rules are unchanged.

Replacement selects a new exact clean version. Selecting another image or removing it does not silently delete retained old private document objects; retention/purge remains the documented platform follow-up. Archiving a selected underlying image makes the picture unavailable. Ordinary readers cannot request old avatar versions through the picture action.

## Browser lifecycle and design

The same `Avatar` component appears in the navigation, lecturer directory, lecturer profile and own profile editor. Initials provide a readable branded fallback when no image is selected, retrieval is denied/unavailable, or the browser is offline. Queries include both actor and target identity and are memory-only with zero idle retention. Picture responses are not service-worker cached. Every object URL is revoked on version/identity changes, offline transition or unmount; a late previous-actor response cannot replace the current image. Current metadata is periodically/refocus revalidated, while the gateway authorises every new byte request. Previously viewed pixels cannot be retrospectively erased from another device.

The editor explains centre crop/visibility, offers accessible file-picker/removal controls, reports actual scan/save status and handles invalid images without false success. German/English and light/dark use existing brand tokens. The shell additionally now catches rejected sign-out SDK promises; failures preserve the current workspace/query cache and allow retry, while pending state prevents duplicate submission and success waits for server acknowledgement.

## Executed evidence and acceptance

Incremental checks passed: 10 real disposable PostgreSQL cases; 6 Deno PNG/gateway-boundary tests and the actual files entry-point typecheck; 8 Vitest cases (3 shell logout, 2 source-dimension and 3 Blob-lifecycle/offline cases); targeted ESLint and the complete current TypeScript check. Gateway units explicitly verify replacement/removal or membership revocation during Storage retrieval denies the old response. The PostgreSQL fixtures explicitly do not claim real bytes or Auth; separate actual API and browser suites cover those boundaries.

The following integration suites passed in the canonical guarded `./portal test` project and cannot mutate normal development:

- `scripts/avatars-api-check.mjs` uses the shared actual Auth/MFA fixture/cleanup helper, real PNG/ClamAV/private Storage/hash bytes, invalid-format/metadata/dimensions, generic download/Storage/signed-URL denial, separate client/enrolment visibility/revocation, replacement/removal and suspension.
- `tests/e2e/avatars.spec.ts` uses actual distinct browser identities, real JPEG input containing fictional source metadata, browser crop/resize, scan/save/reload, exact clean PNG/no EXIF, safe invalid-source retention, permitted peer display, removal, English/dark axe/overflow checks and fictional screenshots.

Complete local acceptance is recorded below. Physical-device image picking, browser implementations beyond the tested engine and deployed hosting/security remain separate acceptance gates. See `QA_RESULTS.md` for the exact submitted-revision CI and broader product evidence.

### M4-02 integration checkpoint

The canonical `./portal test` run `6bb8adbe` passed the actual avatar API suite with real Auth/MFA, ClamAV, private Storage/hash/bytes and scoped revocation/cleanup. Both full avatar browser journeys passed: desktop 4.9 seconds and mobile 5.2 seconds, including actual source EXIF, 512 px crop/rasterisation, scan/save/reload, peer visibility, metadata stripping, malformed-source retention, removal and English/dark axe/overflow assertions. Their retained fictional screenshots were visually inspected for readable controls, helper/error text and layout. The blue circle is an intentionally flat-colour image fixture, not an absent picture.

That whole invocation failed two pre-existing global-offline browser cases because the avatar editor unnecessarily repeated the application-wide offline status. The duplicate local notice and unused translation were removed; controls still disable offline and the global connection banner remains the single source for connectivity feedback. A new focused regression and the other avatar/shell source checks passed 8/8. The unchanged actual global-offline browser regression and the complete build/PWA/cleanup gates await the next canonical invocation; no complete passing command is inferred from this partial checkpoint.

### M4-03 final local acceptance

The complete canonical command passed in `.local/tests/0260b044/RESULT.txt`, completed at 2026-11-15T16:43:20.241Z (16 November Australia/Brisbane). It repeated the actual avatar API/SQL/Edge checks and passed both avatar browser journeys: desktop 5.0 seconds and mobile 5.1 seconds. The unchanged global-profile offline regression passed on both layouts at 2.4 seconds each after removing the redundant notice. All 52 application browser workflows, the production build and both built-PWA checks passed, followed by owned-project cleanup. The final desktop profile screenshot was visually reviewed again; the prior mobile review and unchanged avatar layout remain consistent with the passing final mobile assertions.

This establishes the tested local workflow and permission boundaries, not a claim that every production platform or every possible failure has been certified. No further avatar application/test source changed after this accepted snapshot. GitHub integration and release status belong to the root delivery record.

Combined hosting/application acceptance also passed in canonical04 (`4c7c897`,17:31 UTC, exit 0): all new feature SQL/API/desktop/mobile journeys plus the full regression suite. See [QA_RESULTS](QA_RESULTS.md). This is local acceptance; the [M4 hosted migration review](REVIEWED_M4_MIGRATIONS.md) remains a separate gate.
