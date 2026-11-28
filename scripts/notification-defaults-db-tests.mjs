/** Upgrade and delivery regressions for default mail and scoped calendar and finance notifications. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {quoteSql as q, withTestDatabase} from "./testing/database.mjs";

await withTestDatabase("notification_defaults", async ({sql, actor}) => {
    const [lecturer, company, manager, optedOut, unconfirmed, event, invoice, file, version, historical, fresh, participant] =
        Array.from({length: 12}, randomUUID);
    const roles = [
        [lecturer, "lecturer"], [company, "client"], [manager, "management"],
        [optedOut, "admin"], [unconfirmed, "lecturer"], [participant, "participant"],
    ];
    const categories = {chat: true, forum: true, job_updates: true, reminders: true};
    const json = (value) => `${q(JSON.stringify(value))}::jsonb`;
    const own = (id, expression) => actor(id, `select to_jsonb(public.${expression})`).then(JSON.parse);
    const service = (expression) => sql(
        `begin;set local role service_role;select coalesce(to_jsonb(public.${expression}),'null'::jsonb);commit;`,
    ).then(JSON.parse);
    const delivery = (id) => own(id, "delivery_preferences()");
    const prefs = (id) => own(id, "notification_preferences()");
    const save = async (id, selection) =>
        own(id, `save_notification_preferences(${json(selection)},${(await prefs(id)).version})`);
    const inbox = async (id, kind) =>
        (await own(id, "notification_inbox()")).items.filter((item) => item.kind === kind);
    const queued = (channel, kind, resource) => sql(`
        select coalesce(jsonb_agg(jsonb_build_object('user', n.user_id, 'state', d.state, 'id', d.id)
            order by n.user_id),'[]')
        from private.notification_${channel}_outbox d
        join public.notifications n on n.id = d.notification_id
        where n.kind = ${q(kind)} and n.resource_id = ${q(resource)}
    `).then(JSON.parse);
    const prepareCall = (channel, lease) =>
        `prepare_notification_${channel}(${q(lease.id)},${q(lease.lease_token)})`;
    const prepare = (channel, lease) => service(prepareCall(channel, lease));
    const reviewPreparation = (channel, lease) => sql(
        `begin;set local role service_role;select public.${prepareCall(channel, lease)};rollback;`,
    ).then(JSON.parse);

    await sql(`
        insert into auth.users(id,email,email_confirmed_at) values
            ${roles.map(([id]) =>
    `(${q(id)},${q(id + "@example.invalid")},${id === unconfirmed ? "null" : "now()"})`).join(",")};
        insert into public.user_roles(user_id,role) values
            ${roles.map(([id, role]) => `(${q(id)},${q(role)})`).join(",")};
        insert into public.notifications(user_id,kind,resource_id)
            values (${q(lecturer)},'claim_cancelled',${q(historical)});
    `);
    assert.equal((await delivery(lecturer)).email_enabled, false);
    assert.equal((await delivery(optedOut)).version, 1);
    await own(optedOut, `save_delivery_preferences(${json({
        email_enabled: false, quiet_start: "22:00", quiet_end: "07:00", time_zone: "Europe/Berlin",
    })},1)`);

    const migration = await readFile(new URL(
        "../supabase/migrations/20261128124100_notification_defaults_and_scoped_delivery.sql",
        import.meta.url,
    ), "utf8");
    await sql(migration);
    assert.equal((await delivery(lecturer)).email_enabled, true);
    await sql(`
        insert into auth.users(id,email,email_confirmed_at) values (${q(fresh)},${q(fresh + "@example.invalid")},now());
        insert into public.user_roles(user_id,role) values (${q(fresh)},'lecturer');
    `);
    assert.equal((await delivery(fresh)).email_enabled, true);
    assert.equal(await sql(`
        select private.notification_email_selected(user_id, email_enabled, version)
        from private.delivery_preferences where user_id = ${q(participant)};
    `), "f");
    assert.deepEqual(await delivery(optedOut), {
        email_enabled: false, quiet_start: "22:00", quiet_end: "07:00", time_zone: "Europe/Berlin", version: 2,
    });
    assert.deepEqual(await queued("email", "claim_cancelled", historical), []);
    assert.deepEqual(await prefs(lecturer), {...categories, events: true, invoices: true, version: 1});
    await save(lecturer, {...categories, events: false, invoices: false});
    assert.deepEqual(await save(lecturer, {...categories, chat: false}), {
        ...categories, chat: false, events: false, invoices: false, version: 3,
    });
    await save(lecturer, {...categories, events: true, invoices: true});

    await sql(`
        update private.push_configuration set enabled = true;
        insert into private.push_subscriptions(user_id,endpoint,p256dh,auth_secret,device_token,label)
        select profile.id,'https://fcm.googleapis.com/fixture/' || profile.id,'fixture','fixture',gen_random_uuid(),'Fictional device'
        from public.profiles profile where id in (${q(manager)},${q(lecturer)});
        insert into public.global_events(id,title,starts_at,ends_at,published)
        values (${q(event)},'Fictional private invitation',now() + interval '1 day',now() + interval '2 days',true);
    `);
    const code = (id) => sql(`select luminovia_user_id from public.profiles where id = ${q(id)}`);
    const lecturerCode = await code(lecturer);
    const unconfirmedCode = await code(unconfirmed);
    assert.equal(await own(manager, `set_calendar_invitation(${q(event)},1,${q(lecturerCode)},true,0)`), true);
    assert.equal(await own(manager, `set_calendar_invitation(${q(event)},1,${q(unconfirmedCode)},true,0)`), true);
    assert.equal((await inbox(lecturer, "calendar_invitation")).length, 1);
    assert.equal((await inbox(company, "calendar_invitation")).length, 0);
    for (const channel of ["email", "push"]) {
        assert.deepEqual((await queued(channel, "calendar_invitation", event)).map((row) => row.user), [lecturer]);
    }
    const [invitationMail] = await service("lease_notification_emails(20)");
    const [invitationPush] = await service("lease_notification_push(20)");
    const invitation = await reviewPreparation("email", invitationMail);
    assert.equal(invitation.recipient, lecturer + "@example.invalid");
    assert.equal(invitation.kind, "calendar_invitation");
    assert.equal("title" in invitation, false);
    assert.ok((await reviewPreparation("push", invitationPush)).subscription);
    await own(manager, `set_calendar_invitation(${q(event)},1,${q(lecturerCode)},false,1)`);
    assert.equal(await prepare("email", invitationMail), null);
    assert.equal(await prepare("push", invitationPush), null);

    await sql(`
        insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id)
        values (${q(file)},${q(lecturer)},${q(lecturer)},'personal','invoice','Fictional.pdf','application/pdf',100,'clean',gen_random_uuid());
        insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,sha256,status)
        values (${q(version)},${q(file)},${q(lecturer)},gen_random_uuid(),1,${q(lecturer + "/" + file + "/" + version)},
            'Fictional.pdf','application/pdf',100,${q("c".repeat(64))},'clean');
        insert into public.invoices(id,user_id,number,issued_on,due_on,currency,total_amount,document_version_id,client_id)
        values (${q(invoice)},${q(lecturer)},'Fictional confidential number',current_date,current_date + 30,'EUR',100,${q(version)},gen_random_uuid());
    `);
    const [staffReceipt] = await inbox(manager, "invoice_received_for_review");
    assert.ok(staffReceipt);
    assert.equal(staffReceipt.href, "/finance");
    assert.equal(staffReceipt.title, "");
    assert.equal((await inbox(company, "invoice_received_for_review")).length, 0);
    assert.equal((await inbox(lecturer, "invoice_submitted")).length, 1);

    const [staffEmail] = await queued("email", "invoice_received_for_review", invoice);
    const [staffPush] = await queued("push", "invoice_received_for_review", invoice);
    assert.equal(staffEmail.user, manager);
    assert.equal(staffPush.user, manager);
    assert.equal((await queued("email", "invoice_received_for_review", invoice)).length, 1);
    const mailLeases = await service("lease_notification_emails(20)");
    const pushLeases = await service("lease_notification_push(20)");
    const financeMailLease = mailLeases.find((lease) => lease.id === staffEmail.id);
    const financePushLease = pushLeases.find((lease) => lease.id === staffPush.id);
    const financeMail = await reviewPreparation("email", financeMailLease);
    assert.equal(financeMail.kind, "invoice_received_for_review");
    assert.equal(financeMail.recipient, manager + "@example.invalid");
    assert.equal("title" in financeMail, false);
    assert.ok((await reviewPreparation("push", financePushLease)).subscription);
    await sql(`delete from public.user_roles where user_id = ${q(manager)} and role = 'management'`);
    assert.equal(await prepare("email", financeMailLease), null);
    assert.equal(await prepare("push", financePushLease), null);
    console.log("PASS Notification default upgrade, legacy preferences, confirmed recipients, calendar withdrawal and finance role revocation.");
}, {migrationsThrough: "20261128124000"});
