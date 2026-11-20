/**
 * Operator tool for the explicitly authorized development instance. Compares stored migration source and applies only missing files; invocation is not general production approval.
 */
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readdirSync, readFileSync} from "node:fs";
import {resolve} from "node:path";

// Explicit development target; no reset, fixture seeding or implicit retargeting.
if (process.argv[2] !== "--development-vps") {
    throw new Error(
        "Use --development-vps for the approved Hostinger development server.",
    );
}
const remote = "root@72.61.20.240";
const command =
    "docker exec -i luminovia-supabase-db-1 psql -U postgres -d postgres -X -At -v ON_ERROR_STOP=1";

// Run SQL only against the fixed development database; ON_ERROR_STOP prevents continuing after a database error.
function sql(input) {
    try {
        return execFileSync("ssh", ["-o", "BatchMode=yes", remote, command], {
            input,
            encoding: "utf8",
            stdio: ["pipe", "pipe", "pipe"],
            maxBuffer: 16 * 1024 * 1024,
        }).trim();
    } catch (error) {
        const details = String(error.stderr ?? "").slice(-2000);
        throw new Error("Hostinger migration operation failed: " + details, {
            cause: error,
        });
    }
}

const ready = sql(
    "select (to_regclass('auth.users') is not null and to_regclass('storage.buckets') is not null and exists(select 1 from pg_publication where pubname='supabase_realtime'))::text;",
);
if (ready !== "true")
    throw new Error(
        "Auth, Storage and Realtime must initialize before application migrations.",
    );
sql(
    "create schema if not exists supabase_migrations; create table if not exists supabase_migrations.schema_migrations(version text primary key, statements text[], name text);",
);
const raw = sql(
    "select coalesce(json_agg(json_build_object('version',version,'source',statements[1])),'[]'::json)::text from supabase_migrations.schema_migrations;",
);
const applied = new Map(
    JSON.parse(raw).map((row) => [row.version, row.source]),
);
const directory = resolve("supabase/migrations");
for (const filename of readdirSync(directory)
    .filter((name) => /^\d{14}_[a-z0-9_]+\.sql$/.test(name))
    .sort()) {
    const source = readFileSync(resolve(directory, filename), "utf8");
    const [version] = filename.split("_");
    const hash = (text) => createHash("sha256").update(text).digest("hex");
    if (applied.has(version)) {
        if (
            typeof applied.get(version) !== "string" ||
            hash(applied.get(version)) !== hash(source)
        ) {
            throw new Error("Existing migration differs from source: " + version);
        }
        console.log("Verified applied migration " + version);
        continue;
    }
    if (
        !/^\s*(?:--[^\n]*\n\s*)*begin;/i.test(source) ||
        !/commit;\s*$/i.test(source)
    ) {
        throw new Error("Migration must have its own transaction: " + filename);
    }
    const delimiter = "$portal_source_" + version + "$";
    if (source.includes(delimiter))
        throw new Error("Unexpected migration delimiter.");
    const name = filename.slice(15, -4);
    const record =
        "insert into supabase_migrations.schema_migrations(version,name,statements) values ('" +
        version +
        "','" +
        name +
        "',ARRAY[" +
        delimiter +
        source +
        delimiter +
        "]);\n";
    // A replacement callback preserves SQL dollar quoting and regex end anchors.
    sql(source.replace(/commit;\s*$/i, () => record + "commit;\n"));
    console.log("Applied migration " + version);
}
sql(
    "update private.document_storage_limits set total_quota_bytes=10737418240, owner_quota_bytes=1073741824 where singleton; notify pgrst, 'reload schema';",
);
console.log(
    "Development allocation configured: 10 GiB shared / 1 GiB per owner. Physical VPS capacity is separate.",
);