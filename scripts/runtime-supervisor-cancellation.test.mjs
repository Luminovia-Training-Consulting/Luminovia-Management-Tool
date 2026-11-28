/** The real supervisor must finish a cancelled startup operation before removing its stack. */
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {once} from "node:events";
import {copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {randomUUID} from "node:crypto";
import test from "node:test";
import {setTimeout as delay} from "node:timers/promises";
import {cleanEnvironment, root} from "./runtime-lib.mjs";

test("stopping a live startup closes its mutating subprocess before cleaning Docker", {timeout: 10000}, async () => {
    const fixture = mkdtempSync(join(tmpdir(), "portal-supervisor-cancel-"));
    for (const folder of ["supabase/migrations", "node_modules/.bin", "bin", "scripts"])
        mkdirSync(join(fixture, folder), {recursive: true});

    for (const file of ["runtime-supervisor.mjs", "runtime-lib.mjs", "runtime-network.mjs", "local-bootstrap.mjs"])
        copyFileSync(join(root, "scripts", file), join(fixture, "scripts", file));

    const project = "luminovia-portal-test-1234abcd";
    const network = `portal_network_${project}`;
    writeFileSync(join(fixture, "supabase/config.toml"), `project_id = "${project}"\n[auth]\nsite_url = "http://127.0.0.1:0"\n`);
    const trace = join(fixture, "trace");
    const startupPid = join(fixture, "startup-pid");
    writeFileSync(join(fixture, "bin/docker"), `#!${process.execPath}
const [, , noun, action] = process.argv;
if (noun === "network" && action === "ls") console.log(${JSON.stringify(network)});
if (noun === "network" && action === "inspect") console.log(JSON.stringify([${JSON.stringify({
        Name: network,
        Labels: {"org.luminovia.portal": project, "org.luminovia.portal.network": "loopback-v1"},
        Driver: "bridge",
        Options: {"com.docker.network.bridge.host_binding_ipv4": "127.0.0.1"},
    })}]));
if (noun === "network" && action === "rm") require("node:fs").appendFileSync(${JSON.stringify(trace)}, "network removed\\n");
`, {mode: 0o700});
    writeFileSync(join(fixture, "node_modules/.bin/supabase"), `#!${process.execPath}
const {appendFileSync, writeFileSync} = require("node:fs");
const record = (stage) => appendFileSync(${JSON.stringify(trace)}, stage + "\\n");
const action = process.argv[2];
if (action === "start") {
    process.on("SIGTERM", () => {
        record("start signalled");
        setTimeout(() => {
            record("start exited");
            process.exit(0);
        }, 120);
    });
    setTimeout(() => process.exit(4), 4500);
    record("start entered");
    writeFileSync(${JSON.stringify(startupPid)}, String(process.pid));
} else record(action);
`, {mode: 0o700});

    const supervisor = spawn(process.execPath, ["scripts/runtime-supervisor.mjs", randomUUID()], {
        cwd: fixture,
        env: cleanEnvironment({PATH: `${join(fixture, "bin")}:${process.env.PATH}`}),
        stdio: "ignore",
    });
    const exited = once(supervisor, "exit");
    try {
        const deadline = performance.now() + 3000;
        while (!existsSync(startupPid) && performance.now() < deadline) await delay(10);
        assert.ok(existsSync(startupPid), "the isolated Supabase startup must enter");
        supervisor.kill("SIGTERM");
        assert.deepEqual(await exited, [0, null]);
        assert.deepEqual(readFileSync(trace, "utf8").trim().split("\n"), [
            "start entered", "start signalled", "start exited", "stop", "network removed",
        ]);
        const state = JSON.parse(readFileSync(join(fixture, ".local/runtime.json"), "utf8"));
        assert.equal(state.phase, "stopped");
    } finally {
        supervisor.kill("SIGKILL");
        await exited;
        if (existsSync(startupPid) && !readFileSync(trace, "utf8").includes("start exited")) {
            try {
                process.kill(Number(readFileSync(startupPid, "utf8")), "SIGKILL");
            } catch (error) {
                if (error.code !== "ESRCH") throw error;
            }
        }
        rmSync(fixture, {recursive: true, force: true});
    }
});
