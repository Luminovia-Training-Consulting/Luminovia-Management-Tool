/** Current own-account UI settings, guest access and denied callers in a disposable replay. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {quoteSql, withTestDatabase} from "./testing/database.mjs";

await withTestDatabase("ui_preferences", async ({sql}) => {
    const lecturer = randomUUID();
    const peer = randomUUID();
    const guest = randomUUID();
    const inactive = randomUUID();
    const q = quoteSql;
    await sql(`insert into auth.users(id, email)
               values
    (${q(lecturer)},'lecturer@example.invalid'),(${q(peer)},'peer@example.invalid'),
    (${q(guest)},'guest@example.invalid'),(${q(inactive)},'inactive@example.invalid');
    insert into public.user_roles(user_id,role) values
    (${q(lecturer)},'lecturer'),(${q(peer)},'lecturer'),(${q(guest)},'guest'),(${q(inactive)},'lecturer');
    update public.profiles set active=false where id=${q(inactive)};`);
    const as = (id, statement) =>
        sql(`begin;set local role authenticated;
    set local request.jwt.claims=${q(JSON.stringify({sub: id, role: "authenticated", aal: "aal1"}))};
    ${statement};commit;`);
    const read = async (id) =>
        JSON.parse(await as(id, "select public.ui_preferences()"));
    assert.deepEqual(await read(lecturer), {
        language: "de",
        theme: "system",
        sidebar_collapsed: false,
        version: 0,
    });
    const updated = JSON.parse(
        await as(
            lecturer,
            `select public.save_ui_preferences('{"language":"en","theme":"dark","sidebar_collapsed":true}'::jsonb)`,
        ),
    );
    assert.deepEqual(updated, {
        language: "en",
        theme: "dark",
        sidebar_collapsed: true,
        version: 1,
    });
    assert.equal((await read(peer)).theme, "system");
    assert.equal(
        await sql(`select locale from public.profiles where id=${q(lecturer)}`),
        "en",
    );
    const patch = JSON.parse(
        await as(
            lecturer,
            `select public.save_ui_preferences('{"theme":"light"}'::jsonb)`,
        ),
    );
    assert.equal(patch.language, "en");
    assert.equal(patch.sidebar_collapsed, true);
    assert.equal(patch.version, 2);
    assert.equal((await read(guest)).language, "de");
    await as(
        guest,
        "set local request.path='/rpc/ui_preferences';select public.require_portal_access()",
    );
    await assert.rejects(
        as(
            guest,
            "set local request.path='/rpc/finance_earnings';select public.require_portal_access()",
        ),
        /Operational portal access required/,
    );
    assert.equal(
        JSON.parse(
            await as(
                guest,
                `select public.save_ui_preferences('{"theme":"dark"}'::jsonb)`,
            ),
        ).theme,
        "dark",
    );
    for (const payload of [
        "{}",
        '{"user_id":"' + peer + '"}',
        '{"theme":"other"}',
        '{"sidebar_collapsed":"yes"}',
    ]) {
        await assert.rejects(
            as(lecturer, `select public.save_ui_preferences(${q(payload)}::jsonb)`),
            /Invalid UI preferences/,
        );
    }
    await assert.rejects(read(inactive), /Active account required/);
    assert.equal(
        await sql(
            "select has_function_privilege('anon','public.ui_preferences()','EXECUTE')",
        ),
        "f",
    );
    assert.equal(
        await sql(
            "select has_table_privilege('authenticated','private.account_ui_preferences','SELECT')",
        ),
        "f",
    );
    console.log(
        "PASS UI preferences: own state, partial updates, language locale, guest, validation and grants",
    );
});