/**
 * Canonical complete acceptance, or an explicitly selected CI phase, in an owned snapshot.
 * Every selected stage must pass; phase and cleanup failures remain visible in the private report.
 */
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
  readdirSync,
  rmSync,
  existsSync,
} from "node:fs";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import { createHash, randomBytes } from "node:crypto";
import {
  browserPlan,
  browserAcceptance,
  browserFailure,
} from "./testing/browser-evidence.mjs";
import { runtimeSnapshotSource } from "./runtime-snapshot.mjs";
import {
  runtimeTestArguments,
  runtimeTestPhasePlan,
} from "./runtime-test-phase.mjs";
import {
  acquireTestLock,
  assertTestPortsAvailable,
} from "./runtime-test-lock.mjs";
import {
  root,
  runtimeDir,
  privateDirectory,
  privateWrite,
  command,
  cleanEnvironment,
  assertLocalDocker,
} from "./runtime-lib.mjs";

// Parse before acquiring a lock, copying source or reaching a Docker engine.
// Without explicit CLI arguments the canonical command always runs everything.
const phase = runtimeTestPhasePlan(runtimeTestArguments(process.argv, root));
const run = randomBytes(4).toString("hex");
const project = `luminovia-portal-test-${run}`;
const artifacts = join(runtimeDir, "tests", run);
const lock = join(runtimeDir, "test.lock");
const releaseSharedLock = acquireTestLock({ checkout: root });
let scratch;
let localLockHeld = false;
try {
  // Fail before creating a snapshot or starting even proxy fixtures. The
  // shared lock serialises updated checkouts; the port probe catches old ones.
  await assertTestPortsAvailable();
  privateDirectory();
  try {
    mkdirSync(lock, { mode: 0o700 });
    localLockHeld = true;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    throw new Error(
      "Ein isolierter Testlauf läuft bereits. Prüfe .local/test.lock; Entwicklungsdaten werden nicht angefasst.",
      { cause: error },
    );
  }
  privateWrite(join(lock, "pid"), String(process.pid));
  scratch = mkdtempSync(join(tmpdir(), "luminovia-portal-test-"));
  privateDirectory(artifacts);
} catch (error) {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
  if (localLockHeld) rmSync(lock, { recursive: true, force: true });
  releaseSharedLock();
  throw error;
}
const env = cleanEnvironment({
  PORTAL_TEST_MODE: "1",
  PORTAL_DB_CONTAINER: `supabase_db_${project}`,
  E2E_BASE_URL: "http://127.0.0.1:5273",
  E2E_MAILPIT_URL: "http://127.0.0.1:55324",
  PORTAL_APP_ORIGIN: "http://127.0.0.1:5273",
});
let failure;
let localDockerReady = false;
const cancellation = new AbortController();
const evidence = {
  version: 1,
  // A passed selected phase is not a claim that the other phase ran.
  phase: phase.phase,
  // PR CI may delegate only gates that run independently and are required by
  // the final preview gate; the canonical local command never sets these.
  externalGates: phase.externalGates,
  stagePlan: phase.stages,
  project,
  startedAt: new Date().toISOString(),
  status: "running",
  stages: [],
  browsers: {},
};
/** Persist only source/stage/workflow facts; raw process and browser data stay private. */
const saveEvidence = () =>
  privateWrite(
    join(artifacts, "acceptance.json"),
    JSON.stringify(evidence, null, 2) + "\n",
  );
saveEvidence();

/** Cancels the current stage; the outer finally path remains responsible for cleanup. */
const cancel = () => {
  console.log("Test wird abgebrochen; isolierte Dienste werden aufgeräumt …");
  cancellation.abort();
};
process.once("SIGINT", cancel);
process.once("SIGTERM", cancel);
try {
  env.DOCKER_HOST = await assertLocalDocker();
  delete env.DOCKER_CONTEXT;
  localDockerReady = true;
  console.log(
    `Isolierte Testumgebung ${project}. Phase: ${phase.phase}. Entwicklungsdaten bleiben unverändert.`,
  );
  cpSync(root, scratch, {
    recursive: true,
    filter: (source) => runtimeSnapshotSource(source, root),
  });
  // Fingerprint the actual sanitized source, including uncommitted/untracked
  // work. A Git HEAD alone would misidentify the bytes that are being tested.
  const sourceHash = createHash("sha256");
  /** Hash the copied, credential-filtered bytes before generated configuration changes. */
  function hashSource(directory, prefix = "") {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      const path = join(directory, entry.name);
      const name = `${prefix}${entry.name}`;
      if (entry.isDirectory()) hashSource(path, `${name}/`);
      else {
        const bytes = readFileSync(path);
        sourceHash.update(JSON.stringify([name, bytes.length]) + "\n");
        sourceHash.update(bytes);
      }
    }
  }
  hashSource(scratch);
  evidence.sourceSha256 = sourceHash.digest("hex");
  saveEvidence();
  // Independent cache directories; only immutable package contents are shared.
  mkdirSync(join(scratch, "node_modules"));
  for (const entry of readdirSync(join(root, "node_modules"), {
    withFileTypes: true,
  })) {
    if (entry.name.startsWith(".vite") || entry.name.startsWith(".cache"))
      continue;
    symlinkSync(
      join(root, "node_modules", entry.name),
      join(scratch, "node_modules", entry.name),
      entry.isDirectory() ? "dir" : "file",
    );
  }
  // Only the disposable copy receives the test project/ports; normal development source stays unchanged.
  const configPath = join(scratch, "supabase/config.toml");
  let config = readFileSync(configPath, "utf8");
  config = config
    .replace(/^project_id\s*=\s*"[^"]+"/m, `project_id = "${project}"`)
    .replaceAll("543", "553")
    .replaceAll(":5173", ":5273");
  writeFileSync(configPath, config);
  /** Runs one named stage in the isolated snapshot with a timeout and shared cancellation signal. */
  /** Run one required child command; cancellation/failure cannot be recorded as success. */
  const step = async (label, file, args, extra = {}, timeoutMs = 1200000) => {
    console.log(`\n[TEST] ${label}`);
    const item = {
      label,
      command: [basename(file), ...args],
      status: "running",
      startedAt: new Date().toISOString(),
    };
    evidence.stages.push(item);
    saveEvidence();
    try {
      const output = await command(file, args, {
        cwd: scratch,
        env: { ...env, ...extra },
        timeoutMs,
        signal: cancellation.signal,
      });
      item.status = "passed";
      return output;
    } catch (error) {
      item.status = "failed";
      throw error;
    } finally {
      item.completedAt = new Date().toISOString();
      saveEvidence();
    }
  };
  /** Inventory all expected files/projects, execute them and retain truthful separate stage evidence. */
  const browserStage = async (
    stage,
    label,
    args,
    extra = {},
    timeoutMs = 1200000,
  ) => {
    const directory = join(scratch, ".local/browser", stage);
    privateDirectory(directory);
    const stageEnv = { ...extra, PORTAL_BROWSER_STAGE: stage };
    const expectedFiles = readdirSync(join(scratch, "tests/e2e"), {
      recursive: true,
    })
      .filter(
        (file) =>
          file.endsWith(".spec.ts") &&
          (stage === "pwa") === (file === "pwa.spec.ts"),
      )
      .sort();
    const planPath = join(directory, "plan.json");
    await step(
      `${label}: vollständige Testauswahl`,
      "npx",
      [
        "--no-install",
        "playwright",
        "test",
        ...args,
        "--list",
        "--reporter=json",
      ],
      { ...stageEnv, PLAYWRIGHT_JSON_OUTPUT_NAME: planPath },
    );
    const planned = browserPlan(JSON.parse(readFileSync(planPath, "utf8")), {
      files: expectedFiles,
      projects: ["desktop-chromium", "mobile-chromium"],
    });
    evidence.browsers[stage] = {
      status: "planned",
      planned: planned.length,
      files: expectedFiles,
    };
    saveEvidence();
    try {
      await step(
        label,
        "npx",
        ["--no-install", "playwright", "test", ...args],
        stageEnv,
        timeoutMs,
      );
      evidence.browsers[stage] = browserAcceptance(
        JSON.parse(readFileSync(join(directory, "report.json"), "utf8")),
        planned,
      );
    } catch (error) {
      try {
        evidence.browsers[stage] = {
          ...browserFailure(
            JSON.parse(readFileSync(join(directory, "report.json"), "utf8")),
          ),
          planned: planned.length,
        };
      } catch {
        // Missing/malformed execution evidence cannot replace the actual
        // command/acceptance failure or manufacture completed workflows.
        evidence.browsers[stage].status = "failed";
      }
      throw error;
    } finally {
      saveEvidence();
    }
  };
  if (phase.system) {
    if (!phase.externalGates.includes("quality")) {
      await step("Lint", "npm", ["run", "lint"]);
      await step("TypeScript", "npm", ["run", "typecheck"]);
      await step("Formatierung", "npm", ["run", "format:check"]);
    }
    const runtimeTests = readdirSync(join(scratch, "scripts"))
      .filter(
        (name) => name.startsWith("runtime-") && name.endsWith(".test.mjs"),
      )
      .map((name) => `scripts/${name}`);
    if (runtimeTests.length)
      await step("Laufzeit-Sicherheitsprüfungen", process.execPath, [
        "--test",
        ...runtimeTests,
      ]);
    if (!phase.externalGates.includes("coverage"))
      await step("Unit-/Komponententests und Coverage", "npm", [
        "run",
        "test:coverage",
      ]);
    await step("Produktionsabhängigkeiten", "npm", [
      "audit",
      "--omit=dev",
      "--audit-level=low",
    ]);
    const functions = join(scratch, "supabase/functions");
    const handlerTests = [];
    const entries = [];
    /** Discovers delivered Edge entry points and tests recursively so new functions do not silently escape verification. */
    function find(path) {
      for (const entry of readdirSync(path, { withFileTypes: true })) {
        const child = join(path, entry.name);
        if (entry.isDirectory()) find(child);
        else if (entry.name.endsWith("_test.ts")) handlerTests.push(child);
        else if (entry.name === "index.ts") entries.push(child);
      }
    }
    if (existsSync(functions)) find(functions);
    // Pinned npm: imports and control-character rejection are intentional here.
    // Promise-shaped test doubles may be async without awaiting real I/O; keep
    // require-await active on production Edge source and relax it only in tests.
    if (entries.length)
      await step("Edge-Quellcode-Lint", process.execPath, [
        join(scratch, "node_modules/deno/bin.cjs"),
        "lint",
        "--rules-exclude=no-import-prefix,no-control-regex",
        "--ignore=**/*_test.ts",
        functions,
      ]);
    if (handlerTests.length) {
      await step("Edge-Test-Lint", process.execPath, [
        join(scratch, "node_modules/deno/bin.cjs"),
        "lint",
        "--rules-exclude=no-import-prefix,no-control-regex,require-await",
        ...handlerTests,
      ]);
      await step("Edge-Unit-Tests", process.execPath, [
        join(scratch, "node_modules/deno/bin.cjs"),
        "test",
        "--allow-env",
        `--allow-read=${join(functions, "course-documents/assets")}`,
        ...handlerTests,
      ]);
    }
    for (const entry of entries)
      await step(
        `Edge-Typprüfung ${basename(join(entry, ".."))}`,
        process.execPath,
        [join(scratch, "node_modules/deno/bin.cjs"), "check", entry],
      );
    // Keep release/update safety in the same local command as application QA.
    await step("SMTP-Benachrichtigungsschutz", "python3", [
      "-W",
      "error::ResourceWarning",
      "-m",
      "unittest",
      "discover",
      "-s",
      "scripts",
      "-p",
      "test_notification_mail_worker.py",
    ]);
    // These checks use fixtures and owned proxy containers, never the hosted VM.
    const hosting = join(scratch, "deploy/hostinger");
    if (existsSync(hosting)) {
      if (existsSync(join(hosting, "backups"))) {
        // The crypto fixtures otherwise skip successfully when their tools are
        // absent. Require real age binaries before claiming complete local QA.
        for (const [label, binary] of [
          ["age-Verschlüsselungswerkzeug", env.AGE_TEST_BINARY || "age"],
          ["age-Schlüsselwerkzeug", env.AGE_KEYGEN_TEST_BINARY || "age-keygen"],
        ]) {
          const version = await step(label, binary, ["--version"]);
          if (!/^v?1\.\d+\.\d+$/.test(version.trim()))
            throw new Error(
              "The encrypted-backup fixtures require a stable age 1.x tool version; verification stopped before crypto tests.",
            );
        }
      }
      for (const area of ["updates", "maintenance", "backups"])
        if (existsSync(join(hosting, area)))
          await step(`Update-/Wiederherstellungsschutz ${area}`, "python3", [
            "-m",
            "unittest",
            "discover",
            "-s",
            `deploy/hostinger/${area}`,
            "-p",
            "test_*.py",
          ]);
      const releaseTests = [
        ...readdirSync(hosting)
          .filter((name) => /^reviewed-.*\.test\.mjs$/.test(name))
          .map((name) => `deploy/hostinger/${name}`),
        ...readdirSync(join(hosting, "updates"))
          .filter((name) => name.endsWith(".test.mjs"))
          .map((name) => `deploy/hostinger/updates/${name}`),
        ...readdirSync(join(hosting, "scanner"))
          .filter((name) => name.endsWith(".test.mjs"))
          .map((name) => `deploy/hostinger/scanner/${name}`),
        ...(existsSync(join(hosting, "backups"))
          ? readdirSync(join(hosting, "backups"))
              .filter((name) => name.endsWith(".test.mjs"))
              .map((name) => `deploy/hostinger/backups/${name}`)
          : []),
        ...(existsSync(join(hosting, "maintenance"))
          ? readdirSync(join(hosting, "maintenance"))
              .filter((name) => name.endsWith(".test.mjs"))
              .map((name) => `deploy/hostinger/maintenance/${name}`)
          : []),
      ].sort();
      await step(
        "Release-Pakete und geprüfte Migrationspläne",
        process.execPath,
        ["--test", ...releaseTests],
      );
      await step("Private Selfhost-Gateway-Routen", process.execPath, [
        "deploy/hostinger/selfhost/validate.mjs",
        "--gateway-routing",
      ]);
      await step("Caddy-Zugriff und private Grenzen", process.execPath, [
        "scripts/hostinger-caddy-check.mjs",
      ]);
    }
  }
  await step("Vollständige isolierte Dienste starten", process.execPath, [
    "scripts/runtime-cli.mjs",
    "start",
  ]);
  const localEnv = Object.fromEntries(
    readFileSync(join(scratch, ".env.test.local"), "utf8")
      .split("\n")
      .filter((line) => line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
  Object.assign(env, localEnv, {
    E2E_BASE_URL: "http://127.0.0.1:5273",
    E2E_MAILPIT_URL: "http://127.0.0.1:55324",
    PORTAL_APP_ORIGIN: "http://127.0.0.1:5273",
    PORTAL_DB_CONTAINER: `supabase_db_${project}`,
  });
  await step(
    "Echte Stop/Start-Persistenz einschließlich Auth/MFA/Storage",
    process.execPath,
    ["scripts/runtime-persistence-check.mjs"],
  );
  // Nested startup/persistence commands deliberately discard PORTAL_* controls.
  // Seed the fictional commercial policy only here, after the real retention
  // proof, with this runner's exact owned QA identity. Normal development
  // startup and its insert-only seed keep choosing no commercial policy.
  await step(
    "Fiktive kommerzielle Testkonfiguration",
    process.execPath,
    ["scripts/local-seed.mjs"],
    {
      PORTAL_TEST_MODE: "1",
      PORTAL_DB_CONTAINER: `supabase_db_${project}`,
    },
  );
  if (phase.system) {
    await step("PostgreSQL, RLS und 50-fache Nebenläufigkeit", "npm", [
      "run",
      "test:db",
    ]);
    for (const script of readdirSync(join(scratch, "scripts"))
      .filter((name) => name.endsWith("-db-tests.mjs"))
      .sort())
      await step(`Weitere SQL-Sicherheitsfälle ${script}`, process.execPath, [
        `scripts/${script}`,
      ]);
    for (const script of readdirSync(join(scratch, "scripts"))
      .filter((name) => name.endsWith("-api-check.mjs"))
      .sort())
      await step(`Echte API ${script}`, process.execPath, [
        `scripts/${script}`,
      ]);
    await step("Echte Edge-Einladung und Mailpit", process.execPath, [
      "scripts/local-invite-check.mjs",
    ]);
  }
  if (phase.browser) {
    await step("Chromium bereitstellen", "npx", [
      "--no-install",
      "playwright",
      "install",
      ...(process.env.CI === "true" ? ["--with-deps"] : []),
      "chromium",
    ]);
    // Preserve the measured whole-command budget; individual browser tests
    // remain bounded and strict discovery/results still reject incomplete runs.
    await browserStage(
      "application",
      "Desktop- und Mobilbrowser",
      ["--grep-invert", "built PWA"],
      {},
      1800000,
    );
    // The required parallel Typecheck gate covers these exact source bytes.
    await step("Produktions-Build", "npx", ["--no-install", "vite", "build"]);
    // The test supervisor serves the built artifact from a separate, owned preview.
    await step("Gebautes PWA starten", process.execPath, [
      "scripts/runtime-test-preview.mjs",
      "start",
    ]);
    await browserStage(
      "pwa",
      "PWA, Offline-Shell und keine privaten Caches",
      ["tests/e2e/pwa.spec.ts"],
      { E2E_PWA: "1", E2E_BASE_URL: "http://127.0.0.1:4273" },
    );
  }
} catch (error) {
  failure = error;
  privateWrite(
    join(artifacts, "RESULT.txt"),
    `FAIL\nPhase: ${phase.phase}\n${error.message}\n`,
  );
} finally {
  if (localDockerReady) {
    if (phase.browser) {
      try {
        await command(
          process.execPath,
          ["scripts/runtime-test-preview.mjs", "stop"],
          { cwd: scratch, env, quiet: true, timeoutMs: 20000 },
        );
      } catch {
        /* not started */
      }
    }
    try {
      await command(process.execPath, ["scripts/runtime-cli.mjs", "stop"], {
        cwd: scratch,
        env,
        quiet: true,
        timeoutMs: 180000,
      });
    } catch (error) {
      failure ??= error;
    }
    // This specific randomly-named test stack is disposable. No dev or unrelated project is stopped.
    try {
      await command(
        join(root, "node_modules/.bin/supabase"),
        ["stop", "--project-id", project, "--no-backup"],
        { cwd: scratch, env, quiet: true, timeoutMs: 180000 },
      );
    } catch (error) {
      failure ??= error;
    }
    try {
      await command("docker", ["volume", "rm", `portal_clamav_${project}`], {
        env,
        quiet: true,
        timeoutMs: 20000,
      });
    } catch {
      /* scanner may not have started */
    }
  }
  for (const name of [
    ...(phase.browser ? ["playwright-report", "test-results"] : []),
    ...(phase.system ? ["coverage"] : []),
  ])
    if (existsSync(join(scratch, name)))
      cpSync(join(scratch, name), join(artifacts, name), { recursive: true });
  if (phase.browser && existsSync(join(scratch, ".local/browser")))
    cpSync(join(scratch, ".local/browser"), join(artifacts, "browser"), {
      recursive: true,
    });
  if (phase.browser && existsSync(join(scratch, "docs/screenshots")))
    cpSync(join(scratch, "docs/screenshots"), join(artifacts, "screenshots"), {
      recursive: true,
    });
  if (existsSync(join(scratch, ".local/runtime.log")))
    cpSync(join(scratch, ".local/runtime.log"), join(artifacts, "runtime.log"));
  rmSync(scratch, { recursive: true, force: true });
  rmSync(lock, { recursive: true, force: true });
  releaseSharedLock();
  process.removeListener("SIGINT", cancel);
  process.removeListener("SIGTERM", cancel);
}
// A cancellation during bounded cleanup must not turn a partial run into PASS.
if (cancellation.signal.aborted)
  failure ??= new Error(`Isolated ${phase.phase} acceptance was cancelled.`);
if (failure) {
  evidence.status = "failed";
  evidence.completedAt = new Date().toISOString();
  saveEvidence();
  privateWrite(
    join(artifacts, "RESULT.txt"),
    `FAIL\nPhase: ${phase.phase}\n${failure.message}\n`,
  );
  console.error(
    `Isolierter Test fehlgeschlagen. Bericht: .local/tests/${run}/RESULT.txt`,
  );
  throw failure;
}
evidence.status = "passed";
evidence.completedAt = new Date().toISOString();
saveEvidence();
privateWrite(
  join(artifacts, "RESULT.txt"),
  `PASS\nPhase: ${phase.phase}\nStages: ${phase.stages.join(", ")}\n${phase.externalGates.length ? `Delegated required gates: ${phase.externalGates.join(", ")}\n` : ""}${phase.phase === "system" ? "Browser/build/PWA acceptance was not run in this phase.\n" : phase.phase === "browser" ? "System SQL/API/Edge/operational acceptance was not run in this phase.\n" : phase.externalGates.length ? "Selected phase acceptance passed; delegated CI gates are listed above.\n" : "Complete local acceptance.\n"}Project: ${project}\nCompleted: ${new Date().toISOString()}\nDevelopment database and object volumes were not targeted.\n`,
);
console.log(
  phase.phase === "all" && phase.externalGates.length === 0
    ? `\nAlle isolierten Prüfungen und Aufräumen bestanden. Bericht: .local/tests/${run}/RESULT.txt`
    : `\nIsolated ${phase.phase} acceptance and cleanup passed${phase.externalGates.length ? `; delegated required gates: ${phase.externalGates.join(", ")}` : "; other acceptance phases are not claimed"}. Report: .local/tests/${run}/RESULT.txt`,
);
