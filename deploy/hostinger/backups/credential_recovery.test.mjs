/** Validate private-environment recovery before database access using only fictional credentials. */
import assert from "node:assert/strict";
import {mkdir, mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import test from "node:test";
import {inspect} from "node:util";
import {verifyRecoveredCredentials} from "./credential_recovery.mjs";

const serverPath = "opt/luminovia-portal/private/selfhost.env";
const workerPath = serverPath + ".notification.env";

test("recovery requires the worker's actual relay credentials and keeps mismatches private", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "luminovia-recovered-credentials-"));
    const server = join(temporary, "filesystem", serverPath);
    const worker = join(temporary, "filesystem", workerPath);
    const catalog = {files: [{path: serverPath}, {path: workerPath}]};
    const database = {sql: () => assert.fail("Invalid credentials must fail before querying the database.")};
    try {
        await mkdir(dirname(server), {recursive: true, mode: 0o700});
        const serverConfig =
            "POSTGRES_PASSWORD='fictional-database-password'\n" +
            "SERVICE_ROLE_KEY='fictional-server-key'\n";
        await writeFile(server, serverConfig, {mode: 0o600});
        await writeFile(worker, "PORTAL_NOTIFICATION_SERVICE_KEY='fictional-worker-key'\n", {mode: 0o600});
        await assert.rejects(
            verifyRecoveredCredentials(database, temporary, catalog),
            (error) => {
                assert.match(error.message, /recovered service key/);
                assert.doesNotMatch(inspect(error), /fictional-server-key|fictional-worker-key/);
                return true;
            },
        );

        await writeFile(
            worker,
            "PORTAL_NOTIFICATION_SERVICE_KEY='fictional-server-key'\n" +
                "PORTAL_NOTIFICATION_SMTP_PORT='2526'\n" +
                "PORTAL_NOTIFICATION_MAIL_ENABLED='false'\n",
        );
        await assert.rejects(
            verifyRecoveredCredentials(database, temporary, catalog),
            /relay username/,
        );

        await writeFile(server, serverConfig + "SERVICE_ROLE_KEY='fictional-duplicate-key'\n");
        await assert.rejects(
            verifyRecoveredCredentials(database, temporary, catalog),
            /Invalid private recovered environment format/,
        );
    } finally {
        await rm(temporary, {recursive: true, force: true});
    }
});
