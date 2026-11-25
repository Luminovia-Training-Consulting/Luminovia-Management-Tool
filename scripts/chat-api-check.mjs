/**
 * Real Auth/HTTP checks for room membership, messages, company contact and access revocation.
 * Separate fictional identities verify actual API results and denied access; responses are not browser mocks.
 */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {setTimeout as delay} from "node:timers/promises";
import {createClient} from "@supabase/supabase-js";
import {withApiFixture} from "./testing/api.mjs";
import {quoteSql as q} from "./testing/database.mjs";
import { eventually, subscribeToRoom } from "./testing/realtime.mjs";
import {documentedRpc} from "./testing/openapi-contract.mjs";

process.loadEnvFile(".env.test.local");
const url = process.env.SUPABASE_URL;
assert.ok(
    url && ["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname),
    "Chat checks only permit a loopback project.",
);
/** Creates a separate SDK client without persistent sessions or automatic session refresh. */
const make = (key) =>
    createClient(url, key, {
        auth: {persistSession: false, autoRefreshToken: false},
    });
const service = make(process.env.SUPABASE_SERVICE_ROLE_KEY);
const clients = [],
    users = [],
    rooms = [];
let generalRoom;
const suffix = randomUUID();

/** Requires actual SDK success before returning the response data. */
async function checked(request, label) {
    const {data, error} = await request;
    assert.equal(error, null, `${label}: ${error?.message}`);
    return data;
}

/** Creates separate fictional accounts and signs them in through Auth; their IDs belong only to the fixture. */
async function fixture(index, role) {
    const email = `chat-${index}-${suffix}@example.invalid`;
    const created = await checked(
        service.auth.admin.createUser({
            email,
            password: process.env.E2E_PASSWORD,
            email_confirm: true,
        }),
        "Create fictional temporary chat account",
    );
    users.push(created.user.id);
    await checked(
        service.from("user_roles").insert({user_id: created.user.id, role}),
        "Set fixture role",
    );
    await checked(
        service
            .from("profiles")
            .update({display_name: `Chat QA ${index}`})
            .eq("id", created.user.id),
        "Set fictional public name",
    );
    const client = make(process.env.SUPABASE_ANON_KEY);
    clients.push(client);
    const auth = await checked(
        client.auth.signInWithPassword({
            email,
            password: process.env.E2E_PASSWORD,
        }),
        "Actual Auth sign-in",
    );
    await client.realtime.setAuth(auth.session.access_token);
    return {client, id: created.user.id};
}

/** Checks the relationship boundary using the same signed-in actors before and after each committed change. */
async function checkCompanyLecturerAccess({sql, defer}) {
    const company = await fixture("company", "client"),
        foreign = await fixture("foreign-company", "client"),
        lecturer = await fixture("assigned-lecturer", "lecturer");
    const [org, foreignOrg, template, run, job, claim] = Array.from(
        {length: 6}, randomUUID,
    );
    const organisations = [org, foreignOrg].map(q).join(", ");
    defer(() => sql(`
        begin;
        delete from public.job_claims where id = ${q(claim)};
        delete from public.jobs where id = ${q(job)};
        delete from public.course_runs where id = ${q(run)};
        delete from public.course_templates where id = ${q(template)};
        delete from public.client_organisation_memberships where organisation_id in (${organisations});
        delete from public.organisations where id in (${organisations});
        commit;
    `));
    defer(async () => {
        // Include a fixture DM even if an expected denial unexpectedly created it.
        const keys = [company.id, foreign.id].map((id) =>
            [id, lecturer.id].sort().join(":"),
        );
        const fixtureRooms = await checked(
            service.from("chat_rooms").select("id").eq("kind", "dm").in("dm_key", keys),
            "Find only company/lecturer fixture DMs for cleanup",
        );
        rooms.push(...fixtureRooms.map((room) => room.id));
    });
    // Give both tenants Premium to test the assignment boundary, not an entitlement difference.
    await sql(`
        begin;
        insert into public.organisations(id, name) values
            (${q(org)}, ${q(`Fictional Chat Company ${suffix}`)}),
            (${q(foreignOrg)}, ${q(`Fictional Other Company ${suffix}`)});
        insert into public.client_organisation_memberships(user_id, organisation_id) values
            (${q(company.id)}, ${q(org)}), (${q(foreign.id)}, ${q(foreignOrg)});
        insert into private.company_premium_settings(organisation_id, enabled) values
            (${q(org)}, true), (${q(foreignOrg)}, true);
        insert into public.course_templates(id, title) values (${q(template)}, 'Fictional Chat Course');
        insert into public.course_runs(id, template_id, organisation_id) values (${q(run)}, ${q(template)}, ${q(org)});
        insert into public.jobs(id, course_run_id, title, customer_name, delivery_type, status, amount, currency,
                                rate_unit, total_amount, terms)
        values (${q(job)}, ${q(run)}, 'Fictional Chat Assignment', 'Fictional Chat Company', 'online', 'filled',
                100, 'EUR', 'fixed_total', 100, 'Fictional terms');
        commit;
    `);

    /** Contact is reciprocal, whereas the full profile projection is company-to-lecturer only. */
    async function checkContact(tenant, allowed, phase) {
        for (const [actor, peer] of [[tenant, lecturer], [lecturer, tenant]]) {
            const contacts = await documentedRpc(actor.client, "chat_contacts");
            assert.equal(
                contacts.some((contact) => contact.id === peer.id),
                allowed,
                `${phase}: contact from ${actor.id} to ${peer.id}`,
            );
            if (!allowed) {
                await documentedRpc(actor.client, "create_dm", {p_user_id: peer.id}, 403, "42501");
            }
        }
        const profile = {p_user_id: lecturer.id};
        if (allowed) {
            const visible = await documentedRpc(tenant.client, "person_profile", profile);
            assert.equal(visible.id, lecturer.id);
        } else {
            await documentedRpc(tenant.client, "person_profile", profile, 403, "42501");
        }
        await documentedRpc(lecturer.client, "person_profile", {p_user_id: tenant.id}, 403, "42501");
    }

    await checkContact(company, false, "Before confirmed assignment");
    await sql(`
        insert into public.job_claims(id, job_id, lecturer_id, idempotency_key, status, amount, currency,
                                      rate_unit, total_amount, terms, terms_version)
        values (${q(claim)}, ${q(job)}, ${q(lecturer.id)}, ${q(randomUUID())}, 'confirmed',
                100, 'EUR', 'fixed_total', 100, 'Fictional terms', 1);
    `);
    await checkContact(company, true, "After confirmed assignment");
    await checkContact(foreign, false, "Different Premium tenant");

    const room = await documentedRpc(company.client, "create_dm", {p_user_id: lecturer.id});
    assert.equal(await documentedRpc(lecturer.client, "create_dm", {p_user_id: company.id}), room);
    const roomArgs = {p_room_id: room};
    for (const [sender, recipient] of [[company, lecturer], [lecturer, company]]) {
        const listing = await documentedRpc(sender.client, "chat_rooms_with_manual_unread");
        assert.ok(listing.some((entry) => entry.id === room && entry.kind === "dm"));
        const members = await documentedRpc(sender.client, "chat_room_members", roomArgs);
        assert.deepEqual(new Set(members.map((member) => member.user_id)), new Set([company.id, lecturer.id]));
        const body = `Fictional assignment DM from ${sender.id}`;
        const message = await checked(
            sender.client.rpc("send_message", {...roomArgs, p_body: body, p_client_id: randomUUID()}),
            "Send from an assigned DM member",
        );
        const history = await checked(
            recipient.client.rpc("chat_messages", roomArgs),
            "Read from the other DM member",
        );
        const received = history.find((entry) => entry.id === message && entry.sender_id === sender.id);
        assert.equal(received?.body, body);
    }

    /** Requires the existing room to be hidden and normal history/write requests to be denied. */
    async function checkRoomDenied(actor, phase) {
        const listing = await documentedRpc(actor.client, "chat_rooms_with_manual_unread");
        assert.ok(!listing.some((entry) => entry.id === room), `${phase}: DM must be absent from the room list`);
        await documentedRpc(actor.client, "chat_room_members", roomArgs, 403, "42501");
        const history = await actor.client.rpc("chat_messages", roomArgs);
        assert.deepEqual([history.status, history.error?.code], [403, "42501"], `${phase}: read history`);
        const send = await actor.client.rpc("send_message", {
            ...roomArgs, p_body: "Fictional DM access check", p_client_id: randomUUID(),
        });
        assert.deepEqual([send.status, send.error?.code], [403, "42501"], `${phase}: send message`);
    }

    await checkRoomDenied(foreign, "Different Premium tenant");
    // Revoke only the company membership; leave the assignment and DM intact.
    await checked(
        service.from("client_organisation_memberships")
            .update({removed_at: new Date().toISOString()})
            .eq("organisation_id", org).eq("user_id", company.id).is("removed_at", null)
            .select("user_id").single(),
        "Revoke the active fixture company membership",
    );
    await checkContact(company, false, "After company membership revocation");
    await checkRoomDenied(company, "Revoked company member");
    await checkRoomDenied(lecturer, "Lecturer after company membership revocation");
    console.log(
        "PASS: assignment-scoped company/lecturer contacts, profiles and DMs; tenant separation and immediate revocation of DM reads and writes.",
    );
}

try {
    // The shared fixture gates SQL and the Auth/HTTP mutations on a disposable test stack.
    await withApiFixture(checkCompanyLecturerAccess);
    const a = await fixture("alpha", "lecturer"),
        b = await fixture("beta", "lecturer"),
        outsider = await fixture("outsider", "lecturer"),
        admin = await fixture("admin", "admin"),
        participant = await fixture("participant", "participant");
    const contacts = await documentedRpc(a.client, "chat_contacts");
    assert.ok(contacts.some((p) => p.id === b.id));
    assert.ok(!contacts.some((p) => p.id === participant.id));
    assert.ok(
        contacts.every((p) =>
            Object.keys(p).every((k) => ["id", "display_name", "roles"].includes(k)),
        ),
    );
    const dms = await Promise.all([
        documentedRpc(a.client, "create_dm", {p_user_id: b.id}),
        documentedRpc(b.client, "create_dm", {p_user_id: a.id}),
    ]);
    assert.equal(dms[0], dms[1]);
    rooms.push(dms[0]);
    // The membership endpoint exposes only current room members and their minimal public labels.
    const members = await checked(
        a.client.rpc("chat_room_members", {p_room_id: dms[0]}),
        "Actual private DM members",
    );
    assert.deepEqual(
        new Set(members.map((m) => m.user_id)),
        new Set([a.id, b.id]),
    );
    assert.ok(
        members.every((m) =>
            Object.keys(m).every((k) =>
                ["user_id", "display_name", "joined_at"].includes(k),
            ),
        ),
        "Membership projection contains no private profile fields",
    );
    const dm = dms[0],
        key = randomUUID();
    const memberRooms = await documentedRpc(a.client, "chat_rooms_with_manual_unread");
    const outsiderRooms = await documentedRpc(outsider.client, "chat_rooms_with_manual_unread");
    assert.ok(memberRooms.some((room) => room.id === dm && room.kind === "dm"));
    assert.ok(!outsiderRooms.some((room) => room.id === dm));
    await checked(
        a.client.rpc("set_chat_pin", {p_room_id: dm, p_pinned: true}),
        "Pin the caller's room",
    );
    await checked(
        a.client.rpc("set_chat_personal_archive", {p_room_id: dm, p_archived: true}),
        "Archive the caller's room",
    );
    assert.deepEqual(await documentedRpc(a.client, "chat_pinned_rooms"), [dm]);
    assert.deepEqual(await documentedRpc(a.client, "chat_personal_archives"), [dm]);
    assert.deepEqual(await documentedRpc(b.client, "chat_pinned_rooms"), []);
    assert.deepEqual(await documentedRpc(b.client, "chat_personal_archives"), []);
    const message = await checked(
        a.client.rpc("send_message", {
            p_room_id: dm,
            p_body: "Actual private message",
            p_client_id: key,
        }),
        "Send actual private message",
    );
    assert.equal(
        await checked(
            a.client.rpc("send_message", {
                p_room_id: dm,
                p_body: "Actual private message",
                p_client_id: key,
            }),
            "Retry actual message",
        ),
        message,
    );
    assert.equal(
        (
            await checked(
                service.from("messages").select("id").eq("room_id", dm),
                "Check durable message row",
            )
        ).length,
        1,
    );
    assert.equal(
        (await b.client.from("messages").select("body").eq("id", message)).error?.code,
        "42501",
        "A current DM member reads content through history, not the invalidation source",
    );
    assert.equal(
        (await checked(b.client.rpc("chat_messages", {p_room_id: dm}), "Read authorized DM history"))[0].body,
        "Actual private message",
    );
    for (const actor of [outsider, admin]) {
        assert.equal(
            (
                await checked(
                    actor.client.from("messages").select("id").eq("room_id", dm),
                    "Private-message RLS",
                )
            ).length,
            0,
        );
        assert.equal(
            (await actor.client.rpc("chat_room_members", {p_room_id: dm})).error
                ?.code,
            "42501",
            "Nonmember cannot enumerate private room members",
        );
        assert.ok(
            (await actor.client.rpc("chat_messages", {p_room_id: dm})).error,
        );
        assert.ok(
            (
                await actor.client.rpc("send_message", {
                    p_room_id: dm,
                    p_body: "Forged",
                    p_client_id: randomUUID(),
                })
            ).error,
        );
    }
    assert.equal(
        (await participant.client.from("messages").select("id").eq("room_id", dm))
            .error?.code,
        "42501",
        "Retired participant access is denied at the operational portal boundary",
    );
    assert.equal(
        (await participant.client.rpc("chat_room_members", {p_room_id: dm})).error
            ?.code,
        "42501",
    );
    assert.equal(
        (await participant.client.rpc("chat_messages", {p_room_id: dm})).error
            ?.code,
        "42501",
    );
    assert.equal(
        (
            await participant.client.rpc("send_message", {
                p_room_id: dm,
                p_body: "Forged",
                p_client_id: randomUUID(),
            })
        ).error?.code,
        "42501",
    );
    await documentedRpc(participant.client, "ensure_general_chat", {}, 403, "42501");
    generalRoom = await documentedRpc(a.client, "ensure_general_chat");
    assert.equal(await documentedRpc(a.client, "ensure_general_chat"), generalRoom);
    assert.ok(
        (
            await a.client
                .from("chat_members")
                .insert({room_id: dm, user_id: outsider.id})
        ).error,
    );
    await documentedRpc(
        b.client, "react_to_message", {p_message_id: message, p_emoji: "👍"}, 204,
    );
    assert.deepEqual(
        (
            await checked(
                a.client.rpc("chat_messages", {p_room_id: dm}),
                "Read real message with reaction",
            )
        )[0].reactions,
        [{emoji: "👍", count: 1, mine: false}],
    );
    await documentedRpc(
        b.client, "mark_chat_read", {p_room_id: dm, p_message_id: message}, 204,
    );
    assert.equal(
        (await checked(b.client.rpc("chat_rooms_list"), "Unread room list")).find(
            (r) => r.id === dm,
        ).unread_count,
        0,
    );
    await checked(
        a.client.rpc("edit_message", {
            p_message_id: message,
            p_body: "Private corrected text",
        }),
        "Edit actual message",
    );
    for (const actor of [a, admin]) {
        const audit = await actor.client
            .from("chat_message_revisions")
            .select("id")
            .eq("message_id", message);
        assert.deepEqual([audit.status, audit.error?.code, audit.data], [403, "42501", null]);
    }
    await checked(
        a.client.rpc("delete_message", {p_message_id: message}),
        "Delete via tombstone while the DM is accessible",
    );
    const deleted = await checked(
        b.client.rpc("chat_messages", {p_room_id: dm}),
        "Other participant can read the deleted tombstone",
    );
    assert.equal(deleted[0].body, "");
    assert.ok(deleted[0].deleted_at);
    const group = await documentedRpc(a.client, "create_chat_group", {
        p_title: "Fictional Realtime test group",
        p_member_ids: [b.id],
    });
    rooms.push(group);
    assert.deepEqual(
        new Set(
            (
                await checked(
                    b.client.rpc("chat_room_members", {p_room_id: group}),
                    "Actual group membership",
                )
            ).map((m) => m.user_id),
        ),
        new Set([a.id, b.id]),
    );
    const {version} = await documentedRpc(b.client, "chat_group_settings", {p_room_id: group});
    const settings = {
        p_room_id: group,
        p_title: "Fictional group with updated settings",
        p_description: "Visible only to current members.",
        p_expected_version: version,
    };
    await documentedRpc(b.client, "update_chat_group_settings", settings, 403, "42501");
    assert.equal(await documentedRpc(a.client, "update_chat_group_settings", settings), version + 1);
    await documentedRpc(a.client, "update_chat_group_settings", settings, 500, "40001");
    assert.deepEqual(
        await documentedRpc(b.client, "chat_group_settings", {p_room_id: group}),
        {title: settings.p_title, description: settings.p_description, version: version + 1},
    );
    const ownerEvents = [],
        memberEvents = [],
        outsiderEvents = [];
    await subscribeToRoom(a.client, group, "messages", ["INSERT", "UPDATE"], ownerEvents);
    await subscribeToRoom(b.client, group, "messages", ["INSERT", "UPDATE"], memberEvents);
    await subscribeToRoom(
        outsider.client,
        group,
        "messages",
        ["INSERT", "UPDATE"],
        outsiderEvents,
    );
    const visible = await checked(
        a.client.rpc("send_message", {
            p_room_id: group,
            p_body: "Visible before removal",
            p_client_id: randomUUID(),
        }),
        "Send Realtime fixture",
    );
    await eventually(
        () =>
            ownerEvents.some((m) => m.id === visible) &&
            memberEvents.some((m) => m.id === visible),
        "Both actual authorised subscribers receive the committed invalidation",
    );
    await checked(
        a.client.rpc("edit_message", {p_message_id: visible, p_body: "Fictional edit via RPC"}),
        "Edit Realtime fixture",
    );
    await eventually(
        () => [ownerEvents, memberEvents].every((events) =>
            events.filter((event) => event.id === visible).length === 2),
        "Both authorised subscribers receive the edit invalidation too",
    );
    for (const event of [...ownerEvents, ...memberEvents]) {
        assert.deepEqual(event, {id: visible, room_id: group}, "No message text or other fields on the wire");
    }
    assert.equal(
        outsiderEvents.length,
        0,
        "Nonmember receives no persisted private events",
    );
    await checked(
        a.client.rpc("manage_chat_member", {
            p_room_id: group,
            p_user_id: b.id,
            p_remove: true,
        }),
        "Remove existing subscriber",
    );
    const hidden = await checked(
        a.client.rpc("send_message", {
            p_room_id: group,
            p_body: "Not visible after removal",
            p_client_id: randomUUID(),
        }),
        "Send after membership revocation",
    );
    await eventually(
        () => ownerEvents.some((m) => m.id === hidden),
        "Owner Realtime remains healthy after removal",
    );
    await delay(1200);
    assert.ok(
        !memberEvents.some((m) => m.id === hidden),
        "An already subscribed removed member receives no later message",
    );
    assert.ok((await b.client.rpc("chat_messages", {p_room_id: group})).error);
    // An existing signed-in session loses membership enumeration immediately after removal.
    assert.equal(
        (await b.client.rpc("chat_room_members", {p_room_id: group})).error?.code,
        "42501",
        "Already signed-in removed member cannot enumerate membership",
    );
    assert.deepEqual(
        (
            await checked(
                a.client.rpc("chat_room_members", {p_room_id: group}),
                "Removed member disappears from current projection",
            )
        ).map((m) => m.user_id),
        [a.id],
    );
    assert.ok(
        (
            await b.client.rpc("send_message", {
                p_room_id: group,
                p_body: "Removed member forged send",
                p_client_id: randomUUID(),
            })
        ).error,
    );
    assert.equal(
        (
            await checked(
                b.client.from("messages").select("id").eq("room_id", group),
                "Revoked direct REST read",
            )
        ).length,
        0,
    );
    await checked(
        a.client.rpc("manage_chat_member", {
            p_room_id: group,
            p_user_id: b.id,
            p_remove: false,
        }),
        "Re-add fixture member",
    );
    await checked(
        service.from("profiles").update({active: false}).eq("id", b.id),
        "Suspend only temporary QA account",
    );
    const suspended = await checked(
        a.client.rpc("send_message", {
            p_room_id: group,
            p_body: "Not visible after suspension",
            p_client_id: randomUUID(),
        }),
        "Send after suspension",
    );
    await eventually(
        () => ownerEvents.some((m) => m.id === suspended),
        "Owner delivery remains healthy after suspension",
    );
    await delay(1200);
    assert.ok(
        !memberEvents.some((m) => m.id === suspended),
        "A subscribed suspended account receives no later persisted event",
    );
    assert.equal(
        (await b.client.rpc("chat_rooms_list")).error?.code,
        "42501",
        "Suspended accounts cannot enumerate operational chat rooms",
    );
    assert.equal(
        (await b.client.rpc("chat_room_members", {p_room_id: group})).error?.code,
        "42501",
        "Already signed-in suspended member cannot enumerate membership",
    );
    const deleteDenied = await a.client.rpc("delete_message", {p_message_id: message});
    assert.deepEqual([deleteDenied.status, deleteDenied.error?.code], [403, "42501"]);
    console.log(
        "PASS: actual Auth/REST and real WebSockets: race-safe private DMs, durable/idempotent messages, minimal directory, unread/reactions/edit/delete, admin/outsider/participant privacy, forged writes denied, active Realtime before removal, no later delivery after revocation or suspension.",
    );
} finally {
    for (const client of clients) await client.removeAllChannels();
    if (generalRoom)
        await checked(
            service.from("chat_members")
                .delete()
                .eq("room_id", generalRoom)
                .in("user_id", users),
            "Remove only this fixture's lecturer-room memberships",
        );
    if (rooms.length) {
        const messages = await checked(
            service.from("messages").select("id").in("room_id", rooms),
            "Read only scoped QA messages for cleanup",
        );
        const ids = messages.map((m) => m.id);
        if (ids.length) {
            await checked(
                service.from("notifications").delete().in("resource_id", ids),
                "Remove only QA notifications",
            );
            await checked(
                service.from("message_reactions").delete().in("message_id", ids),
                "Remove only QA reactions",
            );
            await checked(
                service.from("chat_message_revisions").delete().in("message_id", ids),
                "Remove only QA revisions",
            );
            await checked(
                service.from("messages").delete().in("id", ids),
                "Remove only QA messages",
            );
        }
        await checked(
            service.from("chat_members").delete().in("room_id", rooms),
            "Remove only QA memberships",
        );
        await checked(
            service.from("chat_rooms").delete().in("id", rooms),
            "Remove only QA rooms",
        );
        await checked(
            service.from("audit_events").delete().in("resource_id", rooms),
            "Remove only QA group audit",
        );
    }
    for (const id of users)
        await checked(
            service.auth.admin.deleteUser(id),
            "Remove temporary QA account",
        );
}
