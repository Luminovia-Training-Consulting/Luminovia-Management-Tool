/**
 * Package tests use owned temporary directories and synthetic public build values. Exercise path boundaries, hashes, secret detection and immutable pins without publishing a release.
 */
import assert from "node:assert/strict";
import {execFileSync, spawn} from "node:child_process";
import {createHash} from "node:crypto";
import fs, {chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync,} from "node:fs";
import {syncBuiltinESMExports} from "node:module";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import test from "node:test";
import {API_URL, createRelease, REPOSITORY} from "./package.mjs";

const commit = "a".repeat(40);
const publicKey = "sb_publishable_" + "ExamplePublicBuildValue".repeat(2);
// Add an immutable synthetic image digest to the fictional repository name for this release fixture.
const image = (repository) => repository + "@sha256:" + "a".repeat(64);
const postgres = image("supabase/postgres:17.12.0.000");
// Compute the digest used for source-bound comparison and verification.
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const pgProofPath = "deploy/hostinger/selfhost/postgres-candidate-proof.json";
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const newRuntimeFiles = [
    "deploy/hostinger/updates/luminovia-update.service",
    "deploy/hostinger/updates/luminovia-update.timer",
    "deploy/hostinger/selfhost/migrate-mail-relay-env.mjs",
    "deploy/hostinger/maintenance/pg_preflight.py",
    "deploy/hostinger/maintenance/atomic_recovery.py",
    "deploy/hostinger/maintenance/configure-os-daily.sh",
    "deploy/hostinger/backups/complete_backup.py",
    "deploy/hostinger/backups/database-summary.sql",
    "deploy/hostinger/backups/extension-recovery.json",
];

// Create controlled owned fixtures with replaceable external responses.
function fixture(t) {
    const root = mkdtempSync(join(tmpdir(), "portal-package-test-"));
    t.after(() => rmSync(root, {recursive: true, force: true}));
    const put = (name, value) => {
        const path = join(root, name);
        mkdirSync(dirname(path), {recursive: true});
        writeFileSync(path, value);
    };
    put(
        "dist/index.html",
        '<html><script type="module" src="/assets/app.js"></script></html>',
    );
    put(
        "dist/assets/app.js",
        "const url=" +
        JSON.stringify(API_URL) +
        ";const key=" +
        JSON.stringify(publicKey) +
        ";",
    );
    put("dist/assets/logo.svg", '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    put(
        "supabase/functions/files/index.ts",
        "Deno.serve(() => new Response('fictional fixture'));",
    );
    put(
        "supabase/functions/files/handler_test.ts",
        "sb_secret_FictionalFixtureMustNeverShip123456789",
    );
    put(
        "supabase/migrations/20261115111133_fixture.sql",
        "begin;\ncreate table public.example(id uuid);\ncommit;\n",
    );
    put("supabase/templates/invite.html", "<html>{{ .TokenHash }}</html>");
    put(
        "supabase/templates/recovery.html",
        "<html>{{ .ConfirmationURL }}</html>",
    );
    put(
        "supabase/templates/authenticator-enrolled.html",
        "<html>Authenticator added</html>",
    );
    put(
        "supabase/templates/authenticator-unenrolled.html",
        "<html>Authenticator removed</html>",
    );
    const services = {
        db: postgres,
        auth: image("supabase/gotrue:v2.197.0"),
        rest: image("postgrest/postgrest:v14.18"),
        realtime: image("supabase/realtime:v2.148.3"),
        storage: image("supabase/storage-api:v1.89.12"),
        functions: image("supabase/edge-runtime:v1.77.9"),
        "mail-relay": image("python:3.13.11-slim-bookworm"),
        "api-gw": image("envoyproxy/envoy:v1.39.6"),
        mailpit: image("public.ecr.aws/supabase/mailpit:v1.31.3"),
    };
    put(
        "deploy/hostinger/selfhost/compose.yml",
        "services:\n" +
        Object.entries(services)
            .map(
                ([service, value]) =>
                    "  " + service + ":\n    image: " + value + "\n",
            )
            .join(""),
    );
    put(
        "deploy/hostinger/compose.yml",
        "services:\n  web:\n    image: " +
        image("caddy:2-alpine") +
        "\n  clamav:\n    image: " +
        image("clamav/clamav") +
        "\n",
    );
    put("deploy/hostinger/Caddyfile", "{$PORTAL_DOMAIN} { file_server }\n");
    put("deploy/hostinger/clamd.conf", "Foreground yes\n");
    put(
        "deploy/hostinger/instance.json",
        JSON.stringify({environment: "development"}),
    );
    put(
        "deploy/hostinger/selfhost/postgres-upgrade-provenance.json",
        JSON.stringify({
            schemaVersion: 1,
            reviewed: true,
            targetImage: postgres,
            candidateRestorePassed: true,
            migrationSourcesExact: true,
            roleAndMembershipExact: true,
            persistentFilesExact: true,
            validation: {helperSelfTestPassed: true},
        }),
    );
    put(
        "deploy/hostinger/selfhost/runtime/index.ts",
        "Deno.serve(() => new Response('router'));",
    );
    put("deploy/hostinger/selfhost/envoy/cds.yaml", "resources: []\n");
    put(
        "deploy/hostinger/supabase/images.lock.json",
        JSON.stringify({images: []}),
    );
    put(
        "deploy/hostinger/supabase/upstream-provenance.json",
        JSON.stringify({commit: "b".repeat(40)}),
    );
    put(
        "deploy/hostinger/supabase/UPSTREAM_LICENSE",
        "Fictional licence test fixture",
    );
    put("deploy/hostinger/supabase/upstream/volumes/functions/deno.jsonc", "{}");
    put("deploy/hostinger/supabase/upstream/volumes/db/roles.sql", "select 1;\n");
    put(
        "deploy/hostinger/supabase/upstream/volumes/api/envoy/docker-entrypoint.sh",
        "#!/bin/sh\nexec envoy\n",
    );
    put("deploy/hostinger/updates/updater.py", "print('fixture updater')\n");
    for (const name of newRuntimeFiles)
        put(name, "# fictional selected runtime fixture\n");
    for (const name of [
        "package.json",
        "package-lock.json",
        "scripts/mail-relay.py",
        "scripts/notification-mail-worker.py",
        "scripts/notification-push-worker.mjs",
        "deploy/hostinger/notification-push/licenses/http_ece-LICENSE.txt",
        ...["notification-mail", "notification-push"].flatMap((kind) => [
            `deploy/hostinger/${kind}/luminovia-${kind}.service`,
            `deploy/hostinger/${kind}/luminovia-${kind}.timer`,
            `deploy/hostinger/${kind}/worker.env.example`,
        ]),
    ])
        put(name, readFileSync(join(repositoryRoot, name)));
    symlinkSync(
        join(repositoryRoot, "node_modules"),
        join(root, "node_modules"),
        "dir",
    );
    for (const name of ["service", "timer"])
        put(
            "deploy/hostinger/backups/luminovia-complete-backup." + name,
            "# fictional backup unit\n",
        );
    for (const name of [
        "maintenance/promote.mjs",
        "maintenance/selfhost-candidate-check.mjs",
        "maintenance/daily-updates.test.mjs",
        "backups/create_recovery_key.py",
        "backups/make_fixture.py",
        "backups/test_complete_backup.py",
        "backups/keys/recovery.pem",
    ])
        put(
            "deploy/hostinger/" + name,
            "sb_secret_FictionalExcludedSourceNeverPackaged123456789",
        );
    // Normal local runtime credentials may exist outside the explicit source set.
    put(".env.local", "JWT_SECRET=FictionalLocalSecretNeverPackaged");
    put(
        ".local/hostinger/ACCOUNTS.txt",
        "Fictional local credentials never packaged",
    );
    const release = (extra = {}) =>
        createRelease({
            sourceRoot: root,
            outputDirectory: join(root, "out"),
            commit,
            publicConfig: {apiUrl: API_URL, publishableKey: publicKey},
            verifyGit: false,
            ...extra,
        });
    return {root, put, release};
}

test("real archive and manifest contain only runtime files with exact byte hashes", (t) => {
    const {root, release} = fixture(t);
    const result = release();
    assert.equal(result.manifest.repository, REPOSITORY);
    assert.equal(result.manifest.branch, "main");
    assert.equal(result.manifest.commit, commit);
    assert.equal(result.manifest.publicBuild.apiUrl, API_URL);
    assert.equal(
        result.manifest.publicBuild.publishableKeySha256,
        digest(publicKey),
    );
    assert.equal(
        result.manifest.archiveSha256,
        digest(readFileSync(result.archivePath)),
    );
    assert.equal(result.manifest.runtime.postgresMajor, 17);
    assert.equal(result.manifest.runtime.images.length, 11);
    assert.equal(result.manifest.runtime.reviewed, true);
    assert.equal(
        result.manifest.runtime.images.find((entry) => entry.service === "clamav")
            .image,
        image("clamav/clamav"),
    );
    const names = execFileSync("tar", ["-tzf", result.archivePath], {
        encoding: "utf8",
    })
        .trim()
        .split("\n");
    assert.deepEqual(
        names.sort(),
        result.manifest.files.map((file) => file.path).sort(),
    );
    assert(
        !names.some(
            (name) =>
                name.includes("handler_test") ||
                (name.includes(".env") &&
                    !/^deploy\/hostinger\/notification-(?:mail|push)\/worker\.env\.example$/.test(
                        name,
                    )) ||
                name.includes("ACCOUNTS"),
        ),
    );
    assert(names.includes("deploy/hostinger/mail-templates/invite.html"));
    assert(
        names.includes("deploy/hostinger/mail-templates/authenticator-enrolled.html"),
    );
    assert(
        names.includes("deploy/hostinger/mail-templates/authenticator-unenrolled.html"),
    );
    for (const name of newRuntimeFiles) assert(names.includes(name));
    assert(
        names.includes(
            "deploy/hostinger/backups/luminovia-complete-backup.service",
        ),
    );
    assert(
        names.includes("deploy/hostinger/backups/luminovia-complete-backup.timer"),
    );
    assert(
        !names.some((name) =>
            /promote|selfhost-candidate-check|daily-updates|create_recovery_key|make_fixture|test_complete|recovery\.pem/.test(
                name,
            ),
        ),
    );
    for (const file of result.manifest.files) {
        const bytes = execFileSync("tar", [
            "-xOzf",
            result.archivePath,
            "--",
            file.path,
        ]);
        assert.equal(bytes.length, file.size);
        assert.equal(digest(bytes), file.sha256);
    }
    const second = createRelease({
        sourceRoot: root,
        outputDirectory: join(root, "second"),
        commit,
        publicConfig: {apiUrl: API_URL, publishableKey: publicKey},
        verifyGit: false,
    });
    assert.equal(second.manifest.archiveSha256, result.manifest.archiveSha256);
    assert.throws(() => release(), /overwrite/);
});

test("competing release packagers retain the successful archive, manifest and checksums", async (t) => {
    const {root} = fixture(t);
    const gate = join(root, "continue-first-packager");
    const script = join(root, "race-packager.mjs");
    // Pause one real process at its staging boundary. On the vulnerable source
    // both callers have passed the output preflight; the other process completes
    // before the paused one resumes. No release/network command is invoked.
    writeFileSync(
        script,
        `import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
const options=JSON.parse(process.argv[2]);
if(process.argv[3]==='pause'){
  const original=fs.mkdtempSync;
  fs.mkdtempSync=(prefix,...args)=>{
    if(String(prefix).includes('luminovia-release-')){
      process.send({ready:true});
      const deadline=Date.now()+15000;
      while(!fs.existsSync(${JSON.stringify(gate)})){
        if(Date.now()>deadline)throw new Error('Owned race gate timed out');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);
      }
    }
    return original(prefix,...args);
  };
  syncBuiltinESMExports();
}
const {createRelease}=await import(${JSON.stringify(pathToFileURL(join(repositoryRoot, "deploy/hostinger/updates/package.mjs")).href)});
try{
  const result=createRelease(options);
  process.stdout.write(JSON.stringify({ok:true,archiveSha256:result.manifest.archiveSha256}));
}catch(error){
  process.stdout.write(JSON.stringify({ok:false,message:error.message}));
}
process.disconnect();
`,
    );
    const options = JSON.stringify({
        sourceRoot: root,
        outputDirectory: join(root, "out"),
        commit,
        publicConfig: {apiUrl: API_URL, publishableKey: publicKey},
        verifyGit: false,
    });
    // These child processes and the gate belong exclusively to this fixture.
    const launch = (pause) => {
        const child = spawn(
            process.execPath,
            [script, options, pause ? "pause" : "run"],
            {
                stdio: ["ignore", "pipe", "pipe", "ipc"],
                timeout: 20000,
            },
        );
        const ready = new Promise((accept, reject) => {
            child.once("message", accept);
            child.once("error", reject);
            child.once("exit", () =>
                reject(new Error("Packager exited before its race gate")),
            );
        });
        // The non-paused process never announces a gate; its rejection is observed.
        ready.catch(() => {
        });
        const chunks = [];
        child.stdout.on("data", (chunk) => chunks.push(chunk));
        const finished = new Promise((accept, reject) => {
            child.once("error", reject);
            child.once("close", (code) => {
                if (code !== 0)
                    return reject(new Error("Owned packager process failed"));
                try {
                    accept(JSON.parse(Buffer.concat(chunks).toString("utf8")));
                } catch (error) {
                    reject(error);
                }
            });
        });
        finished.catch(() => {
        });
        t.after(async () => {
            // A failed assertion/gate still terminates and joins only this owned
            // process; do not leave a child waiting for a deleted fixture gate.
            if (child.exitCode === null && child.signalCode === null)
                child.kill("SIGKILL");
            await finished.catch(() => {
            });
        });
        return {ready, finished};
    };
    const first = launch(true);
    await first.ready;
    const second = launch(false);
    let secondResult;
    try {
        secondResult = await second.finished;
    } finally {
        writeFileSync(gate, "continue");
    }
    const results = [await first.finished, secondResult];
    assert.equal(results.filter((result) => result.ok).length, 1);
    assert.equal(results.filter((result) => !result.ok).length, 1);
    const manifest = JSON.parse(
        readFileSync(join(root, "out/cms-release.json"), "utf8"),
    );
    const archiveHash = digest(
        readFileSync(join(root, "out/cms-release.tar.gz")),
    );
    assert.equal(manifest.archiveSha256, archiveHash);
    assert.equal(results.find((result) => result.ok).archiveSha256, archiveHash);
});

test("safe existing output directories retain unrelated files, permissions and private artifacts", (t) => {
    const {root, release} = fixture(t);
    const output = join(root, "out");
    mkdirSync(output, {mode: 0o755});
    chmodSync(output, 0o755);
    writeFileSync(join(output, "unrelated.keep"), "Fictional unrelated output");
    const result = release();
    assert.equal(lstatSync(output).mode & 0o777, 0o755);
    assert.equal(
        readFileSync(join(output, "unrelated.keep"), "utf8"),
        "Fictional unrelated output",
    );
    assert.equal(lstatSync(result.archivePath).mode & 0o777, 0o600);
    assert.equal(lstatSync(result.manifestPath).mode & 0o777, 0o600);
    assert.equal(lstatSync(result.archivePath).nlink, 1);
    assert.equal(lstatSync(result.manifestPath).nlink, 1);
    assert.deepEqual(readdirSync(output).sort(), [
        "cms-release.json",
        "cms-release.tar.gz",
        "unrelated.keep",
    ]);
});

for (const mode of [0o770, 0o777])
    test(`shared-write output mode ${mode.toString(8)} is rejected without permission changes`, (t) => {
        const {root, release} = fixture(t);
        const output = join(root, "out");
        mkdirSync(output);
        chmodSync(output, mode);
        writeFileSync(join(output, "unrelated.keep"), "Fictional existing output");
        assert.throws(() => release(), /without shared write access/);
        assert.equal(lstatSync(output).mode & 0o777, mode);
        assert.deepEqual(readdirSync(output), ["unrelated.keep"]);
    });

for (const dangling of [false, true])
    test(`output directory ${dangling ? "dangling " : ""}symlinks are never followed`, (t) => {
        const {root, release} = fixture(t);
        const target = join(root, "outside-output");
        if (!dangling) mkdirSync(target, {mode: 0o700});
        symlinkSync(target, join(root, "out"));
        assert.throws(() => release());
        assert(lstatSync(join(root, "out")).isSymbolicLink());
        if (dangling) assert(!existsSync(target));
        else assert.deepEqual(readdirSync(target), []);
    });

for (const name of ["cms-release.tar.gz", "cms-release.json"])
    test(`an existing ${name} symlink and its outside bytes remain untouched`, (t) => {
        const {root, release} = fixture(t);
        const output = join(root, "out");
        mkdirSync(output, {mode: 0o700});
        const outside = join(root, "outside-artifact");
        writeFileSync(outside, "Fictional outside artifact");
        symlinkSync(outside, join(output, name));
        assert.throws(() => release(), /overwrite/);
        assert(lstatSync(join(output, name)).isSymbolicLink());
        assert.equal(readFileSync(outside, "utf8"), "Fictional outside artifact");
        assert.deepEqual(readdirSync(output), [name]);
    });

for (const failure of ["archive digest", "staged manifest write"])
    test(`${failure} failure closes owned descriptors and cleans only private staging`, (t) => {
        const {root, release} = fixture(t);
        const output = join(root, "out");
        const opened = new Set();
        const archives = new Set();
        const originalOpen = fs.openSync;
        const originalClose = fs.closeSync;
        const originalRead = fs.readSync;
        const originalWrite = fs.writeFileSync;
        const fault = new Error("Fictional package I/O failure");
        let failed = false;
        // Track only the output descriptors owned by this call; dependency reads
        // continue unchanged. Faults happen after a real private archive exists.
        t.mock.method(fs, "openSync", (path, ...args) => {
            const descriptor = originalOpen(path, ...args);
            if (
                String(path) === output ||
                String(path).includes("/.luminovia-release-") ||
                String(path).endsWith("/cms-release.tar.gz")
            ) {
                opened.add(descriptor);
                if (String(path).endsWith("/cms-release.tar.gz"))
                    archives.add(descriptor);
            }
            return descriptor;
        });
        t.mock.method(fs, "closeSync", (descriptor) => {
            opened.delete(descriptor);
            archives.delete(descriptor);
            return originalClose(descriptor);
        });
        t.mock.method(fs, "readSync", (descriptor, ...args) => {
            if (failure === "archive digest" && archives.has(descriptor)) {
                failed = true;
                throw fault;
            }
            return originalRead(descriptor, ...args);
        });
        t.mock.method(fs, "writeFileSync", (path, ...args) => {
            if (
                failure === "staged manifest write" &&
                String(path).startsWith(`/proc/${process.pid}/fd/`) &&
                String(path).endsWith("/cms-release.json")
            ) {
                failed = true;
                throw fault;
            }
            return originalWrite(path, ...args);
        });
        syncBuiltinESMExports();
        t.after(() => {
            t.mock.restoreAll();
            syncBuiltinESMExports();
        });
        assert.throws(
            () => release(),
            (error) => error === fault,
        );
        assert.equal(failed, true);
        assert.equal(opened.size, 0);
        assert.deepEqual(readdirSync(output), []);
    });

test("output directory replacement cannot redirect staged writes or failure cleanup", (t) => {
    const {root, release} = fixture(t);
    const output = join(root, "out");
    const moved = join(root, "original-output");
    const sentinel = Buffer.from(
        "Fictional replacement directory must remain unchanged",
    );
    const originalOpen = fs.openSync;
    const originalClose = fs.closeSync;
    const originalStat = fs.fstatSync;
    const originalRead = fs.readSync;
    const opened = new Set();
    const archives = new Set();
    const fault = new Error("Fictional archive read failure after replacement");
    let outputDescriptor;
    let replaced = false;
    t.mock.method(fs, "openSync", (path, ...args) => {
        const descriptor = originalOpen(path, ...args);
        opened.add(descriptor);
        if (String(path) === output) outputDescriptor = descriptor;
        if (String(path).endsWith("/cms-release.tar.gz")) archives.add(descriptor);
        return descriptor;
    });
    t.mock.method(fs, "closeSync", (descriptor) => {
        opened.delete(descriptor);
        archives.delete(descriptor);
        return originalClose(descriptor);
    });
    t.mock.method(fs, "fstatSync", (descriptor, ...args) => {
        const state = originalStat(descriptor, ...args);
        if (descriptor === outputDescriptor && !replaced) {
            replaced = true;
            renameSync(output, moved);
            mkdirSync(output, {mode: 0o700});
            writeFileSync(join(output, "foreign.keep"), sentinel);
        }
        return state;
    });
    t.mock.method(fs, "readSync", (descriptor, ...args) => {
        if (archives.has(descriptor)) throw fault;
        return originalRead(descriptor, ...args);
    });
    syncBuiltinESMExports();
    t.after(() => {
        t.mock.restoreAll();
        syncBuiltinESMExports();
    });
    // Replacing the pathname after the authentic directory check cannot move
    // private generation/cleanup into that replacement, including on failure.
    assert.throws(
        () => release(),
        (error) => error === fault,
    );
    assert.equal(replaced, true);
    assert.equal(opened.size, 0);
    assert.deepEqual(readdirSync(moved), []);
    assert.deepEqual(readdirSync(output), ["foreign.keep"]);
    assert.deepEqual(readFileSync(join(output, "foreign.keep")), sentinel);
});

for (const collision of [
    "archive",
    "manifest",
    "replacement before I/O failure",
])
    test(`late ${collision} never rolls back another writer's final bytes`, (t) => {
        const {root, release} = fixture(t);
        const output = join(root, "out");
        const archive = join(output, "cms-release.tar.gz");
        const manifest = join(output, "cms-release.json");
        const foreign = Buffer.from("Fictional competing writer artifact");
        const originalLink = fs.linkSync;
        let publications = 0;
        // Mutate actual directory entries at the publication boundary. A final
        // path no longer proves ownership, even when this attempt linked it first.
        t.mock.method(fs, "linkSync", (source, destination) => {
            publications++;
            if (publications === 1 && collision === "archive")
                writeFileSync(archive, foreign, {flag: "wx"});
            if (publications === 2) {
                if (collision === "manifest")
                    writeFileSync(manifest, foreign, {flag: "wx"});
                else if (collision === "replacement before I/O failure") {
                    rmSync(archive);
                    writeFileSync(archive, foreign, {flag: "wx"});
                    throw Object.assign(new Error("Fictional publication I/O failure"), {
                        code: "EIO",
                    });
                }
            }
            return originalLink(source, destination);
        });
        syncBuiltinESMExports();
        t.after(() => {
            t.mock.restoreAll();
            syncBuiltinESMExports();
        });
        assert.throws(() => release(), /Inspect the output before retrying/);
        assert.equal(publications, collision === "archive" ? 1 : 2);
        assert.deepEqual(
            readFileSync(collision === "manifest" ? manifest : archive),
            foreign,
        );
        assert(
            !readdirSync(output).some((name) =>
                name.startsWith(".luminovia-release-"),
            ),
        );
        if (collision === "manifest") {
            // A complete but unpaired owned archive is explicit failed output, never
            // a successful release. Retrying preserves both artifacts for inspection.
            assert(execFileSync("tar", ["-tzf", archive]).length > 0);
            assert.throws(() => release(), /overwrite/);
            assert.deepEqual(readFileSync(manifest), foreign);
        } else assert(!existsSync(manifest));
    });

test("a late output-sync failure preserves the complete pair without reporting success", (t) => {
    const {root, release} = fixture(t);
    const originalSync = fs.fsyncSync;
    let failed = false;
    t.mock.method(fs, "fsyncSync", (descriptor) => {
        if (fs.fstatSync(descriptor).isDirectory()) {
            failed = true;
            throw Object.assign(new Error("Fictional output sync failure"), {
                code: "EIO",
            });
        }
        return originalSync(descriptor);
    });
    syncBuiltinESMExports();
    t.after(() => {
        t.mock.restoreAll();
        syncBuiltinESMExports();
    });
    assert.throws(() => release(), /Inspect the output before retrying/);
    assert.equal(failed, true);
    const output = join(root, "out");
    const manifest = JSON.parse(
        readFileSync(join(output, "cms-release.json"), "utf8"),
    );
    assert.equal(
        manifest.archiveSha256,
        digest(readFileSync(join(output, "cms-release.tar.gz"))),
    );
    assert.deepEqual(readdirSync(output).sort(), [
        "cms-release.json",
        "cms-release.tar.gz",
    ]);
    assert.throws(() => release(), /overwrite/);
});

test("real release archive preserves the exact reviewed PDF runtime, font, integrity lock and license assets", (t) => {
    const {put, release} = fixture(t);
    const names = [
        "index.ts",
        "handler.ts",
        "pdf.ts",
        "deno.lock",
        "vendor/pdf-runtime.js",
        "vendor/pdf-runtime.d.ts",
        "assets/DejaVuSans.ttf",
        "assets/LICENSE-DejaVu.txt",
        ...[
            "fontkit",
            "pako",
            "pdf-lib",
            "pdf-lib-standard-fonts",
            "pdf-lib-upng",
            "tslib",
        ].map((name) => `vendor/licenses/${name}-LICENSE.txt`),
    ];
    const expected = new Map();
    for (const name of names) {
        const target = `supabase/functions/course-documents/${name}`;
        const bytes = readFileSync(new URL(`../../../${target}`, import.meta.url));
        expected.set(target, bytes);
        put(target, bytes);
    }
    const result = release();
    for (const [name, bytes] of expected) {
        assert.ok(
            result.manifest.files.some(
                (file) => file.path === name && file.sha256 === digest(bytes),
            ),
        );
        const archived = execFileSync("tar", ["-xOzf", result.archivePath, name], {
            maxBuffer: 4 * 1024 * 1024,
        });
        assert.deepEqual(archived, bytes);
    }
});

test("a wrong backend or browser secret key cannot produce a release", (t) => {
    const {release, root, put} = fixture(t);
    assert.throws(
        () =>
            release({
                publicConfig: {
                    apiUrl: "https://other.example.invalid",
                    publishableKey: publicKey,
                },
            }),
        /public API/,
    );
    assert.throws(
        () =>
            release({
                publicConfig: {
                    apiUrl: API_URL,
                    publishableKey: "sb_secret_FictionalSecretValue123456789",
                },
            }),
        /public API/,
    );
    put("dist/assets/app.js", "const url='https://wrong.example.invalid';");
    assert.throws(() => release(), /public configuration/);
    assert(!existsSync(join(root, "out/cms-release.tar.gz")));
    assert(!existsSync(join(root, "out/cms-release.json")));
});

test("public output and function source reject environment files and path tricks", (t) => {
    for (const [directory, name] of [
        ["dist", ".env"],
        ["supabase/functions", ".env.production"],
        ["supabase/functions", "bad\\path.ts"],
    ]) {
        const child = fixture(t);
        child.put(directory + "/" + name, "fictional unsafe file");
        assert.throws(() => child.release(), /Unsafe release path/);
    }
});

test("source links cannot escape the checkout or alter packaged runtime files", (t) => {
    const {root, release} = fixture(t);
    const outside = join(root, "outside.txt");
    writeFileSync(outside, "fictional outside payload");
    symlinkSync(outside, join(root, "dist/assets/escape.txt"));
    assert.throws(() => release(), /symbolic link/);
});

test("recognizable and explicitly excluded credential values never enter public artifacts", (t) => {
    const jwt =
        Buffer.from(JSON.stringify({alg: "HS256"})).toString("base64url") +
        "." +
        Buffer.from(JSON.stringify({role: "service_role", exp: 1})).toString(
            "base64url",
        ) +
        "." +
        "a".repeat(40);
    for (const payload of [
        "sb_secret_FictionalSecretValue123456789",
        "-----BEGIN PRIVATE KEY-----",
        jwt,
        'POSTGRES_PASSWORD="FictionalDatabasePassword123456"',
    ]) {
        const child = fixture(t);
        child.put("dist/assets/leak.js", payload);
        assert.throws(() => child.release(), /credential|secret-key|service-role/);
        assert(!existsSync(join(child.root, "out/cms-release.tar.gz")));
    }
    const child = fixture(t);
    child.put(
        "dist/assets/leak.js",
        "unrecognizable-but-explicitly-excluded-value",
    );
    assert.throws(
        () =>
            child.release({
                forbiddenValues: ["unrecognizable-but-explicitly-excluded-value"],
            }),
        /private credential/,
    );
});

test("credential scanning covers unquoted and multiline values without rejecting public keys", (t) => {
    // Exercise common operator file forms with fictional values and require a failed scan to leave no archive or manifest.
    for (const payload of [
        "POSTGRES_PASSWORD=FictionalUnquotedDatabasePassword123",
        'JWT_SECRET:\n  "FictionalYamlSecretValue123456789"',
        "-----BEGIN RSA PRIVATE KEY-----\nFictionalPrivateKeyBlock\n-----END RSA PRIVATE KEY-----",
    ]) {
        const child = fixture(t);
        child.put("dist/assets/leak.js", payload);
        assert.throws(() => child.release(), /credential|secret-key/);
        assert.equal(existsSync(join(child.root, "out/cms-release.tar.gz")), false);
        assert.equal(existsSync(join(child.root, "out/cms-release.json")), false);
    }

    // The public browser key is intentionally included in frontend code and must remain an allowed value.
    const child = fixture(t);
    child.put("dist/assets/public-config.js", `export const key = "${publicKey}";`);
    assert.doesNotThrow(() => child.release());
    assert.equal(existsSync(join(child.root, "out/cms-release.tar.gz")), true);
});

test("mutable image tags, different major versions and untested provenance block packaging", (t) => {
    for (const change of ["mutable", "major", "unreviewed", "digest-mismatch"]) {
        const child = fixture(t);
        const path = join(child.root, "deploy/hostinger/selfhost/compose.yml");
        if (change === "mutable")
            writeFileSync(
                path,
                readFileSync(path, "utf8").replace(
                    postgres,
                    "supabase/postgres:latest",
                ),
            );
        if (change === "major")
            writeFileSync(
                path,
                readFileSync(path, "utf8").replace(
                    postgres,
                    image("supabase/postgres:18.0.0.000"),
                ),
            );
        if (change === "unreviewed" || change === "digest-mismatch") {
            const provenance = JSON.parse(
                readFileSync(
                    join(
                        child.root,
                        "deploy/hostinger/selfhost/postgres-upgrade-provenance.json",
                    ),
                    "utf8",
                ),
            );
            if (change === "unreviewed") provenance.candidateRestorePassed = false;
            else provenance.targetImage = image("supabase/postgres:17.11.0.019");
            child.put(
                "deploy/hostinger/selfhost/postgres-upgrade-provenance.json",
                JSON.stringify(provenance),
            );
        }
        assert.throws(
            () => child.release(),
            /immutable|major upgrades|compatibility evidence/,
        );
    }
});

function generatedProof(
    root,
    targetImage = image("supabase/postgres:17.13.0.000"),
) {
    const path = "supabase/migrations/20261115111133_fixture.sql";
    const migrationInventory = [
        {path, sha256: digest(readFileSync(join(root, path)))},
    ];
    return {
        schemaVersion: 1,
        sourceImage: postgres,
        targetImage,
        postgresMajor: 17,
        sourceCommit: "b".repeat(40),
        migrationInventory,
        migrationInventorySha256: digest(JSON.stringify(migrationInventory)),
        validation: {
            kind: "isolated-selfhost-upgrade-fixture",
            passed: true,
            migrationSourcesExact: true,
            existingCredentialsAndFileExact: true,
            roleAndMembershipExact: true,
        },
        requiresLiveDataPreflight: true,
    };
}

function withGeneratedProof(t) {
    const context = fixture(t);
    const proof = generatedProof(context.root);
    const compose = "deploy/hostinger/selfhost/compose.yml";
    context.put(
        compose,
        readFileSync(join(context.root, compose), "utf8").replace(
            postgres,
            proof.targetImage,
        ),
    );
    context.put(pgProofPath, JSON.stringify(proof));
    return {...context, proof};
}

test("fixture-only generated same-major proof can replace historical manual evidence and remains live-gated", (t) => {
    const context = withGeneratedProof(t);
    const historical = readFileSync(
        join(
            context.root,
            "deploy/hostinger/selfhost/postgres-upgrade-provenance.json",
        ),
    );
    const result = context.release();
    assert.equal(result.manifest.runtime.requiresLiveDataPreflight, true);
    assert.equal(result.manifest.runtime.postgresCandidateProof, pgProofPath);
    assert.equal(
        result.manifest.runtime.images.find((entry) => entry.service === "db")
            .image,
        context.proof.targetImage,
    );
    const archived = execFileSync("tar", [
        "-xOzf",
        result.archivePath,
        "--",
        pgProofPath,
    ]);
    assert.deepEqual(JSON.parse(archived), context.proof);
    assert.equal(
        result.manifest.files.find((entry) => entry.path === pgProofPath).sha256,
        digest(archived),
    );
    assert.deepEqual(
        readFileSync(
            join(
                context.root,
                "deploy/hostinger/selfhost/postgres-upgrade-provenance.json",
            ),
        ),
        historical,
        "Historical17.12 evidence must not be rewritten as future acceptance.",
    );
});

test("fictional completed PG proof permits later appended migrations without changing its historical evidence", (t) => {
    const context = withGeneratedProof(t);
    context.put(
        "supabase/migrations/20261116111133_appended_fixture.sql",
        "begin;\ncreate table public.appended_fixture(id uuid);\ncommit;\n",
    );
    const result = context.release();
    assert.equal(result.manifest.migrations.length, 2);
    assert.equal(result.manifest.runtime.requiresLiveDataPreflight, true);
    assert.deepEqual(
        JSON.parse(
            execFileSync("tar", ["-xOzf", result.archivePath, "--", pgProofPath]),
        ),
        context.proof,
        "Appending application migrations must not forge a new image-upgrade proof.",
    );
});

test("incomplete, mismatched or migration-stale generated proofs never produce an artifact", (t) => {
    const variants = [
        (proof) => {
            proof.schemaVersion = 2;
        },
        (proof) => {
            proof.postgresMajor = 18;
        },
        (proof) => {
            proof.sourceCommit = "A".repeat(40);
        },
        (proof) => {
            proof.sourceCommit = "b".repeat(39);
        },
        (proof) => {
            proof.sourceImage = "supabase/postgres:17-latest";
        },
        (proof) => {
            proof.sourceImage = image("supabase/postgres:18.0.0.000");
        },
        (proof) => {
            proof.sourceImage = proof.targetImage;
        },
        (proof) => {
            proof.targetImage = image("supabase/postgres:17.13.0.001");
        },
        (proof) => {
            proof.targetImage = proof.targetImage.slice(0, -1) + "b";
        },
        (proof) => {
            proof.requiresLiveDataPreflight = false;
        },
        (proof) => {
            proof.validation.kind = "fresh-install-only";
        },
        (proof) => {
            proof.validation.passed = false;
        },
        (proof) => {
            proof.validation.migrationSourcesExact = false;
        },
        (proof) => {
            proof.validation.existingCredentialsAndFileExact = false;
        },
        (proof) => {
            proof.validation.roleAndMembershipExact = false;
        },
        (proof) => {
            proof.migrationInventorySha256 = "e".repeat(64);
        },
        (proof) => {
            delete proof.migrationInventory;
        },
        (proof) => {
            proof.migrationInventory = [];
            proof.migrationInventorySha256 = digest("[]");
        },
        (proof) => {
            proof.migrationInventory[0].extra = "unbound metadata";
            proof.migrationInventorySha256 = digest(
                JSON.stringify(proof.migrationInventory),
            );
        },
        (proof) => {
            proof.migrationInventory[0].path = "../private.sql";
            proof.migrationInventorySha256 = digest(
                JSON.stringify(proof.migrationInventory),
            );
        },
    ];
    for (const alter of variants) {
        const context = withGeneratedProof(t);
        alter(context.proof);
        context.put(pgProofPath, JSON.stringify(context.proof));
        assert.throws(() => context.release(), /compatibility evidence/);
        assert(!existsSync(join(context.root, "out/cms-release.tar.gz")));
        assert(!existsSync(join(context.root, "out/cms-release.json")));
    }
    const stale = withGeneratedProof(t);
    stale.put(
        "supabase/migrations/20261115111133_fixture.sql",
        "begin;\ncreate table public.changed(id uuid);\ncommit;\n",
    );
    assert.throws(() => stale.release(), /compatibility evidence/);
    for (const kind of ["delete", "backdate", "reorder"]) {
        const context = withGeneratedProof(t);
        if (kind === "delete")
            rmSync(
                join(context.root, "supabase/migrations/20261115111133_fixture.sql"),
            );
        else if (kind === "backdate")
            context.put(
                "supabase/migrations/20261114111133_backdated_fixture.sql",
                "begin;\nselect 1;\ncommit;\n",
            );
        else {
            const appended = {
                path: "supabase/migrations/20261116111133_appended_fixture.sql",
                sha256: digest("begin;\nselect 1;\ncommit;\n"),
            };
            context.put(appended.path, "begin;\nselect 1;\ncommit;\n");
            context.proof.migrationInventory.unshift(appended);
            context.proof.migrationInventorySha256 = digest(
                JSON.stringify(context.proof.migrationInventory),
            );
            context.put(pgProofPath, JSON.stringify(context.proof));
        }
        assert.throws(
            () => context.release(),
            /compatibility evidence|Invalid migration inventory/,
            kind + " must not preserve a proof of different migration history.",
        );
        assert(!existsSync(join(context.root, "out/cms-release.tar.gz")));
    }
    const manual = fixture(t);
    manual.put(
        pgProofPath,
        JSON.stringify({
            ...generatedProof(manual.root),
            migrationInventorySha256: "e".repeat(64),
        }),
    );
    assert.throws(
        () => manual.release(),
        /compatibility evidence/,
        "An invalid present proof cannot be silently shipped beside valid manual evidence.",
    );
});

test("CLI rejects source-commit mismatch and dirty tracked code without a bypass flag", (t) => {
    const {root, release} = fixture(t);
    execFileSync("git", ["init", "--quiet"], {cwd: root});
    assert.throws(() => release({verifyGit: true}), /Command failed/);
    execFileSync("git", ["add", "."], {cwd: root});
    execFileSync(
        "git",
        [
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.invalid",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "--quiet",
            "-m",
            "Fictional release fixture",
        ],
        {cwd: root},
    );
    assert.throws(() => release({verifyGit: true}), /does not match/);
    const sha = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: root,
        encoding: "utf8",
    }).trim();
    writeFileSync(
        join(root, "supabase/functions/files/index.ts"),
        "changed tracked source",
    );
    assert.throws(
        () => release({verifyGit: true, commit: sha}),
        /uncommitted tracked/,
    );
    execFileSync("git", ["checkout", "--", "supabase/functions/files/index.ts"], {
        cwd: root,
    });
    writeFileSync(
        join(root, "supabase/functions/files/untracked.ts"),
        "untracked runtime payload",
    );
    assert.throws(
        () => release({verifyGit: true, commit: sha}),
        /not tracked by the release/,
    );
});

for (const mutation of ["replacement", "in-place edit"])
    test(`dependency license ${mutation} after metadata checks cannot leak outside bytes`, (t) => {
        const {root, put, release} = fixture(t);
        // Copy only this dependency into the owned fixture. Never alter the installed
        // dependency tree shared with ordinary development or another test process.
        const modules = join(root, "node_modules");
        rmSync(modules);
        mkdirSync(modules);
        for (const name of readdirSync(join(repositoryRoot, "node_modules"))) {
            const target = join(modules, name);
            if (name === "web-push")
                cpSync(join(repositoryRoot, "node_modules", name), target, {
                    recursive: true,
                    dereference: true,
                });
            else symlinkSync(join(repositoryRoot, "node_modules", name), target);
        }
        const license = join(modules, "web-push", "LICENSE");
        const original = readFileSync(license);
        const outside = join(root, "outside-license.txt");
        const outsideText = "Fictional outside content must never enter a release";
        put("outside-license.txt", outsideText);
        let raced = false;
        const replace = () => {
            if (raced) return;
            raced = true;
            if (mutation === "replacement") {
                rmSync(license);
                symlinkSync(outside, license);
            } else writeFileSync(license, outsideText);
        };
        const stat = fs.lstatSync,
            descriptorStat = fs.fstatSync,
            open = fs.openSync,
            close = fs.closeSync;
        const licenseDescriptors = new Set();
        let pathChecks = 0;
        // Deterministically race both the old path-check implementation and the
        // descriptor implementation at its first authenticated metadata observation.
        t.mock.method(fs, "lstatSync", (path, ...args) => {
            const result = stat(path, ...args);
            if (String(path) === license && ++pathChecks === 2) replace();
            return result;
        });
        t.mock.method(fs, "openSync", (path, ...args) => {
            const descriptor = open(path, ...args);
            if (String(path) === license) licenseDescriptors.add(descriptor);
            return descriptor;
        });
        t.mock.method(fs, "fstatSync", (descriptor, ...args) => {
            const result = descriptorStat(descriptor, ...args);
            if (licenseDescriptors.has(descriptor)) replace();
            return result;
        });
        t.mock.method(fs, "closeSync", (descriptor) => {
            licenseDescriptors.delete(descriptor);
            return close(descriptor);
        });
        syncBuiltinESMExports();
        t.after(() => {
            t.mock.restoreAll();
            syncBuiltinESMExports();
        });
        let result;
        try {
            result = release();
        } catch (error) {
            assert.equal(raced, true, "The real file replacement must have occurred");
            assert.match(error.message, /Worker input changed while reading/);
            assert.equal(
                licenseDescriptors.size,
                0,
                "Failed reads must close their descriptor",
            );
            assert.ok(!existsSync(join(root, "out/cms-release.tar.gz")));
            assert.ok(!existsSync(join(root, "out/cms-release.json")));
            return;
        }
        assert.equal(raced, true, "The real file replacement must have occurred");
        assert.equal(
            licenseDescriptors.size,
            0,
            "Successful reads must close their descriptor",
        );
        const bytes = execFileSync("tar", [
            "-xOzf",
            result.archivePath,
            "--",
            "deploy/hostinger/notification-push/licenses/web-push-LICENSE",
        ]);
        assert.deepEqual(bytes, original);
        assert.ok(!bytes.includes(Buffer.from(outsideText)));
    });

test("packaged finite workers run outside node_modules and retain actual AES/VAPID/provider contract", (t) => {
    const {root, release} = fixture(t);
    const result = release();
    const isolated = mkdtempSync(join(tmpdir(), "luminovia-standalone-worker-"));
    t.after(() => rmSync(isolated, {recursive: true, force: true}));
    const extract = (name) =>
        execFileSync("tar", ["-xOzf", result.archivePath, "--", name], {
            maxBuffer: 8 * 1024 * 1024,
        });
    const bundle = join(isolated, "worker.mjs"),
        python = join(isolated, "worker.py"),
        relay = join(isolated, "mail-relay.py");
    writeFileSync(
        bundle,
        extract("deploy/hostinger/notification-push/worker.mjs"),
    );
    writeFileSync(
        python,
        extract("deploy/hostinger/notification-mail/worker.py"),
    );
    writeFileSync(relay, extract("scripts/mail-relay.py"));
    assert.deepEqual(
        readFileSync(python),
        readFileSync(join(root, "scripts/notification-mail-worker.py")),
    );
    assert.deepEqual(readFileSync(relay), readFileSync(join(root, "scripts/mail-relay.py")));
    const provenance = JSON.parse(
        extract("deploy/hostinger/notification-push/provenance.json"),
    );
    assert.equal(provenance.bundleSha256, digest(readFileSync(bundle)));
    assert.equal(provenance.proxySupport, false);
    assert.ok(
        provenance.dependencies.some(
            (item) => item.name === "web-push" && item.version === "4.0.0",
        ),
    );
    assert.ok(
        provenance.dependencies.every(
            (item) => item.integrity.startsWith("sha512-") && item.modules.length > 0,
        ),
    );
    for (const item of provenance.sources)
        assert.equal(item.sha256, digest(readFileSync(join(root, item.path))));
    const names = result.manifest.files.map((item) => item.path);
    assert.ok(
        names.some((name) => name.endsWith("licenses/http_ece-LICENSE.txt")),
    );
    assert.ok(names.some((name) => name.includes("web-push-LICENSE")));
    assert.ok(
        !names.some(
            (name) =>
                name.includes("node_modules") ||
                (name.startsWith("site/") && name.includes("notification-push")),
        ),
    );
    assert.equal(
        JSON.parse(
            execFileSync(process.execPath, [bundle], {
                cwd: isolated,
                encoding: "utf8",
            }),
        ).network_calls,
        0,
    );
    assert.equal(
        JSON.parse(
            execFileSync("python3", [python], {cwd: isolated, encoding: "utf8"}),
        ).network_calls,
        0,
    );
    const childEnvironment = {
        ...process.env,
        PORTAL_PUSH_TEST_BUNDLE_URL: pathToFileURL(bundle).href,
    };
    delete childEnvironment.NODE_TEST_CONTEXT;
    const checked = execFileSync(
        process.execPath,
        ["--test", join(repositoryRoot, "scripts/runtime-web-push.test.mjs")],
        {
            cwd: repositoryRoot,
            encoding: "utf8",
            env: childEnvironment,
            timeout: 60000,
            maxBuffer: 1024 * 1024,
        },
    );
    assert.match(checked, /tests 8/);
    assert.match(checked, /fail 0/);
});

test("worker lock mismatch, missing license and unexpected local import fail closed", (t) => {
    for (const defect of ["lock", "license", "import"]) {
        const child = fixture(t);
        if (defect === "lock") {
            const lock = JSON.parse(
                readFileSync(join(child.root, "package-lock.json")),
            );
            lock.packages["node_modules/web-push"].version = "0.0.0";
            child.put("package-lock.json", JSON.stringify(lock));
        }
        if (defect === "license")
            child.put(
                "deploy/hostinger/notification-push/licenses/http_ece-LICENSE.txt",
                "Wrong license source",
            );
        if (defect === "import") {
            child.put(
                "scripts/unreviewed-helper.mjs",
                "console.log('unreviewed helper');",
            );
            child.put(
                "scripts/notification-push-worker.mjs",
                readFileSync(
                    join(repositoryRoot, "scripts/notification-push-worker.mjs"),
                    "utf8",
                ) + "\nimport './unreviewed-helper.mjs';\n",
            );
        }
        assert.throws(
            () => child.release(),
            /lock version|license source differs|Unexpected worker source module/,
        );
        assert.equal(existsSync(join(child.root, "out/cms-release.tar.gz")), false);
    }
});

test("known short mailbox secrets are excluded from mapped worker artifacts", (t) => {
    const child = fixture(t);
    const password = "Fiction-1234";
    child.put(
        "scripts/notification-mail-worker.py",
        `# exact known fixture value ${password}\n`,
    );
    assert.throws(
        () => child.release({forbiddenValues: [password]}),
        /private credential/,
    );
    assert.equal(existsSync(join(child.root, "out/cms-release.tar.gz")), false);
});
