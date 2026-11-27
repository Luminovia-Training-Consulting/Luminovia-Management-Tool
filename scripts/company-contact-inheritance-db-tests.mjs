/** Exercise assigned company contact precedence through the regular jobs and dispatch RPCs. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  applyPasswordOnlyPermissionPolicy,
  quoteSql as q,
  withTestDatabase,
} from "./testing/database.mjs";

await withTestDatabase("company_contact", async ({ sql, actor }) => {
  await applyPasswordOnlyPermissionPolicy(sql);
  const [
    manager,
    lecturer,
    company,
    otherCompany,
    primary,
    latest,
    alternate,
    foreign,
  ] = Array.from({ length: 8 }, randomUUID);
  await sql(`
    insert into auth.users(id,email) values
      (${q(manager)},'manager@example.invalid'),(${q(lecturer)},'lecturer@example.invalid');
    insert into public.user_roles(user_id,role) values
      (${q(manager)},'management'),(${q(lecturer)},'lecturer');
    insert into public.organisations(id,name) values
      (${q(company)},'Fictional company'),(${q(otherCompany)},'Other fictional company');
    insert into public.organisation_contacts(id,organisation_id,name,created_at) values
      (${q(primary)},${q(company)},'Configured contact','2020-01-01'),
      (${q(alternate)},${q(company)},'Course contact','2020-01-02'),
      (${q(latest)},${q(company)},'Newest contact','2020-01-03'),
      (${q(foreign)},${q(otherCompany)},'Other company contact','2020-01-04');
  `);
  const rpc = async (who, name, ...args) =>
    JSON.parse(
      await actor(
        who,
        `select to_jsonb(public.${name}(${args
          .map((arg) =>
            arg === null
              ? "null"
              : typeof arg === "number"
                ? String(arg)
                : typeof arg === "object"
                  ? q(JSON.stringify(arg)) + "::jsonb"
                  : q(arg),
          )
          .join(",")}))`,
      ),
    );

  const start = Date.now() + 5 * 86_400_000;
  const job = await rpc(
    manager,
    "create_capacity_job",
    {
      title: "Fictional assignment",
      customer_name: "Fictional company",
      delivery_type: "online",
      status: "published",
      currency: "EUR",
      rate_unit: "fixed_total",
      amount: 150,
      total_amount: 150,
      terms: "Agreed fictional terms",
      requires_contract: false,
      sessions: [
        {
          starts_at: new Date(start).toISOString(),
          ends_at: new Date(start + 7_200_000).toISOString(),
        },
      ],
    },
    1,
    randomUUID(),
    company,
  );
  const managerBriefing = () => rpc(manager, "job_briefing", job);
  const lecturerBriefing = () => rpc(lecturer, "job_briefing", job);
  assert.equal(
    (await managerBriefing()).fallback_contact.name,
    "Newest contact",
  );
  assert.equal(
    (await rpc(manager, "company_class_directory", company)).contact_id,
    latest,
  );
  await assert.rejects(
    rpc(manager, "save_company_dispatch_settings", company, foreign),
    /42501/,
  );
  await rpc(manager, "save_company_dispatch_settings", company, primary);
  assert.equal(
    (await managerBriefing()).fallback_contact.name,
    "Configured contact",
  );
  assert.equal((await lecturerBriefing()).fallback_contact, null);

  const claim = await rpc(lecturer, "claim_job", job, randomUUID(), 1);
  assert.equal(claim.status, "confirmed");
  assert.equal(
    (await lecturerBriefing()).fallback_contact.name,
    "Configured contact",
  );

  const run = await sql(
    `select course_run_id from public.jobs where id = ${q(job)}`,
  );
  await sql(`insert into private.course_workspace_settings (run_id,contact_id)
    values (${q(run)},${q(alternate)}) on conflict (run_id) do update set contact_id = excluded.contact_id`);
  assert.equal(
    (await lecturerBriefing()).fallback_contact.name,
    "Course contact",
  );

  await sql(
    `update public.organisation_contacts set archived_at = now() where id = ${q(alternate)}`,
  );
  assert.equal(
    (await lecturerBriefing()).fallback_contact.name,
    "Configured contact",
  );

  await rpc(manager, "save_company_dispatch_settings", company, null);
  assert.equal((await lecturerBriefing()).fallback_contact, null);
  console.log(
    "PASS company contact inheritance, explicit course override and cleared default",
  );
});
