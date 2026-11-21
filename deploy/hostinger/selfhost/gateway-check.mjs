/**
 * Run a real isolated gateway with deliberately unreachable upstreams to distinguish allowed routes from blocked paths. This checks proxy boundaries, not complete Auth/business acceptance.
 */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {request as httpRequest} from "node:http";
import {spawnSync} from "node:child_process";
import {mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";

/** Render the configured listener and label the virtual host's chosen route for assertions. */
export function renderGatewayRoutingListener(template, server) {
    const routes = /^( +)routes:$/gm;
    assert.equal([...template.matchAll(routes)].length, 1, "Expected one gateway virtual host routes block.");
    return template
        .replace(/\$\{([A-Z_]+)\}/g, (_, key) => {
            assert(key in server, "Unexpected gateway configuration placeholder.");
            return server[key];
        })
        .replace(routes, (_, indent) =>
            [
                "response_headers_to_add:",
                "  - header:",
                "      key: x-portal-test-route",
                "      value: '%ROUTE_NAME%'",
                "routes:",
            ].map((line) => indent + line).join("\n"),
        );
}

// Optional real Envoy routing check. Generated test-only keys, no backend or
// external network; a random loopback-only host port reaches this isolated proxy.
// Exercise real gateway requests against controlled upstreams and remove only owned resources.
export async function checkGatewayRouting({directory, here, image, server}) {
    const name = "portal-gateway-check-" + randomUUID();
    const network = name + "-network";
    const label = "org.luminovia.gateway-check";
    const configuration = join(directory, "gateway");
    mkdirSync(configuration, {mode: 0o700});
    const docker = (args) => {
        const result = spawnSync("docker", args, {
            encoding: "utf8",
            timeout: 120000,
            maxBuffer: 4 * 1024 * 1024,
        });
        if (result.status !== 0)
            throw new Error(
                "Owned local Envoy routing operation failed; generated configuration withheld.",
            );
        return result.stdout.trim();
    };
    const template = renderGatewayRoutingListener(
        readFileSync(join(here, "envoy/lds.template.yaml"), "utf8"),
        server,
    );
    writeFileSync(join(configuration, "lds.yaml"), template, {mode: 0o600});
    // Every upstream is deliberately unavailable on this isolated loopback. A
    // selected allowlisted route returns503; the gateway's deny route returns404.
    const clusters = readFileSync(join(here, "envoy/cds.yaml"), "utf8").replace(
        /address: (?:auth|rest|realtime-dev\.supabase-realtime|storage|functions)\n/g,
        "address: 127.0.0.1\n",
    );
    writeFileSync(join(configuration, "cds.yaml"), clusters, {mode: 0o600});
    writeFileSync(
        join(configuration, "envoy.yaml"),
        "dynamic_resources:\n  cds_config:\n    path_config_source: {path: /etc/envoy/cds.yaml}\n    resource_api_version: V3\n  lds_config:\n    path_config_source: {path: /etc/envoy/lds.yaml}\n    resource_api_version: V3\nnode: {cluster: portal-check, id: portal-check}\n",
        {mode: 0o600},
    );
    let created = false;
    let createdNetwork = false;
    try {
        docker([
            "network",
            "create",
            "--internal",
            "--label",
            `${label}=${name}`,
            network,
        ]);
        createdNetwork = true;
        docker([
            "create",
            "--name",
            name,
            "--label",
            `${label}=${name}`,
            "--network",
            network,
            "--publish",
            "127.0.0.1::8000",
            "--log-driver",
            "none",
            "--memory",
            "256m",
            "--pids-limit",
            "64",
            "--security-opt",
            "no-new-privileges:true",
            "--mount",
            `type=bind,src=${configuration},dst=/etc/envoy,readonly`,
            "--entrypoint",
            "envoy",
            image,
            "-c",
            "/etc/envoy/envoy.yaml",
            "--concurrency",
            "1",
            "--log-level",
            "critical",
        ]);
        created = true;
        docker(["start", name]);
        const hostPort = docker([
            "inspect",
            "--format",
            '{{(index (index .NetworkSettings.Ports "8000/tcp") 0).HostPort}}',
            name,
        ]);
        assert.match(hostPort, /^[1-9][0-9]{0,4}$/);
        const request = (path) =>
            new Promise((resolve, reject) => {
                const outgoing = httpRequest(
                    {
                        host: "127.0.0.1",
                        port: Number(hostPort),
                        path,
                        method: "GET",
                        headers: {host: "portal-check", connection: "close"},
                        timeout: 5000,
                    },
                    (response) => {
                        response.resume();
                        response.once("end", () =>
                            resolve({
                                status: response.statusCode,
                                headers: response.headers,
                            }),
                        );
                    },
                );
                outgoing.once("timeout", () =>
                    outgoing.destroy(new Error("Gateway request timed out.")),
                );
                outgoing.once("error", reject);
                outgoing.end();
            });
        let ready = false;
        for (let attempt = 0; attempt < 60; attempt++) {
            try {
                await request("/");
                ready = true;
                break;
            } catch {
                Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
            }
        }
        assert(ready, "Owned isolated Envoy did not become ready.");
        const cases = [
            ["/functions/v1/accounts", 503, "portal-function-accounts"],
            ["/functions/v1/accounts/v1/me", 503, "portal-function-accounts"],
            [
                "/functions/v1/accounts/v1/users?limit=25",
                503,
                "portal-function-accounts",
            ],
            ["/functions/v1/accounts/openapi.json", 503, "portal-function-accounts"],
            ["/functions/v1/files", 503, "portal-function-files"],
            [
                "/functions/v1/course-documents",
                503,
                "portal-function-course-documents",
            ],
            [
                "/functions/v1/calendar-feed?token=fictional-owned-capability",
                503,
                "portal-function-calendar-feed",
            ],
            ["/functions/v1/invite-lecturer", 503, "portal-function-invite-lecturer"],
            [
                "/functions/v1/website-enquiries",
                503,
                "portal-function-website-enquiries",
            ],
            ["/functions/v1/website-enquiries/extra", 404],
            ["/functions/v1/human-login", 503, "portal-function-human-login"],
            ["/functions/v1/human-recovery", 503, "portal-function-human-recovery"],
            ["/functions/v1/human-recovery/extra", 404],
            ["/functions/v1/company-integration", 503, "portal-function-company-integration"],
            ["/functions/v1/company-integration/extra", 404],
            ["/functions/v1/human-login/extra", 404],
            ["/functions/v1/human-login-extra", 404],
            ["/functions/v1/website-enquiries-extra", 404],
            ["/functions/v1/accounts-extra/v1/me", 404],
            ["/functions/v1/account/v1/me", 404],
            ["/functions/v1/files/extra", 404],
            ["/functions/v1/course-documents/extra", 404],
            ["/functions/v1/calendar-feed/extra", 404],
            ["/functions/v1/calendar-feed-extra", 404],
            ["/functions/v1/main", 404],
            ["/functions/v1/unreviewed", 404],
        ];
        for (const [path, status, route] of cases) {
            const response = await request(path);
            assert.equal(response.status, status, "Actual gateway route status differed.");
            if (route)
                assert.equal(response.headers["x-portal-test-route"], route);
        }
        console.log(
            `PASS: ${cases.length} actual isolated Envoy function routes; accounts subpaths accepted, lookalikes/internal/unknown workers denied.`,
        );
    } finally {
        if (created) {
            const labels = JSON.parse(
                docker(["inspect", "--format", "{{json .Config.Labels}}", name]),
            );
            assert.equal(labels[label], name, "Refusing unrelated gateway cleanup.");
            docker(["rm", "--force", name]);
        }
        if (createdNetwork) {
            const labels = JSON.parse(
                docker(["network", "inspect", "--format", "{{json .Labels}}", network]),
            );
            assert.equal(labels[label], name, "Refusing unrelated gateway network cleanup.");
            docker(["network", "rm", network]);
        }
    }
}
