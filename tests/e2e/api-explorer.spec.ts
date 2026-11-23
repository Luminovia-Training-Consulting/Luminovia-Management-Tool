import { expect, type Page, test } from "@playwright/test";
import { actor, login } from "./helpers/accounts-support";

test.skip(
  process.env.PORTAL_TEST_MODE !== "1",
  "Use the isolated portal stack.",
);
test.describe.configure({ timeout: 60_000 });

/** Filter before selecting so Swagger renders the requested virtualized row. */
async function operation(page: Page, method: "get" | "post", path: string) {
  const search = page.getByRole("searchbox", {
    name: /^(Schnittstellen suchen|Search operations)$/,
  });
  await search.fill(`${method} ${path}`);
  await search.press("Enter");
  return page.locator(`.opblock-${method} .opblock-summary-control`).filter({
    has: page.locator(`[data-path="${path}"]`),
  });
}

async function openExplorer(page: Page) {
  await page.goto("/api/docs");
  // A cold browser has to load the lazy Swagger graph after the gated route
  // resolves. Allow for development compilation here and keep operation
  // assertions on their normal budget.
  await expect(
    page.getByRole("heading", {
      name: /^(API-Dokumentation|API documentation)$/,
    }),
  ).toBeVisible({ timeout: 40_000 });
}

test("a failed Swagger import leaves the portal usable and reload recovers", async ({
  page,
}) => {
  const account = await actor("Fictional API recovery lecturer", "lecturer");
  await login(page, account.email);
  const explorerModule = /\/portal-explorer(?:-[^/?]+)?\.(?:js|tsx)(?:\?.*)?$/;
  const abortedModule = page.waitForEvent("requestfailed", {
    predicate: (request) => explorerModule.test(request.url()),
  });
  await page.route(explorerModule, (route) => route.abort());

  await openExplorer(page);
  await abortedModule;
  await expect(page.getByRole("alert")).toContainText(
    "Die API-Dokumentation konnte nicht geladen werden.",
  );
  await expect(
    page.getByRole("link", { name: "OpenAPI JSON" }),
  ).toHaveAttribute("href", "/api/openapi.json");
  await expect(page.getByRole("link", { name: "Zum Portal" })).toHaveAttribute(
    "href",
    "/",
  );
  await expect(page.getByText("Unexpected Application Error!")).toHaveCount(0);

  await page.unroute(explorerModule);
  await page.getByRole("button", { name: "Seite neu laden" }).click();
  await expect(
    page.getByRole("searchbox", { name: "Schnittstellen suchen" }),
  ).toBeVisible({ timeout: 40_000 });
});

test("the API explorer executes a documented read only after authorization", async ({
  page,
  request,
}) => {
  const account = await actor("Fictional API explorer lecturer", "lecturer");
  const staticContract = await request.get("/api/openapi.json");
  expect(staticContract.ok()).toBe(true);
  expect(await staticContract.json()).toMatchObject({
    openapi: "3.1.0",
    paths: {
      "/functions/v1/accounts/v1/me": { get: {} },
      "/functions/v1/accounts/v1/deletions/confirm": { delete: {} },
      "/functions/v1/portal-api/v1/account_username": { get: {} },
      "/functions/v1/portal-api/v1/save_job_view": { put: {} },
      "/functions/v1/portal-api/v1/remove_job_view": { delete: {} },
      "/rest/v1/rpc/portal_access": {
        post: { operationId: "native_portal_access" },
      },
    },
  });

  await page.goto("/api/docs");
  await expect(page).toHaveURL(/\/login$/);
  await login(page, account.email);
  await openExplorer(page);
  const accountPath = "/functions/v1/accounts/v1/me";
  await (await operation(page, "get", accountPath)).click();
  await expect(
    page.getByRole("button", { name: "Try it out", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Mit meinem Konto autorisieren" })
    .click();
  await (await operation(page, "get", accountPath)).click();
  await page.getByRole("button", { name: "Try it out", exact: true }).click();
  const response = page.waitForResponse(
    (item) =>
      item.request().method() === "GET" &&
      new URL(item.url()).pathname.endsWith("/functions/v1/accounts/v1/me"),
  );
  await page.getByRole("button", { name: "Execute", exact: true }).click();
  expect((await response).status()).toBe(200);
  await page.getByRole("button", { name: "Anfragen deaktivieren" }).click();
  await expect(
    page.getByRole("button", { name: "Execute", exact: true }),
  ).toHaveCount(0);

  // Follow a generated operation to the existing authenticated RPC through the
  // same browser interceptor. The disposable lecturer can read its access flag.
  await page
    .getByRole("button", { name: "Mit meinem Konto autorisieren" })
    .click();
  await (await operation(page, "post", "/rest/v1/rpc/portal_access")).click();
  await page.getByRole("button", { name: "Try it out", exact: true }).click();
  const nativeRead = page.waitForResponse(
    (item) =>
      item.request().method() === "POST" &&
      new URL(item.url()).pathname.endsWith("/rpc/portal_access"),
  );
  await page.getByRole("button", { name: "Execute", exact: true }).click();
  const nativeResult = await nativeRead;
  expect(nativeResult.status()).toBe(200);
  expect(await nativeResult.json()).toBe(true);
});

test("an authenticated participant can run an own-account RPC through the API explorer", async ({
  page,
}) => {
  const learner = await actor(
    "Fictional API explorer participant",
    "participant",
  );
  await login(page, learner.email, /\/learning$/);
  await openExplorer(page);
  await page
    .getByRole("button", { name: "Mit meinem Konto autorisieren" })
    .click();
  await (
    await operation(page, "post", "/rest/v1/rpc/account_username")
  ).click();
  await page.getByRole("button", { name: "Try it out", exact: true }).click();
  const response = page.waitForResponse(
    (item) =>
      item.request().method() === "POST" &&
      new URL(item.url()).pathname.endsWith("/rpc/account_username"),
  );
  await page.getByRole("button", { name: "Execute", exact: true }).click();
  const result = await response;
  expect(result.status()).toBe(200);
  expect(await result.json()).toEqual({ username: null, version: 0 });

  const alias = "/functions/v1/portal-api/v1/account_username";
  await (await operation(page, "get", alias)).click();
  await page.getByRole("button", { name: "Try it out", exact: true }).click();
  const throughGateway = page.waitForResponse(
    (item) =>
      item.request().method() === "GET" &&
      new URL(item.url()).pathname.endsWith(alias),
  );
  await page.getByRole("button", { name: "Execute", exact: true }).click();
  const get = await throughGateway;
  expect(get.status()).toBe(200);
  expect(await get.json()).toEqual({ username: null, version: 0 });
});

test("the English dark API explorer preserves finance permissions during keyboard execution", async ({
  page,
  request,
}) => {
  const account = await actor("Fictional API finance lecturer", "lecturer");
  const financePath = "/rest/v1/rpc/commission_report";
  const contractResponse = await request.get("/api/openapi.json");
  expect(contractResponse.ok()).toBe(true);
  const contract = await contractResponse.json();
  expect(
    contract.paths[financePath].post.responses["403"].description,
  ).toContain("42501");

  await login(page, account.email);
  await page.goto("/settings");
  const preferences = page.locator(".settings-section .preferences");
  await preferences.getByLabel("Sprache", { exact: true }).selectOption("en");
  await preferences.getByLabel("Theme", { exact: true }).selectOption("dark");
  await openExplorer(page);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(
    page.getByText("Requests are disabled.", { exact: true }),
  ).toBeVisible();
  const authorize = page.getByRole("button", {
    name: "Authorize with my account",
  });
  await authorize.press("Enter");

  await (await operation(page, "post", financePath)).press("Enter");
  const expanded = page.locator(".opblock.is-open");
  await expanded
    .getByRole("button", { name: "Try it out", exact: true })
    .press("Enter");
  await expanded.locator("textarea").fill("{}");
  const response = page.waitForResponse(
    (item) =>
      item.request().method() === "POST" &&
      new URL(item.url()).pathname.endsWith(financePath),
  );
  await expanded
    .getByRole("button", { name: "Execute", exact: true })
    .press("Enter");
  const denied = await response;
  expect(denied.status()).toBe(403);
  expect(await denied.json()).toMatchObject({ code: "42501" });
  await expect(
    expanded.locator(".live-responses-table tbody .response-col_status"),
  ).toContainText("403");
  const curlExample = expanded.locator(".curl-command");
  await expect(curlExample).toContainText(financePath);
  await expect(curlExample).not.toContainText(/authorization|apikey/i);

  await page.getByRole("button", { name: "Disable requests" }).press("Enter");
  await expect(
    page.getByText("Requests are disabled.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Execute", exact: true }),
  ).toHaveCount(0);
});
