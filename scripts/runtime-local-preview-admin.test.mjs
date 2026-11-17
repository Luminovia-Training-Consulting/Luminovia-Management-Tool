import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  chmodSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  previewIdentity,
  createPreviewAdmin,
  ensurePreviewAdmin,
  previewMarkerStore,
} from "./local-preview-admin.mjs";

test("weak local account is fenced to the registered preview and exact loopback stack", () => {
  const checkout = mkdtempSync(join(tmpdir(), "local-preview-admin-"));
  try {
    const source = join(checkout, ".local/github-preview/source");
    mkdirSync(source, { recursive: true });
    const id = `luminovia-portal-github-${createHash("sha256").update(checkout).digest("hex").slice(0, 12)}`;
    const config = {
      id,
      api: 56321,
      database: 56322,
      site: "http://127.0.0.1:5373",
    };
    const owner = {
      version: 1,
      checkout,
      project: id,
      repository:
        "https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool.git",
    };
    const labels = {
      "com.supabase.cli.project": id,
      "com.supabase.cli.workdir": source,
    };
    assert.equal(
      previewIdentity(source, config, owner, "http://127.0.0.1:56321", labels),
      id,
    );
    for (const [cfg, own, url, lab] of [
      [
        { ...config, id: "luminovia-portal" },
        owner,
        "http://127.0.0.1:56321",
        labels,
      ],
      [config, owner, "https://cms.luminovia.org/backend", labels],
      [
        config,
        { ...owner, checkout: "/tmp/other" },
        "http://127.0.0.1:56321",
        labels,
      ],
      [
        config,
        owner,
        "http://127.0.0.1:56321",
        { ...labels, "com.supabase.cli.workdir": "/tmp/other" },
      ],
    ])
      assert.throws(() => previewIdentity(source, cfg, own, url, lab));
  } finally {
    rmSync(checkout, { recursive: true, force: true });
  }
});

test("pre-existing accounts are never adopted and foreign markers are rejected", async () => {
  const root = mkdtempSync(join(tmpdir(), "preview-admin-existing-"));
  try {
    const store = previewMarkerStore(join(root, "marker.json"));
    const existing = {
      id: "00000000-0000-4000-a000-000000000001",
      email: "local-preview-admin@example.invalid",
    };
    const service = {
      auth: {
        admin: { listUsers: async () => ({ data: { users: [existing] } }) },
      },
    };
    assert.equal(
      await createPreviewAdmin({
        service,
        markerStore: store,
        finalize: () => assert.fail("must not finalize"),
      }),
      false,
    );
    store.create({
      id: "00000000-0000-4000-a000-000000000002",
      token: "a".repeat(64),
    });
    await assert.rejects(
      createPreviewAdmin({
        service,
        markerStore: store,
        finalize: () => assert.fail("must not finalize"),
      }),
      /ownership/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("real process termination after identity creation or commit recovers once without resetting later changes", () => {
  const root = mkdtempSync(join(tmpdir(), "preview-admin-killed-"));
  try {
    const helper = join(root, "child.mjs");
    const moduleUrl = pathToFileURL(
      join(process.cwd(), "scripts/local-preview-admin.mjs"),
    ).href;
    writeFileSync(
      helper,
      `
      import { readFileSync, writeFileSync, existsSync } from "node:fs";
      import { createPreviewAdmin, previewMarkerStore } from ${JSON.stringify(moduleUrl)};
      const [db, marker, point] = process.argv.slice(2);
      const read = () => existsSync(db) ? JSON.parse(readFileSync(db, "utf8")) : { users: [] };
      const write = (data) => writeFileSync(db, JSON.stringify(data));
      const service = { auth: { admin: {
        listUsers: async () => ({ data: read() }),
        createUser: async ({ id, email, app_metadata }) => {
          const data = read(); const user = { id, email, app_metadata }; data.users.push(user); write(data);
          if (point === "after-create") process.kill(process.pid, "SIGKILL");
          return { data: { user } };
        },
      } } };
      await createPreviewAdmin({ service, markerStore: previewMarkerStore(marker), finalize: async ({id, token}) => {
        const data = read(); const user = data.users.find((value) => value.id === id);
        if (user.app_metadata.luminovia_preview_bootstrap.token !== token) throw Error("ownership");
        user.app_metadata.luminovia_preview_bootstrap.state = "complete"; user.password = "admin"; user.role = "admin"; write(data);
        if (point === "after-commit") process.kill(process.pid, "SIGKILL");
      } });
    `,
    );
    for (const point of ["after-create", "after-commit"]) {
      const db = join(root, `${point}.json`);
      const marker = join(root, `${point}-marker.json`);
      const first = spawnSync(process.execPath, [helper, db, marker, point]);
      assert.equal(first.signal, "SIGKILL", first.stderr.toString());
      const second = spawnSync(process.execPath, [
        helper,
        db,
        marker,
        "normal",
      ]);
      assert.equal(second.status, 0, second.stderr.toString());
      const state = JSON.parse(readFileSync(db, "utf8"));
      assert.equal(state.users.length, 1);
      assert.equal(state.users[0].role, "admin");
      assert.equal(state.users[0].password, "admin");
      state.users[0].password = "user-changed";
      state.users[0].email = "changed@example.invalid";
      writeFileSync(db, JSON.stringify(state));
      const third = spawnSync(process.execPath, [helper, db, marker, "normal"]);
      assert.equal(third.status, 0, third.stderr.toString());
      assert.equal(
        JSON.parse(readFileSync(db, "utf8")).users[0].password,
        "user-changed",
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("private marker rejects symlinks, foreign modes and malformed identities", () => {
  const root = mkdtempSync(join(tmpdir(), "preview-admin-marker-"));
  try {
    const path = join(root, "marker.json");
    const target = join(root, "target");
    const store = previewMarkerStore(path);
    writeFileSync(target, "{}", { mode: 0o600 });
    symlinkSync(target, path);
    assert.throws(() => store.read());
    rmSync(path);
    writeFileSync(
      path,
      JSON.stringify({ id: "not-a-uuid", token: "a".repeat(64) }),
      { mode: 0o600 },
    );
    assert.throws(() => store.read(), /Invalid/);
    chmodSync(path, 0o644);
    assert.throws(() => store.read(), /Unsafe/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("normal development and hosted-like configurations never seed the preview identity", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "normal-local-admin-"));
  try {
    mkdirSync(join(cwd, "supabase"));
    for (const project of [
      "luminovia-portal",
      "luminovia-portal-test-aab1",
      "luminovia-portal-pr-7-aabbccddeeff",
      "production",
    ]) {
      writeFileSync(
        join(cwd, "supabase/config.toml"),
        `project_id = "${project}"\n`,
      );
      assert.equal(await ensurePreviewAdmin(cwd), false);
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
