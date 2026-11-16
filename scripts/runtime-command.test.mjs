import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { command } from "./runtime-lib.mjs";

test("a timed-out child cannot report success by exiting zero after SIGTERM", async () => {
  await assert.rejects(
    command(
      process.execPath,
      [
        "-e",
        "process.on('SIGTERM',()=>process.exit(0));setTimeout(()=>process.exit(0),1800)",
      ],
      { timeoutMs: 400, killGraceMs: 60, quiet: true },
    ),
    /timed out/,
  );
});

test("a child ignoring SIGTERM is killed within the bounded timeout grace", async () => {
  const started = Date.now();
  await assert.rejects(
    command(
      process.execPath,
      [
        "-e",
        "process.on('SIGTERM',()=>{});setTimeout(()=>process.exit(0),1800)",
      ],
      { timeoutMs: 400, killGraceMs: 60, quiet: true },
    ),
    (error) => /timed out/.test(error.message) && /SIGKILL/.test(error.message),
  );
  assert(
    Date.now() - started < 1400,
    "termination must precede the fixture backstop",
  );
});

test("cancelling a running child waits for actual termination rather than leaving it alive", async () => {
  const directory = mkdtempSync(join(tmpdir(), "portal-command-abort-"));
  const marker = join(directory, "ready.json");
  const controller = new AbortController();
  let pid;
  const outcome = command(
    process.execPath,
    [
      "-e",
      "process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(process.argv[1],JSON.stringify({pid:process.pid}));setTimeout(()=>process.exit(0),2500)",
      marker,
    ],
    {
      signal: controller.signal,
      timeoutMs: 5000,
      killGraceMs: 60,
      quiet: true,
    },
  ).then(
    () => ({ succeeded: true }),
    (error) => ({ error }),
  );
  try {
    const deadline = Date.now() + 2000;
    while (!existsSync(marker) && Date.now() < deadline) await delay(10);
    assert(
      existsSync(marker),
      "owned fixture must have installed its signal handler",
    );
    ({ pid } = JSON.parse(readFileSync(marker, "utf8")));
    controller.abort();
    const result = await outcome;
    assert.throws(() => process.kill(pid, 0), /ESRCH/);
    assert.match(result.error?.message ?? "", /cancelled/);
  } finally {
    controller.abort();
    if (pid) {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        // Only the uniquely created fixture process group is ever signalled.
      }
    }
    await outcome;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("already cancelled commands do not execute and missing executables reject cleanly", async () => {
  const directory = mkdtempSync(join(tmpdir(), "portal-command-before-start-"));
  const marker = join(directory, "must-not-exist");
  const controller = new AbortController();
  controller.abort();
  try {
    await assert.rejects(
      command(
        process.execPath,
        [
          "-e",
          "require('node:fs').writeFileSync(process.argv[1],'unexpected')",
          marker,
        ],
        { signal: controller.signal, quiet: true },
      ),
      /cancelled/,
    );
    assert(!existsSync(marker));
    await assert.rejects(
      command(join(directory, "missing-executable"), [], { quiet: true }),
      /konnte nicht gestartet werden/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
