#!/usr/bin/env node
/**
 * Validate rendered selfhost configuration, image pins and real gateway boundaries using synthetic values. Temporary files belong only to this probe; no existing instance is configured.
 */
/** Offline cryptography, permissions and Docker Compose boundary validation. */
import assert from "node:assert/strict";
import {createHash, createHmac, createPublicKey, verify} from "node:crypto";
import {existsSync, mkdtempSync, readFileSync, rmSync, statSync,} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {spawnSync} from "node:child_process";
import {createConfiguration, writeConfiguration} from "./generate-env.mjs";
import {checkGatewayRouting} from "./gateway-check.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const directory = mkdtempSync(
    resolve(tmpdir(), "luminovia-selfhost-validation-"),
);
try {
    const options = {
        portalOrigin: "https://portal.example.invalid",
        apiOrigin: "https://portal.example.invalid/backend",
        dataDirectory: resolve(directory, "data"),
    };
    const configuration = createConfiguration(options);
    const server = configuration.server;
    for (const [key, role] of [
        ["ANON_KEY", "anon"],
        ["SERVICE_ROLE_KEY", "service_role"],
    ]) {
        const [header, payload, signature] = server[key].split(".");
        assert.equal(JSON.parse(Buffer.from(header, "base64url")).alg, "HS256");
        assert.equal(JSON.parse(Buffer.from(payload, "base64url")).role, role);
        assert.equal(
            signature,
            createHmac("sha256", server.JWT_SECRET)
                .update(header + "." + payload)
                .digest("base64url"),
        );
    }
    const jwks = JSON.parse(server.JWT_JWKS);
    const privateKeys = JSON.parse(server.JWT_KEYS);
    assert.equal(
        Buffer.from(jwks.keys[1].k, "base64url").toString(),
        server.JWT_SECRET,
    );
    assert(!("d" in jwks.keys[0]));
    assert.equal(privateKeys[0].kid, jwks.keys[0].kid);
    const publicKey = createPublicKey({key: jwks.keys[0], format: "jwk"});
    for (const [key, role] of [
        ["ANON_KEY_ASYMMETRIC", "anon"],
        ["SERVICE_ROLE_KEY_ASYMMETRIC", "service_role"],
    ]) {
        const [header, payload, signature] = server[key].split(".");
        assert.equal(JSON.parse(Buffer.from(payload, "base64url")).role, role);
        assert(
            verify(
                "SHA256",
                Buffer.from(header + "." + payload),
                {key: publicKey, dsaEncoding: "ieee-p1363"},
                Buffer.from(signature, "base64url"),
            ),
        );
    }
    for (const name of ["SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY"]) {
        const key = server[name];
        const cut = key.length - 9;
        assert.equal(key[cut], "_");
        assert.equal(
            key.slice(cut + 1),
            createHash("sha256")
                .update("supabase-self-hosted|" + key.slice(0, cut))
                .digest("base64url")
                .slice(0, 8),
        );
    }
    assert.equal(
        server.API_EXTERNAL_URL,
        "https://portal.example.invalid/backend/auth/v1",
    );
    for (const name of [
        "MAILER_URLPATHS_INVITE",
        "MAILER_URLPATHS_CONFIRMATION",
        "MAILER_URLPATHS_RECOVERY",
        "MAILER_URLPATHS_EMAIL_CHANGE",
    ]) {
        assert.equal(
            new URL(server[name], server.API_EXTERNAL_URL).pathname,
            "/backend/auth/v1/verify",
        );
    }
    assert.deepEqual(Object.keys(configuration.public).sort(), [
        "VITE_SUPABASE_PUBLISHABLE_KEY",
        "VITE_SUPABASE_URL",
    ]);
    assert(
        !JSON.stringify(configuration.public).includes(server.SERVICE_ROLE_KEY),
    );
    assert(
        !JSON.stringify(configuration.public).includes(server.SUPABASE_SECRET_KEY),
    );
    assert.equal(server.SMTP_HOST, "mail-relay");
    assert.equal(server.SMTP_PORT, "2525");
    assert.equal(server.SMTP_ADMIN_EMAIL, "no-reply@example.invalid");
    assert.match(
        server.MAIL_RELAY_USERNAME,
        /^relay-[a-f0-9]{24}@internal\.invalid$/,
    );
    assert.equal(server.SMTP_USER, server.MAIL_RELAY_USERNAME);
    assert.equal(server.SMTP_PASS, server.MAIL_RELAY_PASSWORD);
    assert.ok(server.MAIL_RELAY_PASSWORD.length >= 40);
    assert.ok(server.PORTAL_MAIL_RELAY_CONTROL_TOKEN.length >= 40);
    assert.equal(server.PORTAL_MAIL_RELAY_URL, "http://mail-relay:8080");
    assert.throws(() =>
        createConfiguration({
            ...options,
            portalOrigin: "http://portal.example.invalid",
        }),
    );
    assert.throws(() =>
        createConfiguration({
            ...options,
            apiOrigin: "https://user:password@portal.example.invalid/backend",
        }),
    );
    assert.throws(() =>
        createConfiguration({
            ...options,
            portalOrigin: "https://portal.example.invalid/path",
        }),
    );
    assert.throws(() =>
        createConfiguration({...options, dataDirectory: "relative"}),
    );
    const output = resolve(directory, "private", "selfhost.env");
    const paths = writeConfiguration(output, configuration);
    assert.equal(paths.length, 3);
    assert(paths.every((path) => (statSync(path).mode & 0o777) === 0o600));
    const original = readFileSync(output);
    const publicFile = readFileSync(paths[1], "utf8");
    const workerFile = readFileSync(paths[2], "utf8");
    assert(workerFile.includes("PORTAL_NOTIFICATION_MAIL_ENABLED='false'"));
    assert(workerFile.includes(server.MAIL_RELAY_PASSWORD));
    assert(workerFile.includes(server.SERVICE_ROLE_KEY));
    assert(!publicFile.includes(server.MAIL_RELAY_PASSWORD));
    assert(!publicFile.includes(server.PORTAL_MAIL_RELAY_CONTROL_TOKEN));
    assert.throws(() => writeConfiguration(output, configuration));
    assert.deepEqual(readFileSync(output), original);
    const result = spawnSync(
        "docker",
        [
            "compose",
            "--project-directory",
            here,
            "--env-file",
            output,
            "-f",
            resolve(here, "compose.yml"),
            "config",
            "--format",
            "json",
        ],
        {encoding: "utf8", maxBuffer: 8 * 1024 * 1024},
    );
    if (result.status !== 0) {
        const secrets = [
            ...Object.entries(configuration.server),
            ...Object.entries(configuration.notification),
        ]
            .filter(([key]) =>
                /KEY|SECRET|PASSWORD|PASS|TOKEN|USERNAME|JWT/i.test(key),
            )
            .map(([, value]) => value)
            .filter((value) => typeof value === "string" && value.length >= 8);
        let diagnostic = `${result.stderr ?? ""}\n${result.stdout ?? ""}`;
        for (const secret of secrets)
            diagnostic = diagnostic.replaceAll(secret, "[redacted]");
        throw new Error(
            `Docker Compose validation failed: ${diagnostic.trim().slice(-1800) || "no diagnostic output"}`,
        );
    }
    const compose = JSON.parse(result.stdout);
    assert.deepEqual(Object.keys(compose.services).sort(), [
        "api-gw",
        "auth",
        "db",
        "functions",
        "mail-relay",
        "mailpit",
        "realtime",
        "rest",
        "storage",
    ]);
    for (const [name, service] of Object.entries(compose.services)) {
        assert(/@sha256:[a-f0-9]{64}$/.test(service.image));
        assert.equal(service.healthcheck.interval, "30s");
        assert.equal(service.healthcheck.start_interval, "5s");
        assert.equal(
            service.healthcheck.start_period,
            name === "mailpit" ? "30s" : name === "mail-relay" ? "10s" : "1m0s",
        );
        assert.equal(service.healthcheck.timeout, "5s");
        assert.equal(service.healthcheck.retries, 3);
        if (name === "mailpit" || name === "mail-relay") {
            assert.equal(service.ports.length, 1);
            assert.equal(service.ports[0].host_ip, "127.0.0.1");
            assert.equal(service.ports[0].target, name === "mailpit" ? 8025 : 2526);
        } else assert(!service.ports?.length, "Unexpected host-port publication.");
        if (name === "mail-relay") {
            assert.equal(
                service.image,
                "python:3.13.11-slim-bookworm@sha256:20080e807bfc404f8450b185cf0fc95d553462673598549613735f70a5b4d5d0",
            );
            assert.equal(service.read_only, true);
            assert.equal(service.user, "10001:10001");
            assert.equal(Number(service.mem_limit), 96 * 1024 * 1024);
            assert.deepEqual(service.cap_drop, ["ALL"]);
        }
        for (const volume of service.volumes ?? []) {
            if (
                volume.type === "bind" &&
                !volume.source.startsWith(options.dataDirectory)
            )
                assert(
                    existsSync(volume.source),
                    "A source/config mount does not exist.",
                );
        }
    }
    const auth = compose.services.auth.environment;
    assert.equal(auth.GOTRUE_DISABLE_SIGNUP, "true");
    assert.equal(auth.GOTRUE_PASSWORD_MIN_LENGTH, "8");
    // Docker Compose canonical output doubles literal dollar signs for safe re-evaluation.
    assert.equal(
        auth.GOTRUE_PASSWORD_REQUIRED_CHARACTERS,
        "ABCDEFGHIJKLMNOPQRSTUVWXYZ:abcdefghijklmnopqrstuvwxyz:0123456789:!@#$$%^&*()_+-=[]{}|;\\:,.<>?/",
    );
    assert.equal(auth.GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED, "false");
    assert.equal(auth.GOTRUE_EXTERNAL_PHONE_ENABLED, "false");
    assert.equal(auth.GOTRUE_MFA_TOTP_ENROLL_ENABLED, "false");
    assert.equal(auth.GOTRUE_MFA_TOTP_VERIFY_ENABLED, "false");
    assert.equal(auth.GOTRUE_MFA_PHONE_ENROLL_ENABLED, "false");
    assert.equal(auth.GOTRUE_MFA_PHONE_VERIFY_ENABLED, "false");
    assert.equal(auth.GOTRUE_MFA_WEB_AUTHN_ENROLL_ENABLED, "false");
    assert.equal(auth.GOTRUE_MFA_WEB_AUTHN_VERIFY_ENABLED, "false");
    assert.equal(auth.GOTRUE_MAILER_AUTOCONFIRM, "false");
    assert.equal(auth.GOTRUE_SMTP_HOST, "mail-relay");
    assert.equal(auth.GOTRUE_SMTP_PORT, "2525");
    assert.equal(auth.GOTRUE_SMTP_USER, server.MAIL_RELAY_USERNAME);
    assert.equal(auth.GOTRUE_SMTP_PASS, server.MAIL_RELAY_PASSWORD);
    const workers = [
        "files",
        "invite-lecturer",
        "accounts",
        "course-documents",
        "calendar-feed",
        "human-login",
        "human-recovery",
        "company-integration",
        "website-enquiries",
        "mail-admin",
    ];
    for (const worker of workers) {
        const mount = compose.services.functions.volumes.find(
            (volume) => volume.target === "/home/deno/functions/" + worker,
        );
        assert(
            mount?.type === "bind" && mount.read_only === true,
            "Reviewed application worker must have an explicit read-only bind.",
        );
        assert.equal(
            mount.source,
            resolve(here, "../../../supabase/functions", worker),
        );
    }
    for (const name of [
        "SUPABASE_URL",
        "SUPABASE_ANON_KEY",
        "SUPABASE_SERVICE_ROLE_KEY",
        "PORTAL_APP_ORIGIN",
        "PORTAL_MAIL_RELAY_URL",
        "PORTAL_MAIL_RELAY_CONTROL_TOKEN",
        "PORTAL_ALLOWED_ORIGINS",
        "PORTAL_INVITES_ENABLED",
    ])
        assert(
            compose.services.functions.environment[name],
            "An accounts runtime environment field is missing.",
        );
    const router = readFileSync(resolve(here, "runtime/index.ts"), "utf8");
    assert(router.includes("const PORTAL_FUNCTIONS = new Set(["));
    for (const worker of workers)
        assert(router.includes(`"${worker}"`), `The function router omits ${worker}.`);
    assert(router.includes("if (!PORTAL_FUNCTIONS.has(service_name))"));
    assert.equal(server.PORTAL_WEBSITE_ENQUIRIES_ENABLED, "false");
    assert.equal(
        compose.services.functions.environment.PORTAL_WEBSITE_ENQUIRIES_ENABLED,
        "false",
    );
    assert.equal(
        compose.services.functions.environment.PORTAL_WEBSITE_INTEGRATION_TOKEN,
        "",
    );
    assert.equal(
        compose.services.functions.environment.PORTAL_WEBSITE_ORIGIN,
        "",
    );
    assert.equal(
        compose.services.functions.environment
            .PORTAL_WEBSITE_PRIVACY_NOTICE_VERSION,
        "",
    );
    if (process.argv.includes("--gateway-routing"))
        checkGatewayRouting({
            directory,
            here,
            image: compose.services["api-gw"].image,
            server,
        });
    assert.equal(compose.services.functions.environment.VERIFY_JWT, "true");
    assert.equal(
        compose.services.functions.environment.PORTAL_CLAMAV_HOST,
        "clamav",
    );
    assert.equal(
        compose.services.functions.environment.PORTAL_CLAMAV_PORT,
        "3310",
    );
    assert(!("PORTAL_SCANNER_URL" in compose.services.functions.environment));
    assert(!("PORTAL_SCANNER_TOKEN" in compose.services.functions.environment));
    assert.equal(
        compose.services.storage.environment.ENABLE_IMAGE_TRANSFORMATION,
        "false",
    );
    const webResult = spawnSync(
        "docker",
        [
            "compose",
            "--project-directory",
            resolve(here, ".."),
            "-f",
            resolve(here, "../compose.yml"),
            "config",
            "--format",
            "json",
        ],
        {
            encoding: "utf8",
            maxBuffer: 8 * 1024 * 1024,
            env: {...process.env, PORTAL_DOMAIN: "portal.example.invalid"},
        },
    );
    if (webResult.status !== 0)
        throw new Error("Web Docker Compose validation failed.");
    const clamav = JSON.parse(webResult.stdout).services.clamav;
    assert.equal(clamav.healthcheck.interval, "30s");
    assert.equal(clamav.healthcheck.start_interval, "5s");
    assert.equal(clamav.healthcheck.start_period, "3m0s");
    assert.equal(clamav.healthcheck.timeout, "5s");
    assert.equal(clamav.healthcheck.retries, 3);
    console.log(
        "PASS: legacy/asymmetric key signatures, opaque-key checksums, prefix URLs, public-key separation, 0600/non-overwrite files, Compose mounts, private network/Auth boundaries and fast-start/30s healthchecks.",
    );
} finally {
    rmSync(directory, {recursive: true, force: true});
}
