/** Upgraded installations keep their identities and expose no account alias operations. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {quoteSql as q, withTestDatabase} from "./testing/database.mjs";

await withTestDatabase("retired_account_alias", async ({sql, actor}) => {
    const user = randomUUID();
    const other = randomUUID();
    await sql(`insert into auth.users(id,email,email_confirmed_at) values
      (${q(user)},'course@example.invalid',now()),
      (${q(other)},'other@example.invalid',now());
      insert into public.user_roles(user_id,role) values
        (${q(user)},'lecturer'),(${q(other)},'participant');
      insert into private.user_login_aliases(user_id,username) values(${q(user)},'legacy.lecturer');`);
    for (const signature of [
        "public.account_username()",
        "public.save_account_username(text,integer)",
        "public.academy_save_username(text,integer)",
        "public.login_email_for_alias(text)",
    ]) {
        assert.equal(await sql(`select to_regprocedure(${q(signature)}) is null`), "t");
    }
    await assert.rejects(actor(user, "select private.save_account_username('blocked.alias',1)"), /42501/);
    assert.equal(await sql("select has_function_privilege('service_role','private.login_email_for_alias(text)','execute')"), "f");
    const profile = JSON.parse(await actor(user,
        `select public.save_account_profile('{"display_name":"Display Name"}'::jsonb);`));
    assert.equal(profile.profile.display_name, "Display Name");
    assert.equal(profile.profile.email, "course@example.invalid");
    await assert.rejects(actor(user,
        `select public.save_account_profile('{"username":"new.alias"}'::jsonb);`), /22023/);

    assert.equal(await actor(other, `set local request.path='/rpc/save_profile_display_name';
        select public.require_portal_access();
        select public.save_profile_display_name('  Participant Name  ');`), "Participant Name");
    assert.equal(await sql(`select display_name from public.profiles where id=${q(user)}`), "Display Name");
    await assert.rejects(actor(other, "select public.save_profile_display_name(null)"), /22023/);

    assert.equal(await sql("select public.reserve_login_attempt(repeat('a',64))"), "t");
    for (let i = 1; i < 10; i++)
        await sql("select public.reserve_login_attempt(repeat('a',64))");
    assert.equal(await sql("select public.reserve_login_attempt(repeat('a',64))"), "f");
    console.log("PASS retired username operations, own display name and retained login throttling");
});
