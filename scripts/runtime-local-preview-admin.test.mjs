import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  previewIdentity,
  createPreviewAdmin,
  ensurePreviewAdmin,
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

test("existing preview account is never reset; creation failure removes only the new identity", async () => {
  const id = "00000000-0000-4000-a000-000000000001";
  const removed = [];
  let present = true;
  const service = {
    auth: {
      admin: {
        listUsers: async () => ({
          data: {
            users: present
              ? [{ email: "local-preview-admin@example.invalid" }]
              : [],
          },
        }),
        createUser: async () => ({ data: { user: { id } } }),
        deleteUser: async (value) => {
          removed.push(value);
          return {};
        },
      },
    },
    from: () => ({ upsert: async () => ({}) }),
  };
  let writes = 0;
  assert.equal(
    await createPreviewAdmin({
      service,
      setPassword: async () => {
        writes++;
      },
    }),
    false,
  );
  assert.equal(writes, 0);
  present = false;
  await assert.rejects(
    createPreviewAdmin({
      service,
      setPassword: async () => {
        throw new Error("failed");
      },
    }),
    /failed/,
  );
  assert.deepEqual(removed, [id]);
  assert.equal(
    await createPreviewAdmin({
      service,
      setPassword: async (value) => {
        assert.equal(value, id);
        writes++;
      },
    }),
    true,
  );
  assert.equal(writes, 1);
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
