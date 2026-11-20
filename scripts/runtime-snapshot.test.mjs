/**
 * Filesystem fixtures exercise nested secrets, generated state and symlink aliases.
 * Only permitted source files may enter the actual copied QA snapshot.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync,} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join, relative} from "node:path";
import {runtimeSnapshotSource} from "./runtime-snapshot.mjs";

/** Creates separate temporary source/snapshot directories and registers cleanup with the test context. */
function fixture(t) {
    const directory = mkdtempSync(join(tmpdir(), "portal-snapshot-test-"));
    t.after(() => rmSync(directory, {recursive: true, force: true}));
    const source = join(directory, "source"),
        output = join(directory, "snapshot");
    mkdirSync(source);
    /** Creates one targeted file inside the owned snapshot fixture. */
    const put = (name, value) => {
        const path = join(source, name);
        mkdirSync(dirname(path), {recursive: true});
        writeFileSync(path, value);
    };
    /** Runs the actual recursive copy with the production snapshot filter. */
    const copy = () =>
        cpSync(source, output, {
            recursive: true,
            filter: (path) => runtimeSnapshotSource(path, source),
        });
    return {directory, source, output, put, copy};
}

/** Collects the resulting file inventory for comparison with the expected snapshot. */
function files(directory) {
    return readdirSync(directory, {withFileTypes: true}).flatMap((entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? files(path) : [path];
    });
}

test("actual QA copy omits nested private/env/generated state while retaining source and nested example templates", (t) => {
    const f = fixture(t),
        privateValue = "FICTIONAL_PRIVATE_VALUE_MUST_NOT_ENTER_QA";
    const retained = [
        "src/main.ts",
        "supabase/migrations/20261115120000_example.sql",
        ".env.example",
        "deploy/hostinger/.env.example",
        "deploy/hostinger/selfhost/.env.example",
        "deploy/hostinger/compose.yml",
    ];
    for (const name of retained)
        f.put(name, "Fictional public source/template " + name);
    for (const name of [
        ".env.local",
        "src/nested/.env.production",
        "deploy/hostinger/.env",
        "deploy/hostinger/private/credentials.txt",
        "deploy/hostinger/selfhost/private/selfhost.env",
        "deploy/hostinger/site/index.html",
        "deploy/hostinger/selfhost/selfhost.env",
        "src/nested/.local/state.txt",
        "nested/node_modules/package/index.js",
        "nested/dist/bundle.js",
        "supabase/.temp/project-ref",
        "supabase/.branches/state",
        "nested/tsconfig.tsbuildinfo",
        "deploy/hostinger/updates/__pycache__/updater.pyc",
    ])
        f.put(name, privateValue);
    f.copy();
    const delivered = files(f.output);
    assert.deepEqual(
        delivered.map((path) => relative(f.output, path)).sort(),
        retained.sort(),
    );
    assert(
        delivered.every(
            (path) => !readFileSync(path, "utf8").includes(privateValue),
        ),
    );
});
test("snapshot rejects symlink aliases and paths outside its source root", (t) => {
    const f = fixture(t),
        outside = join(f.directory, "outside-private.env");
    writeFileSync(outside, "FICTIONAL_OUTSIDE_PRIVATE_VALUE");
    f.put("src/main.ts", "Fictional legitimate source");
    symlinkSync(outside, join(f.source, "src/looks-public.ts"));
    assert.equal(runtimeSnapshotSource(outside, f.source), false);
    f.copy();
    const delivered = files(f.output);
    assert.deepEqual(
        delivered.map((path) => relative(f.output, path)),
        ["src/main.ts"],
    );
    assert(
        !readFileSync(delivered[0], "utf8").includes(
            "FICTIONAL_OUTSIDE_PRIVATE_VALUE",
        ),
    );
});