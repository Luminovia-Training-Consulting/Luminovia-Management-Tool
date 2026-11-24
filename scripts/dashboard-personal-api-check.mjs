/** Real Auth/REST personal dashboard, checklist and account boundaries. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {withApiFixture} from "./testing/api.mjs";
import {quoteSql as q} from "./testing/database.mjs";

await withApiFixture(async ({actor, checked, sql, defer, service}) => {
    const owner = await actor("dashboard-personal-owner", "lecturer"),
        peer = await actor("dashboard-personal-peer", "lecturer"),
        admin = await actor("dashboard-personal-admin", "admin");
    const job = randomUUID(),
        claim = randomUUID(),
        session = randomUUID(),
        org = randomUUID(),
        contact = randomUUID(),
        template = randomUUID(),
        run = randomUUID(),
        doc = randomUUID(),
        version = randomUUID(),
        resource = randomUUID();
    defer(async () => {
        await sql(`delete
                   from private.teaching_preparation
                   where claim_id = ${q(claim)};
      delete from public.notifications where user_id in(${q(owner.id)},${q(peer.id)},${q(admin.id)});
      delete from public.assignment_sessions where claim_id=${q(claim)};
      delete from public.job_claims where id=${q(claim)};
      delete from public.jobs where id=${q(job)};
      delete from private.course_resources where run_id=${q(run)};
      delete from public.course_runs where id=${q(run)};
      delete from public.course_templates where id=${q(template)};
      delete from public.organisation_contacts where organisation_id=${q(org)};
      delete from private.company_premium_audit where organisation_id=${q(org)};
      delete from public.organisations where id=${q(org)};
      update public.documents set current_version_id=null where id=${q(doc)};
      delete from public.document_versions where document_id=${q(doc)};
      delete from public.documents where id=${q(doc)};`);
    });
    const contractDoc = randomUUID(), contractVersion = randomUUID();
    const receiptLabel = `Fictional dashboard receipt ${contractDoc}`;
    const topicLabel = `Fictional dashboard expertise ${contractDoc}`;
    const checksum = "b".repeat(64);
    const pendingIds = Array.from({length: 4}, () => randomUUID());
    defer(async () => {
        await sql(`
          delete from public.contract_acceptances where user_id = ${q(owner.id)};
          delete from public.contracts where user_id in (${q(owner.id)}, ${q(peer.id)});
          delete from public.document_versions where id = ${q(contractVersion)};
          delete from public.documents where id = ${q(contractDoc)};
          delete from public.lecturer_topics where user_id = ${q(owner.id)};
          delete from public.topics where label_de like ${q(topicLabel + "%")};
        `);
    });
    const contractTable = "public.contracts(id,user_id,status,effective_from,expires_at,version,title,document_version_id,document_sha256,created_at)";
    await sql(`
        insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id)
        values(${q(contractDoc)},${q(owner.id)},${q(owner.id)},'personal','contract','Fictional agreement.pdf','application/pdf',10,'clean',${q(randomUUID())});
        insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,status,sha256)
        values(${q(contractVersion)},${q(contractDoc)},${q(owner.id)},${q(randomUUID())},1,${q("fictional/" + contractVersion)},'Fictional agreement.pdf','application/pdf',10,'clean',${q(checksum)});
        insert into ${contractTable}
        select gen_random_uuid(),${q(owner.id)},'expired',now()-interval '10 days',now()-interval '1 day',
          n+10,${q(receiptLabel)} || ' expired',${q(contractVersion)},${q(checksum)},now()
        from generate_series(1,1001) n;
        insert into ${contractTable} values
          ${pendingIds.map((id, index) => `(${q(id)},${q(owner.id)},'active',now()-interval '10 days',null,
            ${index + 1},${q(receiptLabel + " " + (index + 1))},${q(contractVersion)},${q(checksum)},now()-interval '1 day')`).join(",")},
          (gen_random_uuid(),${q(owner.id)},'active',now()+interval '1 day',null,5,${q(receiptLabel + " future")},${q(contractVersion)},${q(checksum)},now()),
          (gen_random_uuid(),${q(owner.id)},'active',now()-interval '10 days',now()-interval '1 day',6,${q(receiptLabel + " elapsed")},${q(contractVersion)},${q(checksum)},now()),
          (gen_random_uuid(),${q(owner.id)},'active',now()-interval '10 days',null,7,${q(receiptLabel + " legacy")},null,null,now());
        with topics as (
          insert into public.topics(label_de,label_en,kind)
          select ${q(topicLabel)} || ' ' || n,${q(topicLabel)} || ' ' || n,'topic' from generate_series(1,1057) n
          returning id
        )
        insert into public.lecturer_topics(user_id,topic_id)
        select ${q(owner.id)},id from topics;
    `);
    const oldContracts = await checked(owner.client.rpc("contract_records", {p_all: false}));
    assert.equal(oldContracts.length, 1000, "Unfiltered history reaches the REST cap");
    assert.ok(oldContracts.every((row) => !pendingIds.includes(row.id)),
        "The old client would miss every pending contract");
    const before = new Date().toISOString();
    const preview = (viewer, ownerId = viewer.id) =>
        viewer.client.from("contracts")
            .select("id,title,expires_at,contract_acceptances()")
            .eq("user_id", ownerId)
            .eq("status", "active")
            .not("document_version_id", "is", null)
            .not("document_sha256", "is", null)
            .lte("effective_from", before)
            .or(`expires_at.is.null,expires_at.gt.${before}`)
            .eq("contract_acceptances.user_id", ownerId)
            .is("contract_acceptances", null)
            .order("created_at", {ascending: false})
            .order("version", {ascending: false})
            .order("id", {ascending: false})
            .limit(3);
    const pending = await checked(preview(owner), "Read bounded private dashboard receipts");
    assert.deepEqual(pending.map((row) => row.id), [pendingIds[3], pendingIds[2], pendingIds[1]]);
    assert.ok(pending.every((row) => Object.keys(row).sort().join(",") === "expires_at,id,title"));
    assert.deepEqual(await checked(preview(peer, owner.id)), []);
    await checked(owner.client.rpc("acknowledge_contract", {
        p_contract_id: pendingIds[3],
        p_sha256: checksum,
        p_client_id: randomUUID(),
    }));
    assert.deepEqual((await checked(preview(owner))).map((row) => row.id), [pendingIds[2], pendingIds[1], pendingIds[0]]);
    const oldExpertise = await checked(owner.client.from("lecturer_topics").select("*").eq("user_id", owner.id));
    assert.equal(oldExpertise.length, 1000);
    const count = await owner.client.from("lecturer_topics")
        .select("topic_id", {count: "exact", head: true}).eq("user_id", owner.id);
    assert.equal(count.error, null);
    assert.equal(count.count, 1057);
    assert.equal(count.data, null);
    console.log(`PASS: dashboard contract filters precede the REST limit (1000 rows / ${Buffer.byteLength(JSON.stringify(oldContracts))} bytes to ${pending.length} rows / ${Buffer.byteLength(JSON.stringify(pending))} bytes); exact headline expertise count (1057) transfers no row body.`);
    const defaultLayout = await checked(
        owner.client.rpc("dashboard_preferences"),
    );
    assert.equal(defaultLayout.version, 0);
    const payload = {
        widget_order: [...defaultLayout.widget_order].reverse(),
        hidden_widgets: ["files"],
    };
    const results = await Promise.all(
        [1, 2].map(() =>
            owner.client.rpc("save_dashboard_preferences", {
                p_payload: payload,
                p_expected_version: 0,
            }),
        ),
    );
    assert.equal(results.filter((r) => !r.error).length, 1);
    assert.equal(results.find((r) => r.error).error.code, "PT409");
    assert.deepEqual(await checked(owner.client.rpc("dashboard_preferences")), {
        ...payload,
        version: 1,
    });
    for (const who of [peer, admin])
        assert.deepEqual(
            (await checked(who.client.rpc("dashboard_preferences"))).hidden_widgets,
            [],
        );
    const forged = await owner.client.rpc("save_dashboard_preferences", {
        p_payload: {...payload, user_id: peer.id},
        p_expected_version: 1,
    });
    assert.equal(forged.error?.code, "22023");
    const day =
        "((now() at time zone 'Europe/Berlin')::date::timestamp at time zone 'Europe/Berlin')";
    // Set immutable course provenance on the initial offer, before its claim.
    await sql(
        `insert into public.organisations(id,name)values(${q(org)},'Fictional daily course organisation');insert into public.organisation_contacts(id,organisation_id,name,email,phone,notes)values(${q(contact)},${q(org)},'Explicit daily contact','daily@example.invalid','+49 40 123','Private note must remain hidden');insert into public.course_templates(id,title)values(${q(template)},'Fictional daily course');insert into public.course_runs(id,template_id,organisation_id)values(${q(run)},${q(template)},${q(org)});`,
    );
    await sql(`insert into public.jobs(id,course_run_id,title,customer_name,delivery_type,status,location,amount,currency,rate_unit,total_amount,terms) values(${q(job)},${q(run)},'Fictional API teaching day','Fictional API academy','online','filled','https://example.invalid/class',100,'EUR','fixed_total',100,'Fictional API terms');
    insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,amount,currency,rate_unit,total_amount,terms,terms_version) values(${q(claim)},${q(job)},${q(owner.id)},${q(randomUUID())},100,'EUR','fixed_total',100,'Fictional API terms',1);
    insert into public.assignment_sessions(id,claim_id,lecturer_id,starts_at,ends_at) values(${q(session)},${q(claim)},${q(owner.id)},${day}+interval '9 hours',${day}+interval '10 hours');`);
    // Projection fixtures carry reviewed-version metadata only; the separate course
    // gateway suite owns actual quarantine/scanner/exact-byte download acceptance.
    await sql(
        `insert into private.course_workspace_settings(run_id,contact_id)values(${q(run)},${q(contact)});insert into private.course_preparation_items(run_id,label,done)values(${q(run)},'Shared checklist complete',true),(${q(run)},'Shared checklist pending',false);insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id)values(${q(doc)},${q(peer.id)},${q(peer.id)},'personal','material','Agreed V1.pdf','application/pdf',10,'clean',${q(randomUUID())});insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,status,sha256)values(${q(version)},${q(doc)},${q(peer.id)},${q(randomUUID())},1,${q("fictional/" + version)},'Agreed V1.pdf','application/pdf',10,'clean',${q("a".repeat(64))});update public.documents set current_version_id=${q(version)} where id=${q(doc)};insert into private.course_resources(id,run_id,version_id,audience,category,created_by)values(${q(resource)},${q(run)},${q(version)},'staff','material',${q(peer.id)});`,
    );
    const withoutPremium = await checked(owner.client.rpc("teaching_day"));
    assert.equal(withoutPremium.sessions.length, 1);
    assert.equal(withoutPremium.sessions[0].id, session);
    assert.deepEqual(withoutPremium.sessions[0].course_resources, []);
    await checked(admin.client.rpc("set_company_premium", {
        p_organisation_id: org,
        p_enabled: true,
        p_expected_version: 0,
        p_request_id: randomUUID(),
    }), "Enable materials for the exact fictional company");
    const today = await checked(owner.client.rpc("teaching_day"));
    assert.equal(today.sessions.length, 1);
    assert.equal(today.sessions[0].course_run_id, run);
    assert.deepEqual(today.sessions[0].course_contact, {
        name: "Explicit daily contact",
        email: "daily@example.invalid",
        phone: "+49 40 123",
    });
    assert.deepEqual(today.sessions[0].shared_preparation, {done: 1, total: 2});
    assert.equal(today.sessions[0].course_resources[0].version_id, version);
    assert.ok(!JSON.stringify(today).includes("Private note"));
    assert.ok(
        !JSON.stringify(today.sessions[0].course_resources).includes("object_path"),
    );
    assert.equal(today.sessions[0].id, session);
    assert.equal(today.sessions[0].title, "Fictional API teaching day");
    for (const who of [peer, admin])
        assert.equal(
            (await checked(who.client.rpc("teaching_day"))).sessions.length,
            0,
        );
    const args = {
        p_claim_id: claim,
        p_item: "materials_ready",
        p_done: true,
        p_expected_version: 0,
    };
    const readiness = await checked(
        owner.client.rpc("save_teaching_preparation", args),
    );
    assert.equal(readiness.materials_ready, true);
    assert.equal(readiness.version, 1);
    for (const who of [peer, admin])
        assert.equal(
            (await who.client.rpc("save_teaching_preparation", args)).error?.code,
            "42501",
        );
    assert.equal(
        (await owner.client.rpc("save_teaching_preparation", args)).error?.code,
        "40001",
    );
    await checked(
        service
            .from("profiles")
            .update({time_zone: "Australia/Brisbane"})
            .eq("id", owner.id),
    );
    assert.equal(
        (await checked(owner.client.rpc("teaching_day"))).time_zone,
        "Australia/Brisbane",
    );
    await sql(
        `update public.assignment_sessions set released_at=now() where id=${q(session)};update public.job_claims set status='cancelled' where id=${q(claim)};`,
    );
    assert.equal(
        (await checked(owner.client.rpc("teaching_day"))).sessions.length,
        0,
    );
    assert.equal(
        (
            await owner.client.rpc("save_teaching_preparation", {
                ...args,
                p_expected_version: 1,
            })
        ).error?.code,
        "42501",
    );
    await checked(
        service.from("profiles").update({active: false}).eq("id", owner.id),
    );
    assert.equal(
        (await owner.client.rpc("dashboard_preferences")).error?.code,
        "42501",
    );
    assert.equal((await owner.client.rpc("teaching_day")).error?.code, "42501");
    assert.equal((await preview(owner)).error?.code, "42501");
    console.log(
        "PASS: actual Auth/REST private dashboard saved order, concurrent CAS, forged identity denial, own teaching day/readiness, peer/admin isolation, current profile zone, cancellation and inactive-token denial.",
    );
});
