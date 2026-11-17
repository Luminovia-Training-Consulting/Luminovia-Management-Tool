/**
 * Shared password-only account fixtures and visible browser sign-in actions.
 * API clients are restricted to the canonical local random test project; callers own fixture cleanup.
 */
import { expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
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
/** SDK success/error unions must be inferred together, including nullable data. */
type SdkResponse = { data: unknown; error: unknown };
/** Require non-null data only for reads/Auth operations that promise a value. */
export function checked<Response extends SdkResponse>(
  request: PromiseLike<Response>,
  options: { requireData: true },
): Promise<NonNullable<Response["data"]>>;
/** Successful PostgREST writes may legitimately return null with no error. */
export function checked<Response extends SdkResponse>(
  request: PromiseLike<Response>,
): Promise<Response["data"]>;
/** Bound failure text to the fixture contract; never print SDK/token responses. */
export async function checked<Response extends SdkResponse>(
  request: PromiseLike<Response>,
  options?: { requireData: true },
): Promise<Response["data"]> {
  let result: Response;
  try {
    result = await request;
  } catch {
    throw new Error("Fictional fixture request was not confirmed");
  }
  if (result.error !== null)
    throw new Error("Fictional fixture request was not confirmed");
  if (options?.requireData && result.data == null)
    throw new Error("Fictional fixture response data was not confirmed");
  return result.data;
}
/** Confirms native Auth uses password-only AAL1 and reports no enrolled factors. */
export async function assertPasswordOnly(client: ReturnType<typeof api>) {
  const assurance = await checked(
    client.auth.mfa.getAuthenticatorAssuranceLevel(),
    { requireData: true },
  );
  expect(assurance.currentLevel).toBe("aal1");
  const factors = await checked(client.auth.mfa.listFactors(), {
    requireData: true,
  });
  expect(factors).toEqual({
    all: [],
    totp: [],
    phone: [],
    webauthn: [],
    recovery_code: [],
  });
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
    { requireData: true },
  );
  if (!data.user) throw new Error("Fictional Auth identity was not confirmed");
  const id = data.user.id;
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
/** Signs in through the visible password form; server permissions authorize management workflows. */
export async function adminLogin(page: Page, user: { email: string }) {
  await login(page, user.email);
}
