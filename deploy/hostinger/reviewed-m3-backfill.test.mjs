/**
 * Check the bounded historical backfill against real versioned SQL. Wrong history/source must not create a general migration bypass.
 */
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import fs, {chmod, mkdir, mkdtemp, readdir, readFile, rename, rm, symlink, truncate, writeFile,} from "node:fs/promises";
import {syncBuiltinESMExports} from "node:module";
import {tmpdir} from "node:os";
import {resolve} from "node:path";
import test from "node:test";
import {backupRoot, databaseImage, fileDigest, repository} from "./backup.mjs";
import {applyReviewedBackfill, buildBackfillSQL, loadReviewedSources, reviewedMigrations,} from "./reviewed-m3-backfill.mjs";
import {inspectBackup, restoreCheck} from "./restore-check.mjs";

// Build the exact historical state for the successful or deliberately corrupted plan case.
async function history() {
    const files = await readdir(resolve(repository, "supabase/migrations"));
    return Promise.all(
        files
            // This helper is a reviewed one-off for the original 11-entry baseline,
            // not the complete migration history of every future application version.
            .filter(
                (file) =>
                    /^\d{14}_[a-z0-9_]+\.sql$/.test(file) &&
                    file.slice(0, 14) <= "20261115142130" &&
                    !reviewedMigrations.some((item) => item.file === file),
            )
            .map(async (file) => ({
                version: file.slice(0, 14),
                source: await readFile(
                    resolve(repository, "supabase/migrations", file),
                    "utf8",
                ),
            })),
    );
}

test("only exact reviewed source bytes can form the single atomic backfill", async () => {
    const sources = await loadReviewedSources();
    const sql = buildBackfillSQL(sources, await history());
    assert(sql.startsWith("BEGIN;\nSET LOCAL lock_timeout="));
    assert(sql.endsWith("COMMIT;\n"));
    for (const item of sources)
        assert(
            sql.includes(
                "$reviewed_m3_" +
                item.version +
                "$" +
                item.source +
                "$reviewed_m3_" +
                item.version +
                "$",
            ),
        );
    assert(
        sql.indexOf("cms_m3_preserved") <
        sql.indexOf("alter table public.user_roles"),
    );
    assert(
        sql.indexOf("Reviewed backfill changed existing protected data") >
        sql.indexOf("create function public.complete_account_invitation"),
    );
    assert.throws(
        () =>
            buildBackfillSQL(
                [{...sources[0], source: sources[0].source + "\n"}],
                [],
            ),
        /exact reviewed/,
    );
});
test("changed file hash is refused before database access", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "luminovia-reviewed-m3-"));
    try {
        await mkdir(resolve(root, "supabase/migrations"), {recursive: true});
        const item = reviewedMigrations[0];
        await writeFile(
            resolve(root, "supabase/migrations", item.file),
            "BEGIN; SELECT 'changed'; COMMIT;\n",
        );
        await assert.rejects(loadReviewedSources(root), /source hash differs/);
    } finally {
        await rm(root, {recursive: true, force: true});
    }
});

test("reviewed migration input refuses a link to an exact pinned source", async (t) => {
    const root = await mkdtemp(resolve(tmpdir(), "luminovia-reviewed-m3-"));
    t.after(() => rm(root, {recursive: true, force: true}));
    const directory = resolve(root, "supabase/migrations");
    await mkdir(directory, {recursive: true});
    const {file} = reviewedMigrations[0];
    await symlink(
        resolve(repository, "supabase/migrations", file),
        resolve(directory, file),
    );
    await assert.rejects(loadReviewedSources(root), {code: "ELOOP"});
});

test("historical restore inspects the opened private manifest if its path is replaced", async (t) => {
    await mkdir(backupRoot, {recursive: true, mode: 0o700});
    const directory = await mkdtemp(resolve(backupRoot, "restore-input-"));
    t.after(() => rm(directory, {recursive: true, force: true}));
    const manifest = {
        format: "luminovia-development-backup-v1",
        status: "complete",
        source: {image: databaseImage},
        summary: {server_version: "17.6"},
        objects: {files: 0, bytes: 0},
        artifacts: {},
    };
    for (const name of ["database.dump", "roles.sql", "storage.tar", "objects.jsonl"]) {
        const artifact = resolve(directory, name);
        await writeFile(artifact, "", {mode: 0o600});
        manifest.artifacts[name] = await fileDigest(artifact);
    }
    const path = resolve(directory, "manifest.json");
    await writeFile(path, JSON.stringify(manifest), {mode: 0o600});
    await chmod(path, 0o644);
    const unsafe = /Backup manifest is unsafe|bounded regular file/;
    await assert.rejects(inspectBackup(directory), unsafe);
    await chmod(path, 0o600);
    await truncate(path, 4 * 1024 * 1024 + 1);
    await assert.rejects(inspectBackup(directory), unsafe);
    await writeFile(path, JSON.stringify(manifest));

    let replaced = false;
    const replace = async (candidate) => {
        if (candidate !== path || replaced) return;
        replaced = true;
        await rename(path, resolve(directory, "original-manifest.json"));
        await writeFile(path, '{"status":"incomplete"}', {mode: 0o600});
    };
    const originalOpen = fs.open;
    const originalStat = fs.lstat;
    t.mock.method(fs, "open", async (candidate, ...args) => {
        const handle = await originalOpen(candidate, ...args);
        await replace(candidate);
        return handle;
    });
    t.mock.method(fs, "lstat", async (candidate, ...args) => {
        const value = await originalStat(candidate, ...args);
        await replace(candidate);
        return value;
    });
    syncBuiltinESMExports();
    try {
        assert.deepEqual((await inspectBackup(directory)).manifest, manifest);
        assert.equal(replaced, true);
    } finally {
        t.mock.restoreAll();
        syncBuiltinESMExports();
    }
});

test("restore refuses malformed or unsafe manifests before creating a destination", async (t) => {
    await mkdir(backupRoot, {recursive: true, mode: 0o700});
    const directory = await mkdtemp(resolve(backupRoot, "restore-manifest-cases-"));
    t.after(() => rm(directory, {recursive: true, force: true}));
    const manifest = {
        format: "luminovia-development-backup-v1",
        status: "complete",
        source: {image: databaseImage},
        summary: {server_version: "17.6"},
        objects: {files: 0, bytes: 0},
        artifacts: {},
    };
    for (const name of ["database.dump", "roles.sql", "storage.tar", "objects.jsonl"]) {
        const artifact = resolve(directory, name);
        await writeFile(artifact, "", {mode: 0o600});
        manifest.artifacts[name] = await fileDigest(artifact);
    }
    const path = resolve(directory, "manifest.json");
    const writeManifest = () => writeFile(path, JSON.stringify(manifest), {mode: 0o600});
    await writeManifest();

    // Each invalid input must stop in inspectBackup, before restoreCheck allocates its extraction destination.
    const rejectsBeforeDestination = async () => {
        await assert.rejects(restoreCheck(directory));
        assert.deepEqual(
            (await readdir(directory)).filter((name) => name.startsWith("restore-")),
            [],
        );
    };

    await writeFile(path, "{", {mode: 0o600});
    await rejectsBeforeDestination();
    delete manifest.objects;
    await writeManifest();
    await rejectsBeforeDestination();
    manifest.objects = {files: 0, bytes: 0};
    manifest.artifacts["../../outside"] = {sha256: "0".repeat(64), bytes: 0};
    await writeManifest();
    await rejectsBeforeDestination();
    delete manifest.artifacts["../../outside"];
    manifest.format = "unsupported-backup-v99";
    await writeManifest();
    await rejectsBeforeDestination();
    manifest.format = "luminovia-development-backup-v1";
    manifest.artifacts["database.dump"].bytes++;
    await writeManifest();
    await rejectsBeforeDestination();
    manifest.artifacts["database.dump"].bytes--;
    manifest.artifacts["database.dump"].sha256 = "f".repeat(64);
    await writeManifest();
    await rejectsBeforeDestination();

    const inventory = resolve(directory, "objects.jsonl");
    await writeFile(
        inventory,
        JSON.stringify({path: "../outside", sha256: "0".repeat(64), bytes: 0}),
        {mode: 0o600},
    );
    manifest.objects = {files: 1, bytes: 0};
    manifest.artifacts["database.dump"].sha256 = (await fileDigest(
        resolve(directory, "database.dump"),
    )).sha256;
    manifest.artifacts["objects.jsonl"] = await fileDigest(inventory);
    await writeManifest();
    await rejectsBeforeDestination();

    // A malicious archive can still have a matching manifest hash, so reject its member path before extraction starts.
    const archive = resolve(directory, "storage.tar");
    execFileSync(
        "python3",
        [
            "-c",
            "import sys,tarfile; t=tarfile.open(sys.argv[1],'w'); i=tarfile.TarInfo('../outside'); i.size=0; t.addfile(i); t.close()",
            archive,
        ],
        {stdio: "ignore"},
    );
    await writeFile(inventory, "", {mode: 0o600});
    manifest.objects = {files: 0, bytes: 0};
    manifest.artifacts["objects.jsonl"] = await fileDigest(inventory);
    manifest.artifacts["storage.tar"] = await fileDigest(archive);
    await writeManifest();
    await rejectsBeforeDestination();
});

test("unexpected, missing and partial history cannot execute a migration", async () => {
    const baseline = await history();
    const sources = await loadReviewedSources();
    for (const rows of [
        baseline.slice(1),
        [...baseline, {version: "20990101000000", source: "unreviewed"}],
        [...baseline, sources[0]],
    ]) {
        let calls = 0;
        await assert.rejects(
            applyReviewedBackfill(async () => {
                calls++;
                return JSON.stringify(rows);
            }),
        );
        assert.equal(calls, 1);
    }
});

test("already applied exact history is checked without SQL mutation", async () => {
    const rows = [...(await history()), ...(await loadReviewedSources())];
    let calls = 0;
    const result = await applyReviewedBackfill(async () => {
        calls++;
        return JSON.stringify(rows);
    });
    assert.deepEqual(result, {status: "already_applied", migrations: 14});
    assert.equal(calls, 1);
});

test("later M4 history does not broaden the original operator-only backfill", async () => {
    const future = (await readdir(resolve(repository, "supabase/migrations")))
        .filter(
            (file) =>
                /^\d{14}_[a-z0-9_]+\.sql$/.test(file) &&
                file.slice(0, 14) > "20261115142130",
        )
        .sort()[0];
    assert(
        future,
        "This transition test needs the delivered M4 migration history.",
    );
    const rows = [
        ...(await history()),
        ...(await loadReviewedSources()),
        {
            version: future.slice(0, 14),
            source: await readFile(
                resolve(repository, "supabase/migrations", future),
                "utf8",
            ),
        },
    ];
    let calls = 0;
    await assert.rejects(
        applyReviewedBackfill(async () => {
            calls++;
            return JSON.stringify(rows);
        }),
        /Unexpected migration outside reviewed development baseline/,
    );
    assert.equal(
        calls,
        1,
        "A newer schema permits only inspection, never backfill mutation.",
    );
});

test("CLI refuses missing development flag before reaching SSH", () => {
    assert.throws(
        () =>
            execFileSync(
                process.execPath,
                [resolve(repository, "deploy/hostinger/reviewed-m3-backfill.mjs")],
                {stdio: "pipe"},
            ),
        (error) => error.status === 1 && !String(error.stderr).includes("password"),
    );
});
