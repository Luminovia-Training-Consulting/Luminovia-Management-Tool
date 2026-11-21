/** Actual Auth/REST/Edge passport contract in the canonical disposable project.
 * Only fictional selected topics are created; no certificate bytes are shared. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {withApiFixture} from "./testing/api.mjs";
import {quoteSql as q} from "./testing/database.mjs";

await withApiFixture(
    async ({service, actor, passwordOnly, sql, defer, checked, url}) => {
        const teacher = await actor("passport-teacher", "lecturer"),
            peer = await actor("passport-peer", "lecturer"),
            admin = await actor("passport-admin", "admin"),
            learner = await actor("passport-learner", "participant");
        await checked(
            service
                .from("user_roles")
                .insert({user_id: learner.id, role: "client"}),
        );
        const topic = randomUUID();
        defer(async () => {
            await sql(
                `delete
                 from public.lecturer_topics
                 where user_id = ${q(teacher.id)};
                delete
                from public.topics
                where id = ${q(topic)}`,
            );
        });
        await checked(
            service.from("topics").insert({
                id: topic,
                label_de: "Fictional Pass Fachgebiet",
                label_en: "Fictional passport topic",
                kind: "topic",
            }),
        );
        await checked(
            teacher.client
                .from("lecturer_topics")
                .insert({user_id: teacher.id, topic_id: topic}),
        );
        const stamp = new Date().toISOString();
        const own = await checked(
            teacher.client.rpc("own_qualification_passport", {
                p_locale: "de",
                p_as_of: stamp,
            }),
        );
        assert.equal(own.data.qualifications.length, 1);
        assert.equal(own.data.qualifications[0].status, "unverified");
        await passwordOnly(admin.client);
        const passportArgs = {p_locale: "en", p_as_of: stamp};
        const peerPassport = await checked(
            peer.client.rpc("own_qualification_passport", passportArgs),
        );
        assert.deepEqual(peerPassport.data.qualifications, []);
        for (const who of [admin, learner]) {
            const denied = await who.client.rpc("own_qualification_passport", passportArgs);
            assert.equal(denied.data, null);
            assert.equal(denied.error?.code, "42501");
        }
        const origin = new URL(process.env.E2E_BASE_URL ?? "http://127.0.0.1:5273")
            .origin;

        async function document(who, body) {
            const {session} = await checked(who.client.auth.getSession());
            return fetch(`${url}/functions/v1/course-documents`, {
                method: "POST",
                headers: {
                    Origin: origin,
                    Authorization: `Bearer ${session.access_token}`,
                    apikey: process.env.SUPABASE_ANON_KEY,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(body),
                redirect: "error",
            });
        }

        for (const locale of ["de", "en"]) {
            const response = await document(teacher, {
                kind: "qualification_passport",
                locale,
            });
            assert.equal(response.status, 200);
            assert.match(response.headers.get("content-type"), /application\/pdf/);
            assert.match(response.headers.get("cache-control"), /no-store/);
            assert.equal(
                new TextDecoder().decode(
                    new Uint8Array(await response.arrayBuffer()).slice(0, 5),
                ),
                "%PDF-",
            );
        }
        assert.equal(
            (
                await document(admin, {
                    kind: "qualification_passport",
                    locale: "en",
                    user_id: teacher.id,
                })
            ).status,
            400,
        );
        for (const who of [admin, learner]) {
            assert.equal(
                (
                    await document(who, {
                        kind: "qualification_passport",
                        locale: "en",
                    })
                ).status,
                403,
            );
        }
        await checked(
            service.from("profiles").update({active: false}).eq("id", teacher.id),
        );
        assert.equal(
            (
                await document(teacher, {
                    kind: "qualification_passport",
                    locale: "de",
                })
            ).status,
            401,
        );
        console.log(
            "PASS Own Auth/REST/actual PDF in DE/EN, password-only authentication peer isolation, strict subject-free request, no-store and suspension",
        );
    },
);