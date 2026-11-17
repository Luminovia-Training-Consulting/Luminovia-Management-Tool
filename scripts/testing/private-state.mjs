/**
 * Private JSON state for local Linux test fixtures, including reused local authentication fixtures.
 * Directory/file descriptors bind checks to the objects actually used; state contents and secrets are never logged.
 */
import {
  closeSync,
  constants,
  fstatSync,
  fchmodSync,
  fsyncSync,
  openSync,
  readSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, resolve } from "node:path";

const MAX_STATE_BYTES = 64 * 1024;
const readFlags =
  constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

/** Opens each parent component without following supplied symlinks, retaining the final owned 0700 directory descriptor. */
function privateParent(file) {
  if (process.platform !== "linux")
    throw new Error("Private fixture state requires the local Linux runtime.");
  const target = resolve(file);
  const parent = dirname(target);
  const flags =
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
  let descriptor = openSync("/", flags);
  try {
    for (const part of parent.split("/").filter(Boolean)) {
      const next = openSync(`/proc/self/fd/${descriptor}/${part}`, flags);
      closeSync(descriptor);
      descriptor = next;
    }
    const info = fstatSync(descriptor);
    if (
      !info.isDirectory() ||
      info.uid !== process.getuid() ||
      (info.mode & 0o7777) !== 0o700
    )
      throw new Error(
        "Private fixture parent must be an owned 0700 directory.",
      );
    return {
      descriptor,
      target: `/proc/self/fd/${descriptor}/${basename(target)}`,
    };
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
}

/** Requires an owned regular file with one link and no group/other access; the caller continues using the same descriptor. */
function privateFile(descriptor) {
  const info = fstatSync(descriptor);
  if (
    !info.isFile() ||
    info.uid !== process.getuid() ||
    info.nlink !== 1 ||
    (info.mode & 0o7077) !== 0
  )
    throw new Error(
      "Private fixture state must be an owned private regular file with one link.",
    );
}

/** Returns null only for an absent file; unsafe paths, read failures and malformed JSON remain errors. */
export function readPrivateJson(file) {
  const parent = privateParent(file);
  let descriptor;
  try {
    try {
      descriptor = openSync(parent.target, readFlags);
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
    privateFile(descriptor);
    // Bound bytes during the read: a file growing after fstat must not evade the memory limit.
    const buffer = Buffer.alloc(MAX_STATE_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = readSync(
        descriptor,
        buffer,
        length,
        buffer.length - length,
        null,
      );
      if (count === 0) break;
      length += count;
    }
    if (length > MAX_STATE_BYTES)
      throw new Error("Private fixture JSON exceeds its bounded size.");
    try {
      return JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          buffer.subarray(0, length),
        ),
      );
    } catch {
      // Native parse errors may include private bytes. Retain the error class without exposing contents or a cause.
      throw new SyntaxError("Private fixture JSON is malformed.");
    }
  } finally {
    try {
      if (descriptor !== undefined) closeSync(descriptor);
    } finally {
      closeSync(parent.descriptor);
    }
  }
}

/** Writes bounded JSON to an exclusively created owned 0600 file, then atomically replaces the target without following symlinks. */
export function writePrivateJson(file, value) {
  const json = JSON.stringify(value);
  if (json === undefined)
    throw new TypeError("Private fixture state must be JSON serializable.");
  const bytes = Buffer.from(json, "utf8");
  if (bytes.length > MAX_STATE_BYTES)
    throw new Error("Private fixture JSON exceeds its bounded size.");
  const parent = privateParent(file);
  const temporary = `${parent.target}.${randomUUID()}.tmp`;
  let descriptor;
  let temporaryOwned = false;
  try {
    // Validate an existing target through its open descriptor, not an exists/lstat check followed by a path-based write.
    // Rename replaces the directory entry; even a target symlink swapped in later is never followed.
    let current;
    try {
      current = openSync(parent.target, readFlags);
      privateFile(current);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    } finally {
      if (current !== undefined) closeSync(current);
    }
    descriptor = openSync(
      temporary,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    temporaryOwned = true;
    privateFile(descriptor);
    fchmodSync(descriptor, 0o600);
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, parent.target);
    temporaryOwned = false;
    fsyncSync(parent.descriptor);
  } finally {
    try {
      if (descriptor !== undefined) closeSync(descriptor);
    } finally {
      try {
        if (temporaryOwned) unlinkSync(temporary);
      } finally {
        closeSync(parent.descriptor);
      }
    }
  }
}
