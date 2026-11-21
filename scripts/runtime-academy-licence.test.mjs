/** A disposable vendor key verifies authenticity and expiry without provisioning an installation. */
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import test from "node:test";
import {
  signAcademyLicence,
  verifyAcademyLicence,
} from "./academy-licence.mjs";

const vendor = generateKeyPairSync("ed25519");
const terms = {
  installation_id: randomUUID(),
  edition: "customer-self-hosted",
  release_commit: "ab".repeat(20),
  issued_at: "2026-11-21T00:00:00.000Z",
  starts_at: "2026-11-22T00:00:00.000Z",
  expires_at: "2026-12-22T00:00:00.000Z",
  grace_until: "2026-12-29T00:00:00.000Z",
  modules: ["lms"],
  limits: {
    seat_count: 30,
    storage_bytes: 300000000,
    api_requests_per_minute: 60,
  },
};

test("valid signature binds an exact dedicated installation, edition and artefact", () => {
  const envelope = signAcademyLicence(terms, vendor.privateKey);
  const clock = Date.parse(terms.starts_at);
  const read = (expected) =>
    verifyAcademyLicence(envelope, vendor.publicKey, expected, clock);
  assert.deepEqual(read(terms), { state: "active", terms });
  for (const change of [
    { installation_id: randomUUID() },
    { edition: "customer-managed" },
    { release_commit: "12".repeat(20) },
  ])
    assert.throws(() => read({ ...terms, ...change }), /binding/);
});

test("reject untrusted signer, tampered payload and unsupported modules", () => {
  const envelope = signAcademyLicence(terms, vendor.privateKey);
  const [, signature] = envelope.split(".");
  const altered = Buffer.from(
    JSON.stringify({ ...terms, limits: { ...terms.limits, seat_count: 3000 } }),
    "utf8",
  ).toString("base64url");
  assert.throws(
    () =>
      verifyAcademyLicence(altered + "." + signature, vendor.publicKey, terms),
    /signature/,
  );
  const untrusted = generateKeyPairSync("ed25519");
  assert.throws(
    () => verifyAcademyLicence(envelope, untrusted.publicKey, terms),
    /signature/,
  );
  assert.throws(
    () =>
      signAcademyLicence(
        { ...terms, modules: ["lms", "finance"] },
        vendor.privateKey,
      ),
    /terms/,
  );
  assert.throws(
    () =>
      signAcademyLicence(
        { ...terms, grace_until: "2027-02-01T00:00:00.000Z" },
        vendor.privateKey,
      ),
    /validity/,
  );
});

test("expiry and grace return states and never mutate the signed limits", () => {
  const envelope = signAcademyLicence(terms, vendor.privateKey);
  for (const [time, state] of [
    [Date.parse(terms.starts_at) - 1, "not-yet-valid"],
    [Date.parse(terms.starts_at), "active"],
    [Date.parse(terms.expires_at), "grace"],
    [Date.parse(terms.grace_until), "expired"],
  ])
    assert.deepEqual(
      verifyAcademyLicence(envelope, vendor.publicKey, terms, time),
      { state, terms },
    );
});
