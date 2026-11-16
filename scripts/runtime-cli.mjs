/**
 * Dispatches commands for the local portal runtime while preserving persistent data.
 * Start/stop are serialised; preview and isolated full acceptance have separate ownership.
 */
import { spawn } from "node:child_process";
import {
  openSync,
  closeSync,
  readFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  root,
  runtimeDir,
  ensureDependencies,
  command,
  privateDirectory,
  readState,
  writeState,
  processIsOurs,
  projectConfig,
  cleanEnvironment,
  supabase,
  assertLocalDocker,
  migrationDigest,
  runtimeVersion,
} from "./runtime-lib.mjs";
import {
  removeLoopbackNetwork,
  verifyLoopbackBindings,
} from "./runtime-network.mjs";

const action = process.argv[2] ?? "start";
if (process.platform !== "linux" && !["help", "--help", "-h"].includes(action))
  throw new Error(
    "Der lokale Launcher ist derzeit für Linux geprüft. Siehe docs/LOCAL_DEVELOPMENT.md.",
  );
/** Serialises this checkout's runtime mutations and releases its own lock on failure as well. */
async function locked(operation) {
  privateDirectory();
  const lock = join(runtimeDir, "runtime.lock");
  const deadline = Date.now() + 480000;
  while (true) {
    try {
      mkdirSync(lock, { mode: 0o700 });
      writeStateLock();
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let stale = false;
      try {
        const owner = Number(readFileSync(join(lock, "pid"), "utf8"));
        try {
          process.kill(owner, 0);
        } catch {
          stale = true;
        }
      } catch {
        stale = Date.now() - statSync(lock).mtimeMs > 10000;
      }
      if (stale) {
        rmSync(lock, { recursive: true, force: true });
        continue;
      }
      if (Date.now() >= deadline)
        throw new Error(
          "Ein anderer Laufzeitbefehl ist noch aktiv. Prüfe .local/runtime.lock.",
          { cause: error },
        );
      await delay(500);
    }
  }
  /** Writes the current CLI lock holder's identity into private runtime storage. */
  function writeStateLock() {
    writeFileSync(join(lock, "pid"), String(process.pid), { mode: 0o600 });
  }
  try {
    return await operation();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}
/** Describes only commands actually offered and their local data storage. */
function help() {
  console.log(
    `Luminovia Portal – lokale vollständige Laufzeit\n\n  ./portal start        Alle lokalen Dienste starten (Hintergrund)\n  ./portal up           Starten; Ctrl+C stoppt datenerhaltend\n  ./portal restart      Datenerhaltend neu starten\n  ./portal status       Dienststatus und lokale URLs\n  ./portal stop         Eigene Dienste stoppen; Daten bleiben erhalten\n  ./portal check        Lokale Quellcode-/Test-/Build-Prüfung ohne Docker\n  ./portal test         Vollständige Tests in isolierter Umgebung\n  ./portal credentials  Lokales ursprüngliches Testpasswort anzeigen\n  ./portal github       Neuesten GitHub-main separat lokal ausprobieren\n  ./portal github test  Neuesten GitHub-main vollständig isoliert testen\n\nNode.js >=22.12 und npm werden benötigt; Dienste und Volltests zusätzlich mit Docker.\nKeine Produktion, keine echten E-Mails, kein Reset beim Start.`,
  );
}
/** Shows service status and local URLs without exposing private keys. */
function printStatus(state = readState()) {
  const config = projectConfig();
  const alive = processIsOurs(state);
  console.log(`Luminovia Portal: ${alive ? state.phase : "gestoppt"}`);
  if (alive) console.log(state.message ?? "");
  console.log(
    `Portal: ${config.site}\nSupabase API: http://127.0.0.1:${config.api}\nLokale E-Mails: http://127.0.0.1:${config.mail}\nZugang: admin@example.invalid oder lecturer01@example.invalid\nPasswort anzeigen: ./portal credentials\nPrivates Protokoll: .local/runtime.log`,
  );
}
/** Starts or adopts the owned supervisor and confirms success only after its ready state. */
async function start() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 12))
    throw new Error("Node.js >=22.12 ist erforderlich.");
  await ensureDependencies();
  const dockerHost = await assertLocalDocker();
  const existing = readState();
  if (processIsOurs(existing)) {
    if (existing.phase === "ready") {
      if (
        existing.runtimeVersion !== runtimeVersion ||
        (existing.migrations && existing.migrations !== migrationDigest())
      ) {
        console.log(
          "Neue Laufzeitkonfiguration oder Migrationen erkannt; starte datenerhaltend neu …",
        );
        await stop();
        return await start();
      }
      await verifyLoopbackBindings(projectConfig().id, {
        scanner: true,
        edge: true,
      });
      printStatus(existing);
      return;
    }
    console.log("Ein lokaler Start läuft bereits …");
  } else {
    privateDirectory();
    const session = randomUUID();
    const output = openSync(join(runtimeDir, "supervisor.log"), "w", 0o600);
    const child = spawn(
      process.execPath,
      [join(root, "scripts/runtime-supervisor.mjs"), session],
      {
        cwd: root,
        env: cleanEnvironment({ DOCKER_HOST: dockerHost }),
        detached: true,
        stdio: ["ignore", output, output],
      },
    );
    closeSync(output);
    child.unref();
    writeState({
      pid: child.pid,
      session,
      phase: "starting",
      startedAt: new Date().toISOString(),
      message: "Starte lokale Laufzeit …",
    });
  }
  let last = "";
  const deadline = Date.now() + 360000;
  while (Date.now() < deadline) {
    const state = readState();
    if (state?.message && state.message !== last) {
      console.log(state.message);
      last = state.message;
    }
    if (state?.phase === "ready" && processIsOurs(state)) {
      printStatus(state);
      return;
    }
    if (
      state?.phase === "failed" ||
      state?.phase === "stopped" ||
      !processIsOurs(state)
    )
      throw new Error(
        "Lokaler Start fehlgeschlagen. Siehe .local/runtime.log (keine Zugangsdaten veröffentlichen).",
      );
    await delay(500);
  }
  throw new Error(
    "Lokaler Start dauert zu lange. ./portal status zeigt den aktuellen Stand.",
  );
}
/** Stops only the owned service group and requires a cleanup acknowledgement matching its session. */
async function stop() {
  await assertLocalDocker();
  const state = readState();
  if (processIsOurs(state)) {
    process.kill(state.pid, "SIGTERM");
    const deadline = Date.now() + 125000;
    while (processIsOurs(state) && Date.now() < deadline) await delay(500);
    if (processIsOurs(state))
      throw new Error(
        "Datenerhaltender Stopp dauert zu lange; .local/runtime.log prüfen.",
      );
    const stopped = readState();
    // A vanished PID alone does not prove that container/network cleanup ran.
    // Preserve an explicit supervisor failure instead of printing success.
    if (
      stopped?.pid !== state.pid ||
      stopped?.session !== state.session ||
      stopped?.phase !== "stopped"
    )
      throw new Error(
        "Datenerhaltender Stopp wurde nicht bestätigt; .local/runtime.log prüfen.",
      );
  } else {
    await ensureDependencies();
    if (existsSync(join(root, "scripts/local-scanner.mjs")))
      await command(process.execPath, ["scripts/local-scanner.mjs", "stop"], {
        quiet: true,
        timeoutMs: 120000,
      });
    await supabase(["stop", "--project-id", projectConfig().id], {
      quiet: true,
      timeoutMs: 120000,
    });
    await removeLoopbackNetwork(projectConfig().id);
  }
  console.log(
    "Lokales Portal gestoppt. Datenbank, Auth, Passwörter, MFA und Storage bleiben erhalten.",
  );
}
try {
  switch (action) {
    case "github":
      await (
        await import("./runtime-github.mjs")
      ).githubPreviewCommand(process.argv.slice(3));
      break;
    case "start":
      await locked(start);
      break;
    case "up":
      await locked(start);
      console.log("Ctrl+C stoppt die lokalen Dienste ohne Datenverlust.");
      await new Promise((resolve) => {
        process.once("SIGINT", resolve);
        process.once("SIGTERM", resolve);
      });
      await locked(stop);
      break;
    case "stop":
      await locked(stop);
      break;
    case "restart":
      await locked(async () => {
        await stop();
        await start();
      });
      break;
    case "status":
      printStatus();
      break;
    case "credentials":
      if (!existsSync(join(runtimeDir, "ACCOUNTS.txt")))
        throw new Error(
          "Noch keine lokale Zugangsdaten-Datei. Zuerst ./portal start ausführen.",
        );
      process.stdout.write(
        readFileSync(join(runtimeDir, "ACCOUNTS.txt"), "utf8"),
      );
      break;
    case "test":
      await ensureDependencies();
      await import("./runtime-test.mjs");
      break;
    case "check":
      await (await import("./runtime-local-check.mjs")).runLocalCheck();
      break;
    case "help":
    case "--help":
    case "-h":
      help();
      break;
    default:
      help();
      process.exitCode = 1;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
