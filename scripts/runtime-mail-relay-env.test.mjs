/** Test the existing-install relay migration with fictional private env files and no host changes. */
import assert from "node:assert/strict";
import {chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync,} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {migrateMailRelayEnvironment} from "../deploy/hostinger/selfhost/migrate-mail-relay-env.mjs";
import {readPrivateFixture} from "./testing/read-private-fixture.mjs";

function withPrivateEnvironment(run) {
    const directory = mkdtempSync(join(tmpdir(), "mail-relay-migration-"));
    const envFile = join(directory, "selfhost.env");
    const original = [
        "SERVICE_ROLE_KEY='fictional-service-role-key'",
        "SUPABASE_PUBLIC_URL='https://cms.example.invalid/backend'",
        "SITE_URL='https://cms.example.invalid'",
        "POSTGRES_PASSWORD='fictional-database-password'",
        "SMTP_HOST='smtp.legacy.example.invalid'",
        "SMTP_PORT='465'",
        "SMTP_USER='legacy@example.invalid'",
        "SMTP_PASS='fictional-legacy-provider-secret'",
        "",
    ].join("\n");
    writeFileSync(envFile, original, {mode: 0o600});
    chmodSync(envFile, 0o600);
    try {
        run({directory, envFile, original});
    } finally {
        rmSync(directory, {recursive: true, force: true});
    }
}

test("dry-run writes nothing, and apply preserves old SMTP credentials in a private backup", () => {
    withPrivateEnvironment(({directory, envFile, original}) => {
        const dryRun = migrateMailRelayEnvironment(envFile, {requireRoot: false});
        assert.equal(dryRun.changed, true);
        assert.equal(readFileSync(envFile, "utf8"), original);
        assert.equal(existsSync(`${envFile}.notification.env`), false);
        assert.equal(existsSync(`${envFile}.pre-mail-relay`), false);

        const applied = migrateMailRelayEnvironment(envFile, {
            apply: true,
            requireRoot: false,
        });
        const updated = readPrivateFixture(envFile).toString("utf8"),
            worker = readPrivateFixture(applied.notificationPath).toString("utf8"),
            backup = readPrivateFixture(`${envFile}.pre-mail-relay`).toString("utf8");
        assert.equal(backup, original);
        assert(updated.includes("PORTAL_AUTH_SMTP_HOST='mail-relay'"));
        assert(updated.includes("PORTAL_AUTH_SMTP_PORT='2525'"));
        assert(updated.includes("SMTP_ADMIN_EMAIL='no-reply@example.invalid'"));
        assert(updated.includes("PORTAL_AUTH_SMTP_USER='" + /MAIL_RELAY_USERNAME='([^']+)'/.exec(updated)[1] + "'"));
        assert(updated.includes("PORTAL_AUTH_SMTP_PASS='" + /MAIL_RELAY_PASSWORD='([^']+)'/.exec(updated)[1] + "'"));
        assert(backup.includes("fictional-legacy-provider-secret"));
        assert(updated.includes("SMTP_HOST='smtp.legacy.example.invalid'"));
        assert(updated.includes("SMTP_PORT='465'"));
        assert(updated.includes("PORTAL_MAIL_RELAY_URL='http://mail-relay:8080'"));

        assert(worker.includes("PORTAL_NOTIFICATION_MAIL_ENABLED='false'"));
        assert(worker.includes("PORTAL_NOTIFICATION_SERVICE_KEY='fictional-service-role-key'"));
        assert(worker.includes("PORTAL_NOTIFICATION_SMTP_PORT='2526'"));

        const repeated = migrateMailRelayEnvironment(envFile, {
            apply: true,
            requireRoot: false,
        });
        assert.equal(repeated.changed, false);
        assert.equal(readPrivateFixture(envFile).toString("utf8"), updated);
        assert.equal(readPrivateFixture(`${envFile}.pre-mail-relay`).toString("utf8"), original);
        assert.equal(existsSync(join(directory, "selfhost.env.pre-mail-relay.pre-mail-relay")), false);
    });
});

test("incomplete relay values, mismatched worker secrets and symlinks fail before server mutation", () => {
    withPrivateEnvironment(({envFile, original}) => {
        writeFileSync(envFile, original + "MAIL_RELAY_USERNAME='relay-incomplete@internal.invalid'\n");
        chmodSync(envFile, 0o600);
        assert.throws(
            () => migrateMailRelayEnvironment(envFile, {apply: true, requireRoot: false}),
            /incomplete/,
        );
        assert(!existsSync(`${envFile}.notification.env`));
    });
    withPrivateEnvironment(({envFile, original}) => {
        writeFileSync(
            `${envFile}.notification.env`,
            "PORTAL_NOTIFICATION_MAIL_ENABLED='false'\nPORTAL_NOTIFICATION_SERVICE_KEY='wrong-secret'\n",
            {mode: 0o600},
        );
        assert.throws(
            () => migrateMailRelayEnvironment(envFile, {apply: true, requireRoot: false}),
            /does not match/,
        );
        assert.equal(readFileSync(envFile, "utf8"), original);
    });
    withPrivateEnvironment(({directory, envFile}) => {
        const target = join(directory, "target.env");
        writeFileSync(target, "fictional", {mode: 0o600});
        symlinkSync(target, envFile + ".link");
        assert.throws(
            () => migrateMailRelayEnvironment(envFile + ".link", {requireRoot: false}),
            /symlinked/,
        );
    });
});
