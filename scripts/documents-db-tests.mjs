/** Real disposable PostgreSQL/RLS checks for document reservation identity and quotas.
 * The separate documents-api-check exercises actual Auth, Storage and ClamAV.
 */
import {spawn} from "node:child_process";
import {readdir, readFile} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import assert from "node:assert/strict";
import {withMigrationReplayLock} from "./testing/database.mjs";

const container =
    process.env.PORTAL_DB_CONTAINER ?? "supabase_db_luminovia-portal";
if (
    !/^supabase_db_luminovia-portal(?:-test(?:-[a-zA-Z0-9_-]+)?)?$/.test(
        container,
    )
)
    throw new Error(
        "Only the named local portal database container is permitted.",
    );
const database = `documents_test_${randomUUID().replaceAll("-", "")}`;

/** Starts the test program with explicit arguments and preserves its failure status. */
function command(args, input = "") {
    return new Promise((resolve, reject) => {
        const child = spawn("docker", args, {stdio: ["pipe", "pipe", "pipe"]});
        let out = "",
            err = "";
        child.stdout.on("data", (d) => (out += d));
        child.stderr.on("data", (d) => (err += d));
        child.on("error", reject);
        child.on("exit", (code) =>
            code === 0 ? resolve(out.trim()) : reject(new Error(err || out)),
        );
        child.stdin.end(input);
    });
}

/** Sends SQL to the owned test database and makes every psql error fail the run. */
const sql = (text, name = database) =>
    command(
        [
            "exec",
            "-i",
            container,
            "psql",
            "-U",
            "postgres",
            "-d",
            name,
            "-X",
            "-qAt",
            "-v",
            "ON_ERROR_STOP=1",
        ],
        text,
    );
/** Quotes controlled fixture SQL literals; identifiers have separate validation. */
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
/** Executes the check as a specific identity so administrative fixture privileges cannot mask the tested access. */
const actor = (id, statement, aal = "aal1") =>
    sql(
        `begin;set local role authenticated;set local request.jwt.claims=${quote(JSON.stringify({sub: id, aal, role: "authenticated"}))};${statement};commit;`,
    );
const owner = randomUUID(),
    otherOwner = randomUUID(),
    quotaOwner = randomUUID(),
    selfQuotaOwner = randomUUID(),
    manager = randomUUID(),
    manager2 = randomUUID(),
    largeOwner = randomUUID(),
    versionOwner = randomUUID(),
    globalOwner1 = randomUUID(),
    globalOwner2 = randomUUID();
/** Reserves a document version with controlled owner, size and retry context. */
const reserve = async (
    who,
    {
        subject = who,
        size = 256,
        key = randomUUID(),
        replace = null,
        name = "Fictional.pdf",
    } = {},
    aal = "aal1",
) =>
    JSON.parse(
        await actor(
            who,
            `select public.reserve_document(${quote(name)},'application/pdf',${size},'personal','invoice',null,null,${quote(key)},${replace ? quote(replace) : "null"},${quote(subject)})`,
            aal,
        ),
    );
let checks = 0;
/** Counts and reports a case only after all of its assertions have completed successfully. */
const check = async (name, fn) => {
    await fn();
    checks++;
    console.log(`PASS ${name}`);
};

/** Fills the controlled SQL quota fixture to test concurrent reservations at the actual limit. */
async function seedNinetyMiB(subject) {
    for (let index = 0; index < 9; index++) {
        const id = randomUUID(),
            version = randomUUID(),
            key = randomUUID();
        await sql(
            `insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,client_id) values('${id}','${subject}','${subject}','personal','material','Fixture.txt','text/plain',10485760,'${key}');insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes) values('${version}','${id}','${subject}','${key}',1,'${subject}/${version}','Fixture.txt','text/plain',10485760);update public.documents set current_version_id='${version}' where id='${id}';`,
        );
    }
}

try {
    await sql(`create database ${database}`, "postgres");
    await sql(`create schema auth;create schema extensions;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz default now(),created_at timestamptz default clock_timestamp());
 create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
 grant usage on schema auth to authenticated,anon,service_role;grant execute on all functions in schema auth to authenticated,anon,service_role;`);
    await withMigrationReplayLock(container, async () => {
        for (const file of (
            await readdir(new URL("../supabase/migrations/", import.meta.url))
        )
            .filter((f) => f.endsWith(".sql"))
            .sort())
            await sql(
                await readFile(
                    new URL(`../supabase/migrations/${file}`, import.meta.url),
                    "utf8",
                ),
            );
    });
    await sql(
        `insert into auth.users(id) values ${[owner, otherOwner, quotaOwner, selfQuotaOwner, manager, manager2, largeOwner, versionOwner, globalOwner1, globalOwner2].map((id) => `('${id}')`).join(",")};insert into public.user_roles(user_id,role) values('${owner}','lecturer'),('${otherOwner}','lecturer'),('${quotaOwner}','lecturer'),('${selfQuotaOwner}','lecturer'),('${manager}','admin'),('${manager2}','management'),('${largeOwner}','lecturer'),('${versionOwner}','lecturer'),('${globalOwner1}','lecturer'),('${globalOwner2}','lecturer');`,
    );
    await check(
        "Capacity defaults and both Storage bucket ceilings agree; browser roles cannot view or change limits",
        async () => {
            assert.equal(
                await sql(
                    `select total_quota_bytes||':'||owner_quota_bytes from private.document_storage_limits`,
                ),
                "107374182400:10737418240",
            );
            assert.equal(
                await sql(
                    `select count(*) from storage.buckets where id in ('portal-clean','portal-quarantine') and not public and file_size_limit=104857600`,
                ),
                "2",
            );
            await assert.rejects(
                actor(manager, `select * from private.document_storage_limits`, "aal1"),
                /permission denied/,
            );
            await assert.rejects(
                actor(
                    manager,
                    `update private.document_storage_limits set total_quota_bytes=1`,
                    "aal1",
                ),
                /permission denied/,
            );
            await assert.rejects(
                sql(`set role anon;select * from private.document_storage_limits`),
                /permission denied/,
            );
        },
    );
    await check(
        "The exact 100MiB file boundary reserves metadata without allocating bytes; larger requests are rejected",
        async () => {
            const large = await reserve(largeOwner, {size: 104857600});
            assert.equal(
                await sql(
                    `select size_bytes from public.document_versions where id='${large.version_id}'`,
                ),
                "104857600",
            );
            await assert.rejects(
                reserve(largeOwner, {size: 104857601}),
                /Invalid file metadata/,
            );
        },
    );
    let initial, replacement, alternate;
    const createKey = randomUUID(),
        replacementKey = randomUUID();
    await check(
        "Creation retries return the same document/version without consuming another reservation",
        async () => {
            initial = await reserve(owner, {key: createKey});
            assert.deepEqual(await reserve(owner, {key: createKey}), initial);
            assert.equal(
                await sql(
                    `select count(*) from public.document_versions where document_id='${initial.document_id}'`,
                ),
                "1",
            );
        },
    );
    await check(
        "A creation retry cannot be reinterpreted as replacement even of the same document",
        async () => {
            await assert.rejects(
                reserve(owner, {key: createKey, replace: initial.document_id}),
                /replacement target conflict/,
            );
        },
    );
    await check(
        "Replacement retries preserve the precise target and version",
        async () => {
            replacement = await reserve(owner, {
                key: replacementKey,
                replace: initial.document_id,
            });
            assert.equal(replacement.document_id, initial.document_id);
            assert.notEqual(replacement.version_id, initial.version_id);
            assert.deepEqual(
                await reserve(owner, {
                    key: replacementKey,
                    replace: initial.document_id,
                }),
                replacement,
            );
            assert.equal(
                await sql(
                    `select count(*) from public.document_versions where document_id='${initial.document_id}'`,
                ),
                "2",
            );
        },
    );
    await check(
        "A replacement retry rejects omitted or different document targets",
        async () => {
            alternate = await reserve(owner);
            await assert.rejects(
                reserve(owner, {key: replacementKey}),
                /replacement target conflict/,
            );
            await assert.rejects(
                reserve(owner, {key: replacementKey, replace: alternate.document_id}),
                /replacement target conflict/,
            );
        },
    );
    await check(
        "Mismatched metadata and unauthorized on-behalf ownership remain denied",
        async () => {
            await assert.rejects(
                reserve(owner, {key: createKey, size: 257}),
                /Idempotency conflict/,
            );
            await assert.rejects(
                reserve(owner, {subject: otherOwner}),
                /Current lecturer invoice upload authority required/,
            );
            const delegated = await reserve(manager, {subject: otherOwner}, "aal1");
            assert.equal(
                await sql(
                    `select owner_id||':'||uploaded_by from public.documents where id='${delegated.document_id}'`,
                ),
                `${otherOwner}:${manager}`,
            );
        },
    );
    await seedNinetyMiB(quotaOwner);
    await seedNinetyMiB(selfQuotaOwner);
    // Scale operator-configurable owner capacity down only inside this disposable
    // database, keeping existing race regressions meaningful without 10GiB fixtures.
    await sql(
        `update private.document_storage_limits set owner_quota_bytes=104857600`,
    );
    // A slow INSERT makes both old actor-only implementations pass the quota check
    // before either commits. The owner lock must make the losing caller recheck 100MiB.
    await sql(
        `create function private.document_quota_race_delay() returns trigger language plpgsql set search_path='' as $$begin perform pg_catalog.pg_sleep(0.7);return new;end;$$;create trigger document_quota_race_delay before insert on public.documents for each row execute function private.document_quota_race_delay();`,
    );
    await check(
        "Two different permission managers serialize one owner quota: exactly one 10MiB reservation wins at 90MiB",
        async () => {
            const results = await Promise.allSettled([
                reserve(manager, {subject: quotaOwner, size: 10485760}, "aal1"),
                reserve(manager2, {subject: quotaOwner, size: 10485760}, "aal1"),
            ]);
            assert.equal(
                results.filter((result) => result.status === "fulfilled").length,
                1,
            );
            const failed = results.filter((result) => result.status === "rejected");
            assert.equal(failed.length, 1);
            assert.match(failed[0].reason.message, /Upload quota reached/);
            assert.equal(
                await sql(
                    `select sum(v.size_bytes) from public.document_versions v join public.documents d on d.id=v.document_id where d.owner_id='${quotaOwner}'`,
                ),
                "104857600",
            );
        },
    );
    await check(
        "Self-upload and permission on-behalf upload share the same owner quota lock",
        async () => {
            const results = await Promise.allSettled([
                reserve(selfQuotaOwner, {size: 10485760}),
                reserve(manager2, {subject: selfQuotaOwner, size: 10485760}, "aal1"),
            ]);
            assert.equal(
                results.filter((result) => result.status === "fulfilled").length,
                1,
            );
            assert.equal(
                results.filter((result) => result.status === "rejected").length,
                1,
            );
            assert.match(
                results.find((result) => result.status === "rejected").reason.message,
                /Upload quota reached/,
            );
            assert.equal(
                await sql(
                    `select sum(v.size_bytes) from public.document_versions v join public.documents d on d.id=v.document_id where d.owner_id='${selfQuotaOwner}'`,
                ),
                "104857600",
            );
        },
    );
    await check(
        "All immutable versions retain capacity, including failed/archived files, while precise retries consume none",
        async () => {
            await sql(
                `update private.document_storage_limits set owner_quota_bytes=800`,
            );
            const first = await reserve(versionOwner, {size: 400});
            const key = randomUUID();
            const next = await reserve(versionOwner, {
                size: 400,
                replace: first.document_id,
                key,
            });
            assert.deepEqual(
                await reserve(versionOwner, {
                    size: 400,
                    replace: first.document_id,
                    key,
                }),
                next,
            );
            await assert.rejects(
                reserve(versionOwner, {size: 1}),
                /Upload quota reached/,
            );
            await sql(
                `update public.document_versions set status='rejected' where document_id='${first.document_id}';update public.documents set deleted_at=now() where id='${first.document_id}'`,
            );
            await assert.rejects(
                reserve(versionOwner, {size: 1}),
                /Upload quota reached/,
            );
            assert.equal(
                await sql(
                    `select sum(size_bytes) from public.document_versions where document_id='${first.document_id}'`,
                ),
                "800",
            );
            await sql(
                `update private.document_storage_limits set owner_quota_bytes=104857600`,
            );
        },
    );
    await check(
        "Ordinary scan promotion atomically records the exact leased version and audit",
        async () => {
            const asService = (statement) =>
                sql(`begin; set local role service_role; ${statement}; commit;`);
            const reserveMaterial = async (replacement = null) => JSON.parse(
                await actor(
                    otherOwner,
                    `select public.reserve_document('Fictional.txt','text/plain',100,'personal','material',null,null,'${randomUUID()}',${replacement ? quote(replacement) : "null"})`,
                ),
            );
            const original = await reserveMaterial();
            const document = original.document_id;
            /** An earlier scanner may hold a lease when a new version becomes current. */
            const startScan = async ({version_id}) => {
                const lease = await asService(`select public.deletion_upload_begin('${document}','${version_id}')`);
                await sql(`
                    update public.documents set status='scanning' where id='${document}' and current_version_id='${version_id}';
                    update public.document_versions set status='scanning' where id='${version_id}';
                `);
                return lease;
            };
            const hash = "a".repeat(64);
            const scanner = "ClamAV fictional-catalogue";
            const finish = (version, lease, receipt = scanner) =>
                `select public.complete_document_upload('${document}','${version}','${lease}','${hash}',${quote(receipt)})`;
            const oldLease = await startScan(original);
            const current = (await reserveMaterial(document)).version_id;
            const lease = await startScan({version_id: current});
            await assert.rejects(asService(finish(original.version_id, oldLease)), /Upload version is no longer current/);
            await assert.rejects(asService(finish(current, oldLease)), /insufficient_privilege/);
            await assert.rejects(actor(otherOwner, finish(current, lease)), /permission denied/);
            await assert.rejects(
                asService(finish(current, lease, "Academy file validation v1 (no malware scan)")),
                /22023|invalid_parameter_value/,
            );

            // Fail after both metadata writes. The whole verdict must roll back
            // while the exact same lease remains available for a clean retry.
            const status = () => sql(`
                select concat_ws(':', document.status, version.status, coalesce(version.sha256,'-'), coalesce(version.scanner_version,'-'))
                from public.documents document join public.document_versions version on version.id=document.current_version_id
                where document.id='${document}'`);
            const audit = () => sql(`select actor_id from public.audit_events where resource_id='${document}' and action='document.scan_clean'`);
            await sql(`
                create function private.fixture_reject_scan_audit() returns trigger language plpgsql as $$
                begin
                    if new.resource_id = '${document}' and new.action = 'document.scan_clean' then
                        raise exception 'Fictional audit failure';
                    end if;
                    return new;
                end;
                $$;
                create trigger fixture_reject_scan_audit before insert on public.audit_events
                    for each row execute function private.fixture_reject_scan_audit();
            `);
            await assert.rejects(asService(finish(current, lease)), /Fictional audit failure/);
            assert.equal(await status(), "scanning:scanning:-:-");
            assert.equal(await audit(), "");
            await sql("drop trigger fixture_reject_scan_audit on public.audit_events");
            await asService(finish(current, lease));
            await asService(finish(current, lease));
            assert.equal(await status(), `clean:clean:${hash}:${scanner}`);
            assert.equal(await audit(), otherOwner);
            assert.equal(await sql(`select status from public.document_versions where id='${original.version_id}'`), "scanning");
            await asService(`select public.deletion_upload_end('${lease}'); select public.deletion_upload_end('${oldLease}')`);
        },
    );
    await check(
        "Different owners cannot race beyond shared capacity, and the winning retry remains idempotent at full capacity",
        async () => {
            const before = Number(
                await sql(
                    `select coalesce(sum(size_bytes),0) from public.document_versions`,
                ),
            );
            await sql(
                `update private.document_storage_limits set total_quota_bytes=${before + 256}`,
            );
            const requests = [
                {who: globalOwner1, key: randomUUID()},
                {who: globalOwner2, key: randomUUID()},
            ];
            const results = await Promise.allSettled(
                requests.map(({who, key}) => reserve(who, {key, size: 256})),
            );
            assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
            assert.equal(results.filter((r) => r.status === "rejected").length, 1);
            assert.match(
                results.find((r) => r.status === "rejected").reason.message,
                /Global upload quota reached/,
            );
            const winner = results.findIndex((r) => r.status === "fulfilled");
            assert.deepEqual(
                await reserve(requests[winner].who, {
                    key: requests[winner].key,
                    size: 256,
                }),
                results[winner].value,
            );
            assert.equal(
                Number(
                    await sql(`select sum(size_bytes) from public.document_versions`),
                ),
                before + 256,
            );
        },
    );
    await check(
        "File details read current authorized metadata and never expose private versions to other actors",
        async () => {
            const id = randomUUID(),
                version = randomUUID(),
                key = randomUUID();
            await sql(
                `insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,client_id) values('${id}','${owner}','${owner}','personal','material','Details.pdf','application/pdf',1234,'${key}');insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes) values('${version}','${id}','${owner}','${key}',2,'${owner}/${version}','Details.pdf','application/pdf',1234);update public.documents set current_version_id='${version}' where id='${id}';`,
            );
            const detail = `select original_name||':'||mime_type||':'||size_bytes from public.documents where id='${id}'`;
            const current = `select version from public.document_versions where document_id='${id}' and id='${version}'`;
            assert.equal(
                await actor(owner, detail),
                "Details.pdf:application/pdf:1234",
            );
            assert.equal(await actor(owner, current), "2");
            for (const other of [otherOwner, manager]) {
                assert.equal(await actor(other, detail, "aal2"), "");
                assert.equal(await actor(other, current, "aal2"), "");
            }
            await sql(`update public.profiles set active=false where id='${owner}'`);
            assert.equal(await actor(owner, detail), "");
            assert.equal(await actor(owner, current), "");
            await sql(`update public.profiles set active=true where id='${owner}'`);
        },
    );
    await check(
        "Document metadata/version writes stay RPC-only and suspended actors cannot retry",
        async () => {
            await assert.rejects(
                actor(
                    owner,
                    `update public.documents set status='clean' where id='${initial.document_id}'`,
                ),
                /permission denied/,
            );
            assert.equal(
                await actor(
                    otherOwner,
                    `select count(*) from public.documents where id='${initial.document_id}'`,
                ),
                "0",
            );
            await sql(`update public.profiles set active=false where id='${owner}'`);
            await assert.rejects(
                reserve(owner, {key: createKey}),
                /insufficient_privilege/,
            );
        },
    );
    console.log(
        `\n${checks} document PostgreSQL checks passed (retry target identity and real concurrent owner quotas).`,
    );
} finally {
    await sql(`drop database if exists ${database} with(force)`, "postgres");
}