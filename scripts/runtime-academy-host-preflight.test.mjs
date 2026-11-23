import assert from "node:assert/strict";
import {
  chmod,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseEnv } from "node:util";
import {
  busyAcademyIngressPorts,
  checkAcademyHost,
} from "./academy-host-preflight.mjs";
import { initializeAcademyRuntime } from "./academy-runtime-config.mjs";
import { readAcademyOperatorInput } from "./academy-staging-plan.mjs";

const GiB = 1024n ** 3n;
const sourceRevision = "1".repeat(40);
const fixture = async (t) => {
  const parent = await mkdtemp(join(tmpdir(), "academy-host-test-"));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const root = join(parent, "tenant");
  const identity = initializeAcademyRuntime({
    root,
    installationId: "057fbb69-c47a-4bce-a882-2c69400bb05b",
    edition: "customer-self-hosted",
    portalOrigin: "https://academy.example.invalid",
    bindAddress: "127.0.0.1",
  });
  const env = await readFile(join(root, "runtime.env"), "utf8");
  const input = {
    root,
    config: identity,
    plan: {
      release: { ...identity, source_revision: sourceRevision },
      browser: { origin: identity.portal_origin },
      licensed_limits: { storage_bytes: Number(5n * GiB) },
    },
    publicConfig: parseEnv(
      await readFile(join(root, "runtime.env.public.env"), "utf8"),
    ),
    readPrivate: readAcademyOperatorInput,
  };
  const docker = {
    OSType: "linux",
    Architecture: "x86_64",
    NCPU: 4,
    MemTotal: Number(8n * GiB),
    SecurityOptions: [],
    DockerRootDir: "/var/lib/docker",
  };
  const probes = {
    platform: "linux",
    architecture: "x64",
    nodeVersion: "26.13.1",
    releaseFile: async () => "26.13.1\n",
    readOsRelease: async () => "ID=debian\nVERSION_ID=12",
    cpu: () => 4,
    memory: () => Number(8n * GiB),
    localAddresses: () => ({ lo: [{ address: "127.0.0.1" }] }),
    disk: () => ({ device: 1n, available: 32n * GiB }),
    run(name, args) {
      if (name === "git") {
        if (args[0] === "rev-parse")
          return { status: 0, stdout: sourceRevision + "\n" };
        assert.deepEqual(args, ["diff", "--quiet", "HEAD", "--"]);
      }
      if (name === "docker") {
        assert.deepEqual(args.slice(0, 2), [
          "--host",
          "unix:///var/run/docker.sock",
        ]);
        if (args[2] === "info")
          return { status: 0, stdout: JSON.stringify(docker) };
        assert.equal(args[2], "compose");
        assert.deepEqual(args.slice(-2), ["config", "--quiet"]);
      }
      if (name === "ss")
        assert.deepEqual(args, [
          "-Hln",
          "-t",
          "( sport = :80 or sport = :443 )",
        ]);
      assert.ok(
        ["git", "docker", "ss", "python3", "age", "flock"].includes(name),
      );
      return { status: 0, stdout: "" };
    },
  };
  return { input, probes, docker, env, root };
};

test("checks signed target resources and commands without printing credentials or creating runtime state", async (t) => {
  const { input, probes, root, env } = await fixture(t);
  const before = await readdir(root);
  const report = await checkAcademyHost(input, probes);
  assert.equal(report.status, "verified");
  assert.deepEqual(report.checks.disk.filesystems, [
    {
      areas: ["runtime", "data", "backup", "docker"],
      required_bytes: String(20n * GiB),
      available_bytes: String(32n * GiB),
      sufficient: true,
    },
  ]);
  assert.ok(!JSON.stringify(report).includes(parseEnv(env).POSTGRES_PASSWORD));
  assert.ok(
    !JSON.stringify(report).includes(
      input.publicConfig.VITE_SUPABASE_PUBLISHABLE_KEY,
    ),
  );
  assert.deepEqual(await readdir(root), before);
  assert.deepEqual(await readdir(join(root, "browser")), []);
});

test("blocks incompatible host and insufficient shared storage, then retries without partial activation", async (t) => {
  const { input, probes, docker, root, env } = await fixture(t);
  const originalRun = probes.run;
  const blockers = {
    ...probes,
    cpu: () => 1,
    memory: () => Number(3n * GiB),
    disk: () => ({ device: 1n, available: 19n * GiB }),
    run(name, args) {
      if (name === "ss")
        return { status: 0, stdout: "LISTEN 0 20 0.0.0.0:443 0.0.0.0:*\n" };
      if (name === "age") return { status: null };
      if (name === "docker" && args[2] === "compose")
        return { status: 1, stderr: env };
      return originalRun(name, args);
    },
  };
  const blocked = await checkAcademyHost(input, blockers);
  assert.equal(blocked.status, "blocked");
  assert.deepEqual(blocked.failures, [
    "age",
    "compose_configuration",
    "cpu",
    "ram",
    "disk",
    "ingress_ports",
  ]);
  assert.deepEqual(blocked.checks.ingress_ports.busy, [443]);
  assert.ok(!JSON.stringify(blocked).includes(parseEnv(env).POSTGRES_PASSWORD));
  assert.deepEqual(await readdir(join(root, "data")), []);
  assert.deepEqual(await readdir(join(root, "browser")), []);
  assert.equal(await readFile(join(root, "runtime.env"), "utf8"), env);
  assert.equal((await checkAcademyHost(input, probes)).status, "verified");
  docker.SecurityOptions.push("name=rootless");
  assert.equal(
    (await checkAcademyHost(input, probes)).checks.local_rootful_docker.ok,
    false,
  );
  assert.deepEqual(
    (await checkAcademyHost(input, { ...probes, architecture: "ia32" }))
      .failures,
    ["architecture"],
  );
  assert.deepEqual(
    (await checkAcademyHost(input, { ...probes, platform: "darwin" })).failures,
    ["linux"],
  );
});

test("does not accept a mismatched environment, unavailable local address or private files with an unsafe mode", async (t) => {
  const { input, probes, root, env } = await fixture(t);
  const envPath = join(root, "runtime.env");
  await writeFile(
    envPath,
    env.replace(
      /^ACADEMY_BIND_ADDRESS=.*$/m,
      "ACADEMY_BIND_ADDRESS='192.0.2.5'",
    ),
  );
  assert.deepEqual((await checkAcademyHost(input, probes)).failures, [
    "ingress_bind_address",
    "ingress_ports",
  ]);
  await writeFile(
    envPath,
    env.replace(
      /^COMPOSE_PROJECT_NAME=.*$/m,
      "COMPOSE_PROJECT_NAME='different-installation'",
    ),
  );
  assert.deepEqual((await checkAcademyHost(input, probes)).failures, [
    "private_runtime",
  ]);
  await writeFile(envPath, env);
  await chmod(envPath, 0o644);
  // The host operator loader refuses duplicate links, symlinks and oversized
  // inputs. The private runtime itself must remain owner-only.
  await chmod(root, 0o755);
  assert.deepEqual((await checkAcademyHost(input, probes)).failures, [
    "private_runtime",
  ]);
});

test("reports occupancies only on the selected address or an overlapping wildcard", () => {
  const table = [
    "LISTEN 0 10 192.0.2.10:80 0.0.0.0:*",
    "LISTEN 0 10 127.0.0.1:22 0.0.0.0:*",
    "LISTEN 0 10 [::]:443 [::]:*",
  ].join("\n");
  assert.deepEqual(busyAcademyIngressPorts(table, "127.0.0.1"), [443]);
  assert.deepEqual(busyAcademyIngressPorts(table, "0.0.0.0"), [80, 443]);
  assert.deepEqual(busyAcademyIngressPorts(table, "192.0.2.10"), [80, 443]);
});
