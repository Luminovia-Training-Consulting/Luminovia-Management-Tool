/** Executable listener-boundary regressions use owned loopback HTTP and fictional configuration, never a database. */
import assert from "node:assert/strict";
import {execFileSync, spawn} from "node:child_process";
import {once} from "node:events";
import {mkdir, mkdtemp, readFile, rm, symlink, writeFile,} from "node:fs/promises";
import {tmpdir} from "node:os";
import {createServer} from "node:https";
import {dirname, join, resolve} from "node:path";
import {test} from "node:test";
import {candidateCertificateArguments} from "../deploy/hostinger/maintenance/selfhost-candidate-check.mjs";

const root = resolve(import.meta.dirname, "..");
const candidateProject = "luminovia-portal-test-" + "a".repeat(24);
const canonicalProject = "luminovia-portal-test-a1b2c3d4";

/** Runs the real listener with either a harmless handler stub or the actual Supabase adapter, using fictional owned endpoints only. */
async function listenerFixture(t, changes = {}, options = {}) {
    const directory = await mkdtemp(join(tmpdir(), "portal-enquiry-listener-"));
    t.after(() => rm(directory, {recursive: true, force: true}));
    const listener = join(directory, "scripts/testing/enquiries-edge-http.ts");
    await mkdir(dirname(listener), {recursive: true});
    await mkdir(join(directory, "supabase/functions/website-enquiries"), {
        recursive: true,
    });
    await writeFile(
        listener,
        await readFile(join(root, "scripts/testing/enquiries-edge-http.ts")),
    );
    if (options.realRuntime) {
        await symlink(join(root, "node_modules"), join(directory, "node_modules"));
        await mkdir(join(directory, "supabase/functions/_shared"), {recursive: true});
        for (const name of [
            "website-enquiries/runtime.ts",
            "website-enquiries/handler.ts",
            "_shared/bounded-body.ts",
        ])
            await writeFile(
                join(directory, "supabase/functions", name),
                await readFile(
                    join(root, "supabase/functions", name),
                ),
            );
    } else {
        await writeFile(
            join(directory, "supabase/functions/website-enquiries/runtime.ts"),
            'export const websiteEnquiryRuntime = () => () => new Response("fictional listener");\n',
        );
    }
    const environment = {
        PORTAL_TEST_MODE: "1",
        SUPABASE_URL: "http://127.0.0.1:55321",
        PORTAL_ENQUIRY_TEST_API_ORIGIN: "http://127.0.0.1:55321",
        PORTAL_ENQUIRY_TEST_PROJECT: canonicalProject,
        ...changes,
    };
    await writeFile(
        join(directory, "supabase/config.toml"),
        `project_id = "${environment.configProject ?? environment.PORTAL_ENQUIRY_TEST_PROJECT}"\n`,
    );
    delete environment.configProject;
    const child = spawn(
        join(root, "node_modules/deno/deno"),
        [
            "run",
            // Use the locked npm installation attached to the isolated fixture.
            "--node-modules-dir=manual",
            ...(options.certificate ? [`--cert=${options.certificate}`] : []),
            "--allow-env",
            "--allow-read=supabase/config.toml",
            "--allow-net=127.0.0.1,localhost,[::1]",
            listener,
        ],
        {
            cwd: directory,
            env: {PATH: process.env.PATH, ...environment},
            stdio: ["ignore", "pipe", "pipe"],
        },
    );
    const ended = once(child, "close");
    t.after(async () => {
        if (child.exitCode === null) {
            child.kill("SIGTERM");
            await ended;
        }
    });
    return new Promise((resolveResult, reject) => {
        let output = "";
        const timeout = setTimeout(() => {
            child.kill("SIGKILL");
            reject(Error("Fictional listener did not finish startup"));
        }, 30000);
        child.on("error", reject);
        child.stdout.on("data", (data) => {
            output += data;
            const match = /PORTAL_ENQUIRY_TEST_PORT=(\d+)/.exec(output);
            if (match) {
                clearTimeout(timeout);
                resolveResult({port: Number(match[1]), output});
            }
        });
        child.stderr.resume();
        child.once("close", (code) => {
            clearTimeout(timeout);
            resolveResult({code, output});
        });
    });
}

test("enquiry listener accepts the canonical owned test endpoint", async (t) => {
    const result = await listenerFixture(t);
    assert.ok(result.port, "Canonical listener reaches actual readiness");
    assert.equal(
        await (await fetch(`http://127.0.0.1:${result.port}`)).text(),
        "fictional listener",
    );
});

test("enquiry listener accepts the already ownership-verified native candidate endpoint", async (t) => {
    const result = await listenerFixture(t, {
        SUPABASE_URL: "https://127.0.0.1:44777",
        PORTAL_ENQUIRY_TEST_API_ORIGIN: "https://127.0.0.1:44777",
        PORTAL_ENQUIRY_TEST_PROJECT: candidateProject,
        PORTAL_CANDIDATE_OWNER: candidateProject,
        PORTAL_DB_CONTAINER: "supabase_db_" + candidateProject,
    });
    assert.ok(result.port, "Native candidate listener reaches actual readiness");
});

test("enquiry listener rejects unowned, mismatched, ordinary, remote and missing-test contexts before readiness", async (t) => {
    const native = {
        SUPABASE_URL: "https://127.0.0.1:44777",
        PORTAL_ENQUIRY_TEST_API_ORIGIN: "https://127.0.0.1:44777",
        PORTAL_ENQUIRY_TEST_PROJECT: candidateProject,
        PORTAL_CANDIDATE_OWNER: candidateProject,
        PORTAL_DB_CONTAINER: "supabase_db_" + candidateProject,
    };
    for (const [name, changes] of [
        ["missing test mode", {PORTAL_TEST_MODE: ""}],
        ["missing confirmed endpoint", {PORTAL_ENQUIRY_TEST_API_ORIGIN: ""}],
        ["ordinary project", {configProject: "luminovia-portal"}],
        ["different project", {configProject: canonicalProject + "a"}],
        ["ordinary API", {SUPABASE_URL: "http://127.0.0.1:54321"}],
        ["remote API", {SUPABASE_URL: "https://backend.example.invalid"}],
        ["unowned native", {...native, PORTAL_CANDIDATE_OWNER: ""}],
        [
            "different native owner",
            {...native, PORTAL_CANDIDATE_OWNER: canonicalProject},
        ],
        [
            "different native DB",
            {...native, PORTAL_DB_CONTAINER: "supabase_db_unrelated"},
        ],
        [
            "different native API",
            {...native, SUPABASE_URL: "https://127.0.0.1:44778"},
        ],
        [
            "insecure native API",
            {
                ...native,
                SUPABASE_URL: "http://127.0.0.1:44777",
                PORTAL_ENQUIRY_TEST_API_ORIGIN: "http://127.0.0.1:44777",
            },
        ],
    ]) {
        await t.test(name, async (subtest) => {
            const result = await listenerFixture(subtest, changes);
            assert.notEqual(result.code, 0);
            assert.equal(
                result.port,
                undefined,
                "Rejected context never starts HTTP",
            );
            assert.doesNotMatch(result.output, /PORTAL_ENQUIRY_TEST_PORT=/);
        });
    }
});

/** Exercises the actual npm Supabase adapter and TLS validation, not only the listener's readiness boundary. */
for (const tlsCase of [
    {
        name: "delivers over certificate-verified native HTTPS",
        trust: true,
        validName: true,
    },
    {
        name: "rejects an untrusted native HTTPS certificate",
        trust: false,
        validName: true,
    },
    {
        name: "rejects a trusted native HTTPS certificate with the wrong hostname",
        trust: true,
        validName: false,
    },
])
    test(`enquiry runtime ${tlsCase.name}`, async (t) => {
        const directory = await mkdtemp(join(tmpdir(), "portal-enquiry-tls-"));
        t.after(() => rm(directory, {recursive: true, force: true}));
        const certificate = join(directory, "cert.pem"),
            key = join(directory, "key.pem");
        const certificateArgs = candidateCertificateArguments(directory);
        if (!tlsCase.validName)
            certificateArgs[certificateArgs.indexOf("subjectAltName=IP:127.0.0.1")] =
                "subjectAltName=DNS:wrong-host.example.invalid";
        execFileSync("openssl", certificateArgs, {
            stdio: "ignore",
        });
        const received = [];
        const server = createServer(
            {cert: await readFile(certificate), key: await readFile(key)},
            async (request, response) => {
                let body = "";
                for await (const chunk of request) body += chunk;
                received.push({
                    path: request.url,
                    method: request.method,
                    body: JSON.parse(body),
                });
                response.writeHead(200, {"content-type": "application/json"});
                response.end(JSON.stringify("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"));
            },
        );
        await new Promise((resolveListen) =>
            server.listen(0, "127.0.0.1", resolveListen),
        );
        t.after(() => new Promise((resolveClose) => server.close(resolveClose)));
        const url = `https://127.0.0.1:${server.address().port}`;
        const token = "fictional-integration-token-at-least-32-characters";
        const result = await listenerFixture(
            t,
            {
                SUPABASE_URL: url,
                SUPABASE_SERVICE_ROLE_KEY: "fictional-service-key",
                PORTAL_ENQUIRY_TEST_API_ORIGIN: url,
                PORTAL_ENQUIRY_TEST_PROJECT: candidateProject,
                PORTAL_CANDIDATE_OWNER: candidateProject,
                PORTAL_DB_CONTAINER: "supabase_db_" + candidateProject,
                PORTAL_WEBSITE_ENQUIRIES_ENABLED: "true",
                PORTAL_WEBSITE_INTEGRATION_TOKEN: token,
                PORTAL_WEBSITE_ORIGIN: "https://website.example.invalid",
                PORTAL_WEBSITE_PRIVACY_NOTICE_VERSION: "fictional-v1",
                ...(tlsCase.trust ? {NODE_EXTRA_CA_CERTS: certificate} : {}),
            },
            {realRuntime: true, ...(tlsCase.trust ? {certificate} : {})},
        );
        assert.ok(result.port, "Actual runtime reaches readiness");
        const submission = "aaaaaaaa-bbbb-4ccc-8ddd-ffffffffffff";
        const endpoint = `http://127.0.0.1:${result.port}/website-enquiries`;
        const headers = {
            "content-type": "application/json",
            "X-Luminovia-Integration-Token": token,
        };
        // The deployed handler must reject oversized data before calling the backend.
        const oversized = await fetch(endpoint, {
            method: "POST",
            headers,
            body: JSON.stringify({message: "x".repeat(24000)}),
        });
        assert.equal(oversized.status, 413);
        assert.deepEqual(await oversized.json(), {error: "invalid_request"});
        assert.equal(received.length, 0);
        const response = await fetch(
            endpoint,
            {
                method: "POST",
                headers,
                body: JSON.stringify({
                    submission_id: submission,
                    company_name: "Fictional Company",
                    contact_name: "Fictional Contact",
                    email: "fictional@example.invalid",
                    phone: "",
                    topic: "Fictional topic",
                    message: "Fictional requirements",
                    preferred_dates: "",
                    duration: "",
                    delivery_type: "online",
                    time_zone: "Europe/Berlin",
                    locale: "en",
                    privacy_notice_version: "fictional-v1",
                    consent: true,
                    website: "",
                }),
            },
        );
        const accepted = tlsCase.trust && tlsCase.validName;
        assert.equal(
            response.status,
            accepted ? 202 : 503,
            `Actual HTTPS runtime response; received ${received.length} RPC calls; ${await response.text()}`,
        );
        assert.equal(received.length, accepted ? 1 : 0);
        if (!accepted) return;
        assert.equal(received[0].path, "/rest/v1/rpc/receive_website_enquiry");
        assert.equal(received[0].method, "POST");
        assert.equal(received[0].body.p_submission_id, submission);
    });