/** Username aliases retain Auth UUIDs and are writable only by the current actor. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {quoteSql as q, withTestDatabase} from "./testing/database.mjs";

await withTestDatabase("username_auth", async ({sql}) => {
    const first = randomUUID();
    const second = randomUUID();
    const guest = randomUUID();
    const participant = randomUUID();
    await sql(`insert into auth.users(id,email,email_confirmed_at) values
        (${q(first)},'first@example.invalid',now()),
        (${q(second)},'second@example.invalid',now()),
        (${q(guest)},'guest@example.invalid',now()),
        (${q(participant)},'participant@example.invalid',now());
        insert into public.user_roles(user_id,role) values
        (${q(first)},'lecturer'),(${q(second)},'lecturer'),
        (${q(guest)},'guest'),(${q(participant)},'participant');`);
    const as = (id, statement) =>
        sql(`begin; set local role authenticated;
        set local request.jwt.claims=${q(JSON.stringify({sub: id, role: "authenticated", aal: "aal1"}))};
        ${statement}; commit;`);
    assert.deepEqual(
        JSON.parse(await as(first, "select public.account_username()")),
        {username: null, version: 0},
    );
    const saved = JSON.parse(
        await as(first, "select public.save_account_username('Course.Lead',0)"),
    );
    assert.deepEqual(saved, {username: "course.lead", version: 1});
    assert.equal(
        await sql("select public.login_email_for_alias('course.lead')"),
        "first@example.invalid",
    );
    assert.deepEqual(
        JSON.parse(await as(second, "select public.account_username()")),
        {username: null, version: 0},
    );
    await assert.rejects(
        as(second, "select public.save_account_username('course.lead',0)"),
        /Username unavailable/,
    );
    await assert.rejects(
        as(first, "select public.save_account_username('other.name',0)"),
        /Username changed/,
    );
    await assert.rejects(
        as(first, "select public.save_account_username('admin',1)"),
        /Invalid username/,
    );
    await as(
        first,
        "set local request.path='/rpc/account_username'; select public.require_portal_access()",
    );
    for (const [id, alias] of [[guest, "course.guest"], [participant, "course.learner"]]) {
        assert.deepEqual(JSON.parse(await as(id, "set local request.path='/rpc/account_username'; select public.require_portal_access(); select public.account_username()").then((value) => value.trim())), {username: null, version: 0});
        await as(id, `set local request.path='/rpc/save_account_username'; select public.require_portal_access(); select public.save_account_username(${q(alias)},0)`);
    }
    await sql(`update public.profiles set active=false where id=${q(first)}`);
    assert.equal(
        await sql("select public.login_email_for_alias('course.lead')"),
        "",
    );
    await assert.rejects(as(first, "select public.account_username()"));
    assert.equal(
        await sql(
            "select has_function_privilege('authenticated','public.login_email_for_alias(text)','EXECUTE')",
        ),
        "f",
    );
    assert.equal(
        await sql(
            "select has_function_privilege('anon','public.account_username()','EXECUTE')",
        ),
        "f",
    );
    assert.equal(
        await sql("select public.reserve_login_attempt(repeat('a',64))"),
        "t",
    );
    for (let i = 1; i < 10; i++)
        await sql("select public.reserve_login_attempt(repeat('a',64))");
    assert.equal(
        await sql("select public.reserve_login_attempt(repeat('a',64))"),
        "f",
    );
});
