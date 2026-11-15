# M4 development migration review

This is a read-only operator handoff for the existing CMS **development** instance. It does not approve production, change the ordinary updater, apply SQL, reset data or broaden the one-off M3 backfill. The exact merged application still needs its canonical tests and immutable tested-main release verification.

## Why the automatic gate remains closed

The existing updater accepts ordinary additive forward SQL, but deliberately stops on constraint removal and top-level procedural/data changes. Local checks against the actual M4 source returned:

| Version / source                                  | SHA-256                                                            | Ordinary update policy                                                                                                   |
| ------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `20261115154942_profile_avatar_selection.sql`     | `90f09db02e06ce7e2445e63c65130e557f78d4552992afcb7ca9178c0623b197` | Review required: replace the document-kind check to add avatars; every previous kind remains allowed.                    |
| `20261115155038_resource_comments.sql`            | `476f360ad3bf9c3674bb4daae78766492b626c95f5b1cf161b649f5c1036d9ac` | Eligible forward comment tables/functions/policy DDL. Include it in the same complete M4 review.                         |
| `20261115155208_cbw_building_block_templates.sql` | `2bede4f4375b2c0d3a5840e462ad159a143757d041d229d6521f3ffc8305c3f1` | Review required: bounded catalogue `DO` block inserts 22 templates/blocks and 24 source versions, then links new blocks. |

New trigger/provenance DDL is compatible. All three versions follow the installed capacity migration (`20261115142130`); this is a forward **14→17** transition. Automatic installation nevertheless remains ineligible because two source files need operator review. Do not hide these operations inside a function or weaken the ordinary SQL classifier to make the gate pass.

## Read-only verifier

`deploy/hostinger/reviewed-m4-plan.mjs` pins the exact 14 historical migrations and these three M4 sources. It accepts only complete exact 14-entry starting history or complete exact 17-entry history. Missing, changed, duplicate, partial and extra future history is refused. Unknown source files within the reviewed version range are refused; later M5 files do not redefine this historical review, and cannot enter its release/history inventory.

It also compares the release's complete 17-entry migration inventory and all current non-test Edge runtime helpers with the checked-out sources. The archive's own authentication, immutable tag/current-main identity, successful CI, byte hashes and public configuration must still pass the existing updater verification. This tool is **not** another migration engine, archive authenticator or installer, and has no apply mode.

An authorised operator can export only migration source history with this read-only SQL, retaining the resulting JSON in a private location:

```sql
select coalesce(jsonb_agg(jsonb_build_object(
  'version', version, 'source', statements[1]
) order by version), '[]'::jsonb)
from supabase_migrations.schema_migrations;
```

Then run locally against the checked-out, tested release source and its already verified manifest:

```bash
node deploy/hostinger/reviewed-m4-plan.mjs \
  --history /private/exported-migration-history.json \
  --manifest /private/verified-cms-release.json
```

The result lists exact files/hashes, the two review reasons and `operator_review_required` or `already_applied`. It never contacts the CMS, reads credentials, calls SSH/Docker or executes SQL. There is no `--apply`/`--once` flag. A positive review plan does not silently authorise installation.

## Concrete operator checklist

1. Establish the exact tested main commit, immutable release identity and matching archive/manifest through the existing release controls. Keep the 14-entry source-history export and review output with the release record.
2. Review the three pinned sources together, including the avatar allowlist replacement and insert-only/idempotent catalogue import. Confirm the intended 22 blocks, 24 source versions and the old-row preservation evidence below. A different hash requires a new review.
3. Before any separately authorised application, use the existing maintenance/writer-stop procedure and verified backup of database **and actual Storage objects**, with private recovery files and rollback ownership. The verifier supplies no hosted apply or automatic bypass; do not use the strict M3 backfill for M4.
4. After an approved operation, establish exact 17-entry source history, unchanged existing account IDs/roles/private records/custom quotas, valid existing files and the new scanned-avatar, CBW course/job and comment journeys. Run actual Auth/MFA/API/revocation checks on that instance. On failure retain maintenance/recovery state; do not downgrade history or clear the failure marker blindly.

Native Auth password/MFA and Storage object recovery must be checked by the actual backup/restore procedure; source-schema rehearsal is not a substitute. No operator operation in this checklist was performed by this work.

## Local evidence

- Pure verifier: **8/8 Node tests passed**, including exact pinned history/source, changed or extra inventory rejection, missing avatar helper, future-history refusal, unchanged ordinary updater classification and rejection of apply-style CLI flags.
- Historical M3 helper: **6/6 Node tests passed** after correcting its fixture to the original 11/14-entry scope. Actual later M4 history remains refused after one inspection, with no mutation. Its policy is unchanged.
- Packaging contract: a real temporary React build using a fictional public-only key produced a hash-checked archive with **100 files**, all **10** non-test Edge TypeScript helpers, **17 migrations**, all **24 source hashes** and **22 blocks**. Temporary outputs were removed; this was not a real published release or hosted-key build.
- Other local release controls passed: **28 Python updater cases**, **7 package cases**, **11 actual isolated Envoy routes** and **10 actual Caddy HTTP cases**, followed by owned-resource cleanup.
- `scripts/m4-preservation-db-tests.mjs` passed **4 real PostgreSQL checks** in a unique temporary database: the exact 14-entry baseline; deliberately changed prior data causing atomic rollback of all three M4 migrations; successful exact 14→17 application preserving all old column values/rows/IDs, role flags/memberships and custom quotas; and recognition of completed history without another apply operation.

The preservation fixture includes four fictional Auth id/email rows, existing profiles/labels/roles, an edited course and its customer, accepted fee/contract metadata, invoice/payment and exact document-version metadata, a private event, prior enrolment/review and custom 11 GiB/2 GiB quotas. Only 22 new templates and their new source/block rows are added. It uses Auth stubs and no stored binary objects: it does **not** prove native password hashes, MFA secrets, live user data or physical Storage preservation. The helper's optional `migrationsThrough` ceiling is strictly 14 digits; normal test callers still replay all migrations by default.

The complete combined canonical result remains in [QA_RESULTS](QA_RESULTS.md) and [WORKLOG](WORKLOG.md). Hosted M4 rollout remains subject to this explicit review; the automatic gate was not weakened.
