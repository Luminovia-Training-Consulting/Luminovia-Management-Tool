/** Verify first publication and independent, recipient-scoped email and device delivery. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

await withTestDatabase("course_offer_mail_test", async ({ sql, actor }) => {
  const [
    matching,
    broad,
    optedOut,
    noUpdates,
    inactive,
    noRole,
    unconfirmed,
    differentArea,
  ] = Array.from({ length: 8 }, randomUUID);
  const company = randomUUID();
  const topic = randomUUID();
  const manager = randomUUID();
  const email = (id) => `${id}@example.invalid`;
  const title = "Linux-Workshop für Fortgeschrittene";
  const description = "Planung & Übungen\nZwei Termine.";
  await sql(`
        insert into auth.users(id,email,email_confirmed_at) values
          ${[
            matching,
            broad,
            optedOut,
            noUpdates,
            inactive,
            noRole,
            unconfirmed,
            differentArea,
            manager,
          ]
            .map(
              (id) =>
                `(${q(id)},${q(email(id))},${id === unconfirmed ? "null" : "now()"})`,
            )
            .join(",")};
        insert into public.user_roles(user_id,role) values
          ${[
            matching,
            broad,
            optedOut,
            noUpdates,
            inactive,
            unconfirmed,
            differentArea,
          ]
            .map(
              (id) =>
                `(${q(id)},${q(id === broad ? "senior_lecturer" : "lecturer")})`,
            )
            .join(",")},(${q(manager)},'admin');
        update public.profiles set active = false where id = ${q(inactive)};
        update public.profiles set locale = 'en' where id = ${q(matching)};
        update private.delivery_preferences set email_enabled = true where user_id <> ${q(optedOut)};
        update private.notification_preferences set job_updates = false where user_id = ${q(noUpdates)};
        update private.push_configuration set enabled = true;
        insert into private.push_subscriptions(user_id,endpoint,p256dh,auth_secret,device_token,label)
          select profile.id,'https://fcm.googleapis.com/' || profile.id::text,'fixture','fixture',gen_random_uuid(),'Fictional device'
          from public.profiles profile where profile.id in (${[matching, broad, optedOut, noUpdates, inactive, noRole, differentArea].map(q).join(",")});
        insert into public.organisations(id,name) values(${q(company)},'Fictional company');
        insert into private.company_lecturers(organisation_id,lecturer_id) values(${q(company)},${q(broad)});
        insert into public.topics(id,kind,label_de,label_en) values(${q(topic)},'topic','Übung','Practice');
        insert into public.lecturer_topics(user_id,topic_id) values
          ${[
            matching,
            broad,
            optedOut,
            noUpdates,
            inactive,
            noRole,
            unconfirmed,
          ]
            .map((id) => `(${q(id)},${q(topic)})`)
            .join(",")};
        insert into public.personal_events(user_id,title,starts_at,ends_at)
          values(${q(broad)},'Fictional conflict',now()+interval '9 days',now()+interval '12 days');
    `);
  const service = async (name, args = []) =>
    JSON.parse(
      await sql(
        `begin;set local role service_role;select coalesce(to_jsonb(public.${name}(${args.join(",")})),'null'::jsonb);commit;`,
      ),
    );
  const prepare = (lease) =>
    service("prepare_notification_email", [q(lease.id), q(lease.lease_token)]);
  const finish = (lease) =>
    service("finish_notification_email", [
      q(lease.id),
      q(lease.lease_token),
      "'accepted'",
    ]);
  const queue = async (job) =>
    JSON.parse(
      await sql(`
        select coalesce(jsonb_agg(jsonb_build_object('kind', n.kind, 'user', n.user_id, 'state', o.state, 'error', o.error_code)
          order by n.kind,n.user_id),'[]'::jsonb)
        from private.notification_email_outbox o join public.notifications n on n.id = o.notification_id
        where n.resource_id = ${q(job)};
    `),
    );
  const richUsers = async (job) =>
    (await queue(job))
      .filter(({ kind }) => kind === "course_offer_published")
      .map(({ user }) => user);
  const pushQueue = async (job) =>
    JSON.parse(
      await sql(`
    select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'user', n.user_id,
      'kind', n.kind, 'state', o.state) order by n.user_id),'[]'::jsonb)
    from private.notification_push_outbox o join public.notifications n on n.id = o.notification_id
    where n.resource_id = ${q(job)};`),
    );
  const preparePush = (lease) =>
    service("prepare_notification_push", [q(lease.id), q(lease.lease_token)]);
  const publish = (job) =>
    sql(`update public.jobs set status='published' where id=${q(job)}`);
  const create = async ({
    status = "draft",
    internal = false,
    restricted = false,
    partial = false,
    commission = false,
  } = {}) => {
    const [template, run, job] = Array.from({ length: 3 }, randomUUID);
    await sql(`begin;
          insert into public.course_templates(id,title) values(${q(template)},${q(title)});
          insert into public.course_runs(id,template_id,organisation_id,own_lecturers_only)
            values(${q(run)},${q(template)},${q(company)},${restricted});
          insert into public.jobs(id,course_run_id,title,description,customer_name,delivery_type,status,amount,currency,rate_unit,total_amount,terms,company_internal)
            values(${q(job)},${q(run)},${q(title)},${q(description)},'Fictional company','online',${q(status)},
              ${internal ? 0 : 30},'AUD','fixed_total',${internal ? 0 : 30},'Fictional terms',${internal});
          insert into public.course_sessions(course_run_id,starts_at,ends_at)
            select ${q(run)},now()+d*interval '1 day',now()+d*interval '1 day'+interval '1 hour' from generate_series(10,11) d;
          insert into public.job_sessions(job_id,course_session_id,starts_at,ends_at)
            select ${q(job)},id,starts_at,ends_at from public.course_sessions where course_run_id=${q(run)}
            order by starts_at limit ${partial ? 1 : 2};
          insert into public.job_requirements(job_id,topic_id) values(${q(job)},${q(topic)});
          ${
            commission
              ? `insert into private.job_commission_offers(job_id,organisation_id,gross_amount,gross_total_amount,
            platform_percent,platform_total_amount,lecturer_net_amount,lecturer_net_total_amount,currency,pricing_mode,regular_percent,senior_percent,policy_version)
            values(${q(job)},${q(company)},100,100,70,70,30,30,'AUD','role_split',30,60,1);`
              : ""
          }
        commit;`);
    return job;
  };

  const draft = await create({ commission: true });
  assert.deepEqual(await queue(draft), []);
  assert.deepEqual(await pushQueue(draft), []);
  const version = Number(
    await sql(
      `select lifecycle_version from public.jobs where id = ${q(draft)}`,
    ),
  );
  await actor(
    manager,
    `select public.manage_job_offer(${q(draft)},'published',${version},${q(randomUUID())},'{}'::jsonb)`,
  );
  assert.deepEqual(await richUsers(draft), [matching, broad].sort());
  assert.deepEqual(
    (await pushQueue(draft))
      .filter(({ kind }) => kind === "course_offer_published")
      .map(({ user }) => user),
    [matching, broad, optedOut].sort(),
  );
  const firstPushLeases = await service("lease_notification_push", [20]);
  const firstPushDeliveries = (
    await Promise.all(firstPushLeases.map(preparePush))
  ).filter(Boolean);
  assert.equal(firstPushDeliveries.length, 3);
  for (const delivery of firstPushDeliveries) {
    assert.deepEqual(Object.keys(delivery).sort(), [
      "device_token",
      "id",
      "lease_token",
      "locale",
      "subscription",
    ]);
  }
  assert.equal(
    await actor(broad, `select count(*) from public.jobs where id=${q(draft)}`),
    "1",
  );
  assert.equal(
    await actor(
      differentArea,
      `select count(*) from public.jobs where id=${q(draft)}`,
    ),
    "0",
  );
  const inbox = JSON.parse(
    await actor(optedOut, "select public.notification_inbox()"),
  );
  assert.equal(
    inbox.items.find(({ kind }) => kind === "course_offer_published")?.href,
    `/jobs/${draft}`,
  );
  const leases = await service("lease_notification_emails", [20]);
  for (const lease of leases) {
    const delivery = await prepare(lease);
    if (!delivery) continue;
    assert.equal(delivery.kind, "course_offer_published");
    const regular = delivery.recipient === email(matching);
    assert.equal(delivery.recipient, email(regular ? matching : broad));
    assert.equal(delivery.locale, regular ? "en" : "de");
    assert.deepEqual(delivery.offer, {
      id: draft,
      title,
      description,
      internal: false,
      quote: { total_amount: regular ? "30.00" : "60.00", currency: "AUD" },
    });
    assert.equal(await finish(lease), true);
  }
  const deliveries = await queue(draft);
  assert.equal(
    deliveries.filter(({ state }) => state === "accepted").length,
    2,
    JSON.stringify(deliveries),
  );
  assert.deepEqual(
    await actor(
      broad,
      `select count(*) from public.notifications where kind='course_offer_published'`,
    ),
    "1",
  );
  await sql(
    `update public.jobs set description='Edited' where id=${q(draft)};`,
  );
  await publish(draft);
  await sql(`update public.jobs set status='draft' where id=${q(draft)};`);
  await publish(draft);
  assert.deepEqual(await richUsers(draft), [matching, broad].sort());
  assert.equal(
    (await queue(draft)).filter(({ kind }) => kind === "course_offer_published")
      .length,
    2,
  );
  console.log(
    "PASS publication, broad consented audience, per-recipient quote and no duplicate matching email",
  );

  await sql("delete from private.notification_email_outbox;");
  const partial = await create({ status: "published", partial: true });
  assert.deepEqual(await richUsers(partial), []);
  const restricted = await create({ status: "published", restricted: true });
  const internal = await create({ status: "published", internal: true });
  assert.deepEqual(await richUsers(restricted), [broad]);
  assert.deepEqual(await richUsers(internal), [broad]);
  const restrictedDevice = (await pushQueue(restricted)).find(
    ({ kind }) => kind === "course_offer_published",
  );
  assert.equal(restrictedDevice?.user, broad);
  const restrictedPush = (await service("lease_notification_push", [100])).find(
    ({ id }) => id === restrictedDevice.id,
  );
  assert.ok(restrictedPush);
  const internalOutbox =
    await sql(`select o.id from private.notification_email_outbox o
      join public.notifications n on n.id=o.notification_id
      where n.kind='course_offer_published' and n.resource_id=${q(internal)};`);
  const privateLeases = await service("lease_notification_emails", [20]);
  const internalLease = privateLeases.find(({ id }) => id === internalOutbox);
  const internalDelivery = await prepare(internalLease);
  assert.equal(internalDelivery.recipient, email(broad));
  assert.deepEqual(internalDelivery.offer, {
    id: internal,
    title,
    description,
    internal: true,
    quote: null,
  });
  assert.equal(await finish(internalLease), true);
  await sql(
    `delete from private.company_lecturers where organisation_id=${q(company)} and lecturer_id=${q(broad)};`,
  );
  assert.equal(await preparePush(restrictedPush), null);
  assert.equal(
    (await pushQueue(restricted)).find(({ id }) => id === restrictedDevice.id)
      ?.state,
    "suppressed",
  );
  for (const lease of privateLeases.filter(({ id }) => id !== internalOutbox))
    await prepare(lease);
  assert.equal(
    (await queue(restricted)).find(
      ({ kind }) => kind === "course_offer_published",
    )?.state,
    "suppressed",
  );
  console.log(
    "PASS complete schedule required; company-only scope and roster removal checked at send time",
  );

  await sql("delete from private.notification_email_outbox;");
  const deferred = await create({ status: "published" });
  const currentLeases = await service("lease_notification_emails", [20]);
  await sql(`update private.delivery_preferences set quiet_start='00:00',quiet_end='23:59',
      time_zone=case when (now() at time zone 'UTC')::time < '12:00' then 'UTC' else 'Etc/GMT+12' end
      where user_id=${q(broad)};
      update private.notification_preferences set job_updates=false where user_id=${q(matching)};`);
  for (const lease of currentLeases) assert.equal(await prepare(lease), null);
  const rich = (await queue(deferred)).filter(
    ({ kind }) => kind === "course_offer_published",
  );
  assert.equal(rich.find(({ user }) => user === broad)?.state, "pending");
  assert.equal(rich.find(({ user }) => user === matching)?.state, "suppressed");
  await sql(`update private.delivery_preferences set quiet_start=null,quiet_end=null where user_id=${q(broad)};
      update private.notification_email_outbox set available_at=now() where state='pending';
      update public.jobs set status='archived' where id=${q(deferred)};`);
  for (const lease of await service("lease_notification_emails", [20]))
    assert.equal(await prepare(lease), null);
  assert.ok(
    (await queue(deferred)).every(({ state }) => state === "suppressed"),
  );
  console.log(
    "PASS quiet hours, changed preferences and archived offer suppress or defer delivery",
  );
});
