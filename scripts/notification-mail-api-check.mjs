/** Real disposable Auth/PostgREST -> Python worker -> loopback-only SMTP. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {spawn} from "node:child_process";
import {withApiFixture} from "./testing/api.mjs";
import {quoteSql as q} from "./testing/database.mjs";

// This code is fixed source, never constructed from a user value. Credentials
// enter only via the child environment, and the worker connects only to its
// fixed loopback relay endpoint. The captured SMTP dialogue stays local.
const capture = `
import json, os, smtplib, sys
from email import message_from_bytes, policy
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path("scripts").resolve()))
import test_notification_mail_worker as fixture
worker = fixture.worker
config = worker.Config.from_env(os.environ)
server = fixture.SmtpServer(sys.argv[1])
original_smtp = smtplib.SMTP
def connect(host, port, *, timeout):
    assert (host, port) == ("127.0.0.1", 2526)
    return original_smtp("127.0.0.1", server.server_address[1], timeout=timeout)
with fixture.server_context(server), patch.object(smtplib, "SMTP", connect):
    result = worker.run(config)
messages = [message_from_bytes(message, policy=policy.default) for message in server.messages]
print(json.dumps({
    "counts": result,
    "messages": len(messages),
    "ids": [message["Message-ID"] for message in messages],
    "recipients": [message["To"] for message in messages],
    "subjects": [message["Subject"] for message in messages],
    "bodies": [message.get_content() for message in messages],
}))
`;

function runWorker(url, mode = "accepted") {
    return new Promise((resolve, reject) => {
        const child = spawn("python3", ["-c", capture, mode], {
            stdio: ["ignore", "pipe", "pipe"],
            env: {
                ...process.env,
                PORTAL_NOTIFICATION_MAIL_ENABLED: "true",
                PORTAL_NOTIFICATION_API_URL: url,
                PORTAL_NOTIFICATION_APP_ORIGIN: "http://127.0.0.1:5273",
                PORTAL_NOTIFICATION_SERVICE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
                PORTAL_NOTIFICATION_SMTP_USERNAME: "info@example.invalid",
                PORTAL_NOTIFICATION_SMTP_PASSWORD: "fictional-smtp-fixture",
                PORTAL_NOTIFICATION_SMTP_PORT: "2526",
                PORTAL_NOTIFICATION_TIMEOUT_SECONDS: "5",
                PORTAL_NOTIFICATION_BATCH: "10",
            },
        });
        let output = "";
        let bytes = 0;
        let timer;
        child.stdout.on("data", (chunk) => {
            bytes += chunk.length;
            if (bytes > 65536) child.kill("SIGKILL");
            else output += chunk;
        });
        // Never relay Python tracebacks/HTTP headers to the outer test log.
        child.stderr.resume();
        child.on("error", () => {
            clearTimeout(timer);
            reject(new Error("Loopback mail worker could not start"));
        });
        child.on("close", (code) => {
            clearTimeout(timer);
            try {
                assert.equal(code, 0, "Loopback mail worker process completed");
                resolve(JSON.parse(output));
            } catch {
                reject(
                    new Error("Loopback mail worker failed or returned invalid data"),
                );
            }
        });
        timer = setTimeout(() => child.kill("SIGKILL"), 30000);
    });
}

await withApiFixture(async ({actor, service, checked, sql, defer, url}) => {
    const owner = await actor("mail-worker-owner", "lecturer");
    const peer = await actor("mail-worker-peer", "lecturer");
    defer(async () => {
        await checked(
            service.from("notifications").delete().in("user_id", [owner.id, peer.id]),
            "Remove own email notification fixtures",
        );
    });
    // Service-wide leases must start with an empty unrelated queue. All SMTP
    // submissions from the isolated fixture go to the loopback capture.
    assert.equal(
        await sql(
            `select count(*)
             from private.notification_email_outbox o
             left join public.notifications n on n.id = o.notification_id
             where o.state in ('pending', 'leased', 'sending')
               and (n.user_id is null or n.user_id not in (${q(owner.id)}, ${q(peer.id)}))`,
        ),
        "0",
        "No unrelated delivery belongs in this disposable fixture",
    );
    const preferences = await checked(
        owner.client.rpc("delivery_preferences"),
        "Read actual channel defaults",
    );
    assert.equal(preferences.email_enabled, true);
    let current = await checked(
        owner.client.rpc("save_delivery_preferences", {
            p_expected_version: preferences.version,
            p_payload: {
                email_enabled: true,
                quiet_start: null,
                quiet_end: null,
                time_zone: "Australia/Brisbane",
            },
        }),
        "Set own delivery time zone using real Auth",
    );
    for (const rpc of [
        ["lease_notification_emails", {p_limit: 1}],
        ["refresh_notification_reminders", {p_limit: 1}],
        [
            "prepare_notification_email",
            {p_id: randomUUID(), p_lease_token: randomUUID()},
        ],
        [
            "finish_notification_email",
            {
                p_id: randomUUID(),
                p_lease_token: randomUUID(),
                p_outcome: "accepted",
            },
        ],
    ]) {
        assert.equal(
            (await owner.client.rpc(...rpc)).error?.code,
            "42501",
            `Browser identity cannot call ${rpc[0]}`,
        );
    }
    assert.equal(
        (await checked(peer.client.rpc("delivery_preferences"), "Peer isolation"))
            .email_enabled,
        true,
    );

    async function createNotice() {
        const id = randomUUID();
        await checked(
            service.from("notifications").insert({
                id,
                user_id: owner.id,
                kind: "claim_cancelled",
                resource_id: randomUUID(),
            }),
            "Commit own fictional cancellation notice",
        );
        return id;
    }

    const state = (id) =>
        sql(
            `select state
             from private.notification_email_outbox
             where notification_id = ${q(id)}`,
        );
    const accepted = await createNotice();
    assert.equal(await state(accepted), "pending");
    const first = await runWorker(url);
    assert.equal(first.counts.accepted, 1);
    assert.equal(first.counts.rpc_errors, 0);
    assert.equal(first.messages, 1);
    assert.deepEqual(first.recipients, [owner.email]);
    assert.equal(
        first.ids[0],
        `<luminovia-notification.${await sql(`select id from private.notification_email_outbox where notification_id=${q(accepted)}`)}@luminovia.org>`,
    );
    assert.equal(await state(accepted), "accepted");

    const uncertain = await createNotice();
    const lostReply = await runWorker(url, "ambiguous_data");
    assert.equal(lostReply.counts.uncertain, 1);
    assert.equal(lostReply.messages, 1);
    assert.equal(await state(uncertain), "uncertain");
    const repeated = await runWorker(url);
    assert.equal(
        repeated.messages,
        0,
        "A later scheduled batch cannot resend uncertain DATA",
    );
    assert.equal(await state(uncertain), "uncertain");

    const suppressed = await createNotice();
    assert.equal(await state(suppressed), "pending");
    current = await checked(
        owner.client.rpc("save_delivery_preferences", {
            p_expected_version: current.version,
            p_payload: {
                email_enabled: false,
                quiet_start: null,
                quiet_end: null,
                time_zone: "Australia/Brisbane",
            },
        }),
        "Withdraw opt-in after enqueue, before delivery",
    );
    assert.equal(current.email_enabled, false);
    const revoked = await runWorker(url);
    assert.equal(revoked.messages, 0);
    assert.equal(revoked.counts.suppressed, 1);
    assert.equal(await state(suppressed), "suppressed");
    console.log(
        "Actual Auth/PostgREST/Python/loopback-SMTP acceptance, uncertain fencing, opt-out recheck and browser worker denial passed.",
    );

    // The participant has two independent company-course scopes. Its existing
    // delivery choice is seeded for this test; participant settings stay scoped.
    const admin = await actor("premium-mail-admin", "admin");
    const learner = await actor("premium-mail-learner", "participant");
    const template = randomUUID();
    const companies = ["A", "B"].map((label) => ({
        label,
        id: randomUUID(),
        run: randomUUID(),
    }));
    const [companyA, companyB] = companies;
    const companyIds = companies.map(({id}) => q(id)).join(",");
    const runIds = companies.map(({run}) => q(run)).join(",");
    defer(() => sql(`
        delete from public.notifications where user_id in (${q(admin.id)}, ${q(learner.id)});
        delete from private.company_premium_commands where organisation_id in (${companyIds});
        delete from private.company_premium_audit where organisation_id in (${companyIds});
        delete from private.company_premium_settings where organisation_id in (${companyIds});
        delete from public.course_enrolments where course_run_id in (${runIds});
        delete from public.course_runs where id in (${runIds});
        delete from public.course_templates where id = ${q(template)};
        delete from public.organisations where id in (${companyIds});
    `));
    await sql(`
        insert into public.course_templates(id, title)
        values (${q(template)}, 'Fictional Premium SMTP course');
        update private.delivery_preferences set email_enabled = true
        where user_id = ${q(learner.id)};
        update public.profiles set locale = 'en' where id = ${q(learner.id)};
    `);
    const setPremium = async (company, enabled, version) => {
        const result = await checked(admin.client.rpc("set_company_premium", {
            p_organisation_id: company.id,
            p_enabled: enabled,
            p_expected_version: version,
            p_request_id: randomUUID(),
        }), `Commit company ${company.label} Premium change`);
        assert.deepEqual(result, {status: "updated", enabled, version: version + 1});
    };
    const reference = await checked(service.from("profiles").select("luminovia_user_id")
        .eq("id", learner.id).single(), "Read own fictional learner reference");
    for (const company of companies) {
        await sql(`
            insert into public.organisations(id, name) values
                (${q(company.id)}, ${q(`Fictional Premium SMTP ${company.label}`)});
            insert into public.course_runs(id, template_id, organisation_id, published)
            values (${q(company.run)}, ${q(template)}, ${q(company.id)}, true);
        `);
        await setPremium(company, true, 0);
        await checked(admin.client.rpc("request_company_participant_link", {
            p_organisation_id: company.id,
            p_luminovia_user_id: reference.luminovia_user_id,
            p_request_id: randomUUID(),
        }), "Request scoped link");
        const invitations = await checked(learner.client.rpc("my_company_participant_invitations"));
        const invitation = invitations.find(({organisation_id}) => organisation_id === company.id);
        assert.ok(invitation);
        await checked(learner.client.rpc("accept_company_participant_invitation", {
            p_organisation_id: company.id,
            p_expected_version: invitation.version,
            p_request_id: randomUUID(),
        }), "Accept scoped link");
        await checked(admin.client.rpc("manage_course_enrolment", {
            p_course_run_id: company.run,
            p_user_id: learner.id,
            p_status: "enrolled",
        }), "Enrol learner within the respective company");
    }
    const courseAction = (who, company, action, payload, version) =>
        who.client.rpc("course_workspace_action", {
            p_run_id: company.run,
            p_action: action,
            p_payload: payload,
            p_expected_version: version,
        });
    const privateQuestion = "Fictional private question not for mail";
    const privateAnswer = "Fictional private answer not for mail";
    const answer = async (company) => {
        const created = await checked(
            courseAction(learner, company, "question", {body: privateQuestion}, 0),
            "Ask a question as the enrolled learner",
        );
        const question = created.id;
        assert.match(question, /^[0-9a-f-]{36}$/);
        await checked(
            courseAction(admin, company, "answer", {id: question, answer: privateAnswer}, 1),
            "Commit course answer as the permitted admin",
        );
        const receipt = await sql(`select row_to_json(receipt) from (
            select n.id as notification_id,o.id as delivery_id,o.state
            from public.notifications n
            join private.notification_email_outbox o on o.notification_id=n.id
            where n.user_id=${q(learner.id)} and n.kind='course_answer' and n.resource_id=${q(question)}
        ) receipt`);
        const parsed = JSON.parse(receipt);
        assert.equal(parsed.state, "pending");
        return parsed;
    };
    const inbox = async () => new Set((await checked(learner.client.rpc("notification_inbox"),
        "Read currently visible participant notices")).items.map(({id}) => id));
    const pendingA = await answer(companyA);
    const pendingB = await answer(companyB);
    assert.ok((await inbox()).has(pendingA.notification_id));

    await setPremium(companyA, false, 1);
    const whileOff = await inbox();
    assert.ok(!whileOff.has(pendingA.notification_id));
    assert.ok(whileOff.has(pendingB.notification_id));
    const offResult = await runWorker(url);
    assert.equal(offResult.counts.suppressed, 1);
    assert.equal(await state(pendingA.notification_id), "suppressed");
    assert.equal(await state(pendingB.notification_id), "accepted");
    const verifyDelivery = (result, receipt, subject, bodyStart) => {
        assert.equal(result.counts.accepted, 1);
        assert.equal(result.counts.rpc_errors, 0);
        assert.equal(result.messages, 1);
        assert.deepEqual(result.recipients, [learner.email]);
        assert.deepEqual(result.ids, [`<luminovia-notification.${receipt.delivery_id}@luminovia.org>`]);
        assert.deepEqual(result.subjects, [subject]);
        assert.ok(result.bodies[0].startsWith(bodyStart));
        assert.ok(result.bodies[0].includes("http://127.0.0.1:5273/notifications"));
        assert.ok(!result.bodies[0].includes(template));
        assert.ok(!result.bodies[0].includes(privateQuestion));
        assert.ok(!result.bodies[0].includes(privateAnswer));
    };
    verifyDelivery(offResult, pendingB, "Luminovia: New notification",
        "There is a new update in your Luminovia portal.");

    await setPremium(companyA, true, 2);
    assert.ok((await inbox()).has(pendingA.notification_id));
    assert.equal((await runWorker(url)).messages, 0, "Reactivation cannot replay prior email");
    assert.equal(await state(pendingA.notification_id), "suppressed");
    assert.equal(await state(pendingB.notification_id), "accepted");
    await sql(`update public.profiles set locale = 'de' where id = ${q(learner.id)}`);
    const freshA = await answer(companyA);
    const freshResult = await runWorker(url);
    verifyDelivery(freshResult, freshA, "Luminovia: Neue Benachrichtigung",
        "In deinem Luminovia-Portal gibt es eine neue Meldung.");
    assert.notEqual(freshResult.ids[0], offResult.ids[0]);
    assert.equal(await state(freshA.notification_id), "accepted");
    assert.equal((await runWorker(url)).messages, 0);
    console.log(
        "PASS Premium LMS two-company Auth/PostgREST/loopback SMTP: A OFF, B delivered, A ON without historical mail replay, private payload redaction and DE/EN Message-ID verification.",
    );
});
