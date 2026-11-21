import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { academyMigrationsScript } from "./academy-migrations.mjs";
import { quoteSql, withTestDatabase } from "./testing/database.mjs";

await withTestDatabase(
  "academy_migration",
  async ({ sql }) => {
    const installationId = randomUUID();
    const edition = "customer-self-hosted";
    const original = {
      version: "20700101000001",
      name: "fictional_initial",
      source:
        "begin; create table public.fictional_academy(id text primary key); commit;\n",
    };
    const upgrade = {
      version: "20700101000002",
      name: "fictional_upgrade",
      source:
        "begin; alter table public.fictional_academy add column active boolean not null default true; commit;\n",
    };
    const apply = (...migrations) =>
      sql(academyMigrationsScript({ installationId, edition, migrations }));
    await assert.rejects(
      apply(original),
      /Native Auth, Storage and Realtime are not ready/,
    );
    await sql(`create schema storage;
    create table storage.objects(id uuid);
    create table storage.buckets(id text);
    create publication supabase_realtime;`);
    await sql(
      `insert into storage.objects values (${quoteSql(randomUUID())});`,
    );
    await assert.rejects(apply(original), /populated internal database/);
    await sql("delete from storage.objects;");
    const failed = {
      ...original,
      source:
        "begin; create table public.fictional_academy(id text primary key); select 1/0; commit;\n",
    };
    await assert.rejects(apply(failed), /22012/);
    assert.equal(
      await sql("select to_regclass('public.fictional_academy') is null;"),
      "t",
    );
    assert.equal(
      await sql("select count(*) from supabase_migrations.schema_migrations"),
      "0",
    );
    assert.equal(JSON.parse(await apply(original)).migration_count, 1);
    await sql(`create schema private;
    create table private.installation_identity(installation_id uuid, edition text, singleton boolean);
    insert into private.installation_identity values (${quoteSql(installationId)}, ${quoteSql(edition)}, true);
    insert into auth.users(id,email) values (${quoteSql(randomUUID())},'retained@example.invalid');
    insert into public.fictional_academy values ('retained');`);
    await assert.rejects(
      sql(
        academyMigrationsScript({
          installationId: randomUUID(),
          edition,
          migrations: [original, upgrade],
        }),
      ),
      /dedicated database identity does not match/,
    );
    await assert.rejects(
      apply({ ...original, source: original.source + "\n" }, upgrade),
      /not an exact prefix/,
    );
    await assert.rejects(apply(upgrade), /not an exact prefix/);
    for (const receipt of await Promise.all([
      apply(original, upgrade),
      apply(original, upgrade),
    ])) {
      assert.deepEqual(JSON.parse(receipt), {
        migration_count: 2,
        last_version: upgrade.version,
      });
    }
    assert.equal(
      await sql("select id || ':' || active from public.fictional_academy"),
      "retained:true",
    );
    assert.equal(
      await sql(
        "select count(*) from auth.users where email='retained@example.invalid'",
      ),
      "1",
    );
    await assert.rejects(apply(original), /not an exact prefix/);
    console.log(
      "PASS native migration readiness, rollback, source prefix protection, independent target, concurrent retry and retained data",
    );
  },
  { migrationsThrough: "00000000000000" },
);
