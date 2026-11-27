import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { monitorAcademy } from "./academy-health.mjs";
import { signAcademyLicence } from "./academy-licence.mjs";
import {
  academyMigrationInventory,
  loadAcademyMigrations,
} from "./academy-migrations.mjs";
const currentLedger = academyMigrationInventory(await loadAcademyMigrations());
import { initializeAcademyRuntime } from "./academy-runtime-config.mjs";

const now = Date.parse("2026-11-22T05:00:00.000Z");
const hour = 3_600_000;
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const expected = {
  installation_id: "9b225490-5319-4b8c-b551-e5ce93a2fafe",
  edition: "customer-self-hosted",
  release_commit: "7".repeat(40),
};
const services = [
  "db",
  "auth",
  "rest",
  "realtime",
  "storage",
  "functions",
  "api-gw",
  "mail-relay",
];

function setup(t, changes = {}) {
  const target = { ...expected, ...changes };
  const base = mkdtempSync(join(tmpdir(), "academy-health-test-"));
  const root = join(base, "runtime");
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const identity = initializeAcademyRuntime({
    root,
    installationId: target.installation_id,
    edition: target.edition,
    portalOrigin: "https://training.example.invalid",
    bindAddress: "127.0.0.1",
  });
  const project = identity.compose_project;
  const terms = {
    ...target,
    issued_at: new Date(now - 2 * hour).toISOString(),
    starts_at: new Date(now - hour).toISOString(),
    expires_at: new Date(now + hour).toISOString(),
    grace_until: new Date(now + 2 * hour).toISOString(),
    modules: ["lms"],
    limits: {
      seat_count: 9,
      storage_bytes: 100_000,
      api_requests_per_minute: 80,
    },
  };
  const envelope = signAcademyLicence(terms, privateKey);
  const stagePath = join(root, "browser/release.json");
  const staged = {
    version: 1,
    state: "browser-staged",
    release: { ...target, source_revision: target.release_commit },
    licence: { sha256: createHash("sha256").update(envelope).digest("hex") },
  };
  writeFileSync(stagePath, JSON.stringify(staged), { mode: 0o600 });
  const bundle = join(root, "backups", `recovery-${"b".repeat(32)}.tar.gz.age`);
  const fixtureText = "age-encryption.org/v1\nopaque-fixture-encrypted-backup";
  writeFileSync(bundle, fixtureText, { mode: 0o600 });
  utimesSync(bundle, (now - hour) / 1000, (now - hour) / 1000);
  const backupReceipt = join(base, "receipt.json");
  const backup = {
    installation_id: target.installation_id,
    release: target.release_commit,
    bundle,
    sha256: createHash("sha256").update(fixtureText).digest("hex"),
  };
  writeFileSync(backupReceipt, JSON.stringify(backup), { mode: 0o600 });
  const bound = (Destination, Source, RW = true) => ({
    Type: "bind",
    Destination,
    Source,
    RW,
  });
  const record = (service, index) => ({
    id: String(index).padStart(64, "0"),
    project,
    service,
    image: `fixture-image@sha256:${"1".repeat(64)}`,
    status: "running",
    health: "healthy",
    networks: { [identity.backend_network]: {} },
    ports: {},
    mounts: [],
    formatOnly: service === "functions",
    fictional_secret_from_inspection: "never output me",
  });
  const observed = services.map(record);
  observed[0].mounts = [
    bound("/var/lib/postgresql/data", join(root, "data/postgres")),
  ];
  observed[4].mounts = [bound("/var/lib/storage", join(root, "data/storage"))];
  const includeIngress = () => {
    const gateway = record("api-ingress", 20);
    gateway.mounts = [
      bound(
        "/etc/envoy/academy-ingress.yml",
        join(root, "browser/api-ingress.yml"),
        false,
      ),
    ];
    gateway.health = null;
    const web = record("web", 21);
    web.ports = Object.fromEntries(
      ["80", "443"].map((number) => [
        `${number}/tcp`,
        [{ HostIp: "127.0.0.1", HostPort: number }],
      ]),
    );
    web.mounts = [bound("/srv", join(root, "browser"), false)];
    web.health = null;
    observed.push(gateway, web);
  };
  const db = {
    installation_id: target.installation_id,
    edition: target.edition,
    release_commit: target.release_commit,
    licence_status: "active",
    course_access_status: "active",
    migration_ledger: { ...currentLedger },
    quota_usage: { occupied_seats: 4, used_storage_bytes: 27182 },
    forbidden_payload: "fictional proprietary database content",
  };
  let failDatabase = false;
  const calls = [];
  const oracle = (args, input) => {
    calls.push(args);
    switch (args[0]) {
      case "ps":
        assert(args.includes(`label=com.docker.compose.project=${project}`));
        return observed.map(({ id }) => id).join("\n");
      case "inspect":
        // Docker may omit Health from running Caddy/Envoy containers entirely.
        assert.match(
          args[4],
          /with index \.State "Health".*json \.Status.*else}}null/,
        );
        assert.match(
          args[4],
          /range \.Config\.Env.*PORTAL_ACADEMY_FILE_VALIDATION=format-only/,
        );
        assert.doesNotMatch(args[4], /json \.Config\.Env|\.State\.Health\.Log/);
        assert.deepEqual(
          args.slice(5),
          observed.map(({ id }) => id),
        );
        return observed.map((entry) => JSON.stringify(entry)).join("\n");
      case "exec":
        if (args[1] === "-i") {
          assert.equal(
            args[2],
            observed.find((entry) => entry.service === "db").id,
          );
          assert.equal(args[3], "psql");
          assert.match(input, /begin read only;/i);
          assert.match(input, /and licence\.terms = '.*'::jsonb;/);
          assert.doesNotMatch(input, /\b(update|delete|insert|drop)\b/i);
          return failDatabase ? "" : JSON.stringify(db);
        }
        throw new Error("Unexpected non-database probe");
      default:
        throw new Error("Unexpected Docker command");
    }
  };
  return {
    root,
    target,
    backupReceipt,
    backup,
    bundle,
    stagePath,
    staged,
    observed,
    db,
    calls,
    includeIngress,
    failDatabase: () => {
      failDatabase = true;
    },
    monitor: (override = {}) =>
      monitorAcademy(
        {
          root,
          expected: target,
          envelope,
          publicKey,
          backupReceipt,
          now,
          ...override,
        },
        oracle,
      ),
  };
}

test("licensed dedicated self-hosted and managed reports are exact, read-only and safe to log", async (t) => {
  for (const edition of ["customer-self-hosted", "customer-managed"]) {
    const fixture = setup(t, { edition });
    fixture.includeIngress();
    const report = await fixture.monitor({
      expectIngress: true,
      verifyBackup: true,
    });
    assert.equal(report.status, "healthy");
    assert.equal(report.edition, edition);
    assert.equal(report.release_commit, expected.release_commit);
    assert.equal(report.services.storage, "healthy");
    assert.equal(report.services.web, "running");
    assert.equal(report.database.course_access, "active");
    assert.deepEqual(report.quotas, {
      seats: { state: "available", used: 4, limit: 9 },
      storage: { state: "available", used: 27182, limit: 100_000 },
      api_requests_per_minute: 80,
    });
    assert.equal(report.file_validation, "format-only");
    assert.equal(report.services.clamav, undefined);
    assert.deepEqual(report.backup, {
      state: "fresh",
      age_minutes: 60,
      digest_verified: true,
    });
    assert.doesNotMatch(
      JSON.stringify(report),
      /never output me|proprietary|example\.invalid|private runtime|\/tmp|opaque-fixture/,
    );
  }
});

test("capacity thresholds and altered migration bytes produce observable degradation", async (t) => {
  const fixture = setup(t);
  fixture.db.quota_usage = { occupied_seats: 9, used_storage_bytes: 100_001 };
  let report = await fixture.monitor();
  assert.deepEqual(report.quotas, {
    seats: { state: "at_capacity", used: 9, limit: 9 },
    storage: { state: "over_capacity", used: 100_001, limit: 100_000 },
    api_requests_per_minute: 80,
  });
  assert.equal(report.status, "degraded");

  fixture.db.quota_usage = { occupied_seats: 4, used_storage_bytes: 27182 };
  fixture.db.migration_ledger.sha256 = "0".repeat(64);
  report = await fixture.monitor();
  assert.equal(report.database.state, "ledger_mismatch");
  assert.deepEqual(report.database.migration_ledger, {
    count: currentLedger.count,
    last_version: currentLedger.last_version,
  });
  assert.equal(report.status, "degraded");
});

test("mismatched mounts or published backend ports degrade health without probing a foreign database", async (t) => {
  const fixture = setup(t);
  fixture.observed[0].mounts[0].Source = join(fixture.root, "wrong-postgres");
  fixture.observed[4].ports = {
    "5000/tcp": [{ HostIp: "0.0.0.0", HostPort: "5000" }],
  };
  assert.equal((await fixture.monitor()).status, "degraded");
  const report = await fixture.monitor();
  assert.equal(report.services.db, "ownership_mismatch");
  assert.equal(report.services.storage, "ownership_mismatch");
  assert.equal(report.database.state, "unavailable");
  assert(!fixture.calls.some((args) => args[0] === "exec" && args[1] === "-i"));
});

test("exact staged licence drift, read-only grace and a missing ledger are distinguished", async (t) => {
  const fixture = setup(t);
  fixture.staged.licence.sha256 = "9".repeat(64);
  writeFileSync(fixture.stagePath, JSON.stringify(fixture.staged));
  assert.equal((await fixture.monitor()).staged_licence, "target_mismatch");
  delete fixture.staged.licence;
  writeFileSync(fixture.stagePath, JSON.stringify(fixture.staged));
  fixture.db.licence_status = "grace";
  fixture.db.course_access_status = "grace";
  fixture.db.migration_ledger = null;
  const grace = await fixture.monitor({ now: now + hour });
  assert.equal(grace.staged_licence, "legacy_metadata");
  assert.equal(grace.status, "degraded");
  assert.equal(grace.licence_status, "grace");
  assert.equal(grace.database.state, "missing_ledger");
  assert.equal(grace.database.course_access, "grace");
  fixture.failDatabase();
  assert.equal((await fixture.monitor()).database.state, "target_mismatch");
});

test("missing ingress, unconfigured file validation and orphan services degrade health", async (t) => {
  const fixture = setup(t);
  fixture.observed.find(({ service }) => service === "functions").formatOnly =
    false;
  const unconfigured = await fixture.monitor();
  assert.equal(unconfigured.file_validation, "unverified");
  assert.equal(unconfigured.topology, "recognised");
  assert.equal(unconfigured.status, "degraded");
  fixture.observed.find(({ service }) => service === "functions").formatOnly =
    true;
  fixture.observed.push({
    ...fixture.observed[0],
    service: "clamav",
    id: "d".repeat(64),
  });
  const report = await fixture.monitor({ expectIngress: true });
  assert.equal(report.services.web, "missing");
  assert.equal(report.topology, "ownership_mismatch");
  assert.equal(report.file_validation, "format-only");
  assert.equal(report.status, "degraded");
});

test("optional services may be stopped but must keep their private topology when running", async (t) => {
  const fixture = setup(t);
  const mailpit = {
    ...fixture.observed[0],
    id: "e".repeat(64),
    service: "mailpit",
    status: "exited",
  };
  fixture.observed.push(mailpit);
  const stopped = await fixture.monitor();
  assert.equal(stopped.services.mailpit, "stopped");
  assert.equal(stopped.status, "healthy");

  // A synthetic Docker observation models unintended public mail capture.
  mailpit.status = "running";
  mailpit.ports = {
    "8025/tcp": [{ HostIp: "0.0.0.0", HostPort: "8025" }],
  };
  const exposed = await fixture.monitor();
  assert.equal(exposed.services.mailpit, "ownership_mismatch");
  assert.equal(exposed.topology, "ownership_mismatch");
  assert.equal(exposed.status, "degraded");
});

test("archive check declines missing receipts, old and mismatched data, symlinks and a wrong digest", async (t) => {
  const fixture = setup(t);
  assert.equal(
    (await fixture.monitor({ backupReceipt: undefined })).backup.state,
    "not_configured",
  );
  utimesSync(
    fixture.bundle,
    (now - 26 * hour) / 1000,
    (now - 26 * hour) / 1000,
  );
  assert.equal((await fixture.monitor()).backup.state, "stale");
  fixture.backup.release = "8".repeat(40);
  writeFileSync(fixture.backupReceipt, JSON.stringify(fixture.backup));
  assert.equal((await fixture.monitor()).backup.state, "target_mismatch");
  fixture.backup.release = expected.release_commit;
  writeFileSync(
    fixture.bundle,
    "age-encryption.org/v1\nmodified encrypted object",
    { mode: 0o600 },
  );
  utimesSync(fixture.bundle, (now - hour) / 1000, (now - hour) / 1000);
  writeFileSync(fixture.backupReceipt, JSON.stringify(fixture.backup));
  assert.equal((await fixture.monitor()).backup.digest_verified, false);
  assert.equal(
    (await fixture.monitor({ verifyBackup: true })).backup.state,
    "digest_mismatch",
  );
  const redirected = join(
    fixture.root,
    "backups",
    `recovery-${"a".repeat(32)}.tar.gz.age`,
  );
  symlinkSync(fixture.bundle, redirected);
  writeFileSync(
    fixture.backupReceipt,
    JSON.stringify({ ...fixture.backup, bundle: redirected }),
  );
  assert.equal(
    (await fixture.monitor({ verifyBackup: true })).backup.state,
    "archive_unavailable",
  );
  // Even a well-shaped copied name may not select data outside the private runtime.
  const foreign = join(fixture.root, "data", "backups");
  mkdirSync(foreign);
  writeFileSync(
    fixture.backupReceipt,
    JSON.stringify({
      ...fixture.backup,
      bundle: join(foreign, redirected.split("/").at(-1)),
    }),
  );
  assert.equal((await fixture.monitor()).backup.state, "invalid_receipt");
});
