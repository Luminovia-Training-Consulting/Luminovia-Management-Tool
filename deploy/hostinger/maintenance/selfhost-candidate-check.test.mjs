/**
 * Static/filesystem candidate cases exercise isolation, unique ownership and carried fixtures. The separate native run must prove actual Auth/Storage persistence.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  adaptCandidateApiFixture,
  assertCandidateConfiguration,
  candidateApiSuites,
  checkCandidate,
  migrationWithHistory,
  ownershipLabel,
  stageCandidateSource,
} from "./selfhost-candidate-check.mjs";

const project = "luminovia-portal-test-" + "a".repeat(24);
const scope = {
  project,
  network: project + "-backend",
  directory: "/tmp/fictional-candidate-fixture",
};
// Create controlled owned fixtures with replaceable external responses.
function fixture() {
  const services = Object.fromEntries(
    [
      "api-gw",
      "auth",
      "clamav",
      "db",
      "functions",
      "mailpit",
      "realtime",
      "rest",
      "storage",
      "web",
    ].map((name) => [
      name,
      {
        image: "official/example:1@sha256:" + "a".repeat(64),
        labels: { [ownershipLabel]: project },
        networks: { backend: {} },
        ports: [],
        environment: {},
        volumes: [],
      },
    ]),
  );
  services.auth.environment.GOTRUE_SMTP_HOST = "mailpit";
  services.mailpit.environment.MP_SMTP_AUTH_ACCEPT_ANY = "true";
  services.db.container_name = "supabase_db_" + project;
  services.clamav.container_name = "portal_scanner_" + project;
  services.web.ports = [42001, 42002, 42003].map((port) => ({
    host_ip: "127.0.0.1",
    published: String(port),
  }));
  return {
    services,
    networks: { backend: { name: scope.network } },
    volumes: {
      cache: {
        name: project + "_cache",
        labels: { [ownershipLabel]: project },
      },
    },
  };
}

test("candidate boundary accepts only the fictional isolated topology", () => {
  assert.doesNotThrow(() => assertCandidateConfiguration(fixture(), scope));
  const changes = [
    (c) => {
      c.services.web.ports[0].host_ip = "0.0.0.0";
    },
    (c) => {
      c.services.db.volumes.push({
        type: "bind",
        source: "/opt/luminovia-portal/data/postgres",
        target: "/var/lib/postgresql/data",
      });
    },
    (c) => {
      c.services.auth.labels[ownershipLabel] = "somebody-else";
    },
    (c) => {
      c.services.storage.image = "supabase/storage-api:latest";
    },
    (c) => {
      c.services.functions.networks.production = {};
    },
    (c) => {
      c.services.db.container_name = "luminovia-supabase-db-1";
    },
    (c) => {
      c.services.mailpit.ports.push({
        host_ip: "127.0.0.1",
        published: "8025",
      });
    },
    (c) => {
      c.volumes.cache.name = "luminovia-existing-cache";
    },
    (c) => {
      c.services.auth.environment.GOTRUE_SMTP_HOST =
        "real-smtp.example.invalid";
    },
    (c) => {
      c.services.functions.privileged = true;
    },
  ];
  for (const change of changes) {
    const configuration = fixture();
    change(configuration);
    assert.throws(() => assertCandidateConfiguration(configuration, scope));
  }
});

test("migration replay preserves every original SQL dollar and exact history source", () => {
  const source =
    "begin;\ncreate function public.fixture() returns text language sql as $$ select '$1 and $& and $$literal'; $$;\ncommit;\n";
  const result = migrationWithHistory("20261115111133_fixture.sql", source);
  const delimiter = "$candidate_history_20261115111133$";
  assert(result.includes("ARRAY[" + delimiter + source + delimiter + "]"));
  assert(result.startsWith(source.slice(0, source.lastIndexOf("commit;"))));
  assert.equal(result.match(/INSERT INTO supabase_migrations/g).length, 1);
  for (const [name, sql] of [
    ["../../private.sql", source],
    ["20261115111133_fixture.sql", "select 1;"],
    ["20261115111133_fixture.sql", source + delimiter],
  ])
    assert.throws(() => migrationWithHistory(name, sql));
});

test("every actual application migration can be atomically replayed with its exact history source", () => {
  // A fresh CLI replay can accept a source that the retained-data path rejects.
  // Keep the real migration inventory bound to that stricter upgrade contract.
  const directory = resolve("supabase/migrations");
  const names = readdirSync(directory)
    .filter((name) => /^\d{14}_[a-z0-9_]+\.sql$/.test(name))
    .sort();
  assert(names.length >= 24);
  for (const name of names) {
    const source = readFileSync(join(directory, name), "utf8");
    const replay = migrationWithHistory(name, source);
    assert(
      replay.includes(
        "ARRAY[$candidate_history_" + name.slice(0, 14) + "$" + source,
      ),
      name,
    );
    assert.match(replay, /COMMIT;\s*$/);
  }
});

test("M4 candidate source stages all discovered API suites and exact catalogue assets without replacing retained runtime data", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "candidate-source-fixture-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const source = resolve("."),
    baseline = join(directory, "baseline"),
    scratch = join(directory, "scratch");
  stageCandidateSource(source, baseline);
  rmSync(join(baseline, "data"), { recursive: true });
  mkdirSync(join(scratch, "runtime-data"), { recursive: true });
  writeFileSync(join(scratch, "runtime-data/retained-fixture"), "keep bytes");
  stageCandidateSource(source, scratch);
  const suites = candidateApiSuites(scratch);
  for (const name of [
    "avatars-api-check.mjs",
    "cbw-api-check.mjs",
    "comments-api-check.mjs",
    "local-invite-check.mjs",
  ])
    assert(suites.includes(name));
  assert.deepEqual(
    readFileSync(join(scratch, "data/cbw-building-blocks.json")),
    readFileSync(join(source, "data/cbw-building-blocks.json")),
  );
  stageCandidateSource(baseline, scratch);
  assert(!existsSync(join(scratch, "data")));
  assert.equal(
    readFileSync(join(scratch, "runtime-data/retained-fixture"), "utf8"),
    "keep bytes",
    "Source fixture data must never overlap the retained database/storage bind root.",
  );
});

test("M4 scratch API adapter preserves loopback guards and requires exact candidate project, endpoint and database label before fixtures", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "candidate-api-fixture-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const source = readFileSync(resolve("scripts/testing/api.mjs"), "utf8");
  const adapted = adaptCandidateApiFixture(source, { project, apiPort: 44777 });
  for (const options of [
    { project: "luminovia-portal", apiPort: 44777 },
    { project, apiPort: 443 },
    { project, apiPort: 65536 },
  ])
    assert.throws(() => adaptCandidateApiFixture(source, options));
  assert.throws(() =>
    adaptCandidateApiFixture("", { project, apiPort: 44777 }),
  );
  mkdirSync(join(directory, "supabase"));
  mkdirSync(join(directory, "bin"));
  symlinkSync(resolve("node_modules"), join(directory, "node_modules"));
  writeFileSync(join(directory, "api.mjs"), adapted);
  writeFileSync(
    join(directory, "supabase/config.toml"),
    'project_id = "' + project + '"\n',
  );
  const marker = join(directory, "fixture-ran");
  const execute = (label, url) => {
    rmSync(marker, { force: true });
    writeFileSync(
      join(directory, "bin/docker"),
      "#!/bin/sh\nprintf '%s\\n' '" +
        JSON.stringify({ [ownershipLabel]: label }) +
        "'\n",
      { mode: 0o755 },
    );
    writeFileSync(
      join(directory, ".env.test.local"),
      "SUPABASE_URL=" + url + "\nSUPABASE_SERVICE_ROLE_KEY=fictional-key\n",
    );
    return spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        'import {withApiFixture} from "./api.mjs"; import {writeFileSync} from "node:fs"; await withApiFixture(()=>writeFileSync(' +
          JSON.stringify(marker) +
          ', "owned fixture"));',
      ],
      {
        cwd: directory,
        encoding: "utf8",
        env: {
          ...process.env,
          PORTAL_TEST_MODE: "1",
          PORTAL_CANDIDATE_OWNER: project,
          SUPABASE_URL: url,
          SUPABASE_SERVICE_ROLE_KEY: "fictional-key",
          PATH: join(directory, "bin") + ":/usr/bin:/bin",
        },
      },
    );
  };
  const accepted = execute(project, "https://127.0.0.1:44777");
  assert.equal(accepted.status, 0, accepted.stderr);
  assert(existsSync(marker));
  for (const [label, url] of [
    ["unrelated", "https://127.0.0.1:44777"],
    [project, "https://127.0.0.1:55321"],
    [project, "https://cms.luminovia.org:44777"],
  ]) {
    assert.notEqual(execute(label, url).status, 0);
    assert(!existsSync(marker));
  }
});

test("default CLI remains read-only even without a Docker executable", () => {
  const path = resolve(
    "deploy/hostinger/maintenance/selfhost-candidate-check.mjs",
  );
  const result = spawnSync(process.execPath, [path], {
    encoding: "utf8",
    env: { ...process.env, PATH: "/nonexistent" },
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Read-only by default/);
  assert.equal(
    spawnSync(process.execPath, [path, "--run"], {
      encoding: "utf8",
      env: { ...process.env, PATH: "/nonexistent" },
    }).status,
    1,
  );
  assert.equal(
    spawnSync(
      process.execPath,
      [path, "--target", "https://cms.luminovia.org"],
      { encoding: "utf8" },
    ).status,
    1,
  );
});

test("upgrade baseline and proof output fail closed before any Docker operation", async () => {
  await assert.rejects(checkCandidate(), /baseline/);
  await assert.rejects(checkCandidate({ baselineRoot: "." }), /baseline/);
  for (const name of ["proof.json", "..looks-outside.json"]) {
    await assert.rejects(
      checkCandidate({
        baselineRoot: resolve("."),
        baselineCommit: "a".repeat(40),
        proofOutput: resolve(name),
      }),
      /outside source checkouts/,
    );
  }
});

test("scanner restart adapter refuses unrelated containers before starting anything", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "candidate-adapter-fixture-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const bin = join(directory, "bin");
  mkdirSync(bin);
  const marker = join(directory, "started");
  const metadata = {
    Name: "/portal_scanner_" + project,
    Config: { Labels: { [ownershipLabel]: "unrelated" } },
    HostConfig: { PortBindings: {} },
  };
  writeFileSync(
    join(bin, "docker"),
    "#!/bin/sh\nif test \"$1\" = inspect; then\nprintf '%s\\n' '" +
      JSON.stringify([metadata]) +
      "'\nelse\ntouch '" +
      marker +
      "'\nfi\n",
    { mode: 0o755 },
  );
  const result = spawnSync(
    process.execPath,
    [
      resolve("deploy/hostinger/maintenance/candidate-scanner-control.mjs"),
      "start",
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: bin + ":/usr/bin:/bin",
        PORTAL_CANDIDATE_OWNER: project,
      },
    },
  );
  assert.equal(result.status, 1);
  assert(!existsSync(marker));
});
