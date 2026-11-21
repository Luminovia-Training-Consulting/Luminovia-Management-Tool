/** Accepted gross ledger aggregation and exact current company-membership boundaries. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {quoteSql as q, withTestDatabase} from "./testing/database.mjs";

await withTestDatabase("company_monthly_spend", async ({sql, actor}) => {
    const [companyA, companyB, admin, teacher, outsider, orgA, orgB] =
        Array.from({length: 7}, randomUUID);
    await sql(`insert into auth.users(id,email) values
      ${[companyA,companyB,admin,teacher,outsider].map((id) => `(${q(id)},${q(id+"@example.invalid")})`).join(",")};
      insert into public.user_roles(user_id,role) values
        (${q(companyA)},'client'),(${q(companyB)},'client'),
        (${q(admin)},'admin'),(${q(teacher)},'lecturer'),(${q(outsider)},'client');
      insert into public.organisations(id,name,time_zone) values
        (${q(orgA)},'Fictional Berlin Academy','Europe/Berlin'),
        (${q(orgB)},'Fictional Brisbane College','Australia/Brisbane');
      insert into public.client_organisation_memberships(user_id,organisation_id)
        values(${q(companyA)},${q(orgA)}),(${q(companyB)},${q(orgB)});`);
    const entries = [
        {org:orgA,currency:"EUR",instant:"2026-03-31T21:30:00Z",gross:"100.01",state:"confirmed"},
        {org:orgA,currency:"EUR",instant:"2026-03-31T22:30:00Z",gross:"200.02",state:"cancelled"},
        {org:orgA,currency:"AUD",instant:"2026-04-30T22:30:00Z",gross:"50.00",state:"confirmed"},
        {org:orgB,currency:"EUR",instant:"2026-03-31T13:30:00Z",gross:"999.99",state:"confirmed"},
    ];
    for (const entry of entries) {
        const job=randomUUID(),claim=randomUUID();
        const net=(Number(entry.gross)/2).toFixed(2);
        const platform=(Number(entry.gross)-Number(net)).toFixed(2);
        await sql(`insert into public.jobs(id,title,customer_name,delivery_type,status,amount,currency,rate_unit,total_amount,terms)
            values(${q(job)},'Fictional accepted assignment','Fictional customer','online','filled',0,${q(entry.currency)},'fixed_total',0,'Accepted fictional terms');
          insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,status,amount,currency,rate_unit,total_amount,terms,terms_version)
            values(${q(claim)},${q(job)},${q(teacher)},${q(randomUUID())},${q(entry.state)},0,${q(entry.currency)},'fixed_total',0,'Accepted fictional terms',1);
          insert into private.claim_revenue_ledger(claim_id,job_id,organisation_id,lecturer_id,gross_amount,gross_total_amount,platform_percent,platform_total_amount,lecturer_net_amount,lecturer_net_total_amount,currency,accepted_at)
            values(${q(claim)},${q(job)},${q(entry.org)},${q(teacher)},${entry.gross},${entry.gross},50,${platform},${net},${net},${q(entry.currency)},${q(entry.instant)});`);
    }
    const report = (who, org=null) => actor(who,
        `select coalesce(jsonb_agg(to_jsonb(row) order by row.organisation_id,row.currency,row.month_start),'[]'::jsonb)
        from public.company_monthly_accepted_spending(${org ? q(org) : "null"}) row`,"aal1").then(JSON.parse);
    const own=await report(companyA);
    assert.equal(own.length,3);
    assert.deepEqual(own.map((row)=>[row.currency,row.month_start,row.gross_amount,row.claim_count]),[
        ["AUD","2026-05-01",50,1],
        ["EUR","2026-03-01",100.01,1],
        ["EUR","2026-04-01",200.02,1],
    ]);
    assert.deepEqual(Object.keys(own[0]).sort(),[
        "claim_count","currency","gross_amount","month_start","organisation_id",
        "organisation_name","time_zone",
    ]);
    assert.ok(own.every((row)=>row.organisation_id===orgA));
    assert.deepEqual((await report(companyB)).map((row)=>[row.month_start,row.gross_amount]),
        [["2026-03-01",999.99]]);
    await assert.rejects(report(companyA,orgB),/42501/);
    await assert.rejects(report(companyA,randomUUID()),/42501/);
    await assert.rejects(report(admin),/42501/);
    await assert.rejects(report(teacher),/42501/);
    await assert.rejects(report(outsider),/42501/);
    assert.equal(await sql("select has_function_privilege('anon','public.company_monthly_accepted_spending(uuid)','EXECUTE')"),"f");
    assert.equal(await sql("select has_table_privilege('authenticated','private.claim_revenue_ledger','SELECT')"),"f");
    await sql(`update public.client_organisation_memberships set removed_at=now()
      where user_id=${q(companyA)} and organisation_id=${q(orgA)}`);
    await assert.rejects(report(companyA),/42501/);
});
