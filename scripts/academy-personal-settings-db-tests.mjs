/** Dedicated own-account settings, roles and licence boundary on fresh replay. */
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  configureAcademyCourseAccess,
  prepareAcademyInstallation,
} from "./academy-installation.mjs";
import { signAcademyLicence } from "./academy-licence.mjs";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";
import { academyPersonalSettingsPaths } from "../src/features/developer-api/academy-personal-settings-contract.ts";

for (const edition of ["customer-managed", "customer-self-hosted"]) {
  await withTestDatabase(
    "academy_personal_settings",
    async ({ sql, actor }) => {
      const [learner, teacher, admin, guest, inactive, unconfirmed] =
        Array.from({ length: 6 }, randomUUID);
      const now = Date.now();
      const date = (days) => new Date(now + days * 86_400_000).toISOString();
      const terms = {
        installation_id: randomUUID(),
        edition,
        release_commit: "ac".repeat(20),
        issued_at: date(-2),
        starts_at: date(-1),
        expires_at: date(10),
        grace_until: date(15),
        modules: ["lms"],
        limits: {
          seat_count: 30,
          storage_bytes: 20_000_000,
          api_requests_per_minute: 60,
        },
      };
      const key = generateKeyPairSync("ed25519");
      const provision = {
        envelope: signAcademyLicence(terms, key.privateKey),
        publicKey: key.publicKey,
        expected: terms,
        now,
      };
      await prepareAcademyInstallation(provision, sql);
      await configureAcademyCourseAccess({ ...provision, enabled: true }, sql);
      await sql(`
      insert into auth.users(id,email,email_confirmed_at) values
        ${[learner, teacher, admin, guest, inactive, unconfirmed].map((id) => `(${q(id)},${q(id + "@example.invalid")},${id === unconfirmed ? "null" : "now()"})`).join(",")};
      insert into public.user_roles(user_id,role) values
        (${q(learner)},'participant'),(${q(teacher)},'lecturer'),(${q(admin)},'admin'),(${q(guest)},'guest'),(${q(inactive)},'lecturer'),(${q(unconfirmed)},'lecturer');
      update public.profiles set active=false where id=${q(inactive)};
      update public.profiles set locale='en' where id=${q(teacher)};
      insert into private.account_ui_preferences(user_id,theme,sidebar_collapsed,version) values (${q(teacher)},'dark',true,7);`);
      const rpc = async (id, name, args = []) => {
        const result = JSON.parse(
          await actor(
            id,
            `
        set local request.path=${q("/rpc/" + name)};
        set local request.method='POST';
        select public.require_portal_access();
        select public.${name}(${args.join(",")});`,
          ),
        );
        const schema =
          academyPersonalSettingsPaths["/rest/v1/rpc/" + name]?.post.responses[
            "200"
          ].content["application/json"].schema;
        if (schema) z.fromJSONSchema(schema).parse(result);
        return result;
      };
      const read = (id) => rpc(id, "academy_personal_settings");
      const username = (id, value, version) =>
        rpc(id, "academy_save_username", [
          value === null ? "null" : q(value),
          version,
        ]);
      const appearance = (id, patch) =>
        rpc(id, "academy_save_appearance", [q(JSON.stringify(patch))]);
      assert.deepEqual(await read(learner), {
        username: { username: null, version: 0 },
        appearance: { language: "de", theme: "system", version: 0 },
      });
      assert.deepEqual((await read(teacher)).appearance, {
        language: "en",
        theme: "dark",
        version: 7,
      });
      assert.deepEqual(await username(learner, "  Classroom.Learner   ", 0), {
        username: "classroom.learner",
        version: 1,
      });
      assert.deepEqual((await read(admin)).username, {
        username: null,
        version: 0,
      });
      await assert.rejects(username(learner, "new.alias", 0), /PT409/);
      await assert.rejects(username(teacher, "Classroom.Learner", 0), /23505/);
      await assert.rejects(username(learner, "Admin", 1), /22023/);
      assert.deepEqual(
        await appearance(learner, { language: "en", theme: "light" }),
        {
          language: "en",
          theme: "light",
          version: 1,
        },
      );
      assert.deepEqual(await appearance(learner, { theme: "dark" }), {
        language: "en",
        theme: "dark",
        version: 2,
      });
      for (const patch of [
        {},
        { user_id: teacher },
        { sidebar_collapsed: false },
        { language: "en-GB" },
      ])
        await assert.rejects(appearance(learner, patch), /22023/);
      assert.equal(
        await sql(
          `select sidebar_collapsed from private.account_ui_preferences where user_id=${q(teacher)}`,
        ),
        "t",
      );
      assert.equal(
        await sql(`select locale from public.profiles where id=${q(learner)}`),
        "en",
      );
      assert.equal(
        await sql("select public.login_email_for_alias('classroom.learner')"),
        learner + "@example.invalid",
      );
      assert.deepEqual(await username(learner, null, 1), {
        username: null,
        version: 2,
      });
      assert.equal(
        await sql("select public.login_email_for_alias('classroom.learner')"),
        "",
      );
      for (const id of [guest, inactive, unconfirmed]) {
        await assert.rejects(read(id), /42501/);
        await assert.rejects(username(id, "must-deny", 0), /42501/);
        await assert.rejects(appearance(id, { theme: "light" }), /42501/);
      }
      for (const name of [
        "account_me",
        "account_username",
        "ui_preferences",
        "login_email_for_alias",
      ])
        await assert.rejects(rpc(admin, name), /42501/);
      assert.equal(
        await sql(
          "select has_function_privilege('anon','public.academy_personal_settings()','execute')",
        ),
        "f",
      );

      const grace = {
        ...terms,
        issued_at: date(-1.9),
        starts_at: date(-1.8),
        expires_at: date(-0.5),
        grace_until: date(2),
      };
      await sql(
        `select private.apply_verified_installation_licence(${q(JSON.stringify(grace))}::jsonb)`,
      );
      assert.deepEqual((await read(learner)).appearance, {
        language: "en",
        theme: "dark",
        version: 2,
      });
      await assert.rejects(username(learner, "grace.refused", 2), /42501/);
      await assert.rejects(appearance(learner, { theme: "system" }), /42501/);

      await configureAcademyCourseAccess({ ...provision, enabled: false }, sql);
      await assert.rejects(read(learner), /42501/);
      console.log(
        `PASS ${edition} exact own settings, canonical alias and appearance, legacy retention, private scope, read-only grace, profile closure and stable stale handling`,
      );
    },
  );
}
