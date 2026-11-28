/**
 * Local safety regressions for Docker bindings, environments, logs and process ownership.
 * Fixtures exercise concrete boundaries rather than claiming a general security certification.
 */
import {test} from "node:test";
import assert from "node:assert/strict";
import {once} from "node:events";
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,} from "node:fs";
import {createServer} from "node:http";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
import {cleanEnvironment, localUrl, migrationDigest, privateWrite, processIsOurs, readEnvFile, redact, waitForHttp,} from "./runtime-lib.mjs";
import {assertContainerBindings, assertNetworkDefinition, networkName, verifyLoopbackBindings,} from "./runtime-network.mjs";
import {readPrivateFixture} from "./testing/read-private-fixture.mjs";

test("local Docker networking rejects public host bindings, extra networks and unowned resources", () => {
    const project = "luminovia-portal-test-1234abcd";
    const name = networkName(project);
    const network = {
        Name: name,
        Labels: {
            "org.luminovia.portal": project,
            "org.luminovia.portal.network": "loopback-v1",
        },
        Driver: "bridge",
        Options: {"com.docker.network.bridge.host_binding_ipv4": "127.0.0.1"},
        EnableIPv6: false,
    };
    assert.doesNotThrow(() => assertNetworkDefinition(network, project));
    assert.throws(
        () => assertNetworkDefinition({...network, Labels: {}}, project),
        /unowned/,
    );
    assert.throws(
        () => assertNetworkDefinition({...network, Options: {}}, project),
        /loopback/,
    );
    const container = {
        Name: `/supabase_kong_${project}`,
        Labels: {"com.supabase.cli.project": project},
        Networks: {[name]: {}},
        Ports: {"8000/tcp": [{HostIp: "127.0.0.1", HostPort: "55321"}]},
    };
    assert.doesNotThrow(() => assertContainerBindings(container, project));
    for (const HostIp of ["", "0.0.0.0", "::", "192.168.1.2"])
        assert.throws(
            () =>
                assertContainerBindings(
                    {
                        ...container,
                        Ports: {"8000/tcp": [{HostIp, HostPort: "55321"}]},
                    },
                    project,
                ),
            /outside loopback/,
        );
    assert.throws(
        () =>
            assertContainerBindings(
                {...container, Networks: {[name]: {}, bridge: {}}},
                project,
            ),
        /outside its owned/,
    );
    const scanner = {
        ...container,
        Labels: {"org.luminovia.portal": project},
        Ports: {},
    };
    assert.doesNotThrow(() =>
        assertContainerBindings(scanner, project, {scanner: true}),
    );
    assert.throws(
        () =>
            assertContainerBindings({...scanner, Ports: container.Ports}, project, {
                scanner: true,
            }),
        /publishes/,
    );
});
test("CLI status secret fields, legacy tokens, URLs and modern keys never enter runtime logs", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.SignatureSecret";
    const input = JSON.stringify({
        JWT_SECRET: "plain-unprefixed-signing-secret",
        S3_PROTOCOL_ACCESS_KEY_ID: "plain-access-id",
        S3_PROTOCOL_ACCESS_KEY_SECRET: "plain-access-secret",
        SERVICE_ROLE_KEY: jwt,
        SECRET_KEY: "sb_secret_testing_key",
        DB_URL: "postgresql://postgres:password@127.0.0.1:54322/postgres",
    });
    const safe = redact(input);
    for (const token of [
        "plain-unprefixed-signing-secret",
        "plain-access-id",
        "plain-access-secret",
        jwt,
        "sb_secret_testing_key",
        "postgres:password@",
    ])
        assert.ok(!safe.includes(token));
    assert.ok(safe.includes("[redacted"));
});
test("inherited hosted or development credentials cannot redirect isolated subprocesses", () => {
    const prior = process.env.SUPABASE_URL;
    process.env.SUPABASE_URL = "https://hosted.example.invalid";
    try {
        const env = cleanEnvironment({PORTAL_TEST_MODE: "1"});
        assert.equal(env.SUPABASE_URL, undefined);
        assert.equal(env.PORTAL_TEST_MODE, "1");
    } finally {
        if (prior === undefined) delete process.env.SUPABASE_URL;
        else process.env.SUPABASE_URL = prior;
    }
});
test("the pinned CLI can select slim images without inheriting Supabase credentials or custom values", () => {
    const keys = ["SUPABASE_USE_SLIM_IMAGES", "SUPABASE_ACCESS_TOKEN"];
    const original = keys.map((key) => process.env[key]);
    try {
        process.env.SUPABASE_ACCESS_TOKEN = "fictional-hosted-access-token";
        process.env.SUPABASE_USE_SLIM_IMAGES = "1";
        assert.equal(cleanEnvironment().SUPABASE_USE_SLIM_IMAGES, "1");
        assert.equal(cleanEnvironment().SUPABASE_ACCESS_TOKEN, undefined);
        process.env.SUPABASE_USE_SLIM_IMAGES = "fictional-unapproved-override";
        assert.equal(cleanEnvironment().SUPABASE_USE_SLIM_IMAGES, undefined);
    } finally {
        keys.forEach((key, index) => {
            if (original[index] === undefined) delete process.env[key];
            else process.env[key] = original[index];
        });
    }
});
test("only credential-free loopback HTTP URLs are accepted", () => {
    assert.equal(localUrl("http://127.0.0.1:55321").port, "55321");
    for (const url of [
        "https://example.supabase.co",
        "http://192.168.1.10",
        "http://secret:password@127.0.0.1:54321",
    ])
        assert.throws(() => localUrl(url));
});
test("supervisor never treats an unrelated reused PID as its process", () => {
    assert.equal(
        processIsOurs({pid: process.pid, session: "not-a-runtime-supervisor"}),
        false,
    );
    assert.equal(processIsOurs({pid: 1, session: "x"}), false);
});

test("local readiness checks require their own direct HTTP response", async (t) => {
    const requests = [];
    const server = createServer((request, response) => {
        requests.push(request.url);
        if (request.url === "/redirect")
            response.writeHead(302, {Location: "/healthy"});
        response.end();
    });
    const listening = once(server, "listening");
    server.listen(0, "127.0.0.1");
    await listening;
    t.after(() => new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
    }));
    const origin = `http://127.0.0.1:${server.address().port}`;
    await assert.rejects(
        waitForHttp("https://remote.example.invalid/check", {timeoutMs: 0}),
        /credential-free loopback HTTP URL/,
    );
    await assert.rejects(
        waitForHttp(origin + "/redirect", {timeoutMs: 100}),
        /Local service did not become ready/,
    );
    assert.deepEqual(requests, ["/redirect"]);
    await waitForHttp(origin + "/healthy");
    assert.deepEqual(requests, ["/redirect", "/healthy"]);
});

test("local readiness cancels a slow request within its deadline", async (t) => {
    const server = createServer(() => {});
    const listening = once(server, "listening");
    server.listen(0, "127.0.0.1");
    await listening;
    t.after(() => new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
    }));
    const start = performance.now();
    await assert.rejects(
        waitForHttp(`http://127.0.0.1:${server.address().port}/slow`, {timeoutMs: 100}),
        /Local service did not become ready/,
    );
    // The previous fixed request deadline and retry sleep took 2.5 seconds.
    assert.ok(performance.now() - start < 1000);
});

test("readiness confirms every projected Docker container in one project inspection", async (t) => {
    const folder = mkdtempSync(join(tmpdir(), "portal-network-test-"));
    const path = process.env.PATH;
    const project = "luminovia-portal-test-1234abcd";
    const network = networkName(project);
    const containers = ["db", "kong", "edge_runtime", "storage"];
    const refs = containers.map((service) => `supabase_${service}_${project}`);
    const scanner = `portal_scanner_${project}`;
    const container = (name) => ({
        Name: `/${name}`,
        Labels: {[name === scanner ? "org.luminovia.portal" : "com.supabase.cli.project"]: project},
        Networks: {[network]: {}},
        Ports: {},
        Running: true,
    });
    const trace = join(folder, "trace");
    const incomplete = join(folder, "incomplete");
    t.after(() => {
        process.env.PATH = path;
        rmSync(folder, {recursive: true, force: true});
    });
    const daemon = pathToFileURL(join(folder, "fixture.mjs"));
    writeFileSync(join(folder, "fixture.mjs"), String.raw`
import {appendFileSync, existsSync} from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(trace)}, JSON.stringify(args) + "\n");
if (args[0] === "network" && args[1] === "ls") console.log(${JSON.stringify(network)});
else if (args[0] === "network" && args[1] === "inspect") console.log(JSON.stringify(${JSON.stringify([{
        Name: network,
        Labels: {"org.luminovia.portal": project, "org.luminovia.portal.network": "loopback-v1"},
        Driver: "bridge",
        Options: {"com.docker.network.bridge.host_binding_ipv4": "127.0.0.1"},
    }])}));
else if (args[0] === "ps") console.log(${JSON.stringify(refs.join("\n"))});
else if (args[0] === "inspect") {
    const fixtures = ${JSON.stringify(Object.fromEntries([...refs, scanner].map((name) => [name, container(name)])))};
    const refs = args.slice(args.indexOf("--") + 1);
    if (existsSync(${JSON.stringify(incomplete)})) refs.pop();
    for (const ref of refs) {
        if (!fixtures[ref]) process.exit(1);
        console.log(JSON.stringify(fixtures[ref]));
    }
}
else process.exit(1);
`);
    writeFileSync(
        join(folder, "docker"),
        `#!${process.execPath}
import(${JSON.stringify(daemon.href)});
`,
        {mode: 0o755},
    );
    process.env.PATH = `${folder}:${path}`;
    await verifyLoopbackBindings(project, {scanner: true, edge: true});

    const inspections = readFileSync(trace, "utf8").trim().split("\n")
        .map((line) => JSON.parse(line))
        .filter(([action]) => action === "inspect");
    assert.deepEqual(inspections.map((args) => args.slice(args.indexOf("--") + 1)), [
        refs,
        [scanner],
    ]);
    for (const args of inspections) {
        const projection = args[args.indexOf("--format") + 1];
        assert.match(projection, /NetworkSettings/);
        assert.doesNotMatch(projection, /Config.Env/);
    }
    writeFileSync(incomplete, "");
    await assert.rejects(
        verifyLoopbackBindings(project, {scanner: true, edge: true}),
        /Incomplete Docker container inspection/,
    );
});

test("private environment writes preserve values and restrict filesystem permissions", () => {
    const path = mkdtempSync(join(tmpdir(), "portal-runtime-safety-"));
    try {
        const file = join(path, "env");
        privateWrite(file, "PASSWORD=value=with=equals\n");
        assert.equal(readEnvFile(file).PASSWORD, "value=with=equals");
        assert.equal(readPrivateFixture(file).toString("utf8"), "PASSWORD=value=with=equals\n");
        privateWrite(file, "PASSWORD=value=with=equals\n");
        assert.equal(readPrivateFixture(file).toString("utf8"), "PASSWORD=value=with=equals\n");
    } finally {
        rmSync(path, {recursive: true, force: true});
    }
});

test("unfinished migrations are rejected before bootstrap and new schema changes alter the startup digest", () => {
    const directory = mkdtempSync(join(tmpdir(), "portal-migration-safety-"));
    const migrations = join(directory, "supabase/migrations");
    mkdirSync(migrations, {recursive: true});
    try {
        const file = join(migrations, "20261115000000_test.sql");
        writeFileSync(file, "-- unfinished migration\n/* still no SQL */");
        assert.throws(() => migrationDigest(directory), /is empty/);
        writeFileSync(file, "begin; select 1; commit;");
        const before = migrationDigest(directory);
        writeFileSync(file, "begin; select 2; commit;");
        assert.notEqual(migrationDigest(directory), before);
    } finally {
        rmSync(directory, {recursive: true, force: true});
    }
});
