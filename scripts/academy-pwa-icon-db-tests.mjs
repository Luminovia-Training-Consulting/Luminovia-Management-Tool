/** Native PostgreSQL checks for exact private assets and the versioned public preview. */
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { deflateSync } from "node:zlib";
import { crc32 } from "../supabase/functions/files/avatar.ts";
import { configureAcademyCourseAccess, prepareAcademyInstallation } from "./academy-installation.mjs";
import { signAcademyLicence } from "./academy-licence.mjs";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

function png(edge, shade) {
  function chunk(type, content) {
    const body = Buffer.concat([Buffer.from(type), content]);
    const result = Buffer.alloc(content.length + 12);
    result.writeUInt32BE(content.length);
    result.set(body, 4);
    result.writeUInt32BE(crc32(body), content.length + 8);
    return result;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(edge);
  header.writeUInt32BE(edge, 4);
  header.set([8, 2], 8);
  const pixels = Buffer.alloc((edge * 3 + 1) * edge);
  pixels[1] = shade;
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0)),
  ]).toString("base64");
}

const variants = ["icon_192", "icon_512", "maskable_512"];
const icons = [png(192, 18), png(512, 125), png(512, 77)];
const scannerReceipt = "array['ClamAV 1 small','ClamAV 1 large','ClamAV 1 mask']";
const gate = (name, method = "POST", profile = "public") =>
  `set local request.path=${q(`/rpc/${name}`)}; set local request.method=${q(method)};
    set local request.headers=${q(JSON.stringify({"accept-profile": profile}))};
    select public.require_portal_access();`;

for (const edition of ["customer-managed", "customer-self-hosted"]) {
  await withTestDatabase("academy_pwa_icon", async ({ sql, actor }) => {
    const [admin, learner, manager] = Array.from({ length: 3 }, randomUUID);
    const now = Date.now();
    const date = (days) => new Date(now + days * 86_400_000).toISOString();
    const terms = {
      installation_id: randomUUID(), edition, release_commit: "52".repeat(20),
      issued_at: date(-4), starts_at: date(-3), expires_at: date(4), grace_until: date(5),
      modules: ["lms"], limits: { seat_count: 5, storage_bytes: 1_000_000, api_requests_per_minute: 50 },
    };
    const vendor = generateKeyPairSync("ed25519");
    const options = {
      envelope: signAcademyLicence(terms, vendor.privateKey),
      publicKey: vendor.publicKey, expected: terms, now,
    };
    const read = (name, args = "", method = "GET", role = "anon", profile = "public") =>
      sql(`begin; set local role ${role}; ${gate(name, method, profile)} select public.${name}(${args}); commit;`);
    const metadata = async () => JSON.parse(await read("academy_pwa_icon"));
    const asset = (variant, version = null) => read("read_academy_pwa_icon",
      [q(variant), version ?? "null"].join(","), "POST", "service_role");
    const manifest = () => read("academy_pwa_manifest", "", "GET", "service_role");
    const call = (who, name, args) => actor(who, `${gate(name)} select public.${name}(${args});`);
    const publish = async (revision, assets = icons, receipts = scannerReceipt) =>
      JSON.parse(await read("publish_academy_scanned_pwa_icon",
        [q(admin), revision, ...assets.map(q), receipts].join(","), "POST", "service_role"));
    const saved = (version, custom = true) => ({ installation_id: terms.installation_id, version, custom });

    assert.equal(await read("academy_pwa_icon"), "");
    await prepareAcademyInstallation(options, sql);
    await configureAcademyCourseAccess({ ...options, enabled: true }, sql);
    await sql(`
      insert into auth.users(id,email,email_confirmed_at) values ${[admin, learner, manager].map((id) => `(${q(id)},${q(id + "@example.invalid")},now())`).join(",")};
      insert into public.user_roles(user_id,role) values (${q(admin)},'admin'),(${q(learner)},'participant'),(${q(manager)},'management');
      select private.pin_academy_pdf_release_brand(${q(terms.installation_id)},${q(terms.release_commit)},'Fictional School','School','#1a2b3c');
    `);
    assert.deepEqual(await metadata(), saved(0, false));
    assert.equal(await manifest(), "");
    assert.equal(await asset("icon_192"), "");
    for (const name of ["academy_pwa_manifest", "read_academy_pwa_icon"]) {
      const args = name === "read_academy_pwa_icon" ? q("icon_192") : "";
      await assert.rejects(read(name, args), /42501/);
      await assert.rejects(actor(admin, `select public.${name}(${args})`), /42501/);
    }
    await assert.rejects(read("academy_pwa_manifest", "", "POST", "service_role"), /42501/);
    await assert.rejects(read("academy_pwa_manifest", "", "GET", "service_role", "private"), /42501/);
    await assert.rejects(read("academy_pwa_icon", "", "POST"), /42501/);
    await assert.rejects(read("academy_pwa_icon", "", "GET", "anon", "private"), /42501/);
    await assert.rejects(actor(admin, `select public.publish_academy_scanned_pwa_icon(${q(admin)},0,${icons.map(q).join(",")},${scannerReceipt})`), /42501/);
    for (const who of [learner, manager]) {
      await assert.rejects(call(who, "check_academy_pwa_icon_write", "0"), /42501/);
      await assert.rejects(call(who, "clear_academy_pwa_icon", "0"), /42501/);
    }
    await call(admin, "check_academy_pwa_icon_write", "0");
    await assert.rejects(publish(0, [icons[1], icons[1], icons[2]]), /23514/);
    await assert.rejects(publish(0, [icons[0], "broken", icons[2]]), /22023/);
    await assert.rejects(publish(0, icons, "array['ClamAV 1 small',null,'ClamAV 1 mask']"), /22023/);
    assert.deepEqual(await metadata(), saved(0, false));
    assert.deepEqual(await publish(0), saved(1));
    assert.deepEqual(await metadata(), saved(1));
    assert.deepEqual(await Promise.all(variants.map((variant) => asset(variant, 1))), icons);
    assert.equal(await asset("icon_192", 0), "");
    assert.equal(await asset("other", 1), "");
    assert.equal(await asset("icon_192"), icons[0]);
    assert.deepEqual(JSON.parse(await manifest()), {
      version: 1, name: "Fictional School", short_name: "School", theme_color: "#1a2b3c",
    });
    await call(admin, "save_academy_public_branding", "0,'Fictional Learning','Learning','#abcdef'");
    assert.deepEqual(JSON.parse(await manifest()), {
      version: 1, name: "Fictional Learning", short_name: "Learning", theme_color: "#abcdef",
    });

    const contenders = await Promise.allSettled([publish(1), call(admin, "clear_academy_pwa_icon", "1")]);
    assert.equal(contenders.filter(({status}) => status === "fulfilled").length, 1);
    assert.match(String(contenders.find(({status}) => status === "rejected").reason), /PT409/);
    assert.equal((await metadata()).version, 2);
    assert.equal(await asset("icon_512", 1), "");
    await sql(`delete from public.user_roles where user_id=${q(admin)} and role='admin'`);
    await assert.rejects(publish(2), /42501/);
    await sql(`insert into public.user_roles(user_id,role) values(${q(admin)},'admin')`);
    assert.deepEqual(await publish(2), saved(3));
    assert.deepEqual(JSON.parse(await call(admin, "clear_academy_pwa_icon", "3")), saved(4, false));
    assert.equal(await asset("icon_192"), "");
    assert.equal(await manifest(), "");
    assert.deepEqual(await publish(4), saved(5));

    const grace = { ...terms, issued_at: date(-2), starts_at: date(-1), expires_at: date(-0.5) };
    await sql(`select private.apply_verified_installation_licence(${q(JSON.stringify(grace))}::jsonb)`);
    assert.deepEqual(await metadata(), saved(5));
    assert.equal(await asset("maskable_512", 5), icons[2]);
    assert.equal(JSON.parse(await manifest()).version, 5);
    await assert.rejects(publish(5), /42501/);
    await assert.rejects(call(admin, "clear_academy_pwa_icon", "5"), /42501/);
    assert.equal(await sql("select count(*) from public.audit_events where action='academy.pwa_icon.changed'"), "5");
    console.log(`PASS ${edition} private PWA bytes, signed licence, admin authorization, atomic versioning, branding and clear`);
  });
}
