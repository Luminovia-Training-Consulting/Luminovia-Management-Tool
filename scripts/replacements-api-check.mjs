import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {withApiFixture} from "./testing/api.mjs";
import {quoteSql as q} from "./testing/database.mjs";

await withApiFixture(
    async ({actor, service, checked, sql, defer, passwordOnly, suffix}) => {
        const manager = await actor("replacement-manager", "admin"),
            original = await actor("replacement-original", "lecturer"),
            first = await actor("replacement-first", "lecturer"),
            second = await actor("replacement-second", "lecturer"),
            foreign = await actor("replacement-foreign", "participant");
        const users = [manager, original, first, second, foreign].map(
                (user) => user.id,
            ),
            job = randomUUID();
        defer(async () => {
            await sql(
                `delete
                 from private.replacement_requests
                 where actor_id in (${users.map(q).join(",")});
                delete
                from private.replacement_offers
                where original_claim_id in (select id from public.job_claims where job_id = ${q(job)});
                delete
                from public.notifications
                where user_id in (${users.map(q).join(",")});
                delete
                from public.chat_members
                where room_id in (select id from public.chat_rooms where job_id = ${q(job)});
                delete
                from public.chat_rooms
                where job_id = ${q(job)};
                delete
                from public.claim_events
                where claim_id in (select id from public.job_claims where job_id = ${q(job)});
                delete
                from public.assignment_sessions
                where claim_id in (select id from public.job_claims where job_id = ${q(job)});
                delete
                from public.job_claims
                where job_id = ${q(job)};
                delete
                from public.jobs
                where id = ${q(job)}`,
            );
        });
        await checked(
            service.from("jobs").insert({
                id: job,
                title: `Fictional API replacement ${suffix}`,
                customer_name: "Fictional API organisation",
                status: "published",
                delivery_type: "online",
                location: "https://example.invalid/meeting",
                amount: 123.45,
                total_amount: 246.9,
                currency: "AUD",
                rate_unit: "per_day",
                terms: "Fictional full-block terms",
                created_by: manager.id,
            }),
        );
        await checked(
            service.from("job_sessions").insert(
                [1, 2].map((n) => ({
                    job_id: job,
                    starts_at: `2041-01-0${n}T08:00:00Z`,
                    ends_at: `2041-01-0${n}T10:00:00Z`,
                })),
            ),
        );
        const claim = await checked(
            original.client.rpc("claim_job", {
                p_job_id: job,
                p_idempotency_key: randomUUID(),
                p_terms_version: 1,
            }),
        );
        assert.equal(claim.status, "confirmed");
        const key = randomUUID(),
            input = {
                p_claim_id: claim.claim_id,
                p_reason: "Fictional original cannot teach",
                p_mode: "open",
                p_invited_user_ids: [],
                p_emergency: true,
                p_request_id: key,
            };
        assert.ok((await foreign.client.rpc("request_replacement", input)).error);
        const offer = await checked(
            original.client.rpc("request_replacement", input),
        );
        assert.equal(
            await checked(original.client.rpc("request_replacement", input)),
            offer,
        );
        const market = await checked(first.client.rpc("replacement_marketplace"));
        const visible = market.find((row) => row.id === offer);
        assert.equal(visible.reason, null);
        assert.equal(visible.quote.currency, "AUD");
        assert.equal(visible.quote.total_amount, 246.9);
        const notifications = await checked(first.client.rpc("notification_inbox"));
        assert.ok(
            notifications.items.some(
                (row) =>
                    row.kind === "replacement_available" && row.href === "/replacements",
            ),
        );
        const requests = [first, second].map((user) => ({
            user,
            key: randomUUID(),
        }));
        const results = await Promise.all(
            requests.map(({user, key}) =>
                checked(
                    user.client.rpc("claim_replacement", {
                        p_offer_id: offer,
                        p_expected_version: 1,
                        p_terms_version: visible.quote.terms_version,
                        p_request_id: key,
                    }),
                ),
            ),
        );
        assert.equal(results.filter((row) => row.status === "confirmed").length, 1);
        const index = results.findIndex((row) => row.status === "confirmed"),
            winner = requests[index];
        assert.deepEqual(
            await checked(
                winner.user.client.rpc("claim_replacement", {
                    p_offer_id: offer,
                    p_expected_version: 1,
                    p_terms_version: visible.quote.terms_version,
                    p_request_id: winner.key,
                }),
            ),
            results[index],
        );
        assert.equal(
            (
                await checked(
                    original.client
                        .from("job_claims")
                        .select("status")
                        .eq("id", claim.claim_id)
                        .single(),
                )
            ).status,
            "cancelled",
        );
        assert.equal(
            (
                await checked(
                    winner.user.client
                        .from("assignment_sessions")
                        .select("id")
                        .eq("claim_id", results[index].claim_id)
                        .is("released_at", null),
                )
            ).length,
            2,
        );
        assert.equal(
            (await checked(original.client.rpc("chat_rooms_list"))).filter(
                (room) => room.job_id === job,
            ).length,
            0,
        );
        await passwordOnly(manager.client);
        assert.equal(
            (await checked(manager.client.rpc("replacement_marketplace"))).find(
                (row) => row.id === offer,
            ).status,
            "completed",
        );
        console.log(
            "PASS actual Auth/HTTP first-come replacement, complete-block access/calendar transfer, own-price consent, notifications, idempotency and foreign denial.",
        );
    },
);