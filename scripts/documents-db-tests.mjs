/** Real disposable PostgreSQL/RLS checks for document reservation identity and quotas.
 * The separate documents-api-check exercises actual Auth, Storage and ClamAV.
 */
import { spawn } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const container = process.env.PORTAL_DB_CONTAINER ?? 'supabase_db_luminovia-portal';
if (!/^supabase_db_luminovia-portal(?:-test(?:-[a-zA-Z0-9_-]+)?)?$/.test(container)) throw new Error('Only the named local portal database container is permitted.');
const database = `documents_test_${randomUUID().replaceAll('-', '')}`;
function command(args, input = '') {
 return new Promise((resolve, reject) => {
  const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] }); let out = '', err = '';
  child.stdout.on('data', d => out += d); child.stderr.on('data', d => err += d);
  child.on('error', reject); child.on('exit', code => code === 0 ? resolve(out.trim()) : reject(new Error(err || out)));
  child.stdin.end(input);
 });
}
const sql = (text, name = database) => command(['exec', '-i', container, 'psql', '-U', 'postgres', '-d', name, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], text);
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const actor = (id, statement, aal = 'aal1') => sql(`begin;set local role authenticated;set local request.jwt.claims=${quote(JSON.stringify({ sub: id, aal, role: 'authenticated' }))};${statement};commit;`);
const owner = randomUUID(), otherOwner = randomUUID(), quotaOwner = randomUUID(), selfQuotaOwner = randomUUID(), manager = randomUUID(), manager2 = randomUUID();
const reserve = async (who, { subject = who, size = 256, key = randomUUID(), replace = null, name = 'Fictional.pdf' } = {}, aal = 'aal1') => JSON.parse(await actor(who, `select public.reserve_document(${quote(name)},'application/pdf',${size},'personal','contract',null,null,${quote(key)},${replace ? quote(replace) : 'null'},${quote(subject)})`, aal));
let checks = 0;
const check = async (name, fn) => { await fn(); checks++; console.log(`PASS ${name}`); };
async function seedNinetyMiB(subject) {
 for (let index = 0; index < 9; index++) {
  const id = randomUUID(), version = randomUUID(), key = randomUUID();
  await sql(`insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,client_id) values('${id}','${subject}','${subject}','personal','material','Fixture.txt','text/plain',10485760,'${key}');insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes) values('${version}','${id}','${subject}','${key}',1,'${subject}/${version}','Fixture.txt','text/plain',10485760);update public.documents set current_version_id='${version}' where id='${id}';`);
 }
}
try {
 await sql(`create database ${database}`, 'postgres');
 await sql(`create schema auth;create schema extensions;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
 grant usage on schema auth to authenticated,anon,service_role;grant execute on all functions in schema auth to authenticated,anon,service_role;`);
 for (const file of (await readdir(new URL('../supabase/migrations/', import.meta.url))).filter(f => f.endsWith('.sql')).sort()) await sql(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'));
 await sql(`insert into auth.users(id) values ${[owner,otherOwner,quotaOwner,selfQuotaOwner,manager,manager2].map(id => `('${id}')`).join(',')};insert into public.user_roles(user_id,role) values('${owner}','lecturer'),('${otherOwner}','lecturer'),('${quotaOwner}','lecturer'),('${selfQuotaOwner}','lecturer'),('${manager}','admin'),('${manager2}','management');`);
 let initial, replacement, alternate;
 const createKey = randomUUID(), replacementKey = randomUUID();
 await check('Creation retries return the same document/version without consuming another reservation', async () => {
  initial = await reserve(owner, { key: createKey });
  assert.deepEqual(await reserve(owner, { key: createKey }), initial);
  assert.equal(await sql(`select count(*) from public.document_versions where document_id='${initial.document_id}'`), '1');
 });
 await check('A creation retry cannot be reinterpreted as replacement even of the same document', async () => {
  await assert.rejects(reserve(owner, { key: createKey, replace: initial.document_id }), /replacement target conflict/);
 });
 await check('Replacement retries preserve the precise target and version', async () => {
  replacement = await reserve(owner, { key: replacementKey, replace: initial.document_id });
  assert.equal(replacement.document_id, initial.document_id);
  assert.notEqual(replacement.version_id, initial.version_id);
  assert.deepEqual(await reserve(owner, { key: replacementKey, replace: initial.document_id }), replacement);
  assert.equal(await sql(`select count(*) from public.document_versions where document_id='${initial.document_id}'`), '2');
 });
 await check('A replacement retry rejects omitted or different document targets', async () => {
  alternate = await reserve(owner);
  await assert.rejects(reserve(owner, { key: replacementKey }), /replacement target conflict/);
  await assert.rejects(reserve(owner, { key: replacementKey, replace: alternate.document_id }), /replacement target conflict/);
 });
 await check('Mismatched metadata and unauthorized on-behalf ownership remain denied', async () => {
  await assert.rejects(reserve(owner, { key: createKey, size: 257 }), /Idempotency conflict/);
  await assert.rejects(reserve(owner, { subject: otherOwner }), /Subject upload permission required/);
  await assert.rejects(reserve(manager, { subject: otherOwner }), /Subject upload permission required/);
  const delegated = await reserve(manager, { subject: otherOwner }, 'aal2');
  assert.equal(await sql(`select owner_id||':'||uploaded_by from public.documents where id='${delegated.document_id}'`), `${otherOwner}:${manager}`);
 });
 await seedNinetyMiB(quotaOwner);
 await seedNinetyMiB(selfQuotaOwner);
 // A slow INSERT makes both old actor-only implementations pass the quota check
 // before either commits. The owner lock must make the losing caller recheck 100MiB.
 await sql(`create function private.document_quota_race_delay() returns trigger language plpgsql set search_path='' as $$begin perform pg_catalog.pg_sleep(0.7);return new;end;$$;create trigger document_quota_race_delay before insert on public.documents for each row execute function private.document_quota_race_delay();`);
 await check('Two different MFA managers serialize one owner quota: exactly one 10MiB reservation wins at 90MiB', async () => {
  const results = await Promise.allSettled([
   reserve(manager, { subject: quotaOwner, size: 10485760 }, 'aal2'),
   reserve(manager2, { subject: quotaOwner, size: 10485760 }, 'aal2'),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const failed = results.filter(result => result.status === 'rejected');
  assert.equal(failed.length, 1); assert.match(failed[0].reason.message, /Upload quota reached/);
  assert.equal(await sql(`select sum(v.size_bytes) from public.document_versions v join public.documents d on d.id=v.document_id where d.owner_id='${quotaOwner}'`), '104857600');
 });
 await check('Self-upload and MFA on-behalf upload share the same owner quota lock', async () => {
  const results = await Promise.allSettled([
   reserve(selfQuotaOwner, { size: 10485760 }),
   reserve(manager2, { subject: selfQuotaOwner, size: 10485760 }, 'aal2'),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  assert.match(results.find(result => result.status === 'rejected').reason.message, /Upload quota reached/);
  assert.equal(await sql(`select sum(v.size_bytes) from public.document_versions v join public.documents d on d.id=v.document_id where d.owner_id='${selfQuotaOwner}'`), '104857600');
 });
 await check('Document metadata/version writes stay RPC-only and suspended actors cannot retry', async () => {
  await assert.rejects(actor(owner, `update public.documents set status='clean' where id='${initial.document_id}'`), /permission denied/);
  assert.equal(await actor(otherOwner, `select count(*) from public.documents where id='${initial.document_id}'`), '0');
  await sql(`update public.profiles set active=false where id='${owner}'`);
  await assert.rejects(reserve(owner, { key: createKey }), /Active login required/);
 });
 console.log(`\n${checks} document PostgreSQL checks passed (retry target identity and real concurrent owner quotas).`);
} finally { await sql(`drop database if exists ${database} with(force)`, 'postgres'); }
