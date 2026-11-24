import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { prepareAcademyInstallation } from "./academy-installation.mjs";
import { signAcademyLicence } from "./academy-licence.mjs";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

await withTestDatabase("mail_recovery_test", async ({sql, actor}) => {
    const [admin, teacher, course, claim, session, notice, outbox] = Array.from({length: 7}, randomUUID);
    const call = async (user, name, args = []) =>
        JSON.parse(await actor(user, `select to_jsonb(public.${name}(${args.join(",")}))`));
    const reject = (id, definite) => sql(`begin;set local role service_role;
      set local request.jwt.claims='{"role":"service_role"}';
      select public.complete_invitation_delivery_failure(${q(id)},${definite});commit`);
    const reserve = (address, request = randomUUID()) =>
        call(admin, "reserve_account_invitation", [q(address), "'Fictional recipient'", "'lecturer'", "null", q(request)]);
    const retryInvite = (id, address, request = randomUUID()) =>
        call(admin, "reserve_invitation_delivery_retry", [q(id), q(address), q(request)]);
    const failures = (who = admin) => call(who, "mail_delivery_failures");
    await sql(`insert into auth.users(id,email,email_confirmed_at) values
      (${q(admin)},'mail-recovery-admin@example.invalid',now()),
      (${q(teacher)},'old-course-mail@example.invalid',now());
      insert into public.user_roles(user_id,role) values (${q(admin)},'admin'),(${q(teacher)},'lecturer');`);

    const unknown = await reserve("uncertain-invite@example.invalid");
    await reject(unknown.invitation_id, false);
    const unsafe = (await failures()).find((item) => item.id === unknown.invitation_id);
    assert.equal(unsafe.status, "uncertain");
    assert.equal(unsafe.retry_allowed, false);
    await assert.rejects(retryInvite(unknown.invitation_id, "new-uncertain@example.invalid"), /42501/);
    await assert.rejects(failures(teacher), /42501/);
    await assert.rejects(actor(teacher, `select public.complete_invitation_delivery_failure(${q(unknown.invitation_id)},true)`), /42501/);
    console.log("PASS Delivery failures require administration; ambiguous invitation outcomes cannot be retried");

    const original = await reserve("original-invite@example.invalid");
    await reject(original.invitation_id, true);
    const key = randomUUID();
    const replacement = await retryInvite(original.invitation_id, "corrected-invite@example.invalid", key);
    assert.equal(replacement.status, "reserved");
    assert.equal(replacement.email, "corrected-invite@example.invalid");
    assert.equal(replacement.role, "lecturer");
    assert.equal(replacement.display_name, "Fictional recipient");
    assert.equal((await retryInvite(original.invitation_id, replacement.email, key)).status, "in_progress");
    assert.equal((await retryInvite(original.invitation_id, "other-address@example.invalid")).status, "idempotency_conflict");
    assert.equal((await reserve(replacement.email)).status, "in_progress");
    await reject(replacement.invitation_id, true);
    const sameAddress = await retryInvite(replacement.invitation_id, replacement.email);
    assert.equal(sameAddress.status, "reserved");
    assert.notEqual(sameAddress.invitation_id, replacement.invitation_id);
    assert.equal((await failures()).some(({id}) => id === original.invitation_id), false);
    console.log("PASS Corrected and unchanged-address invitation retries retain prior evidence and reserve once");

    const finished = "2026-01-02T03:04:05Z";
    await sql(`insert into public.jobs(id,title,customer_name,delivery_type,status,amount,currency,rate_unit,total_amount,terms)
      values(${q(course)},'Fictional course','Fictional company','online','filled',100,'EUR','fixed_total',100,'Fictional terms');
      insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,amount,currency,rate_unit,total_amount,terms,terms_version)
      values(${q(claim)},${q(course)},${q(teacher)},${q(randomUUID())},100,'EUR','fixed_total',100,'Fictional terms',1);
      insert into public.assignment_sessions(id,claim_id,lecturer_id,starts_at,ends_at)
      values(${q(session)},${q(claim)},${q(teacher)},now()+interval '2 hours',now()+interval '3 hours');
      insert into public.notifications(id,user_id,kind,resource_id) values(${q(notice)},${q(teacher)},'session_reminder',${q(session)});
      update private.delivery_preferences set email_enabled=true where user_id=${q(teacher)};
      insert into private.notification_email_outbox(id,notification_id,occurrence_at,state,attempts,finished_at,error_code)
      select ${q(outbox)},id,created_at,'failed',3,${q(finished)},'smtp_recipient_rejected'
      from public.notifications where id=${q(notice)};`);
    const courseArgs = (request) => [q(outbox), q(finished), q(request)];
    const receiptKey = randomUUID();
    await assert.rejects(call(teacher, "retry_course_mail_delivery", courseArgs(receiptKey)), /42501/);
    const initialMail = (await failures()).find(({id}) => id === outbox);
    assert.equal(initialMail.recipient, "old-course-mail@example.invalid");
    assert.equal(initialMail.retry_allowed, true);
    await sql(`update auth.users set email='verified-course-mail@example.invalid' where id=${q(teacher)}`);
    const correctedMail = (await failures()).find(({id}) => id === outbox);
    assert.equal(correctedMail.recipient, "verified-course-mail@example.invalid");
    assert.equal(await call(admin, "retry_course_mail_delivery", courseArgs(receiptKey)), outbox);
    assert.equal(await call(admin, "retry_course_mail_delivery", courseArgs(receiptKey)), outbox);
    await assert.rejects(call(admin, "retry_course_mail_delivery", courseArgs(randomUUID())), /PT409/);
    assert.equal(await sql(`select state from private.notification_email_outbox where id=${q(outbox)}`), "pending");
    assert.equal(await sql(`select attempt_count from private.course_mail_delivery_retries where outbox_id=${q(outbox)}`), "3");
    console.log("PASS Course mail retry preserves the original occurrence, uses current confirmed email and deduplicates the write");

    await sql(`update private.notification_email_outbox set state='uncertain',finished_at=${q(finished)} where id=${q(outbox)}`);
    assert.equal((await failures()).find(({id}) => id === outbox).retry_allowed, false);
    await assert.rejects(call(admin, "retry_course_mail_delivery", courseArgs(randomUUID())), /PT409/);
    console.log("PASS Course mail provider ambiguity cannot be requeued");
});

for (const edition of ["customer-managed", "customer-self-hosted"]) {
    await withTestDatabase("academy_mail_recovery_test", async ({sql, actor}) => {
        const [installation, admin, outsider] = Array.from({length: 3}, randomUUID);
        const {publicKey, privateKey} = generateKeyPairSync("ed25519");
        const relative = (days) => new Date(Date.now() + days * 86400000).toISOString();
        const terms = {
            installation_id: installation,
            edition,
            release_commit: "ac".repeat(20),
            issued_at: relative(-3),
            starts_at: relative(-2),
            expires_at: relative(2),
            grace_until: relative(3),
            modules: ["lms"],
            limits: { seat_count: 12, storage_bytes: 1000000, api_requests_per_minute: 60 },
        };
        await prepareAcademyInstallation({
            envelope: signAcademyLicence(terms, privateKey), publicKey,
            expected: terms, now: Date.now(),
        }, sql);
        await sql(`select private.configure_academy_course_access(${q(installation)},${q(terms.release_commit)},true);
          insert into auth.users(id,email,email_confirmed_at) values
          (${q(admin)},'academy-mail-admin@example.invalid',now()),
          (${q(outsider)},'academy-instructor@example.invalid',now());
          insert into public.user_roles(user_id,role) values (${q(admin)},'admin'),(${q(outsider)},'lecturer');`);
        const request = async (who, endpoint, args = "", method = "POST") =>
            JSON.parse(await actor(who, `set local request.path=${q("/rpc/" + endpoint)};
              set local request.method=${q(method)};select public.require_portal_access();
              select public.${endpoint}(${args});`));
        const email = "old-academy-recipient@example.invalid";
        const original = await request(admin, "reserve_academy_account",
            `${q(randomUUID())},${q(email)},'Fictional Academy recipient','lecturer',null,'invite'`);
        await assert.rejects(request(admin, "academy_reject_invitation_delivery", q(original.creation_id)), /42501/);
        assert.equal(await sql(`begin;set local role service_role;
          set local request.jwt.claims='{"role":"service_role"}';
          set local request.path='/rpc/academy_reject_invitation_delivery';
          set local request.method='POST';select public.require_portal_access();
          select public.academy_reject_invitation_delivery(${q(original.creation_id)});commit`), "t");
        const initial = await request(admin, "mail_delivery_failures", "", "GET");
        assert.equal(initial.find(({id}) => id === original.creation_id).retry_allowed, true);
        await assert.rejects(request(outsider, "mail_delivery_failures", "", "GET"), /42501/);
        const desired = "correct-academy-recipient@example.invalid";
        const key = randomUUID();
        const payload = `${q(original.creation_id)},${q(desired)},${q(key)}`;
        const accepted = await request(admin, "academy_reserve_invitation_delivery_retry", payload);
        assert.equal(accepted.status, "reserved");
        assert.equal(accepted.email, desired);
        assert.equal(accepted.role, "lecturer");
        assert.equal((await request(admin, "academy_reserve_invitation_delivery_retry", payload)).status, "in_progress");
        await assert.rejects(request(admin, "academy_reserve_invitation_delivery_retry",
            `${q(original.creation_id)},${q(desired)},${q(randomUUID())}`), /PT409/);
        assert.equal((await request(admin, "mail_delivery_failures", "", "GET")).length, 0);
        console.log(`PASS ${edition} invitation recovery uses the licensed native administration gate and a scoped replacement`);
    });
}
