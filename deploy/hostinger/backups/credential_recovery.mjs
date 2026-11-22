/**
 * Check restored database/Auth credentials against captured configuration. Use secrets only for comparison, never in results or diagnostics.
 */
import assert from "node:assert/strict";
import {createHash, createHmac, pbkdf2Sync, timingSafeEqual,} from "node:crypto";
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";

// Quote a SQL text value only; object identifiers need a separate quoting path.
const literal = (s) => "'" + s.replaceAll("'", "''") + "'";

// Parse each captured environment with the same strict, non-evaluating reader.
async function readRecoveredEnvironment(temporary, path) {
    const environment = {};
    const contents = await readFile(resolve(temporary, "filesystem", path), "utf8");
    for (const line of contents.split(/\r?\n/)) {
        if (!line || line.startsWith("#")) continue;
        const match = /^([A-Z][A-Z0-9_]*)='([^'\r\n\0]*)'$/.exec(line);
        assert(
            match && !Object.hasOwn(environment, match[1]),
            "Invalid private recovered environment format.",
        );
        environment[match[1]] = match[2];
    }
    return environment;
}

// Reconstruct SCRAM proof from the captured password and compare only derived keys.
export function verifiesScram(password, encoded) {
    const match =
        /^SCRAM-SHA-256\$(\d+):([A-Za-z0-9+/=]+)\$([A-Za-z0-9+/=]+):([A-Za-z0-9+/=]+)$/.exec(
            encoded ?? "",
        );
    assert(match, "The captured database credential must use SCRAM-SHA-256.");
    const iterations = Number(match[1]);
    assert(iterations >= 4096 && iterations <= 1000000);
    const salted = pbkdf2Sync(
        password,
        Buffer.from(match[2], "base64"),
        iterations,
        32,
        "sha256",
    );
    const client = createHmac("sha256", salted).update("Client Key").digest();
    const stored = createHash("sha256").update(client).digest();
    const server = createHmac("sha256", salted).update("Server Key").digest();
    const expectedStored = Buffer.from(match[3], "base64"),
        expectedServer = Buffer.from(match[4], "base64");
    return (
        stored.length === expectedStored.length &&
        server.length === expectedServer.length &&
        timingSafeEqual(stored, expectedStored) &&
        timingSafeEqual(server, expectedServer)
    );
}

// Verify expected service/Auth credentials in the restored data without printing passwords or hashes.
export async function verifyRecoveredCredentials(
    database,
    temporary,
    catalog,
    ledgerPath,
) {
    const environmentFile = catalog.files.find(
        (f) => f.path === "opt/luminovia-portal/private/selfhost.env",
    );
    if (!environmentFile) {
        assert(
            !ledgerPath,
            "An application credential ledger requires the actual recovered private environment.",
        );
        return {
            applicable: false,
            reason:
                "This disposable fixture has no deployed environment or Auth accounts.",
        };
    }
    const environment = await readRecoveredEnvironment(temporary, environmentFile.path);
    assert(environment.POSTGRES_PASSWORD && environment.SERVICE_ROLE_KEY);
    const notificationFile = catalog.files.find(
        (f) =>
            f.path ===
            "opt/luminovia-portal/private/selfhost.env.notification.env",
    );
    let notificationWorkerEnvironmentRestored = false;
    if (notificationFile) {
        const notification = await readRecoveredEnvironment(temporary, notificationFile.path);
        // Assert boolean comparisons so failures cannot carry either credential.
        assert(
            notification.PORTAL_NOTIFICATION_SERVICE_KEY === environment.SERVICE_ROLE_KEY,
            "The recovered mail worker must use the recovered service key.",
        );
        assert(
            Boolean(environment.MAIL_RELAY_USERNAME) &&
                notification.PORTAL_NOTIFICATION_SMTP_USERNAME === environment.MAIL_RELAY_USERNAME,
            "The recovered mail worker must use this installation's relay username.",
        );
        assert(
            Boolean(environment.MAIL_RELAY_PASSWORD) &&
                notification.PORTAL_NOTIFICATION_SMTP_PASSWORD === environment.MAIL_RELAY_PASSWORD,
            "The recovered mail worker must use this installation's relay password.",
        );
        assert(notification.PORTAL_NOTIFICATION_SMTP_PORT === "2526", "The recovered mail worker must use the internal relay port.");
        assert(["true", "false"].includes(notification.PORTAL_NOTIFICATION_MAIL_ENABLED));
        notificationWorkerEnvironmentRestored = true;
    }
    const roles = JSON.parse(
        await database.sql(
            "select json_object_agg(rolname,rolpassword) from pg_authid where rolname in('postgres','supabase_admin','authenticator','supabase_auth_admin','supabase_storage_admin');",
        ),
    );
    assert.equal(Object.keys(roles).length, 5);
    for (const password of Object.values(roles))
        assert(
            verifiesScram(environment.POSTGRES_PASSWORD, password),
            "Recovered runtime database password does not authenticate against the recovered role hash.",
        );
    const result = {
        applicable: true,
        recoveredEnvironmentAuthenticatesFiveRuntimeDatabaseRoles: true,
        notificationWorkerEnvironmentRestored,
        savedFictionalAuthPasswordsVerified: 0,
    };
    if (ledgerPath) {
        const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
        assert.equal(
            ledger.backend.serviceRoleFingerprint,
            createHash("sha256").update(environment.SERVICE_ROLE_KEY).digest("hex"),
        );
        for (const name of ["admin", "lecturer", "peer"]) {
            const account = ledger.accounts[name];
            assert(
                account?.complete &&
                typeof account.password === "string" &&
                /^[0-9a-f-]{36}$/.test(account.id),
            );
            const valid = await database.sql(
                "select count(*) from auth.users where id=" +
                literal(account.id) +
                "::uuid and email=" +
                literal(account.email) +
                " and encrypted_password=extensions.crypt(" +
                literal(account.password) +
                ",encrypted_password);",
            );
            assert.equal(
                valid,
                "1",
                "A saved fictional application password does not match its recovered Auth user.",
            );
            result.savedFictionalAuthPasswordsVerified++;
        }
    }
    return result;
}
