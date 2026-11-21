/** Real SQL consent, current identity and role boundaries for staff contacts. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {quoteSql as q, withTestDatabase} from "./testing/database.mjs";

await withTestDatabase("staff_contact", async ({sql, actor}) => {
    const [owner, peer, admin, participant, client] = Array.from(
        {length: 5},
        randomUUID,
    );
    const rpc = async (who, name, args = []) =>
        JSON.parse(await actor(who, `select public.${name}(${args.join(",")})`));
    let checks = 0;
    const check = async (name, run) => {
        await run();
        checks++;
        console.log(`PASS ${name}`);
    };
    await sql(`insert into auth.users(id,email) values ${[owner, peer, admin, participant, client].map((id) => `(${q(id)},${q(id + "@example.invalid")})`).join(",")};
  insert into public.user_roles(user_id,role) values(${q(owner)},'lecturer'),(${q(peer)},'senior_lecturer'),(${q(admin)},'admin'),(${q(participant)},'participant'),(${q(client)},'client');
  update public.profiles set phone='+49 40 123456' where id=${q(owner)};`);
    await check(
        "Directory contact defaults remain private even for administrators",
        async () => {
            for (const who of [owner, peer, admin, client])
                assert.deepEqual(await rpc(who, "person_contact", [q(owner)]), {
                    email: null,
                    phone: null,
                });
            await assert.rejects(
                rpc(participant, "person_contact", [q(owner)]),
                /Active account required/,
            );
            const own = await rpc(owner, "contact_visibility_preferences");
            assert.equal(own.email_visible, false);
            assert.equal(own.phone_visible, false);
            assert.equal(own.version, 0);
            assert.equal(own.email_address, owner + "@example.invalid");
            await assert.rejects(
                actor(admin, "select * from private.staff_contact_visibility", "aal1"),
                /permission denied/,
            );
            assert.equal(
                await sql(
                    "select has_function_privilege('anon','public.person_contact(uuid)','execute')",
                ),
                "f",
            );
        },
    );
    const payload = {email_visible: true, phone_visible: false};
    await check(
        "Self opt-in reveals exactly selected current contacts to active staff",
        async () => {
            await rpc(owner, "save_contact_visibility_preferences", [
                q(JSON.stringify(payload)),
                "0",
            ]);
            for (const who of [peer, admin])
                assert.deepEqual(await rpc(who, "person_contact", [q(owner)]), {
                    email: owner + "@example.invalid",
                    phone: null,
                });
            for (const who of [client])
                assert.deepEqual(await rpc(who, "person_contact", [q(owner)]), {
                    email: null,
                    phone: null,
                });
            await assert.rejects(
                rpc(participant, "person_contact", [q(owner)]),
                /Active account required/,
            );
            assert.equal(
                (await rpc(peer, "contact_visibility_preferences")).email_visible,
                false,
            );
        },
    );
    await check(
        "Forged identity, extra fields and stale versions cannot edit another account",
        async () => {
            for (const bad of [
                {...payload, user_id: peer},
                {...payload, email_address: "forged@example.invalid"},
                {email_visible: "true", phone_visible: false},
            ])
                await assert.rejects(
                    rpc(owner, "save_contact_visibility_preferences", [
                        q(JSON.stringify(bad)),
                        "1",
                    ]),
                    /22023/,
                );
            await assert.rejects(
                rpc(owner, "save_contact_visibility_preferences", [
                    q(JSON.stringify(payload)),
                    "0",
                ]),
                /PT409/,
            );
            assert.equal(
                (await rpc(owner, "contact_visibility_preferences")).version,
                1,
            );
        },
    );
    await check(
        "Real simultaneous consent writes serialize with one CAS winner",
        async () => {
            const results = await Promise.allSettled([
                rpc(owner, "save_contact_visibility_preferences", [
                    q(JSON.stringify({email_visible: false, phone_visible: true})),
                    "1",
                ]),
                rpc(owner, "save_contact_visibility_preferences", [
                    q(JSON.stringify({email_visible: true, phone_visible: true})),
                    "1",
                ]),
            ]);
            assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
            assert.match(
                results.find((r) => r.status === "rejected").reason.message,
                /PT409/,
            );
            await rpc(owner, "save_contact_visibility_preferences", [
                q(JSON.stringify({email_visible: true, phone_visible: true})),
                "2",
            ]);
        },
    );
    await check(
        "Email and phone are read from current saved sources, never copied snapshots",
        async () => {
            await sql(
                `update auth.users
                 set email='changed-contact@example.invalid'
                 where id = ${q(owner)};
                update public.profiles
                set phone='+61 7 12345678'
                where id = ${q(owner)};`,
            );
            assert.deepEqual(await rpc(peer, "person_contact", [q(owner)]), {
                email: "changed-contact@example.invalid",
                phone: "+61 7 12345678",
            });
            const summary = await rpc(peer, "person_profile", [q(owner)]);
            assert.equal(Object.hasOwn(summary, "email"), false);
            assert.equal(Object.hasOwn(summary, "phone"), false);
            assert.ok(
                !JSON.stringify(await rpc(peer, "people_directory")).includes(
                    "changed-contact@example.invalid",
                ),
            );
        },
    );
    await check(
        "Revoking sharing removes contacts immediately on next authorised read",
        async () => {
            await rpc(owner, "save_contact_visibility_preferences", [
                q(JSON.stringify({email_visible: false, phone_visible: false})),
                "3",
            ]);
            assert.deepEqual(await rpc(admin, "person_contact", [q(owner)]), {
                email: null,
                phone: null,
            });
            await rpc(owner, "save_contact_visibility_preferences", [
                q(JSON.stringify({email_visible: true, phone_visible: true})),
                "4",
            ]);
        },
    );
    await check(
        "Current staff role changes and target suspension override retained opt-in",
        async () => {
            await sql(`delete
                       from public.user_roles
                       where user_id = ${q(peer)}`);
            await assert.rejects(
                rpc(peer, "person_contact", [q(owner)]),
                /Active account required/,
            );
            await sql(`update public.profiles
                       set active= false
                       where id = ${q(owner)}`);
            assert.deepEqual(await rpc(admin, "person_contact", [q(owner)]), {
                email: null,
                phone: null,
            });
            await assert.rejects(
                rpc(owner, "contact_visibility_preferences"),
                /42501/,
            );
            await assert.rejects(rpc(owner, "person_contact", [q(peer)]), /42501/);
        },
    );
    await check(
        "Pure participant and client cannot opt into staff sharing or forge roles",
        async () => {
            for (const who of [participant, client])
                await assert.rejects(
                    rpc(who, "save_contact_visibility_preferences", [
                        q(JSON.stringify(payload)),
                        "0",
                    ]),
                    /42501/,
                );
            await assert.rejects(
                rpc(participant, "contact_visibility_preferences"),
                /Active account required/,
            );
        },
    );
    console.log(`Passed ${checks} staff contact PostgreSQL groups.`);
});