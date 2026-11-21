import { expect, type Page, test } from "@playwright/test";
import { actor, login } from "./helpers/accounts-support";

test.skip(
  process.env.PORTAL_TEST_MODE !== "1",
  "Use the isolated portal stack.",
);

/** Filter before selecting so Swagger renders the requested virtualized row. */
async function operation(page: Page, method: "get" | "post", path: string) {
  const search = page.getByRole("searchbox", { name: "Schnittstellen suchen" });
  await search.fill(`${method} ${path}`);
  await search.press("Enter");
  return page.locator(`.opblock-${method} .opblock-summary-control`).filter({
    has: page.locator(`[data-path="${path}"]`),
  });
}

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
      "/rest/v1/rpc/portal_access": {
        post: { operationId: "native_portal_access" },
      },
    },
  });

  await page.goto("/api/docs");
  await expect(page).toHaveURL(/\/login$/);
  await login(page, account.email);
  await page.goto("/api/docs");
  await expect(
    page.getByRole("heading", { name: "API-Dokumentation" }),
  ).toBeVisible();
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
  await page.goto("/api/docs");
  await expect(
    page.getByRole("heading", { name: "API-Dokumentation" }),
  ).toBeVisible();
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
});
