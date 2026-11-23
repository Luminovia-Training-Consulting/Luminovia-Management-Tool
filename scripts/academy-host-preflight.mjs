/** Read-only host admission for one already verified Academy staging plan. */
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import {
  accessSync,
  constants,
  lstatSync,
  statSync,
  realpathSync,
  statfsSync,
} from "node:fs";
import { availableParallelism, networkInterfaces, totalmem } from "node:os";
import { isIPv4 } from "node:net";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { describeAcademyRuntime } from "./academy-runtime-config.mjs";

const repository = fileURLToPath(new URL("..", import.meta.url));
const docker = ["--host", "unix:///var/run/docker.sock"];
const gib = 1024n ** 3n;
const minMemory = (7n * gib) / 2n;
const minCpu = 2;
const ingressPorts = [80, 443];

function command(name, args) {
  return spawnSync(name, args, {
    cwd: repository,
    env: {
      PATH: process.env.PATH,
      LANG: "C",
      LC_ALL: "C",
      GIT_OPTIONAL_LOCKS: "0",
    },
    encoding: "utf8",
    timeout: 15_000,
    maxBuffer: 256 * 1024,
  });
}

function privatePath(path) {
  try {
    if (realpathSync(path) !== path) return false;
    const directory = lstatSync(path);
    if (
      !directory.isDirectory() ||
      directory.uid !== process.getuid() ||
      directory.mode & 0o077
    )
      return false;
    accessSync(path, constants.W_OK | constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function filesystem(path) {
  const info = statSync(path, { bigint: true });
  const storage = statfsSync(path, { bigint: true });
  return { device: info.dev, available: storage.bavail * storage.bsize };
}

/** Read the live kernel listener table. IPv6 wildcard is treated as possibly dual-stack. */
export function busyAcademyIngressPorts(output, address) {
  const used = new Set();
  for (const line of output.trim().split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [, , , endpoint] = line.trim().split(/\s+/);
    const match = /^(.+):(80|443)$/.exec(endpoint ?? "");
    if (!match) continue;
    const host = match[1].replace(/^\[|\]$/g, "").replace(/^::ffff:/, "");
    if (
      host === address ||
      ["*", "::", "0.0.0.0"].includes(host) ||
      (address === "0.0.0.0" && isIPv4(host))
    )
      used.add(Number(match[2]));
  }
  return ingressPorts.filter((port) => used.has(port));
}

function readDocker(result) {
  if (result.status !== 0) return null;
  try {
    const info = JSON.parse(result.stdout);
    if (
      info.OSType !== "linux" ||
      !Number.isSafeInteger(info.NCPU) ||
      !Number.isSafeInteger(info.MemTotal) ||
      !isAbsolute(info.DockerRootDir ?? "") ||
      !Array.isArray(info.SecurityOptions) ||
      info.SecurityOptions.some((item) => String(item).includes("rootless"))
    )
      return null;
    return info;
  } catch {
    return null;
  }
}

/** A blocked report permits a clean retry after remediation. No command pulls an image or opens a listener. */
export async function checkAcademyHost(
  { root, config, plan, publicConfig, readPrivate },
  {
    run = command,
    platform = process.platform,
    architecture = process.arch,
    nodeVersion = process.versions.node,
    cpu = availableParallelism,
    memory = totalmem,
    localAddresses = networkInterfaces,
    isPrivateDirectory = privatePath,
    disk = filesystem,
    releaseFile = () => readFile(join(repository, ".node-version"), "utf8"),
    readOsRelease = () => readFile("/etc/os-release", "utf8"),
  } = {},
) {
  const failures = [];
  const results = {};
  const check = (name, ok, details = {}) => {
    results[name] = { ok, ...details };
    if (!ok) failures.push(name);
  };
  const finish = () => ({
    version: 1,
    status: failures.length ? "blocked" : "verified",
    checks: results,
    failures,
  });

  const platformSupported = platform === "linux";
  const expectedArchitecture = { x64: "x86_64", arm64: "aarch64" }[
    architecture
  ];
  check("linux", platformSupported);
  check("architecture", Boolean(expectedArchitecture), { architecture });
  if (!platformSupported || !expectedArchitecture) return finish();

  let distribution = null;
  try {
    const os = parseEnv(await readOsRelease());
    if (/^[a-z][a-z0-9_-]*$/.test(os.ID ?? "")) distribution = os.ID;
  } catch {
    // The operator needs a recognizable installation host.
  }
  check("os_distribution", distribution !== null, { id: distribution });
  const paths = isAbsolute(root)
    ? ["", "data", "backups", "browser"].map((name) => join(root, name))
    : [];
  if (
    !isAbsolute(root) ||
    resolve(root) !== root ||
    !paths.every(isPrivateDirectory)
  ) {
    check("private_runtime", false);
    return finish();
  }
  let address;
  try {
    const identity = JSON.parse(
      String(await readPrivate(join(root, "installation.json"))),
    );
    const env = parseEnv(String(await readPrivate(join(root, "runtime.env"))));
    const expected = describeAcademyRuntime({
      root,
      installationId: plan.release.installation_id,
      edition: plan.release.edition,
      portalOrigin: plan.browser.origin,
    });
    const expectedEnvironment = {
      ACADEMY_INSTALLATION_ID: expected.installation_id,
      ACADEMY_EDITION: expected.edition,
      COMPOSE_PROJECT_NAME: expected.compose_project,
      PORTAL_BACKEND_NETWORK: expected.backend_network,
      PORTAL_DATA_DIR: expected.data_directory,
      PORTAL_WWW_DIR: expected.browser_directory,
      PORTAL_DOMAIN: new URL(expected.portal_origin).hostname,
      PORTAL_APP_ORIGIN: expected.portal_origin,
      SUPABASE_PUBLIC_URL: expected.api_base_url,
      SUPABASE_PUBLISHABLE_KEY: publicConfig.VITE_SUPABASE_PUBLISHABLE_KEY,
    };
    if (
      !Object.entries(expected).every(
        ([key, value]) => identity[key] === value,
      ) ||
      ![
        "compose_project",
        "backend_network",
        "data_directory",
        "backup_directory",
      ].every((key) => config[key] === expected[key]) ||
      config.api_base_url.replace(/\/$/, "") !== expected.api_base_url ||
      !Object.entries(expectedEnvironment).every(
        ([key, value]) => env[key] === value,
      )
    )
      throw new Error("invalid host target");
    address = env.ACADEMY_BIND_ADDRESS;
  } catch {
    check("private_runtime", false);
    return finish();
  }
  check("private_runtime", true);

  let pinnedNode = "";
  try {
    pinnedNode = String(await releaseFile()).trim();
  } catch {
    // A missing pin blocks install with the same result as a mismatch.
  }
  check("node_version", nodeVersion === pinnedNode);
  const revision = run("git", ["rev-parse", "--verify", "HEAD"]);
  const trackedChanges = run("git", ["diff", "--quiet", "HEAD", "--"]);
  check(
    "reviewed_checkout",
    revision.status === 0 &&
      revision.stdout.trim() === plan.release.source_revision &&
      trackedChanges.status === 0,
  );
  const python = run("python3", [
    "-c",
    "import sys; sys.exit(sys.version_info < (3, 12))",
  ]);
  check("python_3_12", python.status === 0);
  check("flock", run("flock", ["--version"]).status === 0);
  check("age", run("age", ["--version"]).status === 0);

  const info = readDocker(
    run("docker", [...docker, "info", "--format", "{{json .}}"]),
  );
  check("local_rootful_docker", Boolean(info));
  check(
    "compose_configuration",
    Boolean(info) &&
      run("docker", [
        ...docker,
        "compose",
        "--env-file",
        join(root, "runtime.env"),
        "-f",
        "deploy/hostinger/selfhost/compose.yml",
        "-f",
        "deploy/academy/compose.override.yml",
        "--profile",
        "ingress",
        "--profile",
        "notification-mail",
        "config",
        "--quiet",
      ]).status === 0,
  );
  if (info) {
    check(
      "docker_architecture",
      info.Architecture === expectedArchitecture ||
        info.Architecture === architecture,
    );
    const cores = Math.min(info.NCPU, cpu());
    check("cpu", cores >= minCpu, { available: cores, minimum: minCpu });
    const ram = BigInt(Math.min(info.MemTotal, memory()));
    check("ram", ram >= minMemory, {
      available_bytes: String(ram),
      required_bytes: String(minMemory),
    });

    // Shared volumes have one pool of free blocks. Reserve capacity for
    // Storage and one separate full backup without counting free space twice.
    const quota = BigInt(plan.licensed_limits.storage_bytes);
    const pools = new Map();
    try {
      for (const [path, name, required] of [
        [root, "runtime", 2n * gib],
        [join(root, "data"), "data", quota],
        [join(root, "backups"), "backup", quota + 2n * gib],
        [info.DockerRootDir, "docker", 6n * gib],
      ]) {
        const { device, available } = disk(path);
        const pool = pools.get(device) ?? {
          areas: [],
          available,
          required: 0n,
        };
        pool.areas.push(name);
        if (available < pool.available) pool.available = available;
        pool.required += required;
        pools.set(device, pool);
      }
      const filesystems = [...pools.values()].map(
        ({ areas, available, required }) => ({
          areas,
          available_bytes: String(available),
          required_bytes: String(required),
          sufficient: available >= required,
        }),
      );
      check(
        "disk",
        filesystems.every((pool) => pool.sufficient),
        { filesystems },
      );
    } catch {
      check("disk", false);
    }
  }
  const bindable =
    isIPv4(address) &&
    (address === "0.0.0.0" ||
      Object.values(localAddresses())
        .flat()
        .some((item) => item?.address === address));
  check("ingress_bind_address", bindable);
  const listeners = run("ss", [
    "-Hln",
    "-t",
    "( sport = :80 or sport = :443 )",
  ]);
  const busy =
    listeners.status === 0
      ? busyAcademyIngressPorts(listeners.stdout, address)
      : [];
  check("ingress_ports", bindable && listeners.status === 0 && !busy.length, {
    ports: ingressPorts,
    busy,
  });
  return finish();
}
