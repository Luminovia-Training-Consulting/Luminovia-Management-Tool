/** Upgrade the actual predecessor schema and exercise company PDF access, scan
 * completion and reviewed retention in a disposable database in the CI cluster.
 * The test harness emulates JWT claims; it does not exercise Edge or Storage. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {quoteSql as q, withTestDatabase} from './testing/database.mjs';

const migration = new URL('../supabase/migrations/20261125150001_private_organisation_contracts.sql', import.meta.url);
const predecessor = '20261125150000';
const id = () => q(randomUUID());
const json = (value) => value === '' ? null : JSON.parse(value);
const sqlState = (code) => new RegExp(`ERROR:\\s+${code}:`);

// The runtime runner uses an 8-digit hex project ID and PR SQL uses 32.
// Refuse the shared development cluster instead of using the helper's default.
assert.equal(process.env.PORTAL_TEST_MODE, '1', 'An owned portal test run is required.');
assert.match(process.env.PORTAL_DB_CONTAINER ?? '', /^supabase_db_luminovia-portal-test-(?:[a-f0-9]{8}|[a-f0-9]{32})$/,
    'Use the canonical runtime or PR SQL test container.');

await withTestDatabase(
    'org_contracts',
    async ({sql, actor}) => {
        const company = id(), otherCompany = id(), cleanupCompany = id(), abandonedCompany = id();
        const manager = randomUUID(), admin = randomUUID(), inactive = randomUUID(), client = randomUUID();
        const orgOnly = randomUUID(), contractOnly = randomUUID(), uploader = randomUUID();
        const pageActors = Array.from({length: 4}, () => randomUUID());
        const roles = [[manager, 'management'], [admin, 'admin'], [inactive, 'management'],
            [client, 'client'], [orgOnly, 'lecturer'], [contractOnly, 'senior_lecturer'],
            [uploader, 'management'], ...pageActors.map((who) => [who, 'management'])];
        await sql(`insert into auth.users(id,email,email_confirmed_at) values
          ${roles.map(([who]) => `(${q(who)},${q(`${who}@example.invalid`)},now())`).join(',')};
          insert into public.user_roles(user_id,role) values ${roles.map(([who, role]) => `(${q(who)},${q(role)})`).join(',')} on conflict do nothing;
          update public.profiles set active=false where id=${q(inactive)};
          insert into public.organisations(id,name) values
            (${company},'Fictional Amber Company'),(${otherCompany},'Fictional Birch Company'),
            (${cleanupCompany},'Fictional Cedar Company'),(${abandonedCompany},'Fictional Dune Company');
          insert into public.client_organisation_memberships(user_id,organisation_id) values(${q(client)},${company});
          insert into public.role_permissions(role,permission) values ('lecturer','organisations.manage'),
            ('senior_lecturer','contracts.manage'),('client','organisations.manage'),('client','contracts.manage') on conflict do nothing;`);

        const digest = 'a'.repeat(64), wrongDigest = 'b'.repeat(64), scanner = 'ClamAV Fictional Test';
        const request = id(), filename = 'Fictional Amber Contract.pdf';
        const reserve = (org = company, key = request, hash = digest, file = filename, size = '120') =>
            `public.reserve_organisation_contract(${org},${q(file)},${size},${key},${q(hash)})`;
        const generic = (key, kind = 'contract', replace = 'null') =>
            `public.reserve_document(${q(filename)},'application/pdf',120,'personal',${q(kind)},null,null,${key},${replace})`;
        const read = (who, call) => actor(who, `select ${call}`).then(json);
        const service = (query) => sql(`begin; set local role service_role; ${query}; commit;`);
        const begin = (doc, ver) => service(`select public.deletion_upload_begin(${doc},${ver})`).then(q);
        const end = (lease) => service(`select public.deletion_upload_end(${lease})`);
        const scanning = (doc, ver) => service(`update public.document_versions set status='scanning' where id=${ver};
            update public.documents set status='scanning' where id=${doc}`);
        const complete = (doc, ver, lease, hash = digest) =>
            `public.complete_document_upload(${doc},${ver},${lease},${q(hash)},${q(scanner)})`;
        const promote = async (doc, ver) => {
            const lease = await begin(doc, ver);
            await scanning(doc, ver);
            await service(`select ${complete(doc, ver, lease)}`);
            await end(lease);
        };
        const list = (who, org = company, cursor = '') => read(who, `public.organisation_contracts(${org}${cursor})`);
        const ids = (reservation) => [q(reservation.document_id), q(reservation.version_id)];
        const status = (org, doc, ver) => `public.organisation_contract_upload_status(${org},${doc},${ver})`;
        const download = (org, doc) => `public.organisation_contract_download(${org},${doc})`;

        // Seed an ordinary personal contract before applying the new migration.
        const legacyRequest = id();
        const legacy = await read(manager, generic(legacyRequest));
        await assert.rejects(read(manager, reserve()), sqlState('42883'));
        await sql(await readFile(migration, 'utf8'));
        await promote(...ids(legacy));
        assert.equal(await actor(manager, `select private.can_access_document(${q(legacy.document_id)})`), 't');
        assert.equal(await read(admin, download(company, q(legacy.document_id))), null);

        // Concurrent exact retries share the underlying allocator's keys.
        const [created, replay] = await Promise.all([read(manager, reserve()), read(manager, reserve())]);
        assert.deepEqual(created, replay);
        const [doc, ver] = ids(created);
        assert.equal(created.status, 'quarantined');
        assert.equal(created.object_path, `${manager}/${created.document_id}/${created.version_id}`);
        assert.equal(await sql(`select count(*) from public.document_versions where uploaded_by=${q(manager)} and client_id=${request}`), '1');

        // The shared allocator still charges company PDFs to the uploader.
        // At the exact owner limit, retries are free but new files are refused.
        const ownerLimit = await sql('select owner_quota_bytes from private.document_storage_limits');
        await sql(`update private.document_storage_limits set owner_quota_bytes=(
            select sum(v.size_bytes) from public.document_versions v join public.documents d on d.id=v.document_id
            where d.owner_id=${q(manager)}
        )`);
        const quotaRequest = id();
        await assert.rejects(read(manager, reserve(company, quotaRequest)), sqlState('54000'));
        assert.equal(await sql(`select count(*) from public.document_versions where client_id=${quotaRequest}`), '0');
        assert.deepEqual(await read(manager, reserve()), created);
        await sql(`update private.document_storage_limits set owner_quota_bytes=${q(ownerLimit)}`);

        const empty = {items: [], has_more: false};
        for (const who of [manager, admin]) {
            const pending = await read(who, status(company, doc, ver));
            assert.equal(pending.document.id, created.document_id);
            assert.equal(pending.document.kind, 'organisation_contract');
            assert.equal(pending.document.current_version_id, created.version_id);
            assert.equal(pending.document.status, 'quarantined');
            assert.equal(pending.sha256, null);
            assert.deepEqual(await list(who), empty);
            assert.equal(await read(who, download(company, doc)), null);
        }
        assert.equal(await read(admin, status(otherCompany, doc, ver)), null);
        assert.equal(await read(admin, status(company, doc, q(legacy.version_id))), null);
        for (const conflict of [reserve(otherCompany), reserve(company, request, wrongDigest),
            reserve(company, request, digest, 'Different.pdf'), reserve(company, request, digest, filename, '121'),
            reserve(company, legacyRequest)]) {
            await assert.rejects(read(manager, conflict), sqlState('PT409'));
        }
        await assert.rejects(read(manager, reserve(company, id(), digest, filename, 'null')), sqlState('22023'));
        await assert.rejects(list(manager, company, `,now(),null`), sqlState('22023'));
        await assert.rejects(read(manager, reserve(id(), id())), sqlState('42501'));
        for (const who of [orgOnly, contractOnly, client, inactive, randomUUID()]) {
            for (const call of [reserve(), status(company, doc, ver), download(company, doc), `public.organisation_contracts(${company})`]) {
                await assert.rejects(read(who, call), sqlState('42501'));
            }
        }
        for (const role of ['anon', 'service_role']) {
            await assert.rejects(sql(`set role ${role}; select public.organisation_contracts(${company})`), sqlState('42501'));
        }

        // The actual Edge contract uses the ordinary service-only lease and
        // completion RPCs; wrong leases, versions and digests cannot publish.
        await assert.rejects(read(manager, `public.deletion_upload_begin(${doc},${ver})`), sqlState('42501'));
        const lease = await begin(doc, ver);
        await scanning(doc, ver);
        await assert.rejects(actor(manager, `select ${complete(doc, ver, lease)}`), sqlState('42501'));
        await assert.rejects(service(`select ${complete(doc, ver, id())}`), sqlState('42501'));
        await assert.rejects(service(`select ${complete(doc, q(legacy.version_id), lease)}`), sqlState('42501'));
        await assert.rejects(service(`select ${complete(doc, ver, lease, wrongDigest)}`), sqlState('PT409'));
        assert.deepEqual(await list(admin), empty);
        await service(`select ${complete(doc, ver, lease)}; select ${complete(doc, ver, lease)}`);
        await end(lease);
        assert.equal(await sql(`select count(*) from public.audit_events where resource_id=${doc} and action='document.scan_clean'`), '1');
        assert.deepEqual(await read(manager, reserve()), {...created, status: 'clean'});
        const selected = {document_id: created.document_id, version_id: created.version_id, sha256: digest, file_name: filename};
        for (const who of [manager, admin]) {
            assert.deepEqual(await read(who, download(company, doc)), selected);
            assert.equal((await read(who, status(company, doc, ver))).sha256, digest);
            assert.equal(await read(who, download(otherCompany, doc)), null);
            assert.deepEqual(await list(who, otherCompany), empty);
            assert.equal(await actor(who, `select count(*) from public.documents where id=${doc}`), '0');
            assert.equal(await actor(who, `select count(*) from public.document_versions where id=${ver}`), '0');
            assert.equal(await actor(who, `select private.can_access_document(${doc})`), 'f');
            const search = await read(who, `public.unified_search('Fictional Amber','files')`);
            assert(!search.items.some((item) => item.id === created.document_id));
            const deletion = await read(who, `public.deletion_resources('document','Fictional Amber')`);
            assert(!deletion.items.some((item) => item.id === created.document_id));
        }
        for (const mutation of [generic(id(), 'organisation_contract'), generic(id(), 'contract', doc),
            `public.rename_document(${doc},'Renamed.pdf')`, `public.rename_document(${doc},'Deleted.pdf',true)`]) {
            await assert.rejects(actor(manager, `select ${mutation}`), sqlState('42501'));
        }
        await assert.rejects(service(`update public.documents set original_name='Changed.pdf' where id=${doc}`), sqlState('23503'));
        await assert.rejects(service(`update public.document_versions set sha256=${q(wrongDigest)} where id=${ver}`), sqlState('23503'));
        await assert.rejects(sql(`delete from private.organisation_contract_files where document_id=${doc}`), sqlState('23503'));
        await assert.rejects(sql(`delete from public.organisations where id=${company}`), sqlState('23503'));
        for (const [kind, target] of [['organisation', company], ['account', q(manager)]]) {
            const plan = await read(admin, `public.deletion_preview(${q(kind)},${target})`);
            assert.equal(plan.can_confirm, false);
            assert(plan.blockers.some((blocker) => blocker.kind === 'private.organisation_contract_files'));
        }
        console.log('PASS predecessor upgrade, caller rights, retry conflicts, exact service promotion and retained history');

        // Scanner authority does not preserve the uploader's former rights.
        const [revokedDoc, revokedVer] = ids(await read(manager, reserve(otherCompany, id())));
        const revokedLease = await begin(revokedDoc, revokedVer);
        await scanning(revokedDoc, revokedVer);
        await sql(`delete from public.user_roles where user_id=${q(manager)} and role='management'`);
        await assert.rejects(read(manager, status(otherCompany, revokedDoc, revokedVer)), sqlState('42501'));
        await assert.rejects(service(`select ${complete(revokedDoc, revokedVer, revokedLease)}`), sqlState('42501'));
        assert.equal((await read(admin, status(otherCompany, revokedDoc, revokedVer))).document.status, 'scanning');
        assert.deepEqual(await list(admin, otherCompany), empty);
        await sql(`insert into public.user_roles(user_id,role) values (${q(manager)},'management')`);
        await service(`select ${complete(revokedDoc, revokedVer, revokedLease)}`);
        await end(revokedLease);
        assert.equal((await read(admin, download(otherCompany, revokedDoc))).sha256, digest);
        console.log('PASS current uploader rights required at scan completion');

        // Produce more than one page using actual scanner RPCs. Each actor's
        // reservations share one statement timestamp, exercising tied cursors.
        for (const who of pageActors) {
            const batch = Array.from({length: 8}, (_, i) => reserve(company, id(), digest, `Fictional Batch ${i}.pdf`));
            const files = (await actor(who, batch.map((call) => `select ${call}`).join(';'))).split('\n').map(json);
            for (const file of files) await promote(...ids(file));
        }
        const page = await list(admin);
        assert.equal(page.items.length, 30);
        assert.equal(page.has_more, true);
        const last = page.items.at(-1);
        const tail = await list(admin, company, `,${q(last.created_at)},${q(last.id)}`);
        assert.equal(tail.items.length, 3);
        assert.equal(tail.has_more, false);
        assert.deepEqual([...page.items, ...tail.items].map((item) => item.id),
            (await sql(`select id from private.ready_organisation_contracts where organisation_id=${company} order by created_at desc,id desc`)).split('\n'));
        assert.deepEqual(Object.keys(last).sort(), ['created_at', 'file_name', 'id']);

        // Archive keeps completed reads but stops further reservation and promotion.
        const [pendingDoc, pendingVer] = ids(await read(admin, reserve(company, id())));
        const pendingLease = await begin(pendingDoc, pendingVer);
        await scanning(pendingDoc, pendingVer);
        await sql(`update public.organisations set archived_at=now() where id=${company}`);
        assert.deepEqual(await list(admin), page);
        assert.deepEqual(await read(admin, download(company, doc)), selected);
        assert.equal(await read(admin, status(company, pendingDoc, pendingVer)), null);
        await assert.rejects(read(admin, reserve(company, id())), sqlState('42501'));
        await assert.rejects(service(`select ${complete(pendingDoc, pendingVer, pendingLease)}`), sqlState('42501'));
        await end(pendingLease);
        console.log('PASS bounded tuple pagination and archived-company retention');

        // Run the actual reviewed deletion worker for rejected and abandoned
        // uploads rather than treating a lack of FK errors as proof of cleanup.
        const rejected = await read(manager, reserve(cleanupCompany, id()));
        const [rejectedDoc, rejectedVer] = ids(rejected);
        await service(`update public.document_versions set status='rejected',sha256=${q(digest)},scanner_version=${q(scanner)} where id=${rejectedVer};
            update public.documents set status='rejected' where id=${rejectedDoc}`);
        assert.equal((await read(admin, status(cleanupCompany, rejectedDoc, rejectedVer))).sha256, digest);
        assert.deepEqual(await list(admin, cleanupCompany), empty);
        const abandoned = await read(uploader, reserve(abandonedCompany, id()));
        for (const [kind, target, file] of [['organisation', cleanupCompany, rejected], ['account', q(uploader), abandoned]]) {
            const plan = await read(admin, `public.deletion_preview(${q(kind)},${target})`);
            assert.deepEqual(plan.blockers, [], `${kind} deletion must not retain incomplete uploads`);
            assert.equal(plan.counts['public.documents'], 1);
            assert.equal(plan.counts['public.document_versions'], 1);
            assert.equal(plan.counts['private.organisation_contract_files'], 1);
            const {operation_id: operation} = await read(admin, `public.deletion_confirm(${q(plan.plan_id)},${id()},'DELETE')`);
            const {permit_id: permit} = await read(admin, `public.deletion_execution(${q(operation)})`);
            const work = json(await service(`select public._deletion_work(${q(operation)},${q(permit)})`));
            assert.deepEqual(work.objects, ['portal-quarantine', 'portal-clean'].map((bucket) => ({bucket, path: file.object_path})).sort((a, b) => a.bucket.localeCompare(b.bucket)),
                `${kind} work includes both buckets`);
            await service(`select public._deletion_apply(${q(operation)},${q(permit)})`);
            const [deletedDoc, deletedVer] = ids(file);
            assert.equal(await sql(`select count(*) from public.documents where id=${deletedDoc}`), '0');
            assert.equal(await sql(`select count(*) from public.document_versions where id=${deletedVer}`), '0');
            assert.equal(await sql(`select count(*) from private.organisation_contract_files where document_id=${deletedDoc}`), '0');
        }
        console.log('PASS reviewed organisation and account cleanup for incomplete uploads');

        // This disposable DB is deliberately pinned last to exercise the same
        // grants with a non-internal edition without provisioning any tenant.
        await sql(`update private.installation_identity set edition='customer-managed' where singleton`);
        for (const call of [reserve(otherCompany, id()), status(company, doc, ver), download(company, doc), `public.organisation_contracts(${company})`]) {
            await assert.rejects(read(admin, call), sqlState('42501'));
        }
        console.log('PASS internal edition boundary');
    },
    // A historical ceiling replays from template0, even when CI provides a
    // prepared template with the latest migration already installed.
    {migrationsThrough: predecessor},
);