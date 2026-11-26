/** Actual disposable Auth/REST task privacy, CAS, bulk, workflows and source revocation. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {withApiFixture} from "./testing/api.mjs";
import {quoteSql as q} from "./testing/database.mjs";

await withApiFixture(async ({actor, service, checked, sql, defer}) => {
    const owner = await actor("workbench-owner", "lecturer"),
        peer = await actor("workbench-peer", "lecturer"),
        admin = await actor("workbench-admin", "admin");
    const users = [owner.id, peer.id, admin.id];
    let room;
    const topic = randomUUID();
    defer(async () => {
        await checked(
            service.from("notifications").delete().in("user_id", users),
            "Remove owned task notices",
        );
        await sql(
            `delete from private.work_task_history where task_id in(select id from private.work_tasks where creator_id in(${users.map(q).join(",")}));delete from private.work_template_runs where user_id in(${users.map(q).join(",")});delete from private.work_tasks where creator_id in(${users.map(q).join(",")});delete from private.work_task_templates where creator_id in(${users.map(q).join(",")});`,
        );
        if (room)
            await sql(
                `delete from public.chat_message_revisions where message_id in(select id from public.messages where room_id=${q(room)});delete from public.message_reactions where message_id in(select id from public.messages where room_id=${q(room)});delete from public.messages where room_id=${q(room)};delete from public.chat_members where room_id=${q(room)};delete from public.chat_rooms where id=${q(room)}`,
            );
        await checked(
            service.from("topics").delete().eq("id", topic),
            "Remove exact favourite topic",
        );
    });
    const payload = {
        title: "Fictional private follow-up",
        description: "Authored task text",
        state: "open",
        due_at: null,
        time_zone: "Australia/Brisbane",
        scope: "private",
        assignee_id: owner.id,
        source_message_id: null,
    };
    const create = async (extra = {}, client = randomUUID()) =>
        checked(
            owner.client.rpc("save_work_task", {
                p_id: null,
                p_payload: {...payload, ...extra},
                p_expected_version: 0,
                p_client_id: client,
            }),
            "Create own real task",
        );
    const taskList = async ({client}) =>
        (await checked(client.rpc("work_tasks"))).items;
    // Operations tasks from other fixtures may be legitimately visible to an admin.
    const [peerBefore, adminBefore] = await Promise.all([
        taskList(peer),
        taskList(admin),
    ]);
    const request = randomUUID(),
        task = await create({}, request),
        repeated = await create({}, request);
    assert.equal(task.id, repeated.id);
    assert.equal(
        (await checked(owner.client.rpc("work_task_detail", {p_id: task.id}))).id,
        task.id,
    );
    assert.equal(
        await checked(peer.client.rpc("work_task_detail", {p_id: task.id})),
        null,
    );
    assert.equal(
        await checked(admin.client.rpc("work_task_detail", {p_id: task.id})),
        null,
    );
    assert.ok((await taskList(owner)).some(({id}) => id === task.id));
    assert.deepEqual(await taskList(peer), peerBefore);
    assert.deepEqual(await taskList(admin), adminBefore);
    const saves = await Promise.all(
        ["doing", "done"].map((state) =>
            owner.client.rpc("save_work_task", {
                p_id: task.id,
                p_payload: {...payload, state},
                p_expected_version: task.version,
                p_client_id: null,
            }),
        ),
    );
    assert.equal(saves.filter((r) => !r.error).length, 1);
    assert.equal(saves.find((r) => r.error).error.code, "40001");
    const other = await create({title: "Fictional second task"});
    const updated = (await checked(owner.client.rpc("work_tasks"))).items.find(
        (t) => t.id === task.id,
    );
    const rejected = await owner.client.rpc("bulk_work_task_state", {
        p_items: [
            {id: updated.id, version: updated.version},
            {id: other.id, version: 999},
        ],
        p_state: "done",
    });
    assert.equal(rejected.error?.code, "40001");
    assert.equal(
        (await checked(owner.client.rpc("work_tasks"))).items.find(
            (t) => t.id === other.id,
        ).state,
        "open",
    );
    await checked(
        owner.client.rpc("bulk_work_task_state", {
            p_items: [
                {id: updated.id, version: updated.version},
                {id: other.id, version: other.version},
            ],
            p_state: "done",
        }),
        "Commit whole bulk batch",
    );
    assert.equal(
        (await checked(owner.client.rpc("work_task_history", {p_id: task.id})))
            .length,
        3,
    );
    assert.equal(
        (await peer.client.rpc("work_task_history", {p_id: task.id})).error?.code,
        "42501",
    );
    const template = await checked(
        owner.client.rpc("save_work_template", {
            p_id: null,
            p_payload: {
                title: "Fictional workflow",
                shared: false,
                archived: false,
                items: [
                    {title: "Check material", days: 1},
                    {title: "Contact client", days: 2},
                ],
            },
            p_expected_version: 0,
        }),
        "Create workflow rows",
    );
    const applyRequest = randomUUID();
    const applied = await checked(
        owner.client.rpc("apply_work_template", {
            p_id: template.id,
            p_expected_version: template.version,
            p_client_id: applyRequest,
        }),
    );
    assert.deepEqual(
        await checked(
            owner.client.rpc("apply_work_template", {
                p_id: template.id,
                p_expected_version: template.version,
                p_client_id: applyRequest,
            }),
        ),
        applied,
    );
    assert.equal(applied.length, 2);
    await checked(
        service.from("topics").insert({
            id: topic,
            label_de: "Fictional API favourite",
            label_en: "Fictional API favourite",
            kind: "topic",
        }),
    );
    await checked(
        owner.client.rpc("set_favourite", {
            p_kind: "topic",
            p_id: topic,
            p_enabled: true,
        }),
    );
    assert.equal(
        (await checked(owner.client.rpc("my_favourites"))).items[0].id,
        topic,
    );
    assert.deepEqual((await checked(peer.client.rpc("my_favourites"))).items, []);
    room = await checked(owner.client.rpc("create_dm", {p_user_id: peer.id}));
    const message = await checked(
        owner.client.rpc("send_message", {
            p_room_id: room,
            p_body: "CONFIDENTIAL CHAT TEXT",
            p_client_id: randomUUID(),
        }),
    );
    const source = typeof message === "string" ? message : message.id;
    const linked = await create({
        title: "Private linked action",
        source_message_id: source,
    });
    assert.equal(linked.source_message_id, source);
    assert.equal(linked.source_room_id, room);
    assert.ok(!JSON.stringify(linked).includes("CONFIDENTIAL CHAT TEXT"));
    await checked(
        service
            .from("chat_members")
            .update({removed_at: new Date().toISOString()})
            .eq("room_id", room)
            .eq("user_id", owner.id),
    );
    assert.ok(
        !(await checked(owner.client.rpc("work_tasks"))).items.some(
            (t) => t.id === linked.id,
        ),
    );
    assert.equal(
        (await owner.client.rpc("work_task_history", {p_id: linked.id})).error
            ?.code,
        "42501",
    );
    console.log(
        "PASS actual Auth/REST private task ownership/admin isolation, stable create retries, CAS, atomic bulk rollback/commit/history, workflow row application, personal favourites and chat-source access revocation",
    );
});