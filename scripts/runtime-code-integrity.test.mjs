/**
 * Checks the static import/symbol/route analyser against delivered source and counterexamples.
 * Missing connections must be detected without treating legitimate runtime entry points as dead code.
 */
import assert from "node:assert/strict";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {auditFrontend, scanFrontendRpcReferences, scanRuntimeDeclarations, scanRuntimeExports,} from "./code-integrity.mjs";
import {assertRpcArgumentShapes} from "./native-rpc-catalogue.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// The delivered-source checks inspect the checkout; temporary counterexamples
// below isolate analyser behavior and always remove their own fixture directory.
const report = auditFrontend(root);
test("delivered callables and exports are reachable from executable source", () => {
    assert.deepEqual(
        scanRuntimeDeclarations(root).filter((item) => !item.reachable && (item.callable || item.exported)),
        [],
    );
});

test("dead recursive groups do not count as used and live recursion still works", () => {
    const fixture = mkdtempSync(join(tmpdir(), "luminovia-call-graph-"));
    try {
        mkdirSync(join(fixture, "src"));
        writeFileSync(join(fixture, "src/main.ts"), `
            import { deadA, active } from './other';
            export function deadB() { return deadA(); }
            const deadAlias = deadB;
            function run() {
                function nestedA() { return nestedB(); }
                const nestedB = () => nestedA();
                return active(2);
            }
            const handlers = { run };
            declare const register: (value: unknown) => void;
            register(handlers);
        `);
        writeFileSync(join(fixture, "src/other.ts"), `
            import { deadB } from './main';
            export const deadA = () => deadB();
            export function active(count: number) {
                return count ? callAgain(count - 1) : 0;
            }
            function callAgain(count: number) { return active(count); }
            function unusedRecursion() { return unusedRecursion(); }
        `);
        const declarations = scanRuntimeDeclarations(fixture);
        assert.deepEqual(declarations.filter((entry) => !entry.reachable).map((entry) => entry.name).sort(), [
            "deadA", "deadAlias", "deadB", "nestedA", "nestedB", "unusedRecursion",
        ]);
        for (const name of ["deadA", "deadB", "nestedA", "nestedB", "unusedRecursion"]) {
            const item = declarations.find((entry) => entry.name === name);
            assert.ok(item.local + item.external > 0, name);
        }
    } finally {
        rmSync(fixture, {recursive: true, force: true});
    }
});

test("awaited import destructuring resolves runtime exports without rooting unused functions", () => {
    const fixture = mkdtempSync(join(tmpdir(), "luminovia-lazy-symbols-"));
    try {
        mkdirSync(join(fixture, "src"));
        writeFileSync(join(fixture, "src/main.ts"), `
            async function download() {
                const { template, spreadsheet: workbook } = await import('./workbook');
                return [template(), workbook()];
            }
            export async function disconnected() {
                const { unused } = await import('./workbook');
                return unused();
            }
            void download();
        `);
        writeFileSync(join(fixture, "src/workbook.ts"), `
            function xml() { return '<workbook/>'; }
            export function template() { return xml(); }
            export function spreadsheet() { return xml(); }
            export function unused() {}
            export function untouched() {}
        `);
        const entries = new Map(
            scanRuntimeDeclarations(fixture).map((entry) => [entry.name, entry]),
        );
        for (const name of ["template", "spreadsheet"]) {
            assert.equal(entries.get(name).external, 1, name);
            assert.equal(entries.get(name).reachable, true, name);
        }
        assert.equal(entries.get("xml").reachable, true);
        assert.equal(entries.get("unused").external, 1);
        assert.equal(entries.get("unused").reachable, false);
        assert.equal(entries.get("untouched").external, 0);
        assert.equal(entries.get("untouched").reachable, false);
    } finally {
        rmSync(fixture, {recursive: true, force: true});
    }
});

test("both edition routes count as used through the production alias", () => {
    const fixture = mkdtempSync(join(tmpdir(), "luminovia-edition-entrypoints-"));
    try {
        mkdirSync(join(fixture, "src/app"), {recursive: true});
        writeFileSync(join(fixture, "src/main.tsx"), "import Routes from '@edition-routes'; Routes();");
        for (const [file, name] of [["portal-routes", "PortalRoutes"], ["academy-routes", "AcademyRoutes"]]) {
            writeFileSync(join(fixture, "src/app", file + ".tsx"), `export default function ${name}() {} export const disconnected = true;`);
        }
        const graph = auditFrontend(fixture);
        assert.deepEqual(graph.unreachable, []);
        assert.deepEqual(graph.unresolved, []);
        const exports = scanRuntimeExports(fixture);
        assert.deepEqual(exports.map(({name, external}) => [name, external]), [
            ["AcademyRoutes", 1],
            ["disconnected", 0],
            ["disconnected", 0],
            ["PortalRoutes", 1],
        ]);
    } finally {
        rmSync(fixture, {recursive: true, force: true});
    }
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
            scanRuntimeExports(fixture).map(({name, local, external}) => ({
                name,
                local,
                external,
            })),
            [
                {name: "annotationsOnly", local: 0, external: 0},
                {name: "called", local: 0, external: 2},
                {name: "inspected", local: 0, external: 1},
                {name: "numericValue", local: 0, external: 0},
            ],
        );
    } finally {
        rmSync(fixture, {recursive: true, force: true});
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
        rmSync(fixture, {recursive: true, force: true});
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
      const options = { p_limit: 50 };
      renamed('people_directory', { ...options, p_search: 'fictional' });
      forward(\`profile_courses\`);
      byActor('actor', 'comment_context');
      declare const client: any;
      client.rpc('get_my_permissions');
      declare const ready: boolean;
      forward(ready ? 'accept_action' : 'decline_action');
      declare const runtimeInput: string;
      client.rpc(runtimeInput);
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
        const references = scanFrontendRpcReferences(fixture);
        assert.deepEqual(
            references.map(({name}) => name).sort(),
            [
                "accept_action",
                "comment_context",
                "decline_action",
                "get_my_permissions",
                "people_directory",
                "profile_courses",
            ],
        );
        const byName = Object.fromEntries(references.map(({name, argumentShapes}) => [name, argumentShapes]));
        assert.deepEqual(byName, {
            people_directory: [{required: ["p_limit", "p_search"], possible: ["p_limit", "p_search"]}],
            profile_courses: [{required: [], possible: []}],
            comment_context: [{required: ["actor"], possible: ["actor"]}],
            get_my_permissions: [{required: [], possible: []}],
            accept_action: [],
            decline_action: [],
        });
    } finally {
        rmSync(fixture, {recursive: true, force: true});
    }
});

// A routine name can resolve successfully even when its browser payload
// omits a required field or introduces one PostgreSQL cannot bind.
test("RPC argument binding accepts defaults and rejects incompatible named keys", () => {
    const entries = {
        save_note: {
            overloads: [{request: {required: ["p_body"], properties: {p_body: {}, p_title: {}}}}],
        },
    };
    const reference = {name: "save_note", file: "src/notes.ts", line: 42};
    assert.doesNotThrow(() => assertRpcArgumentShapes(entries, [{
        ...reference,
        argumentShapes: [{required: ["p_body"], possible: ["p_body", "p_title"]}],
    }]));
    assert.throws(() => assertRpcArgumentShapes(entries, [{
        ...reference,
        argumentShapes: [{required: [], possible: ["p_body"]}],
    }]), /src\/notes\.ts:42 cannot call save_note/);
    assert.throws(() => assertRpcArgumentShapes(entries, [{
        ...reference,
        argumentShapes: [{required: ["p_body", "p_typo"], possible: ["p_body", "p_typo"]}],
    }]), /p_body, p_typo/);
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
        rmSync(fixture, {recursive: true, force: true});
    }
});

// Compare exact accepted/rejected paths for splats, nested parameters, escaped
// punctuation and query/hash suffixes. A catch-all must not hide broken links.
test("terminal splats accept their base and descendants without accepting adjacent or wrong static paths", () => {
    const fixture = mkdtempSync(join(tmpdir(), "luminovia-splat-probe-"));
    try {
        mkdirSync(join(fixture, "src"));
        const valid = [
            "/preview",
            "/preview/",
            "/preview/jobs",
            "/preview/admin/accounts",
            "/preview/jobs?module=jobs#practice",
            "/docs/v1.0",
            "/docs/v1.0/intro",
            "/teams/alpha/preview",
            "/teams/alpha/preview/files/one",
            "/jobs/offer-a",
            "/jobs/offer-a/",
            "/settings",
        ];
        const invalid = [
            "/previewgraphy",
            "/previews/jobs",
            "/preview-other/jobs",
            "/docs/v1x0/intro",
            "/teams/alpha/previewgraphy",
            "/teams/alpha/other/files",
            "/teams//preview",
            "/jobs",
            "/jobs/offer-a/unregistered",
            "/settings/nested",
            "/unregistered",
        ];
        writeFileSync(
            join(fixture, "src/main.tsx"),
            `
      const view = <>
        <Route path="/preview/*" />
        <Route path="/docs/v1.0/*" />
        <Route path="/teams"><Route path=":teamId/preview/*" /></Route>
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
        assert.ok(observed.routes.includes("/teams/:teamId/preview/*"));
        assert.deepEqual(observed.unreachable, []);
    } finally {
        rmSync(fixture, {recursive: true, force: true});
    }
});

test("counts browser exports used by the production Vite configuration", () => {
    const fixture = mkdtempSync(join(tmpdir(), "luminovia-vite-entrypoint-"));
    try {
        mkdirSync(join(fixture, "src"));
        writeFileSync(join(fixture, "src/main.tsx"), "export {};");
        writeFileSync(join(fixture, "src/catalogue.ts"), `
            export function buildDocument() { return "OpenAPI"; }
            export function disconnected() { return "unused"; }
        `);
        writeFileSync(join(fixture, "vite.config.ts"), `
            import {buildDocument} from "./src/catalogue";
            export default () => ({document: buildDocument()});
        `);
        const exports = scanRuntimeExports(fixture);
        assert.deepEqual(exports.map(({name, reachable}) => [name, reachable]), [
            ["buildDocument", true],
            ["disconnected", false],
        ]);
    } finally {
        rmSync(fixture, {recursive: true, force: true});
    }
});
