import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { actor, login } from "./helpers/accounts-support";

async function checkContrast(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  const result = await new AxeBuilder({ page })
    .withRules(["color-contrast"])
    .analyze();
  expect(
    result.violations.flatMap(({ nodes }) =>
      nodes.map(({ target, failureSummary }) => ({ target, failureSummary })),
    ),
    name,
  ).toEqual([]);
}

test("dark workspace maintains contrast and a usable layout across the main screens", async ({
  page,
}) => {
  test.setTimeout(110_000);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/login");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(
    page.getByRole("button", { name: "Anmelden", exact: true }),
  ).toBeVisible();
  await checkContrast(page, "Sign-in");

  const administrator = await actor(
    "Fictional appearance administrator",
    "admin",
  );
  await login(page, administrator.email);

  for (const [path, heading] of [
    ["/", /Schön, dass du da bist|Willkommen/],
    ["/calendar", /Kalender/],
    ["/chats", /Chat/],
    ["/files", /Datei/],
    ["/finance/accounting", /Buchhaltungsexporte/],
    ["/profile", /Profil/],
  ] as const) {
    if (path !== "/") await page.goto(path);
    await expect(
      page.getByRole("heading", { level: 1, name: heading }).first(),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
      path,
    ).toBe(true);
    await checkContrast(page, path);
  }
  await page.goto("/api/swagger");
  const documentation = page.locator("main.standalone-swagger");
  await expect(
    documentation.getByRole("link", { name: "OpenAPI JSON" }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(documentation.locator(".opblock-tag").first()).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
    "Standalone API documentation",
  ).toBe(true);
  await documentation.getByLabel(/^(Farbschema|Theme)$/).selectOption("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});
