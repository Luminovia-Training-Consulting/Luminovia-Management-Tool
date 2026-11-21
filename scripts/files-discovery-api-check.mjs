/** Canonical real Auth/REST cap reproduction and private document organisation. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {createClient} from "@supabase/supabase-js";
import {withApiFixture} from "./testing/api.mjs";
import {assertLmsResponse} from "./testing/premium-lms-contract.mjs";

await withApiFixture(
    async ({actor, passwordOnly, service, checked, defer, url, suffix}) => {
        const owner = await actor("file-discovery-owner", "lecturer"),
            peer = await actor("file-discovery-peer", "lecturer"),
            admin = await actor("file-discovery-admin", "admin"),
            users = [owner.id, peer.id, admin.id],
            job = randomUUID();
        defer(async () => {
            await checked(
                service.from("documents").delete().in("owner_id", users),
                "Remove scoped metadata fixtures",
            );
            await checked(
                service.from("jobs").delete().eq("id", job),
                "Remove scoped sharing fixture",
            );
        });
        const needle = `Old-needle-${suffix}.txt`,
            oldest = randomUUID(),
            rows = Array.from({length: 1005}, (_, i) => ({
                id: i === 1004 ? oldest : randomUUID(),
                owner_id: owner.id,
                uploaded_by: owner.id,
                scope: "personal",
                kind: "material",
                original_name: i === 1004 ? needle : `Recent-${suffix}-${i}.txt`,
                mime_type: "text/plain",
                size_bytes: 10,
                client_id: randomUUID(),
                created_at: new Date(Date.now() - i * 1000).toISOString(),
            }));
        await checked(
            service.from("documents").insert(rows),
            "Create >1000 fictional metadata rows",
        );
        const legacy = await checked(
            owner.client
                .from("documents")
                .select("id,original_name")
                .eq("owner_id", owner.id)
                .order("created_at", {ascending: false}),
            "Reproduce actual capped original query",
        );
        assert.equal(legacy.length, 1000);
        assert.ok(!legacy.some((item) => item.id === oldest));
        const search = async (who, extra = {}) => {
            const result = await checked(
                who.client.rpc("document_discovery", {p_search: suffix, ...extra}),
                "Read actual authorized discovery",
            );
            assertLmsResponse("document_discovery", result);
            return result;
        };
        assert.equal(
            (await search(owner, {p_search: needle})).items[0].id,
            oldest,
        );
        let page = await search(owner, {p_limit: 100}),
            seen = [];
        while (true) {
            seen.push(...page.items.map((item) => item.id));
            if (!page.has_more) break;
            page = await search(owner, {
                p_limit: 100,
                p_before_at: page.next_cursor.at,
                p_before_id: page.next_cursor.id,
            });
        }
        assert.equal(seen.length, 1005);
        assert.equal(new Set(seen).size, 1005);
        const write = (who, id, version, tags, folder) =>
            who.client.rpc("save_document_organisation", {
                p_document_id: id,
                p_expected_version: version,
                p_payload: {tags, folder},
            });
        const own = await checked(
            write(owner, oldest, 0, ["Private-tag"], "Private folder"),
            "Save actual personal organisation",
        );
        assertLmsResponse("save_document_organisation", own);
        assert.equal(own.version, 1);
        assert.equal(
            (
                await search(owner, {
                    p_search: "",
                    p_tag: "private-tag",
                    p_folder: "private folder",
                })
            ).items[0].id,
            oldest,
        );
        assert.deepEqual(
            (await search(peer, {p_search: "", p_tag: "private-tag"})).items,
            [],
        );
        await passwordOnly(admin.client);
        assert.deepEqual(
            (await search(admin, {p_search: "", p_folder: "Private folder"})).items,
            [],
        );
        assert.equal(
            (await write(admin, oldest, 0, ["Intrusion"], "Intrusion")).error?.code,
            "42501",
        );
        const concurrent = await Promise.all([
            write(owner, oldest, 1, ["A"], "A"),
            write(owner, oldest, 1, ["B"], "B"),
        ]);
        assert.equal(concurrent.filter((result) => !result.error).length, 1);
        const conflict = concurrent.find((result) => result.error);
        assert.equal(conflict?.status, 409);
        assert.equal(conflict?.error.code, "PT409");
        assert.equal(
            (await owner.client.rpc("document_discovery", {p_limit: 101})).error
                ?.code,
            "22023",
        );
        assert.equal(
            (
                await owner.client.rpc("save_document_organisation", {
                    p_document_id: oldest,
                    p_expected_version: 2,
                    p_payload: {tags: [], folder: "", user_id: peer.id},
                })
            ).error?.code,
            "22023",
        );
        await checked(
            service.from("jobs").insert({
                id: job,
                title: `Fictional sharing ${suffix}`,
                customer_name: "Fictional client",
                delivery_type: "online",
                status: "published",
                amount: 100,
                total_amount: 100,
                currency: "EUR",
                rate_unit: "fixed_total",
                terms: "Fictional terms",
                created_by: admin.id,
            }),
            "Create scoped shared document context",
        );
        const shared = randomUUID();
        await checked(
            service.from("documents").insert({
                id: shared,
                owner_id: owner.id,
                uploaded_by: owner.id,
                scope: "job_before",
                kind: "material",
                job_id: job,
                original_name: `Shared-${suffix}.txt`,
                mime_type: "text/plain",
                size_bytes: 10,
                client_id: randomUUID(),
            }),
            "Shared metadata fixture",
        );
        await checked(
            write(owner, shared, 0, ["Only A"], "A"),
            "Owner shared-file personal labels",
        );
        await checked(
            write(peer, shared, 0, ["Only B"], "B"),
            "Peer independent shared-file labels",
        );
        assert.equal(
            (await search(owner, {p_search: `Shared-${suffix}`})).items[0]
                .personal_folder,
            "A",
        );
        assert.equal(
            (await search(peer, {p_search: `Shared-${suffix}`})).items[0]
                .personal_folder,
            "B",
        );
        await checked(
            service.from("jobs").update({status: "draft"}).eq("id", job),
            "Revoke scoped pre-claim access",
        );
        assert.deepEqual(
            (await search(peer, {p_search: "", p_tag: "Only B"})).items,
            [],
        );
        assert.equal((await write(peer, shared, 1, [], "")).error?.code, "42501");
        await checked(
            owner.client.rpc("rename_document", {
                p_id: oldest,
                p_name: needle,
                p_delete: true,
            }),
            "Archive own metadata fixture",
        );
        assert.deepEqual((await search(owner, {p_search: needle})).items, []);
        await checked(
            service.from("profiles").update({active: false}).eq("id", peer.id),
            "Suspend own peer fixture",
        );
        assert.equal(
            (await peer.client.rpc("document_discovery")).error?.code,
            "42501",
        );
        const anonymous = createClient(url, process.env.SUPABASE_ANON_KEY, {
            auth: {persistSession: false, autoRefreshToken: false},
        });
        const denied = await anonymous.rpc("document_discovery");
        assert.ok(denied.error);
        assert.equal(denied.data, null);
        console.log(
            "PASS actual native Auth/REST: original1000-row loss reproduced without raising cap, complete keyset discovery, literal filename search, private tags/folders, CAS race, admin/foreign denial, context revocation, archive and old-token/anonymous guards. Metadata fixtures are not scanned-byte acceptance.",
        );
    },
);