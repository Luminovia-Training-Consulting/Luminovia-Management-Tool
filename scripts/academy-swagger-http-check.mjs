/** Signed-in Swagger and current permission checks on a disposable Academy. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { expect } from "@playwright/test";
import { chromium, devices } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { preview } from "vite";
import { z } from "zod";
import {
  cleanEnvironment,
  command,
  projectConfig,
  root,
} from "./runtime-lib.mjs";
import { quoteSql as q } from "./testing/database.mjs";

const [edition] = process.argv.slice(2);
assert.ok(["customer-self-hosted", "customer-managed"].includes(edition));
assert.equal(process.env.PORTAL_TEST_MODE, "1", "Disposable rehearsal only.");
const { id: project, api, site } = projectConfig(process.cwd());
assert.match(project, /^luminovia-portal-test-[a-f0-9]{8}$/);
assert.match(site, /^http:\/\/127\.0\.0\.1:\d+$/);
const backend = `http://127.0.0.1:${api}`;
const { API_URL, ANON_KEY, SERVICE_ROLE_KEY } = JSON.parse(
  execFileSync("./node_modules/.bin/supabase", ["status", "--output", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }),
);
assert.equal(API_URL, backend);
const headers = { apikey: ANON_KEY, Origin: site };
const own = "/rest/v1/rpc/academy_personal_settings";
const ownAlias = "/functions/v1/portal-api/v1/academy_personal_settings";
const audit = "/rest/v1/rpc/admin_audit_events";
const request = (path, { method = "GET", token, body } = {}) =>
  fetch(backend + path, {
    method,
    redirect: "error",
    signal: AbortSignal.timeout(12_000),
    headers: {
      ...headers,
      ...(token && { Authorization: `Bearer ${token}` }),
      ...(body && { "Content-Type": "application/json" }),
    },
    ...(body && { body: JSON.stringify(body) }),
  });
const checked = async (response, status, label) => {
  assert.equal(response.status, status, label);
  return response.json();
};
const capabilities = await checked(
  await request("/rest/v1/rpc/installation_capabilities"),
  200,
  "Public Academy identity",
);
assert.equal(capabilities.edition, edition);
assert.equal(capabilities.licence_status, "active");
const installationId = z.uuid().parse(capabilities.installation_id);

const service = createClient(backend, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const sql = (input) =>
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      `supabase_db_${project}`,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-XqAt",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { input, stdio: ["pipe", "pipe", "pipe"], encoding: "utf8" },
  ).trim();
/** Keep transport checks and browser locale cases on different test identities.
 * This preserves the production login budget while exercising the actual account locale. */
async function createParticipant(label) {
  const email = `fictional-swagger-${label}-${randomUUID()}@example.invalid`;
  const password = `F!9a-${randomUUID()}`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  assert.equal(error, null, "Create a disposable account");
  const id = data.user.id;
  sql(
    `insert into public.user_roles(user_id,role) values (${q(id)},'participant')`,
  );
  return { email, password, id };
}

const {
  email,
  password,
  id: participant,
} = await createParticipant("transport");
const alias = `swagger-${randomUUID().slice(0, 8)}`;
const signIn = (identifier) =>
  request("/functions/v1/human-login", {
    method: "POST",
    body: { identifier, password },
  });
const initial = await checked(await signIn(email), 200, "Email sign-in");
await checked(
  await request("/rest/v1/rpc/academy_save_display_name", {
    method: "POST",
    token: initial.access_token,
    body: { p_display_name: "Fictional Swagger lecturer" },
  }),
  200,
  "Save own display name",
);
assert.equal((await signIn(alias.toUpperCase())).status, 401);
const aliased = await checked(
  await signIn(email.toUpperCase()),
  200,
  "Case-insensitive email login",
);
const nativeUser = await checked(
  await request("/auth/v1/user", { token: aliased.access_token }),
  200,
  "Native Auth confirms identity",
);
assert.equal(nativeUser.id, participant);

const directory = join(process.cwd(), "academy-swagger");
mkdirSync(directory, { mode: 0o700 });
for (const icon of [
  "icon-192.png",
  "icon-512.png",
  "maskable-512.png",
  "apple-touch-icon.png",
])
  cpSync(join(root, "public/icons", icon), join(directory, icon));
const name = "Fictional Academy";
const brandFile = join(directory, "brand.json");
writeFileSync(
  brandFile,
  JSON.stringify({
    edition,
    installationId,
    name,
    shortName: "Academy",
    defaultLanguage: "de",
    defaultTheme: "light",
    themeColor: "#172b4b",
    files: {
      logo: "icon-192.png",
      icon192: "icon-192.png",
      icon512: "icon-512.png",
      maskable512: "maskable-512.png",
      appleTouchIcon: "apple-touch-icon.png",
    },
  }),
  { mode: 0o600 },
);
const outDir = join(directory, "dist");
await command(
  join(root, "node_modules/.bin/vite"),
  ["build", "--outDir", outDir],
  {
    cwd: root,
    quiet: true,
    env: cleanEnvironment({
      PORTAL_ACADEMY_BRAND_FILE: brandFile,
      VITE_SUPABASE_URL: backend,
      VITE_SUPABASE_PUBLISHABLE_KEY: ANON_KEY,
    }),
  },
);
const document = JSON.parse(
  readFileSync(join(outDir, "api/openapi.json"), "utf8"),
);
assert.equal(document.info.title, name + " API");
const openApiSchema = z.fromJSONSchema(
  document.paths[own].post.responses["200"].content["application/json"].schema,
);
assert.ok(document.paths[audit].post.responses["403"]);
const direct = await checked(
  await request(own, {
    method: "POST",
    token: aliased.access_token,
    body: {},
  }),
  200,
  "Native scoped settings",
);
openApiSchema.parse(direct);
const gateway = await checked(
  await request(ownAlias, { token: aliased.access_token }),
  200,
  "Exact settings through HTTP alias",
);
assert.deepEqual(gateway, direct);

const server = await preview({
  configFile: false,
  build: { outDir },
  preview: {
    host: "127.0.0.1",
    port: Number(new URL(site).port),
    strictPort: true,
  },
});
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const browserUsers = {
    de: await createParticipant("de"),
    en: await createParticipant("en"),
  };
  for (const profile of [
    { name: "desktop", use: { viewport: { width: 1280, height: 900 } } },
    { name: "mobile", use: devices["Pixel 7"] },
  ]) {
    for (const language of ["de", "en"]) {
      for (const theme of ["light", "dark"]) {
        const actor = browserUsers[language];
        // Match the saved account preferences to the browser setup so the
        // post-login hydration cannot switch the test to another locale.
        sql(`update public.profiles set locale=${q(language)} where id=${q(actor.id)};
          insert into private.account_ui_preferences(user_id,theme,version)
          values (${q(actor.id)},${q(theme)},1)
          on conflict (user_id) do update set theme=excluded.theme,
            version=private.account_ui_preferences.version+1;`);
        const context = await browser.newContext({
          ...profile.use,
          baseURL: site,
        });
        try {
          await context.addInitScript(
            ({ language, theme }) => {
              localStorage.setItem("luminovia.language", language);
              localStorage.setItem("luminovia.theme", theme);
            },
            { language, theme },
          );
          const page = await context.newPage();
          const entry = theme === "dark" ? "/api/swagger" : "/api/docs";
          await page.goto(entry);
          await expect(page).toHaveURL(/\/login$/, { timeout: 15_000 });
          await page
            .locator("#email")
            .fill(language === "de" ? actor.email.toUpperCase() : actor.email);
          await page.locator("#password").fill(actor.password);
          await page.locator("form button[type=submit]").press("Enter");
          await expect(page).toHaveURL(new RegExp(entry + "$"), {
            timeout: 25_000,
          });
          if (entry.endsWith("/swagger"))
            await page.locator('a[href="/api/docs"]').press("Enter");
          const search = page.getByRole("searchbox", {
            name:
              language === "de" ? "Schnittstellen suchen" : "Search operations",
          });
          await expect(search).toBeVisible({ timeout: 25_000 });
          await expect(page.locator("html")).toHaveAttribute("lang", language);
          await expect(page.locator("html")).toHaveAttribute(
            "data-theme",
            theme,
          );
          const authorize =
            language === "de"
              ? "Mit meinem Konto autorisieren"
              : "Authorize with my account";
          await page.getByRole("button", { name: authorize }).press("Enter");
          for (const [path, status] of [
            [own, 200],
            [audit, 403],
          ]) {
            await search.fill(`post ${path}`);
            await search.press("Enter");
            await page
              .locator(".opblock-post .opblock-summary-control")
              .filter({
                has: page.locator(`[data-path="${path}"]`),
              })
              .press("Enter");
            const expanded = page.locator(".opblock.is-open");
            await expanded
              .getByRole("button", { name: "Try it out", exact: true })
              .press("Enter");
            await expanded.locator("textarea").fill("{}");
            const observed = page.waitForResponse(
              (response) =>
                response.url() === backend + path &&
                response.request().method() === "POST",
            );
            await expanded
              .getByRole("button", { name: "Execute", exact: true })
              .press("Enter");
            const result = await observed;
            assert.equal(result.status(), status, path);
            const json = await result.json();
            if (status === 200) openApiSchema.parse(json);
            else assert.equal(json.code, "42501");
            await expect(expanded.locator(".curl-command")).not.toContainText(
              /authorization|apikey/i,
            );
          }
          const disable =
            language === "de" ? "Anfragen deaktivieren" : "Disable requests";
          await page.getByRole("button", { name: disable }).press("Enter");
          await expect(
            page.getByRole("button", { name: "Execute", exact: true }),
          ).toHaveCount(0);
          await page.getByRole("link", { name: "Swagger UI" }).click();
          await expect(
            page.getByRole("heading", { name: "Swagger UI" }),
          ).toBeVisible();
          await expect(
            page.locator('a[href="/api/workflows.json"]'),
          ).toBeVisible();
          if (profile.name === "mobile")
            await page.setViewportSize({ width: 320, height: 700 });
          assert.ok(
            await page.evaluate(
              () =>
                document.documentElement.scrollWidth <= globalThis.innerWidth,
            ),
          );
          const manifest = await (
            await context.request.get("/manifest.webmanifest")
          ).json();
          assert.equal(manifest.name, name);
        } catch (error) {
          throw new Error(
            `Academy browser case failed for ${profile.name}/${language}/${theme}`,
            { cause: error },
          );
        } finally {
          await context.close();
        }
      }
    }
  }

  const expiring = await checked(
    await signIn(email),
    200,
    "Issue a short-lived native token",
  );
  const { exp } = JSON.parse(
    Buffer.from(expiring.access_token.split(".")[1], "base64url").toString(
      "utf8",
    ),
  );
  assert.ok(
    exp - Date.now() / 1000 <= 35,
    "The isolated token must have a short configured TTL",
  );
  await checked(
    await request(ownAlias, { token: expiring.access_token }),
    200,
    "Access before expiry",
  );
  const deadline = Date.now() + 70_000;
  while (true) {
    const after = await request(ownAlias, { token: expiring.access_token });
    await after.body?.cancel();
    if (after.status === 401) {
      assert.ok(Date.now() / 1000 >= exp);
      break;
    }
    assert.equal(after.status, 200);
    assert.ok(Date.now() < deadline, "Expired access must be denied");
    await delay(1000);
  }
  const fresh = await checked(
    await signIn(email),
    200,
    "Issue a fresh native token",
  );
  await checked(
    await request(ownAlias, { token: fresh.access_token }),
    200,
    "Fresh token remains valid",
  );
  const currentToken = fresh.access_token;
  const callerAudit = () =>
    request(audit, { method: "POST", token: currentToken, body: {} });
  assert.equal(
    (await callerAudit()).status,
    403,
    "Participant cannot read audit",
  );
  sql(
    `insert into public.user_roles(user_id,role) values (${q(participant)},'admin')`,
  );
  assert.equal(
    (await callerAudit()).status,
    200,
    "Current role grants authority on the same token",
  );
  sql(
    `delete from public.user_roles where user_id=${q(participant)} and role='admin'`,
  );
  assert.equal(
    (await callerAudit()).status,
    403,
    "Revocation applies to the same token",
  );
  sql(`update public.profiles set active=false where id=${q(participant)}`);
  assert.equal(
    (await request(ownAlias, { token: currentToken })).status,
    403,
    "Suspension denies an existing session",
  );
  console.log(
    JSON.stringify({
      edition,
      openapi: document.info.version,
      browser_cases: 8,
      checks: [
        "sign_in_email_reject_alias",
        "native_alias_parity",
        "swagger_allow_and_deny",
        "theme_locale_keyboard",
        "branded_manifest",
        "native_token_expiry",
        "current_role_grant_and_revocation",
        "suspension_of_existing_session",
      ],
    }),
  );
} finally {
  await browser?.close();
  server.httpServer.close();
  if (server.httpServer.listening) await once(server.httpServer, "close");
}
