/** Actual scoped profile-edit RPC checks: hierarchy, privacy, concurrency and validation. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import {portalOpenApi} from "../src/features/developer-api/contract.ts";
import {quoteSql as q, withTestDatabase} from "./testing/database.mjs";

const {paths} = portalOpenApi("https://portal.example.invalid");
const readProfile = paths["/rest/v1/rpc/managed_profile"].post;
const writeProfile = paths["/rest/v1/rpc/save_managed_profile"].post;
const readResponse = z.fromJSONSchema(readProfile.responses["200"].content["application/json"].schema);
const writeResponse = z.fromJSONSchema(writeProfile.responses["200"].content["application/json"].schema);
const writeRequest = z.fromJSONSchema(writeProfile.requestBody.content["application/json"].schema);

await withTestDatabase("managed_profile", async ({sql, actor}) => {
    const admin = randomUUID(),
        manager = randomUUID(),
        lecturer = randomUUID(),
        owner = randomUUID();
    await sql(
        `insert into auth.users(id,email) values${[admin, manager, lecturer, owner].map((id) => `('${id}','${id}@example.invalid')`).join(",")};insert into public.user_roles(user_id,role) values('${admin}','admin'),('${manager}','management'),('${lecturer}','lecturer'),('${owner}','owner');update public.profiles set display_name='Fictional person',phone='private'`,
    );
    const read = (who, id) =>
        actor(who, `select public.managed_profile('${id}')`)
            .then(JSON.parse)
            .then((body) => readResponse.parse(body));
    const save = (who, id, payload, expected) =>
        actor(
            who,
            `select public.save_managed_profile('${id}',${q(JSON.stringify(payload))}::jsonb,${q(JSON.stringify(expected))}::jsonb)`,
        );
    const old = await read(manager, lecturer);
    assert.deepEqual(Object.keys(old).sort(), [
        "display_name",
        "locale",
        "time_zone",
    ]);
    const values = {
        display_name: "Updated teacher",
        locale: "en",
        time_zone: "Australia/Brisbane",
    };
    writeRequest.parse({p_user_id: lecturer, p_payload: values, p_expected: old});
    assert.deepEqual(
        writeResponse.parse(JSON.parse(await save(manager, lecturer, values, old))),
        values,
    );
    assert.deepEqual(await read(admin, lecturer), values);
    await assert.rejects(
        save(manager, lecturer, {...values, display_name: "Stale"}, old),
        /40001|Profile changed/,
    );
    for (const [who, id] of [
        [lecturer, manager],
        [manager, admin],
        [admin, owner],
        [manager, manager],
    ])
        await assert.rejects(read(who, id), /42501|subordinate/);
    for (const payload of [
        {...values, active: false},
        {...values, locale: "fr"},
        {...values, time_zone: "unknown"},
        {...values, display_name: ""},
    ])
        await assert.rejects(
            save(admin, lecturer, payload, values),
            /22023|Invalid/,
        );
    assert.equal(
        await sql(`select phone from public.profiles where id='${lecturer}'`),
        "private",
    );
    assert.equal(
        await sql(
            `select count(*) from public.audit_events where action='account.profile_updated' and resource_id='${lecturer}'`,
        ),
        "1",
    );
    await sql(
        `delete from public.user_roles where user_id='${manager}' and role='management'`,
    );
    await assert.rejects(
        save(manager, lecturer, values, values),
        /42501|subordinate/,
    );
    assert.equal(
        await sql(
            `select has_function_privilege('anon','public.save_managed_profile(uuid,jsonb,jsonb)','execute')`,
        ),
        "f",
    );
    console.log(
        "PASS managed profile hierarchy, fields/privacy, stale writes, invalid inputs, audit and revoked authority",
    );
});