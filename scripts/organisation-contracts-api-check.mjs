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
    const company = randomUUID();
    defer(async () => {
        const objects = JSON.parse(await sql(`select coalesce(jsonb_agg(v.object_path),'[]')
          from private.organisation_contract_files f join public.document_versions v on v.id=f.version_id
          where f.organisation_id=${q(company)}`));
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
            select document_id from private.organisation_contract_files where organisation_id=${q(company)};
          update public.documents set current_version_id=null from company_contract_fixture_documents f where documents.id=f.document_id;
          delete from public.document_versions using company_contract_fixture_documents f where document_versions.document_id=f.document_id;
          delete from public.documents using company_contract_fixture_documents f where documents.id=f.document_id;
          set constraints all immediate;
          alter table private.organisation_contract_files enable trigger retained_organisation_contract_binding;
          alter table public.documents enable trigger retained_organisation_contract_document;
          alter table public.document_versions enable trigger retained_organisation_contract_version;
          delete from public.client_organisation_memberships where organisation_id=${q(company)};
          delete from public.organisations where id=${q(company)};
          commit;`);
    });
    await sql(`insert into public.organisations(id,name) values(${q(company)},'Fictional contracts company');
      insert into public.client_organisation_memberships(user_id,organisation_id) values(${q(client.id)},${q(company)});`);
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
    const upload = (who) => {
        const form = new FormData();
        form.set("file", new File([bytes], name, {type: "application/pdf"}));
        form.set("client_id", requestId);
        form.set("kind", "organisation_contract");
        form.set("contract_organisation_id", company);
        return send(who, form);
    };
    const list = (who) => who.client.rpc("organisation_contracts", {p_organisation_id: company});
    assert.deepEqual(await checked(list(manager)), {items: [], has_more: false});
    assert.equal((await upload(client)).status, 403);
    const filed = await upload(manager);
    assert.equal(filed.status, 200, "Authorised company PDF passed the scanner");
    const {document} = await filed.json();
    assert.equal(document.status, "clean");
    const replay = await upload(manager);
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).document.id, document.id);
    const page = await checked(list(admin));
    assert.deepEqual(page.items.map(({id, file_name}) => ({id, file_name})), [{id: document.id, file_name: name}]);
    assert.equal((await list(client)).error?.code, "42501");
    const selection = JSON.stringify({action: "organisation_contract_download", organisation_id: company, id: document.id});
    const download = await send(admin, selection);
    assert.equal(download.status, 200);
    assert.equal(download.headers.get("Content-Type"), "application/pdf");
    assert.match(download.headers.get("Cache-Control") ?? "", /\bno-store\b/);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
    assert.equal((await send(client, selection)).status, 403);
    console.log("PASS private company PDF upload, scanning, retry, listing and authorised download");
});