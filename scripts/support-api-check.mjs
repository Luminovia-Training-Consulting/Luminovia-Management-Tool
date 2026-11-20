/** Real Auth/password-only authentication/REST/scanner/gateway support journey in canonical QA only. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {withApiFixture} from "./testing/api.mjs";

await withApiFixture(
    async ({
               service,
               actor,
               passwordOnly,
               checked,
               sql,
               defer,
               url,
               suffix,
           }) => {
        const origin = new URL(
            process.env.PORTAL_APP_ORIGIN ??
            process.env.E2E_BASE_URL ??
            "http://127.0.0.1:5273",
        ).origin;
        const requester = await actor("support-requester", "lecturer"),
            peer = await actor("support-peer", "lecturer"),
            manager = await actor("support-manager", "management");
        const users = [requester.id, peer.id, manager.id];
        const documents = [];
        defer(async () => {
            const quoted = users.map((id) => `'${id}'`).join(",");
            await sql(`delete
                       from public.notifications
                       where resource_id in (select id from private.support_tickets where requester_id in (${quoted}));
      delete from private.support_attachments where ticket_id in(select id from private.support_tickets where requester_id in(${quoted}));
      delete from private.support_requests where actor_id in(${quoted}) or ticket_id in(select id from private.support_tickets where requester_id in(${quoted}));
      delete from private.support_events where ticket_id in(select id from private.support_tickets where requester_id in(${quoted}));
      delete from private.support_messages where ticket_id in(select id from private.support_tickets where requester_id in(${quoted}));
      delete from private.support_tickets where requester_id in(${quoted});`);
            for (const document of documents) {
                const versions = await checked(
                    service
                        .from("document_versions")
                        .select("object_path")
                        .eq("document_id", document),
                );
                for (const bucket of ["portal-clean", "portal-quarantine"])
                    if (versions.length)
                        await checked(
                            service.storage
                                .from(bucket)
                                .remove(versions.map((v) => v.object_path)),
                            "Remove own support test bytes",
                        );
                await checked(
                    service
                        .from("documents")
                        .update({current_version_id: null})
                        .eq("id", document),
                );
                await checked(
                    service
                        .from("document_versions")
                        .delete()
                        .eq("document_id", document),
                );
                await checked(service.from("documents").delete().eq("id", document));
            }
        });
        const request = randomUUID(),
            payload = {
                title: `Fictional support ${suffix}`,
                category: "technical",
                description: "Expected a fictional course page to load.",
            };
        const create = () =>
            requester.client.rpc("create_support_ticket", {
                p_payload: payload,
                p_request_id: request,
            });
        const results = await Promise.all([checked(create()), checked(create())]);
        assert.equal(results[0], results[1]);
        const id = results[0];
        const get = (client) =>
            checked(client.rpc("support_ticket", {p_ticket_id: id}));
        const update = (client, action, payload, version, key = randomUUID()) =>
            client.rpc("update_support_ticket", {
                p_ticket_id: id,
                p_action: action,
                p_payload: payload,
                p_expected_version: version,
                p_request_id: key,
            });
        assert.ok(
            (await peer.client.rpc("support_ticket", {p_ticket_id: id})).error,
            "Foreign account denied over actual REST",
        );
        assert.equal(
            (await checked(peer.client.rpc("support_tickets", {p_search: suffix})))
                .items.length,
            0,
        );
        await passwordOnly(manager.client);
        assert.equal(
            (await get(manager.client)).can_manage,
            true,
            "Permissioned management works with password-only AAL1 and no enrolled factors",
        );
        await checked(
            update(
                requester.client,
                "reply",
                {body: "Fictional reproduction supplied"},
                1,
            ),
        );
        await checked(
            update(
                manager.client,
                "internal_note",
                {body: "RESTRICTED fictional internal analysis"},
                2,
            ),
        );
        assert.equal((await get(requester.client)).messages.length, 1);
        assert.equal((await get(manager.client)).messages.length, 2);
        assert.equal(
            JSON.stringify(await get(requester.client)).includes("RESTRICTED"),
            false,
        );
        const upload = async (person, name) => {
            const session = (await person.client.auth.getSession()).data.session;
            const form = new FormData();
            form.set(
                "file",
                new Blob(["Fictional support log. No real data."], {
                    type: "text/plain",
                }),
                name,
            );
            form.set("scope", "personal");
            form.set("kind", "material");
            form.set("client_id", randomUUID());
            const response = await fetch(`${url}/functions/v1/files`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${session.access_token}`,
                    apikey: process.env.SUPABASE_ANON_KEY,
                    Origin: origin,
                },
                body: form,
            });
            assert.equal(
                response.status,
                200,
                "Existing actual scanner accepts dedicated support text upload",
            );
            const result = await response.json();
            assert.equal(result.document.status, "clean");
            documents.push(result.document.id);
            return result.document;
        };
        const file = await upload(requester, "fictional-support.txt");
        await checked(
            update(
                requester.client,
                "attach",
                {document_id: file.id, internal: false},
                3,
            ),
        );
        const download = async (person, doc) =>
            fetch(`${url}/functions/v1/files`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${(await person.client.auth.getSession()).data.session.access_token}`,
                    apikey: process.env.SUPABASE_ANON_KEY,
                    Origin: origin,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    action: "download",
                    id: doc.id,
                    version_id: doc.current_version_id,
                }),
            });
        const staffDownload = await download(manager, file);
        assert.equal(staffDownload.status, 200);
        assert.equal(
            await staffDownload.text(),
            "Fictional support log. No real data.",
        );
        assert.equal(
            (await download(peer, file)).status,
            403,
            "Unrelated user cannot download guessed support evidence",
        );
        const internal = await upload(manager, "fictional-internal.txt");
        await checked(
            update(
                manager.client,
                "attach",
                {document_id: internal.id, internal: true},
                4,
            ),
        );
        assert.equal(
            (await download(requester, internal)).status,
            403,
            "Requester cannot download internal note attachment",
        );
        assert.equal((await get(requester.client)).attachments.length, 1);
        const race = await Promise.all([
            update(manager.client, "priority", {priority: "high"}, 5),
            update(manager.client, "assign", {user_id: manager.id}, 5),
        ]);
        assert.equal(race.filter((r) => !r.error).length, 1);
        assert.equal(race.filter((r) => r.error?.code === "40001").length, 1);
        let version = 6;
        for (const status of [
            "in_progress",
            "waiting_for_user",
            "resolved",
            "closed",
        ])
            await checked(
                update(
                    manager.client,
                    "status",
                    {status, reason: `Fictional ${status} reason`},
                    version++,
                ),
            );
        assert.equal((await get(requester.client)).status, "closed");
        await checked(
            update(
                requester.client,
                "reopen",
                {reason: "Fictional regression remains"},
                version,
            ),
        );
        assert.equal((await get(requester.client)).status, "open");
        assert.equal(
            (await get(requester.client)).events.filter((e) => e.action === "status")
                .length,
            4,
        );
        await checked(
            service.from("user_roles").delete().eq("user_id", manager.id),
        );
        assert.ok(
            (await manager.client.rpc("support_ticket", {p_ticket_id: id})).error,
            "Current role revocation denies existing token",
        );
        assert.equal((await download(manager, file)).status, 403);
        assert.equal(
            (await download(manager, internal)).status,
            403,
            "Former support upload ownership cannot bypass internal ticket access",
        );
        console.log(
            "PASS actual support Auth/password-only authentication/REST idempotency, immutable replies/lifecycle/reopen, two-change conflict, scanner/gateway attachment privacy and current revocation",
        );
    },
);