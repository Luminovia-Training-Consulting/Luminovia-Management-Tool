import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {createServer} from "node:net";
import {once} from "node:events";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {test} from "node:test";
import {root} from "./runtime-lib.mjs";

function launch(t, {endpoint = "unix:///var/run/docker.sock", initial = "offline", service = "ready", port = 0, foreignProject = false, action = "start"} = {}) {
    const checkout = mkdtempSync(join(tmpdir(), "portal-first-start-"));
    t.after(() => rmSync(checkout, {recursive: true, force: true}));
    for (const directory of ["bin", "scripts", "supabase"]) mkdirSync(join(checkout, directory));
    for (const file of ["portal", "package.json", "package-lock.json", "scripts/runtime-cli.mjs", "scripts/runtime-lib.mjs", "scripts/runtime-network.mjs"]) {
        copyFileSync(join(root, file), join(checkout, file));
    }
    writeFileSync(join(checkout, "supabase/config.toml"), `project_id = "luminovia-portal"\n[auth]\nsite_url = "http://127.0.0.1:${port}"\n`);
    const trace = join(checkout, "trace");
    writeFileSync(trace, "");
    const ready = join(checkout, "ready");
    const commands = {
        docker: `
if [ "$1" = context ]; then
    echo "$FIXTURE_ENDPOINT"
    exit 0
fi
if [ "$1" = ps ]; then
    echo "docker ps" >> "$FIXTURE_TRACE"
    if [ "$FIXTURE_FOREIGN_PROJECT" = true ]; then echo supabase_edge_runtime_luminovia-portal; fi
    exit 0
fi
echo "docker info" >> "$FIXTURE_TRACE"
if [ -f "$FIXTURE_READY" ]; then
    echo 29.0.0
elif [ "$FIXTURE_INITIAL" = slow ]; then
    touch "$FIXTURE_READY"
    exec sleep 30
elif [ "$FIXTURE_INITIAL" = denied ]; then
    echo "permission denied while trying to connect to the Docker daemon" >&2
    exit 1
else
    echo "Cannot connect to the Docker daemon at $FIXTURE_ENDPOINT" >&2
    exit 1
fi`,
        systemctl: `
echo "systemctl $*" >> "$FIXTURE_TRACE"
[ "$FIXTURE_SERVICE" = ready ] || exit 1
touch "$FIXTURE_READY"`,
        npm: `
echo "npm $*" >> "$FIXTURE_TRACE"
echo "Fixture reached dependency installation" >&2
exit 77`,
    };
    for (const [name, script] of Object.entries(commands)) {
        writeFileSync(join(checkout, "bin", name), `#!/bin/sh\n${script}\n`, {mode: 0o755});
    }
    if (initial === "ready") writeFileSync(ready, "");
    const env = {
        PATH: `${join(checkout, "bin")}:${process.env.PATH}`,
        FIXTURE_ENDPOINT: endpoint,
        FIXTURE_INITIAL: initial,
        FIXTURE_SERVICE: service,
        FIXTURE_TRACE: trace,
        FIXTURE_FOREIGN_PROJECT: String(foreignProject),
        FIXTURE_READY: ready,
    };
    const result = spawnSync("./portal", [action], {cwd: checkout, env, encoding: "utf8", timeout: 20_000});
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    return {
        output: result.stdout + result.stderr,
        calls: readFileSync(trace, "utf8").trim().split("\n").filter(Boolean),
    };
}

test("a fresh ZIP starts the default Docker service and rechecks it before npm ci", (t) => {
    const {calls, output} = launch(t);
    assert.deepEqual(calls, ["docker info", "systemctl --no-ask-password start docker.service", "docker info", "docker ps", "npm ci"]);
    assert.match(output, /Fixture reached dependency installation/);
});

test("a running Docker service requires no system action", (t) => {
    assert.deepEqual(launch(t, {initial: "ready"}).calls, ["docker info", "docker ps", "npm ci"]);
});

test("a timed-out Docker probe retries before changing services or installing dependencies", (t) => {
    const {calls, output} = launch(t, {initial: "slow"});
    assert.deepEqual(calls, ["docker info", "docker info", "docker ps", "npm ci"]);
    assert.match(output, /Fixture reached dependency installation/);
});

test("a failed service start gives actionable guidance before installing dependencies", (t) => {
    const {calls, output} = launch(t, {service: "failed"});
    assert.deepEqual(calls, ["docker info", "systemctl --no-ask-password start docker.service", "docker info"]);
    assert.match(output, /kernel.*reboot|systemctl start docker\.service/);
});

test("an unavailable custom socket or denied access never starts the default service", (t) => {
    const custom = launch(t, {endpoint: "unix:///run/user/1234/docker.sock"});
    assert.deepEqual(custom.calls, ["docker info"]);
    assert.match(custom.output, /check your Docker context/);
    const denied = launch(t, {initial: "denied"});
    assert.deepEqual(denied.calls, ["docker info"]);
    assert.match(denied.output, /Docker socket access was denied/);
});

test("a remote Docker context is rejected before probing or installing anything", (t) => {
    const {calls, output} = launch(t, {endpoint: "ssh://example.invalid"});
    assert.deepEqual(calls, []);
    assert.match(output, /refuses a remote Docker context/);
});

test("a fresh ZIP reports the actual occupied port and leaves the listener in place", async (t) => {
    const listener = createServer();
    listener.listen(0, "127.0.0.1");
    await once(listener, "listening");
    t.after(() => listener.close());
    const {port} = listener.address();
    const {output, calls} = launch(t, {initial: "ready", port});
    assert.match(output, new RegExp(`Local portal port ${port} is already in use`));
    assert.match(output, /run \.\/portal stop in that checkout/);
    assert.deepEqual(calls, ["docker info"]);
    assert.equal(listener.listening, true);
});

test("another checkout's running project prevents start, stop and restart before dependency or service changes", (t) => {
    for (const action of ["start", "stop", "restart"]) {
        const {output, calls} = launch(t, {initial: "ready", foreignProject: true, action});
        assert.match(output, /Local project luminovia-portal is already running/);
        assert.deepEqual(calls, ["docker info", "docker ps"]);
    }
});
