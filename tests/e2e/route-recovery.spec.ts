import { expect, test } from "@playwright/test";
import { actor, login } from "./helpers/accounts-support";

test("offers a readable recovery path after a route download fails", async ({
  page,
  context,
}, testInfo) => {
  const reviewer = await actor("Fictional route recovery", "lecturer");
  await login(page, reviewer.email);
  const module = "**/src/features/jobs/discovery.tsx*";
  await page.route(module, (route) => route.abort());
  await page.goto("/jobs");
  const heading = page.getByRole("heading", {
    name: /Seite konnte nicht geladen werden|This page could not load/,
  });
  await expect(heading).toBeVisible();
  await expect(
    page.getByText(/Failed to fetch dynamically imported module/),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: /Zur Übersicht|Back to overview/ }),
  ).toBeVisible();
  const retry = page.getByRole("button", {
    name: /Erneut versuchen|Try again/,
  });
  await context.setOffline(true);
  try {
    await expect(retry).toBeDisabled();
    await page.screenshot({
      path: testInfo.outputPath("offline-route-recovery.png"),
    });
  } finally {
    await context.setOffline(false);
  }
  await page.unroute(module);
  await expect(retry).toBeEnabled();
  await retry.click();
  await expect(heading).not.toBeVisible();
  await expect(page).toHaveURL(/\/jobs$/);
});
