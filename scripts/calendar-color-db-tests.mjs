/** Isolated PostgreSQL checks for actor-private palette reads, writes and optimistic versions. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {quoteSql as q, withTestDatabase} from "./testing/database.mjs";

let checks = 0;

/** Count one database gate only after every assertion in the group passes. */
async function check(name, run) {
    await run();
    checks++;
    console.log(`PASS ${name}`);
}

await withTestDatabase("calendar_colors_test", async ({sql, actor}) => {
    const first = randomUUID(), second = randomUUID(), admin = randomUUID();
    await sql(
        `insert into auth.users(id,email) values('${first}','color-first@example.invalid'),('${second}','color-second@example.invalid'),('${admin}','color-admin@example.invalid');insert into public.user_roles(user_id,role) values('${first}','lecturer'),('${second}','lecturer'),('${admin}','admin');`,
    );
    /** Call only public calendar color RPCs under an individual fixture JWT. */
    const rpc = (who, name, args = []) =>
        actor(
            who,
            `select public.${name}(${args
                .map((value) =>
                    value === null
                        ? "null"
                        : typeof value === "boolean" || typeof value === "number"
                            ? String(value)
                            : q(value),
                )
                .join(",")})`,
        ).then((value) => JSON.parse(value));

    const personal = "#E6E0F0", assigned = "#DCE9F8", customer = "#F5DDE7";
    await check(
        "Color defaults are per actor and saving is versioned with a fixed light palette",
        async () => {
            const firstDefaults = await rpc(first, "get_my_calendar_color_preferences");
            assert.deepEqual(firstDefaults, {
                personal_event_color: "#E1EDDA",
                assignment_event_color: "#DCE9F8",
                customer_event_color: "#FFF0C5",
                version: 0,
            });
            const saved = await rpc(first, "save_my_calendar_color_preferences", [
                0,
                personal,
                assigned,
                customer,
            ]);
            assert.deepEqual(saved, {
                personal_event_color: personal,
                assignment_event_color: assigned,
                customer_event_color: customer,
                version: 1,
            });
            assert.deepEqual(
                await rpc(first, "get_my_calendar_color_preferences"),
                saved,
            );
            assert.deepEqual(await rpc(second, "get_my_calendar_color_preferences"), {
                personal_event_color: "#E1EDDA",
                assignment_event_color: "#DCE9F8",
                customer_event_color: "#FFF0C5",
                version: 0,
            });
            assert.deepEqual(await rpc(admin, "get_my_calendar_color_preferences"), {
                personal_event_color: "#E1EDDA",
                assignment_event_color: "#DCE9F8",
                customer_event_color: "#FFF0C5",
                version: 0,
            });
            await assert.rejects(
                rpc(first, "save_my_calendar_color_preferences", [
                    0,
                    personal,
                    assigned,
                    customer,
                ]),
                /40001/,
            );
            await assert.rejects(
                rpc(first, "save_my_calendar_color_preferences", [
                    1,
                    "#000000",
                    assigned,
                    customer,
                ]),
                /22023/,
            );
            await assert.rejects(
                actor(
                    second,
                    `select * from private.calendar_color_preferences where user_id='${first}'`,
                ),
                /permission denied/,
            );
            await assert.rejects(
                actor(
                    admin,
                    `update private.calendar_color_preferences set personal_event_color='${customer}' where user_id='${first}'`,
                ),
                /permission denied/,
            );
            const stored = await sql(
                `select count(*) from private.calendar_color_preferences where user_id='${first}'`,
            );
            assert.equal(stored, "1");
        },
    );
});

console.log(`PASS: ${checks} isolated calendar color preference DB groups.`);