/** Destructive end-to-end acceptance. Run only inside an owned disposable portal instance. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { chromium, expect } from "@playwright/test";
import { localResetTarget } from "./local-reset.mjs";
import { readEnvFile, root } from "./runtime-lib.mjs";

const config = localResetTarget(root);
assert.match(config.id, /^luminovia-portal-test-[a-f0-9]{8}$/);
assert.equal(process.env.PORTAL_TEST_MODE, "1");
assert.equal(process.argv[2], config.id);
const before = readEnvFile(join(root, ".env.test.local"));
const service = (env) =>
  createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
const client = service(before);
const marker = randomUUID();
const markerEmail = `reset-${marker}@example.invalid`;
const user = await client.auth.admin.createUser({
  email: markerEmail,
  password: before.E2E_PASSWORD,
  email_confirm: true,
});
assert.ok(
  user.data.user && !user.error,
  "Fictional user must exist before reset",
);
const markerId = user.data.user.id;
const org = await client
  .from("organisations")
  .insert({ id: marker, name: "Fictional reset marker" });
assert.equal(org.error, null, "Fictional organisation must exist before reset");
const upload = await client.storage
  .from("portal-clean")
  .upload(
    `reset-${marker}.pdf`,
    Buffer.from("%PDF-1.4\nFictional reset marker\n"),
    { contentType: "application/pdf" },
  );
assert.equal(upload.error, null, "Fictional file must exist before reset");

const browser = await chromium.launch();
const endpoint = "/__portal/local-reset";
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  async function signIn(email) {
    await page.goto(config.site + "/login");
    await page
      .getByLabel(/^(Benutzername oder E-Mail|Username or email)$/)
      .fill(email);
    await page
      .getByLabel(/^(Passwort|Password)$/, { exact: true })
      .fill(before.E2E_PASSWORD);
    await page.getByRole("button", { name: /^(Anmelden|Sign in)$/ }).click();
    await page.waitForURL((url) => url.pathname !== "/login");
  }
  await signIn("lecturer01@example.invalid");
  await page.goto(config.site + "/admin/reset");
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: /active administrators|aktive Administratoren/ }),
  ).toBeVisible();
  await page.context().clearCookies();
  await page.evaluate(() => localStorage.clear());
  await signIn("admin@example.invalid");
  await page.goto(config.site + "/admin/reset");
  await expect(page.getByText(config.id, { exact: true })).toBeVisible();
  const button = page.getByRole("button", {
    name: /Alle Daten dieser Installation löschen|Delete all data in this installation/,
  });
  await expect(button).toBeDisabled();
  await page
    .getByLabel(/Zur Bestätigung DELETE eingeben|Type DELETE to confirm/)
    .fill("delete");
  const password = page.getByLabel(/^(Aktuelles Passwort|Current password)$/);
  await password.fill(before.E2E_PASSWORD);
  await expect(button).toBeDisabled();
  await page
    .getByLabel(/Zur Bestätigung DELETE eingeben|Type DELETE to confirm/)
    .fill("DELETE");
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(button).toBeEnabled();
  await password.fill("deliberately-incorrect-password");
  const denied = page.waitForResponse(
    (response) =>
      response.url().endsWith(endpoint) &&
      response.request().method() === "POST",
  );
  await button.click();
  assert.equal((await denied).status(), 403);
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: /Bestätigung abgelehnt|Confirmation denied/ }),
  ).toBeVisible();
  await password.fill(before.E2E_PASSWORD);
  const accepted = page.waitForResponse(
    (response) =>
      response.url().endsWith(endpoint) &&
      response.request().method() === "POST",
  );
  await button.click();
  assert.equal((await accepted).status(), 202);
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: /Der Reset ist abgeschlossen|Reset is complete/ }),
  ).toBeVisible({ timeout: 360000 });

  const fresh = readEnvFile(join(root, ".env.test.local"));
  const replacement = service(fresh);
  assert.ok(
    (await replacement.auth.admin.getUserById(markerId)).error,
    "Old Auth account survived",
  );
  const organisations = await replacement
    .from("organisations")
    .select("id")
    .eq("id", marker);
  assert.equal(organisations.error, null);
  assert.deepEqual(organisations.data, [], "Old organisation survived");
  const files = await replacement.storage
    .from("portal-clean")
    .list("", { search: marker });
  assert.equal(files.error, null);
  assert.deepEqual(files.data, [], "Old uploaded file survived");
  const auth = createClient(fresh.SUPABASE_URL, fresh.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data } = await auth.auth.signInWithPassword({
    email: "admin@example.invalid",
    password: fresh.E2E_PASSWORD,
  });
  assert.ok(data.user, "Fresh admin could not sign in");
  console.log(
    "PASS Browser reset removed the original Auth account, organisation and uploaded file; fresh administrator login succeeded.",
  );
} finally {
  await browser.close();
}
