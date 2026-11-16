/**
 * Gemeinsame lokale Prozess-, Konfigurations- und Persistenzbausteine der Portal-CLI.
 * Private Dateien, bereinigte Umgebungen und bestätigte Prozessenden bilden die Laufzeitgrenzen.
 */
import { spawn, execFileSync } from "node:child_process";
import {
  readFileSync,
  readdirSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  chmodSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

export const root = resolve(import.meta.dirname, "..");
export const runtimeDir = join(root, ".local");
export const stateFile = join(runtimeDir, "runtime.json");
export const runtimeVersion = 3;
/** Erstellt das private Verzeichnis und setzt auch für einen bereits vorhandenen Pfad Modus 0700. */
export function privateDirectory(path = runtimeDir) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
}
/** Liest einfache lokale KEY=VALUE-Zeilen als Daten, ohne Shellauswertung oder Interpolation. */
export function readEnvFile(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
}
/** Erhält identische Dateiinhalte oder ersetzt sie über eine private temporäre Datei; Zielmodus bleibt 0600. */
export function privateWrite(path, content) {
  if (existsSync(path) && readFileSync(path, "utf8") === content) {
    chmodSync(path, 0o600);
    return;
  }
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, content, { mode: 0o600 });
  renameSync(temporary, path);
  chmodSync(path, 0o600);
}
/** Liest den Laufzeitzustand best effort; fehlende oder ungültige Dateien bedeuten keinen bestätigten Prozess. */
export function readState() {
  try {
    return JSON.parse(readFileSync(stateFile, "utf8"));
  } catch {
    return null;
  }
}
/** Persistiert den strukturierten Supervisorzustand ausschließlich in der privaten Laufzeitablage. */
export function writeState(state) {
  privateDirectory();
  privateWrite(stateFile, JSON.stringify(state, null, 2) + "\n");
}
/** Bestätigt PID, Supervisorpfad und Sitzung, damit eine wiederverwendete fremde PID nicht übernommen wird. */
export function processIsOurs(state) {
  if (
    !Number.isInteger(state?.pid) ||
    state.pid <= 1 ||
    typeof state.session !== "string"
  )
    return false;
  try {
    process.kill(state.pid, 0);
    const command =
      process.platform === "linux"
        ? readFileSync(`/proc/${state.pid}/cmdline`, "utf8")
        : execFileSync("ps", ["-p", String(state.pid), "-o", "args="], {
            encoding: "utf8",
          });
    return (
      command.includes(join(root, "scripts/runtime-supervisor.mjs")) &&
      command.includes(state.session)
    );
  } catch {
    return false;
  }
}
/** Entfernt geerbte Dienst-/Cloud-Zugangsdaten vor lokalen Unterprozessen und ergänzt nur explizite Werte. */
export function cleanEnvironment(extra = {}) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !/^(SUPABASE_|VITE_|E2E_|PORTAL_|S3_|AWS_|SMTP_|OPENAI_|RESEND_|DATABASE_URL$|PGPASSWORD$)/.test(
          key,
        ),
    ),
  );
  return { ...env, ...extra };
}
/** Redigiert bekannte Schlüssel-/JWT-/Datenbankmuster und gespeicherte lokale Geheimnisse vor einer Protokollausgabe. */
export function redact(value) {
  let text = String(value)
    .replace(
      /("[A-Z0-9_]*(?:KEY|SECRET|PASSWORD|TOKEN)[A-Z0-9_]*"\s*:\s*")[^"]*(")/g,
      "$1[redacted]$2",
    )
    .replace(
      /^([A-Z0-9_]*(?:KEY|SECRET|PASSWORD|TOKEN)[A-Z0-9_]*=).*$/gm,
      "$1[redacted]",
    );
  for (const [key, secret] of Object.entries(
    readEnvFile(join(root, ".env.test.local")),
  )) {
    if (/KEY|SECRET|PASSWORD|TOKEN/.test(key) && secret.length >= 8)
      text = text.replaceAll(secret, "[redacted local credential]");
  }
  return text
    .replace(
      /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
      "[redacted JWT]",
    )
    .replace(/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+\b/g, "[redacted key]")
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/g, "postgresql://[redacted]");
}
/** Startet eine eigene Prozessgruppe, sammelt begrenzte Ausgabe und bestätigt Erfolg erst nach tatsächlichem close. */
export async function command(
  file,
  args,
  {
    cwd = root,
    env = cleanEnvironment(),
    quiet = false,
    log,
    timeoutMs = 300000,
    killGraceMs = 5000,
    signal,
  } = {},
) {
  if (signal?.aborted) throw new Error("Command cancelled before start.");
  return await new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    let output = "";
    let finished = false;
    let termination;
    let forceTimer;
    let spawnError;
    /** Signalisiert ausschließlich die eigene Prozessgruppe und toleriert ein bereits beendetes Kind. */
    const kill = (signal) => {
      if (finished) return;
      try {
        if (process.platform !== "win32") process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        /* already exited */
      }
    };
    /** Merkt Timeout oder Abbruch und eskaliert erst nach der begrenzten SIGTERM-Frist. */
    const terminate = (cause) => {
      if (finished || termination) return;
      termination = cause;
      kill("SIGTERM");
      // Wait for real process/pipe closure, then escalate the owned group if a
      // tool ignores SIGTERM. An AbortError alone is not proof of termination.
      forceTimer = setTimeout(() => kill("SIGKILL"), killGraceMs);
    };
    /** Markiert den aktiven Befehl als abgebrochen; ein anschließender Null-Exit darf das nicht in Erfolg umdeuten. */
    const cancel = () => terminate("cancelled");
    const timer = setTimeout(() => terminate("timed out"), timeoutMs);
    signal?.addEventListener("abort", cancel, { once: true });
    /** Begrenzt die gesammelte Unterprozessausgabe, bis der abschließende Protokollpfad sie redigiert. */
    const receive = (data) => {
      output = (output + data.toString()).slice(-1000000);
    };
    child.stdout.on("data", receive);
    child.stderr.on("data", receive);
    child.on("error", (error) => {
      // Node emits close after a spawn error too; use one settlement/cleanup
      // path so no cancellation timer is cleared while a child is still live.
      spawnError = error;
    });
    // `exit` can precede the final stdout chunks; JSON-producing Docker probes
    // must wait until both pipes have closed before consuming their output.
    child.on("close", (code, exitSignal) => {
      finished = true;
      clearTimeout(timer);
      clearTimeout(forceTimer);
      signal?.removeEventListener("abort", cancel);
      const safe = redact(output);
      if (log) log(safe);
      if (!quiet) process.stdout.write(safe);
      if (spawnError)
        reject(
          new Error(
            `Programm ${file} konnte nicht gestartet werden. Prüfe Installation und Ausführungsrechte.`,
            { cause: spawnError },
          ),
        );
      else if (code === 0 && !termination) resolve(safe);
      else
        reject(
          new Error(
            `${file} ${args.slice(0, 3).join(" ")} ${termination ?? "failed"} (${exitSignal ?? code}). ${log ? "Siehe .local/runtime.log." : safe.trim().slice(-1500)}`,
          ),
        );
    });
  });
}
/** Verwendet genau die installierte lokale Supabase-CLI durch denselben kontrollierten Prozessrunner. */
export function supabase(args, options = {}) {
  return command(join(root, "node_modules/.bin/supabase"), args, options);
}
/** Liest Projektkennung und lokale Dienstports aus der tatsächlich verwendeten TOML-Konfiguration. */
export function projectConfig(cwd = root) {
  const text = readFileSync(join(cwd, "supabase/config.toml"), "utf8");
  /** Begrenzt die Konfigurationssuche auf den jeweiligen TOML-Abschnitt. */
  const section = (name) =>
    text.match(new RegExp(`\\[${name}\\]([\\s\\S]*?)(?=\\n\\[|$)`))?.[1] ?? "";
  return {
    id: text.match(/^project_id\s*=\s*"([a-zA-Z0-9_-]+)"/m)?.[1],
    api: Number(section("api").match(/^port\s*=\s*(\d+)/m)?.[1]),
    database: Number(section("db").match(/^port\s*=\s*(\d+)/m)?.[1]),
    mail: Number(section("local_smtp").match(/^port\s*=\s*(\d+)/m)?.[1]),
    site: section("auth").match(/^site_url\s*=\s*"([^"]+)"/m)?.[1],
  };
}
/** Lehnt Remoteziele, eingebettete Zugangsdaten und fremde Protokolle für lokale HTTP-Prüfungen ab. */
export function localUrl(value, label = "URL") {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password
  )
    throw new Error(`${label} must be a credential-free loopback HTTP URL.`);
  return url;
}
/** Wartet begrenzt auf den verlangten tatsächlichen HTTP-Status statt allein auf einen gestarteten Prozess. */
export async function waitForHttp(
  url,
  { timeoutMs = 45000, status = 200 } = {},
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.status === status) return;
    } catch {
      /* not ready */
    }
    await delay(500);
  }
  throw new Error(
    `Local service did not become ready at ${new URL(url).origin}.`,
  );
}
/** Prüft die tatsächlich installierten Abhängigkeiten gegen den Lockfilevertrag und installiert bei Bedarf reproduzierbar. */
export async function ensureDependencies() {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const lock = JSON.parse(
    readFileSync(join(root, "package-lock.json"), "utf8"),
  );
  let installed;
  try {
    installed = JSON.parse(
      readFileSync(join(root, "node_modules/.package-lock.json"), "utf8"),
    );
  } catch {
    /* install below */
  }
  const packages = { ...pkg.dependencies, ...pkg.devDependencies };
  const valid =
    installed &&
    Object.entries(packages).every(
      ([name, version]) =>
        lock.packages[`node_modules/${name}`]?.version === version &&
        installed.packages[`node_modules/${name}`]?.version === version &&
        existsSync(join(root, "node_modules", name, "package.json")),
    );
  if (!valid) {
    console.log("Installiere exakt gesperrte Abhängigkeiten …");
    await command("npm", ["ci"]);
  }
  privateDirectory();
  privateWrite(
    join(runtimeDir, "dependencies.sha256"),
    createHash("sha256")
      .update(readFileSync(join(root, "package-lock.json")))
      .digest("hex") + "\n",
  );
}

/** Bestätigt einen lokalen Docker-Endpunkt vor Dienstmutationen; Remote-Daemons sind kein zulässiges Testziel. */
export async function assertLocalDocker() {
  const host =
    (!process.env.DOCKER_CONTEXT && process.env.DOCKER_HOST) ||
    (
      await command(
        "docker",
        [
          "context",
          "inspect",
          ...(process.env.DOCKER_CONTEXT ? [process.env.DOCKER_CONTEXT] : []),
          "--format",
          "{{.Endpoints.docker.Host}}",
        ],
        { quiet: true, timeoutMs: 10000 },
      )
    ).trim();
  if (!host.startsWith("unix://") && !host.startsWith("npipe://")) {
    let url;
    try {
      url = new URL(host);
    } catch {
      throw new Error("Docker context is not a supported local endpoint.");
    }
    if (
      !["tcp:", "http:", "https:"].includes(url.protocol) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    )
      throw new Error(
        "This local launcher refuses a remote Docker context. Select a local Docker Engine first.",
      );
  }
  await command("docker", ["info", "--format", "{{.ServerVersion}}"], {
    quiet: true,
    timeoutMs: 10000,
  });
  return host;
}

/** Bindet den Startupzustand an sortierte vollständige Migrationsquellen und lehnt unfertige Quellen ab. */
export function migrationDigest(cwd = root) {
  const path = join(cwd, "supabase/migrations");
  const hash = createHash("sha256");
  for (const name of readdirSync(path)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    const source = readFileSync(join(path, name), "utf8");
    if (
      !source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/--[^\n]*/g, "")
        .trim()
    )
      throw new Error(
        `Migration ${name} ist noch leer. Erst fertigstellen, dann starten.`,
      );
    hash.update(name);
    hash.update(source);
  }
  return hash.digest("hex");
}
