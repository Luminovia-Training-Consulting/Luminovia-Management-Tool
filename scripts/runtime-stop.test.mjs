/**
 * Echte Supervisor-Fixtures prüfen den datenerhaltenden Stoppvertrag der CLI.
 * Nur eine zur Sitzung passende Aufräumbestätigung darf als erfolgreicher Stopp gelten.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { cleanEnvironment, command, root } from "./runtime-lib.mjs";

/** Startet einen eigenen kontrollierten Supervisor, der die ausgewählte Aufräum-/Endzustandsvariante nachstellt. */
async function stopFixture(phase) {
  const directory = mkdtempSync(join(tmpdir(), "portal-stop-fixture-"));
  const scripts = join(directory, "scripts");
  const bin = join(directory, "bin");
  mkdirSync(scripts);
  mkdirSync(bin);
  for (const file of [
    "runtime-cli.mjs",
    "runtime-lib.mjs",
    "runtime-network.mjs",
  ])
    copyFileSync(join(root, "scripts", file), join(scripts, file));
  // This executable replaces Docker only inside the fixture subprocess. No
  // normal engine, container, network, data volume or hosting API is contacted.
  writeFileSync(
    join(bin, "docker"),
    `#!${process.execPath}\nconsole.log(process.argv[2]==='context'?'unix:///owned-fixture.sock':'29.0.0');\n`,
    { mode: 0o700 },
  );
  writeFileSync(
    join(scripts, "runtime-supervisor.mjs"),
    `import {writeState} from './runtime-lib.mjs';
const state={pid:process.pid,session:process.argv[2],phase:'ready'};
writeState(state);
process.on('SIGTERM',()=>{${phase === "missing" ? "" : `writeState({...state,phase:${JSON.stringify(phase)},message:'Fictional cleanup result'});`}process.exit(${phase === "failed" ? 1 : 0})});
setTimeout(()=>process.exit(2),5000);
`,
  );
  const supervisor = spawn(
    process.execPath,
    [join(scripts, "runtime-supervisor.mjs"), randomUUID()],
    { detached: true, stdio: "ignore" },
  );
  const exited = new Promise((resolve) => supervisor.once("close", resolve));
  const stateFile = join(directory, ".local/runtime.json");
  try {
    const deadline = Date.now() + 2000;
    while (!existsSync(stateFile) && Date.now() < deadline) await delay(10);
    assert(existsSync(stateFile), "fixture supervisor must be ready");
    const result = await command(
      process.execPath,
      [join(scripts, "runtime-cli.mjs"), "stop"],
      {
        cwd: directory,
        env: {
          ...cleanEnvironment(),
          PATH: `${bin}:${process.env.PATH}`,
          DOCKER_HOST: "unix:///owned-fixture.sock",
          DOCKER_CONTEXT: "",
        },
        quiet: true,
        timeoutMs: 3000,
        killGraceMs: 60,
      },
    ).then(
      (output) => ({ output }),
      (error) => ({ error }),
    );
    return { ...result, state: JSON.parse(readFileSync(stateFile, "utf8")) };
  } finally {
    try {
      process.kill(-supervisor.pid, "SIGKILL");
    } catch {
      // The only target is this fixture's fresh detached supervisor group.
    }
    await exited;
    rmSync(directory, { recursive: true, force: true });
  }
}

test("stop returns success only after its supervisor acknowledges completed cleanup", async () => {
  const result = await stopFixture("stopped");
  assert.equal(result.error, undefined);
  assert.match(result.output, /gestoppt/);
  assert.equal(result.state.phase, "stopped");
});

test("a supervisor cleanup failure makes the CLI stop fail rather than claim success", async () => {
  const result = await stopFixture("failed");
  assert.equal(result.state.phase, "failed");
  assert.match(result.error?.message ?? "", /Stopp.*bestätigt/);
  assert(!result.output);
});

test("an exited supervisor without cleanup acknowledgement cannot report a completed stop", async () => {
  const result = await stopFixture("missing");
  assert.equal(result.state.phase, "ready");
  assert.match(result.error?.message ?? "", /Stopp.*bestätigt/);
});
