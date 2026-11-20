/**
 * Real Auth/HTTP checks for executed contract PDFs, earnings, invoices and payments.
 * Separate fictional identities verify actual API results and denied access; responses are not browser mocks.
 */
import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import {createClient} from "@supabase/supabase-js";
import {assertPasswordOnly} from "./testing/password-only.mjs";

process.loadEnvFile(".env.test.local");
const url = process.env.SUPABASE_URL;
assert.ok(
    url && ["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname),
    "Commercial checks only permit loopback projects.",
);
const origin = new URL(
    process.env.PORTAL_APP_ORIGIN ??
    process.env.E2E_BASE_URL ??
    "http://127.0.0.1:5173",
).origin;
/** Creates a separate SDK client without persistent sessions or automatic session refresh. */
const make = (key) =>
    createClient(url, key, {
        auth: {persistSession: false, autoRefreshToken: false},
    });
const service = make(process.env.SUPABASE_SERVICE_ROLE_KEY),
    users = [],
    clients = [],
    jobs = [];
const suffix = randomUUID();

/** Requires actual SDK success before returning the response data. */
async function checked(request, label) {
    const {data, error} = await request;
    assert.equal(error, null, `${label}: ${error?.message}`);
    return data;
}

/** Creates separate fictional accounts and signs them in through Auth; their IDs belong only to the fixture. */
async function fixture(name, role) {
    const email = `commercial-${name}-${suffix}@example.invalid`;
    const auth = await checked(
        service.auth.admin.createUser({
            email,
            password: process.env.E2E_PASSWORD,
            email_confirm: true,
        }),
        "Create temporary commercial fixture",
    );
    users.push(auth.user.id);
    await checked(
        service.from("user_roles").insert({user_id: auth.user.id, role}),
        "Set known fixture role",
    );
    await checked(
        service
            .from("profiles")
            .update({display_name: `Commercial QA ${name}`})
            .eq("id", auth.user.id),
        "Set fictional name",
    );
    const client = make(process.env.SUPABASE_ANON_KEY);
    clients.push(client);
    await checked(
        client.auth.signInWithPassword({
            email,
            password: process.env.E2E_PASSWORD,
        }),
        "Actual Auth sign-in",
    );
    return {client, id: auth.user.id};
}

/** Creates synthetic PDF bytes for the real file-validation path without personal source documents. */
function pdf(label) {
    const objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 100] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        null,
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ];
    const stream = `BT /F1 9 Tf 10 50 Td (${label}) Tj ET`;
    objects[3] = `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;
    let body = "%PDF-1.4\n";
    const offsets = [0];
    for (const [index, object] of objects.entries()) {
        offsets.push(Buffer.byteLength(body));
        body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    }
    const xref = Buffer.byteLength(body);
    body +=
        `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
        offsets
            .slice(1)
            .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
            .join("") +
        `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return new TextEncoder().encode(body);
}

/** Reads the test actor's current session token for actual authenticated gateway requests. */
async function headers(actor) {
    const data = await checked(
        actor.client.auth.getSession(),
        "Read local session",
    );
    return {
        Origin: origin,
        apikey: process.env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${data.session.access_token}`,
    };
}

/** Sends real fixture bytes through the authenticated file endpoint; scanning and release remain server responsibilities. */
async function upload(actor, bytes, kind, owner, replace) {
    const form = new FormData();
    form.set(
        "file",
        new File([bytes], `${kind}.pdf`, {type: "application/pdf"}),
    );
    form.set("scope", "personal");
    form.set("kind", kind);
    form.set("client_id", randomUUID());
    if (owner) form.set("owner_id", owner);
    if (replace) form.set("replace_id", replace);
    const response = await fetch(`${url}/functions/v1/files`, {
        method: "POST",
        headers: await headers(actor),
        body: form,
        signal: AbortSignal.timeout(90000),
    });
    const body = await response.json();
    assert.equal(
        response.status,
        200,
        `Actual scanned ${kind} upload: ${body.error ?? "unexpected response"}`,
    );
    assert.equal(body.document.status, "clean");
    return body.document;
}

/** Requests the authorised bytes for this identity and exact document version through the gateway. */
async function download(actor, id, versionId) {
    return fetch(`${url}/functions/v1/files`, {
        method: "POST",
        headers: {...(await headers(actor)), "Content-Type": "application/json"},
        body: JSON.stringify({action: "download", id, version_id: versionId}),
    });
}

/** Creates a fictional job with controlled sessions and terms for the following assertions. */
async function job(admin, day, fee, topics = []) {
    const date = new Date(Date.now() + (90 + day) * 86400000);
    date.setUTCHours(8, 0, 0, 0);
    const data = await checked(
        admin.client.rpc("create_job", {
            p_payload: {
                title: `Fictional tracked assignment ${suffix} ${day}`,
                customer_name: "Fictional billing customer",
                description: "Local QA only",
                delivery_type: "online",
                location: "Online",
                time_zone: "Europe/Berlin",
                status: "published",
                amount: fee,
                total_amount: fee,
                currency: "EUR",
                rate_unit: "fixed_total",
                terms: "Immutable accepted fee",
                requires_contract: true,
                sessions: [
                    {
                        starts_at: date.toISOString(),
                        ends_at: new Date(+date + 3600000).toISOString(),
                    },
                ],
                topic_ids: topics,
            },
        }),
        "Create actual commercial job",
    );
    jobs.push(data);
    return data;
}

try {
    const a = await fixture("lecturer", "lecturer"),
        b = await fixture("other", "senior_lecturer"),
        admin = await fixture("manager", "admin");
    await assertPasswordOnly(admin.client);
    const administratorContracts = await checked(
        admin.client.rpc("contract_records", {p_all: true}),
        "Administrator reads contract records with current contracts.read permission",
    );
    assert.ok(Array.isArray(administratorContracts));
    // Lecturers see themselves; management can use the bounded names-only picker with password-only Auth.
    for (const who of [a, b])
        assert.deepEqual(
            (
                await checked(
                    who.client.rpc("commercial_people"),
                    "Password-only actor receives only own commercial person",
                )
            ).map((person) => person.id),
            [who.id],
        );
    assert.ok(
        (await checked(admin.client.rpc("commercial_people"))).some(
            (person) => person.id === a.id,
        ),
        "Password-only admin can use the bounded names-only picker",
    );
    // Use a canonical active taxonomy entry, then select expertise through the lecturer's actual REST grant.
    const topic = (
        await checked(
            a.client.from("topics").select("id").is("archived_at", null).limit(1),
            "Select actual active qualification topic",
        )
    )[0].id;
    await checked(
        a.client.from("lecturer_topics").insert({user_id: a.id, topic_id: topic}),
        "Lecturer selects own unverified expertise",
    );
    const verification = {
        p_user_id: a.id,
        p_topic_id: topic,
        p_verified: true,
        p_valid_until: new Date(Date.now() + 365 * 86400000).toISOString(),
    };
    assert.equal(
        (await b.client.rpc("verify_lecturer_topic", verification)).error?.code,
        "42501",
        "Senior lecturer cannot attest another lecturer",
    );

    const people = await checked(
        admin.client.rpc("commercial_people"),
        "Actual password-only authentication commercial actor directory",
    );
    assert.ok(
        [a.id, b.id, admin.id].every((id) =>
            people.some((person) => person.id === id),
        ),
    );
    assert.ok(
        people.every((person) =>
            Object.keys(person).every((key) => ["id", "display_name"].includes(key)),
        ),
        "Commercial picker reveals names and IDs only",
    );
    const original = pdf("Fictional externally executed contract - QA only.");
    const contractDoc = await upload(a, original, "contract", a.id);
    assert.equal(
        (await download(admin, contractDoc.id, contractDoc.current_version_id))
            .status,
        403,
        "password-only authentication manager cannot download another lecturer's contract",
    );
    const ownerBytes = await download(
        a,
        contractDoc.id,
        contractDoc.current_version_id,
    );
    assert.equal(ownerBytes.status, 200);
    assert.deepEqual(new Uint8Array(await ownerBytes.arrayBuffer()), original);
    const candidates = await checked(
        admin.client.rpc("contract_registration_candidates", {p_user_id: a.id}),
        "Read bounded contract candidates",
    );
    assert.ok(
        candidates.some(
            (candidate) => candidate.version_id === contractDoc.current_version_id,
        ),
    );
    assert.ok(
        candidates.every(
            (candidate) =>
                Object.keys(candidate).sort().join(",") === "file_name,version_id",
        ),
    );
    const version = await checked(
        a.client
            .from("document_versions")
            .select("*")
            .eq("id", contractDoc.current_version_id)
            .single(),
        "Read scanned contract version",
    );
    assert.match(version.scanner_version, /^ClamAV /);
    assert.equal(
        version.sha256,
        createHash("sha256").update(original).digest("hex"),
    );
    const effective = new Date(Date.now() - 86400000).toISOString(),
        expires = new Date(Date.now() + 365 * 86400000).toISOString(),
        contractKey = randomUUID();
    const args = {
        p_user_id: a.id,
        p_title: "Executed fictional master",
        p_document_version_id: version.id,
        p_effective_from: effective,
        p_expires_at: expires,
        p_kind: "master",
        p_parent_id: null,
        p_client_id: contractKey,
    };
    const contract = await checked(
        admin.client.rpc("register_executed_contract", args),
        "Register actual scanned executed agreement",
    );
    assert.equal(
        await checked(
            admin.client.rpc("register_executed_contract", args),
            "Retry actual agreement registration",
        ),
        contract,
    );
    const receiptKey = randomUUID();
    const receipt = await checked(
        a.client.rpc("acknowledge_contract", {
            p_contract_id: contract,
            p_sha256: version.sha256,
            p_client_id: receiptKey,
        }),
        "Receipt acknowledgement only",
    );
    assert.equal(
        await checked(
            a.client.rpc("acknowledge_contract", {
                p_contract_id: contract,
                p_sha256: version.sha256,
                p_client_id: receiptKey,
            }),
            "Receipt retry",
        ),
        receipt,
    );
    assert.ok(
        (
            await b.client.rpc("acknowledge_contract", {
                p_contract_id: contract,
                p_sha256: version.sha256,
                p_client_id: randomUUID(),
            })
        ).error,
    );
    assert.deepEqual(
        await checked(
            b.client.rpc("contract_records"),
            "Other senior personal contracts",
        ),
        [],
    );
    assert.equal((await download(b, contractDoc.id, version.id)).status, 403);
    // Missing self-declared topics and contract expiry still prevent new claims.
    // Optional attestation/expiry remains historical evidence, not an allocation gate.
    // Accepted history must retain its exact contract and fee while later eligibility changes.
    const claims = [];
    for (const [day, fee] of [
        [1, 100],
        [2, 200],
    ]) {
        const id = await job(admin, day, fee, [topic]);
        const attempt = () =>
            a.client.rpc("claim_job", {
                p_job_id: id,
                p_idempotency_key: randomUUID(),
                p_terms_version: 1,
            });
        await checked(
            a.client
                .from("lecturer_topics")
                .delete()
                .eq("user_id", a.id)
                .eq("topic_id", topic),
            "Remove own declaration for negative eligibility case",
        );
        assert.equal(
            (await checked(attempt(), "Missing declared expertise cannot claim"))
                .status,
            "not_eligible",
        );
        await checked(
            a.client
                .from("lecturer_topics")
                .insert({user_id: a.id, topic_id: topic}),
            "Restore own declared expertise without verification",
        );
        if (day === 1) {
            await checked(
                admin.client.rpc("verify_lecturer_topic", {
                    ...verification,
                    p_valid_until: new Date(Date.now() + 30 * 86400000).toISOString(),
                }),
                "Attest qualification that expires before assignment",
            );
            // The attestation's expiry is recorded but does not remove the lecturer's declared expertise.
        }
        await checked(
            admin.client.rpc("verify_lecturer_topic", verification),
            "Attest qualification with actual current password-only authentication",
        );
        const ownExpertise = await checked(
            a.client
                .from("lecturer_topics")
                .select("verified,valid_until")
                .eq("user_id", a.id)
                .eq("topic_id", topic)
                .single(),
            "Read durable verified expertise",
        );
        assert.equal(ownExpertise.verified, true);
        assert.equal(
            Date.parse(ownExpertise.valid_until),
            Date.parse(verification.p_valid_until),
        );
        if (day === 2) {
            assert.equal(
                (
                    await a.client.rpc("set_contract_status", {
                        p_contract_id: contract,
                        p_status: "active",
                    })
                ).error?.code,
                "42501",
                "Contract owner cannot override management status",
            );
            await checked(
                admin.client.rpc("set_contract_status", {
                    p_contract_id: contract,
                    p_status: "expired",
                }),
                "password-only authentication manager expires actual executed contract",
            );
            assert.equal(
                (
                    await checked(
                        attempt(),
                        "New claims fail after current contract is expired",
                    )
                ).status,
                "prerequisite_missing",
            );
            const previous = await checked(
                a.client
                    .from("job_claims")
                    .select("contract_id,total_amount")
                    .eq("id", claims[0])
                    .single(),
                "Prior accepted agreement remains linked after contract expiry",
            );
            assert.equal(previous.contract_id, contract);
            assert.equal(Number(previous.total_amount), 100);
            await checked(
                admin.client.rpc("set_contract_status", {
                    p_contract_id: contract,
                    p_status: "active",
                }),
                "password-only authentication manager reactivates still-date-valid executed agreement",
            );
        }
        const result = await checked(
            attempt(),
            "Actual qualification and contract-required claim",
        );
        assert.equal(result.status, "confirmed");
        claims.push(result.claim_id);
        if (day === 1) {
            await checked(
                admin.client.rpc("verify_lecturer_topic", {
                    ...verification,
                    p_verified: false,
                }),
                "Manager clears optional attestation without removing declared expertise",
            );
            const revoked = await checked(
                a.client
                    .from("lecturer_topics")
                    .select("verified,valid_until")
                    .eq("user_id", a.id)
                    .eq("topic_id", topic)
                    .single(),
                "Read durable qualification revocation",
            );
            assert.equal(revoked.verified, false);
            assert.equal(revoked.valid_until, null);
        }
    }

    // Seed a separate historical accepted snapshot as fixture setup. The real
    // claims above remain future-dated for the pre-end denial assertion.
    const completedJob = randomUUID(),
        completedClaim = randomUUID(),
        completedSession = randomUUID(),
        completedAssignmentSession = randomUUID(),
        completedStart = new Date(Date.now() - 2 * 86400000).toISOString(),
        completedEnd = new Date(Date.now() - 86400000).toISOString();
    await checked(
        service.from("jobs").insert({
            id: completedJob,
            title: `Fictional completed invoice block ${suffix}`,
            customer_name: "Fictional billing customer",
            delivery_type: "online",
            status: "filled",
            amount: 300,
            total_amount: 300,
            currency: "EUR",
            rate_unit: "fixed_total",
            terms: "Immutable completed invoice fixture terms",
            created_by: admin.id,
        }),
        "Seed a fictional completed invoice job",
    );
    jobs.push(completedJob);
    await checked(
        service.from("job_sessions").insert({
            id: completedSession,
            job_id: completedJob,
            starts_at: completedStart,
            ends_at: completedEnd,
        }),
        "Seed its historical scheduled session",
    );
    await checked(
        service.from("job_claims").insert({
            id: completedClaim,
            job_id: completedJob,
            lecturer_id: a.id,
            idempotency_key: randomUUID(),
            status: "confirmed",
            amount: 300,
            currency: "EUR",
            rate_unit: "fixed_total",
            total_amount: 300,
            terms: "Immutable completed invoice fixture terms",
            terms_version: 1,
        }),
        "Seed the matching accepted claim snapshot",
    );
    await checked(
        service.from("assignment_sessions").insert({
            id: completedAssignmentSession,
            claim_id: completedClaim,
            lecturer_id: a.id,
            starts_at: completedStart,
            ends_at: completedEnd,
        }),
        "Seed the exact historical assigned session",
    );
    const invoiceBytes = pdf(
        "Fictional compensation statement - no tax calculation.",
    );
    const invoiceDoc = await upload(a, invoiceBytes, "invoice");
    const invoiceVersion = invoiceDoc.current_version_id;
    const issued = new Date().toISOString().slice(0, 10),
        due = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
        invoiceKey = randomUUID();
    const invoiceArgs = {
        p_number: `QA-${suffix}`,
        p_claim_ids: [completedClaim],
        p_document_version_id: invoiceVersion,
        p_issued_on: issued,
        p_due_on: due,
        p_client_id: invoiceKey,
    };
    const beforeFinalSession = await a.client.rpc("submit_invoice", {
        ...invoiceArgs,
        p_number: `QA-EARLY-${suffix}`,
        p_claim_ids: claims,
        p_client_id: randomUUID(),
    });
    assert.equal(beforeFinalSession.error?.code, "22023");
    assert.match(beforeFinalSession.error?.message ?? "", /invoice_not_ready/);
    const beforeFinalSession = await a.client.rpc("submit_invoice", invoiceArgs);
    assert.equal(beforeFinalSession.error?.code, "22023");
    assert.match(beforeFinalSession.error?.message ?? "", /invoice_not_ready/);
    // The isolated fixture advances its accepted schedule clock; it creates no
    // attendance or quiz evidence, which is intentionally not an invoice gate.
    const pastStart = new Date(Date.now() - 2 * 86400000).toISOString(),
        pastEnd = new Date(Date.now() - 86400000).toISOString();
    await checked(
        service
            .from("job_sessions")
            .update({starts_at: pastStart, ends_at: pastEnd})
            .in("job_id", jobs),
        "Advance fictional accepted final sessions beyond current time",
    );
    await checked(
        service
            .from("assignment_sessions")
            .update({starts_at: pastStart, ends_at: pastEnd})
            .in("claim_id", claims),
        "Advance exact isolated assignment-session snapshots beyond current time",
    );
    const invoice = await checked(
        a.client.rpc("submit_invoice", invoiceArgs),
        "Submit actual own compensation invoice",
    );
    assert.equal(
        await checked(
            a.client.rpc("submit_invoice", invoiceArgs),
            "Retry invoice submission",
        ),
        invoice,
    );
    let record = (
        await checked(a.client.rpc("invoice_records"), "Read own invoice")
    )[0];
    assert.equal(Number(record.total_amount), 300);
    assert.equal(record.currency, "EUR");
    assert.deepEqual(
        await checked(
            b.client.rpc("invoice_records"),
            "Other senior private invoices",
        ),
        [],
    );
    assert.ok((await b.client.rpc("finance_earnings", {p_all: true})).error);
    assert.equal((await download(b, invoiceDoc.id, invoiceVersion)).status, 403);
    await checked(
        admin.client.rpc("review_invoice", {
            p_invoice_id: invoice,
            p_status: "approved",
            p_note: "Fictional local QA review",
        }),
        "Approve with real password-only authentication",
    );
    const paidAt = new Date(Date.now() - 1000).toISOString(),
        paymentKey = randomUUID();
    const paymentArgs = {
        p_invoice_id: invoice,
        p_amount: 100,
        p_paid_at: paidAt,
        p_reference: "Fictional payment tracking reference",
        p_client_id: paymentKey,
    };
    const firstPayment = await checked(
        admin.client.rpc("record_invoice_payment", paymentArgs),
        "Record partial tracking payment",
    );
    assert.equal(
        await checked(
            admin.client.rpc("record_invoice_payment", paymentArgs),
            "Retry tracking payment",
        ),
        firstPayment,
    );
    assert.ok(
        (
            await admin.client.rpc("record_invoice_payment", {
                ...paymentArgs,
                p_amount: 201,
                p_client_id: randomUUID(),
            })
        ).error,
    );
    await checked(
        admin.client.rpc("record_invoice_payment", {
            ...paymentArgs,
            p_amount: 200,
            p_client_id: randomUUID(),
        }),
        "Record final tracking payment",
    );
    record = (
        await checked(a.client.rpc("invoice_records"), "Read paid invoice")
    )[0];
    assert.equal(record.status, "paid");
    assert.equal(Number(record.paid_amount), 300);
    const statement = await checked(
        a.client.rpc("finance_earnings"),
        "Own statement stages after a session-complete invoice",
    );
    assert.equal(
        statement.find((row) => row.claim_id === completedClaim).stage,
        "paid",
    );
    assert.ok(
        statement
            .filter((row) => claims.includes(row.claim_id))
            .every((row) => row.stage === "expected"),
    );
    await checked(
        admin.client.rpc("void_invoice_payment", {
            p_payment_id: firstPayment,
            p_reason: "Corrected fictional tracking entry",
        }),
        "Audited correction retains original payment record",
    );
    record = (
        await checked(a.client.rpc("invoice_records"), "Read corrected invoice")
    )[0];
    assert.equal(record.status, "approved");
    assert.equal(Number(record.paid_amount), 200);
    assert.equal(
        (
            await checked(
                a.client.rpc("invoice_payments", {p_invoice_id: invoice}),
                "Audited payment history",
            )
        ).filter((p) => p.voided_at).length,
        1,
    );
    const replacement = pdf(
        "Future replacement must not modify accepted contract evidence.",
    );
    await upload(a, replacement, "contract", a.id, contractDoc.id);
    const oldDownload = await download(a, contractDoc.id, version.id);
    assert.equal(oldDownload.status, 200);
    assert.deepEqual(new Uint8Array(await oldDownload.arrayBuffer()), original);
    assert.equal(
        (
            await checked(
                a.client.rpc("contract_records"),
                "Exact original contract version",
            )
        )[0].document_version_id,
        version.id,
    );
    assert.ok(
        (
            await a.client.rpc("rename_document", {
                p_id: contractDoc.id,
                p_name: "Hide contract.pdf",
                p_delete: true,
            })
        ).error,
        "Linked executed evidence cannot be hidden by ordinary file deletion",
    );
    console.log(
        "PASS: actual Auth, real password-only authentication, Storage/ClamAV-scanned PDF versions: externally executed contract registration, exact-hash receipt-not-signature, names-only commercial directory/password-only authentication isolation, optional qualification provenance, self-declared topic and contract status-gated claims, original-fee invoice derivation/idempotency/privacy, password-only authentication partial/full payment+audited correction and immutable old-version download after replacement.",
    );
} finally {
    for (const client of clients) await client.removeAllChannels();
    if (users.length) {
        const invoices = await checked(
            service.from("invoices").select("id").in("user_id", users),
            "Select only temporary invoices",
        );
        const invoiceIds = invoices.map((i) => i.id);
        if (invoiceIds.length) {
            await checked(
                service.from("payment_records").delete().in("invoice_id", invoiceIds),
                "Clean temporary tracking payments",
            );
            await checked(
                service.from("invoice_items").delete().in("invoice_id", invoiceIds),
                "Clean temporary invoice items",
            );
            await checked(
                service.from("invoices").delete().in("id", invoiceIds),
                "Clean temporary invoices",
            );
        }
        const rooms = jobs.length
            ? await checked(
                service.from("chat_rooms").select("id").in("job_id", jobs),
                "Select temporary course rooms",
            )
            : [];
        for (const room of rooms)
            await checked(
                service.from("chat_members").delete().eq("room_id", room.id),
                "Clean temporary course membership",
            );
        if (rooms.length)
            await checked(
                service
                    .from("chat_rooms")
                    .delete()
                    .in(
                        "id",
                        rooms.map((r) => r.id),
                    ),
                "Clean temporary course rooms",
            );
        await checked(
            service.from("notifications").delete().in("user_id", users),
            "Clean temporary notifications",
        );
        const claims = jobs.length
            ? await checked(
                service.from("job_claims").select("id").in("job_id", jobs),
                "Select temporary accepted claims",
            )
            : [];
        if (claims.length) {
            const ids = claims.map((c) => c.id);
            await checked(
                service.from("claim_events").delete().in("claim_id", ids),
                "Clean temporary claim events",
            );
            await checked(
                service.from("assignment_sessions").delete().in("claim_id", ids),
                "Clean temporary calendar allocations",
            );
            await checked(
                service.from("job_claims").delete().in("id", ids),
                "Clean temporary claims",
            );
        }
        const jobRows = jobs.length
            ? await checked(
                service.from("jobs").select("course_run_id").in("id", jobs),
                "Select temporary course links",
            )
            : [];
        if (jobs.length)
            await checked(
                service.from("jobs").delete().in("id", jobs),
                "Clean temporary job offers",
            );
        const runIds = jobRows.map((j) => j.course_run_id).filter(Boolean);
        if (runIds.length) {
            const runs = await checked(
                service
                    .from("course_runs")
                    .select("id,template_id,organisation_id")
                    .in("id", runIds),
                "Select temporary course records",
            );
            await checked(
                service.from("course_sessions").delete().in("course_run_id", runIds),
                "Clean temporary course sessions",
            );
            await checked(
                service.from("course_runs").delete().in("id", runIds),
                "Clean temporary runs",
            );
            await checked(
                service
                    .from("course_templates")
                    .delete()
                    .in(
                        "id",
                        runs.map((r) => r.template_id),
                    ),
                "Clean temporary templates",
            );
            await checked(
                service
                    .from("organisations")
                    .delete()
                    .in(
                        "id",
                        runs.map((r) => r.organisation_id),
                    ),
                "Clean temporary organisations",
            );
        }
        await checked(
            service.from("contract_acceptances").delete().in("user_id", users),
            "Clean temporary receipt acknowledgements",
        );
        await checked(
            service.from("contracts").delete().in("user_id", users),
            "Clean temporary executed metadata",
        );
        const docs = await checked(
            service.from("documents").select("id").in("owner_id", users),
            "Select temporary private PDFs",
        );
        if (docs.length) {
            const ids = docs.map((d) => d.id),
                versions = await checked(
                    service
                        .from("document_versions")
                        .select("object_path")
                        .in("document_id", ids),
                    "Select temporary storage paths",
                );
            const paths = versions.map((v) => v.object_path);
            await service.storage.from("portal-clean").remove(paths);
            await service.storage.from("portal-quarantine").remove(paths);
            await checked(
                service
                    .from("documents")
                    .update({current_version_id: null})
                    .in("id", ids),
                "Release temporary version pointers",
            );
            await checked(
                service.from("document_versions").delete().in("document_id", ids),
                "Clean temporary file versions",
            );
            await checked(
                service.from("documents").delete().in("id", ids),
                "Clean temporary file metadata",
            );
        }
        await checked(
            service.from("audit_events").delete().in("actor_id", users),
            "Clean temporary audited actions",
        );
        for (const id of users)
            await checked(
                service.auth.admin.deleteUser(id),
                "Remove temporary commercial account",
            );
    }
}