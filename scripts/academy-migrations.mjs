/** Apply the signed release's migrations inside one isolated psql session. */
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { migrationTransaction } from "./migration-transaction.mjs";

const filenamePattern = /^(\d{14})_([a-z0-9_]+)\.sql$/;
const committed = /commit;\s*$/i;
const migrationsPath = new URL("../supabase/migrations/", import.meta.url);
const quote = (value) => "'" + value.replaceAll("'", "''") + "'";

export async function loadAcademyMigrations() {
  return Promise.all(
    (await readdir(migrationsPath)).sort().map(async (filename) => {
      const match = filenamePattern.exec(filename);
      if (!match) throw new Error("academy_migration_filename");
      const [, version, name] = match;
      return {
        version,
        name,
        source: await readFile(new URL(filename, migrationsPath), "utf8"),
      };
    }),
  );
}

/** Match the monitor's ordered, byte-exact ledger aggregate without exposing SQL. */
export function academyMigrationInventory(migrations) {
  const entries = migrations.map(
    ({ version, source }) =>
      version + ":" + createHash("sha256").update(source).digest("hex"),
  );
  return {
    count: entries.length,
    last_version: migrations.at(-1).version,
    sha256: createHash("sha256").update(entries.join("\n")).digest("hex"),
  };
}

export function academyMigrationsScript({
  installationId,
  edition,
  migrations,
}) {
  if (
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(installationId) ||
    !["customer-self-hosted", "customer-managed"].includes(edition) ||
    migrations.length === 0
  )
    throw new Error("academy_migration_target");
  const expected = [];
  const updates = [];
  let previous = "";
  for (const { version, name, source } of migrations) {
    const filename = version + "_" + name + ".sql";
    const marker = "$academy_" + version + "$";
    const digest = createHash("sha256").update(source).digest("hex");
    const command = migrationTransaction(filename, source);
    if (
      !filenamePattern.test(filename) ||
      previous >= version ||
      !/^\s*(?:--[^\n]*\n\s*)*begin;/i.test(command) ||
      !committed.test(command) ||
      source.includes(marker) ||
      /^\s*\\/m.test(source)
    )
      throw new Error("academy_migration_source");
    previous = version;
    expected.push("(" + quote(version) + "," + quote(digest) + ")");
    const recorded =
      "insert into supabase_migrations.schema_migrations(version,name,statements) values (" +
      quote(version) +
      "," +
      quote(name) +
      ",ARRAY[" +
      marker +
      source +
      marker +
      "]);\n";
    updates.push(
      "select not exists (select 1 from supabase_migrations.schema_migrations where version = " +
        quote(version) +
        ") as academy_migration_pending \\gset\n" +
        "\\if :academy_migration_pending\n" +
        command.replace(committed, () => recorded + "commit;\n") +
        "\\endif\n",
    );
  }
  return `
select pg_catalog.pg_advisory_lock(pg_catalog.hashtextextended('luminovia-academy-migrations', 0));
do $academy_migration_guard$
declare
  target_id uuid := ${quote(installationId)};
  target_edition text := ${quote(edition)};
  current_id uuid;
  current_edition text;
  relation text;
  populated boolean;
begin
  if to_regclass('auth.users') is null or to_regclass('storage.objects') is null
     or to_regclass('storage.buckets') is null
     or not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise exception 'Native Auth, Storage and Realtime are not ready';
  end if;
  if to_regclass('private.installation_identity') is not null then
    select installation_id, edition into strict current_id, current_edition
    from private.installation_identity where singleton;
    if current_edition <> 'internal' and (current_id, current_edition) <> (target_id, target_edition) then
      raise exception 'The dedicated database identity does not match the signed target';
    end if;
  end if;
  if current_edition is null or current_edition = 'internal' then
    foreach relation in array array[
      'auth.users', 'storage.objects', 'public.profiles', 'public.organisations', 'public.course_runs',
      'public.jobs', 'public.contracts', 'public.invoices', 'public.documents', 'public.messages'
    ] loop
      if to_regclass(relation) is not null then
        execute format('select exists (select 1 from %s)', to_regclass(relation)) into populated;
        if populated then
          raise exception 'A populated internal database cannot be migrated as a dedicated academy';
        end if;
      end if;
    end loop;
  end if;
end
$academy_migration_guard$;
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key, statements text[], name text
);
do $academy_migration_ledger$
begin
  if exists (
    with expected(version, digest) as (values ${expected.join(",")})
    select 1
    from supabase_migrations.schema_migrations recorded
    left join expected using (version)
    where expected.digest is distinct from encode(sha256(convert_to(recorded.statements[1], 'UTF8')), 'hex')
       or expected.version is null
  ) or exists (
    with expected(version) as (values ${migrations.map(({ version }) => "(" + quote(version) + ")").join(",")})
    select 1 from expected
    where expected.version < (select max(version) from supabase_migrations.schema_migrations)
    and not exists (select 1 from supabase_migrations.schema_migrations recorded where recorded.version = expected.version)
  ) then
    raise exception 'The migration ledger is not an exact prefix of this release';
  end if;
end
$academy_migration_ledger$;
-- A released migration can return its own status row. Keep the operator's
-- machine receipt as the only query output while preserving PostgreSQL errors.
\\o /dev/null
${updates.join("\n")}
\\o
notify pgrst, 'reload schema';
select json_build_object('migration_count', count(*), 'last_version', max(version))
from supabase_migrations.schema_migrations;
`;
}
