/**
 * Run a real isolated gateway with deliberately unreachable upstreams to distinguish allowed routes from blocked paths. This checks proxy boundaries, not complete Auth/business acceptance.
 */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
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

// Optional real Envoy routing check. Generated test-only keys, no backend,
// network or host ports; only this labelled temporary container is removed.
// Exercise real gateway requests against controlled upstreams and remove only owned resources.
export function checkGatewayRouting({directory, here, image, server}) {
    const name = "portal-gateway-check-" + randomUUID();
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
    try {
        docker([
            "create",
            "--name",
            name,
            "--label",
            `${label}=${name}`,
            "--network",
            "none",
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
        let ready = false;
        for (let attempt = 0; attempt < 60; attempt++) {
            const result = spawnSync(
                "docker",
                ["exec", name, "bash", "-c", "true </dev/tcp/127.0.0.1/8000"],
                {encoding: "utf8", timeout: 10000},
            );
            if (result.status === 0) {
                ready = true;
                break;
            }
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
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
            ["/functions/v1/learning-lti", 503, "portal-function-learning-lti", "POST"],
            ["/functions/v1/learning-lti", 503, "portal-function-learning-lti", "OPTIONS"],
            ["/functions/v1/learning-lti", 404],
            ["/functions/v1/learning-lti/jwks", 503, "portal-function-learning-lti-jwks"],
            ["/functions/v1/learning-lti/jwks", 404, null, "POST"],
            ["/functions/v1/learning-lti/jwks/extra", 404],
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
            ["/functions/v1/company-integration/enrolments", 503, "portal-function-company-integration"],
            ["/functions/v1/company-integration/participation", 503, "portal-function-company-integration"],
            ["/functions/v1/company-integration/extra", 404],
            ["/functions/v1/portal-api/v1/course_workspace", 503, "portal-function-portal-api"],
            ["/functions/v1/portal-api/v1/save_course_exam_schedule", 503, "portal-function-portal-api", "PUT"],
            ["/functions/v1/portal-api/v1/remove_course_exam_pdf", 503, "portal-function-portal-api", "DELETE"],
            ["/functions/v1/portal-api/v1/course_workspace", 503, "portal-function-portal-api", "OPTIONS"],
            ["/functions/v1/portal-api/v1/course_workspace", 404, null, "POST"],
            ["/functions/v1/portal-api/v1/mark_notifications", 503, "portal-function-portal-api", "PATCH"],
            ["/functions/v1/portal-api/v1/course_workspace/extra", 404],
            ["/functions/v1/portal-api/v1/Course_Workspace", 404],
            ["/functions/v1/portal-api", 404],
            ["/functions/v1/portal-api-extra/v1/course_workspace", 404],
            ["/functions/v1/mail-admin", 503, "portal-function-mail-admin"],
            ["/functions/v1/mail-admin/extra", 404],
            ["/functions/v1/mail-admin-extra", 404],
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
        for (const [path, status, route, method = "GET"] of cases) {
            const response = docker([
                "exec",
                name,
                "bash",
                "-c",
                "exec 3<>/dev/tcp/127.0.0.1/8000; printf '%s %s HTTP/1.1\\r\\nHost: portal-check\\r\\nConnection: close\\r\\n\\r\\n' \"$1\" \"$2\" >&3; cat <&3",
                "gateway-probe",
                method,
                path,
            ]);
            assert.equal(
                Number(/^HTTP\/1\.1 (\d+)/.exec(response)?.[1]),
                status,
                "Actual gateway route status differed.",
            );
            if (route)
                assert(
                    response.toLowerCase().includes("x-portal-test-route: " + route),
                );
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
    }
}
