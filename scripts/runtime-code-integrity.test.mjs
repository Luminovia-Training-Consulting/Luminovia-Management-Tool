/**
 * Checks the static import/symbol/route analyser against delivered source and counterexamples.
 * Missing connections must be detected without treating legitimate runtime entry points as dead code.
 */
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
// The delivered-source checks inspect the checkout; temporary counterexamples
// below isolate analyser behavior and always remove their own fixture directory.
const report = auditFrontend(root);
// Compiler symbols must show use beyond a declaration or a re-export alone.
test("delivered runtime exports have actual production references beyond their import/export declaration", () => {
  assert.deepEqual(
    scanRuntimeExports(root).filter((item) => !item.local && !item.external),
    [],
  );
});
// Erased type references must not disguise a value with no runtime consumer.
// Temporary source fixtures retain genuine calls, runtime typeof and shorthand use.
test("type-only references cannot disguise unused runtime exports, while calls and runtime typeof still count", () => {
  const fixture = mkdtempSync(join(tmpdir(), "luminovia-runtime-types-probe-"));
  try {
    mkdirSync(join(fixture, "src"));
    writeFileSync(
      join(fixture, "src/main.ts"),
      `
      import { annotationsOnly, numericValue, called, inspected } from './values';
      type Signature = typeof annotationsOnly;
      interface Contract { run: typeof annotationsOnly; amount: typeof numericValue; }
      called();
      const registry = { called };
      const runtimeType = typeof inspected;
    `,
    );
    writeFileSync(
      join(fixture, "src/values.ts"),
      `
      export function annotationsOnly() { return 1; }
      export const numericValue = 2;
      export function called() { return 3; }
      export function inspected() { return 4; }
    `,
    );
    assert.deepEqual(
      scanRuntimeExports(fixture).map(({ name, local, external }) => ({
        name,
        local,
        external,
      })),
      [
        { name: "annotationsOnly", local: 0, external: 0 },
        { name: "called", local: 0, external: 2 },
        { name: "inspected", local: 0, external: 1 },
        { name: "numericValue", local: 0, external: 0 },
      ],
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
// A class extends expression executes its base; generic/interface inheritance is erased.
// Preserve that distinction even though TypeScript classifies both as type syntax.
test("runtime class inheritance counts base values while erased inheritance and generic types do not", () => {
  const fixture = mkdtempSync(
    join(tmpdir(), "luminovia-runtime-inheritance-probe-"),
  );
  try {
    mkdirSync(join(fixture, "src"));
    writeFileSync(
      join(fixture, "src/main.ts"),
      `
      import { RuntimeBase, TypeOnlyBase, annotation } from './values';
      interface Shape extends TypeOnlyBase {}
      class Child extends RuntimeBase<typeof annotation> implements TypeOnlyBase {}
      const expression = class extends RuntimeBase<typeof annotation> {};
    `,
    );
    writeFileSync(
      join(fixture, "src/values.ts"),
      `
      export class RuntimeBase<T> {}
      export class TypeOnlyBase {}
      export function annotation() { return 1; }
    `,
    );
    const entries = new Map(
      scanRuntimeExports(fixture).map((entry) => [entry.name, entry]),
    );
    assert.equal(entries.get("RuntimeBase").external, 2);
    assert.equal(entries.get("TypeOnlyBase").external, 0);
    assert.equal(entries.get("annotation").external, 0);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

// Both lazy and type imports participate in this static connectivity graph.
test("every delivered frontend module is reachable from the real entry point, including lazy/type imports", () => {
  assert.deepEqual(report.unreachable, []);
});

// Synthetic TypeScript is analysed without executing a backend request. Renamed
// wrappers and non-first name parameters count; authored text and comments do not.
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
// Existence checks cover statically declared local paths, not remote resources.
test("all relative frontend imports and literal public image assets resolve", () => {
  assert.deepEqual(report.unresolved, []);
  assert.deepEqual(report.missingAssets, []);
});
// Static internal links must fit the route patterns collected from delivered JSX.
test("literal internal navigation targets are registered application routes", () => {
  assert.deepEqual(report.invalidLinks, []);
});
// Prove the guard detects deliberate breakage rather than only accepting the
// delivered tree. The orphan remains present for the independent export scan.
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

// Compare exact accepted/rejected paths for splats, nested parameters, escaped
// punctuation and query/hash suffixes. A catch-all must not hide broken links.
test("terminal splats accept their base and descendants without accepting adjacent or wrong static paths", () => {
  const fixture = mkdtempSync(join(tmpdir(), "luminovia-splat-probe-"));
  try {
    mkdirSync(join(fixture, "src"));
    const valid = [
      "/demo",
      "/demo/",
      "/demo/jobs",
      "/demo/admin/accounts",
      "/demo/jobs?module=jobs#practice",
      "/docs/v1.0",
      "/docs/v1.0/intro",
      "/teams/alpha/demo",
      "/teams/alpha/demo/files/one",
      "/jobs/offer-a",
      "/jobs/offer-a/",
      "/settings",
    ];
    const invalid = [
      "/demography",
      "/demos/jobs",
      "/demo-other/jobs",
      "/docs/v1x0/intro",
      "/teams/alpha/demography",
      "/teams/alpha/other/files",
      "/teams//demo",
      "/jobs",
      "/jobs/offer-a/unregistered",
      "/settings/nested",
      "/unregistered",
    ];
    writeFileSync(
      join(fixture, "src/main.tsx"),
      `
      const view = <>
        <Route path="/demo/*" />
        <Route path="/docs/v1.0/*" />
        <Route path="/teams"><Route path=":teamId/demo/*" /></Route>
        <Route path="/jobs/:id" />
        <Route path="/settings" />
        <Route path="*" />
        ${[...valid, ...invalid].map((path) => `<Link to=${JSON.stringify(path)} />`).join("\n")}
      </>;
    `,
    );
    const observed = auditFrontend(fixture);
    assert.deepEqual(
      observed.invalidLinks.map((entry) => entry.path),
      invalid,
    );
    assert.ok(observed.routes.includes("/teams/:teamId/demo/*"));
    assert.deepEqual(observed.unreachable, []);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
