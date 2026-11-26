/** Exercise company PDFs through real Auth, quarantine, scanner and private Storage. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {testActorHeaders, withApiFixture} from "./testing/api.mjs";
import {accountingTestPdf} from "./testing/accounting-pdf.mjs";
import {quoteSql as q} from "./testing/database.mjs";

await withApiFixture(async ({actor, checked, defer, recoveryEndpoints, service, sql, url}) => {
    const manager = await actor("company-contract-manager", "management");
    const admin = await actor("company-contract-admin", "admin");
    const client = await actor("company-contract-client", "client");
    const outsider = await actor("company-contract-other-client", "client");
    const company = randomUUID(), otherCompany = randomUUID();
    defer(async () => {
        const objects = JSON.parse(await sql(`select coalesce(jsonb_agg(v.object_path),'[]')
          from private.organisation_contract_files f join public.document_versions v on v.id=f.version_id
          where f.organisation_id in (${q(company)},${q(otherCompany)})`));
        if (objects.length) {
            for (const bucket of ["portal-clean", "portal-quarantine"]) {
                await checked(service.storage.from(bucket).remove(objects));
            }
        }
        // Only after assertions, remove this disposable company's fictional rows.
        // Restore retention in the same transaction before any other fixture runs.
        await sql(`begin;
          alter table private.organisation_contract_files disable trigger retained_organisation_contract_binding;
          alter table public.documents disable trigger retained_organisation_contract_document;
          alter table public.document_versions disable trigger retained_organisation_contract_version;
          create temporary table company_contract_fixture_documents on commit drop as
            select document_id from private.organisation_contract_files where organisation_id in (${q(company)},${q(otherCompany)});
          update public.documents set current_version_id=null from company_contract_fixture_documents f where documents.id=f.document_id;
          delete from public.document_versions using company_contract_fixture_documents f where document_versions.document_id=f.document_id;
          delete from public.documents using company_contract_fixture_documents f where documents.id=f.document_id;
          set constraints all immediate;
          alter table private.organisation_contract_files enable trigger retained_organisation_contract_binding;
          alter table public.documents enable trigger retained_organisation_contract_document;
          alter table public.document_versions enable trigger retained_organisation_contract_version;
          delete from public.client_organisation_memberships where organisation_id in (${q(company)},${q(otherCompany)});
          delete from public.organisations where id in (${q(company)},${q(otherCompany)});
          commit;`);
    });
    await sql(`insert into public.organisations(id,name) values
        (${q(company)},'Fictional contracts company'),(${q(otherCompany)},'Fictional other contracts company');
      insert into public.client_organisation_memberships(user_id,organisation_id) values
        (${q(client.id)},${q(company)}),(${q(outsider.id)},${q(otherCompany)});`);
    const bytes = accountingTestPdf("Fictional executed company agreement");
    const name = "Fictional company agreement.pdf";
    const requestId = randomUUID();
    const send = async (who, body) => fetch(`${url}/functions/v1/files`, {
        method: "POST",
        headers: {
            ...await testActorHeaders(who, recoveryEndpoints.appOrigin),
            ...(typeof body === "string" ? {"Content-Type": "application/json"} : {}),
        },
        body,
        signal: AbortSignal.timeout(90000),
    });
    const upload = (who, organisationId = company) => {
        const form = new FormData();
        form.set("file", new File([bytes], name, {type: "application/pdf"}));
        form.set("client_id", requestId);
        form.set("kind", "organisation_contract");
        form.set("contract_organisation_id", organisationId);
        return send(who, form);
    };
    const list = (who) => who.client.rpc("organisation_contracts", {p_organisation_id: company});
    assert.deepEqual(await checked(list(manager)), {items: [], has_more: false});
    const memberUpload = await upload(client);
    assert.equal(memberUpload.status, 200, "An active company member can upload its own company PDF");
    const memberDocument = (await memberUpload.json()).document;
    assert.equal(memberDocument.status, "clean");
    assert.equal((await upload(client, otherCompany)).status, 403, "A member cannot upload into another tenant");
    assert.equal((await upload(outsider, otherCompany)).status, 200, "A different member can upload to its own company");
    assert.equal((await outsider.client.rpc("organisation_contracts", {p_organisation_id: company})).error?.code, "42501");
    const filed = await upload(manager);
    assert.equal(filed.status, 200, "Authorised company PDF passed the scanner");
    const {document} = await filed.json();
    assert.equal(document.status, "clean");
    const replay = await upload(manager);
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).document.id, document.id);
    const page = await checked(list(admin));
    assert.deepEqual(new Set(page.items.map(({id}) => id)), new Set([document.id, memberDocument.id]));
    assert.deepEqual((await checked(list(client))).items.map(({id}) => id), [memberDocument.id]);
    const selection = JSON.stringify({action: "organisation_contract_download", organisation_id: company, id: document.id});
    const download = await send(admin, selection);
    assert.equal(download.status, 200);
    assert.equal(download.headers.get("Content-Type"), "application/pdf");
    assert.match(download.headers.get("Cache-Control") ?? "", /\bno-store\b/);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
    assert.equal((await send(client, selection)).status, 403, "Staff-filed PDFs stay internal");
    const memberSelection = JSON.stringify({action: "organisation_contract_download", organisation_id: company, id: memberDocument.id});
    const memberDownload = await send(client, memberSelection);
    assert.equal(memberDownload.status, 200);
    assert.deepEqual(Buffer.from(await memberDownload.arrayBuffer()), bytes);
    assert.equal((await send(outsider, memberSelection)).status, 403);
    await checked(service.from("client_organisation_memberships")
        .update({removed_at: new Date().toISOString()})
        .eq("organisation_id", company).eq("user_id", client.id).is("removed_at", null)
        .select("user_id").single());
    assert.equal((await list(client)).error?.code, "42501", "Membership revocation blocks the contract list");
    assert.equal((await send(client, memberSelection)).status, 403, "Membership revocation blocks existing downloads");
    assert.equal((await upload(client)).status, 403, "Membership revocation blocks later uploads");
    assert.equal((await list(manager)).data.items.length, 2, "Internal permissioned staff retain access");
    console.log("PASS company member PDF upload, tenant separation, scanning, retry, listing, download and immediate membership revocation");
});