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
      "/functions/v1/portal-api/v1/ui_preferences": { get: {} },
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

test("Swagger and OpenAPI links remain usable while browsing and returning to the portal", async ({
  page,
}) => {
  const account = await actor(
    "Fictional Swagger navigation lecturer",
    "lecturer",
  );
  await login(page, account.email);
  await openExplorer(page);
  await page.getByRole("link", { name: "Swagger UI", exact: true }).click();
  await expect(page).toHaveURL(/\/api\/swagger$/);
  await expect(
    page.getByRole("heading", { name: "Swagger UI", exact: true }),
  ).toBeVisible();
  const swagger = page.locator(".swagger-ui");
  await expect(swagger.locator(".opblock-tag").first()).toBeVisible();
  const operations = await swagger.locator(".opblock").evaluateAll(
    (rows) =>
      new Set(
        rows.map((row) => {
          const method = row.querySelector(
            ".opblock-summary-method",
          )?.textContent;
          const path = row
            .querySelector("[data-path]")
            ?.getAttribute("data-path");
          return `${method} ${path}`;
        }),
      ).size,
  );
  expect(operations).toBeGreaterThan(0);
  expect(operations).toBeLessThanOrEqual(24);
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "OpenAPI JSON" }).click();
  expect((await download).suggestedFilename()).toBe("openapi.json");

  const methods = page.getByRole("group", { name: "HTTP-Methoden" });
  const reads = methods.getByRole("button", { name: /^GET [1-9]/ });
  await reads.focus();
  await reads.press("Enter");
  await expect(reads).toHaveAttribute("aria-pressed", "true");
  await expect(swagger.locator(".opblock-get").first()).toBeVisible();
  await expect(
    swagger.locator(
      ".opblock-post, .opblock-put, .opblock-patch, .opblock-delete",
    ),
  ).toHaveCount(0);

  const search = page.getByRole("searchbox", { name: "Schnittstellen suchen" });
  await search.fill("post /rest/v1/rpc/portal_access");
  await search.press("Enter");
  await swagger
    .locator(".opblock-summary-control")
    .filter({
      has: page.locator('[data-path="/rest/v1/rpc/portal_access"]'),
    })
    .click();
  await expect(
    page.getByRole("button", { name: "Try it out", exact: true }),
  ).toHaveCount(0);

  await page.goBack();
  await expect(page).toHaveURL(/\/api\/docs$/);
  await page
    .getByRole("button", { name: "Mit meinem Konto autorisieren" })
    .click();
  await expect(
    page.getByRole("button", { name: "Anfragen deaktivieren" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Swagger UI", exact: true }).click();
  await page.getByRole("link", { name: "Zum Portal" }).click();
  await expect(page).toHaveURL(/\/$/);
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
  await (await operation(page, "post", "/rest/v1/rpc/ui_preferences")).click();
  await page.getByRole("button", { name: "Try it out", exact: true }).click();
  const response = page.waitForResponse(
    (item) =>
      item.request().method() === "POST" &&
      new URL(item.url()).pathname.endsWith("/rpc/ui_preferences"),
  );
  await page.getByRole("button", { name: "Execute", exact: true }).click();
  const result = await response;
  expect(result.status()).toBe(200);
  expect(await result.json()).toMatchObject({
    theme: expect.any(String),
    language: expect.any(String),
  });

  const alias = "/functions/v1/portal-api/v1/ui_preferences";
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
  expect(await get.json()).toMatchObject({
    theme: expect.any(String),
    language: expect.any(String),
  });
});

const explorerCopy = {
  de: {
    disabled: "Anfragen sind deaktiviert.",
    authorize: "Mit meinem Konto autorisieren",
    disable: "Anfragen deaktivieren",
  },
  en: {
    disabled: "Requests are disabled.",
    authorize: "Authorize with my account",
    disable: "Disable requests",
  },
} as const;

for (const [language, theme] of [
  ["de", "light"],
  ["de", "dark"],
  ["en", "light"],
  ["en", "dark"],
] as const) {
  const copy = explorerCopy[language];
  test(`the ${language}/${theme} API explorer preserves finance permissions during keyboard execution`, async ({
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
    await preferences.getByLabel("Sprache", { exact: true }).selectOption(language);
    await preferences.getByLabel(language === "de" ? "Farbschema" : "Theme", { exact: true }).selectOption(theme);
    await openExplorer(page);
    await expect(page.locator("html")).toHaveAttribute("lang", language);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(
      page.getByText(copy.disabled, { exact: true }),
    ).toBeVisible();
    const authorize = page.getByRole("button", {
      name: copy.authorize,
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

    await page.getByRole("button", { name: copy.disable }).press("Enter");
    await expect(
      page.getByText(copy.disabled, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Execute", exact: true }),
    ).toHaveCount(0);
  });
}
