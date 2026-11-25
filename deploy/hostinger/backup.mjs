/**
 * Manual development backup with separate checksummed database, role and actual Storage-file artifacts. Private output stays under .local; this is not recurring off-site retention.
 */
import {spawn} from "node:child_process";
import {createHash, randomUUID} from "node:crypto";
import {createReadStream, createWriteStream} from "node:fs";
import {chmod, lstat, mkdir, rename, rm, writeFile} from "node:fs/promises";
import {dirname, resolve} from "node:path";
import {Transform} from "node:stream";
import {pipeline} from "node:stream/promises";
import {fileURLToPath, pathToFileURL} from "node:url";

export const repository = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../..",
);
export const backupRoot = resolve(repository, ".local/hostinger/backups");
export const databaseImage =
    "supabase/postgres:17.6.1.136@sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00";
// Existing backups remain recoverable after this explicitly reviewed same-major
// engine update. Never accept floating tags or an unreviewed source image.
export const reviewedDatabaseImages = new Map([
    [databaseImage, "17.6"],
    [
        "supabase/postgres:17.12.0.000@sha256:8630950b489ecc70563300180287a98c192a4a48f5ae00b4febdaeea1abe85de",
        "17.12",
    ],
]);
const remote = "root@72.61.20.240";
const db = "luminovia-supabase-db-1";
const storage = "/opt/luminovia-portal/data/storage";

// Counts, policy state and migration identifiers are private backup provenance;
// never log this result or include user records, tokens or configuration values.
export const summarySQL = `select json_build_object(
 'server_version',current_setting('server_version'),
 'bootstrap_role',(select rolname from pg_roles where oid=10),
 'migrations',(select coalesce(json_agg(version order by version),'[]'::json) from supabase_migrations.schema_migrations),
 'counts',json_build_object(
  'auth_users',(select count(*) from auth.users),
  'profiles',(select count(*) from public.profiles),
  'jobs',(select count(*) from public.jobs),
  'job_claims',(select count(*) from public.job_claims),
  'assignment_sessions',(select count(*) from public.assignment_sessions),
  'personal_events',(select count(*) from public.personal_events),
  'documents',(select count(*) from public.documents),
  'document_versions',(select count(*) from public.document_versions),
  'messages',(select count(*) from public.messages),
  'contracts',(select count(*) from public.contracts),
  'invoices',(select count(*) from public.invoices),
  'notifications',(select count(*) from public.notifications),
  'storage_objects',(select count(*) from storage.objects)),
 'rls',(select json_object_agg(c.relname,c.relrowsecurity order by c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') and not exists(select 1 from pg_depend d where d.classid='pg_class'::regclass and d.objid=c.oid and d.deptype='e')),
 'limits',(select json_build_object('total_quota_bytes',total_quota_bytes,'owner_quota_bytes',owner_quota_bytes) from private.document_storage_limits where singleton),
 'protection',json_build_object(
  'authenticated_cannot_change_limits',not has_table_privilege('authenticated','private.document_storage_limits','UPDATE'),
  'anon_cannot_read_limits',not has_table_privilege('anon','private.document_storage_limits','SELECT'),
  'authenticated_cannot_update_documents',not has_table_privilege('authenticated','public.documents','UPDATE'))
)::text;`;

// No credential is placed in argv or a temporary source file. Binary data is
// streamed directly through SSH to a mode0600 file, with bounded stderr capture.
// Run a child with separate streams and bounded error output; resolve only after the process actually exits.
export function startCommand(
    program,
    args,
    {input, environment, errorFile} = {},
) {
    const child = spawn(program, args, {
        env: environment ?? process.env,
        stdio: ["pipe", "pipe", "pipe"],
    });
    let stderrBytes = 0;
    const privateErrors = [];
    child.stderr.on("data", (chunk) => {
        stderrBytes += chunk.length;
        if (errorFile && stderrBytes <= 1024 * 1024) privateErrors.push(chunk);
    });
    const completed = new Promise((accept, reject) => {
        child.once("error", () =>
            reject(new Error("Backup/restore command could not start.")),
        );
        child.once("close", async (code) => {
            if (code === 0) accept({stderrBytes});
            else {
                if (errorFile)
                    await writeFile(errorFile, Buffer.concat(privateErrors), {
                        mode: 0o600,
                    }).catch(() => {
                    });
                reject(
                    new Error("Backup/restore command failed; private output withheld."),
                );
            }
        });
    });
    // Attach immediately: a short-lived SSH failure must not become an unhandled
    // rejection before the stream consumer has started waiting for close.
    completed.catch(() => {
    });
    child.stdin.on("error", () => {
    });
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
    return {child, completed};
}

// Collect bounded command output and preserve its failure status.
export async function collectCommand(program, args, options = {}) {
    const {child, completed} = startCommand(program, args, options);
    const chunks = [];
    let bytes = 0;
    for await (const chunk of child.stdout) {
        bytes += chunk.length;
        if (bytes > 4 * 1024 * 1024) {
            child.kill();
            throw new Error("Backup/restore metadata exceeded its safe bound.");
        }
        chunks.push(chunk);
    }
    await completed;
    return Buffer.concat(chunks).toString("utf8").trim();
}

// Build fixed SSH arguments for the authorized development server without starting an interactive login.
function sshArgs(command) {
    return [
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=yes",
        "-o",
        "ConnectTimeout=15",
        "-o",
        "ServerAliveInterval=30",
        "-o",
        "ServerAliveCountMax=2",
        remote,
        command,
    ];
}

// Stream the entire artifact into its hash rather than loading large backups into memory.
export async function fileDigest(file) {
    const hash = createHash("sha256");
    let bytes = 0;
    for await (const chunk of createReadStream(file)) {
        hash.update(chunk);
        bytes += chunk.length;
    }
    return {sha256: hash.digest("hex"), bytes};
}

// Write a command stream exclusively to a private artifact and accept it only after successful process completion.
async function streamArtifact(directory, name, command, input, start = startCommand) {
    const output = resolve(directory, name);
    const {child, completed} = start("ssh", sshArgs(command), {input});
    const hash = createHash("sha256");
    let bytes = 0;
    const checksum = new Transform({
        transform(chunk, _encoding, callback) {
            hash.update(chunk);
            bytes += chunk.length;
            callback(null, chunk);
        },
    });
    try {
        await pipeline(
            child.stdout,
            checksum,
            createWriteStream(output, {flags: "wx", mode: 0o600}),
        );
        await completed;
        return {sha256: hash.digest("hex"), bytes};
    } catch {
        child.kill();
        await completed.catch(() => {
        });
        throw new Error(
            "Backup stream failed; incomplete artifacts remain private and unaccepted.",
        );
    }
}

const inventoryPython = `import hashlib,json,os,pathlib,stat,sys
root=pathlib.Path(${JSON.stringify(storage)})
try:
 if not root.is_dir() or root.is_symlink(): raise ValueError()
 for directory,dirs,files in os.walk(root,followlinks=False):
  dirs.sort();files.sort()
  for name in dirs:
   if pathlib.Path(directory,name).is_symlink(): raise ValueError()
  for name in files:
   path=pathlib.Path(directory,name)
   if not stat.S_ISREG(path.lstat().st_mode): raise ValueError()
   h=hashlib.sha256();size=0
   with path.open('rb') as f:
    while True:
     chunk=f.read(1024*1024)
     if not chunk:break
     h.update(chunk);size+=len(chunk)
   print(json.dumps({'path':path.relative_to(root).as_posix(),'sha256':h.hexdigest(),'bytes':size},ensure_ascii=True,separators=(',',':')),flush=True)
except Exception:
 sys.stderr.write('Storage inventory failed; private details withheld.\\n');sys.exit(1)
`;

// Aggregate the line-oriented file inventory and verify its byte/hash fields.
export async function inventoryTotals(file) {
    let pending = "";
    let files = 0;
    let bytes = 0;
    const consume = (line) => {
        if (!line) return;
        const item = JSON.parse(line);
        if (
            typeof item.path !== "string" ||
            !item.path ||
            !/^[a-f0-9]{64}$/.test(item.sha256) ||
            !Number.isSafeInteger(item.bytes) ||
            item.bytes < 0
        )
            throw new Error("Invalid private Storage inventory.");
        files++;
        bytes += item.bytes;
        if (!Number.isSafeInteger(bytes))
            throw new Error("Storage size exceeds numeric bounds.");
    };
    for await (const chunk of createReadStream(file, {encoding: "utf8"})) {
        pending += chunk;
        if (pending.length > 2 * 1024 * 1024)
            throw new Error("Storage inventory line exceeds its safe bound.");
        let newline;
        while ((newline = pending.indexOf("\n")) >= 0) {
            consume(pending.slice(0, newline));
            pending = pending.slice(newline + 1);
        }
    }
    consume(pending);
    return {files, bytes};
}

// Create private dump/Storage artifacts only after the caller confirms quiescence. The optional command adapters are an internal fixture seam; normal CLI invocation always uses the fixed collectors and streaming child-process path. Write the manifest last so a failed stream can leave only explicitly incomplete private data.
export async function createDevelopmentBackup({quiescent = false, dependencies = {}} = {}) {
    if (quiescent !== true)
        throw new Error(
            "Confirm quiescent development writes with --quiescent before backup.",
        );
    // Optional adapters support deterministic fixtures; the CLI always uses the
    // fixed command implementations and never reads adapters from external input.
    const collect = dependencies.collectCommand ?? collectCommand;
    const start = dependencies.startCommand ?? startCommand;
    const outputRoot = dependencies.outputRoot ?? backupRoot;
    await collect("git", ["check-ignore", "--quiet", outputRoot]);
    await mkdir(outputRoot, {recursive: true, mode: 0o700});
    const state = await lstat(outputRoot);
    if (!state.isDirectory() || state.isSymbolicLink())
        throw new Error("Unsafe backup directory.");
    await chmod(outputRoot, 0o700);
    const stamp = new Date().toISOString().replaceAll(/[-:.]/g, "");
    const name = stamp + "-" + randomUUID().slice(0, 8);
    const partial = resolve(outputRoot, name + ".partial");
    const final = resolve(outputRoot, name);
    await mkdir(partial, {mode: 0o700});
    const startedAt = new Date().toISOString();
    let stage = "source-inspection";
    try {
        const actualImage = JSON.parse(
            await collect(
                "ssh",
                sshArgs("docker inspect --format '{{json .Config.Image}}' " + db),
            ),
        );
        if (!reviewedDatabaseImages.has(actualImage))
            throw new Error(
                "The database image differs from the reviewed backup source.",
            );
        const summary = async () =>
            JSON.parse(
                await collect(
                    "ssh",
                    sshArgs(
                        `docker exec -i ${db} psql -U postgres -d postgres -X -qAt -v ON_ERROR_STOP=1`,
                    ),
                    {input: summarySQL},
                ),
            );
        const before = await summary();
        if (before.server_version !== reviewedDatabaseImages.get(actualImage))
            throw new Error(
                "Running PostgreSQL version differs from its reviewed source image.",
            );
        const artifacts = {};
        stage = "database";
        artifacts["database.dump"] = await streamArtifact(
            partial,
            "database.dump",
            `docker exec ${db} pg_dump -U postgres -d postgres --format=custom --no-password`,
            undefined,
            start,
        );
        artifacts["roles.sql"] = await streamArtifact(
            partial,
            "roles.sql",
            `docker exec ${db} pg_dumpall -U postgres --roles-only --no-role-passwords`,
            undefined,
            start,
        );
        stage = "storage-inventory";
        artifacts["objects.jsonl"] = await streamArtifact(
            partial,
            "objects.jsonl",
            "python3 -",
            inventoryPython,
            start,
        );
        const objects = await inventoryTotals(resolve(partial, "objects.jsonl"));
        stage = "storage-bytes";
        artifacts["storage.tar"] = await streamArtifact(
            partial,
            "storage.tar",
            `tar --create --file=- --directory=${storage} .`,
            undefined,
            start,
        );
        stage = "consistency-check";
        const afterInventory = await streamArtifact(
            partial,
            "objects.after.jsonl",
            "python3 -",
            inventoryPython,
            start,
        );
        if (afterInventory.sha256 !== artifacts["objects.jsonl"].sha256)
            throw new Error(
                "Storage changed during backup; no complete backup was accepted.",
            );
        await rm(resolve(partial, "objects.after.jsonl"));
        const after = await summary();
        if (JSON.stringify(before) !== JSON.stringify(after))
            throw new Error(
                "Database provenance changed during backup; no complete backup was accepted.",
            );
        const manifest = {
            format: "luminovia-development-backup-v1",
            status: "complete",
            startedAt,
            completedAt: new Date().toISOString(),
            source: {
                remote,
                portalOrigin: "https://cms.luminovia.org",
                databaseContainer: db,
                database: "postgres",
                image: actualImage,
                storageDirectory: storage,
            },
            consistency:
                "caller-confirmed-quiescent-development-writes; database snapshot plus stable pre/post Storage content inventory",
            configurationSecretsIncluded: false,
            rolePasswordsIncluded: false,
            limitations: [
                "Runtime credentials/configuration need their separate secure recovery source.",
                "Count/policy checks do not establish quiescence: the caller must prevent writes.",
                "This is a development backup and restore candidate, not production or future 100GB capacity acceptance.",
            ],
            summary: before,
            objects,
            artifacts,
        };
        await writeFile(
            resolve(partial, "manifest.json"),
            JSON.stringify(manifest, null, 2) + "\n",
            {flag: "wx", mode: 0o600},
        );
        await rename(partial, final);
        return {directory: final, manifest};
    } catch {
        await writeFile(
            resolve(partial, "INCOMPLETE.json"),
            JSON.stringify({
                status: "incomplete",
                stage,
                timestamp: new Date().toISOString(),
            }) + "\n",
            {flag: "wx", mode: 0o600},
        ).catch(() => {
        });
        throw new Error(
            "Development backup was not accepted. Incomplete files remain private; no unrelated data were removed.",
        );
    }
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(process.argv[1]).href
) {
    if (
        process.argv.length !== 4 ||
        !process.argv.includes("--development-vps") ||
        !process.argv.includes("--quiescent")
    ) {
        process.stderr.write(
            "Usage: node deploy/hostinger/backup.mjs --development-vps --quiescent\n",
        );
        process.exitCode = 1;
    } else {
        try {
            await createDevelopmentBackup({quiescent: true});
            console.log(
                "Development PostgreSQL and Storage backup completed; private artifacts were not printed.",
            );
        } catch (error) {
            process.stderr.write(
                (error instanceof Error
                    ? error.message
                    : "Development backup failed.") + "\n",
            );
            process.exitCode = 1;
        }
    }
}
