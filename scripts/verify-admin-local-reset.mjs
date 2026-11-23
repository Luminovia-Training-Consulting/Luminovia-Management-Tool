/** Destructive end-to-end acceptance. Run only inside an owned disposable portal instance. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { chromium, expect } from "@playwright/test";
import { localResetTarget, readLocalResetReceipt } from "./local-reset.mjs";
import { readEnvFile, root } from "./runtime-lib.mjs";

const config = localResetTarget(root);
assert.match(config.id, /^luminovia-portal-test-[a-f0-9]{8}$/);
assert.equal(process.env.PORTAL_TEST_MODE, "1");
assert.equal(process.argv[2], config.id);
const dockerNames = (resource) =>
  execFileSync(
    "docker",
    [
      resource,
      "ls",
      ...(resource === "container" ? ["--all"] : []),
      "--format",
      resource === "container" ? "{{.Names}}" : "{{.Name}}",
    ],
    { encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter((name) => name.endsWith(`_${config.id}`));
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
for (const prefix of ["supabase_db", "supabase_storage", "portal_clamav"])
  assert.ok(
    dockerNames("volume").includes(`${prefix}_${config.id}`),
    `Expected seeded ${prefix} volume`,
  );

assert.ok(
  dockerNames("container").includes(`supabase_inbucket_${config.id}`),
  "Expected a running local mail fixture",
);

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
  await page.goto(config.site + "/admin");
  await page.getByRole("link", { name: /^(Vollreset|Full reset)$/ }).click();
  await expect(page).toHaveURL(/\/admin\/reset$/);
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
    page.getByRole("status").filter({
      hasText: /Der Reset wurde angefordert|Reset requested/,
    }),
  ).toBeVisible();
  await expect
    .poll(() => readLocalResetReceipt(root, config.id), {
      timeout: 180000,
    })
    .toBe("complete");
  for (const resource of ["container", "volume", "network"])
    assert.deepEqual(
      dockerNames(resource),
      [],
      `The reset left an owned ${resource} behind.`,
    );
  for (const file of [
    ".env.local",
    ".env.test.local",
    ".local/runtime.json",
    ".local/bootstrap.json",
    ".local/ACCOUNTS.txt",
  ])
    assert.ok(!existsSync(join(root, file)), `The reset left ${file} behind.`);
  await assert.rejects(
    fetch(config.site, { signal: AbortSignal.timeout(2000) }),
  );
  await assert.rejects(
    fetch(before.SUPABASE_URL, { signal: AbortSignal.timeout(2000) }),
  );
  await assert.rejects(
    fetch(`http://127.0.0.1:${config.mail}`, {
      signal: AbortSignal.timeout(2000),
    }),
  );
  console.log(
    "PASS Browser reset erased the seeded database, Auth and Storage volumes and left the portal offline.",
  );
} finally {
  await browser.close();
}
