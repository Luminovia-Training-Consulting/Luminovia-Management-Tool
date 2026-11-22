import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { checkBundleBudget } from "./runtime-bundle-budget.mjs";

const explorer = "src/features/developer-api/portal-explorer.tsx";
const files = {
  "index.html": "<!doctype html>",
  "entry.js": "import './shared.js';",
  "shared.js": "export const shell = true;",
  "entry.css": ":root { color-scheme: light dark; }",
  "explorer.js": "import './shared.js'; import './schema.js';",
  "schema.js": "export const schema = { title: 'API' };",
  "icon.png": "fictional icon bytes",
};

function fixture(
  context,
  { precache = ["index.html", "icon.png"], entry } = {},
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
      [explorer]: { file: "explorer.js", imports: ["shared", "schema"] },
    }),
  );
  const entries = precache.map((url) => ({ url, revision: null }));
  writeFileSync(
    join(directory, "sw.js"),
    `worker.precacheAndRoute(${JSON.stringify(entries)});`,
  );
  return directory;
}

test("measure shared startup chunks once and budget the incremental explorer and PWA separately", (context) => {
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
  const explorer = zipBytes(["explorer.js", "schema.js"]);
  const precache = files["index.html"].length + files["icon.png"].length;
  assert.equal(
    checkBundleBudget(directory, { startup, explorer, precache }).length,
    3,
  );
  assert.throws(
    () =>
      checkBundleBudget(directory, {
        startup: startup - 1,
        explorer,
        precache,
      }),
    /Startup.+over budget/,
  );
  assert.throws(
    () =>
      checkBundleBudget(directory, {
        startup,
        explorer: explorer - 1,
        precache,
      }),
    /API explorer.+over budget/,
  );
  assert.throws(
    () =>
      checkBundleBudget(directory, {
        startup,
        explorer,
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
