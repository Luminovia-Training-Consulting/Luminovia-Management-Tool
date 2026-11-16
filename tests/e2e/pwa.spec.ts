/**
 * Browser checks for the built public offline shell without private API caches.
 * Service-worker behaviour is exercised in Chromium; physical PWA installation remains separate acceptance.
 */
import { test, expect } from "@playwright/test";

test.skip(
  process.env.E2E_PWA !== "1",
  "Run against a built preview with E2E_PWA=1 and E2E_BASE_URL.",
);

test("built PWA registers its shell, supports offline deep links and never caches private API responses", async ({
  page,
  context,
}) => {
  await page.goto("/login");
  const manifest = await page.evaluate(async () => {
    const href = document.querySelector<HTMLLinkElement>(
      'link[rel="manifest"]',
    )!.href;
    return await (await fetch(href)).json();
  });
  expect(manifest.name).toBe("Luminovia Portal");
  expect(manifest.display).toBe("standalone");
  expect(
    manifest.icons.some(
      (icon: { sizes: string; purpose?: string }) =>
        icon.sizes === "512x512" && icon.purpose === "maskable",
    ),
  ).toBe(true);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(() =>
      page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
    )
    .toBe(true);
  await page
    .getByLabel("E-Mail", { exact: true })
    .fill(process.env.E2E_LECTURER_EMAIL!);
  await page
    .getByLabel("Passwort", { exact: true })
    .fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/jobs");
  await expect(
    page.getByRole("heading", { name: "Aufträge finden", exact: true }),
  ).toBeVisible();
  const cachedUrls = await page.evaluate(async () => {
    const names = await caches.keys();
    return (
      await Promise.all(
        names.map(async (name) =>
          (await (await caches.open(name)).keys()).map(
            (request) => request.url,
          ),
        ),
      )
    ).flat();
  });
  expect(cachedUrls.length).toBeGreaterThan(0);
  for (const url of cachedUrls) {
    expect(new URL(url).origin).toBe(new URL(page.url()).origin);
    expect(new URL(url).pathname).not.toMatch(
      /^\/(rest|storage|functions|auth)\//,
    );
  }
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("status").filter({ hasText: "Du bist offline" }),
  ).toBeVisible();
  const offlineCachedUrls = await page.evaluate(async () => {
    return (
      await Promise.all(
        (await caches.keys()).map(async (name) =>
          (await (await caches.open(name)).keys()).map(
            (request) => request.url,
          ),
        ),
      )
    ).flat();
  });
  expect(offlineCachedUrls).toEqual(cachedUrls);
  await context.setOffline(false);
});
