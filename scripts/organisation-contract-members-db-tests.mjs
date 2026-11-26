/** Verify that company contract RPCs grant only the active member's own organisation. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

assert.equal(process.env.PORTAL_TEST_MODE, "1", "An owned portal test run is required.");
assert.match(
  process.env.PORTAL_DB_CONTAINER ?? "",
  /^supabase_db_luminovia-portal-test-(?:[a-f0-9]{8}|[a-f0-9]{32})$/,
  "Use the canonical runtime or PR SQL test container.",
);

const sqlState = (code) => new RegExp(`ERROR:\\s+${code}:`);
const ids = (count) => Array.from({ length: count }, randomUUID);

await withTestDatabase("org_contract_members", async ({ sql, actor }) => {
  const [company, otherCompany] = ids(2);
  const [member, otherMember, manager, companyOnly, contractOnly, colleague] = ids(6);
  const actors = [
    [member, "client"],
    [otherMember, "client"],
    [colleague, "client"],
    [manager, "management"],
    [companyOnly, "lecturer"],
    [contractOnly, "senior_lecturer"],
  ];
  await sql(`
    insert into auth.users(id,email,email_confirmed_at) values
      ${actors.map(([who]) => `(${q(who)},${q(`${who}@example.invalid`)},now())`).join(",")};
    insert into public.user_roles(user_id,role) values
      ${actors.map(([who, role]) => `(${q(who)},${q(role)})`).join(",")};
    insert into public.organisations(id,name) values
      (${q(company)},'Fictional Member Company'),(${q(otherCompany)},'Fictional Other Company');
    insert into public.client_organisation_memberships(user_id,organisation_id) values
      (${q(member)},${q(company)}),(${q(colleague)},${q(company)}),(${q(otherMember)},${q(otherCompany)});
    insert into public.role_permissions(role,permission) values
      ('management','organisations.manage'),('management','contracts.manage'),
      ('lecturer','organisations.manage'),('senior_lecturer','contracts.manage')
      on conflict do nothing;
  `);

  const read = (who, call) => actor(who, `select ${call}`).then((value) => JSON.parse(value || "null"));
  const reserve = (who, org = company, clientId = randomUUID()) =>
    read(who, `public.reserve_organisation_contract(${q(org)},'Fictional agreement.pdf',120,${q(clientId)},${q("a".repeat(64))})`);
  const status = (org, doc, version) =>
    `public.organisation_contract_upload_status(${q(org)},${q(doc)},${q(version)})`;
  const listing = (org) => `public.organisation_contracts(${q(org)})`;
  const download = (org, doc) => `public.organisation_contract_download(${q(org)},${q(doc)})`;
  const service = (statement) => sql(`begin; set local role service_role; ${statement}; commit;`);
  const beginScan = async (doc, version) => {
    const lease = await service(`select public.deletion_upload_begin(${q(doc)},${q(version)})`);
    await service(`update public.document_versions set status='scanning' where id=${q(version)};
      update public.documents set status='scanning' where id=${q(doc)}`);
    return lease;
  };
  const finishScan = (doc, version, lease) => service(
    `select public.complete_document_upload(${q(doc)},${q(version)},${q(lease)},${q("a".repeat(64))},'ClamAV Fictional Test')`,
  );

  const pending = await reserve(member);
  const pendingIds = { document: pending.document_id, version: pending.version_id };
  assert.equal((await read(member, status(company, pendingIds.document, pendingIds.version))).document.id, pendingIds.document);
  assert.deepEqual(await read(member, listing(company)), { items: [], has_more: false });
  assert.deepEqual(await read(otherMember, listing(otherCompany)), { items: [], has_more: false });
  for (const call of [
    status(company, pendingIds.document, pendingIds.version),
    listing(company),
    download(company, pendingIds.document),
  ]) {
    await assert.rejects(read(otherMember, call), sqlState("42501"));
  }
  await assert.rejects(reserve(member, otherCompany), sqlState("42501"));
  for (const who of [companyOnly, contractOnly])
    await assert.rejects(reserve(who), sqlState("42501"));

  const lease = await beginScan(pendingIds.document, pendingIds.version);
  await finishScan(pendingIds.document, pendingIds.version, lease);
  const internal = await reserve(manager);
  const internalLease = await beginScan(internal.document_id, internal.version_id);
  await finishScan(internal.document_id, internal.version_id, internalLease);
  const ready = await read(member, listing(company));
  assert.equal(ready.items.length, 1);
  assert.equal(ready.items[0].id, pendingIds.document);
  assert.deepEqual(await read(colleague, listing(company)), ready);
  assert.equal((await read(colleague, download(company, pendingIds.document))).document_id, pendingIds.document);
  assert.equal(await read(colleague, status(company, pendingIds.document, pendingIds.version)), null);
  assert.equal(await read(member, download(company, internal.document_id)), null);
  assert.equal(await read(member, status(company, internal.document_id, internal.version_id)), null);
  assert.equal(await read(otherMember, download(otherCompany, pendingIds.document)), null);
  assert.equal((await read(manager, listing(company))).items.length, 2);
  assert.equal((await read(manager, download(company, pendingIds.document))).document_id, pendingIds.document);
  assert.equal(await actor(member, `select count(*) from public.documents where id=${q(pendingIds.document)}`), "0");
  assert.equal(await actor(member, `select private.can_access_document(${q(pendingIds.document)})`), "f");
  await assert.rejects(
    actor(member, `select public.rename_document(${q(pendingIds.document)},'Changed.pdf',true)`),
    sqlState("42501"),
  );

  const awaitingRevocation = await reserve(member, company, randomUUID());
  const revocationLease = await beginScan(awaitingRevocation.document_id, awaitingRevocation.version_id);
  await sql(`update public.client_organisation_memberships set removed_at=now()
    where user_id=${q(member)} and organisation_id=${q(company)} and removed_at is null`);
  for (const call of [
    status(company, pendingIds.document, pendingIds.version),
    listing(company),
    download(company, pendingIds.document),
  ]) {
    await assert.rejects(read(member, call), sqlState("42501"));
  }
  await assert.rejects(reserve(member, company, randomUUID()), sqlState("42501"));
  await assert.rejects(finishScan(awaitingRevocation.document_id, awaitingRevocation.version_id, revocationLease), sqlState("42501"));
  assert.equal((await read(manager, download(company, pendingIds.document))).document_id, pendingIds.document);

  console.log("PASS active company membership gates upload, scan promotion, list, status and download; foreign tenants and generic file mutation stay denied.");
});