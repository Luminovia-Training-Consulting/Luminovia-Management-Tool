/** Auth/password-only authentication, actual ClamAV upload, exact bytes and explicit qualification grants. */
import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import {withApiFixture} from "./testing/api.mjs";
import {quoteSql as q} from "./testing/database.mjs";

await withApiFixture(
    async ({
               service,
               actor,
               passwordOnly,
               sql,
               defer,
               checked,
               suffix,
               url,
           }) => {
        const manager = await actor("qualification-manager", "management"),
            teacher = await actor("qualification-teacher", "lecturer"),
            peer = await actor("qualification-peer", "lecturer");
        const users = [manager.id, teacher.id, peer.id],
            topic = randomUUID();
        defer(async () => {
            const docs = await checked(
                service.from("documents").select("id").in("owner_id", users),
                "Owned certificate fixtures",
            );
            const ids = docs.map((d) => d.id);
            if (ids.length) {
                const versions = await checked(
                    service
                        .from("document_versions")
                        .select("object_path")
                        .in("document_id", ids),
                    "Owned certificate objects",
                );
                const paths = versions.map((v) => v.object_path);
                if (paths.length) {
                    await checked(
                        service.storage.from("portal-clean").remove(paths),
                        "Clean certificate objects",
                    );
                    await checked(
                        service.storage.from("portal-quarantine").remove(paths),
                        "Quarantine objects",
                    );
                }
                await checked(
                    service
                        .from("documents")
                        .update({current_version_id: null})
                        .in("id", ids),
                );
                await checked(
                    service.from("document_versions").delete().in("document_id", ids),
                );
                await checked(service.from("documents").delete().in("id", ids));
            }
            const owned = users.map(q).join(",");
            await sql(
                `delete
                 from private.qualification_events
                 where user_id in (${owned});
                delete
                from private.qualification_states
                where user_id in (${owned});
                delete
                from private.qualification_evidence
                where user_id in (${owned});
                delete
                from private.qualification_requests
                where actor_id in (${owned});
                delete
                from public.lecturer_topics
                where user_id in (${owned});
                delete
                from public.topics
                where id = ${q(topic)}`,
            );
        });
        await checked(
            service.from("topics").insert({
                id: topic,
                label_de: `Beleg ${suffix}`,
                label_en: `Evidence ${suffix}`,
                kind: "topic",
            }),
        );
        await checked(
            teacher.client
                .from("lecturer_topics")
                .insert({user_id: teacher.id, topic_id: topic}),
        );
        const origin = new URL(process.env.E2E_BASE_URL ?? "http://127.0.0.1:5273")
            .origin;

        async function headers(who) {
            const {session} = await checked(who.client.auth.getSession());
            return {
                Origin: origin,
                Authorization: `Bearer ${session.access_token}`,
                apikey: process.env.SUPABASE_ANON_KEY,
            };
        }

        async function upload(who, name, content, extra = {}) {
            const form = new FormData();
            form.set("file", new File([content], name, {type: "text/plain"}));
            form.set("scope", "personal");
            form.set("kind", "certificate");
            form.set("client_id", randomUUID());
            for (const [key, value] of Object.entries(extra)) form.set(key, value);
            const response = await fetch(`${url}/functions/v1/files`, {
                method: "POST",
                headers: await headers(who),
                body: form,
            });
            return {status: response.status, body: await response.json()};
        }

        async function download(who, body) {
            return fetch(`${url}/functions/v1/files`, {
                method: "POST",
                headers: {
                    ...(await headers(who)),
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(body),
            });
        }

        const read = () =>
            checked(
                teacher.client.rpc("qualification_review", {
                    p_user_id: teacher.id,
                    p_topic_id: topic,
                }),
            );
        const bind = (version, expected, request = randomUUID()) =>
            checked(
                teacher.client.rpc("save_qualification_evidence", {
                    p_topic_id: topic,
                    p_version_id: version,
                    p_expected_version: expected,
                    p_request_id: request,
                }),
            );
        let checks = 0;
        const pass = (name) => {
            checks++;
            console.log("PASS " + name);
        };
        const bytes = "Fictional original certificate API V1.",
            original = await upload(teacher, "Original.txt", bytes);
        assert.equal(original.status, 200, JSON.stringify(original.body));
        const doc = original.body.document;
        assert.equal(doc.status, "clean");
        const next = await upload(
            teacher,
            "Replacement.txt",
            "Fictional replacement V2.",
            {replace_id: doc.id},
        );
        assert.equal(next.status, 200, JSON.stringify(next.body));
        const versions = await checked(
            teacher.client.rpc("own_qualification_certificates", {
                p_search: "Original",
                p_limit: 1,
            }),
        );
        assert.equal(versions.items.length, 1);
        assert.equal(versions.items[0].version_id, doc.current_version_id);
        assert.equal(
            versions.items[0].sha256,
            createHash("sha256").update(bytes).digest("hex"),
        );
        const unlinkedReview = await checked(
            manager.client.rpc("qualification_review", {
                p_user_id: teacher.id,
                p_topic_id: topic,
            }),
        );
        assert.equal(unlinkedReview.evidence, null);
        assert.equal(unlinkedReview.verified, false);
        await passwordOnly(manager.client);
        assert.equal(
            (
                await checked(
                    manager.client.from("documents").select("id").eq("id", doc.id),
                )
            ).length,
            0,
        );
        assert.equal(
            (
                await download(manager, {
                    action: "download",
                    id: doc.id,
                    version_id: doc.current_version_id,
                })
            ).status,
            403,
        );
        pass(
            "Actual Auth/password-only authentication and real clean scanner versions; no blanket certificate document/history access",
        );
        const request = randomUUID(),
            linked = await bind(doc.current_version_id, 0, request);
        assert.equal(linked.verified, false);
        assert.deepEqual(await bind(doc.current_version_id, 0, request), linked);
        const response = await download(manager, {
            action: "qualification_evidence_download",
            evidence_id: linked.evidence.id,
        });
        assert.equal(response.status, 200);
        assert.equal(await response.text(), bytes);
        assert.match(response.headers.get("content-disposition"), /Original/);
        assert.match(response.headers.get("cache-control"), /no-store/);
        assert.equal(
            (
                await download(peer, {
                    action: "qualification_evidence_download",
                    evidence_id: linked.evidence.id,
                })
            ).status,
            403,
        );
        assert.equal(
            (
                await download(manager, {
                    action: "qualification_evidence_download",
                    evidence_id: randomUUID(),
                })
            ).status,
            403,
        );
        pass(
            "Explicit topic binding returns exact original bytes after replacement; peer and guessed grants denied",
        );
        const attest = {
            p_user_id: teacher.id,
            p_topic_id: topic,
            p_verified: true,
            p_valid_until: "2045-01-01T00:00:00Z",
            p_evidence_id: linked.evidence.id,
            p_expected_version: 1,
            p_request_id: randomUUID(),
        };
        assert.equal(
            (await teacher.client.rpc("attest_qualification", attest)).error?.code,
            "42501",
        );
        const reviewed = await checked(
            manager.client.rpc("attest_qualification", attest),
        );
        assert.equal(reviewed.verified, true);
        assert.deepEqual(
            await checked(manager.client.rpc("attest_qualification", attest)),
            reviewed,
        );
        let history = await checked(
            manager.client.rpc("qualification_history", {
                p_user_id: teacher.id,
                p_topic_id: topic,
                p_limit: 1,
            }),
        );
        assert.equal(history.items[0].basis, "document_evidence");
        assert.equal(history.has_more, true);
        const withdrawn = await bind(null, 2);
        assert.equal(withdrawn.verified, true);
        assert.equal(withdrawn.evidence, null);
        assert.equal(
            (
                await download(manager, {
                    action: "qualification_evidence_download",
                    evidence_id: linked.evidence.id,
                })
            ).status,
            403,
        );
        const retry = await checked(
            manager.client.rpc("attest_qualification", attest),
        );
        assert.equal(
            retry.evidence,
            null,
            "A committed retry must not disclose a withdrawn historic grant",
        );
        assert.equal(retry.version, 3);
        await checked(
            manager.client.rpc("verify_lecturer_topic", {
                p_user_id: teacher.id,
                p_topic_id: topic,
                p_verified: false,
                p_valid_until: null,
            }),
        );
        history = await checked(
            manager.client.rpc("qualification_history", {
                p_user_id: teacher.id,
                p_topic_id: topic,
            }),
        );
        assert.equal(history.items[0].basis, "management_attestation");
        assert.equal((await read()).verified, false);
        pass(
            "Versioned evidence/manual decisions share one history; withdrawal and sanitized retry never auto-verify",
        );
        const before = (
            await checked(
                service
                    .from("document_versions")
                    .select("id")
                    .eq("uploaded_by", manager.id),
            )
        ).length;
        const foreign = await upload(
            manager,
            "Forbidden.txt",
            "Fictional forbidden upload",
            {owner_id: teacher.id},
        );
        assert.equal(foreign.status, 403);
        assert.equal(
            (
                await checked(
                    service
                        .from("document_versions")
                        .select("id")
                        .eq("uploaded_by", manager.id),
                )
            ).length,
            before,
        );
        const eicar = await upload(
            teacher,
            "Antivirus.txt",
            "X5O!P%@AP[4" +
            String.fromCharCode(92) +
            "PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
        );
        assert.equal(eicar.status, 422);
        const rejectedVersion = await checked(
            service
                .from("documents")
                .select("current_version_id")
                .eq("id", eicar.body.document_id)
                .single(),
            "Actual rejected certificate version",
        );
        assert.equal(
            (
                await teacher.client.rpc("save_qualification_evidence", {
                    p_topic_id: topic,
                    p_version_id: rejectedVersion.current_version_id,
                    p_expected_version: 4,
                    p_request_id: randomUUID(),
                })
            ).error !== null,
            true,
        );
        pass(
            "Foreign subject upload rejected before reservation; actual antivirus-test content cannot become evidence",
        );
        const again = await bind(doc.current_version_id, 4);
        await sql(
            `begin;select 1 from public.profiles where id=${q(manager.id)} for update;delete from public.user_roles where user_id=${q(manager.id)};insert into public.user_roles values(${q(manager.id)},'lecturer');commit;`,
        );
        assert.equal(
            (
                await download(manager, {
                    action: "qualification_evidence_download",
                    evidence_id: again.evidence.id,
                })
            ).status,
            403,
        );
        assert.equal(
            (
                await manager.client.rpc("qualification_history", {
                    p_user_id: teacher.id,
                    p_topic_id: topic,
                })
            ).error?.code,
            "42501",
        );
        assert.equal(
            (
                await manager.client.rpc("verify_lecturer_topic", {
                    p_user_id: teacher.id,
                    p_topic_id: topic,
                    p_verified: true,
                    p_valid_until: null,
                })
            ).error?.code,
            "42501",
        );
        pass(
            "Retained real Auth token loses review/history/download authority after current-role withdrawal",
        );
        console.log(
            `${checks} actual qualification Auth/Storage/scanner API groups passed.`,
        );
    },
);