import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";

function withoutFences(markdown) {
  return markdown.replace(/```[^]*?```|~~~[^]*?~~~/g, "");
}

// GitHub heading fragments for the prose headings used in this repository.
// Preserve Unicode letters, hyphens and underscores; repeated headings get a
// numeric suffix. Fenced code examples never declare navigation targets.
function headingAnchors(markdown) {
  const anchors = new Set();
  for (const match of withoutFences(markdown).matchAll(
    /^#{1,6}\s+(.+?)\s*#*$/gm,
  )) {
    const base = match[1]
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}\s_-]/gu, "")
      .replace(/ /g, "-");
    let anchor = base;
    let suffix = 0;
    while (anchors.has(anchor)) anchor = `${base}-${++suffix}`;
    anchors.add(anchor);
  }
  for (const match of withoutFences(markdown).matchAll(
    /\b(?:id|name)=["']([^"']+)["']/g,
  ))
    anchors.add(match[1]);
  return anchors;
}

test("repository documentation links and heading fragments resolve", async () => {
  const files = [
    "README.md",
    "AGENTS.md",
    "CONTRIBUTING.md",
    "SECURITY.md",
    "ROADMAP.md",
    "CHANGELOG.md",
  ];
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
    const markdown = withoutFences(await readFile(file, "utf8"));
    for (const match of markdown.matchAll(/\]\((<[^>]+>|[^)]+)\)/g)) {
      let target = match[1].trim();
      if (target.startsWith("<")) target = target.slice(1, -1);
      else target = target.split(/\s+["']/)[0];
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
      const [path, fragment] = target.split("#");
      target = path
        ? resolve(dirname(file), decodeURIComponent(path))
        : resolve(file);
      links++;
      try {
        if (target.endsWith(".md")) {
          // Read Markdown directly rather than checking existence and then
          // reopening it. This snapshot supplies both existence and headings.
          const headings = headingAnchors(await readFile(target, "utf8"));
          if (fragment && !headings.has(decodeURIComponent(fragment)))
            broken.push(`${file} → ${path}#${fragment} (missing heading)`);
        } else await access(target);
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

test("translated heading links distinguish duplicates, Unicode and code examples", () => {
  const anchors = headingAnchors(
    [
      "# Labels for pull requests",
      "## Labels for pull requests",
      "## Prüfung — `main`",
      "```md",
      "## Not a heading",
      "```",
      '<a id="stable-link"></a>',
    ].join("\n"),
  );
  assert.ok(anchors.has("labels-for-pull-requests"));
  assert.ok(anchors.has("labels-for-pull-requests-1"));
  assert.ok(anchors.has("prüfung--main"));
  assert.ok(anchors.has("stable-link"));
  assert.equal(anchors.has("not-a-heading"), false);
});
