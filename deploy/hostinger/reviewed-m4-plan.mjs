/**
 * Read-only planner for the reviewed M4 transition. Bind existing history, new migration source and release inventory into a reviewable digest without mutating a server.
 */
/** Bounded, read-only M4 operator-review plan. This file never runs SQL, SSH,
 * Docker or an updater and is not an automatic migration-policy exception. */
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readdir, readFile} from "node:fs/promises";
import {dirname, relative, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {reviewedMigrations as m3} from "./reviewed-m3-backfill.mjs";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
// Compute the digest used for source-bound comparison and verification.
const digest = (value) => createHash("sha256").update(value).digest("hex");
// Normalize an expected migration file and its SHA-256 for source comparison.
const migration = ([file, sha256]) => ({
    file,
    version: file.slice(0, 14),
    sha256,
});
export const m4Baseline = Object.freeze(
    [
        [
            "20261115111133_portal_foundation.sql",
            "87e1d51438813fb91b0f8741a6ee64922f284d44a5a1361fca5fd47f21b0758b",
        ],
        [
            "20261115112053_lecturer_invitations.sql",
            "04c821240f9e196c965c9874891730632c904638b997f27b20fc8137215a98ff",
        ],
        [
            "20261115113559_lecturer_verification_and_suspension.sql",
            "49a47c1cc9434272d73877545f2bf17a805d4ee30bb5285aa34291fa1be6ccaf",
        ],
        [
            "20261115121732_private_documents.sql",
            "e3cd51d257cca9dff87bcc60a0e615a801e06574e465480c1a220f501403e336",
        ],
        [
            "20261115121922_secure_chat_collaboration.sql",
            "2cdfeb50366edb5b70900a39fdf99aaba18fcd2c5c6e5207454fd221ff572b07",
        ],
        [
            "20261115123659_document_chat_attachment_authorization.sql",
            "38187a64face1393156edab52747113c0a4a7bc5128afdb5039b942858427c31",
        ],
        [
            "20261115123853_wiki_forum_knowledge.sql",
            "5a6c7fa75fb2b752447996df4ad7a73abe7ec8b0d1c91b2281824fc1d4d78891",
        ],
        [
            "20261115125144_customer_course_operations.sql",
            "8b72679c6bd390e7ce41c77609e7e832238cee84dd1c21c157339c19cb9c4c4f",
        ],
        [
            "20261115125912_contracts_finance_tracking.sql",
            "0a6db0d8b056b7c6c89a89de96e832a87dc2d680bbf90f17d92b3806f34ede24",
        ],
        [
            "20261115132410_document_reservation_retry_quota.sql",
            "238466847e37a71c37dfd796295dde75506bad513628a072fae2ab51935bbe08",
        ],
        [
            "20261115142130_document_storage_capacity.sql",
            "e679b74a32858fb9e6d638e890282cba6c59858098f19f4df90ba8c5c7ef9dbe",
        ],
    ]
        .map(migration)
        .concat(m3.map(({file, version, sha256}) => ({file, version, sha256})))
        .sort((a, b) => a.version.localeCompare(b.version)),
);

export const reviewedM4 = Object.freeze([
    {
        ...migration([
            "20261115154942_profile_avatar_selection.sql",
            "90f09db02e06ce7e2445e63c65130e557f78d4552992afcb7ca9178c0623b197",
        ]),
        automaticEligible: false,
        reviewReason:
            "ALTER TABLE replaces the documents kind CHECK to add avatar while preserving every previous kind; the ordinary updater intentionally rejects DROP CONSTRAINT.",
    },
    {
        ...migration([
            "20261115155038_resource_comments.sql",
            "476f360ad3bf9c3674bb4daae78766492b626c95f5b1cf161b649f5c1036d9ac",
        ]),
        automaticEligible: true,
        reviewReason:
            "New comment tables, guarded functions and a policy change use currently eligible forward DDL; include this file in the same reviewed M4 transition.",
    },
    {
        ...migration([
            "20261115155208_cbw_building_block_templates.sql",
            "2bede4f4375b2c0d3a5840e462ad159a143757d041d229d6521f3ffc8305c3f1",
        ]),
        automaticEligible: false,
        reviewReason:
            "A bounded DO block inserts 22 curriculum/template rows and 24 source references idempotently and links new block rows to templates; the ordinary updater intentionally requires review for top-level DO/data writes.",
    },
]);

// Load versioned M4 source and verify every fixed provenance hash.
export async function loadM4ReviewContext(root = repository) {
    const expected = [...m4Baseline, ...reviewedM4];
    const directory = resolve(root, "supabase/migrations");
    const files = (await readdir(directory))
        .filter(
            (name) =>
                /^\d{14}_[a-z0-9_]+\.sql$/.test(name) &&
                name.slice(0, 14) <= reviewedM4.at(-1).version,
        )
        .sort();
    assert.deepEqual(
        files,
        expected.map(({file}) => file).sort(),
        "M4 review requires exactly the pinned 14+3 source files.",
    );
    const sources = [];
    for (const entry of expected) {
        const source = await readFile(resolve(directory, entry.file), "utf8");
        assert.equal(
            digest(source),
            entry.sha256,
            "Pinned migration source hash differs: " + entry.file,
        );
        sources.push(Object.freeze({...entry, source}));
    }
    const runtime = [];

    async function workers(path) {
        for (const entry of await readdir(path, {withFileTypes: true})) {
            const file = resolve(path, entry.name);
            if (entry.isDirectory()) await workers(file);
            else if (entry.name.endsWith(".ts") && !entry.name.endsWith("_test.ts"))
                runtime.push({
                    path: relative(root, file).split("\\").join("/"),
                    sha256: digest(await readFile(file)),
                });
        }
    }

    await workers(resolve(root, "supabase/functions"));
    return Object.freeze({
        baseline: sources.slice(0, 14),
        pending: sources.slice(14),
        runtime,
    });
}

// Reject changed, missing or unexpected historical migration source.
export function validateM4History(history, context) {
    assert(Array.isArray(history), "Expected exported migration history array.");
    assert(
        history.length === 14 || history.length === 17,
        "Only the complete 14-entry baseline or exact 17-entry completed M4 history is reviewable; partial/extra history is refused.",
    );
    const expected =
        history.length === 14
            ? context.baseline
            : [...context.baseline, ...context.pending];
    const byVersion = new Map();
    for (const entry of history) {
        assert(
            entry &&
            typeof entry.version === "string" &&
            typeof entry.source === "string" &&
            Object.keys(entry).every((key) => ["version", "source"].includes(key)),
            "Malformed history row.",
        );
        assert(!byVersion.has(entry.version), "Duplicate migration history.");
        byVersion.set(entry.version, entry.source);
    }
    for (const entry of expected)
        assert.equal(
            byVersion.get(entry.version),
            entry.source,
            "History is missing or differs from exact reviewed source: " +
            entry.version,
        );
    assert(
        context.pending.every(
            (entry) => entry.version > context.baseline.at(-1).version,
        ),
        "M4 must be a strictly forward transition.",
    );
    return history.length === 17;
}

// Bind confirmed baseline history and release inventory into a verifiable transition plan.
export function createM4ReviewPlan({history, manifest}, context) {
    const completed = validateM4History(history, context);
    assert(
        manifest?.schemaVersion === 1 &&
        manifest.repository ===
        "Luminovia-Training-Consulting/Luminovia-Management-Tool" &&
        manifest.branch === "main" &&
        /^[a-f0-9]{40}$/.test(manifest.commit),
        "Expected exact tested-main release identity.",
    );
    assert(
        Array.isArray(manifest.files) && Array.isArray(manifest.migrations),
        "Expected release file and migration inventories.",
    );
    const sources = [...context.baseline, ...context.pending],
        files = new Map();
    for (const item of manifest.files) {
        assert(
            item && typeof item.path === "string" && !files.has(item.path),
            "Invalid/duplicate release file inventory.",
        );
        files.set(item.path, item);
    }
    assert.equal(
        manifest.migrations.length,
        17,
        "Release must contain exactly the reviewed 14+3 migration history.",
    );
    const migrationMap = new Map(
        manifest.migrations.map((item) => [item.version, item]),
    );
    assert.equal(migrationMap.size, 17, "Duplicate release migrations.");
    for (const source of sources) {
        const path = "supabase/migrations/" + source.file,
            entry = migrationMap.get(source.version);
        assert(
            entry?.path === path &&
            entry.sha256 === source.sha256 &&
            files.get(path)?.sha256 === source.sha256,
            "Release migration is missing or differs from reviewed source: " +
            source.version,
        );
    }
    for (const runtime of context.runtime)
        assert.equal(
            files.get(runtime.path)?.sha256,
            runtime.sha256,
            "Release runtime helper missing or changed: " + runtime.path,
        );
    return {
        format: "luminovia-m4-read-only-review-plan-v1",
        status: completed ? "already_applied" : "operator_review_required",
        commit: manifest.commit,
        baselineCount: 14,
        resultCount: 17,
        automaticPolicyChanged: false,
        automaticInstallationEligible: false,
        pending: completed
            ? []
            : context.pending.map(
                ({file, version, sha256, automaticEligible, reviewReason}) => ({
                    file,
                    version,
                    sha256,
                    automaticEligible,
                    reviewReason,
                }),
            ),
        reviewedRuntimeHelpers: context.runtime.length,
        archiveAuthentication:
            "Existing immutable-release/CI/archive verification remains required; this plan does not authorize or execute an update.",
    };
}

if (
    process.argv[1] &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
    try {
        const flags = {},
            args = process.argv.slice(2);
        assert(args.length % 2 === 0, "Arguments need explicit values.");
        for (let i = 0; i < args.length; i += 2) {
            assert(
                ["--history", "--manifest", "--source-root"].includes(args[i]) &&
                !flags[args[i]],
                "Only read-only history/manifest/source-root options are allowed.",
            );
            flags[args[i]] = args[i + 1];
        }
        assert(
            flags["--history"] && flags["--manifest"],
            "Provide --history and --manifest; this verifier never applies migrations.",
        );
        const context = await loadM4ReviewContext(
            flags["--source-root"] ?? repository,
        );
        console.log(
            JSON.stringify(
                createM4ReviewPlan(
                    {
                        history: JSON.parse(await readFile(flags["--history"], "utf8")),
                        manifest: JSON.parse(await readFile(flags["--manifest"], "utf8")),
                    },
                    context,
                ),
                null,
                2,
            ),
        );
    } catch {
        console.error(
            "M4 review refused: verify exact14/17 history, pinned source and release inventories. This command never applies SQL.",
        );
        process.exitCode = 1;
    }
}