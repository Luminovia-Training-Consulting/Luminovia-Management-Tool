/** Actual Auth/password-only authentication/REST quote projection in the canonical disposable stack; policies are fictional and per-offer. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {withApiFixture} from "./testing/api.mjs";
import {quoteSql as q} from "./testing/database.mjs";

await withApiFixture(
    async ({actor, passwordOnly, checked, sql, defer, service, suffix}) => {
        const regular = await actor("discovery-role-regular", "lecturer"),
            senior = await actor("discovery-role-senior", "senior_lecturer"),
            manager = await actor("discovery-role-manager", "management"),
            admin = await actor("discovery-role-admin", "admin");
        await passwordOnly(manager.client);
        await passwordOnly(admin.client);
        for (const [lecturer, percent] of [
            [regular, 20],
            [senior, 50],
        ])
            await checked(
                admin.client.rpc("save_lecturer_compensation", {
                    p_user_id: lecturer.id,
                    p_mode: "percent",
                    p_percent: percent,
                    p_daily_rate: 200,
                    p_currency: "EUR",
                    p_expected_version: 1,
                }),
            );
        const org = randomUUID(),
            a = randomUUID(),
            b = randomUUID(),
            customer = `Fictional role discovery ${suffix}`,
            users = [regular.id, senior.id, manager.id, admin.id];
        // Only these fixture identities/IDs are removed; no global policy is installed or changed.
        defer(async () => {
            await sql(
                `delete
                 from private.job_commission_offers
                 where job_id in (${q(a)}, ${q(b)});
                delete
                from public.job_sessions
                where job_id in (${q(a)}, ${q(b)});
                delete
                from public.jobs
                where id in (${q(a)}, ${q(b)});
                delete
                from public.notifications
                where user_id in (${users.map(q).join(",")});
                delete
                from public.organisations
                where id = ${q(org)};`,
            );
        });
        await sql(
            `insert into public.organisations(id, name)
             values (${q(org)}, ${q(customer)})`,
        );
        for (const [id, title, gross, regularPercent, seniorPercent] of [
            [a, "Captured A", 1000, 20, 50],
            [b, "Captured B", 500, 60, 80],
        ])
            await sql(
                `insert into public.jobs(id, title, customer_name, delivery_type, status, amount, total_amount, currency, rate_unit, terms, terms_version, requires_contract)
                 values (${q(id)}, ${q(title)}, ${q(customer)}, 'online', 'published', 0, 0, 'EUR', 'fixed_total', 'Fictional current consent', 3, false);
                insert into public.job_sessions(job_id, starts_at, ends_at)
                values (${q(id)}, '2099-04-01T08:00:00Z', '2099-04-01T09:00:00Z');
                insert into private.job_commission_offers(job_id, organisation_id, gross_amount, gross_total_amount, platform_total_amount, lecturer_net_amount, lecturer_net_total_amount, currency, pricing_mode, regular_percent, senior_percent, policy_version)
                values (${q(id)}, ${q(org)}, ${gross}, ${gross}, 0, 0, 0, 'EUR', 'role_split', ${regularPercent}, ${seniorPercent}, 1);`,
            );
        const detail = (who, id) =>
            checked(who.client.rpc("job_detail", {p_job_id: id}));
        const filter = {customer, currency: "EUR", sort: "total_asc"};
        const page = (who, cursor = null, limit = 50) =>
            who.client.rpc("job_discovery", {
                p_filters: filter,
                p_cursor: cursor,
                p_limit: limit,
            });
        const roleState = await sql(
            `select concat('regular=', coalesce((select string_agg(role, ',' order by role) from public.user_roles where user_id = ${q(regular.id)}), 'none'), '; senior=', coalesce((select string_agg(role, ',' order by role) from public.user_roles where user_id = ${q(senior.id)}), 'none'))`,
        );
        assert.equal(
            (await detail(regular, a)).amount,
            200,
            `Regular lecturer quote mismatch; fixture roles: ${roleState}`,
        );
        assert.equal((await detail(senior, a)).amount, 500);
        assert.equal((await detail(regular, a)).terms_version, 2000031);
        assert.equal((await detail(senior, a)).terms_version, 2000032);
        const first = await checked(page(regular, null, 1)),
            next = await checked(page(regular, first.next_cursor, 1));
        assert.deepEqual([first.items[0].id, next.items[0].id], [b, a]);
        assert.deepEqual(
            (await checked(page(senior))).items.map((i) => i.id),
            [b, a],
        );
        const restricted = await detail(manager, a);
        assert.equal(restricted.amount, null);
        assert.equal(restricted.total_amount, null);
        assert.equal(restricted.terms_version, 3);
        assert.ok(
            !Object.keys(restricted).some((k) => /gross|percent|policy/.test(k)),
        );
        const narrowed = await checked(
            regular.client.rpc("job_discovery", {
                p_filters: {...filter, min_total: 150},
                p_cursor: null,
                p_limit: 50,
            }),
        );
        assert.deepEqual(
            narrowed.items.map((i) => i.id),
            [a],
        );
        await checked(
            service
                .from("user_roles")
                .insert({user_id: regular.id, role: "senior_lecturer"}),
        );
        assert.equal(
            (await page(regular, first.next_cursor, 1)).error.code,
            "22023",
        );
        assert.equal((await detail(regular, a)).terms_version, 2000032);
        assert.equal((await detail(regular, a)).amount, 200);
        const stale = await checked(
            regular.client.rpc("claim_job", {
                p_job_id: a,
                p_idempotency_key: randomUUID(),
                p_terms_version: 2000031,
            }),
        );
        assert.equal(stale.status, "terms_changed");
        console.log(
            "Actual role-aware discovery Auth/password-only authentication/REST captured quotes, null protection, sorting/filtering and stale consent passed.",
        );
    },
);