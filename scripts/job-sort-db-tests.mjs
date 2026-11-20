/** Real PostgreSQL role-scoped customer/topic ordering and stable keyset cursors. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {quoteSql as q, withTestDatabase} from "./testing/database.mjs";

await withTestDatabase("job_text_sort", async ({sql, actor}) => {
    const lecturer = randomUUID(),
        manager = randomUUID(),
        outsider = randomUUID(),
        x = randomUUID(),
        y = randomUUID(),
        org = randomUUID();
    const jobs = Array.from({length: 5}, () => randomUUID());
    await sql(`insert into auth.users(id,email) values(${q(lecturer)},'teacher@example.invalid'),(${q(manager)},'manager@example.invalid'),(${q(outsider)},'client@example.invalid');
    insert into public.user_roles(user_id,role) values(${q(lecturer)},'lecturer'),(${q(manager)},'management'),(${q(outsider)},'client');
    insert into public.topics(id,label_de,label_en,kind) values(${q(x)},'Alpha','Zulu','topic'),(${q(y)},'Zulu','Alpha','topic');
    insert into public.jobs(id,title,customer_name,delivery_type,status,amount,currency,rate_unit,total_amount,terms) values
    (${q(jobs[0])},'Test A','Fictional Zebra','online','published',10,'EUR','fixed_total',10,'Fictional terms'),
    (${q(jobs[1])},'Test B','Fictional Alpha','online','published',10,'EUR','fixed_total',10,'Fictional terms'),
    (${q(jobs[2])},'Test C','Fictional Alpha','online','published',10,'EUR','fixed_total',10,'Fictional terms'),
    (${q(jobs[3])},'Test D','Fictional Other','online','draft',10,'EUR','fixed_total',10,'Fictional terms'),
    (${q(jobs[4])},'Test E','Fictional Zero','online','published',10,'EUR','fixed_total',10,'Fictional terms');
    insert into public.job_requirements(job_id,topic_id) values(${q(jobs[0])},${q(x)}),(${q(jobs[0])},${q(y)}),(${q(jobs[1])},${q(y)}),(${q(jobs[2])},${q(y)});
    insert into public.organisations(id,name) values(${q(org)},'Fictional policy organisation');
    insert into private.compensation_policy(singleton,version,regular_percent,senior_percent,updated_by) values(true,1,10,90,${q(manager)});
    update public.jobs set amount=0,total_amount=0 where id=${q(jobs[1])};
    insert into private.job_commission_offers(job_id,organisation_id,gross_amount,gross_total_amount,platform_total_amount,lecturer_net_amount,lecturer_net_total_amount,currency,pricing_mode,regular_percent,senior_percent,policy_version)
    values(${q(jobs[1])},${q(org)},777,777,0,0,0,'EUR','role_split',10,90,1);`);
    const page = (who, sort, cursor = null, aal = "aal1") =>
        actor(
            who,
            `select public.job_discovery(${q(JSON.stringify({sort}))}::jsonb,${cursor ? `${q(JSON.stringify(cursor))}::jsonb` : "null"},2)`,
            aal,
        ).then(JSON.parse);

    async function all(sort) {
        let cursor = null;
        const items = [];
        do {
            const p = await page(lecturer, sort, cursor);
            items.push(...p.items);
            cursor = p.next_cursor;
        } while (cursor);
        return items;
    }

    let rows = await all("customer_asc");
    assert.deepEqual(
        rows.map((v) => v.customer_name),
        ["Fictional Alpha", "Fictional Alpha", "Fictional Zebra", "Fictional Zero"],
    );
    assert.deepEqual(
        rows.slice(0, 2).map((v) => v.id),
        [jobs[1], jobs[2]].sort(),
    );
    rows = await all("topic_de_asc");
    assert.deepEqual(
        rows.map((v) => v.id),
        [jobs[4], jobs[0], ...[jobs[1], jobs[2]].sort()],
    );
    rows = await all("topic_en_asc");
    assert.deepEqual(
        rows.map((v) => v.id),
        [jobs[4], ...[jobs[0], jobs[1], jobs[2]].sort()],
    );
    assert.equal(new Set(rows.map((v) => v.id)).size, 4);
    for (const sort of ["customer_asc", "topic_de_asc", "topic_en_asc"]) {
        const view = JSON.parse(
            await actor(
                lecturer,
                `select public.save_job_view(${q(randomUUID())},${q("Fictional " + sort)},${q(JSON.stringify({sort}))}::jsonb,0)`,
            ),
        );
        assert.equal(view.filters.sort, sort);
    }
    await assert.rejects(
        actor(
            outsider,
            "select private.job_discovery_candidates_before_text_sort('{}'::jsonb)",
        ),
        /42501/,
    );
    const cursor = (await page(lecturer, "topic_de_asc")).next_cursor;
    await assert.rejects(
        page(lecturer, "customer_asc", cursor),
        /Invalid discovery cursor/,
    );
    await assert.rejects(page(outsider, "customer_asc"), /42501/);
    const management = await page(manager, "customer_asc", null, "aal2");
    const protectedItem = management.items.find((item) => item.id === jobs[1]);
    assert.ok(protectedItem);
    assert.equal(protectedItem.amount, null);
    assert.equal(protectedItem.total_amount, null);
    assert.equal(management.next_cursor.number, "0");
    assert.ok(
        management.items.every(
            (item) => !("gross_amount" in item) && !("platform_percent" in item),
        ),
    );
    assert.equal(
        (await page(lecturer, "customer_asc")).items.some(
            (item) => item.id === jobs[3],
        ),
        false,
    );
    console.log(
        "PASS role-scoped customer/topic ordering, multilingual labels, ties, keyset and cursor isolation",
    );
});