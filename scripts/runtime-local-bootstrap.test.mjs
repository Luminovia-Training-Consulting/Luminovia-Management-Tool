/** Local bootstrap always follows the active Auth instance, never a stale marker. */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ensureLocalAccounts,
  localBootstrapPassword,
  LOCAL_TEST_DEFAULT_PASSWORD,
} from "./local-bootstrap.mjs";

test("stale bootstrap marker does not skip seeding an empty active Auth project", async () => {
  const directory = mkdtempSync(join(tmpdir(), "portal-local-bootstrap-"));
  const markerPath = join(directory, "bootstrap.json");
  writeFileSync(
    markerPath,
    JSON.stringify({
      projectId: "previous-project",
      existingDataPreserved: false,
    }),
  );
  let seeded = 0;
  let logged = "";
  try {
    const result = await ensureLocalAccounts({
      apiUrl: "http://127.0.0.1:60321",
      serviceRoleKey: "local-fictional-key",
      projectId: "current-project",
      markerPath,
      request: async (url, options) => {
        assert.equal(
          url,
          "http://127.0.0.1:60321/auth/v1/admin/users?page=1&per_page=1",
        );
        assert.equal(options.headers.apikey, "local-fictional-key");
        return { ok: true, json: async () => ({ users: [] }) };
      },
      seed: async () => seeded++,
      log: (message) => (logged = message),
      write: (path, value) => writeFileSync(path, value),
      now: () => "2026-11-17T00:00:00.000Z",
    });

    assert.deepEqual(result, { seeded: true, existingDataPreserved: false });
    assert.equal(seeded, 1);
    assert.match(logged, /fictional lecturers/);
    assert.deepEqual(JSON.parse(readFileSync(markerPath, "utf8")), {
      projectId: "current-project",
      createdAt: "2026-11-17T00:00:00.000Z",
      existingDataPreserved: false,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("existing local accounts are preserved when the marker belongs to another project", async () => {
  const directory = mkdtempSync(join(tmpdir(), "portal-local-bootstrap-"));
  const markerPath = join(directory, "bootstrap.json");
  writeFileSync(markerPath, JSON.stringify({ projectId: "old-project" }));
  let seeded = 0;
  try {
    const result = await ensureLocalAccounts({
      apiUrl: "http://127.0.0.1:60321",
      serviceRoleKey: "local-fictional-key",
      projectId: "current-project",
      markerPath,
      request: async () => ({
        ok: true,
        json: async () => ({ users: [{ id: "existing" }] }),
      }),
      seed: async () => seeded++,
      log: () => assert.fail("Existing accounts must not be reseeded."),
      write: (path, value) => writeFileSync(path, value),
      now: () => "2026-11-17T00:00:00.000Z",
    });

    assert.deepEqual(result, { seeded: false, existingDataPreserved: true });
    assert.equal(seeded, 0);
    assert.equal(
      JSON.parse(readFileSync(markerPath, "utf8")).projectId,
      "current-project",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("only an empty local Auth instance receives the stable demo password", () => {
  assert.equal(
    LOCAL_TEST_DEFAULT_PASSWORD,
    "Local!2668646243648f005c40750171d700f7ebeb732eAa9",
  );
  assert.equal(
    localBootstrapPassword(undefined, 0),
    LOCAL_TEST_DEFAULT_PASSWORD,
  );
  assert.equal(
    localBootstrapPassword("old-project-password", 0),
    LOCAL_TEST_DEFAULT_PASSWORD,
  );
  assert.equal(
    localBootstrapPassword("user-changed-password", 1),
    "user-changed-password",
  );
  assert.equal(localBootstrapPassword(undefined, 1), undefined);
});
