/**
 * Restore drill in an owned temporary PostgreSQL instance. Check dumps, roles, object bytes and migration history without reusing normal volumes or the running development stack.
 */
import assert from "node:assert/strict";
import {randomBytes, randomUUID} from "node:crypto";
import {constants, createReadStream, createWriteStream} from "node:fs";
import {chmod, lstat, mkdir, open, readdir, readFile, realpath, rename, rm, statfs, writeFile,} from "node:fs/promises";
import {dirname, resolve} from "node:path";
import {pipeline} from "node:stream/promises";
import {setTimeout as delay} from "node:timers/promises";
import {pathToFileURL} from "node:url";
import {backupRoot, collectCommand, databaseImage, fileDigest, inventoryTotals, repository, reviewedDatabaseImages, startCommand, summarySQL,} from "./backup.mjs";
import {validateRecoveryImageWitness} from "./backups/postgres_recovery_witness.mjs";

const originalDatabaseImage =
    "supabase/postgres:17.6.1.136@sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00";
export const candidateDatabaseImage =
    "supabase/postgres:17.12.0.000@sha256:8630950b489ecc70563300180287a98c192a4a48f5ae00b4febdaeea1abe85de";
const approvedDatabaseImages = reviewedDatabaseImages;

// Allow only an explicitly reviewed recovery image or valid source-bound proof for a later image.
export function checkedDatabaseImage(image, {recoveryEvidence} = {}) {
    if (!approvedDatabaseImages.has(image) && !recoveryEvidence)
        throw new Error(
            "PostgreSQL recovery accepts only explicitly reviewed immutable images.",
        );
    if (!approvedDatabaseImages.has(image))
        validateRecoveryImageWitness(image, recoveryEvidence);
    return image;
}

const label = "org.luminovia.portal.restore-validation";
const protectedTables = [
    "profiles",
    "jobs",
    "job_claims",
    "assignment_sessions",
    "personal_events",
    "documents",
    "document_versions",
    "messages",
    "contracts",
    "invoices",
    "notifications",
];

// The image supplies the exact production PostgreSQL binaries/extensions, but
// its application/bootstrap scripts are deliberately not executed. The fresh,
// networkless cluster receives only the backup roles and database archive.
const initialize = `set -eu
mkdir -p "$PGDATA" /etc/postgresql-custom /var/run/postgresql
chown postgres:postgres "$PGDATA" /etc/postgresql-custom /var/run/postgresql
chmod 0700 "$PGDATA"
printf '%s\n' "$POSTGRES_PASSWORD" > /tmp/restore-password
chown postgres:postgres /tmp/restore-password
chmod 0600 /tmp/restore-password
if command -v gosu >/dev/null 2>&1; then drop_privileges=gosu
elif command -v su-exec >/dev/null 2>&1; then drop_privileges=su-exec
else exit 1; fi
"$drop_privileges" postgres initdb -D "$PGDATA" -U supabase_admin --locale-provider=icu --icu-locale=en-US --auth-local=trust --auth-host=scram-sha-256 --pwfile=/tmp/restore-password >/dev/null 2>&1
rm /tmp/restore-password
exec "$drop_privileges" postgres postgres -D "$PGDATA" -c config_file=/etc/postgresql/postgresql.conf -c data_directory="$PGDATA" -c hba_file="$PGDATA/pg_hba.conf" -c ident_file="$PGDATA/pg_ident.conf" -c listen_addresses= -c shared_buffers=64MB -c max_connections=20 -c log_min_messages=fatal -c log_min_error_statement=fatal -c log_statement=none
`;

// Create an owned temporary database instance with resource limits and an ownership label.
export async function createIsolatedDatabase(
    image = databaseImage,
    options = {},
) {
    checkedDatabaseImage(image, options);
    const ownership = randomUUID();
    const operator = "portal_restore_" + ownership.replaceAll("-", "");
    const name = "portal-restore-" + ownership;
    const volume = "portal_restore_" + ownership.replaceAll("-", "");
    let createdVolume = false;
    let createdContainer = false;
    const cleanup = async () => {
        const failures = [];
        if (createdContainer) {
            try {
                const current = JSON.parse(
                    await collectCommand("docker", [
                        "inspect",
                        "--format",
                        "{{json .Config.Labels}}",
                        name,
                    ]),
                );
                assert.equal(current[label], ownership);
                await collectCommand("docker", ["rm", "--force", name]);
                createdContainer = false;
            } catch {
                failures.push("container");
            }
        }
        if (createdVolume) {
            try {
                const current = JSON.parse(
                    await collectCommand("docker", [
                        "volume",
                        "inspect",
                        "--format",
                        "{{json .Labels}}",
                        volume,
                    ]),
                );
                assert.equal(current[label], ownership);
                await collectCommand("docker", ["volume", "rm", volume]);
                createdVolume = false;
            } catch {
                failures.push("volume");
            }
        }
        if (failures.length)
            throw new Error(
                "Owned restore cleanup failed; unrelated resources were not targeted.",
            );
    };
    try {
        await collectCommand("docker", ["image", "inspect", image]);
        await collectCommand("docker", [
            "volume",
            "create",
            "--label",
            `${label}=${ownership}`,
            volume,
        ]);
        createdVolume = true;
        await collectCommand(
            "docker",
            [
                "create",
                "--name",
                name,
                "--label",
                `${label}=${ownership}`,
                "--network",
                "none",
                "--log-driver",
                "none",
                "--memory",
                "768m",
                "--pids-limit",
                "128",
                "--security-opt",
                "no-new-privileges:true",
                "--env",
                "POSTGRES_PASSWORD",
                "--env",
                "PORTAL_RESTORE_OPERATOR=" + operator,
                "--env",
                "PGDATA=/var/lib/postgresql/restore",
                "--mount",
                `type=volume,src=${volume},dst=/var/lib/postgresql/restore`,
                "--entrypoint",
                "/bin/sh",
                image,
                "-ec",
                initialize,
            ],
            {
                environment: {
                    ...process.env,
                    POSTGRES_PASSWORD: randomBytes(32).toString("base64url"),
                },
            },
        );
        createdContainer = true;
        await collectCommand("docker", ["start", name]);
        let ready = false;
        for (let attempt = 0; attempt < 90; attempt++) {
            try {
                const value = await collectCommand("docker", [
                    "exec",
                    name,
                    "psql",
                    "-U",
                    "supabase_admin",
                    "-d",
                    "postgres",
                    "-X",
                    "-qAt",
                    "-c",
                    "select 1",
                ]);
                if (value === "1") {
                    ready = true;
                    break;
                }
            } catch {
                /* Initialization is still pending; no private logs are emitted. */
            }
            await delay(500);
        }
        if (!ready)
            throw new Error("Isolated restore PostgreSQL did not become ready.");
        await collectCommand("docker", [
            "exec",
            name,
            "psql",
            "-U",
            "supabase_admin",
            "-d",
            "postgres",
            "-X",
            "-qAt",
            "-v",
            "ON_ERROR_STOP=1",
            "-c",
            "create role " + operator + " with login superuser",
        ]);
        const settings = JSON.parse(
            await collectCommand("docker", [
                "inspect",
                "--format",
                "{{json .HostConfig}}",
                name,
            ]),
        );
        assert.equal(settings.NetworkMode, "none");
        assert(
            !settings.PortBindings || !Object.keys(settings.PortBindings).length,
        );
        const sql = (input, errorFile) =>
            collectCommand(
                "docker",
                [
                    "exec",
                    "-i",
                    name,
                    "psql",
                    "-U",
                    operator,
                    "-d",
                    "postgres",
                    "-X",
                    "-qAt",
                    "-v",
                    "ON_ERROR_STOP=1",
                ],
                {input, errorFile},
            );
        return {name, operator, sql, cleanup};
    } catch (error) {
        await cleanup();
        throw error;
    }
}

// Stream an artifact to the owned container and require both sides to complete successfully.
export async function streamIntoContainer(name, command, file, errorFile) {
    const child = (await import("node:child_process")).spawn(
        "docker",
        ["exec", "-i", name, ...command],
        {stdio: ["pipe", "ignore", "pipe"]},
    );
    const privateErrors = [];
    let stderrBytes = 0;
    child.stderr.on("data", (chunk) => {
        stderrBytes += chunk.length;
        if (stderrBytes <= 1024 * 1024) privateErrors.push(chunk);
    });
    const completed = new Promise((accept, reject) => {
        child.once("error", () =>
            reject(new Error("Restore process could not start.")),
        );
        child.once("close", async (code) => {
            if (code === 0) accept();
            else {
                if (errorFile)
                    await writeFile(errorFile, Buffer.concat(privateErrors), {
                        mode: 0o600,
                        flag: "wx",
                    }).catch(() => {
                    });
                reject(
                    new Error(
                        "Database restore rejected its archive; private output withheld.",
                    ),
                );
            }
        });
    });
    completed.catch(() => {
    });
    try {
        await pipeline(createReadStream(file), child.stdin);
        await completed;
    } catch {
        child.kill();
        await completed.catch(() => {
        });
        throw new Error(
            "Database restore stream failed; no running system was targeted.",
        );
    }
}

const extractPython = `import hashlib,json,os,pathlib,sqlite3,sys,tarfile
os.umask(0o077)
archive,inventory,destination=sys.argv[1:]
root=pathlib.Path(destination)
try:
 root.mkdir(mode=0o700)
 db=sqlite3.connect(str(root.parent/'object-verification.sqlite'))
 db.execute('create table expected(path text primary key,sha text not null,size integer not null,restored integer not null default 0)')
 count=0;size=0
 with open(inventory,encoding='utf8') as source:
  for line in source:
   row=json.loads(line);path=pathlib.PurePosixPath(row['path'])
   if path.is_absolute() or '..' in path.parts or not path.parts or str(path)=='.':raise ValueError()
   if len(row['sha256'])!=64 or any(c not in 'abcdef0123456789' for c in row['sha256']) or not isinstance(row['bytes'],int) or row['bytes']<0:raise ValueError()
   db.execute('insert into expected(path,sha,size) values(?,?,?)',(str(path),row['sha256'],row['bytes']))
   count+=1;size+=row['bytes']
 db.commit()
 with tarfile.open(archive,'r|') as tar:
  for member in tar:
   path=pathlib.PurePosixPath(member.name)
   if path.is_absolute() or '..' in path.parts:raise ValueError()
   if str(path)=='.':
    if not member.isdir():raise ValueError()
    continue
   target=root.joinpath(*path.parts)
   if member.isdir():target.mkdir(mode=0o700,parents=True,exist_ok=True);continue
   if not member.isfile():raise ValueError()
   expected=db.execute('select sha,size,restored from expected where path=?',(str(path),)).fetchone()
   if not expected or expected[2] or member.size!=expected[1]:raise ValueError()
   target.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
   fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
   h=hashlib.sha256();written=0
   with os.fdopen(fd,'wb') as output,tar.extractfile(member) as source:
    while True:
     chunk=source.read(1024*1024)
     if not chunk:break
     output.write(chunk);h.update(chunk);written+=len(chunk)
   if h.hexdigest()!=expected[0] or written!=expected[1]:raise ValueError()
   db.execute('update expected set restored=1 where path=?',(str(path),))
 if db.execute('select count(*) from expected where restored=0').fetchone()[0]:raise ValueError()
 db.close()
 print(json.dumps({'files':count,'bytes':size}))
except Exception:
 sys.stderr.write('Storage restore validation failed; private paths withheld.\\n');sys.exit(1)
`;

/** Read and validate the same file descriptor. Do not follow leaf symlinks or wait for FIFO writers. */
export async function readBoundedOperatorFile(
    path,
    maxBytes,
    {requirePrivate = false} = {},
) {
    if (
        !Number.isInteger(constants.O_NOFOLLOW) ||
        !Number.isInteger(constants.O_NONBLOCK)
    )
        throw new Error("Secure operator input descriptor flags are unavailable.");
    const file = await open(
        path,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
        const before = await file.stat({bigint: true});
        if (
            !before.isFile() ||
            before.size > BigInt(maxBytes) ||
            (requirePrivate && (before.mode & 0o077n) !== 0n)
        )
            throw new Error("Unsafe operator input, expected a bounded regular file.");
        const bytes = Buffer.alloc(Number(before.size));
        let position = 0;
        while (position < bytes.length) {
            const {bytesRead} = await file.read(
                bytes,
                position,
                bytes.length - position,
                position,
            );
            if (!bytesRead) throw new Error("Operator input changed while reading.");
            position += bytesRead;
        }
        const after = await file.stat({bigint: true});
        if (
            after.size !== before.size ||
            after.mtimeNs !== before.mtimeNs ||
            after.ctimeNs !== before.ctimeNs
        )
            throw new Error("Operator input changed while reading.");
        return bytes;
    } finally {
        await file.close();
    }
}

async function readBackupManifest(directory) {
    const bytes = await readBoundedOperatorFile(
        resolve(directory, "manifest.json"),
        4 * 1024 * 1024,
        {requirePrivate: true},
    );
    return JSON.parse(bytes.toString("utf8"));
}

// Verify manifest, artifact sizes and checksums before restoring.
export async function inspectBackup(directory) {
    const actual = await realpath(directory);
    const expectedRoot = await realpath(backupRoot);
    if (dirname(actual) !== expectedRoot)
        throw new Error(
            "Restore accepts only a direct child of the ignored backup directory.",
        );
    const state = await lstat(actual);
    if (!state.isDirectory() || state.isSymbolicLink() || state.mode & 0o077)
        throw new Error("Backup directory permissions are unsafe.");
    const manifest = await readBackupManifest(actual);
    if (
        manifest.format !== "luminovia-development-backup-v1" ||
        manifest.status !== "complete" ||
        !approvedDatabaseImages.has(manifest.source.image)
    )
        throw new Error("Unsupported or incomplete backup.");
    for (const name of [
        "database.dump",
        "roles.sql",
        "storage.tar",
        "objects.jsonl",
    ]) {
        const state = await lstat(resolve(actual, name));
        if (!state.isFile() || state.isSymbolicLink() || state.mode & 0o077)
            throw new Error("Backup artifact permissions are unsafe.");
        assert.deepEqual(
            await fileDigest(resolve(actual, name)),
            manifest.artifacts[name],
            "Backup checksum mismatch.",
        );
    }
    assert.deepEqual(
        await inventoryTotals(resolve(actual, "objects.jsonl")),
        manifest.objects,
    );
    return {actual, manifest};
}

// Restore the verified backup only into isolation and compare database, role and Storage inventories.
export async function restoreCheck(directory, {candidateImage} = {}) {
    if (candidateImage !== undefined && candidateImage !== candidateDatabaseImage)
        throw new Error("Unreviewed PostgreSQL upgrade candidate.");
    const {actual, manifest} = await inspectBackup(directory);
    const image = checkedDatabaseImage(candidateImage ?? manifest.source.image);
    const upgrading = image !== manifest.source.image;
    if (
        upgrading &&
        (manifest.source.image !== originalDatabaseImage ||
            image !== candidateDatabaseImage)
    )
        throw new Error("Unsupported PostgreSQL upgrade path.");
    const free = await statfs(actual);
    if (free.bavail * free.bsize < manifest.objects.bytes + 1024 * 1024 * 1024)
        throw new Error(
            "Insufficient local disk for an isolated Storage restore check.",
        );
    const temporary = resolve(actual, "restore-" + randomUUID() + ".partial");
    await mkdir(temporary, {mode: 0o700});
    let database;
    let failure = false;
    let result;
    let stage = "storage-bytes";
    const diagnostic = resolve(
        actual,
        "restore-error-" + randomUUID() + ".stderr",
    );
    try {
        const objects = JSON.parse(
            await collectCommand("python3", [
                "-c",
                extractPython,
                resolve(actual, "storage.tar"),
                resolve(actual, "objects.jsonl"),
                resolve(temporary, "objects"),
            ]),
        );
        assert.deepEqual(objects, manifest.objects);
        stage = "isolated-database-start";
        database = await createIsolatedDatabase(image);
        const roles = await readFile(resolve(actual, "roles.sql"), "utf8");
        if (roles.length > 4 * 1024 * 1024)
            throw new Error("Role definitions exceeded their safe bound.");
        // Keep supabase_admin as bootstrap OID10, matching the pinned source image:
        // PostgreSQL17 GRANTED BY treats that
        // identity specially even when its current attribute is NOSUPERUSER.
        // Execute through a separate temporary superuser so exact source ALTER
        // attributes cannot downgrade the account still performing recovery.
        stage = "role-restore";
        await database.sql(
            roles.replace(/^CREATE ROLE supabase_admin;\r?$/m, ""),
            diagnostic,
        );
        stage = "database-archive";
        await streamIntoContainer(
            database.name,
            [
                "pg_restore",
                "-U",
                database.operator,
                "-d",
                "postgres",
                "--exit-on-error",
                "--single-transaction",
                "--clean",
                "--if-exists",
            ],
            resolve(actual, "database.dump"),
            diagnostic,
        );
        stage = "restored-summary";
        const restored = JSON.parse(await database.sql(summarySQL));
        const collation = JSON.parse(
            await database.sql(
                "select json_build_object('provider',datlocprovider,'locale',to_jsonb(d)->>'datlocale','storedVersion',datcollversion,'actualVersion',pg_database_collation_actual_version(oid))::text from pg_database d where datname=current_database();",
            ),
        );
        assert.equal(collation.provider, "i");
        assert.equal(collation.locale, "en-US");
        assert.equal(collation.storedVersion, collation.actualVersion);
        const restoredRoles = await collectCommand("docker", [
            "exec",
            database.name,
            "pg_dumpall",
            "-U",
            database.operator,
            "--roles-only",
            "--no-role-passwords",
        ]);
        const normalizeRoles = (source, exclude) =>
            source
                .split("\n")
                .map((line) => line.trim())
                .filter(
                    (line) =>
                        line &&
                        !line.startsWith("--") &&
                        !line.startsWith("\\") &&
                        !(
                            exclude &&
                            (line === "CREATE ROLE " + exclude + ";" ||
                                line.startsWith("ALTER ROLE " + exclude + " "))
                        ),
                )
                .sort();
        assert.deepEqual(
            normalizeRoles(restoredRoles, database.operator),
            normalizeRoles(roles),
            "Restored source role attributes, membership grantors or ADMIN/INHERIT/SET options differ.",
        );
        const comparable = structuredClone(restored);
        const expected = structuredClone(manifest.summary);
        if (upgrading) {
            assert.equal(restored.server_version, approvedDatabaseImages.get(image));
            assert.equal(
                manifest.summary.server_version,
                approvedDatabaseImages.get(manifest.source.image),
            );
            delete comparable.server_version;
            delete expected.server_version;
            const history = JSON.parse(
                await database.sql(
                    "select json_agg(json_build_object('version',version,'source',statements[1]) order by version)::text from supabase_migrations.schema_migrations;",
                ),
            );
            const migrationDirectory = resolve(repository, "supabase/migrations");
            const migrationFiles = await readdir(migrationDirectory);
            for (const applied of history) {
                assert.match(applied.version, /^\d{14}$/);
                const file = migrationFiles.find(
                    (name) =>
                        name.startsWith(applied.version + "_") && name.endsWith(".sql"),
                );
                assert(
                    file,
                    "Applied migration source is missing from the reviewed repository.",
                );
                assert.equal(
                    applied.source,
                    await readFile(resolve(migrationDirectory, file), "utf8"),
                    "Restored migration source differs from the reviewed repository.",
                );
            }
        }
        assert.deepEqual(
            comparable,
            expected,
            "Restored counts, migration history, policy state or allocation differ.",
        );
        for (const table of protectedTables)
            assert.equal(
                restored.rls[table],
                true,
                "Restored application RLS is disabled.",
            );
        assert(restored.migrations.length > 0, "Migration history is missing.");
        for (const value of Object.values(restored.protection))
            assert.equal(value, true, "A restored permission boundary is missing.");
        result = {
            status: "passed",
            checkedAt: new Date().toISOString(),
            image,
            sourceImage: manifest.source.image,
            sourcePostgresVersion: manifest.summary.server_version,
            restoredPostgresVersion: restored.server_version,
            upgradeCandidate: upgrading,
            restoredCollation: collation,
            method:
                "isolated local reviewed-image PostgreSQL restore; no network/host ports; every Storage file verified byte-for-byte against source SHA256 inventory",
            migrations: restored.migrations.length,
            sourceRolesAndMembershipsExact: true,
            migrationSourcesExact: upgrading ? true : undefined,
            objects,
            limitations: [
                "No Auth/Storage HTTP services or frontend were started against this restored copy.",
                "Logical restore rebuilds indexes; an in-place image upgrade must separately reindex all affected databases and refresh collation versions when ICU changes.",
                "Runtime secrets, role passwords and Vault encryption keys require their separate secure recovery source.",
                "This development restore does not establish production recovery time or future 100GB restore capacity.",
            ],
        };
        const resultFile = resolve(
            actual,
            (upgrading ? "postgres-upgrade-result-" : "restore-result-") +
            randomUUID() +
            ".json",
        );
        await writeFile(resultFile, JSON.stringify(result, null, 2) + "\n", {
            mode: 0o600,
            flag: "wx",
        });
        await rename(
            resultFile,
            resolve(
                actual,
                upgrading ? "postgres-upgrade-result.json" : "restore-result.json",
            ),
        );
    } catch (error) {
        failure = true;
        await writeFile(
            resolve(
                actual,
                upgrading ? "postgres-upgrade-failure.json" : "restore-failure.json",
            ),
            JSON.stringify({
                stage,
                checkedAt: new Date().toISOString(),
                error: error instanceof Error ? error.message : "Unknown restore error",
                diagnostic,
            }) + "\n",
            {mode: 0o600},
        ).catch(() => {
        });
    } finally {
        const cleanupErrors = [];
        if (database)
            await database.cleanup().catch(() => cleanupErrors.push("database"));
        await rm(temporary, {recursive: true, force: true}).catch(() =>
            cleanupErrors.push("objects"),
        );
        if (cleanupErrors.length) failure = true;
    }
    if (failure)
        throw new Error(
            "Isolated development restore or cleanup did not pass; private details were withheld and unrelated resources were not targeted.",
        );
    return result;
}

// Create only synthetic data for the owned recovery drill.
async function createFixture({keepFailure = false} = {}) {
    await mkdir(backupRoot, {recursive: true, mode: 0o700});
    await chmod(backupRoot, 0o700);
    const directory = resolve(backupRoot, "fixture-" + randomUUID());
    await mkdir(directory, {mode: 0o700});
    let database;
    try {
        database = await createIsolatedDatabase();
        const tables = protectedTables
            .map(
                (table) =>
                    `create table public.${table}(id integer primary key);alter table public.${table} enable row level security;insert into public.${table} values(1);`,
            )
            .join("\n");
        await database.sql(
            `create role anon;create role authenticated;create role postgres nosuperuser createrole;grant pg_monitor to anon with inherit false granted by supabase_admin;create schema auth;create table auth.users(id integer);insert into auth.users values(1);create schema storage;create table storage.objects(id integer);insert into storage.objects values(1);create schema private;create table private.document_storage_limits(singleton boolean,total_quota_bytes bigint,owner_quota_bytes bigint);insert into private.document_storage_limits values(true,10737418240,1073741824);create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text);insert into supabase_migrations.schema_migrations values('20261115142130');${tables}`,
            resolve(directory, "fixture-errors.stderr"),
        );
        const summary = JSON.parse(await database.sql(summarySQL));
        const artifacts = {};
        for (const [name, args] of [
            [
                "database.dump",
                [
                    "pg_dump",
                    "-U",
                    database.operator,
                    "-d",
                    "postgres",
                    "--format=custom",
                    "--no-password",
                ],
            ],
            [
                "roles.sql",
                [
                    "pg_dumpall",
                    "-U",
                    database.operator,
                    "--roles-only",
                    "--no-role-passwords",
                ],
            ],
        ]) {
            const {child, completed} = startCommand("docker", [
                "exec",
                database.name,
                ...args,
            ]);
            await pipeline(
                child.stdout,
                createWriteStream(resolve(directory, name), {
                    mode: 0o600,
                    flags: "wx",
                }),
            );
            await completed;
            artifacts[name] = await fileDigest(resolve(directory, name));
        }
        const source = resolve(directory, "fixture-source");
        await mkdir(source, {mode: 0o700});
        await writeFile(
            resolve(source, "fixture-object"),
            Buffer.from([0, 255, 13, 10, 42]),
            {mode: 0o600},
        );
        const digest = await fileDigest(resolve(source, "fixture-object"));
        await writeFile(
            resolve(directory, "objects.jsonl"),
            JSON.stringify({
                path: "fixture-object",
                sha256: digest.sha256,
                bytes: digest.bytes,
            }) + "\n",
            {mode: 0o600},
        );
        const {child, completed} = startCommand("tar", [
            "--create",
            "--file=-",
            "--directory=" + source,
            ".",
        ]);
        await pipeline(
            child.stdout,
            createWriteStream(resolve(directory, "storage.tar"), {
                mode: 0o600,
                flags: "wx",
            }),
        );
        await completed;
        artifacts["storage.tar"] = await fileDigest(
            resolve(directory, "storage.tar"),
        );
        artifacts["objects.jsonl"] = await fileDigest(
            resolve(directory, "objects.jsonl"),
        );
        await rm(source, {recursive: true});
        await writeFile(
            resolve(directory, "manifest.json"),
            JSON.stringify({
                format: "luminovia-development-backup-v1",
                status: "complete",
                source: {kind: "local-fictional-fixture", image: databaseImage},
                summary,
                artifacts,
                objects: {files: 1, bytes: 5},
            }),
            {mode: 0o600},
        );
        return directory;
    } catch (error) {
        if (!keepFailure) await rm(directory, {recursive: true, force: true});
        throw error;
    } finally {
        if (database) await database.cleanup();
    }
}

// Run the native backup/restore drill using owned temporary resources.
export async function selfTest({keepFailure = false} = {}) {
    const fixture = await createFixture({keepFailure});
    let passed = false;
    try {
        const result = await restoreCheck(fixture);
        assert.equal(result.status, "passed");
        await assert.rejects(
            restoreCheck(fixture, {candidateImage: "supabase/postgres:latest"}),
            /Unreviewed PostgreSQL upgrade candidate/,
        );
        const inventory = await readFile(resolve(fixture, "objects.jsonl"));
        // Altered artifact bytes must be rejected before starting any restore DB.
        await writeFile(resolve(fixture, "objects.jsonl"), "tampered\n", {
            mode: 0o600,
        });
        await assert.rejects(restoreCheck(fixture));
        await writeFile(resolve(fixture, "objects.jsonl"), inventory, {
            mode: 0o600,
        });
        const manifest = JSON.parse(
            await readFile(resolve(fixture, "manifest.json"), "utf8"),
        );
        for (const kind of ["traversal", "symlink", "hardlink"]) {
            await collectCommand("python3", [
                "-c",
                `import io,sys,tarfile
path,kind=sys.argv[1:]
with tarfile.open(path,'w') as tar:
 member=tarfile.TarInfo('../escape' if kind=='traversal' else 'fixture-object')
 if kind=='traversal':member.size=5;tar.addfile(member,io.BytesIO(b'12345'))
 else:
  member.type=tarfile.SYMTYPE if kind=='symlink' else tarfile.LNKTYPE
  member.linkname='../escape';tar.addfile(member)
`,
                resolve(fixture, "storage.tar"),
                kind,
            ]);
            await chmod(resolve(fixture, "storage.tar"), 0o600);
            manifest.artifacts["storage.tar"] = await fileDigest(
                resolve(fixture, "storage.tar"),
            );
            await writeFile(
                resolve(fixture, "manifest.json"),
                JSON.stringify(manifest),
                {mode: 0o600},
            );
            await assert.rejects(restoreCheck(fixture));
        }
        passed = true;
        return result;
    } finally {
        if (passed || !keepFailure)
            await rm(fixture, {recursive: true, force: true});
    }
}

// Select only an existing valid development backup from the private backup directory.
async function latestDevelopmentBackup() {
    const names = (await readdir(backupRoot))
        .filter((name) => /^\d{8}T\d{9}Z-[a-f0-9]{8}$/.test(name))
        .sort()
        .reverse();
    for (const name of names) {
        try {
            const manifest = await readBackupManifest(resolve(backupRoot, name));
            if (
                manifest.status === "complete" &&
                manifest.source.remote === "root@72.61.20.240"
            )
                return resolve(backupRoot, name);
        } catch {
            /* Incomplete candidates are never selected. */
        }
    }
    throw new Error("No complete approved development VPS backup is available.");
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(process.argv[1]).href
) {
    try {
        if (process.argv.length !== 3)
            throw new Error(
                "Use --self-test, --latest-development-vps, --latest-development-vps-upgrade or one private backup directory.",
            );
        const option = process.argv[2];
        const result =
            option === "--self-test"
                ? await selfTest()
                : await restoreCheck(
                    option === "--latest-development-vps" ||
                    option === "--latest-development-vps-upgrade"
                        ? await latestDevelopmentBackup()
                        : option,
                    option === "--latest-development-vps-upgrade"
                        ? {candidateImage: candidateDatabaseImage}
                        : {},
                );
        console.log(
            `PASS: isolated PostgreSQL, migration/RLS/permissions and ${result.objects.files} Storage object byte hashes; private data and paths withheld.`,
        );
    } catch {
        process.stderr.write(
            "Isolated backup restore validation failed; private details withheld.\n",
        );
        process.exitCode = 1;
    }
}
