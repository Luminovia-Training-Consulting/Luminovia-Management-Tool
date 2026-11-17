/**
 * Native compatibility check of the full selfhost stack in an owned Compose project. Preserve test data across the image switch and exercise Auth/API/Storage rather than only startup or YAML.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, totalmem } from "node:os";
import { createServer } from "node:net";
import { request as httpsRequest } from "node:https";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createConfiguration,
  writeConfiguration,
} from "../selfhost/generate-env.mjs";
import {
  assertLocalDocker,
  cleanEnvironment,
} from "../../../scripts/runtime-lib.mjs";

export const ownershipLabel = "org.luminovia.candidate";
const root = resolve(import.meta.dirname, "../../..");
const expectedServices = [
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
].sort();
const immutable = /^[A-Za-z0-9./_-]+(?::[A-Za-z0-9._-]+)?@sha256:[a-f0-9]{64}$/;
// Compute a stable SHA-256 digest for the source/artifact comparison.
const hash = (data) => createHash("sha256").update(data).digest("hex");

/** Build the owned one-day loopback HTTPS leaf and private-key arguments.
 * Explicit CA:FALSE keeps the same trusted fixture valid in OpenSSL and rustls;
 * trusting this self-signed leaf never disables certificate/hostname checking. */
export function candidateCertificateArguments(directory) {
  return [
    "req",
    "-x509",
    "-newkey",
    "ec",
    "-pkeyopt",
    "ec_paramgen_curve:P-256",
    "-nodes",
    "-days",
    "1",
    "-subj",
    "/CN=Luminovia Candidate",
    "-addext",
    "subjectAltName=IP:127.0.0.1",
    // This is the HTTPS server leaf, not a certificate authority. rustls
    // rejects a CA:TRUE end entity even when Node/OpenSSL trusts the file.
    "-addext",
    "basicConstraints=critical,CA:FALSE",
    "-keyout",
    join(directory, "key.pem"),
    "-out",
    join(directory, "cert.pem"),
  ];
}

// Verify project name, ports, mounts and private configuration before starting the isolated candidate.
export function assertCandidateConfiguration(configuration, scope) {
  assert.match(scope.project, /^luminovia-portal-test-[a-f0-9]{24}$/);
  assert.equal(scope.network, scope.project + "-backend");
  assert(isAbsolute(scope.directory));
  assert.deepEqual(
    Object.keys(configuration.services).sort(),
    expectedServices,
  );
  assert.deepEqual(Object.keys(configuration.networks), ["backend"]);
  assert.equal(configuration.networks.backend.name, scope.network);
  for (const service of Object.values(configuration.services)) {
    assert(
      immutable.test(service.image),
      "Candidate images must be immutable.",
    );
    assert.equal(service.labels[ownershipLabel], scope.project);
    assert(!service.privileged && !service.network_mode && !service.pid);
    assert.deepEqual(Object.keys(service.networks), ["backend"]);
    for (const port of service.ports ?? []) {
      assert.equal(
        port.host_ip,
        "127.0.0.1",
        "Candidate ports must stay loopback-only.",
      );
      assert(Number(port.published) > 1024);
    }
    for (const volume of service.volumes ?? []) {
      if (volume.type === "bind") {
        const path = relative(scope.directory, volume.source);
        assert(
          path && !path.startsWith("..") && !isAbsolute(path),
          "A bind escapes candidate scratch.",
        );
        assert(!volume.source.includes("docker.sock"));
      } else {
        assert.equal(volume.type, "volume");
        assert(configuration.volumes[volume.source]);
      }
    }
  }
  assert.equal(configuration.services.web.ports.length, 3);
  for (const name of expectedServices.filter((name) => name !== "web"))
    assert.equal(configuration.services[name].ports?.length ?? 0, 0);
  for (const volume of Object.values(configuration.volumes)) {
    assert(volume.name.startsWith(scope.project + "_"));
    assert.equal(volume.labels[ownershipLabel], scope.project);
    assert(!volume.external);
  }
  assert.equal(
    configuration.services.auth.environment.GOTRUE_SMTP_HOST,
    "mailpit",
  );
  assert.equal(
    configuration.services.mailpit.environment.MP_SMTP_AUTH_ACCEPT_ANY,
    "true",
  );
  assert.equal(
    configuration.services.db.container_name,
    "supabase_db_" + scope.project,
  );
  assert.equal(
    configuration.services.clamav.container_name,
    "portal_scanner_" + scope.project,
  );
}

// Store exact migration source in a real ledger entry, not only its version number.
export function migrationWithHistory(filename, source) {
  assert.match(filename, /^\d{14}_[a-z0-9_]+\.sql$/);
  assert(
    /^\s*(?:--[^\n]*\n\s*)*begin;/i.test(source) && /commit;\s*$/i.test(source),
  );
  const version = filename.slice(0, 14),
    name = filename.slice(15, -4);
  const delimiter = "$candidate_history_" + version + "$";
  assert(!source.includes(delimiter));
  const record = `INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES ('${version}','${name}',ARRAY[${delimiter}${source}${delimiter}]);\n`;
  return source.replace(/commit;\s*$/i, () => record + "COMMIT;\n");
}

// Copy allowed source files without private data or unrelated checkout artifacts.
function copySource(source, target) {
  const info = lstatSync(source);
  assert(!info.isSymbolicLink(), "Candidate source symlinks are refused.");
  if (info.isDirectory()) {
    mkdirSync(target, { recursive: true, mode: 0o755 });
    for (const entry of readdirSync(source)) {
      if (
        entry.startsWith(".env") ||
        [".local", ".git", "private", "node_modules"].includes(entry)
      )
        continue;
      copySource(join(source, entry), join(target, entry));
    }
  } else {
    assert(info.isFile());
    copyFileSync(source, target);
  }
}

// Create an owned candidate tree from actual source for the native probe.
export function stageCandidateSource(sourceRoot, scratch) {
  for (const item of [
    "scripts",
    "supabase/functions",
    "supabase/templates",
    "supabase/migrations",
    "deploy/hostinger/selfhost",
    "deploy/hostinger/supabase/upstream/volumes",
  ]) {
    rmSync(join(scratch, item), { recursive: true, force: true });
    copySource(join(sourceRoot, item), join(scratch, item));
  }
  // Public versioned fixture/catalogue data belongs to the matching source
  // phase. An older baseline may have no data directory at all.
  rmSync(join(scratch, "data"), { recursive: true, force: true });
  if (existsSync(join(sourceRoot, "data")))
    copySource(join(sourceRoot, "data"), join(scratch, "data"));
  mkdirSync(join(scratch, "deploy/hostinger"), { recursive: true });
  for (const name of ["compose.yml", "Caddyfile", "clamd.conf"])
    copyFileSync(
      join(sourceRoot, "deploy/hostinger", name),
      join(scratch, "deploy/hostinger", name),
    );
  copyFileSync(
    join(root, "deploy/hostinger/maintenance/candidate-scanner-control.mjs"),
    join(scratch, "scripts/local-scanner.mjs"),
  );
}

// Discover the candidate's actual API check programs.
export function candidateApiSuites(sourceRoot) {
  const scripts = join(sourceRoot, "scripts");
  return [
    ...readdirSync(scripts)
      .filter((name) => name.endsWith("-api-check.mjs"))
      .sort(),
    "local-invite-check.mjs",
  ].map((name) => {
    assert(lstatSync(join(scripts, name)).isFile());
    return name;
  });
}

// Adapt only the fixture's explicit isolated project/port contract.
export function adaptCandidateApiFixture(source, { project, apiPort }) {
  assert.match(project, /^luminovia-portal-test-[a-f0-9]{24}$/);
  assert(Number.isInteger(apiPort) && apiPort > 1024 && apiPort <= 65535);
  const port = '    "55321",\n    "Dedicated canonical API port required.",';
  const client = "  const make = (key) =>";
  assert.equal(source.split(port).length, 2, "Unknown API fixture port guard.");
  assert.equal(source.split(client).length, 2, "Unknown API fixture boundary.");
  // This scratch-only adapter preserves the original loopback/test guards and
  // binds the random port to this exact labelled project before any API client.
  const identity = `  assert.equal(project, ${JSON.stringify(project)}, "Candidate fixture project mismatch.");
  assert.equal(process.env.PORTAL_CANDIDATE_OWNER, project);
  assert.equal(new URL(url).origin, ${JSON.stringify("https://127.0.0.1:" + apiPort)}, "Candidate fixture API mismatch.");
  const { execFileSync } = await import("node:child_process");
  const labels = JSON.parse(execFileSync("docker", ["inspect", "--format", "{{json .Config.Labels}}", "supabase_db_" + project], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10000 }));
  assert.equal(labels[${JSON.stringify(ownershipLabel)}], project, "Candidate fixture database ownership mismatch.");
`;
  return source
    .replace(port, port.replace('"55321"', JSON.stringify(String(apiPort))))
    .replace(client, identity + client);
}

// Hold all three loopback reservations together so the OS cannot return a port
// released by an earlier allocation. The factory seam lets the socket regression
// exercise a real bind failure; production always creates ordinary net servers.
// An injected factory must return fresh, unbound servers owned by this call.
// Return only after every temporary listener is closed, including partial failure.
// Docker owns the subsequent binds; these reservations cannot span that handoff.
export async function allocateCandidatePorts(createListener = createServer) {
  const listeners = [];
  try {
    const ports = {};
    for (const kind of ["public", "api", "mail"]) {
      const server = createListener();
      listeners.push(server);
      await new Promise((done, fail) =>
        server.once("error", fail).listen(0, "127.0.0.1", done),
      );
      ports[kind] = server.address().port;
    }
    return ports;
  } finally {
    await Promise.all(
      listeners.map(
        (server) =>
          new Promise((done, fail) =>
            server.close((error) => {
              // A failed bind has no listening handle, but earlier leases still
              // need closing. Other close errors must fail the native gate.
              if (error && error.code !== "ERR_SERVER_NOT_RUNNING") fail(error);
              else done();
            }),
          ),
      ),
    );
  }
}

// Start owned Compose resources, verify data before/after upgrading, and clean up only resources covered by the ownership contract.
export async function checkCandidate({
  baselineRoot,
  candidateRoot = root,
  baselineCommit,
  proofOutput,
} = {}) {
  assert(
    typeof baselineRoot === "string" && isAbsolute(baselineRoot),
    "An explicit archived baseline checkout is required.",
  );
  baselineRoot = resolve(baselineRoot);
  candidateRoot = resolve(candidateRoot);
  if (proofOutput) {
    assert.match(baselineCommit ?? "", /^[a-f0-9]{40}$/);
    assert(isAbsolute(proofOutput));
    proofOutput = resolve(proofOutput);
    for (
      let parent = dirname(proofOutput);
      parent !== dirname(parent);
      parent = dirname(parent)
    )
      if (existsSync(parent))
        assert(
          !lstatSync(parent).isSymbolicLink(),
          "Proof output cannot traverse symlinked directories.",
        );
    for (const checkout of [root, candidateRoot, baselineRoot]) {
      const path = relative(checkout, proofOutput);
      assert(
        path === ".." || path.startsWith("../"),
        "Proof output must stay outside source checkouts.",
      );
    }
    assert(
      !existsSync(proofOutput),
      "Refusing to overwrite an existing proof.",
    );
  }
  for (const source of [baselineRoot, candidateRoot]) {
    assert(!lstatSync(source).isSymbolicLink());
    for (const file of [
      "package.json",
      "deploy/hostinger/compose.yml",
      "deploy/hostinger/selfhost/compose.yml",
    ])
      assert(lstatSync(join(source, file)).isFile());
  }
  assert(
    totalmem() >= 6 * 1024 ** 3,
    "Candidate checks require a separate runner with at least6GiB RAM.",
  );
  const dockerHost = await assertLocalDocker();
  const project = "luminovia-portal-test-" + randomBytes(12).toString("hex");
  const scratch = mkdtempSync(join(tmpdir(), "luminovia-candidate-"));
  const scope = { project, network: project + "-backend", directory: scratch };
  const environment = cleanEnvironment({ DOCKER_HOST: dockerHost });
  delete environment.DOCKER_CONTEXT;
  for (const key of Object.keys(environment))
    if (
      /^(POSTGRES_|JWT_|PG|ANON_KEY$|SERVICE_ROLE_KEY$|DATABASE_|GH_|GITHUB_TOKEN$|ACTIONS_ID_TOKEN|NPM_TOKEN$|SSH_AUTH_SOCK$|NODE_TLS_REJECT_UNAUTHORIZED$|NODE_EXTRA_CA_CERTS$)/.test(
        key,
      )
    )
      delete environment[key];
  let secrets = [],
    configuration,
    networkCreated = false,
    cleanupMode = false,
    cancelled = false,
    summary,
    postgresProof;
  let activeChild;
  const abort = () => {
    cancelled = true;
    if (activeChild?.pid) {
      try {
        process.kill(-activeChild.pid, "SIGTERM");
      } catch {
        /* already exited */
      }
    }
  };
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  const redact = (value) => {
    let output = String(value);
    for (const secret of secrets)
      if (secret.length >= 8) output = output.replaceAll(secret, "[redacted]");
    return output
      .replace(
        /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
        "[redacted JWT]",
      )
      .replace(
        /\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+\b/g,
        "[redacted key]",
      );
  };
  const run = (file, args, options = {}) =>
    new Promise((done, fail) => {
      if (cancelled && !cleanupMode) {
        fail(new Error("Candidate check cancelled."));
        return;
      }
      const child = spawn(file, args, {
        cwd: options.cwd ?? scratch,
        env: options.env ?? environment,
        stdio: ["pipe", "pipe", "pipe"],
        detached: true,
      });
      if (!cleanupMode) activeChild = child;
      let output = "",
        errors = "";
      child.stdout.on("data", (data) => {
        output = (output + data).slice(-8 * 1024 ** 2);
      });
      child.stderr.on("data", (data) => {
        errors = (errors + data).slice(-8 * 1024 ** 2);
      });
      child.stdin.once("error", fail);
      const timeout = setTimeout(() => {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          /* exited */
        }
      }, options.timeout ?? 120000);
      child.once("error", (error) => {
        clearTimeout(timeout);
        fail(error);
      });
      child.once("close", (code) => {
        clearTimeout(timeout);
        if (activeChild === child) activeChild = null;
        if (code === 0) done(output.trim());
        else
          fail(
            new Error(
              "Candidate operation failed: " +
                file +
                " " +
                redact(errors + "\n" + output).slice(-12000),
            ),
          );
      });
      child.stdin.end(options.input);
    });
  const docker = (args, options) => run("docker", args, options);
  const composeFile = join(scratch, "candidate-compose.json");
  const compose = (args, options) =>
    docker(
      [
        "compose",
        "--project-name",
        project,
        "--project-directory",
        scratch,
        "-f",
        composeFile,
        ...args,
      ],
      options,
    );
  const inspect = async (name) =>
    JSON.parse(await docker(["inspect", name]))[0];
  const owned = async (name) => {
    const value = await inspect(name);
    assert.equal(
      value.Config.Labels[ownershipLabel],
      project,
      "Refusing an unrelated container.",
    );
    return value;
  };
  const sql = (source) =>
    docker(
      [
        "exec",
        "-i",
        "supabase_db_" + project,
        "psql",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-X",
        "-qAt",
        "-v",
        "ON_ERROR_STOP=1",
      ],
      { input: source, timeout: 180000 },
    );
  let failure, cleanupFailure;
  try {
    console.log(
      "Candidate: preparing fictional isolated ten-service topology.",
    );
    const stageSource = (sourceRoot) =>
      stageCandidateSource(sourceRoot, scratch);
    stageSource(baselineRoot);
    symlinkSync(join(root, "node_modules"), join(scratch, "node_modules"));
    writeFileSync(join(scratch, "package.json"), '{"type":"module"}\n');
    writeFileSync(
      join(scratch, "supabase/config.toml"),
      `project_id = "${project}"\n`,
    );
    const ports = await allocateCandidatePorts();
    assert.equal(new Set(Object.values(ports)).size, 3);
    const origin = "https://127.0.0.1:" + ports.public;
    const generated = createConfiguration({
      portalOrigin: origin,
      apiOrigin: origin + "/backend",
      dataDirectory: join(scratch, "runtime-data"),
      network: scope.network,
    });
    generated.server.PORTAL_DOMAIN = "candidate.invalid";
    generated.server.PORTAL_WWW_DIR = join(scratch, "www");
    generated.server.PORTAL_MAIL_TEMPLATE_ORIGIN = "http://web:8080";
    secrets = Object.entries(generated.server)
      .filter(([key]) => /KEY|SECRET|PASS/.test(key))
      .map(([, value]) => value);
    const envFile = join(scratch, "selfhost.env");
    writeConfiguration(envFile, generated);
    mkdirSync(join(scratch, "certs"));
    await run("openssl", candidateCertificateArguments(join(scratch, "certs")));
    mkdirSync(join(scratch, "www/releases/candidate"), { recursive: true });
    writeFileSync(
      join(scratch, "www/releases/candidate/index.html"),
      "<!doctype html><title>Fictional candidate fixture</title>",
    );
    symlinkSync("releases/candidate", join(scratch, "www/current"));
    const renderConfiguration = async () => {
      const templates = join(scratch, "deploy/hostinger/mail-templates");
      mkdirSync(templates, { recursive: true });
      for (const name of ["invite", "recovery"])
        copyFileSync(
          join(scratch, "supabase/templates", name + ".html"),
          join(templates, name + ".html"),
        );
      const caddy = readFileSync(
        join(scratch, "deploy/hostinger/Caddyfile"),
        "utf8",
      )
        .replace("admin off", "admin off\n auto_https off")
        .replace(
          "{$PORTAL_DOMAIN} {",
          "https://:8443 {\n tls /certs/cert.pem /certs/key.pem",
        );
      assert(!caddy.includes("{$PORTAL_DOMAIN} {"));
      writeFileSync(
        join(scratch, "deploy/hostinger/Caddyfile"),
        caddy +
          "\nhttps://:8444 {\n tls /certs/cert.pem /certs/key.pem\n reverse_proxy api:8000\n}\nhttps://:8445 {\n tls /certs/cert.pem /certs/key.pem\n reverse_proxy mailpit:8025\n}\nhttp://:8080 {\n handle_path /mail-templates/* {\n root * /mail-templates\n file_server\n }\n}\n",
      );
      const rendered = [];
      for (const subdirectory of [
        "deploy/hostinger/selfhost",
        "deploy/hostinger",
      ]) {
        const location = join(scratch, subdirectory);
        rendered.push(
          JSON.parse(
            await docker([
              "compose",
              "--project-directory",
              location,
              "--env-file",
              envFile,
              "-f",
              join(location, "compose.yml"),
              "config",
              "--format",
              "json",
            ]),
          ),
        );
      }
      configuration = {
        name: project,
        services: { ...rendered[0].services, ...rendered[1].services },
        networks: { backend: { external: true, name: scope.network } },
        volumes: {},
      };
      for (const config of rendered)
        for (const [name] of Object.entries(config.volumes ?? {}))
          configuration.volumes[name] = {
            name: project + "_" + name,
            labels: { [ownershipLabel]: project },
          };
      for (const service of Object.values(configuration.services)) {
        service.labels = { ...service.labels, [ownershipLabel]: project };
        service.restart = "no";
        service.ports = [];
      }
      configuration.services.db.container_name = "supabase_db_" + project;
      configuration.services.clamav.container_name =
        "portal_scanner_" + project;
      configuration.services.web.ports = Object.entries(ports).map(
        ([kind, published]) => ({
          target: { public: 8443, api: 8444, mail: 8445 }[kind],
          published: String(published),
          host_ip: "127.0.0.1",
          protocol: "tcp",
        }),
      );
      configuration.services.web.volumes.push({
        type: "bind",
        source: join(scratch, "certs"),
        target: "/certs",
        read_only: true,
      });
      assertCandidateConfiguration(configuration, scope);
      writeFileSync(composeFile, JSON.stringify(configuration), {
        mode: 0o600,
      });
      await compose(["config", "--quiet"]);
    };
    await renderConfiguration();
    await docker([
      "network",
      "create",
      "--label",
      ownershipLabel + "=" + project,
      scope.network,
    ]);
    networkCreated = true;
    console.log(
      "Candidate: pulling exact source pins and starting health-gated services.",
    );
    await compose(["pull", "--quiet"], { timeout: 600000 });
    for (const name of ["postgres", "storage", "mailpit"])
      mkdirSync(join(scratch, "runtime-data", name), {
        recursive: true,
        mode: 0o700,
      });
    const storageImage = configuration.services.storage.image;
    const identity = (
      await docker([
        "run",
        "--rm",
        "--network",
        "none",
        "--label",
        ownershipLabel + "=" + project,
        "--entrypoint",
        "/bin/sh",
        storageImage,
        "-c",
        "id -u; id -g",
      ])
    ).split(/\s+/);
    assert(
      identity.length === 2 && identity.every((value) => /^\d+$/.test(value)),
    );
    await docker([
      "run",
      "--rm",
      "--network",
      "none",
      "--user",
      "0",
      "--label",
      ownershipLabel + "=" + project,
      "--mount",
      "type=bind,src=" +
        join(scratch, "runtime-data/storage") +
        ",dst=/candidate-data",
      "--entrypoint",
      "/bin/sh",
      configuration.services.web.image,
      "-c",
      "chown " +
        identity.join(":") +
        " /candidate-data; chmod 0700 /candidate-data",
    ]);
    await compose(["up", "-d", "--wait", "--wait-timeout", "600"], {
      timeout: 660000,
    });
    for (const name of expectedServices) {
      const id = await compose(["ps", "-q", name]),
        value = await owned(id);
      assert.equal(value.State.Status, "running");
      if (name !== "web") assert.equal(value.State.Health.Status, "healthy");
      assert.deepEqual(Object.keys(value.NetworkSettings.Networks), [
        scope.network,
      ]);
      for (const bindings of Object.values(value.HostConfig.PortBindings ?? {}))
        for (const binding of bindings ?? [])
          assert.equal(binding.HostIp, "127.0.0.1");
    }
    assert.equal(
      await sql(
        "SELECT (to_regclass('auth.users') IS NOT NULL AND to_regclass('storage.buckets') IS NOT NULL AND EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime'))::text;",
      ),
      "true",
    );
    await sql(
      "CREATE SCHEMA IF NOT EXISTS supabase_migrations; CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations(version text PRIMARY KEY, statements text[], name text);",
    );
    const replay = async () => {
      const migrations = readdirSync(join(scratch, "supabase/migrations"))
        .filter((name) => /^\d{14}_[a-z0-9_]+\.sql$/.test(name))
        .sort();
      assert(
        migrations.length >= 14,
        "Complete application history is required.",
      );
      const applied = JSON.parse(
        await sql(
          "SELECT coalesce(json_agg(json_build_object('version',version,'source',statements[1])),'[]'::json)::text FROM supabase_migrations.schema_migrations;",
        ),
      );
      const sources = new Map(
        migrations.map((name) => [
          name.slice(0, 14),
          readFileSync(join(scratch, "supabase/migrations", name), "utf8"),
        ]),
      );
      for (const record of applied)
        assert.equal(
          sources.get(record.version),
          record.source,
          "An applied baseline migration was changed or removed.",
        );
      const versions = new Set(applied.map((record) => record.version));
      for (const filename of migrations)
        if (!versions.has(filename.slice(0, 14))) {
          assert(
            !applied.length ||
              filename.slice(0, 14) >
                applied
                  .map((record) => record.version)
                  .sort()
                  .at(-1),
            "Out-of-order candidate migration.",
          );
          await sql(
            migrationWithHistory(filename, sources.get(filename.slice(0, 14))),
          );
        }
      const recorded = JSON.parse(
        await sql(
          "SELECT json_agg(json_build_object('version',version,'source',statements[1]) ORDER BY version)::text FROM supabase_migrations.schema_migrations;",
        ),
      );
      assert.equal(recorded.length, migrations.length);
      for (const record of recorded)
        assert.equal(hash(record.source), hash(sources.get(record.version)));
      return migrations;
    };
    let migrations = await replay();
    await sql("NOTIFY pgrst,'reload schema';");
    const fixtureEnvironment = {
      SUPABASE_URL: "https://127.0.0.1:" + ports.api,
      SUPABASE_SERVICE_ROLE_KEY: generated.server.SERVICE_ROLE_KEY,
      SUPABASE_ANON_KEY: generated.server.ANON_KEY,
      E2E_PASSWORD:
        "Candidate!" + randomBytes(24).toString("base64url") + "Aa9",
      PORTAL_APP_ORIGIN: origin,
      E2E_BASE_URL: origin,
      E2E_MAILPIT_URL: "https://127.0.0.1:" + ports.mail,
    };
    secrets.push(fixtureEnvironment.E2E_PASSWORD);
    writeFileSync(
      join(scratch, ".env.test.local"),
      Object.entries(fixtureEnvironment)
        .map(([key, value]) => key + "=" + value)
        .join("\n") + "\n",
      { mode: 0o600 },
    );
    const childEnvironment = {
      ...environment,
      ...fixtureEnvironment,
      PORTAL_TEST_MODE: "1",
      PORTAL_CANDIDATE_OWNER: project,
      PORTAL_DB_CONTAINER: "supabase_db_" + project,
      NODE_EXTRA_CA_CERTS: join(scratch, "certs/cert.pem"),
      // The actual Python SMTP worker also calls the candidate HTTPS API.
      // Trust only this fixture CA, retaining hostname/certificate checks.
      SSL_CERT_FILE: join(scratch, "certs/cert.pem"),
    };
    console.log(
      "Candidate: baseline initialized; seeding and retaining real password/MFA/private event/scanned bytes.",
    );
    await run(process.execPath, [join(scratch, "scripts/local-seed.mjs")], {
      env: childEnvironment,
      timeout: 240000,
    });
    const probe = join(
      root,
      "deploy/hostinger/maintenance/candidate-upgrade-probe.mjs",
    );
    await run(process.execPath, [probe, "--create"], {
      env: childEnvironment,
      timeout: 120000,
    });
    const baselineImages = Object.fromEntries(
      Object.entries(configuration.services).map(([name, service]) => [
        name,
        service.image,
      ]),
    );
    const roleSnapshotSQL =
      "SELECT json_build_object('roles',(SELECT json_agg(r ORDER BY r.rolname) FROM (SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolconnlimit,rolbypassrls,rolvaliduntil FROM pg_roles) r),'memberships',(SELECT json_agg(m ORDER BY m.role,m.member,m.grantor) FROM (SELECT r.rolname AS role,u.rolname AS member,g.rolname AS grantor,a.admin_option,a.inherit_option,a.set_option FROM pg_auth_members a JOIN pg_roles r ON r.oid=a.roleid JOIN pg_roles u ON u.oid=a.member JOIN pg_roles g ON g.oid=a.grantor) m))::text;";
    const baselineRoles = JSON.parse(await sql(roleSnapshotSQL));
    // Stop writers before replacing mounted source; all data, keys and volumes survive.
    await compose(["stop"], { timeout: 120000 });
    stageSource(candidateRoot);
    await renderConfiguration();
    assert.match(baselineImages.db, /^supabase\/postgres:17\./);
    assert.match(
      configuration.services.db.image,
      /^supabase\/postgres:17\./,
      "Major PostgreSQL upgrades require a dedicated migration procedure.",
    );
    const changedImages = Object.keys(baselineImages).filter(
      (name) => baselineImages[name] !== configuration.services[name].image,
    );
    await compose(["pull", "--quiet"], { timeout: 600000 });
    await compose(
      ["up", "-d", "--wait", "--wait-timeout", "600", "--force-recreate"],
      { timeout: 660000 },
    );
    for (const name of expectedServices) {
      const value = await owned(await compose(["ps", "-q", name]));
      assert.equal(value.State.Status, "running");
      if (name !== "web") assert.equal(value.State.Health.Status, "healthy");
    }
    migrations = await replay();
    assert.deepEqual(
      JSON.parse(await sql(roleSnapshotSQL)),
      baselineRoles,
      "Baseline database roles, grantors and membership options changed.",
    );
    await sql("NOTIFY pgrst,'reload schema';");
    await run(process.execPath, [probe, "--verify"], {
      env: childEnvironment,
      timeout: 120000,
    });
    console.log(
      "PASS candidate retained-data upgrade: " +
        changedImages.length +
        " changed images; existing password/MFA/roles/private event/scanned bytes and migration history survived.",
    );
    const publicGet = (path, headers = {}) =>
      new Promise((done, fail) => {
        const request = httpsRequest(
          origin + path,
          {
            ca: readFileSync(join(scratch, "certs/cert.pem")),
            headers,
            timeout: 20000,
          },
          (response) => {
            let body = "";
            response.on("data", (chunk) => {
              body += chunk;
            });
            response.on("end", () =>
              done({
                status: response.statusCode,
                body,
                headers: response.headers,
              }),
            );
          },
        );
        request.once("error", fail);
        request.once("timeout", () =>
          request.destroy(new Error("Candidate HTTPS timeout")),
        );
        request.end();
      });
    assert.equal((await publicGet("/")).status, 200);
    assert.equal((await publicGet("/backend/auth/v1/admin/users")).status, 404);
    const jwks = await publicGet("/backend/auth/v1/.well-known/jwks.json", {
      apikey: generated.server.SUPABASE_PUBLISHABLE_KEY,
    });
    assert.equal(jwks.status, 200);
    assert(
      JSON.parse(jwks.body).keys.every(
        (key) =>
          ["EC", "RSA", "OKP"].includes(key.kty) &&
          !["d", "k", "p", "q"].some((field) => field in key),
      ),
    );
    let schemaReady = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      const response = await publicGet(
        "/backend/rest/v1/profiles?select=id&limit=1",
        {
          apikey: generated.server.SERVICE_ROLE_KEY,
          Authorization: "Bearer " + generated.server.SERVICE_ROLE_KEY,
        },
      );
      if (response.status === 200) {
        schemaReady = true;
        break;
      }
      await new Promise((done) => setTimeout(done, 200));
    }
    assert(schemaReady, "Candidate REST schema did not finish loading.");
    // The retained baseline can predate candidate-only commercial settings.
    // Bootstrap fictional acceptance data only after the upgrade/retention proof,
    // using the same exact owned project and environment as the API suites.
    await run(process.execPath, [join(scratch, "scripts/local-seed.mjs")], {
      env: childEnvironment,
      timeout: 240000,
    });
    console.log(
      "Candidate: TLS/public boundaries and complete migration replay passed; running actual API suites.",
    );
    const apiFixture = join(scratch, "scripts/testing/api.mjs");
    if (existsSync(apiFixture))
      writeFileSync(
        apiFixture,
        adaptCandidateApiFixture(readFileSync(apiFixture, "utf8"), {
          project,
          apiPort: ports.api,
        }),
      );
    const suites = candidateApiSuites(scratch);
    // The candidate shares one Supabase Auth service; concurrent fixture
    // deletion can fail inside GoTrue despite unique account IDs.
    for (const suite of suites) {
      await owned("supabase_db_" + project);
      await owned("portal_scanner_" + project);
      await run(process.execPath, [join(scratch, "scripts", suite)], {
        env: childEnvironment,
        timeout: 240000,
      });
      console.log("PASS candidate " + suite);
    }
    summary = {
      status: "passed",
      topology: "actual candidate ten-service selfhost Compose",
      migrations: migrations.length,
      baselineUpgradePassed: true,
      changedImages,
      retainedPasswordMfaPrivateEventAndFile: true,
      suites: suites.length,
      realTlsWebSockets: true,
      claims: 50,
      privateMailpit: true,
      fictionalOnly: true,
    };
    if (proofOutput && baselineImages.db !== configuration.services.db.image) {
      const migrationInventory = migrations.map((name) => ({
        path: "supabase/migrations/" + name,
        sha256: hash(readFileSync(join(scratch, "supabase/migrations", name))),
      }));
      postgresProof = {
        schemaVersion: 1,
        sourceImage: baselineImages.db,
        targetImage: configuration.services.db.image,
        postgresMajor: 17,
        sourceCommit: baselineCommit,
        migrationInventory,
        migrationInventorySha256: hash(JSON.stringify(migrationInventory)),
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
  } catch (error) {
    failure = error;
  } finally {
    cleanupMode = true;
    try {
      const ids = (
        await docker([
          "ps",
          "-aq",
          "--filter",
          "label=" + ownershipLabel + "=" + project,
        ])
      )
        .split(/\s+/)
        .filter(Boolean);
      for (const id of ids) {
        await owned(id);
        await docker(["rm", "--force", id]);
      }
      const volumes = (
        await docker([
          "volume",
          "ls",
          "-q",
          "--filter",
          "label=" + ownershipLabel + "=" + project,
        ])
      )
        .split(/\s+/)
        .filter(Boolean);
      for (const volume of volumes) {
        const metadata = JSON.parse(
          await docker(["volume", "inspect", volume]),
        )[0];
        assert.equal(metadata.Labels[ownershipLabel], project);
        assert(volume.startsWith(project + "_"));
        await docker(["volume", "rm", volume]);
      }
      if (networkCreated) {
        const metadata = JSON.parse(
          await docker(["network", "inspect", scope.network]),
        )[0];
        assert.equal(metadata.Labels[ownershipLabel], project);
        assert.equal(Object.keys(metadata.Containers).length, 0);
        await docker(["network", "rm", scope.network]);
      }
      if (configuration && existsSync(join(scratch, "runtime-data")))
        await docker([
          "run",
          "--rm",
          "--network",
          "none",
          "--user",
          "0",
          "--label",
          ownershipLabel + "=" + project,
          "--mount",
          "type=bind,src=" + scratch + ",dst=/candidate",
          "--entrypoint",
          "/bin/sh",
          configuration.services.web.image,
          "-c",
          "rm -rf /candidate/runtime-data",
        ]);
      rmSync(scratch, { recursive: true, force: true });
      console.log(
        "Candidate owned containers, volumes, network and fictional scratch data cleaned.",
      );
    } catch (error) {
      cleanupFailure = error;
    }
    process.removeListener("SIGINT", abort);
    process.removeListener("SIGTERM", abort);
  }
  if (failure || cleanupFailure)
    throw new AggregateError(
      [failure, cleanupFailure].filter(Boolean),
      "Candidate acceptance or owned cleanup failed.",
    );
  if (postgresProof) {
    mkdirSync(resolve(proofOutput, ".."), { recursive: true, mode: 0o700 });
    writeFileSync(proofOutput, JSON.stringify(postgresProof, null, 2) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
  }
  console.log(JSON.stringify({ ...summary, cleanupPassed: true }));
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  if (args[0] === "--run") {
    try {
      assert(args.length >= 3 && args.length % 2 === 1);
      const options = {};
      for (let index = 1; index < args.length; index += 2) {
        assert(
          ["--baseline-root", "--baseline-commit", "--proof-output"].includes(
            args[index],
          ) && !(args[index] in options),
        );
        options[args[index]] = args[index + 1];
      }
      await checkCandidate({
        baselineRoot: options["--baseline-root"],
        baselineCommit: options["--baseline-commit"],
        proofOutput: options["--proof-output"],
      });
    } catch (error) {
      console.error(error.message);
      for (const cause of error.errors ?? []) console.error(cause.message);
      process.exitCode = 1;
    }
  } else if (!args.length || (args.length === 1 && args[0] === "--help")) {
    console.log(
      "Read-only by default. --run --baseline-root ABSOLUTE_ARCHIVED_CHECKOUT tests a real retained-data old-to-candidate ten-service upgrade with fictional data and removes only owned resources. Requires Docker, OpenSSL and npm ci; never run on KVM1.",
    );
  } else {
    console.error(
      "Use --run --baseline-root ABSOLUTE_ARCHIVED_CHECKOUT, or --help.",
    );
    process.exitCode = 1;
  }
}
