/**
 * Verify development-backup acceptance and failure boundaries with synthetic child-process streams.
 * The fixtures never connect to the hosted server or use real account data.
 */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createDevelopmentBackup, databaseImage } from "./backup.mjs";

const databaseDump = Buffer.from("synthetic database dump\n");
const rolesDump = Buffer.from("synthetic role definitions\n");
const storageArchive = Buffer.from("synthetic storage archive\n");
const objectBytes = Buffer.from("fictional object bytes");
const objectInventory = Buffer.from(
  JSON.stringify({
    path: "fictional-bucket/object.txt",
    sha256: createHash("sha256").update(objectBytes).digest("hex"),
    bytes: objectBytes.length,
  }) + "\n",
);
const summary = {
  server_version: "17.6",
  counts: { profiles: 2, storage_objects: 1 },
};

/** Return deterministic output for each command in the backup's fixed SSH sequence. */
function streamFixture(args, failure, inventoryCalls) {
  const remoteCommand = args.at(-1);
  let output;
  let key;
  if (remoteCommand.includes("pg_dumpall")) {
    key = "roles.sql";
    output = rolesDump;
  } else if (remoteCommand.includes("pg_dump")) {
    key = "database.dump";
    output = databaseDump;
  } else if (remoteCommand === "python3 -") {
    key = "objects.jsonl";
    output = objectInventory;
  } else if (remoteCommand.startsWith("tar --create")) {
    key = "storage.tar";
    output = storageArchive;
  } else {
    throw new Error("Unexpected synthetic backup command.");
  }
  if (failure === key && key !== "objects.jsonl")
    return { output: Buffer.from("partial private bytes"), exitCode: 1 };
  if (failure === "objects.after.jsonl" && key === "objects.jsonl") {
    inventoryCalls.value++;
    if (inventoryCalls.value === 2)
      return { output: Buffer.from("partial private bytes"), exitCode: 1 };
  }
  if (failure === "objects.jsonl" && key === "objects.jsonl")
    return { output: Buffer.from("partial private bytes"), exitCode: 1 };
  return { output };
}

/** Supply synthetic metadata and child streams while retaining the real file/hash/manifest logic. */
function syntheticDependencies(failure) {
  const inventoryCalls = { value: 0 };
  return {
    async collectCommand(program, args) {
      const remoteCommand = args.at(-1);
      if (program === "git") return "";
      if (remoteCommand.includes("docker inspect"))
        return JSON.stringify(databaseImage);
      if (remoteCommand.includes("psql")) return JSON.stringify(summary);
      throw new Error("Unexpected synthetic metadata command.");
    },
    startCommand(program, args) {
      const fixture = streamFixture(args, failure, inventoryCalls);
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = new PassThrough();
      child.kill = () => true;
      const completed = new Promise((resolve, reject) => {
        child.once("close", (code) => {
          if (code === 0) resolve({ stderrBytes: 0 });
          else reject(new Error("Synthetic child process failed."));
        });
      });
      completed.catch(() => {});
      queueMicrotask(() => {
        child.stdout.end(fixture.output);
        child.stderr.end();
        child.emit("close", fixture.exitCode ?? 0);
      });
      return { child, completed };
    },
  };
}

/** Give each test a private temporary backup root so parallel tests cannot share fixtures. */
async function withBackupFixture(run) {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "luminovia-backup-test-"));
  const outputRoot = resolve(temporaryRoot, "backups");
  try {
    await run(outputRoot);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

test("backup refuses to run until the caller confirms quiescent writes", async () => {
  let commandCalls = 0;
  await withBackupFixture(async (outputRoot) => {
    await assert.rejects(
      createDevelopmentBackup({
        dependencies: {
          collectCommand: async () => commandCalls++,
          outputRoot,
        },
      }),
      /Confirm quiescent/,
    );
    assert.equal(commandCalls, 0);
  });
});

test("a failed artifact stream leaves only private incomplete evidence", async () => {
  for (const failure of [
    "database.dump",
    "roles.sql",
    "objects.jsonl",
    "storage.tar",
    "objects.after.jsonl",
  ]) {
    await withBackupFixture(async (outputRoot) => {
      await assert.rejects(
        createDevelopmentBackup({
          quiescent: true,
          dependencies: {
            ...syntheticDependencies(failure),
            outputRoot,
          },
        }),
        /Development backup was not accepted/,
        `stream failure at ${failure} must reject`,
      );
      const added = await readdir(outputRoot);
      assert.equal(added.length, 1);
      const partial = resolve(outputRoot, added[0]);
      assert.match(added[0], /\.partial$/);
      await assert.rejects(stat(resolve(partial, "manifest.json")), {
        code: "ENOENT",
      });
      assert.equal(
        JSON.parse(await readFile(resolve(partial, "INCOMPLETE.json"), "utf8"))
          .status,
        "incomplete",
      );
    });
  }
});

test("successful backup manifests hash every expected synthetic artifact", async () => {
  await withBackupFixture(async (outputRoot) => {
    const result = await createDevelopmentBackup({
      quiescent: true,
      dependencies: { ...syntheticDependencies(), outputRoot },
    });
    assert.equal(result.manifest.status, "complete");
    assert.deepEqual(
      JSON.parse(
        await readFile(resolve(result.directory, "manifest.json"), "utf8"),
      ),
      result.manifest,
    );
    const names = await readdir(result.directory);
    assert.deepEqual(names.sort(), [
      "database.dump",
      "manifest.json",
      "objects.jsonl",
      "roles.sql",
      "storage.tar",
    ]);
    const expected = {
      "database.dump": databaseDump,
      "roles.sql": rolesDump,
      "objects.jsonl": objectInventory,
      "storage.tar": storageArchive,
    };
    for (const [name, bytes] of Object.entries(expected)) {
      assert.deepEqual(result.manifest.artifacts[name], {
        sha256: createHash("sha256").update(bytes).digest("hex"),
        bytes: bytes.length,
      });
      assert.deepEqual(
        (await readFile(resolve(result.directory, name))).toString(),
        bytes.toString(),
      );
    }
    assert.deepEqual(result.manifest.objects, {
      files: 1,
      bytes: objectBytes.length,
    });
    assert.deepEqual(await readdir(outputRoot), [
      result.directory.split("/").at(-1),
    ]);
  });
});
