import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";

test("repository documentation links resolve to delivered local files", async () => {
  const files = ["README.md", "AGENTS.md", "CONTRIBUTING.md", "SECURITY.md"];
  async function walk(directory) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = `${directory}/${item.name}`;
      if (item.isDirectory()) await walk(path);
      else if (item.name.endsWith(".md")) files.push(path);
    }
  }
  await walk("docs");
  await walk(".github");
  const broken = [];
  let links = 0;
  for (const file of files) {
    // Examples in fenced source blocks are authored samples, not navigation.
    const markdown = (await readFile(file, "utf8")).replace(/```[^]*?```/g, "");
    for (const match of markdown.matchAll(/\]\((<[^>]+>|[^)]+)\)/g)) {
      let target = match[1].trim();
      if (target.startsWith("<")) target = target.slice(1, -1);
      else target = target.split(/\s+["']/)[0];
      if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(target)) continue;
      target = decodeURIComponent(target.split("#")[0]);
      if (!target) continue;
      links++;
      try {
        await access(resolve(dirname(file), target));
      } catch {
        broken.push(`${file} → ${target}`);
      }
    }
  }
  assert.ok(
    links > 40,
    "Check the real documentation set rather than an empty fixture.",
  );
  assert.deepEqual(broken, []);
});

// Installed migration sources remain immutable. Derive the historic provider
// labels so this check itself does not republish customer identities.
test("public guidance and current catalogue contain no historical customer identity", async () => {
  const migrationDir = new URL("../supabase/migrations/", import.meta.url);
  const migration = (await readdir(migrationDir)).find((name) =>
    name.startsWith("20261115155208_"),
  );
  assert.ok(migration);
  const historical = await readFile(new URL(migration, migrationDir), "utf8");
  const labels = [
    ...new Set(
      [...historical.matchAll(/"provider":"([^"\n]+)"/g)].map(
        (match) => match[1],
      ),
    ),
  ];
  assert.ok(labels.length > 0, "Inspect the actual historical catalogue");
  const files = [
    "README.md",
    "CONTRIBUTING.md",
    "AGENTS.md",
    "SECURITY.md",
    "data/course-building-blocks.json",
  ];
  async function collect(directory) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = `${directory}/${item.name}`;
      if (item.isDirectory()) await collect(path);
      else if (/\.(?:md|txt)$/.test(item.name)) files.push(path);
    }
  }
  await collect("docs");
  await collect(".github");
  const leaks = [];
  for (const file of files) {
    const text = (await readFile(file, "utf8")).toLowerCase();
    for (const label of labels) {
      if (
        file.toLowerCase().includes(label.toLowerCase()) ||
        text.includes(label.toLowerCase())
      )
        leaks.push(file);
    }
  }
  assert.deepEqual(
    leaks,
    [],
    "Public customer-independent content must exclude historical customer labels",
  );
});
