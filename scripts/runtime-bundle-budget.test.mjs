import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { checkBundleBudget } from "./runtime-bundle-budget.mjs";

const explorer = "src/features/developer-api/portal-explorer.tsx";
const swagger = "src/features/developer-api/swagger-view.tsx";
const files = {
  "index.html": "<!doctype html>",
  "entry.js": "import './shared.js';",
  "shared.js": "export const shell = true;",
  "entry.css": ":root { color-scheme: light dark; }",
  "explorer.js": "import './shared.js'; import './schema.js';",
  "schema.js": "export const schema = { title: 'API' };",
  "swagger.js": "export const renderer = true;",
  "icon.png": "fictional icon bytes",
};

function fixture(
  context,
  { precache = ["index.html", "icon.png"], entry, entries = {} } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "luminovia-bundle-budget-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files))
    writeFileSync(join(directory, name), content);
  mkdirSync(join(directory, ".vite"));
  writeFileSync(
    join(directory, ".vite/manifest.json"),
    JSON.stringify({
      "index.html": entry ?? {
        file: "entry.js",
        imports: ["shared", "shared"],
        css: ["entry.css"],
        dynamicImports: [explorer],
      },
      shared: { file: "shared.js" },
      schema: { file: "schema.js" },
      [explorer]: {
        file: "explorer.js",
        imports: ["shared", "schema"],
        dynamicImports: [swagger],
      },
      [swagger]: { file: "swagger.js", imports: ["shared"] },
      ...entries,
    }),
  );
  const cacheEntries = precache.map((url) => ({ url, revision: null }));
  writeFileSync(
    join(directory, "sw.js"),
    `worker.precacheAndRoute(${JSON.stringify(cacheEntries)});`,
  );
  return directory;
}

test("measure shared startup chunks once and budget the incremental and cold explorer and PWA separately", (context) => {
  const directory = fixture(context, {
    precache: ["index.html", "icon.png", "icon.png"],
  });
  const zipBytes = (names) =>
    names.reduce(
      (total, name) => total + gzipSync(files[name], { level: 9 }).length,
      0,
    );
  const startup = zipBytes([
    "index.html",
    "entry.js",
    "shared.js",
    "entry.css",
  ]);
  const explorer = zipBytes(["explorer.js", "schema.js", "swagger.js"]);
  const coldExplorer = startup + explorer;
  const precache = files["index.html"].length + files["icon.png"].length;
  assert.equal(
    checkBundleBudget(directory, { startup, explorer, coldExplorer, precache })
      .length,
    4,
  );
  assert.throws(
    () =>
      checkBundleBudget(directory, {
        startup: startup - 1,
        explorer,
        coldExplorer,
        precache,
      }),
    /Startup.+over budget/,
  );
  assert.throws(
    () =>
      checkBundleBudget(directory, {
        startup,
        explorer: explorer - 1,
        coldExplorer,
        precache,
      }),
    /API explorer.+over budget/,
  );
  assert.throws(
    () =>
      checkBundleBudget(directory, {
        startup,
        explorer,
        coldExplorer: coldExplorer - 1,
        precache,
      }),
    /Cold API explorer.+over budget/,
  );
  assert.throws(
    () =>
      checkBundleBudget(directory, {
        startup,
        explorer,
        coldExplorer,
        precache: precache - 1,
      }),
    /PWA precache.+over budget/,
  );
});

test("reject eagerly loaded and service worker precached explorer chunks", (context) => {
  const installed = fixture(context, {
    precache: ["index.html", "explorer.js"],
  });
  const eager = fixture(context, {
    entry: { file: "entry.js", imports: [explorer] },
  });
  for (const directory of [installed, eager]) {
    assert.throws(
      () => checkBundleBudget(directory),
      /must load on demand: explorer\.js/,
    );
  }
});

test("fail closed when the manifest or generated offline shell is incomplete", (context) => {
  const invalid = fixture(context, {
    entry: { file: "entry.js", imports: ["missing"] },
  });
  assert.throws(
    () => checkBundleBudget(invalid),
    /Missing build manifest chunk: missing/,
  );
  const offline = fixture(context, { precache: ["icon.png"] });
  assert.throws(
    () => checkBundleBudget(offline),
    /missing the API explorer or offline navigation shell/,
  );
});

test("keep the private workspace out of startup and keep all of its static dependencies offline", (context) => {
  const privateShell = "src/app/shell.tsx";
  const entries = {
    [privateShell]: { file: "schema.js", imports: ["shared"] },
  };
  const precache = ["index.html", "schema.js", "shared.js"];
  assert.doesNotThrow(() =>
    checkBundleBudget(fixture(context, { entries, precache })),
  );
  assert.throws(
    () =>
      checkBundleBudget(
        fixture(context, { entries, precache: ["index.html", "schema.js"] }),
      ),
    /Offline shell dependency is not precached: shared\.js/,
  );
  assert.throws(
    () =>
      checkBundleBudget(
        fixture(context, {
          entries,
          precache,
          entry: { file: "entry.js", imports: [privateShell] },
        }),
      ),
    /private workspace must load after startup/,
  );
});

test("reject opening the writer with an ordinary read or a worker installation", (context) => {
  const editor = "src/features/knowledge/knowledge-editor.tsx";
  const reader = "src/features/knowledge/articles.tsx";
  const entries = { [editor]: { file: "schema.js" } };
  assert.throws(
    () =>
      checkBundleBudget(
        fixture(context, { entries, precache: ["index.html", "schema.js"] }),
      ),
    /Knowledge editing or highlighting asset must load on demand/,
  );
  assert.throws(
    () =>
      checkBundleBudget(
        fixture(context, {
          entries: {
            ...entries,
            [reader]: { file: "icon.png", imports: [editor] },
          },
        }),
      ),
    /Knowledge editing or highlighting asset must load on demand/,
  );
});
