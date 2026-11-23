/** Browser dependency evidence is bound to actual shipped files, not the full lockfile. */
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  academyNoticesPath,
  academySbomPath,
  recordAcademyBrowserModules,
  validateAcademyBrowserInventory,
  writeAcademyBrowserInventory,
} from "./academy-browser-inventory.ts";

const revision = "1234".repeat(10);
const edition = "customer-self-hosted";
const runtime = "assets/browser-fixture.js";
const worker = "workbox-ab123456.js";

/** Keep test dependencies and private traces inside an owned temporary directory. */
function fixture(t, installedVersion = "1.0.0") {
  const root = mkdtempSync(join(tmpdir(), "academy-delivery-inventory-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dist = join(root, "dist");
  const tracePath = join(root, "trace.json");
  const packageLock = join(root, "package-lock.json");
  const modules = join(root, "node_modules");
  const write = (relative, data) => {
    const path = join(root, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, typeof data === "string" ? data : JSON.stringify(data));
  };
  for (const name of ["fixture-ui", "fixture-worker", "fixture-unused"]) {
    write("node_modules/" + name + "/package.json", {
      name,
      version: installedVersion,
      license: "MIT",
    });
    write(
      "node_modules/" + name + "/LICENSE",
      "Fictional " + name + " licence",
    );
  }
  write("package-lock.json", {
    packages: Object.fromEntries(
      ["fixture-ui", "fixture-worker", "fixture-unused"].map((name) => [
        "node_modules/" + name,
        { version: "1.0.0", license: "MIT" },
      ]),
    ),
  });
  write("dist/" + runtime, "fixture browser module");
  write("dist/api/openapi.json", "{}");
  write("dist/brand/space-grotesk-latin-wght-normal.woff2", "fixture font");
  write("dist/brand/space-grotesk-OFL.txt", "fixture font licence");
  write("dist/sw.js", "fixture worker\n//# sourceMappingURL=sw.js.map\n");
  write("dist/sw.js.map", { sources: ["/private/temporary/worker-source.js"] });
  write(
    "dist/" + worker,
    "fixture library\n//# sourceMappingURL=" + worker + ".map\n",
  );
  write("dist/" + worker + ".map", {
    sources: ["/private/node_modules/fixture-worker/index.js"],
  });
  recordAcademyBrowserModules(
    {
      [runtime]: {
        type: "chunk",
        fileName: runtime,
        modules: {
          "/private/node_modules/fixture-ui/index.js": { renderedLength: 12 },
          "/private/node_modules/fixture-unused/index.js": {
            renderedLength: 0,
          },
        },
      },
    },
    tracePath,
  );
  const build = () =>
    writeAcademyBrowserInventory({
      dist,
      tracePath,
      modules,
      packageLock,
      revision,
      edition,
    });
  const files = () =>
    new Map(
      [
        runtime,
        worker,
        "brand/space-grotesk-latin-wght-normal.woff2",
        academySbomPath,
        academyNoticesPath,
      ].map((name) => [name, readFileSync(join(dist, name))]),
    );
  return { build, dist, files };
}

test("records rendered browser and worker dependencies while removing private maps", (t) => {
  const { build, dist, files } = fixture(t);
  build();
  const shipped = files();
  const manifest = JSON.parse(shipped.get(academySbomPath));
  assert.deepEqual(
    manifest.components.map(({ name }) => name),
    ["fixture-ui", "fixture-worker", "Space Grotesk"],
  );
  assert.match(
    shipped.get(academyNoticesPath).toString(),
    /Fictional fixture-worker licence/,
  );
  assert.doesNotMatch(
    shipped.get(academyNoticesPath).toString(),
    /fixture-unused|\/private\//,
  );
  assert.doesNotMatch(
    readFileSync(join(dist, "sw.js"), "utf8"),
    /sourceMappingURL/,
  );
  assert.throws(() => readFileSync(join(dist, worker + ".map")), {
    code: "ENOENT",
  });
  validateAcademyBrowserInventory(shipped, revision, edition);

  const withoutNotices = new Map(shipped);
  withoutNotices.delete(academyNoticesPath);
  assert.throws(
    () => validateAcademyBrowserInventory(withoutNotices, revision, edition),
    /Incomplete/,
  );
  assert.throws(
    () =>
      validateAcademyBrowserInventory(shipped, revision, "customer-managed"),
    /differs/,
  );
  shipped.set(academyNoticesPath, Buffer.from("Changed dependency notices"));
  assert.throws(
    () => validateAcademyBrowserInventory(shipped, revision, edition),
    /differs/,
  );
});

test("rejects a physically installed dependency that disagrees with the lockfile", (t) => {
  assert.throws(fixture(t, "2.0.0").build, /dependency metadata/);
});
