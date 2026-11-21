/**
 * Verify restrictive SQL policies with owned fixtures shaped like Storage
 * and private Realtime roles. Native HTTP/WebSocket delivery runs separately.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

const [transportMigration, meetingMigration, courseAccessMigration] =
  await Promise.all(
    [
      "20261122007500_dormant_academy_transports.sql",
      "20261122007600_course_meeting_link.sql",
      "20261122007700_academy_course_access.sql",
    ].map((name) =>
      readFile(
        new URL(`../supabase/migrations/${name}`, import.meta.url),
        "utf8",
      ),
    ),
  );

await withTestDatabase(
  "installation_transport",
  async ({ sql, actor }) => {
    // The SQL runner intentionally has no Storage or Realtime service. Add only
    // the table shapes and permissive control policies needed to test composition.
    await sql(`create schema storage; create schema realtime;
    create table storage.buckets(id text primary key, public boolean not null);
    create table storage.objects(id uuid primary key, bucket_id text not null references storage.buckets(id));
    create table realtime.messages(id uuid primary key);
    grant usage on schema storage, realtime to anon, authenticated, service_role;
    grant select, insert, update on storage.buckets, storage.objects, realtime.messages to anon, authenticated, service_role;`);
    for (const name of [
      "storage.buckets",
      "storage.objects",
      "realtime.messages",
    ]) {
      await sql(`alter table ${name} enable row level security;
      create policy fictional_control on ${name} for all to anon, authenticated using (true) with check (true);`);
    }
    await sql(transportMigration);
    await sql(meetingMigration);
    await sql(courseAccessMigration);
    const markerSample = randomUUID();
    await sql(`insert into storage.buckets values ('fictional-private',false),('fictional-public',true);
    insert into realtime.messages values (${q(markerSample)});`);
    assert.equal(
      await sql("set role anon; select count(*) from storage.buckets"),
      "2",
    );
    assert.equal(
      await sql(
        "set role authenticated; select count(*) from realtime.messages",
      ),
      "1",
    );

    const id = randomUUID();
    const pin = `select private.provision_customer_installation(${q(id)},'customer-managed');`;
    await assert.rejects(sql(pin), /55000.*private Storage buckets/);
    await sql("delete from storage.buckets where id='fictional-public'");
    const object = randomUUID();
    await sql(
      `insert into storage.objects values (${q(object)},'fictional-private')`,
    );
    await assert.rejects(sql(pin), /55000.*empty Storage/);
    await sql(`delete from storage.objects where id=${q(object)};`);
    await sql("alter table realtime.messages disable row level security");
    await assert.rejects(sql(pin), /55000.*every installed transport fence/);
    await sql("alter table realtime.messages enable row level security");
    await sql(pin);

    const now = Date.now();
    const day = (offset) => new Date(now + offset * 86400000).toISOString();
    const release = "ab".repeat(20);
    const terms = {
      installation_id: id,
      edition: "customer-managed",
      release_commit: release,
      issued_at: day(-2),
      starts_at: day(-1),
      expires_at: day(10),
      grace_until: day(12),
      modules: ["lms"],
      limits: {
        seat_count: 25,
        storage_bytes: 1000000,
        api_requests_per_minute: 60,
      },
    };
    await sql(
      `select private.apply_verified_installation_licence(${q(JSON.stringify(terms))}::jsonb)`,
    );
    const enableCourseAccess = `select private.configure_academy_course_access(${q(id)},${q(release)},true)`;
    await sql("alter table realtime.messages disable row level security");
    await assert.rejects(sql(enableCourseAccess), /55000.*transport fences/);
    await sql("alter table realtime.messages enable row level security");
    await sql(enableCourseAccess);

    // A trusted fixture can still present an object in a dedicated instance,
    // which ordinary runtime roles must neither enumerate nor mutate.
    const admin = randomUUID();
    await sql(`insert into auth.users(id,email) values (${q(admin)},'admin@example.invalid');
    insert into public.user_roles(user_id,role) values (${q(admin)},'admin');
    insert into storage.objects values (${q(object)},'fictional-private');`);
    assert.equal(
      await sql("set role anon; select count(*) from storage.objects"),
      "0",
    );
    assert.equal(
      await actor(admin, "select count(*) from storage.buckets"),
      "0",
    );
    assert.equal(
      await actor(admin, "select count(*) from realtime.messages"),
      "0",
    );
    await assert.rejects(
      actor(admin, "insert into realtime.messages values (gen_random_uuid())"),
      /42501/,
    );
    await assert.rejects(
      actor(
        admin,
        "insert into storage.objects values (gen_random_uuid(),'fictional-private')",
      ),
      /42501/,
    );
    await assert.rejects(
      sql(
        "set role service_role; insert into storage.buckets values ('blocked-public',true)",
      ),
      /42501.*private Storage buckets/,
    );
    await assert.rejects(
      sql(
        "set role service_role; update storage.buckets set public=true where id='fictional-private'",
      ),
      /42501.*private Storage buckets/,
    );
    assert.equal(
      await sql(`select count(*) from storage.objects where id=${q(object)}`),
      "1",
    );
    assert.equal(
      await sql(
        "select count(*) from pg_policies where policyname='portal_internal_transport' and schemaname='public'",
      ),
      await sql(`select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname in ('messages','message_reactions','chat_members','course_chat_activity')`),
    );
    console.log(
      "PASS dedicated Storage provisioning, course access preflight and independent Storage and Realtime SQL fences",
    );
  },
  { migrationsThrough: "20261122007499" },
);
