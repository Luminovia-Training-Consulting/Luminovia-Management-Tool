import assert from "node:assert/strict";
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
} from "node:fs";

/** Assert permissions on the same open fixture that supplies the test bytes. */
export function readPrivateFixture(path) {
  const file = openSync(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const facts = fstatSync(file);
    assert(facts.isFile() && facts.nlink === 1);
    assert.equal(facts.mode & 0o777, 0o600);
    return readFileSync(file);
  } finally {
    closeSync(file);
  }
}
