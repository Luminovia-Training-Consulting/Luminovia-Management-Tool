import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

await withTestDatabase("account_onboarding", async ({ sql, actor }) => {
  const [invited, temporary, ordinary] = Array.from({ length: 3 }, randomUUID);
  const alias = "member-3aed90a1ca2b4fef901c6a32";
  const provisionalHash = "fixture-only initial hash";
  const personalHash = "fixture-only new hash";
  await sql(`
    alter table auth.users add column invited_at timestamptz,
      add column raw_user_meta_data jsonb,
      add column raw_app_meta_data jsonb,
      add column encrypted_password text;
    insert into auth.users(id, email, email_confirmed_at, raw_user_meta_data) values
      (${q(invited)}, 'new@example.invalid', null, jsonb_build_object('portal_invitation_username', ${q(alias)}));
    update auth.users set invited_at=now() where id=${q(invited)};
    update auth.users set encrypted_password=${q(provisionalHash)} where id=${q(invited)};
    update auth.users set email_confirmed_at=now() where id=${q(invited)};
    insert into auth.users(id, email, email_confirmed_at, raw_app_meta_data, encrypted_password) values
      (${q(temporary)}, 'temporary@example.invalid', now(), '{"portal_temporary_password":true}', ${q(provisionalHash)});
    insert into auth.users(id, email, email_confirmed_at, encrypted_password, raw_user_meta_data) values
      (${q(ordinary)}, 'existing@example.invalid', now(), ${q(personalHash)}, '{"portal_temporary_password":true}');
    insert into public.user_roles(user_id,role) values
      (${q(invited)}, 'participant'), (${q(temporary)}, 'lecturer'), (${q(ordinary)}, 'lecturer');
  `);
  assert.equal(
    await sql(
      `select username from private.user_login_aliases where user_id=${q(invited)}`,
    ),
    "",
  );
  assert.equal(await actor(ordinary, "select public.portal_access()"), "t");
  await sql(
    "begin; set local role service_role; select public.require_portal_access(); rollback;",
  );
  for (const id of [invited, temporary]) {
    assert.equal(
      await actor(id, "select private.own_password_setup_required()"),
      "t",
    );
    assert.equal(await actor(id, "select public.portal_access()"), "f");
    await assert.rejects(
      actor(id, "select public.require_portal_access()"),
      /PT428/,
    );
  }

  await sql(`update auth.users set raw_user_meta_data = '{"portal_temporary_password":false,"portal_invitation_username":"user-input"}'
    where id=${q(invited)}`);
  await sql(
    `update auth.users set encrypted_password=${q(provisionalHash)} where id=${q(temporary)}`,
  );
  await assert.rejects(
    actor(invited, "select public.require_portal_access()"),
    /PT428/,
  );
  await assert.rejects(
    actor(temporary, "select public.require_portal_access()"),
    /PT428/,
  );
  await sql(
    `update auth.users set encrypted_password=${q(personalHash)} where id in (${q(invited)},${q(temporary)})`,
  );
  assert.equal(
    await actor(invited, "select private.own_password_setup_required()"),
    "f",
  );
  assert.equal(await actor(temporary, "select public.portal_access()"), "t");
  assert.equal(
    await sql(
      `select username from private.user_login_aliases where user_id=${q(invited)}`,
    ),
    "",
  );
  console.log(
    "PASS trusted password bootstrap, immutable provisional state, Auth password transition, retired alias and role gates",
  );
});
