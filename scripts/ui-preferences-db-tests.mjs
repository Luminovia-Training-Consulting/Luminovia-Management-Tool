/** Current own-account UI settings, guest access and denied callers in a disposable replay. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {quoteSql, withTestDatabase} from "./testing/database.mjs";
import {assertLmsResponse} from "./testing/premium-lms-contract.mjs";

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
    const read = async (id) => {
        const result = JSON.parse(await as(id, "select public.ui_preferences()"));
        assertLmsResponse("ui_preferences", result);
        return result;
    };
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
    assertLmsResponse("save_ui_preferences", updated);
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

await withTestDatabase(
    "ui_preferences_upgrade",
    async ({sql, actor}) => {
        const [participant, peer, company, link] = Array.from(
            {length: 4},
            randomUUID,
        );
        const q = quoteSql;
        await sql(`insert into auth.users(id,email,email_confirmed_at) values
          (${q(participant)},'participant@example.invalid',now()),(${q(peer)},'peer@example.invalid',now());
          insert into public.user_roles(user_id,role) values
          (${q(participant)},'lecturer'),(${q(peer)},'lecturer')`);
        const read = async (id) => {
            const result = JSON.parse(
                await actor(id, "select public.ui_preferences()"),
            );
            assertLmsResponse("ui_preferences", result);
            return result;
        };
        const save = async (id, patch) => {
            const result = JSON.parse(
                await actor(
                    id,
                    `select public.save_ui_preferences(${q(JSON.stringify(patch))}::jsonb)`,
                ),
            );
            assertLmsResponse("save_ui_preferences", result);
            return result;
        };

        const previous = await save(participant, {
            language: "en",
            theme: "dark",
            sidebar_collapsed: true,
        });
        await sql(`update public.user_roles set role='participant' where user_id=${q(participant)};
          insert into public.organisations(id,name) values(${q(company)},'Fictional preferences company');
          insert into private.company_participant_link_requests
            (id,organisation_id,requested_by,request_id,luminovia_user_id,target_user_id,status,expires_at)
            values(${q(link)},${q(company)},${q(peer)},${q(randomUUID())},'FICTIONAL',${q(participant)},'accepted',now() + interval '1 day');
          insert into private.company_participant_memberships
            (organisation_id,user_id,status,link_request_id,invited_by,joined_at)
            values(${q(company)},${q(participant)},'active',${q(link)},${q(peer)},now());`);
        await assert.rejects(read(participant), /Active account required/);
        await assert.rejects(save(participant, {theme: "light"}), /Active account required/);
        await sql(
            await readFile(
                new URL(
                    "../supabase/migrations/20261122010700_participant_ui_preferences.sql",
                    import.meta.url,
                ),
                "utf8",
            ),
        );

        assert.deepEqual(await read(participant), previous);
        assert.deepEqual(await save(participant, {theme: "light"}), {
            ...previous,
            theme: "light",
            version: previous.version + 1,
        });
        await assert.rejects(save(participant, {user_id: peer}), /Invalid UI preferences/);
        await assert.rejects(
            actor(participant, "select * from private.account_ui_preferences"),
            /permission denied/,
        );
        for (const query of [
            "select public.get_welcome_progress()",
            "select public.save_welcome_progress('profile','active',0)",
            "select public.dashboard_preferences()",
        ]) {
            await assert.rejects(actor(participant, query), /Active account required/);
        }

        await sql(`update private.company_participant_memberships set status='removed',removed_at=now()
          where organisation_id=${q(company)} and user_id=${q(participant)}`);
        assert.equal((await read(participant)).theme, "light");
        assert.deepEqual(await save(participant, {language: "de"}), {
            ...previous,
            language: "de",
            theme: "light",
            version: previous.version + 2,
        });
        await sql(`update public.profiles set active=false where id=${q(participant)}`);
        await assert.rejects(read(participant), /Active account required/);
        await assert.rejects(save(participant, {theme: "dark"}), /Active account required/);
        await sql(`update public.profiles set active=true where id=${q(participant)};
          update auth.users set email_confirmed_at=null where id=${q(participant)}`);
        await assert.rejects(read(participant), /Active account required/);
        await assert.rejects(save(participant, {theme: "dark"}), /Active account required/);
        await sql(`update auth.users set email_confirmed_at=now() where id=${q(participant)};
          delete from public.user_roles where user_id=${q(participant)} and role='participant'`);
        await assert.rejects(read(participant), /Active account required/);
        await assert.rejects(save(participant, {theme: "dark"}), /Active account required/);
        assert.equal((await read(peer)).version, 0);
        console.log(
            "PASS UI preferences upgrade preserves own state, remains personal after company removal, and rejects inactive, unconfirmed and removed account roles",
        );
    },
    {migrationsThrough: "20261122010600"},
);
