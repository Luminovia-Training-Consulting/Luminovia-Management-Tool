/** Native Auth/REST calendar metadata has no manager-wide or retained-role bypass. */
import assert from "node:assert/strict";
import {withApiFixture} from "./testing/api.mjs";
import {cleanupCalendarMetadata, seedCalendarMetadata,} from "./testing/calendar-metadata-fixture.mjs";

await withApiFixture(async ({actor, sql, checked, defer, service}) => {
    const teacher = await actor("calendar-metadata-teacher", "lecturer"),
        peer = await actor("calendar-metadata-peer", "lecturer"),
        admin = await actor("calendar-metadata-admin", "admin");
    const f = await seedCalendarMetadata(sql, teacher.id, peer.id);
    defer(() => cleanupCalendarMetadata(sql, f));
    const args = {p_job_ids: [f.linked, f.manual, f.foreign]};
    const rows = await checked(
        teacher.client.rpc("assignment_calendar_metadata", args),
        "Read own calendar metadata",
    );
    assert.deepEqual(
        new Set(rows.map((x) => x.id)),
        new Set([f.linked, f.manual]),
    );
    assert.equal(rows.find((x) => x.id === f.linked).topics.length, 2);
    assert.deepEqual(Object.keys(rows[0]).sort(), [
        "id",
        "organisation_id",
        "organisation_name",
        "title",
        "topics",
    ]);
    assert.deepEqual(
        await checked(
            admin.client.rpc("assignment_calendar_metadata", args),
            "No administrator assignment bypass",
        ),
        [],
    );
    await checked(
        service
            .from("job_claims")
            .update({status: "cancelled"})
            .eq("lecturer_id", teacher.id),
        "Cancel own fixture assignments",
    );
    assert.deepEqual(
        await checked(
            teacher.client.rpc("assignment_calendar_metadata", args),
            "Current confirmed allocations only",
        ),
        [],
    );
    await checked(
        service.from("user_roles").delete().eq("user_id", peer.id),
        "Revoke peer role",
    );
    assert.equal(
        (await peer.client.rpc("assignment_calendar_metadata", args)).error?.code,
        "42501",
    );
    console.log(
        "PASS native Auth/REST own calendar descriptions, cancelled claims, current-role denial and manager privacy",
    );
});