import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  auditFrontend,
  scanFrontendRpcReferences,
  scanRuntimeExports,
} from "./code-integrity.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const report = auditFrontend(root);
test("delivered runtime exports have actual production references beyond their import/export declaration", () => {
  assert.deepEqual(
    scanRuntimeExports(root).filter((item) => !item.local && !item.external),
    [],
  );
});
test("every delivered frontend module is reachable from the real entry point, including lazy/type imports", () => {
  assert.deepEqual(report.unreachable, []);
});

test("RPC discovery follows renamed/transitive wrappers and parameter positions, ignoring source-text lookalikes", () => {
  const fixture = mkdtempSync(join(tmpdir(), "luminovia-rpc-probe-"));
  try {
    mkdirSync(join(fixture, "src"));
    writeFileSync(
      join(fixture, "src/main.ts"),
      `
      import { call as renamed } from './gateway';
      import { forward, byActor } from './forward';
      renamed('people_directory', {});
      forward(\`profile_courses\`);
      byActor('actor', 'comment_context');
      declare const client: any;
      client.rpc('get_my_permissions');
      const authored = "client.rpc('not_an_endpoint')";
      // client.rpc('not_an_endpoint_either');
    `,
    );
    writeFileSync(
      join(fixture, "src/gateway.ts"),
      `
      declare const client: any;
      export async function call<T>(name: string, args: unknown) { return client.rpc(name, args) as T; }
    `,
    );
    writeFileSync(
      join(fixture, "src/forward.ts"),
      `
      import { call } from './gateway';
      export const forward = (name: string) => call(name, {});
      export function byActor(actor: string, endpoint: string) { return call(endpoint, {actor}); }
    `,
    );
    assert.deepEqual(
      scanFrontendRpcReferences(fixture)
        .map(({ name }) => name)
        .sort(),
      [
        "comment_context",
        "get_my_permissions",
        "people_directory",
        "profile_courses",
      ],
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
test("all relative frontend imports and literal public image assets resolve", () => {
  assert.deepEqual(report.unresolved, []);
  assert.deepEqual(report.missingAssets, []);
});
test("literal internal navigation targets are registered application routes", () => {
  assert.deepEqual(report.invalidLinks, []);
});
test("integrity guard identifies an orphan, missing lazy import and disconnected link without deleting files", () => {
  const fixture = mkdtempSync(join(tmpdir(), "luminovia-integrity-probe-"));
  try {
    mkdirSync(join(fixture, "src"));
    writeFileSync(
      join(fixture, "src/main.tsx"),
      'import("./missing"); const view = <><Route path="/valid" /><Link to="/unregistered" /></>;',
    );
    writeFileSync(join(fixture, "src/orphan.ts"), "export const unused = 1;");
    const broken = auditFrontend(fixture);
    assert.deepEqual(broken.unreachable, ["src/orphan.ts"]);
    assert.deepEqual(
      scanRuntimeExports(fixture)
        .filter((item) => !item.local && !item.external)
        .map((item) => item.name),
      ["unused"],
    );
    assert.deepEqual(
      broken.unresolved.map((entry) => entry.specifier),
      ["./missing"],
    );
    assert.deepEqual(
      broken.invalidLinks.map((entry) => entry.path),
      ["/unregistered"],
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
