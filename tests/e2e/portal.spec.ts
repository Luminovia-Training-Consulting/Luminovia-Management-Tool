/**
 * Browser workflows for sign-in, profiles, whole-block claims and immediate permission checks.
 * Rendered workflows are checked in isolation; this does not replace manual device/platform acceptance.
 */
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createClient } from '@supabase/supabase-js';
import { createHmac, randomUUID } from 'node:crypto';
import { readPrivateJson, writePrivateJson } from '../../scripts/testing/private-state.mjs';

const configured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.E2E_PASSWORD);
test.skip(!configured, 'Real local Supabase fixtures required. Run scripts/local-start.sh and scripts/local-seed.mjs.');

/** Creates a local SDK test client with its own nonpersistent Auth session. */
function localClient(key: string) {
  const url = process.env.SUPABASE_URL!;
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)) throw new Error('E2E mutation fixtures only permit loopback Supabase.');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
/** Creates the administrative fixture client; its key stays outside the browser application. */
const service = () => localClient(process.env.SUPABASE_SERVICE_ROLE_KEY!);
/** Signs the fictional identity into a real session for API checks outside the browser. */
async function signInApi(email: string) {
  const client = localClient(process.env.SUPABASE_ANON_KEY!);
  const { data, error } = await client.auth.signInWithPassword({ email, password: process.env.E2E_PASSWORD! });
  expect(error, 'Real Supabase Auth sign-in succeeds').toBeNull();
  expect(data.user).toBeTruthy();
  return { client, user: data.user! };
}
/** Signs this test actor in through the visible form and waits for confirmed navigation. */
async function login(page: Page, email = process.env.E2E_LECTURER_EMAIL!) {
  await page.goto('/login');
  await page.getByLabel('E-Mail', { exact: true }).fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(process.env.E2E_PASSWORD!);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
}
/** Checks the rendered state with axe; this does not replace manual accessibility acceptance. */
async function a11y(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(async () => {
    // Theme changes animate briefly. Inspect the settled screen, excluding infinite spinners.
    void getComputedStyle(document.documentElement).color;
    await Promise.all(document.getAnimations().filter((animation) => animation.effect?.getTiming().iterations !== Infinity).map((animation) => animation.finished.catch(() => undefined)));
  });
  const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const violations = scan.violations.map((violation) => ({
    id: violation.id, impact: violation.impact,
    nodes: violation.nodes.map((node) => ({ target: node.target, failure: node.failureSummary })),
  }));
  expect(violations).toEqual([]);
}
/** Computes the current six-digit TOTP from the fictional MFA secret; never log the code or secret. */
function totp(secret: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = [...secret.replace(/=+$/, '').toUpperCase()].map((char) => alphabet.indexOf(char).toString(2).padStart(5, '0')).join('');
  const key = Buffer.from(bits.match(/.{8}/g)!.map((byte) => Number.parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac('sha1', key).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
}

test('private routes require real authentication and login is accessible', async ({ page }, testInfo) => {
  await page.goto('/jobs');
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole('button', { name: 'Anmelden', exact: true })).toBeVisible();
  await a11y(page);
  await page.screenshot({ path: `docs/screenshots/${testInfo.project.name}-login.png`, fullPage: true });
});

test('lecturer signs in, edits bilingual profile and persists it on reload', async ({ page }, testInfo) => {
  await login(page);
  await expect(page.getByRole('heading', { name: /Schön, dass du da bist/ })).toBeVisible();
  await page.screenshot({ path: `docs/screenshots/${testInfo.project.name}-dashboard.png`, fullPage: true });
  await page.goto('/profile');
  const text = `Lokale QA ${testInfo.project.name}`;
  await page.getByLabel('Über mich (Deutsch)', { exact: true }).fill(text);
  await page.getByLabel('About me (English)', { exact: true }).fill(`Local QA ${testInfo.project.name}`);
  await page.getByRole('button', { name: 'Profil speichern', exact: true }).click();
  await expect(page.getByRole('status')).toContainText(/gespeichert/i);
  await page.reload();
  await expect(page.getByLabel('Über mich (Deutsch)', { exact: true })).toHaveValue(text);
  await expect(page.getByLabel('About me (English)', { exact: true })).toHaveValue(`Local QA ${testInfo.project.name}`);
  await a11y(page);
});

test('combined filters find a real job, claim confirms all five sessions and immutable fee', async ({ page }, testInfo) => {
  const id = randomUUID();
  const title = `QA Python ${testInfo.project.name} ${id.slice(0, 8)}`;
  const starts = new Date();
  starts.setUTCDate(starts.getUTCDate() + 15 + (testInfo.project.name.includes('mobile') ? 8 : 0));
  starts.setUTCHours(8, 0, 0, 0);
  const { data: accounts } = await service().auth.admin.listUsers({ perPage: 1000 });
  const lecturer = accounts!.users.find((user) => user.email === process.env.E2E_LECTURER_EMAIL)!;
  const { data: previous } = await service().from('assignment_sessions').select('ends_at').eq('lecturer_id', lecturer.id).lt('ends_at', '2030-01-01T00:00:00Z').order('ends_at', { ascending: false }).limit(1);
  if (previous?.[0] && new Date(previous[0].ends_at) >= starts) {
    starts.setTime(new Date(previous[0].ends_at).getTime() + 2 * 86_400_000);
    starts.setUTCHours(8, 0, 0, 0);
  }
  const { error: jobError } = await service().from('jobs').insert({
    id, title, description: 'Fiktiver Testauftrag mit fünf Terminen.', customer_name: 'QA Beispiel Akademie',
    delivery_type: 'online', location: 'Online', time_zone: 'Europe/Berlin', status: 'published',
    amount: 400, currency: 'EUR', rate_unit: 'per_day', total_amount: 2000,
    terms: 'Fiktive Testkonditionen Version 1.', terms_version: 1, requires_contract: true,
  });
  expect(jobError).toBeNull();
  const sessions = Array.from({ length: 5 }, (_, index) => {
    const start = new Date(starts);
    start.setUTCDate(start.getUTCDate() + index);
    return { job_id: id, starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 6 * 3600_000).toISOString() };
  });
  const { error: sessionError } = await service().from('job_sessions').insert(sessions);
  expect(sessionError).toBeNull();
  await login(page);
  await page.goto('/jobs');
  await page.getByRole('searchbox', { name: 'Suchtext', exact: true }).fill(title);
  await page.getByLabel('Durchführung', { exact: true }).selectOption('online');
  await page.getByLabel('Währung', { exact: true }).selectOption('EUR');
  await page.getByLabel('Gesamthonorar ab', { exact: true }).fill('1900');
  await page.getByRole('button', { name: 'Filter anwenden', exact: true }).click();
  await expect(page.getByRole('link', { name: new RegExp(title) }).first()).toBeVisible();
  await page.getByRole('link', { name: new RegExp(title) }).first().click();
  await expect(page).toHaveURL(new RegExp(`/jobs/${id}`));
  await expect(page.getByText(/2\.000,00\s*€/).first()).toBeVisible();
  await page.getByLabel(/Konditionen akzeptieren/).check();
  await page.getByRole('button', { name: 'Auftrag übernehmen', exact: true }).click();
  await expect(page.getByRole('status')).toContainText(/bestätigt|übernommen/i);
  const { client, user } = await signInApi(process.env.E2E_LECTURER_EMAIL!);
  const { data: claims, error } = await client.from('job_claims').select('*').eq('job_id', id);
  expect(error).toBeNull();
  expect(claims).toHaveLength(1);
  expect(claims![0].lecturer_id).toBe(user.id);
  const { data: storedJob } = await client.from('jobs').select('status').eq('id', id).single();
  expect(storedJob?.status).toBe('filled');
  await page.goto('/calendar');
  await expect(page.getByRole('heading', { name: /Kalender/ }).first()).toBeVisible();
  await page.screenshot({ path: `docs/screenshots/${testInfo.project.name}-calendar.png`, fullPage: true });
});

test('private calendar event is persisted and invisible to another lecturer', async ({ page }, testInfo) => {
  const title = `Privat QA ${randomUUID().slice(0, 8)}`;
  await login(page);
  await page.goto('/calendar');
  await page.getByRole('button', { name: 'Privaten Termin hinzufügen', exact: true }).click();
  await page.getByLabel('Titel', { exact: true }).fill(title);
  await page.getByLabel('Beginn', { exact: true }).fill('2030-05-06T10:00');
  await page.getByLabel('Ende', { exact: true }).fill('2030-05-06T11:00');
  await page.getByRole('button', { name: 'Termin speichern', exact: true }).click();
  await expect(page.getByRole('status')).toContainText(/gespeichert/i);
  const owner = await signInApi(process.env.E2E_LECTURER_EMAIL!);
  const other = await signInApi(process.env.E2E_OTHER_EMAIL!);
  const { data: own, error } = await owner.client.from('personal_events').select('*').eq('title', title);
  expect(error).toBeNull();
  expect(own).toHaveLength(1);
  const { data: stolen, error: stolenError } = await other.client.from('personal_events').select('*').eq('id', own![0].id);
  expect(stolenError).toBeNull();
  expect(stolen).toEqual([]);
  const { data: mutated, error: mutationError } = await other.client.from('personal_events').update({ title: 'forged' }).eq('id', own![0].id).select();
  expect(mutationError).toBeNull();
  expect(mutated).toEqual([]);
  await a11y(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow, `${testInfo.project.name} has no horizontal overflow`).toBe(false);
});

test('role changes and private profile reads fail through the real REST API', async () => {
  const { client, user } = await signInApi(process.env.E2E_LECTURER_EMAIL!);
  const other = await signInApi(process.env.E2E_OTHER_EMAIL!);
  const { error: escalationError } = await client.from('user_roles').insert({ user_id: user.id, role: 'admin' });
  expect(escalationError, 'Lecturer cannot grant own admin role').toBeTruthy();
  const { data: profile, error: profileError } = await client.from('profiles').select('*').eq('id', other.user.id);
  expect(profileError).toBeNull();
  expect(profile).toEqual([]);
});

test('language changes preserve input, themes render accessibly, offline mutations stay disabled', async ({ page, context }, testInfo) => {
  await login(page);
  await page.goto('/profile');
  const draft = `Ungespeicherter Sprachtest ${randomUUID().slice(0, 8)}`;
  await page.getByLabel('Über mich (Deutsch)', { exact: true }).fill(draft);
  await page.getByLabel('Sprache', { exact: true }).selectOption('en');
  await expect(page.getByLabel('About me (German)', { exact: true })).toHaveValue(draft);
  await page.getByLabel('Theme', { exact: true }).selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await a11y(page);
  await page.screenshot({ path: `docs/screenshots/${testInfo.project.name}-profile-dark-en.png`, fullPage: true });
  await page.getByLabel('Theme', { exact: true }).selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await a11y(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.getByLabel('Theme', { exact: true }).selectOption('system');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await context.setOffline(true);
  await expect(page.getByRole('status')).toContainText(/You are offline/);
  await expect(page.getByRole('button', { name: 'Save profile', exact: true })).toBeDisabled();
  await context.setOffline(false);
  await expect(page.getByRole('button', { name: 'Save profile', exact: true })).toBeEnabled();
});

/** Raises the real browser administration session to AAL2 with TOTP before privileged forms are used. */
async function adminSession(page: Page) {
  const statePath = '.local/e2e-admin-totp.json';
  const { client } = await signInApi(process.env.E2E_ADMIN_EMAIL!);
  const { data: factors, error } = await client.auth.mfa.listFactors();
  expect(error).toBeNull();
  let state: { factorId: string; secret: string } | null = readPrivateJson(statePath);
  if (!factors!.totp.some((factor) => factor.id === state?.factorId)) state = null;
  await login(page, process.env.E2E_ADMIN_EMAIL!);
  await page.goto('/security');
  if (!state) {
    expect(factors!.totp.filter((factor) => factor.status === 'verified'), 'Use a disposable local admin with no unknown MFA factor').toEqual([]);
    const responsePromise = page.waitForResponse((response) => response.url().endsWith('/auth/v1/factors') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Authenticator einrichten', exact: true }).click();
    const response = await responsePromise;
    const enrollment = await response.json();
    expect(enrollment.id).toBeTruthy();
    expect(enrollment.totp?.secret).toBeTruthy();
    state = { factorId: enrollment.id, secret: enrollment.totp.secret };
    writePrivateJson(statePath, state);
  }
  await page.getByLabel('Sechsstelliger Code', { exact: true }).fill(totp(state!.secret));
  await page.getByRole('button', { name: 'Code bestätigen', exact: true }).click();
  await expect(page.getByRole('status')).toContainText(/zwei Faktoren bestätigt/);
}

test('admin verifies a real TOTP factor and publishes a five-session job through the UI', async ({ page }, testInfo) => {
  await adminSession(page);
  await page.goto('/admin');
  const title = `QA Verwaltung ${testInfo.project.name} ${randomUUID().slice(0, 8)}`;
  await page.getByLabel('Titel', { exact: true }).fill(title);
  await page.getByLabel('Beschreibung', { exact: true }).fill('Fiktiver über die echte Adminoberfläche angelegter Testauftrag.');
  await page.getByLabel('Kunde', { exact: true }).fill('QA Beispielkunde');
  await page.getByLabel('Voller Auftragspreis je Einheit', { exact: true }).fill('450');
  await page.getByLabel('Voller Auftragspreis gesamt', { exact: true }).fill('2250');
  await page.getByLabel('Währung', { exact: true }).selectOption('EUR');
  await page.getByLabel('Einheit', { exact: true }).selectOption('per_day');
  await page.getByLabel('Konditionen', { exact: true }).fill('Fiktive lokale QA-Konditionen.');
  const starts = page.getByLabel(/^Beginn \d+$/);
  const ends = page.getByLabel(/^Ende \d+$/);
  await expect(starts).toHaveCount(5);
  for (let index = 0; index < 5; index++) {
    await starts.nth(index).fill(`2028-06-${String(index + 12).padStart(2, '0')}T09:00`);
    await ends.nth(index).fill(`2028-06-${String(index + 12).padStart(2, '0')}T15:00`);
  }
  await page.getByLabel('Sofort veröffentlichen', { exact: true }).check();
  await page.getByRole('button', { name: 'Stelle speichern', exact: true }).click();
  await expect(page.locator('.notice[role="status"]').filter({ hasText: /^Stelle gespeichert\.$/ })).toBeVisible();
  const { data: job, error: jobError } = await service().from('jobs').select('id,status,job_sessions(*)').eq('title', title).single();
  expect(jobError).toBeNull();
  expect(job!.status).toBe('published');
  expect(job!.job_sessions).toHaveLength(5);
  const email = `ui-invite-${randomUUID()}@example.invalid`;
  await page.getByLabel('E-Mail', { exact: true }).fill(email);
  await page.getByLabel('Anzeigename', { exact: true }).fill('Fiktive UI-QA-Lehrkraft');
  await page.getByRole('button', { name: 'Einladung senden', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Die Einladung wurde versandt' })).toBeVisible();
  const { data: invitedAccounts } = await service().auth.admin.listUsers({ perPage: 1000 });
  const invited = invitedAccounts!.users.find((user) => user.email === email);
  expect(invited).toBeTruthy();
  const { data: invitedRoles } = await service().from('user_roles').select('role').eq('user_id', invited!.id);
  expect(invitedRoles!.map((role) => role.role)).toEqual(['lecturer']);
  // Clear only this UUID email's disposable local reservation so repeated QA suites
  // do not consume the actor's five-invitations-per-15-minutes business quota.
  const cleanup = await service().from('invitation_requests').delete().eq('email', email);
  expect(cleanup.error).toBeNull();
  await a11y(page);
  await page.screenshot({ path: `docs/screenshots/${testInfo.project.name}-admin.png`, fullPage: true });
});

test('admin verifies self-selected expertise and suspends/reactivates a fictional lecturer with immediate RLS enforcement', async ({ page }, testInfo) => {
  const email = 'lecturer03@example.invalid';
  const actor = await signInApi(email);
  await login(page, email);
  await page.goto('/profile');
  const topic = page.getByRole('checkbox', { name: /Wireshark/ });
  if (await topic.isChecked()) {
    await topic.click();
    await expect(topic).not.toBeChecked();
  }
  await topic.click();
  await expect(topic).toBeChecked();
  const { data: topics } = await service().from('topics').select('id').eq('label_en', 'Wireshark').single();
  await expect.poll(async () => {
    const { data } = await actor.client.from('lecturer_topics').select('verified').eq('topic_id', topics!.id).single();
    return data?.verified;
  }).toBe(false);
  await page.getByRole('button', { name: 'Abmelden', exact: true }).click();
  await adminSession(page);
  await page.goto('/admin/people');
  await page.getByRole('searchbox', { name: 'Personen suchen', exact: true }).fill('Lea Sommer');
  await page.getByRole('button', { name: /Lea Sommer/ }).click();
  const review = page.getByRole('form', { name: 'Expertise prüfen: Wireshark', exact: true });
  await review.getByLabel('Gültig bis (UTC)', { exact: true }).fill('2029-12-31T23:59');
  await review.getByRole('button', { name: 'Expertise verifizieren', exact: true }).click();
  await expect(review.getByRole('status')).toContainText('Die Verifizierung wurde gespeichert.');
  const { data: verified, error } = await actor.client.from('lecturer_topics').select('*').eq('topic_id', topics!.id).single();
  expect(error).toBeNull();
  expect(verified!.verified).toBe(true);
  expect(new Date(verified!.valid_until).toISOString()).toBe('2029-12-31T23:59:00.000Z');
  await page.getByRole('button', { name: 'Zugang sperren', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Portalzugriff sperren?', exact: true });
  await confirm.getByRole('button', { name: 'Zugang sperren', exact: true }).click();
  await expect(confirm).not.toBeVisible();
  await expect.poll(async () => {
    const { data } = await actor.client.from('jobs').select('id');
    return data?.length;
  }).toBe(0);
  const forbidden = await actor.client.from('personal_events').insert({
    user_id: actor.user.id, title: 'Suspended QA mutation', starts_at: '2030-03-01T09:00:00Z', ends_at: '2030-03-01T10:00:00Z',
  });
  expect(forbidden.error).toBeTruthy();
  await page.getByRole('button', { name: 'Zugang aktivieren', exact: true }).click();
  const restore = page.getByRole('dialog', { name: 'Portalzugriff aktivieren?', exact: true });
  await restore.getByRole('button', { name: 'Zugang aktivieren', exact: true }).click();
  await expect(restore).not.toBeVisible();
  await expect.poll(async () => {
    const { data } = await actor.client.from('profiles').select('active').eq('id', actor.user.id).single();
    return data?.active;
  }).toBe(true);
  await a11y(page);
  await page.screenshot({ path: `docs/screenshots/${testInfo.project.name}-people.png`, fullPage: true });
});
