/**
 * Echte Dateisystemregressionen für private lokale JSON-Fixtures und atomaren Ersatz.
 * Fremde Pfade, Symlinks, harte Links und unsichere Rechte dürfen weder gelesen noch beschrieben werden.
 */
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import {
  chmodSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readPrivateJson, writePrivateJson } from "./testing/private-state.mjs";

/** Erzeugt ein eigenes privates Verzeichnis und entfernt nur diese Fixture nach dem Fall. */
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "portal-private-state-"));
  chmodSync(directory, 0o700);
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return { directory, file: join(directory, "state.json") };
}

test("absent private state is null; exact JSON survives creation and atomic replacement", (t) => {
  const { directory, file } = fixture(t);
  assert.equal(readPrivateJson(file), null);
  const state = {
    factorId: "fictional-factor",
    secret: "fictional-secret",
    label: "Prüfung",
  };
  writePrivateJson(file, state);
  const first = statSync(file);
  assert.deepEqual(readPrivateJson(file), state);
  assert.equal(first.mode & 0o7777, 0o600);
  assert.equal(first.uid, process.getuid());
  const updated = { ...state, factorId: "replacement-factor" };
  writePrivateJson(file, updated);
  assert.deepEqual(readPrivateJson(file), updated);
  assert.notEqual(statSync(file).ino, first.ino);
  assert.deepEqual(readdirSync(directory), ["state.json"]);
});

test("malformed JSON and invalid UTF-8 fail without exposing private contents", (t) => {
  const { file } = fixture(t);
  const privateText = "FICTIONAL_MFA_SECRET_MUST_NOT_APPEAR";
  for (const bytes of [
    Buffer.from(`{"secret":"${privateText}`),
    Buffer.from([0xff, 0xfe]),
  ]) {
    writeFileSync(file, bytes, { mode: 0o600 });
    assert.throws(
      () => readPrivateJson(file),
      (error) => {
        assert.equal(error.name, "SyntaxError");
        assert.equal(error.message.includes(privateText), false);
        assert.equal(error.cause, undefined);
        return true;
      },
    );
  }
});

test("insecure file permissions and hardlinked targets reject both reading and replacement", (t) => {
  const { directory, file } = fixture(t);
  writeFileSync(file, '{"retained":true}', { mode: 0o644 });
  for (const operation of [
    () => readPrivateJson(file),
    () => writePrivateJson(file, { altered: true }),
  ])
    assert.throws(operation, /private regular file/);
  assert.equal(statSync(file).mode & 0o777, 0o644);
  assert.equal(readFileSync(file, "utf8"), '{"retained":true}');
  chmodSync(file, 0o600);
  linkSync(file, join(directory, "shared.json"));
  for (const operation of [
    () => readPrivateJson(file),
    () => writePrivateJson(file, { altered: true }),
  ])
    assert.throws(operation, /one link/);
  assert.deepEqual(readdirSync(directory).sort(), [
    "shared.json",
    "state.json",
  ]);
});

test("private parent validation rejects insecure modes without changing them", (t) => {
  const { directory, file } = fixture(t);
  chmodSync(directory, 0o755);
  for (const operation of [
    () => readPrivateJson(file),
    () => writePrivateJson(file, { secret: "fixture" }),
  ])
    assert.throws(operation, /owned 0700 directory/);
  assert.equal(statSync(directory).mode & 0o777, 0o755);
  assert.deepEqual(readdirSync(directory), []);
});

test("target and dangling symlinks never read, replace or create the referenced secret", (t) => {
  const { directory, file } = fixture(t);
  const victim = join(directory, "victim.json");
  writeFileSync(victim, '{"retained":true}', { mode: 0o600 });
  symlinkSync(victim, file);
  for (const operation of [
    () => readPrivateJson(file),
    () => writePrivateJson(file, { altered: true }),
  ])
    assert.throws(operation, { code: "ELOOP" });
  assert.equal(readFileSync(victim, "utf8"), '{"retained":true}');
  rmSync(file);
  symlinkSync(join(directory, "missing.json"), file);
  assert.throws(() => readPrivateJson(file), { code: "ELOOP" });
  assert.throws(() => writePrivateJson(file, {}), { code: "ELOOP" });
  assert.deepEqual(readdirSync(directory).sort(), [
    "state.json",
    "victim.json",
  ]);
});

test("symlinked parent or ancestor directories are refused before any state access", (t) => {
  const { directory } = fixture(t);
  const actual = join(directory, "actual");
  mkdirSync(actual, { mode: 0o700 });
  mkdirSync(join(actual, "nested"), { mode: 0o700 });
  symlinkSync(actual, join(directory, "alias"));
  for (const relative of ["alias/state.json", "alias/nested/state.json"])
    for (const operation of [
      () => readPrivateJson(join(directory, relative)),
      () => writePrivateJson(join(directory, relative), {}),
    ])
      assert.throws(operation, (error) =>
        ["ENOTDIR", "ELOOP"].includes(error.code),
      );
  assert.deepEqual(readdirSync(join(actual, "nested")), []);
  assert.deepEqual(readdirSync(actual), ["nested"]);
});

test("directories and FIFOs fail without waiting for a writer or reporting missing state", (t) => {
  const { directory, file } = fixture(t);
  mkdirSync(file, { mode: 0o700 });
  assert.throws(() => readPrivateJson(file), /private regular file/);
  assert.throws(() => writePrivateJson(file, {}), /private regular file/);
  rmSync(file, { recursive: true });
  execFileSync("mkfifo", ["-m", "600", file]);
  assert.throws(() => readPrivateJson(file), /private regular file/);
  assert.throws(() => writePrivateJson(file, {}), /private regular file/);
  assert.deepEqual(readdirSync(directory), ["state.json"]);
});

test("bounded reads and rejected JSON writes retain old state and leave no temporary files", (t) => {
  const { directory, file } = fixture(t);
  writePrivateJson(file, { retained: true });
  assert.throws(
    () => writePrivateJson(file, { large: "x".repeat(64 * 1024) }),
    /bounded size/,
  );
  assert.throws(() => writePrivateJson(file, undefined), /JSON serializable/);
  const circular = {};
  circular.self = circular;
  assert.throws(() => writePrivateJson(file, circular), TypeError);
  assert.deepEqual(readPrivateJson(file), { retained: true });
  writeFileSync(file, `"${"x".repeat(64 * 1024)}"`, { mode: 0o600 });
  assert.throws(() => readPrivateJson(file), /bounded size/);
  assert.deepEqual(readdirSync(directory), ["state.json"]);
});

test("a failed atomic rename removes the actual temporary bytes and retains existing state", (t) => {
  const { directory, file } = fixture(t);
  writePrivateJson(file, { retained: true });
  const simulated = Object.assign(new Error("Synthetic rename failure"), {
    code: "EIO",
  });
  const replacement = t.mock.method(fs, "renameSync", () => {
    throw simulated;
  });
  syncBuiltinESMExports();
  try {
    assert.throws(
      () => writePrivateJson(file, { secret: "fictional-new-secret" }),
      (error) => error === simulated,
    );
  } finally {
    replacement.mock.restore();
    syncBuiltinESMExports();
  }
  assert.deepEqual(readPrivateJson(file), { retained: true });
  assert.deepEqual(readdirSync(directory), ["state.json"]);
});

test("an actual parent-path swap during atomic rename stays bound to the opened directory", (t) => {
  const { directory } = fixture(t);
  const active = join(directory, "active");
  const retained = join(directory, "retained");
  const victim = join(directory, "victim");
  mkdirSync(active, { mode: 0o700 });
  mkdirSync(victim, { mode: 0o700 });
  const file = join(active, "state.json");
  const victimFile = join(victim, "state.json");
  const previous = { factorId: "old-factor", secret: "fictional-old-secret" };
  const updated = { factorId: "new-factor", secret: "fictional-new-secret" };
  const victimBytes = '{"secret":"fictional-victim-unchanged"}';
  writePrivateJson(file, previous);
  writeFileSync(victimFile, victimBytes, { mode: 0o600 });
  // Ein offener Leser hält den alten Inode: atomarer Ersatz darf dessen Bytes nicht überschreiben.
  const oldDescriptor = fs.openSync(file, "r");
  const originalRename = fs.renameSync;
  let swaps = 0;
  const replacement = t.mock.method(fs, "renameSync", (source, target) => {
    swaps++;
    // Tausche den echten Elternpfad erst nach Prüfung, Temp-Schreiben und fsync.
    // Eine Regression auf den ursprünglichen Pfad würde jetzt in victim schreiben.
    originalRename(active, retained);
    symlinkSync(victim, active);
    originalRename(source, target);
  });
  syncBuiltinESMExports();
  try {
    writePrivateJson(file, updated);
  } finally {
    replacement.mock.restore();
    syncBuiltinESMExports();
    try {
      assert.deepEqual(
        JSON.parse(readFileSync(oldDescriptor, "utf8")),
        previous,
      );
    } finally {
      fs.closeSync(oldDescriptor);
    }
  }
  assert.equal(swaps, 1);
  assert.deepEqual(readPrivateJson(join(retained, "state.json")), updated);
  assert.equal(readFileSync(victimFile, "utf8"), victimBytes);
  assert.throws(
    () => readPrivateJson(file),
    (error) => ["ENOTDIR", "ELOOP"].includes(error.code),
  );
  assert.deepEqual(readdirSync(retained), ["state.json"]);
  assert.deepEqual(readdirSync(victim), ["state.json"]);
});
