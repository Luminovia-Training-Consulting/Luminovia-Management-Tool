/** Scoped academy SMTP settings and single-use connection-test claims on isolated Vault. */
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { z } from "zod";
import { academyMailPaths } from "../src/features/developer-api/academy-mail-contract.ts";
import {
  configureAcademyCourseAccess,
  prepareAcademyInstallation,
} from "./academy-installation.mjs";
import { signAcademyLicence } from "./academy-licence.mjs";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

const smtp = {
  enabled: true,
  host: "smtp.example.com",
  port: 465,
  security: "implicit_tls",
  sender_email: "sender@example.com",
  sender_name: "Fictional Academy",
  username: "fixture@example.com",
  password: "Fictional relay fixture only",
};
const saveArgs = (version, imap = { enabled: false }) =>
  `${version},${q(JSON.stringify(smtp))},${q(JSON.stringify(imap))}`;

for (const edition of ["customer-self-hosted", "customer-managed"]) {
  await withTestDatabase("academy_mail", async ({ sql, actor }) => {
    const [admin, manager, learner, owner, unconfirmed] = Array.from(
      { length: 5 },
      randomUUID,
    );
    const now = Date.now();
    const date = (days) => new Date(now + days * 86_400_000).toISOString();
    const terms = {
      installation_id: randomUUID(),
      edition,
      release_commit: "bd".repeat(20),
      issued_at: date(-10),
      starts_at: date(-9),
      expires_at: date(2),
      grace_until: date(4),
      modules: ["lms"],
      limits: {
        seat_count: 25,
        storage_bytes: 1_000_000,
        api_requests_per_minute: 55,
      },
    };
    const key = generateKeyPairSync("ed25519");
    const options = {
      envelope: signAcademyLicence(terms, key.privateKey),
      publicKey: key.publicKey,
      expected: terms,
      now,
    };
    await prepareAcademyInstallation(options, sql);
    await configureAcademyCourseAccess({ ...options, enabled: true }, sql);
    const users = [
      [admin, "admin"],
      [manager, "management"],
      [learner, "participant"],
      [owner, "owner"],
      [unconfirmed, "admin"],
    ];
    await sql(`
      insert into auth.users(id,email,email_confirmed_at) values
        ${users.map(([id]) => `(${q(id)},${q(id + "@example.invalid")},${id === unconfirmed ? "null" : "now()"})`).join(",")};
      insert into public.user_roles(user_id,role) values
        ${users.map(([id, role]) => `(${q(id)},${q(role)})`).join(",")};`);

    const rpcSql = (name, args, method = "POST", path = name) => `
      set local request.path=${q("/rpc/" + path)};
      set local request.method=${q(method)};
      select public.require_portal_access();
      select to_jsonb(public.${name}(${args}))`;
    const rpc = async (who, name, args = "", method, path) => {
      const data = JSON.parse(await actor(who, rpcSql(name, args, method, path)));
      const schema = academyMailPaths["/rest/v1/rpc/" + name]?.post.responses["200"]
        .content["application/json"].schema;
      if (schema) z.fromJSONSchema(schema).parse(data);
      return data;
    };
    const service = (name, args = "", method, path) =>
      sql(`begin;set local role service_role;
        set local request.jwt.claims='{"role":"service_role"}';
        ${rpcSql(name, args, method, path)};commit;`).then(JSON.parse);
    const read = () => rpc(admin, "get_mail_configuration");
    const queue = () => rpc(admin, "queue_mail_connection_test", "'smtp'");
    const claim = (id) => service("claim_mail_connection_test", q(id));

    assert.equal((await read()).smtp.enabled, false);
    for (const who of [manager, learner, owner, unconfirmed]) {
      await assert.rejects(rpc(who, "get_mail_configuration"), /42501/);
      await assert.rejects(actor(who, "select public.get_mail_configuration()"), /42501/);
    }
    await assert.rejects(rpc(admin, "get_mail_configuration", "", "GET"), /42501/);
    await assert.rejects(
      rpc(admin, "get_mail_configuration", "", "POST", "get_mail_configuration_extra"),
      /42501/,
    );
    await assert.rejects(rpc(admin, "get_mail_delivery_transport"), /42501/);
    await assert.rejects(service("get_mail_configuration"), /42501/);
    await assert.rejects(service("get_mail_delivery_transport", "", "GET"), /42501/);
    await assert.rejects(
      rpc(admin, "save_mail_configuration", saveArgs(0, { enabled: true })),
      /42501/,
    );
    await assert.rejects(rpc(admin, "queue_mail_connection_test", "'imap'"), /42501/);

    const saved = await rpc(admin, "save_mail_configuration", saveArgs(0));
    assert.equal(saved.version, 1);
    assert.equal(saved.smtp.enabled, true);
    assert.equal(saved.smtp.credentials_configured, true);
    assert.equal("username" in saved.smtp || "password" in saved.smtp, false);
    await assert.rejects(rpc(admin, "save_mail_configuration", saveArgs(0)), /PT409/);
    const transport = await service("get_mail_delivery_transport");
    assert.equal(transport.username, smtp.username);
    assert.equal(transport.password, smtp.password);
    assert.equal(transport.sender_name, smtp.sender_name);
    const id = await queue();
    await assert.rejects(rpc(admin, "claim_mail_connection_test", q(id)), /42501/);
    const claimed = await claim(id);
    assert.equal(claimed.protocol, "smtp");
    assert.equal(claimed.password, smtp.password);
    assert.equal(
      await service("complete_mail_connection_test", `${q(id)},true,null`),
      true,
    );
    assert.deepEqual(await claim(id), {
      status: "failed",
      error_code: "configuration_changed",
    });
    assert.equal((await read()).smtp.last_test.status, "succeeded");

    const revokedTest = await queue();
    await sql(`delete from public.user_roles where user_id=${q(admin)} and role='admin';
      insert into public.user_roles(user_id,role) values(${q(admin)},'lecturer');`);
    assert.deepEqual(await claim(revokedTest), {
      status: "failed",
      error_code: "configuration_changed",
    });
    await assert.rejects(rpc(admin, "get_mail_configuration"), /42501/);
    await sql(`insert into public.user_roles(user_id,role) values(${q(admin)},'admin');`);
    const pendingAtGrace = await queue();
    const grace = {
      ...terms,
      issued_at: date(-8),
      starts_at: date(-7.5),
      expires_at: date(-1),
    };
    await sql(`select private.apply_verified_installation_licence(${q(JSON.stringify(grace))}::jsonb)`);
    assert.equal((await read()).smtp.enabled, true);
    assert.equal((await service("get_mail_delivery_transport")).enabled, true);
    await assert.rejects(rpc(admin, "save_mail_configuration", saveArgs(1)), /42501/);
    await assert.rejects(actor(admin, `select public.save_mail_configuration(${saveArgs(1)})`), /42501/);
    await assert.rejects(queue(), /42501/);
    assert.deepEqual(await claim(pendingAtGrace), {
      status: "failed",
      error_code: "configuration_changed",
    });
    const expired = {
      ...grace,
      issued_at: date(-7),
      starts_at: date(-6.5),
      grace_until: date(-0.5),
    };
    await sql(`select private.apply_verified_installation_licence(${q(JSON.stringify(expired))}::jsonb)`);
    await assert.rejects(read(), /42501/);
    assert.deepEqual(await service("get_mail_delivery_transport"), { enabled: false, version: 1 });
    console.log(`PASS ${edition} SMTP scope, Vault, safe test claim, revoke, read-only grace and licence expiry`);
  });
}
