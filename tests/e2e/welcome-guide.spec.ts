import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { actor, api, checked, login } from "./helpers/accounts-support";

test("a new account follows a bilingual welcome guide with persistent pause, resume and replay", async ({
  page,
  context,
}, testInfo) => {
  const user = await actor("Fictional welcome-guide lecturer", "lecturer");
  const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
  try {
    await login(page, user.email);
    const guide = page.getByRole("region", {
      name: "Willkommen bei Luminovia",
      exact: true,
    });
    await expect(
      guide.getByRole("heading", {
        name: "Dein persönlicher Start",
        exact: true,
      }),
    ).toBeVisible();
    await guide.getByRole("button", { name: "Weiter", exact: true }).click();
    await expect(
      guide.getByRole("heading", { name: "Profil und Zeitzone", exact: true }),
    ).toBeVisible();
    await guide
      .getByRole("link", { name: "Bereich öffnen", exact: true })
      .click();
    await expect(page).toHaveURL(/\/profile$/);
    // A full navigation proves server persistence, rather than component local state.
    await page.goto("/welcome");
    await expect(
      guide.getByRole("heading", { name: "Profil und Zeitzone", exact: true }),
    ).toBeVisible();
    await guide
      .getByRole("button", { name: "Später fortsetzen", exact: true })
      .click();
    await expect(guide.getByText(/Einführung ist pausiert/)).toBeVisible();
    await page.reload();
    await expect(
      guide.getByRole("button", { name: "Einführung fortsetzen", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("combobox", { name: "Sprache", exact: true })
      .selectOption("en");
    const english = page.getByRole("region", {
      name: "Welcome to Luminovia",
      exact: true,
    });
    await english
      .getByRole("button", { name: "Resume introduction", exact: true })
      .click();
    await expect(
      english.getByRole("heading", {
        name: "Profile and time zone",
        exact: true,
      }),
    ).toBeVisible();
    await context.setOffline(true);
    await expect(
      english.getByRole("button", { name: "Next", exact: true }),
    ).toBeDisabled();
    await context.setOffline(false);
    await expect(
      english.getByRole("button", { name: "Next", exact: true }),
    ).toBeEnabled();
    for (let count = 0; count < 20; count++) {
      const next = english.getByRole("button", { name: "Next", exact: true });
      if (!(await next.count())) break;
      const counter = await english.locator(".welcome-counter").textContent();
      await next.click();
      await expect(english.locator(".welcome-counter")).not.toHaveText(
        counter!,
      );
    }
    await expect(
      english.getByRole("heading", {
        name: "Ready for your daily work",
        exact: true,
      }),
    ).toBeVisible();
    const accessibility = await new AxeBuilder({ page })
      .include(".welcome-guide")
      .analyze();
    expect(accessibility.violations).toEqual([]);
    await testInfo.attach("welcome-guide", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
    await english
      .getByRole("button", { name: "Complete introduction", exact: true })
      .click();
    await expect(
      english.getByText(/You have completed the introduction/),
    ).toBeVisible();
    await page.goto("/");
    await expect(
      page.getByRole("region", { name: "Welcome to Luminovia", exact: true }),
    ).toHaveCount(0);
    await page.goto("/welcome");
    await english
      .getByRole("button", { name: "Restart introduction", exact: true })
      .click();
    await expect(
      english.getByRole("heading", {
        name: "Your personal starting point",
        exact: true,
      }),
    ).toBeVisible();
    await english
      .getByRole("button", { name: "Skip introduction", exact: true })
      .click();
    await expect(
      english.getByText(/You skipped the introduction/),
    ).toBeVisible();
    await page.goto("/");
    await expect(
      page.getByRole("region", { name: "Welcome to Luminovia", exact: true }),
    ).toHaveCount(0);
  } finally {
    await context.setOffline(false);
    await checked(service.auth.admin.deleteUser(user.id));
  }
});
