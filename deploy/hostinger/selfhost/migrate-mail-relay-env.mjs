#!/usr/bin/env node
/** Add relay credentials to an existing private self-host env without replacing retained database/Auth secrets. */
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {
    chmodSync,
    closeSync,
    existsSync,
    fsyncSync,
    lstatSync,
    openSync,
    readFileSync,
    renameSync,
    unlinkSync,
    writeFileSync,
} from "node:fs";
import {dirname, resolve} from "node:path";

const relayKeys = [
    "MAIL_RELAY_USERNAME",
    "MAIL_RELAY_PASSWORD",
    "PORTAL_MAIL_RELAY_CONTROL_TOKEN",
];

/** Persist a newly created private directory entry as well as its file contents. */
function syncDirectory(path) {
    const descriptor = openSync(dirname(path), "r");
    try {
        fsyncSync(descriptor);
    } finally {
        closeSync(descriptor);
    }
}

/** Parse only the generator's single-quoted `KEY='value'` format; never shell-evaluate an env file. */
function parseEnvironment(contents) {
    const values = {};
    for (const line of contents.split(/\r?\n/)) {
        if (!line || line.startsWith("#")) continue;
        const match = /^([A-Z][A-Z0-9_]*)='([^'\r\n\0]*)'$/.exec(line);
        assert(match && !(match[1] in values), "Invalid or duplicate private environment entry.");
        values[match[1]] = match[2];
    }
    return values;
}

/** Reject symlinks and require the root-owned private files/directories used by the installer. */
function assertPrivatePath(path, {directory = false, requireRoot = false} = {}) {
    const info = lstatSync(path);
    assert(!info.isSymbolicLink(), "Refusing symlinked private configuration.");
    assert(directory ? info.isDirectory() : info.isFile(), "Unexpected private configuration file type.");
    assert.equal(info.mode & 0o077, 0, "Private configuration permissions must exclude group and other.");
    if (requireRoot) assert.equal(info.uid, 0, "Apply the host migration as root.");
    return info;
}

/** Validate public HTTPS bases before using them in the generated worker environment. */
function secureHttps(value, rootOnly) {
    const url = new URL(value ?? "");
    assert(
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        !url.pathname.includes("..") &&
        (!rootOnly || url.pathname === "/"),
        "The existing self-host environment has invalid public URLs.",
    );
    return url.href.replace(/\/$/, "");
}

/** Create a new private file with exclusive creation and durable mode-0600 bytes. */
function writeExclusive(path, contents) {
    const descriptor = openSync(path, "wx", 0o600);
    try {
        writeFileSync(descriptor, contents);
        fsyncSync(descriptor);
    } finally {
        closeSync(descriptor);
    }
    chmodSync(path, 0o600);
    syncDirectory(path);
}

/** Atomically replace only the inspected server file, retaining an exact private pre-migration copy. */
function updateEnvironmentAtomically(path, original, updated, info) {
    const backup = `${path}.pre-mail-relay`;
    if (existsSync(backup)) {
        assertPrivatePath(backup, {requireRoot: process.getuid?.() === 0});
        assert.equal(readFileSync(backup, "utf8"), original, "Existing mail migration backup does not match.");
    } else {
        writeExclusive(backup, original);
    }
    const current = assertPrivatePath(path, {requireRoot: process.getuid?.() === 0});
    assert.equal(current.dev, info.dev, "The server environment changed during migration.");
    assert.equal(current.ino, info.ino, "The server environment changed during migration.");
    assert.equal(
        readFileSync(path, "utf8"),
        original,
        "The server environment changed during migration.",
    );
    const temporary = `${path}.${process.pid}.mail-relay.tmp`;
    try {
        writeExclusive(temporary, updated);
        renameSync(temporary, path);
        chmodSync(path, 0o600);
        syncDirectory(path);
    } catch (error) {
        if (existsSync(temporary)) unlinkSync(temporary);
        throw error;
    }
    return backup;
}

/** Plan or apply only the additive relay configuration; existing provider/database secrets are preserved byte-for-byte. */
export function migrateMailRelayEnvironment(envFile, {apply = false, requireRoot = apply} = {}) {
    const path = resolve(envFile);
    const directory = dirname(path);
    assertPrivatePath(directory, {directory: true, requireRoot});
    const fileInfo = assertPrivatePath(path, {requireRoot});
    assert(fileInfo.size > 0 && fileInfo.size <= 1024 * 1024, "Private server environment has an invalid size.");
    const original = readFileSync(path, "utf8");
    const existing = parseEnvironment(original);
    for (const required of [
        "SERVICE_ROLE_KEY",
        "SUPABASE_PUBLIC_URL",
        "SITE_URL",
    ])
        assert(existing[required], `Existing private environment is missing ${required}.`);
    const relayPresent = relayKeys.map((key) => Boolean(existing[key]));
    assert(
        relayPresent.every(Boolean) || relayPresent.every((present) => !present),
        "Existing relay settings are incomplete; inspect them before migration.",
    );
    const relay = relayPresent[0]
        ? Object.fromEntries(relayKeys.map((key) => [key, existing[key]]))
        : {
            MAIL_RELAY_USERNAME: `relay-${randomBytes(12).toString("hex")}@internal.invalid`,
            MAIL_RELAY_PASSWORD: randomBytes(32).toString("base64url"),
            PORTAL_MAIL_RELAY_CONTROL_TOKEN: randomBytes(32).toString("base64url"),
        };
    assert.match(relay.MAIL_RELAY_USERNAME, /^relay-[a-f0-9]{24}@internal\.invalid$/);
    assert(relay.MAIL_RELAY_PASSWORD.length >= 40);
    assert(relay.PORTAL_MAIL_RELAY_CONTROL_TOKEN.length >= 40);
    const serverUpdates = {
        ...relay,
        SMTP_HOST: "mail-relay",
        SMTP_PORT: "2525",
        SMTP_USER: relay.MAIL_RELAY_USERNAME,
        SMTP_PASS: relay.MAIL_RELAY_PASSWORD,
        SMTP_ADMIN_EMAIL: existing.SMTP_ADMIN_EMAIL || "no-reply@example.invalid",
    };
    const serverChanges = Object.entries(serverUpdates).filter(
        ([key, value]) => existing[key] !== value,
    );
    const updated = serverChanges.length
        ? (() => {
            const lines = original.split(/\r?\n/);
            for (const [key, value] of serverChanges) {
                const index = lines.findIndex((line) => line.startsWith(`${key}=`));
                const entry = `${key}='${value}'`;
                if (index < 0) lines.push(entry);
                else lines[index] = entry;
            }
            return lines.join("\n").replace(/\n*$/, "\n");
        })()
        : original;

    const notificationPath = `${path}.notification.env`;
    const notification = {
        PORTAL_NOTIFICATION_MAIL_ENABLED: "false",
        PORTAL_NOTIFICATION_API_URL: secureHttps(existing.SUPABASE_PUBLIC_URL, false),
        PORTAL_NOTIFICATION_APP_ORIGIN: secureHttps(existing.SITE_URL, true),
        PORTAL_NOTIFICATION_SERVICE_KEY: existing.SERVICE_ROLE_KEY,
        PORTAL_NOTIFICATION_SMTP_USERNAME: relay.MAIL_RELAY_USERNAME,
        PORTAL_NOTIFICATION_SMTP_PASSWORD: relay.MAIL_RELAY_PASSWORD,
        PORTAL_NOTIFICATION_SMTP_PORT: "2526",
        PORTAL_NOTIFICATION_BATCH: "10",
        PORTAL_NOTIFICATION_TIMEOUT_SECONDS: "15",
    };
    const notificationText =
        Object.entries(notification)
            .map(([key, value]) => `${key}='${value}'`)
            .join("\n") + "\n";
    if (existsSync(notificationPath)) {
        assertPrivatePath(notificationPath, {requireRoot});
        const currentNotification = parseEnvironment(readFileSync(notificationPath, "utf8"));
        for (const [key, value] of Object.entries(notification))
            if (key !== "PORTAL_NOTIFICATION_MAIL_ENABLED")
                assert.equal(currentNotification[key], value, "Existing worker configuration does not match relay settings.");
    }
    const backup = serverChanges.length ? `${path}.pre-mail-relay` : null;
    const changed = serverChanges.length > 0 || !existsSync(notificationPath);
    if (!apply || !changed)
        return {changed, serverPath: path, notificationPath, backupPath: backup};
    if (requireRoot) assert.equal(process.getuid?.(), 0, "Apply the host migration as root.");

    let workerCreated = false;
    try {
        if (!existsSync(notificationPath)) {
            writeExclusive(notificationPath, notificationText);
            workerCreated = true;
        }
        if (serverChanges.length)
            updateEnvironmentAtomically(path, original, updated, fileInfo);
    } catch (error) {
        if (workerCreated && existsSync(notificationPath)) unlinkSync(notificationPath);
        throw error;
    }
    return {changed: true, serverPath: path, notificationPath, backupPath: backup};
}

/** Make existing-install mutation explicit; dry-run is the default and never prints generated values. */
if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === "--help") {
        console.log("Usage: node migrate-mail-relay-env.mjs --env-file PRIVATE_SERVER_ENV [--apply]");
    } else {
        let envFile = "";
        let apply = false;
        for (let index = 0; index < args.length; index++) {
            if (args[index] === "--env-file" && !envFile && args[index + 1]) {
                envFile = args[++index];
            } else if (args[index] === "--apply" && !apply) {
                apply = true;
            } else {
                throw new Error("Invalid mail relay migration arguments.");
            }
        }
        assert(envFile, "A private server environment path is required.");
        try {
            const result = migrateMailRelayEnvironment(envFile, {apply});
            console.log(
                result.changed
                    ? apply
                        ? result.backupPath
                            ? "Private relay configuration added; the original server environment was preserved in a 0600 backup."
                            : "Disabled worker configuration added; the existing server environment was unchanged."
                        : "Dry run: relay credentials and a disabled worker file would be generated; no files were written or secret values printed."
                    : "Private relay configuration is already present; no files changed.",
            );
            if (apply) {
                console.log(result.serverPath);
                console.log(result.notificationPath);
                if (result.backupPath) console.log(result.backupPath);
            }
        } catch (error) {
            console.error(error instanceof Error ? error.message : "Mail relay migration failed.");
            process.exitCode = 1;
        }
    }
}