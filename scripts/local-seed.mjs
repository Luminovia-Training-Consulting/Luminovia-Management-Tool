import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';

process.loadEnvFile('.env.test.local');
const url = process.env.SUPABASE_URL;
if (!url || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) {
  throw new Error('Local fixtures refuse all remote Supabase URLs.');
}
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const password = process.env.E2E_PASSWORD;
if (!password) throw new Error('Run node scripts/local-env.mjs first.');
const stableId = (name) => {
  const hash = createHash('sha256').update(`luminovia-local-${name}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
};
async function checked(request, label) {
  const result = await request;
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}
const existingUsers = await checked(service.auth.admin.listUsers({ perPage: 1000 }), 'List local users');
async function user(email, displayName, role) {
  let account = existingUsers.users.find((entry) => entry.email === email);
  if (!account) {
    account = (await checked(service.auth.admin.createUser({ email, password, email_confirm: true }), 'Create fictional local user')).user;
  } else {
    await checked(service.auth.admin.updateUserById(account.id, { password, email_confirm: true }), 'Update local test password');
  }
  await checked(service.from('profiles').upsert({
    id: account.id, display_name: displayName,
    bio_de: 'Fiktives Profil für die lokale Entwicklung. Keine echte Person.',
    bio_en: 'Fictional local development profile. Not a real person.',
    locale: 'de', time_zone: 'Europe/Berlin', active: true,
  }), 'Seed local profile');
  await checked(service.from('user_roles').upsert({ user_id: account.id, role }, { onConflict: 'user_id,role' }), 'Seed local role');
  return account.id;
}
const admin = await user('admin@example.invalid', 'Luminovia Testverwaltung', 'admin');
const names = ['Mara Winter', 'Jonas Lind', 'Lea Sommer', 'Timo Berger', 'Nora West', 'Milan Roth', 'Elisa Blum', 'Oskar Feld', 'Lina Stern', 'Emil Bach', 'Thea Berg'];
const lecturers = [];
for (let index = 0; index < 11; index++) {
  const id = await user(`lecturer${String(index + 1).padStart(2, '0')}@example.invalid`, names[index], 'lecturer');
  lecturers.push(id);
}
await user('participant@example.invalid', 'Fiktive Kursteilnahme', 'participant');
const topics = [
  { id: stableId('python-topic'), label_de: 'Python', label_en: 'Python', kind: 'language' },
  { id: stableId('linux-topic'), label_de: 'Linux', label_en: 'Linux', kind: 'topic' },
  { id: stableId('wireshark-topic'), label_de: 'Wireshark', label_en: 'Wireshark', kind: 'tool' },
];
await checked(service.from('topics').upsert(topics), 'Seed expertise taxonomy');
for (const lecturer of lecturers) {
  await checked(service.from('lecturer_topics').upsert(topics.map((topic) => ({
    user_id: lecturer, topic_id: topic.id, verified: true, valid_until: '2030-12-31T23:59:59Z',
  })), { onConflict: 'user_id,topic_id' }), 'Seed verified fictional expertise');
  await checked(service.from('contracts').upsert({
    id: stableId(`contract-${lecturer}`), user_id: lecturer, status: 'active',
    effective_from: '2026-01-01', expires_at: '2030-12-31T23:59:59Z', version: 1,
  }), 'Seed fictional local contract');
}
const start = new Date();
start.setUTCDate(start.getUTCDate() + 7);
start.setUTCHours(8, 0, 0, 0);
const nextDay = (index, hour = 8) => {
  const date = new Date(start);
  date.setUTCDate(date.getUTCDate() + index);
  date.setUTCHours(hour);
  return date.toISOString();
};
const jobs = [
  { id: stableId('python-job'), title: 'Python – Grundlagen in fünf Tagen', description: 'Fiktiver Schulungsauftrag: Variablen, Funktionen, Dateien und ein gemeinsames Praxisprojekt.', customer_name: 'Beispiel Akademie', delivery_type: 'online', location: 'Online – Zugang folgt nach Beauftragung', time_zone: 'Europe/Berlin', status: 'published', amount: 480, currency: 'EUR', rate_unit: 'per_day', total_amount: 2400, terms: 'Ausschließlich fiktiver Entwicklungsauftrag. Fünf zusammenhängende Unterrichtstage.', terms_version: 1, requires_contract: true },
  { id: stableId('linux-job'), title: 'Linux – Praxistag', description: 'Fiktiver Workshop zu Shell, Dateirechten und Prozessen.', customer_name: 'Demo Learning Campus', delivery_type: 'onsite', location: 'Fiktiver Schulungsraum', time_zone: 'Europe/Berlin', status: 'published', amount: 520, currency: 'EUR', rate_unit: 'per_day', total_amount: 520, terms: 'Ausschließlich fiktiver Entwicklungsauftrag.', terms_version: 1, requires_contract: true },
];
for (const [index, job] of jobs.entries()) {
  const existing = await checked(service.from('jobs').select('id').eq('id', job.id).maybeSingle(), 'Check seed job');
  if (existing) continue; // Reruns preserve accepted assignments and their snapshots.
  await checked(service.from('jobs').insert(job), 'Seed published job');
  const count = index === 0 ? 5 : 1;
  await checked(service.from('job_sessions').insert(Array.from({ length: count }, (_, day) => ({
    id: stableId(`${job.id}-session-${day}`), job_id: job.id,
    starts_at: nextDay(index === 0 ? day : 10), ends_at: nextDay(index === 0 ? day : 10, 14),
  }))), 'Seed job sessions');
  await checked(service.from('job_requirements').insert({ job_id: job.id, topic_id: topics[index].id }), 'Seed job requirements');
}
console.log(`Seeded 11 fictional lecturers, one admin, one participant and local sample jobs. No emails were sent. Admin profile ${admin.slice(0, 8)}…`);
console.log('Use the accounts and generated password in ignored .env.test.local. Never reuse these fixtures in production.');
