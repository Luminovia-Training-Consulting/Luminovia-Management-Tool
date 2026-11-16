/**
 * Besitzt den lokalen Dienstverbund und schreibt seinen bestätigten Lebenszyklus.
 * Migrationen, Scanner, Edge und Vite werden in Reihenfolge gestartet und datenerhaltend beendet.
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
/** Schreibt ausschließlich redigierte Laufzeitausgabe in die private Logdatei. */
const log = (text) => appendFileSync(logPath, redact(text), { mode: 0o600 });
const startedAt = new Date().toISOString();
let phase = "starting";
let stopping = false;
let stackTouched = false;
let scannerTouched = false;
let migrations;
let network;
const children = [];
/** Bindet jeden Zustand an Supervisor-PID, Sitzung und Startzeit. */
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
/** Persistiert den aktuellen Startschritt, damit CLI und private Diagnose denselben Fortschritt zeigen. */
function stage(message) {
  log(message + "\n");
  state({ message });
}
/** Prüft einen lokalen Port vor dem Start, ohne einen vorhandenen Listener zu beenden. */
async function available(port) {
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", () =>
      reject(
        new Error(
          `Port ${port} ist bereits belegt; fremde Prozesse werden nicht beendet.`,
        ),
      ),
    );
    server.listen(port, "127.0.0.1", () => server.close(resolve));
  });
}
/** Stoppt eigene Kindprozesse und Dienste in ihrem Aufräumpfad und schreibt erst danach den Endzustand. */
async function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  phase = "stopping";
  state({ message: "Lokale Dienste werden datenerhaltend gestoppt." });
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
      ? "Start oder Stopp fehlgeschlagen; privates Laufzeitprotokoll prüfen."
      : "Gestoppt. Datenbank, Auth und Storage bleiben erhalten.",
  });
  process.exit(exitCode);
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
/** Startet ein vom Supervisor besessenes Hintergrundprogramm und bindet dessen Ausgabe an das redigierte Protokoll. */
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
      log(`Dienst ${args[0]} ist unerwartet beendet (${code}).\n`);
      void stop(1);
    }
  });
  return child;
}
try {
  state({ message: "Starte lokale Supabase-Dienste …" });
  await available(Number(new URL(config.site).port));
  stage("Starte PostgreSQL, Auth, Storage, Realtime und lokales Mailpit …");
  migrations = migrationDigest();
  network = await ensureLoopbackNetwork(config.id);
  if (await stackNeedsNetworkMigration(config.id)) {
    stage(
      "Stelle vorhandene lokale Dienste datenerhaltend auf Loopback-Bindung um …",
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
  stage("Wende neue lokale Migrationen ohne Reset an …");
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
    if (!response.ok)
      throw new Error("Lokale Konten konnten nicht geprüft werden.");
    const accounts = await response.json();
    if (!accounts.users?.length) {
      stage("Initialisiere elf fiktive Dozierende und lokale Beispieldaten …");
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
    stage("Starte lokalen Malware-Scanner für Datei-Uploads …");
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
  stage("Starte lokale Edge Functions …");
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
  stage("Starte React/Vite …");
  const publicEnv = readEnvFile(join(root, ".env.local"));
  background(
    join(root, "node_modules/.bin/vite"),
    ["--host", "127.0.0.1", "--port", new URL(origin).port, "--strictPort"],
    cleanEnvironment(publicEnv),
  );
  await waitForHttp(`${origin}/login`);
  phase = "ready";
  state({
    message:
      "Bereit. Änderungen werden dauerhaft in lokalen Docker-Volumes gespeichert.",
  });
} catch (error) {
  log(`FEHLER: ${error.message}\n`);
  await stop(1);
}
