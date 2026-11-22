import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import {
  assertResetDockerHost,
  confirmLocalReset,
  localResetTarget,
  resetLocalPortal,
} from "./local-reset.mjs";

const project = "luminovia-portal";
const projectLabel = "com.supabase.cli.project";
const db = `supabase_db_${project}`;
const scanner = `portal_clamav_${project}`;
const outsider = "supabase_db_fictional-other";

function checkout(t, name = project) {
  const root = mkdtempSync(join(tmpdir(), "portal-reset-fixture-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const path of ["supabase/.temp", "supabase/.branches", ".local"])
    mkdirSync(join(root, path), { recursive: true });
  writeFileSync(
    join(root, "supabase/config.toml"),
    `project_id = "${name}"\n[api]\nport = 54321\n[db]\nport = 54322\n[local_smtp]\nport = 54324\n[auth]\nsite_url = "http://127.0.0.1:5173"\n`,
  );
  writeFileSync(
    join(root, ".env.local"),
    "VITE_SUPABASE_URL=http://127.0.0.1:54321\n",
  );
  writeFileSync(
    join(root, ".env.test.local"),
    "SUPABASE_URL=http://127.0.0.1:54321\nDATABASE_URL=postgresql://fixture:fixture@127.0.0.1:54322/postgres\n",
  );
  writeFileSync(join(root, ".local/ADMIN-DEMO.txt"), "old fictional account");
  writeFileSync(join(root, ".local/keep.txt"), "owned QA evidence");
  return root;
}

function runtime(root) {
  const calls = [];
  const volumes = new Map([
    [db, { [projectLabel]: project }],
    [scanner, {}],
    [outsider, { [projectLabel]: "fictional-other" }],
  ]);
  const state = {
    running: true,
    owned: true,
    foreignHolder: false,
    restartError: false,
  };
  const operations = {
    checkout: root,
    confirmed: localResetTarget(root),
    ownsRuntime: () => state.owned,
    stop: async () => {
      calls.push("stop");
      state.running = false;
    },
    start: async () => {
      calls.push("start");
      if (state.restartError) throw new Error("fixture restart failed");
    },
    docker: async ([resource, action, ...args]) => {
      if (resource === "container" && action === "ls") {
        if (args.includes(`volume=${db}`) && state.foreignHolder)
          return "foreign-id\n";
        if (args.some((arg) => arg.startsWith("volume="))) return "";
        if (!state.running) return "";
        return args.includes(`label=${projectLabel}=${project}`)
          ? "portal-id\n"
          : `portal-id ${db}\n`;
      }
      if (resource === "container" && action === "inspect") {
        assert.equal(args.at(-1), "portal-id");
        return JSON.stringify({
          Name: `/${db}`,
          Labels: { [projectLabel]: project },
          Running: true,
          Networks: { [`portal_network_${project}`]: {} },
          Ports: { "5432/tcp": [{ HostIp: "127.0.0.1" }] },
        });
      }
      if (resource === "network" && action === "ls") return "";
      if (resource === "volume" && action === "ls")
        return [...volumes]
          .map(([Name, labels]) =>
            JSON.stringify({
              Name,
              Labels: Object.entries(labels)
                .map((pair) => pair.join("="))
                .join(","),
            }),
          )
          .join("\n");
      if (resource === "volume" && action === "inspect")
        return JSON.stringify([
          {
            Name: args[0],
            Driver: "local",
            Scope: "local",
            Labels: volumes.get(args[0]),
            Options: null,
          },
        ]);
      if (resource === "volume" && action === "rm") {
        assert.equal(args.length, 1);
        calls.push(args[0]);
        volumes.delete(args[0]);
        return args[0];
      }
      throw new Error(`Unexpected fixture operation ${resource} ${action}`);
    },
  };
  return { calls, operations, state, volumes };
}

test("reset confirmation is bound to the exact local project and does not default to yes", async (t) => {
  const root = checkout(t);
  await assert.rejects(
    confirmLocalReset([], project, { input: { isTTY: false } }),
    /Confirmation required/,
  );
  await assert.rejects(
    confirmLocalReset(["--confirm", "other"], project),
    /Use \.\/portal reset/,
  );
  await assert.rejects(
    confirmLocalReset(["--yes"], project),
    /Use \.\/portal reset/,
  );
  await confirmLocalReset(["--confirm", localResetTarget(root).id], project);
});

test("interactive reset accepts only the complete phrase printed in its prompt", async () => {
  function answer(text) {
    const input = new PassThrough();
    input.isTTY = true;
    const output = new PassThrough();
    const confirmed = confirmLocalReset([], project, { input, output });
    input.end(text + "\n");
    return { confirmed, output };
  }
  await assert.rejects(answer("yes").confirmed, /reset cancelled/);
  const { confirmed, output } = answer(`RESET ${project}`);
  await confirmed;
  assert.match(
    output.read().toString(),
    /Permanently erase local project luminovia-portal/,
  );
});

test("reset refuses linked projects, nonlocal settings, and linked runtime directories", (t) => {
  const root = checkout(t);
  for (const host of [
    "ssh://qa.example.invalid",
    "tcp://127.0.0.1:2375",
    "unix:///tmp/forwarded.sock",
  ])
    assert.throws(() => assertResetDockerHost(host), /local Docker Engine/);
  assert.doesNotThrow(() =>
    assertResetDockerHost("unix:///var/run/docker.sock"),
  );
  assert.doesNotThrow(() =>
    assertResetDockerHost("unix:///run/user/1200/docker.sock", 1200),
  );
  writeFileSync(
    join(root, "supabase/.temp/project-ref"),
    "fictional-remote-project",
  );
  assert.throws(() => localResetTarget(root), /unlinked local projects/);
  assert.throws(
    () => localResetTarget(checkout(t, "a-different-project")),
    /supported local/,
  );
  const remoteEnv = checkout(t);
  writeFileSync(
    join(remoteEnv, ".env.local"),
    "VITE_SUPABASE_URL=https://unrelated.example.invalid\n",
  );
  assert.throws(() => localResetTarget(remoteEnv), /loopback|credential-free/);
  const linked = checkout(t);
  rmSync(join(linked, ".local"), { recursive: true });
  symlinkSync(join(root, ".local"), join(linked, ".local"));
  assert.throws(() => localResetTarget(linked), /linked or unowned/);
});

test("complete reset deletes only the verified project's persistent volumes and known generated state before restart", async (t) => {
  const root = checkout(t);
  const { calls, operations, volumes } = runtime(root);
  await resetLocalPortal(operations);
  assert.deepEqual(calls, ["stop", db, scanner, "start"]);
  assert.deepEqual([...volumes.keys()], [outsider]);
  for (const file of [".env.local", ".env.test.local", ".local/ADMIN-DEMO.txt"])
    assert.equal(existsSync(join(root, file)), false);
  assert.equal(
    readFileSync(join(root, ".local/keep.txt"), "utf8"),
    "owned QA evidence",
  );
  assert.ok(existsSync(join(root, "supabase/config.toml")));
});

test("a running nonowned stack, foreign volume holder or incorrect label prevents every mutation", async (t) => {
  const root = checkout(t);
  const running = runtime(root);
  running.state.owned = false;
  await assert.rejects(
    resetLocalPortal(running.operations),
    /owning portal checkout/,
  );
  assert.deepEqual(running.calls, []);
  const occupied = runtime(root);
  occupied.state.foreignHolder = true;
  await assert.rejects(
    resetLocalPortal(occupied.operations),
    /unrelated container/,
  );
  assert.deepEqual(occupied.calls, []);
  const foreign = runtime(root);
  foreign.volumes.set(db, { [projectLabel]: "a-different-project" });
  await assert.rejects(
    resetLocalPortal(foreign.operations),
    /foreign or nonstandard/,
  );
  assert.deepEqual(foreign.calls, []);
});

test("reset preserves data on failed shutdown and surfaces a failed fresh startup", async (t) => {
  const root = checkout(t);
  const shutdown = runtime(root);
  shutdown.operations.stop = async () => {
    throw new Error("fixture stop failed");
  };
  await assert.rejects(
    resetLocalPortal(shutdown.operations),
    /fixture stop failed/,
  );
  assert.equal(shutdown.volumes.size, 3);
  assert.ok(existsSync(join(root, ".env.test.local")));
  const restart = runtime(root);
  restart.state.restartError = true;
  await assert.rejects(
    resetLocalPortal(restart.operations),
    /fixture restart failed/,
  );
  assert.deepEqual(restart.calls, ["stop", db, scanner, "start"]);
});
