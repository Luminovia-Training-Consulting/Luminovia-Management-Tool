/**
 * Gemeinsame echte Konto-/MFA-Fixtures und sichtbare Loginaktionen der Browserprüfungen.
 * Jeder API-Client ist auf das kanonische lokale Zufallstestprojekt begrenzt; der Aufrufer besitzt sein Cleanup.
 */
import { expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
/** Erlaubt nur das kanonische lokale Zufallstestprojekt, bevor ein Fixtureclient mit den übergebenen Rechten entsteht. */
export function api(key: string) {
  if (process.env.PORTAL_TEST_MODE !== "1")
    throw new Error("Only isolated account fixtures");
  const config = readFileSync("supabase/config.toml", "utf8");
  if (!/^project_id\s*=\s*"luminovia-portal-test-[a-f0-9]+"/m.test(config))
    throw new Error("Only the canonical disposable project is permitted");
  const url = process.env.SUPABASE_URL!;
  if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname))
    throw new Error("Only loopback profile fixtures");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
/** Wertet den tatsächlichen SDK-Erfolg aus und gibt erst danach dessen Daten zurück. */
export async function checked<T>(
  request: PromiseLike<{ data: T; error: unknown }>,
) {
  const result = await request;
  expect(result.error).toBeNull();
  return result.data;
}
/** Erstellt eine fiktive Auth-Identität samt Profil und Fixture-Rolle; der aufrufende Test besitzt ihr Cleanup. */
export async function actor(name: string, role: string) {
  const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const email = `people-ui-${randomUUID()}@example.invalid`;
  const data = await checked(
    service.auth.admin.createUser({
      email,
      password: process.env.E2E_PASSWORD!,
      email_confirm: true,
    }),
  );
  const id = data.user!.id;
  await checked(
    service.from("profiles").update({ display_name: name }).eq("id", id),
  );
  await checked(service.from("user_roles").insert({ user_id: id, role }));
  return { id, email, name };
}
/** Meldet die konkrete Testperson über die sichtbaren Anmeldefelder an und wartet auf die bestätigte Navigation. */
export async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-Mail", { exact: true }).fill(email);
  await page
    .getByLabel("Passwort", { exact: true })
    .fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
}
/** Berechnet den aktuellen TOTP der Fixture für die echte MFA-Challenge. */
export function code(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567",
    bits = [...secret.replace(/=+$/, "")]
      .map((c) => alphabet.indexOf(c).toString(2).padStart(5, "0"))
      .join(""),
    key = Buffer.from(bits.match(/.{8}/g)!.map((x) => Number.parseInt(x, 2))),
    counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac("sha1", key).update(counter).digest();
  return ((digest.readUInt32BE(digest.at(-1)! & 15) & 0x7fffffff) % 1000000)
    .toString()
    .padStart(6, "0");
}
/** Kombiniert sichtbare Anmeldung und echte MFA-Challenge für berechtigte Verwaltungsabläufe. */
export async function adminLogin(page: Page, user: { email: string }) {
  const client = api(process.env.SUPABASE_ANON_KEY!);
  await checked(
    client.auth.signInWithPassword({
      email: user.email,
      password: process.env.E2E_PASSWORD!,
    }),
  );
  const factor = await checked(
    client.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "People UI QA",
    }),
  );
  await checked(
    client.auth.mfa.challengeAndVerify({
      factorId: factor.id,
      code: code(factor.totp.secret),
    }),
  );
  await login(page, user.email);
  await page.goto("/security");
  await page
    .getByLabel("Sechsstelliger Code", { exact: true })
    .fill(code(factor.totp.secret));
  await page
    .getByRole("button", { name: "Code bestätigen", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("zwei Faktoren");
}
