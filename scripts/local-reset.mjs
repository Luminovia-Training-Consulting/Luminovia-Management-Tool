/** Reset one explicitly confirmed local development project and start its fresh fixture. */
import assert from "node:assert/strict";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { localUrl, projectConfig } from "./runtime-lib.mjs";
import {
  assertContainerBindings,
  assertNetworkDefinition,
  networkName,
} from "./runtime-network.mjs";

const supabaseOwner = "com.supabase.cli.project";
const scannerOwner = "org.luminovia.portal";
const supportedProject = /^luminovia-portal(?:-test-[a-f0-9]{8})?$/;
const generatedRuntimeFiles = [
  "ACCOUNTS.txt",
  "ADMIN-DEMO.txt",
  "bootstrap.json",
  "clamd.conf",
  "functions.env",
  "runtime.json",
  "runtime.log",
  "services.env",
  "supervisor.log",
];
const generatedFiles = [
  ".env.local",
  ".env.test.local",
  "supabase/.branches/_current_branch",
  ...generatedRuntimeFiles.map((name) => `.local/${name}`),
];

function maybeFile(path) {
  return lstatSync(path, { throwIfNoEntry: false });
}

function requireDirectory(path, optional = false) {
  const info = maybeFile(path);
  if (!info && optional) return;
  if (
    !info?.isDirectory() ||
    info.uid !== process.getuid() ||
    realpathSync(path) !== path
  )
    throw new Error(
      "Refusing to reset with a linked or unowned local configuration directory.",
    );
}

function readOwnedFile(path) {
  const file = openSync(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const info = fstatSync(file);
    if (
      !info.isFile() ||
      info.uid !== process.getuid() ||
      info.nlink !== 1 ||
      info.size > 64 * 1024
    )
      throw new Error(
        "Refusing to reset with an invalid local configuration file.",
      );
    return readFileSync(file, "utf8");
  } finally {
    closeSync(file);
  }
}

function checkGeneratedEnvironment(checkout, config) {
  for (const [file, apiKey] of [
    [".env.local", "VITE_SUPABASE_URL"],
    [".env.test.local", "SUPABASE_URL"],
  ]) {
    const path = join(checkout, file);
    if (!maybeFile(path)) continue;
    const env = Object.fromEntries(
      readOwnedFile(path)
        .split(/\r?\n/)
        .filter((line) => /^[A-Z0-9_]+=/.test(line))
        .map((line) => [
          line.slice(0, line.indexOf("=")),
          line.slice(line.indexOf("=") + 1),
        ]),
    );
    const api = localUrl(env[apiKey], "Generated Supabase URL");
    if (
      Number(api.port) !== config.api ||
      api.pathname !== "/" ||
      api.search ||
      api.hash
    )
      throw new Error(
        "The generated environment belongs to another Supabase project.",
      );
    if (file === ".env.test.local") {
      const db = new URL(env.DATABASE_URL);
      if (
        !["postgres:", "postgresql:"].includes(db.protocol) ||
        !["127.0.0.1", "localhost", "[::1]"].includes(db.hostname) ||
        Number(db.port) !== config.database
      )
        throw new Error(
          "The generated database address belongs to another Supabase project.",
        );
    }
  }
}

/** Before acquiring the ordinary lifecycle lock, reject any unsafe checkout or link. */
export function localResetTarget(checkout) {
  requireDirectory(checkout);
  const definition = join(checkout, "supabase");
  requireDirectory(definition);
  requireDirectory(join(definition, ".temp"), true);
  requireDirectory(join(definition, ".branches"), true);
  requireDirectory(join(checkout, ".local"), true);
  if (maybeFile(join(definition, ".temp", "project-ref")))
    throw new Error("Reset is available for unlinked local projects only.");
  for (const name of generatedFiles) {
    const info = maybeFile(join(checkout, name));
    if (
      info &&
      (!info.isFile() || info.uid !== process.getuid() || info.nlink !== 1)
    )
      throw new Error("A generated reset path is not an owned regular file.");
  }
  readOwnedFile(join(definition, "config.toml"));
  const config = projectConfig(checkout);
  if (
    !supportedProject.test(config.id ?? "") ||
    ![config.api, config.database, config.mail].every(
      (port) => Number.isInteger(port) && port > 0 && port <= 65535,
    )
  )
    throw new Error(
      "Reset requires a supported local portal development project.",
    );
  localUrl(config.site, "Portal URL");
  checkGeneratedEnvironment(checkout, config);
  return config;
}

export async function confirmLocalReset(
  args,
  project,
  { input = process.stdin, output = process.stdout } = {},
) {
  if (args.length) {
    if (args.length === 2 && args[0] === "--confirm" && args[1] === project)
      return;
    throw new Error(
      `Use ./portal reset or ./portal reset --confirm ${project}.`,
    );
  }
  if (!input.isTTY)
    throw new Error(
      `Confirmation required. Use ./portal reset --confirm ${project}.`,
    );
  const phrase = `RESET ${project}`;
  const prompt = createInterface({ input, output });
  try {
    const answer = await prompt.question(
      `Permanently erase local project ${project}, including database, accounts, uploads and local mail, then start with fictional data?\nType ${phrase} to proceed: `,
    );
    if (answer !== phrase) throw new Error("Local reset cancelled.");
  } finally {
    prompt.close();
  }
}

/** An arbitrary Unix socket may be an SSH forward. Only the standard local daemon paths qualify. */
export function assertResetDockerHost(host, user = process.getuid()) {
  if (
    ![
      "unix:///var/run/docker.sock",
      "unix:///run/docker.sock",
      `unix:///run/user/${user}/docker.sock`,
    ].includes(host)
  )
    throw new Error(
      "Local reset requires a standard local Docker Engine Unix socket.",
    );
}

const rows = (output) => output.trim().split("\n").filter(Boolean);
const names = (output) => rows(output).map((line) => line.split(" "));
const containerNamePrefix = "supabase_";

async function inventory(docker, project, mayStopRunning) {
  const scanner = `portal_scanner_${project}`;
  const suffix = `_${project}`;
  const belongs = (name) =>
    name.startsWith(containerNamePrefix) && name.endsWith(suffix);
  const selection = ["container", "ls", "--all", "--no-trunc"];
  const candidates = names(
    await docker([...selection, "--format", "{{.ID}} {{.Names}}"]),
  );
  const labelled = new Set(
    rows(
      await docker([
        ...selection,
        "--filter",
        `label=${supabaseOwner}=${project}`,
        "--format",
        "{{.ID}}",
      ]),
    ),
  );
  const owned = new Set();
  for (const [id, name] of candidates) {
    if (!(labelled.has(id) || belongs(name) || name === scanner)) continue;
    if (name !== scanner && !(belongs(name) && labelled.has(id)))
      throw new Error(
        "An unexpected container shares the selected local project namespace.",
      );
    const format =
      '{"Name":{{json .Name}},"Labels":{{json .Config.Labels}},"Networks":{{json .NetworkSettings.Networks}},"Ports":{{json .NetworkSettings.Ports}},"Running":{{json .State.Running}}}';
    const actual = JSON.parse(
      await docker(["container", "inspect", "--format", format, id]),
    );
    const isScanner = name === scanner;
    if (actual.Labels?.[isScanner ? scannerOwner : supabaseOwner] !== project)
      throw new Error("Refusing to reset an unowned Docker service.");
    if (actual.Running) {
      if (!mayStopRunning)
        throw new Error(
          "Stop the running project from its owning portal checkout before resetting it.",
        );
      assertContainerBindings(actual, project, { scanner: isScanner });
    }
    owned.add(id);
  }

  const network = networkName(project);
  if (
    rows(await docker(["network", "ls", "--format", "{{.Name}}"])).includes(
      network,
    )
  ) {
    const [actual] = JSON.parse(await docker(["network", "inspect", network]));
    assertNetworkDefinition(actual, project);
    if (Object.keys(actual.Containers ?? {}).some((id) => !owned.has(id)))
      throw new Error(
        "An unrelated container is using the local portal network.",
      );
  }

  const volumes = [];
  const scannerVolume = `portal_clamav_${project}`;
  for (const line of rows(
    await docker(["volume", "ls", "--format", "{{json .}}"]),
  )) {
    const { Name: name, Labels: reported } = JSON.parse(line);
    if (!(
      name === scannerVolume ||
      belongs(name) ||
      reported?.split(",").includes(`${supabaseOwner}=${project}`)
    ))
      continue;
    const [volume] = JSON.parse(await docker(["volume", "inspect", name]));
    const labels = volume.Labels ?? {};
    // Existing scanner volumes were created without labels. The exact scanner name
    // and absence of foreign attachments are required even for that legacy case.
    const matches =
      name === scannerVolume
        ? (Object.keys(labels).length === 0 ||
            labels[scannerOwner] === project) &&
          !labels[supabaseOwner]
        : belongs(name) &&
          labels[supabaseOwner] === project &&
          (!labels["com.docker.compose.project"] ||
            labels["com.docker.compose.project"] === project);
    if (
      !matches ||
      volume.Name !== name ||
      volume.Driver !== "local" ||
      volume.Scope !== "local" ||
      Object.keys(volume.Options ?? {}).length
    )
      throw new Error(
        "Refusing to delete a foreign or nonstandard Docker volume.",
      );
    const holders = rows(
      await docker([
        ...selection,
        "--filter",
        `volume=${name}`,
        "--format",
        "{{.ID}}",
      ]),
    );
    if (holders.some((id) => !owned.has(id)))
      throw new Error("An unrelated container is using a local portal volume.");
    volumes.push(name);
  }
  return { volumes, containers: owned.size };
}

function clearGeneratedState(checkout) {
  for (const name of generatedFiles) {
    const path = join(checkout, name);
    requireDirectory(dirname(path), true);
    if (maybeFile(path)) unlinkSync(path);
  }
}

/** All dependencies use the selected local daemon. Volume removal never forces detachment. */
export async function resetLocalPortal({
  checkout,
  confirmed,
  docker,
  ownsRuntime,
  stop,
  start,
}) {
  assert.deepEqual(
    localResetTarget(checkout),
    confirmed,
    "Local project changed after the reset was confirmed.",
  );
  await inventory(docker, confirmed.id, ownsRuntime());
  await stop();
  assert.deepEqual(
    localResetTarget(checkout),
    confirmed,
    "Local project changed while stopping services.",
  );
  const stopped = await inventory(docker, confirmed.id, false);
  if (stopped.containers)
    throw new Error("Local services are still present after shutdown.");
  for (const name of stopped.volumes) await docker(["volume", "rm", name]);
  const empty = await inventory(docker, confirmed.id, false);
  if (empty.containers || empty.volumes.length)
    throw new Error("Local reset could not verify an empty stack.");
  clearGeneratedState(checkout);
  await start();
}
