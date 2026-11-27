/** Company request and lecturer claim RPCs through the real transactional outbox. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

await withTestDatabase("customer_order_mail", async ({ sql, actor }) => {
  const [
    requester,
    contact,
    outsider,
    lecturer,
    admin,
    company,
    foreign,
    contactId,
  ] = Array.from({ length: 8 }, randomUUID);
  const address = (user) => `${user}@example.invalid`;
  const input = (value) => `${q(JSON.stringify(value))}::jsonb`;
  const rpc = async (user, expression, assurance = "aal1") =>
    JSON.parse(await actor(user, `select to_jsonb(${expression})`, assurance));
  const service = async (name, args = "") =>
    JSON.parse(
      await sql(`begin; set local role service_role;
      select coalesce(to_jsonb(public.${name}(${args})), 'null'::jsonb); commit;`),
    );
  const pending = (resource) =>
    sql(`select count(*) from private.notification_email_outbox delivery
    join public.notifications notice on notice.id = delivery.notification_id
    where notice.resource_id = ${q(resource)} and notice.kind like 'customer_order_%';`);
  const inbox = async (user) =>
    (await rpc(user, "public.notification_inbox()")).items.filter(({ kind }) =>
      kind.startsWith("customer_order_"),
    );

  await sql(`
    insert into auth.users(id,email,email_confirmed_at) values
      ${[requester, contact, outsider, lecturer, admin].map((user) => `(${q(user)},${q(address(user))},now())`).join(",")};
    insert into public.user_roles(user_id,role) values
      (${q(requester)},'client'),(${q(contact)},'client'),(${q(outsider)},'client'),
      (${q(lecturer)},'lecturer'),(${q(admin)},'admin');
    update public.profiles set locale = 'en' where id = ${q(requester)};
    insert into public.organisations(id,name) values (${q(company)},'Fictional company'),(${q(foreign)},'Foreign company');
    insert into public.client_organisation_memberships(user_id,organisation_id)
      values (${q(requester)},${q(company)}),(${q(contact)},${q(company)}),(${q(outsider)},${q(foreign)});
    insert into public.organisation_contacts(id,organisation_id,name,email)
      values (${q(contactId)},${q(company)},'Standard contact',${q(address(contact))});
    insert into private.company_dispatch_settings(organisation_id,contact_id)
      values (${q(company)},${q(contactId)});
  `);
  const title = "Example course order";
  const payload = {
    title,
    description: "Synthetic course brief",
    delivery_type: "online",
    time_zone: "Europe/Berlin",
    gross_amount: 400,
    gross_total_amount: 400,
    currency: "EUR",
    rate_unit: "fixed_total",
    sessions: [
      {
        starts_at: new Date(Date.now() + 10 * 86_400_000).toISOString(),
        ends_at: new Date(
          Date.now() + 10 * 86_400_000 + 3_600_000,
        ).toISOString(),
      },
    ],
  };
  const clientId = randomUUID();
  const submit = (user, key = clientId) =>
    rpc(
      user,
      `public.create_client_request(${q(company)},${input(payload)},${q(key)})`,
    );
  await assert.rejects(submit(outsider), /access|permission/i);
  const request = await submit(requester);
  assert.equal(await submit(requester), request);
  assert.equal(await pending(request), "1");

  const job = await rpc(
    admin,
    `public.publish_client_request(${q(request)},null,'Fictional terms',false,null)`,
    "aal2",
  );
  assert.equal(await pending(job), "0");
  const offers = await rpc(lecturer, "public.job_offers()");
  const offer = offers.find(({ id }) => id === job);
  assert.ok(offer);
  const claimKey = randomUUID();
  const claim = () =>
    rpc(
      lecturer,
      `public.claim_job(${q(job)},${q(claimKey)},${offer.terms_version})`,
    );
  const assignment = await claim();
  const claimId = assignment.claim_id;
  assert.equal(assignment.status, "confirmed");
  assert.equal((await claim()).claim_id, claimId);
  assert.equal(await pending(claimId), "1");
  await sql(
    `update public.job_claims set status = status where id = ${q(claimId)}`,
  );
  assert.equal(await pending(claimId), "1");
  assert.deepEqual(await inbox(outsider), []);
  assert.deepEqual(await inbox(contact), []);
  const receipts = await inbox(requester);
  assert.deepEqual(receipts.map(({ kind }) => kind).sort(), [
    "customer_order_lecturer_confirmed",
    "customer_order_submitted",
  ]);
  assert.ok(
    receipts.every(
      ({ href, title: heading }) => href === "/client" && heading === title,
    ),
  );

  const quietTime =
    await sql(`select to_char((now() at time zone 'UTC') - interval '1 hour','HH24:MI')
    || '|' || to_char((now() at time zone 'UTC') + interval '1 hour','HH24:MI')`);
  const [quietStart, quietEnd] = quietTime.split("|");
  await sql(`update private.delivery_preferences set time_zone = 'UTC', quiet_start = ${q(quietStart)},
    quiet_end = ${q(quietEnd)} where user_id = ${q(requester)}`);
  const deferred = await service("lease_notification_emails", "10");
  assert.equal(deferred.length, 2);
  const prepare = (lease) =>
    service(
      "prepare_notification_email",
      `${q(lease.id)},${q(lease.lease_token)}`,
    );
  assert.deepEqual(await Promise.all(deferred.map(prepare)), [null, null]);
  assert.equal(
    await sql(
      "select count(*) from private.notification_email_outbox where error_code = 'quiet_hours'",
    ),
    "2",
  );
  await sql(`update private.delivery_preferences set quiet_start = null, quiet_end = null where user_id = ${q(requester)};
    update private.notification_email_outbox set available_at = now() where error_code = 'quiet_hours';`);
  const leases = await service("lease_notification_emails", "10");
  const prepared = await Promise.all(leases.map(prepare));
  const deliveryKinds = prepared.map(({ kind }) => kind).sort();
  assert.deepEqual(deliveryKinds, [
    "customer_order_lecturer_confirmed",
    "customer_order_submitted",
  ]);
  assert.ok(
    prepared.every(
      ({ recipient, locale }) =>
        recipient === address(requester) && locale === "en",
    ),
  );
  const accepted = await Promise.all(
    leases.map(({ id, lease_token }) =>
      service(
        "finish_notification_email",
        `${q(id)},${q(lease_token)},'accepted'`,
      ),
    ),
  );
  assert.deepEqual(accepted, [true, true]);

  await assert.rejects(
    rpc(outsider, `public.decide_company_lecturer(${q(claimId)},'accepted')`),
    /access/i,
  );
  await actor(
    requester,
    `select public.decide_company_lecturer(${q(claimId)},'accepted')`,
  );
  const decisions = await rpc(
    requester,
    `public.company_lecturer_decisions(${q(job)})`,
  );
  assert.equal(
    decisions.find(({ claim_id }) => claim_id === claimId).status,
    "accepted",
  );

  const staffRequest = await rpc(
    admin,
    `public.create_client_request(${q(company)},${input(payload)},${q(randomUUID())})`,
    "aal2",
  );
  assert.equal(await pending(staffRequest), "1");
  const [contactLease] = await service("lease_notification_emails", "10");
  await sql(
    `update public.client_organisation_memberships set removed_at = now() where user_id = ${q(contact)}`,
  );
  assert.equal(await prepare(contactLease), null);
  assert.equal(
    await sql(
      `select state from private.notification_email_outbox where id = ${q(contactLease.id)}`,
    ),
    "suppressed",
  );
  assert.deepEqual(await inbox(contact), []);

  const receiptScope = await sql(
    `select private.deletion_selector(private.deletion_scope('assignment', ${q(claimId)}), 'private.customer_order_receipts')`,
  );
  assert.ok(receiptScope.includes("claim_id"));
  assert.equal(
    await sql(
      `select count(*) from private.customer_order_receipts x where ${receiptScope}`,
    ),
    "1",
  );
  const snapshot = JSON.parse(
    await sql(`select private.deletion_snapshot('assignment', ${q(claimId)})`),
  );
  assert.equal(snapshot.counts["private.customer_order_receipts"], 1);
  assert.ok(
    !snapshot.blockers.some(
      ({ kind }) => kind === "private.customer_order_receipts",
    ),
  );
  await sql(
    `delete from public.notifications where kind = 'customer_order_submitted' and resource_id = ${q(staffRequest)}`,
  );
  assert.equal(await pending(staffRequest), "0");
  assert.equal(
    await sql(
      `select count(*) from private.customer_order_receipts where request_id = ${q(staffRequest)}`,
    ),
    "0",
  );

  console.log(
    "PASS company order and confirmed lecturer receipts, deduplication, scoped delivery, quiet hours, acceptance and deletion scope.",
  );
});
