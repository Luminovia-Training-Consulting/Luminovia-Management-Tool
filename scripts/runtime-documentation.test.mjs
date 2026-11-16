/**
 * Prüft lokale Markdownverweise gegen tatsächlich vorhandene Repositorydateien.
 * Beispielcode in Fences ist keine Navigation; externe Verweise werden hier nicht abgefragt.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";

test("repository documentation links resolve to delivered local files", async () => {
  const files = ["README.md", "AGENTS.md", "CONTRIBUTING.md", "SECURITY.md"];
  /** Sammelt die tatsächlich gelieferten Markdownunterlagen rekursiv für die lokale Linkprüfung. */
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
