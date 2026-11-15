import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

// Local development only: never writes service credentials to a browser env file.
const raw = execFileSync('npm', ['exec', '--yes', '--package=supabase@3.1.0', '--', 'supabase', 'status', '-o', 'json'], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
});
const status = JSON.parse(raw.slice(raw.indexOf('{')));
const apiUrl = status.API_URL ?? status.api?.url;
const anonKey = status.ANON_KEY ?? status.api?.anon_key;
const publishableKey = status.PUBLISHABLE_KEY ?? anonKey;
const serviceKey = status.SERVICE_ROLE_KEY ?? status.api?.service_role_key;
const dbUrl = status.DB_URL ?? status.db?.url;
if (!apiUrl || !anonKey || !serviceKey || !dbUrl) throw new Error('Local Supabase status lacks required credentials.');
const allowed = new Set(['127.0.0.1', 'localhost', '[::1]']);
if (!allowed.has(new URL(apiUrl).hostname) || !allowed.has(new URL(dbUrl).hostname)) {
  throw new Error('Refusing to create local test credentials for a remote project.');
}
mkdirSync('.local', { recursive: true, mode: 0o700 });
writeFileSync('.env.local', `VITE_SUPABASE_URL=${apiUrl}\nVITE_SUPABASE_PUBLISHABLE_KEY=${publishableKey}\n`, { mode: 0o600 });
chmodSync('.env.local', 0o600);
const password = `Local!${randomBytes(20).toString('hex')}Aa9`;
writeFileSync('.env.test.local', [
  `SUPABASE_URL=${apiUrl}`, `SUPABASE_ANON_KEY=${anonKey}`,
  `SUPABASE_SERVICE_ROLE_KEY=${serviceKey}`, `DATABASE_URL=${dbUrl}`,
  'E2E_LECTURER_EMAIL=lecturer01@example.invalid', 'E2E_OTHER_EMAIL=lecturer02@example.invalid',
  'E2E_ADMIN_EMAIL=admin@example.invalid', `E2E_PASSWORD=${password}`,
].join('\n') + '\n', { mode: 0o600 });
chmodSync('.env.test.local', 0o600);
console.log('Created ignored local frontend and test environment files (credentials withheld).');
