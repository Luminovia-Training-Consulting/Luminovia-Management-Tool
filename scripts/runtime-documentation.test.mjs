/**
 * Checks local Markdown links and heading fragments against delivered repository files.
 * Fenced examples are not navigation; external URLs are not fetched here.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {access, readdir, readFile} from "node:fs/promises";
import {dirname, resolve} from "node:path";
import ts from "typescript";

/** Removes fenced examples before collecting links or heading targets. */
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
        "API_REFERENCE.md",
    ];

    /** Collects delivered Markdown documents recursively for local link validation. */
    async function walk(directory) {
        for (const item of await readdir(directory, {withFileTypes: true})) {
            const path = `${directory}/${item.name}`;
            // Installed package docs and the Supabase snapshot refer to files in
            // their upstream repositories. Check the maintained guidance here.
            if (item.name === "node_modules" || path === "deploy/hostinger/supabase/upstream")
                continue;
            if (item.isDirectory()) await walk(path);
            else if (item.name.endsWith(".md")) files.push(path);
        }
    }

    await walk(".github");
    await walk("docs");
    await walk("deploy");
    await walk("scripts/examples");
    await walk("supabase/functions/course-documents/assets");
    assert.ok(files.length >= 24, "Include maintained project Markdown records");
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
        "data/course-building-blocks.json",
        "docs/PRODUCT.md",
        "docs/FEATURES.md",
        "docs/design-qa.md",
        "docs/GUIDE.md",
        "docs/PRODUCTION-READINESS.md",
        "API_REFERENCE.md",
    ];

    async function collect(directory) {
        for (const item of await readdir(directory, {withFileTypes: true})) {
            const path = `${directory}/${item.name}`;
            if (item.isDirectory()) await collect(path);
            else if (/\.(?:md|txt)$/.test(item.name)) files.push(path);
        }
    }

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

// The programme's governing AGENTS instructions require these durable source
// records. Keep the consolidated product docs and retain an
// explicit inventory of project records and published materials under docs/.
// The retired sales material was removed from the current delivery inventory.
// The exact list still catches new or missing records.
test("documentation retains the approved project records and published materials", async () => {
    const requiredRecords = new Set([
        "PRODUCT.md",
        "GUIDE.md",
        "FEATURES.md",
        "LMS-BACKLOG.md",
        "PRODUCTION-READINESS.md",
        "design-qa.md",
        "customer-handoff",
    ]);
    const deliveredRecords = (await readdir("docs")).sort();
    assert.deepEqual(deliveredRecords, [...requiredRecords].sort());
    assert.deepEqual((await readdir("docs/customer-handoff")).sort(), [
        "ACCEPTANCE-AND-HANDOVER.de.md",
        "CUSTOMER-LICENCE.de.md",
        "OPERATIONS-AND-SUPPORT.de.md",
        "README.md",
    ]);
    const generator = await readFile(
        "scripts/generate-api-reference.mjs",
        "utf8",
    );
    const runner = await readFile("scripts/runtime-test.mjs", "utf8");
    assert.match(generator, /"API_REFERENCE\.md"/);
    assert.doesNotMatch(generator, /docs\/API_REFERENCE\.md/);
    assert.match(generator, /\.\.\/supabase\/migrations\//);
    assert.match(runner, /\.local\/screenshots/);
    assert.doesNotMatch(runner, /docs\/screenshots/);
});

// The hand-written facade route list once omitted account creation despite a
// live handler and OpenAPI path. Compare every method/path against the generated
// reference so future operations cannot silently disappear from human guidance.
test("account HTTP reference covers the published OpenAPI routes", async () => {
    const source = await readFile(
        "supabase/functions/accounts/openapi.ts",
        "utf8",
    );
    const compiled = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
        },
    }).outputText;
    const {accountOpenApi} = await import(
        `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
        );
    const expected = Object.entries(accountOpenApi.paths).flatMap(
        ([path, methods]) =>
            Object.keys(methods).map(
                (method) => `${method.toUpperCase()} ${path.replace(/^\/v1/, "")}`,
            ),
    );
    const guide = await readFile("API_REFERENCE.md", "utf8");
    const table = guide
        .split("## Account HTTP facade")[1]
        .split("## Permanent deletion")[0];
    const actual = [
        ...table.matchAll(/^\| (GET|POST|PATCH|PUT|DELETE)\s+\| (\/[^|]+?)\s+\|/gm),
    ].map((match) => `${match[1]} ${match[2].trim()}`);
    assert.deepEqual(actual, expected);
});

// The A–N summary is maintained prose, but every RPC name it recommends must
// exist in the same freshly replayed inventory. This prevents a guide-only
// feature label from appearing to be an executable API.
test("feature and settings guide names only inventoried public RPCs", async () => {
    const reference = await readFile("API_REFERENCE.md", "utf8");
    const matrix = reference
        .split("## Implemented feature and configuration entry points")[1]
        .split("### Recent settings and action contracts")[0];
    const inventory = reference
        .split("## Replayed public function inventory")[1]
        .split("## Files and printable documents")[0];
    const available = new Set(
        [...inventory.matchAll(/^\| ([a-z_]+)\s+\|/gm)].map((match) => match[1]),
    );
    const named = [...matrix.matchAll(/`([a-z][a-z_]+)`/g)].map(
        (match) => match[1],
    );
    assert.ok(named.length > 45, "Check all product areas, not a small sample");
    assert.deepEqual(
        named.filter((name) => !available.has(name)),
        [],
    );
});

test("direct frontend Data API relations appear in the replayed REST inventory", async () => {
    const reference = await readFile("API_REFERENCE.md", "utf8");
    const inventory = reference
        .split("## Replayed authenticated REST relations")[1]
        .split("## Replayed public function inventory")[0];
    const available = new Set(
        [...inventory.matchAll(/^\| ([a-z_]+)\s+\|\s+(?:table|view)\s+\|/gm)].map(
            (match) => match[1],
        ),
    );
    const used = new Set();

    async function visit(directory) {
        for (const item of await readdir(directory, {withFileTypes: true})) {
            const path = `${directory}/${item.name}`;
            if (item.isDirectory()) await visit(path);
            else if (/\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path)) {
                const source = await readFile(path, "utf8");
                for (const match of source.matchAll(/\.from\("([a-z_]+)"\)/g))
                    used.add(match[1]);
            }
        }
    }

    await visit("src");
    assert.ok(used.size >= 12, "Inspect the live frontend Data API calls");
    assert.deepEqual(
        [...used].filter((name) => !available.has(name)),
        [],
    );
    assert.match(
        inventory,
        /^\| personal_events\s+\| table\s+\| GET, POST, PATCH, DELETE\s+\|/m,
    );
    assert.match(
        inventory,
        /^\| lecturer_topics\s+\| table\s+\| GET, POST, DELETE\s+\|/m,
    );
});
