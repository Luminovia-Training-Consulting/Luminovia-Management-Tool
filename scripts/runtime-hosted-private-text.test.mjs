/**
 * Real local filesystem regressions for the hosted operator's text reader.
 * Fixtures contain no actual configuration; no hosted CLI, client or service is
 * started. Synchronous fs patches are restored before each case returns.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readHostedPrivateText } from "./testing/hosted-private-text.mjs";

/** Own only this random temporary directory and remove it after the case. */
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "portal-hosted-private-text-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return { directory, file: join(directory, "configuration.env") };
}

/** Observe actual descriptors while optionally injecting a synchronous filesystem boundary failure. */
function withDescriptors(operation, overrides = {}) {
  const originals = Object.fromEntries(
    [...new Set(["openSync", ...Object.keys(overrides)])].map((key) => [
      key,
      fs[key],
    ]),
  );
  const descriptors = [];
  Object.assign(fs, overrides, {
    openSync: (...args) => {
      const descriptor = originals.openSync(...args);
      descriptors.push(descriptor);
      return descriptor;
    },
  });
  syncBuiltinESMExports();
  try {
    operation();
  } finally {
    Object.assign(fs, originals);
    syncBuiltinESMExports();
  }
  return descriptors;
}

/** An EBADF from the real syscall proves the opened descriptor was closed. */
function assertClosed(descriptors) {
  assert.equal(descriptors.length, 1);
  assert.throws(() => fs.fstatSync(descriptors[0]), { code: "EBADF" });
}

test("raw UTF-8 environment and JSON text retain their exact decoding, line endings and complete length", (t) => {
  const { file } = fixture(t);
  for (const bytes of [
    Buffer.from("\ufeffFIXTURE='Prüfung'\r\n# fictional only\r\n"),
    Buffer.from('{ "accounts": [], "version": 1 }\n'),
    Buffer.from([0xff, 0xfe, 0x0a]),
    Buffer.alloc(70 * 1024, "x"),
  ]) {
    writeFileSync(file, bytes, { mode: 0o600 });
    assertClosed(
      withDescriptors(() => {
        const text = readHostedPrivateText(file);
        assert.equal(typeof text, "string");
        assert.equal(text, bytes.toString("utf8"));
      }),
    );
  }
});

test("missing input remains ENOENT and creates no configuration or replacement state", (t) => {
  const { directory, file } = fixture(t);
  assert.throws(() => readHostedPrivateText(file), { code: "ENOENT" });
  assert.equal(existsSync(file), false);
  assert.deepEqual(readdirSync(directory), []);
});

test("owner-only readable modes retain their bytes and mode while group or other access still rejects", (t) => {
  const { file } = fixture(t);
  writeFileSync(file, "fictional private text", { mode: 0o600 });
  for (const mode of [0o400, 0o600, 0o700]) {
    chmodSync(file, mode);
    assertClosed(
      withDescriptors(() =>
        assert.equal(readHostedPrivateText(file), "fictional private text"),
      ),
    );
    assert.equal(statSync(file).mode & 0o777, mode);
  }
  for (const mode of [0o644, 0o640, 0o604]) {
    chmodSync(file, mode);
    assertClosed(
      withDescriptors(() =>
        assert.throws(
          () => readHostedPrivateText(file),
          /Private configuration must be an exclusive regular file \(0600\)/,
        ),
      ),
    );
    assert.equal(statSync(file).mode & 0o777, mode);
  }
});

test("private hardlinks and a non-private parent retain the existing file-only permission contract", (t) => {
  const { directory, file } = fixture(t);
  chmodSync(directory, 0o755);
  writeFileSync(file, "fictional retained text", { mode: 0o600 });
  const alias = join(directory, "retained-link.env");
  linkSync(file, alias);
  assert.equal(statSync(file).nlink, 2);
  assertClosed(
    withDescriptors(() =>
      assert.equal(readHostedPrivateText(alias), "fictional retained text"),
    ),
  );
  assert.equal(statSync(directory).mode & 0o777, 0o755);
  assert.equal(readFileSync(file, "utf8"), "fictional retained text");
});

test("a pathname replaced after descriptor inspection cannot substitute different private bytes", (t) => {
  const { directory, file } = fixture(t);
  const other = join(directory, "other.env");
  const retained = join(directory, "checked.env");
  writeFileSync(file, "fictional checked bytes", { mode: 0o600 });
  writeFileSync(other, "fictional swapped bytes", { mode: 0o600 });
  const inspect = fs.fstatSync;
  let swapped = false;
  assertClosed(
    withDescriptors(
      () => {
        assert.equal(readHostedPrivateText(file), "fictional checked bytes");
        assert.equal(swapped, true);
      },
      {
        fstatSync: (descriptor) => {
          const info = inspect(descriptor);
          renameSync(file, retained);
          symlinkSync(other, file);
          swapped = true;
          return info;
        },
      },
    ),
  );
  assert.equal(readFileSync(other, "utf8"), "fictional swapped bytes");
  assert.equal(readFileSync(retained, "utf8"), "fictional checked bytes");
});

test("leaf and dangling symlinks fail without reading or creating their targets", (t) => {
  const { directory, file } = fixture(t);
  const target = join(directory, "retained.env");
  writeFileSync(target, "fictional retained bytes", { mode: 0o600 });
  for (const destination of [target, join(directory, "absent.env")]) {
    symlinkSync(destination, file);
    assert.throws(() => readHostedPrivateText(file), { code: "ELOOP" });
    rmSync(file);
  }
  assert.equal(readFileSync(target, "utf8"), "fictional retained bytes");
  assert.equal(existsSync(join(directory, "absent.env")), false);
});

test("a directory is rejected and its opened descriptor is closed", (t) => {
  const { directory } = fixture(t);
  assertClosed(
    withDescriptors(() =>
      assert.throws(() => readHostedPrivateText(directory), /regular file/),
    ),
  );
});

test("FIFO and Unix socket inodes reject without waiting for a peer or opening a network service", (t) => {
  const { directory } = fixture(t);
  const fifo = join(directory, "input.fifo");
  execFileSync("mkfifo", ["-m", "600", fifo]);
  assert.equal(statSync(fifo).isFIFO(), true);
  const socket = join(directory, "input.socket");
  // Bind and immediately close a local Unix inode; no listener or connection is started.
  execFileSync("python3", [
    "-c",
    "import socket,sys; s=socket.socket(socket.AF_UNIX); s.bind(sys.argv[1]); s.close()",
    socket,
  ]);
  assert.equal(statSync(socket).isSocket(), true);
  for (const path of [fifo, socket]) {
    // A broken blocking open must fail this child rather than hang the test runner.
    const child = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import assert from 'node:assert/strict';
         import {readHostedPrivateText} from ${JSON.stringify(new URL("./testing/hosted-private-text.mjs", import.meta.url).href)};
         assert.throws(() => readHostedPrivateText(process.argv[1]));`,
        path,
      ],
      { encoding: "utf8", timeout: 2000 },
    );
    assert.equal(child.error, undefined);
    assert.equal(child.status, 0, child.stderr);
  }
});

for (const boundary of ["fstatSync", "readFileSync"])
  test(`${boundary} errors propagate unchanged and still close the actual descriptor`, (t) => {
    const { file } = fixture(t);
    writeFileSync(file, "fictional retained bytes", { mode: 0o600 });
    const failure = Object.assign(new Error("fictional read boundary error"), {
      code: "EIO",
    });
    assertClosed(
      withDescriptors(
        () =>
          assert.throws(
            () => readHostedPrivateText(file),
            (error) => error === failure,
          ),
        {
          [boundary]: () => {
            throw failure;
          },
        },
      ),
    );
    assert.equal(readFileSync(file, "utf8"), "fictional retained bytes");
  });
