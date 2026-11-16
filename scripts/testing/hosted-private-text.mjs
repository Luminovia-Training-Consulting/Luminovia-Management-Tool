/**
 * Text-only reads for the explicit hosted development operator check. The same
 * descriptor supplies file metadata and UTF-8 bytes; importing this helper never
 * starts the hosted CLI or creates clients, sessions or network requests.
 */
import assert from "node:assert/strict";
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
} from "node:fs";

const privateFileRefusal =
  "Private configuration must be an exclusive regular file (0600)";

/** Preserve raw text, ENOENT/read failures and the existing no-group/other mode rule; no UID, link-count or parent policy is inferred. */
export function readHostedPrivateText(path) {
  // Do not follow a leaf symlink or wait for a FIFO writer before inspecting
  // the opened object. A later pathname replacement cannot change this fd.
  let descriptor;
  try {
    try {
      descriptor = openSync(
        path,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
    } catch (error) {
      if (error?.code !== "ELOOP" && error?.code !== "ENXIO") throw error;
      // Only open-time symlink/socket errors retain the legacy bounded refusal.
    }
    assert(descriptor !== undefined, privateFileRefusal);
    const stat = fstatSync(descriptor);
    assert(stat.isFile() && (stat.mode & 0o077) === 0, privateFileRefusal);
    return readFileSync(descriptor, "utf8");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}
