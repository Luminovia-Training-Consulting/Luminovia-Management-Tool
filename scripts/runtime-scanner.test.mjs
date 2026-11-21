/** Test the scanner's startup file handling using a fictional Docker command. */
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";

test("scanner startup preserves other service settings and publishes private configuration", (t) => {
    const checkout = mkdtempSync(join(tmpdir(), "portal-scanner-"));
    t.after(() => rmSync(checkout, {recursive: true, force: true}));
    const project = "luminovia-portal-test-12345678";
    mkdirSync(join(checkout, "bin"));
    mkdirSync(join(checkout, "supabase"));
    const runtime = join(checkout, ".local");
    mkdirSync(runtime, {mode: 0o700});
    writeFileSync(join(checkout, "supabase/config.toml"), `project_id = "${project}"\n`);
    // Keep the scanner CLI and its file operations real. Only the Docker commands
    // and health responses come from this disposable fixture.
    writeFileSync(
        join(checkout, "bin/docker"),
        `#!${process.execPath}
const {readFileSync, writeFileSync} = require("node:fs");
const [operation, container, ...rest] = process.argv.slice(2);
const scanner = "portal_scanner_${project}";
if (operation === "inspect" && container === "supabase_db_${project}") {
    console.log(JSON.stringify([{NetworkSettings: {Networks: {"portal_network_${project}": {}}}}]));
} else if (operation === "inspect" && container === scanner) {
    console.log(readFileSync("bin/scanner.json", "utf8"));
} else if (operation === "create" && container === "--name" && rest[0] === scanner) {
    const labels = rest.flatMap((item, index) => item === "--label" ? [rest[index + 1].split("=")] : []);
    writeFileSync("bin/scanner.json", JSON.stringify([{
        Config: {Image: rest.at(-1), Labels: Object.fromEntries(labels)},
        State: {Running: true, Health: {Status: "healthy"}},
    }]));
} else if (!(operation === "exec" && container === scanner) &&
           !(operation === "volume" && container === "create" && rest[0] === "portal_clamav_${project}")) {
    process.exit(1);
}
`,
        {mode: 0o700},
    );
    const file = join(runtime, "services.env");
    const run = () =>
        execFileSync(process.execPath, [join(import.meta.dirname, "local-scanner.mjs"), "start"], {
            cwd: checkout,
            env: {PATH: join(checkout, "bin")},
            encoding: "utf8",
        });
    assert.match(run(), /ClamAV is ready/);
    const scanner = `PORTAL_CLAMAV_HOST=portal_scanner_${project}\nPORTAL_CLAMAV_PORT=3310\n`;
    assert.equal(readFileSync(file, "utf8"), scanner);
    const configuration = join(runtime, "clamd.conf");
    assert.match(readFileSync(configuration, "utf8"), /^TCPSocket 3310$/m);
    assert.equal(statSync(configuration).mode & 0o777, 0o644);

    const other = "# Keep other service settings\nFICTIONAL_OTHER=value=with=equals\n";
    writeFileSync(file, other + "PORTAL_CLAMAV_HOST=previous\nPORTAL_CLAMAV_PORT=22\n");
    assert.match(run(), /ClamAV is ready/);
    assert.equal(readFileSync(file, "utf8"), other + scanner);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.deepEqual(readdirSync(runtime).sort(), ["clamd.conf", "services.env"]);
});
