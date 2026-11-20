/** Native authenticated import remains an atomic, idempotent owner-only operation. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {withApiFixture} from "./testing/api.mjs";

await withApiFixture(async ({actor, checked, sql, defer}) => {
    const owner = await actor("calendar-import-owner", "lecturer");
    const peer = await actor("calendar-import-peer", "lecturer");
    defer(() =>
        sql(
            `delete from public.personal_events where user_id in('${owner.id}','${peer.id}')`,
        ),
    );
    const event = {
        uid: randomUUID(),
        title: "Fictional native ICS appointment",
        description: "Private import",
        starts_at: "2042-08-01T09:00:00Z",
        ends_at: "2042-08-01T10:00:00Z",
        time_zone: "Europe/Berlin",
    };
    const result = await checked(
        owner.client.rpc("import_my_calendar", {p_events: [event]}),
        "Import reviewed calendar batch",
    );
    assert.deepEqual(result, {created: 1, skipped: 0});
    assert.deepEqual(
        await checked(
            owner.client.rpc("import_my_calendar", {p_events: [event]}),
            "Repeat import without duplicates",
        ),
        {created: 0, skipped: 1},
    );
    const foreign = await checked(
        peer.client.from("personal_events").select("id").eq("user_id", owner.id),
        "Foreign import privacy",
    );
    assert.deepEqual(foreign, []);
    const denied = await owner.client.rpc("import_my_calendar", {
        p_events: [
            {...event, uid: randomUUID()},
            {...event, uid: randomUUID(), ends_at: "2041-01-01T00:00:00Z"},
        ],
    });
    assert.equal(denied.error?.code, "22023");
    const remaining = await checked(
        owner.client.from("personal_events").select("id"),
        "Failed import atomicity",
    );
    assert.equal(remaining.length, 1);
    console.log(
        "PASS native ICS batch import, duplicate skip, peer privacy and full rollback",
    );
});