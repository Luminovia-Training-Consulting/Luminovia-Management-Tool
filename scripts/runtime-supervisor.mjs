/**
 * Owns the local service group and records its confirmed lifecycle.
 * Migrations, scanner, Edge and Vite start in order and stop without resetting persistent data.
 */
import { spawn } from "node:child_process";
import { appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "node:net";
import {
  root,
  runtimeDir,
  privateDirectory,
  privateWrite,
  writeState,
  cleanEnvironment,
  command,
  supabase,
  projectConfig,
  readEnvFile,
  waitForHttp,
  redact,
  migrationDigest,
  runtimeVersion,
} from "./runtime-lib.mjs";
import {
  ensureLoopbackNetwork,
  removeLoopbackNetwork,
  stackNeedsNetworkMigration,
  verifyLoopbackBindings,
} from "./runtime-network.mjs";

const session = process.argv[2];
if (!/^[a-f0-9-]{36}$/.test(session ?? ""))
  throw new Error("Invalid supervisor session.");
privateDirectory();
const config = projectConfig();
const logPath = join(runtimeDir, "runtime.log");
privateWrite(logPath, "");
/** Writes only redacted runtime output into the private log file. */
const log = (text) => appendFileSync(logPath, redact(text), { mode: 0o600 });
const startedAt = new Date().toISOString();
let phase = "starting";
let stopping = false;
let stackTouched = false;
let scannerTouched = false;
let migrations;
let network;
const children = [];
/** Binds every state record to supervisor PID, session and startup time. */
const state = (extra) =>
  writeState({
    pid: process.pid,
    session,
    startedAt,
    phase,
    migrations,
    runtimeVersion,
    network,
    projectId: config.id,
    url: config.site,
    ...extra,
  });
/** Persists the current startup stage so CLI status and private diagnostics show the same progress. */
function stage(message) {
  log(message + "\n");
  state({ message });
}
/** Checks a local port before startup without terminating an existing listener. */
async function available(port) {
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", () =>
      reject(
        new Error(
          `Port ${port} is already in use; unrelated processes will not be stopped.`,
        ),
      ),
    );
    server.listen(port, "127.0.0.1", () => server.close(resolve));
  });
}
/** Stops owned children/services through their cleanup path, then writes the terminal state. */
async function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  phase = "stopping";
  state({ message: "Stopping local services while preserving data." });
  for (const child of children) {
    try {
      child.kill("SIGTERM");
    } catch {
      /* exited */
    }
  }
  try {
    if (scannerTouched && existsSync(join(root, "scripts/local-scanner.mjs")))
      await command(process.execPath, ["scripts/local-scanner.mjs", "stop"], {
        quiet: true,
        log,
        timeoutMs: 120000,
      });
  } catch (error) {
    log(error.message + "\n");
    exitCode = 1;
  }
  try {
    if (stackTouched)
      await supabase(["stop", "--project-id", config.id], {
        quiet: true,
        log,
        timeoutMs: 120000,
      });
  } catch (error) {
    log(error.message + "\n");
    exitCode = 1;
  }
  try {
    if (network) await removeLoopbackNetwork(config.id);
  } catch (error) {
    log(error.message + "\n");
    exitCode = 1;
  }
  phase = exitCode ? "failed" : "stopped";
  state({
    message: exitCode
      ? "Startup or shutdown failed; check the private runtime log."
      : "Stopped. Database, Auth and Storage are preserved.",
  });
  process.exit(exitCode);
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
/** Starts a supervisor-owned background process and routes its output into the redacted log. */
function background(file, args, env) {
  const child = spawn(file, args, {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  child.stdout.on("data", (data) => log(data.toString()));
  child.stderr.on("data", (data) => log(data.toString()));
  child.on("error", (error) => {
    log(error.message + "\n");
    void stop(1);
  });
  child.on("exit", (code) => {
    if (!stopping) {
      log(`Service ${args[0]} exited unexpectedly (${code}).\n`);
      void stop(1);
    }
  });
  return child;
}
try {
  state({ message: "Starting local Supabase services …" });
  await available(Number(new URL(config.site).port));
  stage("Starting PostgreSQL, Auth, Storage, Realtime and local Mailpit …");
  migrations = migrationDigest();
  network = await ensureLoopbackNetwork(config.id);
  if (await stackNeedsNetworkMigration(config.id)) {
    stage(
      "Switching existing local services to loopback binding while preserving data …",
    );
    if (existsSync(join(root, "scripts/local-scanner.mjs")))
      await command(process.execPath, ["scripts/local-scanner.mjs", "stop"], {
        quiet: true,
        log,
      });
    await supabase(["stop", "--project-id", config.id], {
      quiet: true,
      log,
      timeoutMs: 120000,
    });
    network = await ensureLoopbackNetwork(config.id);
  }
  stackTouched = true;
  await supabase(
    [
      "start",
      "--network-id",
      network,
      "--exclude",
      "studio,postgres-meta,edge-runtime,logflare,vector,imgproxy,supavisor",
    ],
    { quiet: true, log, timeoutMs: 300000 },
  );
  await verifyLoopbackBindings(config.id);
  stage("Applying new local migrations without resetting data …");
  await supabase(["db", "push", "--yes"], { quiet: true, log });
  await command(process.execPath, ["scripts/local-env.mjs"], {
    quiet: true,
    log,
  });
  const local = readEnvFile(join(root, ".env.test.local"));
  if (!existsSync(join(runtimeDir, "bootstrap.json"))) {
    const response = await fetch(
      `${local.SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1`,
      {
        headers: {
          apikey: local.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${local.SUPABASE_SERVICE_ROLE_KEY}`,
        },
      },
    );
    if (!response.ok) throw new Error("Could not check local accounts.");
    const accounts = await response.json();
    if (!accounts.users?.length) {
      stage("Initialising eleven fictional lecturers and local sample data …");
      await command(process.execPath, ["scripts/local-seed.mjs"], {
        quiet: true,
        log,
      });
    }
    privateWrite(
      join(runtimeDir, "bootstrap.json"),
      JSON.stringify({
        projectId: config.id,
        createdAt: new Date().toISOString(),
        existingDataPreserved: Boolean(accounts.users?.length),
      }) + "\n",
    );
  }
  if (existsSync(join(root, "scripts/local-scanner.mjs"))) {
    stage("Starting the local malware scanner for file uploads …");
    scannerTouched = true;
    await command(process.execPath, ["scripts/local-scanner.mjs", "start"], {
      quiet: true,
      log,
      timeoutMs: 300000,
    });
  }
  const origin = config.site;
  const extra = readEnvFile(join(runtimeDir, "services.env"));
  privateWrite(
    join(runtimeDir, "functions.env"),
    Object.entries({
      ...extra,
      PORTAL_INVITES_ENABLED: "true",
      PORTAL_ALLOWED_ORIGINS: `${origin},${origin.replace("127.0.0.1", "localhost")}`,
      PORTAL_APP_ORIGIN: origin,
    })
      .map(([k, v]) => `${k}=${v}`)
      .join("\n") + "\n",
  );
  stage("Starting local Edge Functions …");
  background(
    join(root, "node_modules/.bin/supabase"),
    [
      "functions",
      "serve",
      "--network-id",
      network,
      "--env-file",
      join(runtimeDir, "functions.env"),
    ],
    cleanEnvironment(),
  );
  await command(process.execPath, ["scripts/local-functions-ready.mjs"], {
    quiet: true,
    log,
    env: cleanEnvironment({ PORTAL_APP_ORIGIN: origin }),
  });
  await verifyLoopbackBindings(config.id, {
    scanner: scannerTouched,
    edge: true,
  });
  stage("Starting React/Vite …");
  const publicEnv = readEnvFile(join(root, ".env.local"));
  background(
    join(root, "node_modules/.bin/vite"),
    ["--host", "127.0.0.1", "--port", new URL(origin).port, "--strictPort"],
    cleanEnvironment(publicEnv),
  );
  await waitForHttp(`${origin}/login`);
  phase = "ready";
  state({
    message: "Ready. Changes are stored persistently in local Docker volumes.",
  });
} catch (error) {
  log(`ERROR: ${error.message}\n`);
  await stop(1);
}
