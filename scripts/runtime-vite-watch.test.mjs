/**
 * Checks Vite's real watcher against source edits and generated private QA reports.
 * The application must react to real source changes without reloading because of its own test output.
 */
import assert from "node:assert/strict";
import {mkdir, mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {setTimeout as delay} from "node:timers/promises";
import test from "node:test";
import {createServer} from "vite";

test("development watches real source without reacting to generated QA/private reports", async () => {
    const parent = await mkdtemp(join(tmpdir(), "portal-vite-watch-"));
    // Local previews themselves live below .local. Ignore only output inside
    // this application root, never the ancestor containing its real source.
    const fixture = join(parent, ".local", "source");
    let server;
    try {
        await mkdir(fixture, {recursive: true});
        await writeFile(
            join(fixture, "index.html"),
            "<h1>Fictional watch fixture</h1>",
        );
        server = await createServer({
            configFile: resolve("vite.config.ts"),
            root: fixture,
            logLevel: "silent",
            server: {host: "127.0.0.1", port: 0},
        });
        const events = [];
        server.watcher.on("all", (kind, file) => events.push({kind, file}));
        await server.listen();
        await delay(100);
        // A source control proves that an empty report-event list isn't just an
        // inactive watcher. No browser/session or normal application is involved.
        await writeFile(
            join(fixture, "index.html"),
            "<h1>Changed real source</h1>",
        );
        const deadline = Date.now() + 4000;
        while (
            !events.some((event) => event.file === join(fixture, "index.html")) &&
            Date.now() < deadline
            )
            await delay(20);
        assert(
            events.some((event) => event.file === join(fixture, "index.html")),
            "real application source must remain watched",
        );
        const generated = ["playwright-report", "test-results", ".local", "docs"];
        for (const directory of generated) {
            await mkdir(join(fixture, directory), {recursive: true});
            await writeFile(
                join(fixture, directory, "index.html"),
                "Fictional report",
            );
        }
        await delay(500);
        assert.deepEqual(
            events.filter((event) =>
                generated.some((directory) =>
                    event.file.startsWith(join(fixture, directory) + "/"),
                ),
            ),
            [],
            "generated reports must not enter Vite's change/reload pipeline",
        );
    } finally {
        await server?.close();
        await rm(parent, {recursive: true, force: true});
    }
});