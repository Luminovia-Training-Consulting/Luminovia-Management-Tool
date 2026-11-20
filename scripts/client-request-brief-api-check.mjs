import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {withApiFixture} from "./testing/api.mjs";
import {quoteSql as q} from "./testing/database.mjs";

await withApiFixture(async ({actor, checked, service, sql, defer, url}) => {
    const customer = await actor("request-brief-client", "client"),
        peer = await actor("request-brief-peer", "client"),
        foreign = await actor("request-brief-foreign", "client");
    const org = randomUUID(),
        other = randomUUID(),
        users = [customer.id, peer.id, foreign.id],
        requests = [];
    let document;
    defer(async () => {
        if (requests.length)
            await sql(
                `delete from private.client_course_requests where id in(${requests.map(q).join(",")})`,
            );
        if (document) {
            const versions = await checked(
                service
                    .from("document_versions")
                    .select("object_path")
                    .eq("document_id", document.id),
            );
            const paths = versions.map((v) => v.object_path);
            await checked(service.storage.from("portal-clean").remove(paths));
            await checked(service.storage.from("portal-quarantine").remove(paths));
            await checked(
                service
                    .from("documents")
                    .update({current_version_id: null})
                    .eq("id", document.id),
            );
            await checked(
                service
                    .from("document_versions")
                    .delete()
                    .eq("document_id", document.id),
            );
            await checked(service.from("documents").delete().eq("id", document.id));
        }
        await sql(
            `delete from public.notifications where user_id in(${users.map(q).join(",")});delete from public.client_organisation_memberships where organisation_id in(${q(org)},${q(other)});delete from public.organisations where id in(${q(org)},${q(other)});`,
        );
    });
    await sql(
        `insert into public.organisations(id,name)values(${q(org)},'Fictional request brief academy'),(${q(other)},'Other fictional request academy');insert into public.client_organisation_memberships(user_id,organisation_id)values(${q(customer.id)},${q(org)}),(${q(peer.id)},${q(org)}),(${q(foreign.id)},${q(other)});`,
    );
    const payload = {
        title: "Fictional API teaching brief",
        description: "Auth API course request",
        delivery_type: "online",
        location: "https://example.invalid/course",
        time_zone: "Europe/Berlin",
        sessions: [
            {
                starts_at: new Date(Date.now() + 10 * 86400000).toISOString(),
                ends_at: new Date(Date.now() + 10 * 86400000 + 3600000).toISOString(),
            },
        ],
        topic_ids: [],
        gross_amount: 800,
        gross_total_amount: 800,
        currency: "EUR",
        rate_unit: "fixed_total",
    };
    let brief = {
        teaching_units: 1,
        unit_minutes: 45,
        required_documents: ["Accessible handout"],
        instructions: "Fictional lab access required",
        documents: [],
    };
    const key = randomUUID(),
        args = {
            p_organisation_id: org,
            p_payload: payload,
            p_client_id: key,
            p_brief: brief,
        };
    assert.ok(
        (
            await customer.client.rpc("create_client_request_with_brief", {
                ...args,
                p_brief: {...brief, teaching_units: 2},
            })
        ).error,
    );
    const request = await checked(
        customer.client.rpc("create_client_request_with_brief", args),
    );
    requests.push(request);
    assert.equal(
        await checked(
            customer.client.rpc("create_client_request_with_brief", args),
        ),
        request,
    );
    assert.ok(
        (
            await customer.client.rpc("create_client_request_with_brief", {
                ...args,
                p_brief: {...brief, instructions: "Changed retry"},
            })
        ).error,
    );
    const read = (who) =>
        who.client.rpc("client_request_brief", {p_request_id: request});
    assert.equal((await checked(read(peer))).version, 1);
    for (const name of ["client_request_brief", "client_request_history"]) {
        assert.ok(
            (await foreign.client.rpc(name, {p_request_id: request})).error,
        );
    }
    brief = {...brief, instructions: "Revised preparation instructions"};
    await checked(
        customer.client.rpc("save_client_request_brief", {
            p_request_id: request,
            p_brief: brief,
            p_expected_version: 1,
        }),
    );
    const stale = await peer.client.rpc("save_client_request_brief", {
        p_request_id: request,
        p_brief: brief,
        p_expected_version: 1,
    });
    assert.equal(stale.error.code, "40001");
    const history = await checked(
        peer.client.rpc("client_request_history", {p_request_id: request}),
    );
    assert.equal(history[0].snapshot.brief.instructions, brief.instructions);
    assert.equal(
        history[1].snapshot.brief.instructions,
        "Fictional lab access required",
    );
    const origin = new URL(process.env.E2E_BASE_URL).origin;

    async function headers(who) {
        const session = (await who.client.auth.getSession()).data.session;
        return {
            Origin: origin,
            Authorization: `Bearer ${session.access_token}`,
            apikey: process.env.SUPABASE_ANON_KEY,
        };
    }

    const bytes = new TextEncoder().encode(
        "Fictional clean request materials, exact agreed first version.",
    );

    async function upload(replace = false) {
        const form = new FormData();
        form.set(
            "file",
            new File(
                [
                    replace
                        ? new TextEncoder().encode("New private replacement, not shared")
                        : bytes,
                ],
                replace ? "Private-replacement.txt" : "Request-material.txt",
                {type: "text/plain"},
            ),
        );
        form.set("scope", "personal");
        form.set("kind", "material");
        form.set("client_id", randomUUID());
        if (replace) form.set("replace_id", document.id);
        const response = await fetch(`${url}/functions/v1/files`, {
            method: "POST",
            headers: await headers(customer),
            body: form,
            signal: AbortSignal.timeout(90000),
        });
        assert.equal(response.status, 200);
        return (await response.json()).document;
    }

    document = await upload();
    assert.equal(document.status, "clean");
    const original = document.current_version_id;
    brief = {
        ...brief,
        documents: [{version_id: original, category: "material"}],
    };
    await checked(
        customer.client.rpc("save_client_request_brief", {
            p_request_id: request,
            p_brief: brief,
            p_expected_version: 2,
        }),
    );

    async function download(who) {
        return fetch(`${url}/functions/v1/course-documents`, {
            method: "POST",
            headers: {...(await headers(who)), "Content-Type": "application/json"},
            body: JSON.stringify({
                kind: "request_resource",
                request_id: request,
                id: original,
            }),
            signal: AbortSignal.timeout(30000),
        });
    }

    const downloaded = await download(peer);
    assert.equal(downloaded.status, 200);
    assert.deepEqual(new Uint8Array(await downloaded.arrayBuffer()), bytes);
    assert.equal(downloaded.headers.get("cache-control"), "no-store, private");
    assert.equal((await download(foreign)).status, 403);
    const normal = await fetch(`${url}/functions/v1/files`, {
        method: "POST",
        headers: {...(await headers(peer)), "Content-Type": "application/json"},
        body: JSON.stringify({
            action: "download",
            id: document.id,
            version_id: original,
        }),
    });
    assert.equal(normal.status, 403);
    await upload(true);
    const stillOriginal = await download(peer);
    assert.equal(stillOriginal.status, 200);
    assert.deepEqual(new Uint8Array(await stillOriginal.arrayBuffer()), bytes);
    brief = {...brief, documents: []};
    await checked(
        customer.client.rpc("save_client_request_brief", {
            p_request_id: request,
            p_brief: brief,
            p_expected_version: 3,
        }),
    );
    assert.equal((await download(peer)).status, 403);
    await sql(
        `update public.client_organisation_memberships set removed_at=now() where user_id=${q(peer.id)} and organisation_id=${q(org)}`,
    );
    assert.ok((await read(peer)).error);
    await checked(
        customer.client.rpc("cancel_client_request", {p_request_id: request}),
    );
    assert.equal((await checked(read(customer))).editable, false);
    assert.ok(
        (
            await customer.client.rpc("save_client_request_brief", {
                p_request_id: request,
                p_brief: brief,
                p_expected_version: 4,
            })
        ).error,
    );
    assert.equal(
        (
            await checked(
                customer.client.rpc("client_request_history", {
                    p_request_id: request,
                }),
            )
        )[0].event,
        "cancelled",
    );
    console.log(
        "Actual Auth/REST scanned customer request brief, history, CAS, exact bytes and revocation passed.",
    );
});