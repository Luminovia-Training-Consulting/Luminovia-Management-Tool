import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import ts from "typescript";

const kib = 1024;
const budgets = {
  startup: 525 * kib,
  // Swagger's standalone renderer carries its own React runtime.
  explorer: 570 * kib,
  precache: 4352 * kib,
};
const explorerEntries = [
  "src/features/developer-api/portal-explorer.tsx",
  "src/features/developer-api/academy-explorer.tsx",
  "src/features/developer-api/standalone-swagger.tsx",
];

function staticAssets(manifest, entry) {
  const files = new Set();
  const pending = [entry];
  const visited = new Set();
  for (const key of pending) {
    if (visited.has(key)) continue;
    visited.add(key);
    const chunk = manifest[key];
    if (!chunk?.file) throw new Error(`Missing build manifest chunk: ${key}`);
    files.add(chunk.file);
    for (const css of chunk.css ?? []) files.add(css);
    for (const dependency of chunk.imports ?? []) pending.push(dependency);
  }
  return files;
}

function precacheAssets(source) {
  const script = ts.createSourceFile(
    "sw.js",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const calls = [];
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "precacheAndRoute"
    ) {
      calls.push(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  }
  visit(script);
  const [list] = calls;
  if (
    calls.length !== 1 ||
    !list ||
    !ts.isArrayLiteralExpression(list) ||
    !list.elements.length
  ) {
    throw new Error(
      "The generated service worker must contain one static precache list.",
    );
  }
  const urls = list.elements.map((entry) => {
    if (ts.isObjectLiteralExpression(entry)) {
      for (const property of entry.properties) {
        if (
          ts.isPropertyAssignment(property) &&
          (ts.isIdentifier(property.name) ||
            ts.isStringLiteral(property.name)) &&
          property.name.text === "url" &&
          ts.isStringLiteral(property.initializer)
        ) {
          return property.initializer.text.replace(/^\//, "");
        }
      }
    }
    throw new Error(
      "Invalid URL entry in the generated service worker precache list.",
    );
  });
  return new Set(urls);
}

export function checkBundleBudget(directory, limits = budgets) {
  function filePath(asset) {
    if (
      !asset
        .split("/")
        .every((segment) => /^[\w.-]+$/.test(segment) && segment !== "..")
    ) {
      throw new Error(`Invalid output asset path: ${asset}`);
    }
    return join(directory, asset);
  }
  const read = (asset) => readFileSync(filePath(asset));
  const gzip = (asset) => gzipSync(read(asset), { level: 9 }).length;
  const manifest = JSON.parse(read(".vite/manifest.json"));
  const startup = staticAssets(manifest, "index.html");
  startup.add("index.html");
  const precache = precacheAssets(read("sw.js").toString("utf8"));
  const explorers = explorerEntries.filter((entry) => manifest[entry]);
  if (!explorers.length || !precache.has("index.html")) {
    throw new Error(
      "The build is missing the API explorer or offline navigation shell.",
    );
  }

  let explorerBytes = 0;
  for (const entry of explorers) {
    const { file, css = [] } = manifest[entry];
    const dependencies = [...staticAssets(manifest, entry)];
    const swaggerAssets = dependencies.filter((asset) =>
      asset.startsWith("assets/swagger-view-"),
    );
    for (const asset of [file, ...css, ...swaggerAssets]) {
      if (startup.has(asset) || precache.has(asset)) {
        throw new Error(`API explorer asset must load on demand: ${asset}`);
      }
    }
    const incremental = dependencies.filter((file) => !startup.has(file));
    explorerBytes = Math.max(
      explorerBytes,
      incremental.reduce((sum, file) => sum + gzip(file), 0),
    );
  }
  const results = [
    {
      name: "Startup HTML, JavaScript and CSS (gzip)",
      bytes: [...startup].reduce((sum, file) => sum + gzip(file), 0),
      limit: limits.startup,
    },
    {
      name: "API explorer after startup (gzip)",
      bytes: explorerBytes,
      limit: limits.explorer,
    },
    {
      name: "PWA precache assets (uncompressed)",
      bytes: [...precache].reduce(
        (sum, file) => sum + statSync(filePath(file)).size,
        0,
      ),
      limit: limits.precache,
    },
  ];
  const lines = results.map(
    ({ name, bytes, limit }) =>
      `${name}: ${(bytes / kib).toFixed(1)} / ${limit / kib} KiB${bytes > limit ? " (over budget)" : ""}`,
  );
  if (results.some(({ bytes, limit }) => bytes > limit)) {
    throw new Error(lines.join("\n"));
  }
  return lines;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    console.log(
      checkBundleBudget(resolve(process.argv[2] ?? "dist")).join("\n"),
    );
  } catch (error) {
    console.error(`Production bundle verification failed.\n${error.message}`);
    process.exitCode = 1;
  }
}
