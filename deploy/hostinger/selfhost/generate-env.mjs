#!/usr/bin/env node
/**
 * Generate private configuration for authorized selfhost development. Keep the public publishable key separate from server administration/signing secrets; create output files exclusively and privately.
 */
/**
 * Generate a NEW private self-host configuration. Never prints credential values.
 * Key formats match the vendored official generate-keys/add-new-auth-keys scripts.
 */
import {createHash, createHmac, generateKeyPairSync, randomBytes, randomUUID, sign,} from "node:crypto";
import {chmodSync, closeSync, existsSync, mkdirSync, openSync, unlinkSync, writeFileSync,} from "node:fs";
import {dirname, isAbsolute, resolve} from "node:path";
import {fileURLToPath} from "node:url";

// Build public/private configuration from validated parameters and fresh cryptographic values.
export function createConfiguration(options) {
    const portal = checkedUrl(options.portalOrigin, true);
    const api = checkedUrl(options.apiOrigin, false);
    const dataDirectory = options.dataDirectory;
    const network = options.network ?? "luminovia-portal-backend";
    if (
        !isAbsolute(dataDirectory ?? "") ||
        !/^\/[A-Za-z0-9/_-]+$/.test(dataDirectory)
    ) {
        throw new Error(
            "Data directory must be an absolute path without shell/control characters.",
        );
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$/.test(network))
        throw new Error("Invalid Docker network name.");
    const jwtSecret = randomBytes(48).toString("base64url");
    const mailRelayUsername = `relay-${randomBytes(12).toString("hex")}@internal.invalid`;
    const mailRelayPassword = randomBytes(32).toString("base64url");
    const mailRelayControlToken = randomBytes(32).toString("base64url");
    const {privateKey} = generateKeyPairSync("ec", {namedCurve: "P-256"});
    const jwk = privateKey.export({format: "jwk"});
    const kid = randomUUID();
    const oct = {
        kty: "oct",
        k: Buffer.from(jwtSecret).toString("base64url"),
        alg: "HS256",
    };
    const publicEc = {
        kty: "EC",
        kid,
        use: "sig",
        key_ops: ["verify"],
        alg: "ES256",
        ext: true,
        crv: jwk.crv,
        x: jwk.x,
        y: jwk.y,
    };
    const privateEc = {...publicEc, key_ops: ["sign", "verify"], d: jwk.d};
    const iat = Math.floor(Date.now() / 1000);
    const payload = (role) => ({
        role,
        iss: "supabase",
        iat,
        exp: iat + 5 * 365 * 86400,
    });
    const encode = (value) =>
        Buffer.from(JSON.stringify(value)).toString("base64url");
    const legacy = (role) => {
        const data =
            encode({alg: "HS256", typ: "JWT"}) + "." + encode(payload(role));
        return (
            data +
            "." +
            createHmac("sha256", jwtSecret).update(data).digest("base64url")
        );
    };
    const asymmetric = (role) => {
        const data =
            encode({alg: "ES256", typ: "JWT", kid}) + "." + encode(payload(role));
        return (
            data +
            "." +
            sign("SHA256", Buffer.from(data), {
                key: privateKey,
                dsaEncoding: "ieee-p1363",
            }).toString("base64url")
        );
    };
    const opaque = (prefix) => {
        const intermediate =
            prefix + randomBytes(17).toString("base64url").slice(0, 22);
        const checksum = createHash("sha256")
            .update("supabase-self-hosted|" + intermediate)
            .digest("base64url")
            .slice(0, 8);
        return intermediate + "_" + checksum;
    };
    const publicUrl = api.href.replace(/\/$/, "");
    const portalOrigin = portal.origin;
    const verifyPath = api.pathname.replace(/\/$/, "") + "/auth/v1/verify";
    const configuration = {
        PORTAL_APP_ORIGIN: portalOrigin,
        PORTAL_MAIL_TEMPLATE_ORIGIN: portalOrigin,
        PORTAL_BACKEND_NETWORK: network,
        PORTAL_DATA_DIR: dataDirectory,
        PORTAL_INVITES_ENABLED: "true",
        PORTAL_TOTP_ENABLED: "false",
        PORTAL_TOTP_SECURITY_MAIL_ENABLED: "false",
        // Provision no intake credential implicitly; public Website activation is separate.
        PORTAL_WEBSITE_ENQUIRIES_ENABLED: "false",
        PORTAL_WEBSITE_ORIGIN: "",
        PORTAL_WEBSITE_PRIVACY_NOTICE_VERSION: "",
        PORTAL_WEBSITE_INTEGRATION_TOKEN: "",
        PORTAL_FUNCTIONS_MEMORY_LIMIT: "1280m",
        PORTAL_MAIL_RELAY_URL: "http://mail-relay:8080",
        PORTAL_MAIL_RELAY_CONTROL_TOKEN: mailRelayControlToken,
        SUPABASE_PUBLIC_URL: publicUrl,
        API_EXTERNAL_URL: publicUrl + "/auth/v1",
        SITE_URL: portalOrigin,
        ADDITIONAL_REDIRECT_URLS:
            portalOrigin + "/auth/callback," + portalOrigin + "/auth/password",
        POSTGRES_HOST: "db",
        POSTGRES_PORT: "5432",
        POSTGRES_DB: "postgres",
        POSTGRES_PASSWORD: randomBytes(32).toString("hex"),
        JWT_SECRET: jwtSecret,
        JWT_EXPIRY: "3600",
        ANON_KEY: legacy("anon"),
        SERVICE_ROLE_KEY: legacy("service_role"),
        SUPABASE_PUBLISHABLE_KEY: opaque("sb_publishable_"),
        SUPABASE_SECRET_KEY: opaque("sb_secret_"),
        ANON_KEY_ASYMMETRIC: asymmetric("anon"),
        SERVICE_ROLE_KEY_ASYMMETRIC: asymmetric("service_role"),
        JWT_KEYS: JSON.stringify([privateEc, oct]),
        JWT_JWKS: JSON.stringify({keys: [publicEc, oct]}),
        SECRET_KEY_BASE: randomBytes(48).toString("base64"),
        REALTIME_DB_ENC_KEY: randomBytes(8).toString("hex"),
        DASHBOARD_USERNAME: "disabled",
        DASHBOARD_PASSWORD: randomBytes(32).toString("hex"),
        PGRST_DB_SCHEMAS: "public,graphql_public",
        PGRST_DB_MAX_ROWS: "1000",
        PGRST_DB_EXTRA_SEARCH_PATH: "public,extensions",
        MAIL_RELAY_USERNAME: mailRelayUsername,
        MAIL_RELAY_PASSWORD: mailRelayPassword,
        SMTP_ADMIN_EMAIL: "no-reply@example.invalid",
        SMTP_HOST: "mail-relay",
        SMTP_PORT: "2525",
        SMTP_USER: mailRelayUsername,
        SMTP_PASS: mailRelayPassword,
        SMTP_SENDER_NAME: "Luminovia Portal",
        MAILER_URLPATHS_INVITE: verifyPath,
        MAILER_URLPATHS_CONFIRMATION: verifyPath,
        MAILER_URLPATHS_RECOVERY: verifyPath,
        MAILER_URLPATHS_EMAIL_CHANGE: verifyPath,
        GLOBAL_S3_BUCKET: "portal-storage",
        STORAGE_TENANT_ID: "luminovia-portal",
        REGION: "local",
        S3_PROTOCOL_ACCESS_KEY_ID: randomBytes(16).toString("hex"),
        S3_PROTOCOL_ACCESS_KEY_SECRET: randomBytes(32).toString("hex"),
    };
    return {
        server: configuration,
        public: {
            VITE_SUPABASE_URL: publicUrl,
            VITE_SUPABASE_PUBLISHABLE_KEY: configuration.SUPABASE_PUBLISHABLE_KEY,
        },
        notification: {
            PORTAL_NOTIFICATION_MAIL_ENABLED: "false",
            PORTAL_NOTIFICATION_API_URL: api.href.replace(/\/$/, ""),
            PORTAL_NOTIFICATION_APP_ORIGIN: portalOrigin,
            PORTAL_NOTIFICATION_SERVICE_KEY: configuration.SERVICE_ROLE_KEY,
            PORTAL_NOTIFICATION_SMTP_USERNAME: mailRelayUsername,
            PORTAL_NOTIFICATION_SMTP_PASSWORD: mailRelayPassword,
            PORTAL_NOTIFICATION_SMTP_PORT: "2526",
            PORTAL_NOTIFICATION_BATCH: "10",
            PORTAL_NOTIFICATION_TIMEOUT_SECONDS: "15",
        },
    };
}

// Limit origin/API URLs to the expected protocols and permitted path structures.
function checkedUrl(value, rootOnly) {
    let url;
    try {
        url = new URL(value);
    } catch {
        throw new Error("Expected an absolute HTTPS URL.");
    }
    if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        !/^\/[A-Za-z0-9/_-]*$/.test(url.pathname) ||
        (rootOnly && url.pathname !== "/")
    ) {
        throw new Error(
            "Use HTTPS URLs without credentials, queries or fragments; frontend must be at its origin root.",
        );
    }
    return url;
}

// Create configuration files exclusively with private permissions; never overwrite existing secrets.
export function writeConfiguration(output, configuration) {
    const destination = resolve(output);
    const publicDestination = destination + ".public.env";
    const notificationDestination = destination + ".notification.env";
    if (
        existsSync(destination) ||
        existsSync(publicDestination) ||
        existsSync(notificationDestination)
    )
        throw new Error("Refusing to overwrite existing configuration.");
    mkdirSync(dirname(destination), {recursive: true, mode: 0o700});
    const serialize = (values) =>
        Object.entries(values)
            .map(([key, value]) => {
                if (typeof value !== "string" || /['\r\n\0]/.test(value))
                    throw new Error("Unsafe environment value.");
                return key + "='" + value + "'";
            })
            .join("\n") + "\n";
    const serverText = serialize(configuration.server);
    const publicText = serialize(configuration.public);
    const notificationText = serialize(configuration.notification);
    const created = [];
    try {
        for (const [path, content] of [
            [destination, serverText],
            [publicDestination, publicText],
            [notificationDestination, notificationText],
        ]) {
            const descriptor = openSync(path, "wx", 0o600);
            created.push(path);
            try {
                writeFileSync(descriptor, content);
            } finally {
                closeSync(descriptor);
            }
            chmodSync(path, 0o600);
        }
    } catch {
        for (const path of created) unlinkSync(path);
        throw new Error("Could not safely create private configuration files.");
    }
    return [destination, publicDestination, notificationDestination];
}

if (
    process.argv[1] &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
    try {
        const args = process.argv.slice(2);
        if (args.length === 1 && args[0] === "--help") {
            console.log(
                "Usage: node generate-env.mjs --output PRIVATE_FILE --portal-origin HTTPS_ORIGIN --api-origin HTTPS_API_BASE --data-dir ABSOLUTE_DATA_DIR [--network DOCKER_NETWORK]",
            );
        } else {
            if (args.length % 2)
                throw new Error("Arguments require explicit values.");
            const parsed = {};
            const allowed = new Set([
                "--output",
                "--portal-origin",
                "--api-origin",
                "--data-dir",
                "--network",
            ]);
            for (let index = 0; index < args.length; index += 2) {
                if (!allowed.has(args[index]) || parsed[args[index]])
                    throw new Error("Unknown or repeated argument.");
                parsed[args[index]] = args[index + 1];
            }
            if (!parsed["--output"])
                throw new Error("A private output filename is required.");
            const configuration = createConfiguration({
                portalOrigin: parsed["--portal-origin"],
                apiOrigin: parsed["--api-origin"],
                dataDirectory: parsed["--data-dir"],
                network: parsed["--network"],
            });
            const paths = writeConfiguration(parsed["--output"], configuration);
            console.log(
                "Created private server, notification-worker and public-only build configuration files (0600); no credential values printed.",
            );
            for (const path of paths) console.log(path);
        }
    } catch (error) {
        console.error(
            error instanceof Error
                ? error.message
                : "Configuration generation failed.",
        );
        process.exitCode = 1;
    }
}
