/**
 * Shared real account/MFA fixtures and visible browser sign-in actions.
 * API clients are restricted to the canonical local random test project; callers own fixture cleanup.
 */
import { expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
/** Requires the canonical local random test project before creating a client with the supplied privileges. */
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
/** Requires actual SDK success before returning the response data. */
export async function checked<T>(
  request: PromiseLike<{ data: T; error: unknown }>,
) {
  const result = await request;
  expect(result.error).toBeNull();
  return result.data;
}
/** Creates a fictional Auth identity, profile and fixture role; the calling test owns cleanup. */
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
/** Signs this test actor in through the visible form and waits for confirmed navigation. */
export async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-Mail", { exact: true }).fill(email);
  await page
    .getByLabel("Passwort", { exact: true })
    .fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
}
/** Computes the fixture's current TOTP for the real MFA challenge. */
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
/** Combines visible sign-in and a real MFA challenge for authorised management workflows. */
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
