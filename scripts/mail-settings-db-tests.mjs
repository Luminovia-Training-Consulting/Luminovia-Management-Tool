/** Isolated PostgreSQL authorization and Vault tests for SMTP/IMAP Administration; never contacts a provider. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import {portalOpenApi} from "../src/features/developer-api/contract.ts";
import {quoteSql as q, withTestDatabase} from "./testing/database.mjs";

let checks = 0;

/** Count one result only after every database assertion in its group succeeds. */
async function check(name, run) {
    await run();
    checks++;
    console.log(`PASS ${name}`);
}

await withTestDatabase("mail_settings_test", async ({sql, actor}) => {
    const admin = randomUUID(), manager = randomUUID(), lecturer = randomUUID(), client = randomUUID();
    await sql(
        `insert into auth.users(id,email) values('${admin}','admin@example.invalid'),('${manager}','manager@example.invalid'),('${lecturer}','lecturer@example.invalid'),('${client}','client@example.invalid');insert into public.user_roles(user_id,role) values('${admin}','admin'),('${manager}','management'),('${lecturer}','lecturer'),('${client}','client');`,
    );
    const {paths} = portalOpenApi("https://portal.example.invalid");
    const mailPaths = ["get_mail_configuration", "save_mail_configuration", "queue_mail_connection_test"];
    const mailResponses = new Map(mailPaths.map((name) => [
        name,
        z.fromJSONSchema(paths[`/rest/v1/rpc/${name}`].post.responses["200"].content["application/json"].schema),
    ]));
    /** Run one business RPC as a fixture identity, preserving the auth.jwt and RLS boundary. */
    const rpc = (who, name, args = []) =>
        actor(
            who,
            `select to_jsonb(public.${name}(${args
                .map((value) =>
                    value === null
                        ? "null"
                        : typeof value === "boolean" || typeof value === "number"
                            ? String(value)
                            : q(typeof value === "object" ? JSON.stringify(value) : value),
                )
                .join(",")}))`,
        ).then((value) => {
            const payload = JSON.parse(value);
            const response = mailResponses.get(name);
            return response ? response.parse(payload) : payload;
        });
    /** Exercise the relay-only public wrapper with a fictional signed service-role claim. */
    const serviceRpc = (name, args = []) =>
        sql(
            `begin;set local role service_role;set local request.jwt.claims=${q(JSON.stringify({role: "service_role"}))};select to_jsonb(public.${name}(${args
                .map((value) =>
                    value === null
                        ? "null"
                        : typeof value === "boolean" || typeof value === "number"
                            ? String(value)
                            : q(typeof value === "object" ? JSON.stringify(value) : value),
                )
                .join(",")}));commit;`,
        ).then((value) => JSON.parse(value));

    await check(
        "Mail settings are default-off, admin-only and never return stored credentials",
        async () => {
            const initial = await rpc(admin, "get_mail_configuration");
            assert.equal(initial.version, 0);
            assert.equal(initial.smtp.enabled, false);
            assert.equal(initial.smtp.credentials_configured, false);
            assert.equal(initial.imap.enabled, false);
            assert.equal("password" in initial.smtp, false);
            assert.equal("username" in initial.smtp, false);
            await assert.rejects(rpc(manager, "get_mail_configuration"), /42501/);
            await assert.rejects(rpc(lecturer, "get_mail_configuration"), /42501/);
            await assert.rejects(
                rpc(admin, "get_mail_delivery_transport"),
                /42501/,
            );
        },
    );

    const smtp = {
        enabled: true,
        host: "smtp.example.com",
        port: 2525,
        security: "starttls",
        sender_email: "no-reply@example.com",
        sender_name: "Fictional Portal",
        username: "fictional-smtp-account",
        password: "Fictional-Provider-Password-123!",
    };
    const imap = {
        enabled: false,
        host: "imap.example.com",
        port: 993,
        security: "implicit_tls",
        username: "",
        password: "",
    };
    let testId = "";

    await check("Non-admin roles cannot read or change SMTP settings", async () => {
        for (const who of [manager, lecturer, client]) {
            await assert.rejects(rpc(who, "get_mail_configuration"), /42501/);
            await assert.rejects(rpc(who, "save_mail_configuration", [0, smtp, imap]), /42501/);
            await assert.rejects(rpc(who, "queue_mail_connection_test", ["smtp"]), /42501/);
        }
        assert.equal((await rpc(admin, "get_mail_configuration")).version, 0);
    });

    await check(
        "SMTP settings store Vault credentials with optimistic versioning and no secret readback",
        async () => {
            const saved = await rpc(admin, "save_mail_configuration", [0, smtp, imap]);
            assert.equal(saved.version, 1);
            assert.equal(saved.smtp.enabled, true);
            assert.equal(saved.smtp.port, 2525);
            assert.equal(saved.smtp.security, "starttls");
            assert.equal(saved.smtp.credentials_configured, true);
            assert.equal("username" in saved.smtp, false);
            assert.equal("password" in saved.smtp, false);
            assert.equal(JSON.stringify(saved).includes(smtp.password), false);
            await assert.rejects(
                rpc(manager, "save_mail_configuration", [1, smtp, imap]),
                /42501/,
            );
            await assert.rejects(
                rpc(admin, "save_mail_configuration", [1, null, imap]),
                /22023/,
            );
            await assert.rejects(
                rpc(admin, "save_mail_configuration", [0, smtp, imap]),
                /PT409/,
            );
            await assert.rejects(
                rpc(admin, "save_mail_configuration", [1, {...smtp, extra: "ignored"}, imap]),
                /22023/,
            );
            await assert.rejects(
                rpc(
                    admin,
                    "save_mail_configuration",
                    [1, {...smtp, host: "127.0.0.1"}, imap],
                ),
                /22023/,
            );
            await assert.rejects(
                rpc(
                    admin,
                    "save_mail_configuration",
                    [1, {...smtp, port: 65536}, imap],
                ),
                /22023/,
            );
            await assert.rejects(
                rpc(admin, "get_mail_delivery_transport"),
                /42501/,
            );
            const transport = await serviceRpc("get_mail_delivery_transport");
            assert.equal(transport.enabled, true);
            assert.equal(transport.host, smtp.host);
            assert.equal(transport.username, smtp.username);
            assert.equal(transport.password, smtp.password);
        },
    );

    await check(
        "Connection tests are version-bound, auditable and service-role-only",
        async () => {
            testId = await rpc(admin, "queue_mail_connection_test", ["smtp"]);
            assert.match(testId, /^[0-9a-f-]{36}$/i);
            await assert.rejects(
                rpc(manager, "queue_mail_connection_test", ["smtp"]),
                /42501/,
            );
            await assert.rejects(
                rpc(admin, "queue_mail_connection_test", ["imap"]),
                /22023/,
            );
            await assert.rejects(
                rpc(admin, "queue_mail_connection_test", [null]),
                /22023/,
            );
            await assert.rejects(
                rpc(admin, "claim_mail_connection_test", [testId]),
                /42501/,
            );
            const credentials = await serviceRpc("claim_mail_connection_test", [testId]);
            assert.equal(credentials.status, "running");
            assert.equal(credentials.protocol, "smtp");
            assert.equal(credentials.username, smtp.username);
            assert.equal(credentials.password, smtp.password);
            await assert.rejects(
                serviceRpc("complete_mail_connection_test", [testId, false, null]),
                /22023/,
            );
            assert.equal(
                await serviceRpc("complete_mail_connection_test", [testId, true, null]),
                true,
            );
            const saved = await rpc(admin, "get_mail_configuration");
            assert.equal(saved.smtp.last_test.status, "succeeded");
            const audits = await sql(
                `select count(*) from private.mail_configuration_audit where actor_id='${admin}'`,
            );
            assert(Number(audits) >= 3);
        },
    );
});

console.log(`PASS: ${checks} isolated mail transport database groups.`);
