import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { actor, login } from "./helpers/accounts-support";

test.skip(
  process.env.PORTAL_TEST_MODE !== "1",
  "Staff contact sharing requires the canonical disposable project.",
);
test("lecturer explicitly shares saved contacts with staff and revokes them across independent sessions", async ({
  page,
  browser,
}, testInfo) => {
  const owner = await actor("Fictional opt-in contact lecturer", "lecturer"),
    peer = await actor("Fictional contact peer", "senior_lecturer");
  const peerContext = await browser.newContext();
  const other = await peerContext.newPage();
  try {
    await login(other, peer.email);
    await other.goto(`/people/${owner.id}`);
    const contact = other.getByRole("region", { name: "Kontakt", exact: true });
    await expect(
      contact.getByText("Keine Kontaktangaben für dein Konto freigegeben.", {
        exact: true,
      }),
    ).toBeVisible();
    await login(page, owner.email);
    await page.goto("/profile");
    await page.getByLabel("Telefon", { exact: true }).fill("+49 40 123456");
    await page
      .getByRole("button", { name: "Profil speichern", exact: true })
      .click();
    const settings = page.locator(".contact-visibility-form");
    await expect(
      settings.getByText("Gespeicherte Telefonnummer: +49 40 123456", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      settings.getByRole("checkbox", {
        name: "E-Mail-Adresse für das Team anzeigen",
        exact: true,
      }),
    ).not.toBeChecked();
    await settings
      .getByRole("checkbox", {
        name: "E-Mail-Adresse für das Team anzeigen",
        exact: true,
      })
      .check();
    await settings
      .getByRole("checkbox", {
        name: "Telefonnummer für das Team anzeigen",
        exact: true,
      })
      .check();
    await settings
      .getByRole("button", { name: "Kontaktfreigabe speichern", exact: true })
      .click();
    await expect(
      settings.getByText("Kontaktfreigabe gespeichert.", { exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      settings.getByRole("checkbox", {
        name: "E-Mail-Adresse für das Team anzeigen",
        exact: true,
      }),
    ).toBeChecked();
    await other.reload();
    await expect(contact.getByText(owner.email, { exact: true })).toBeVisible();
    await expect(
      contact.getByRole("link", { name: "E-Mail schreiben", exact: true }),
    ).toHaveAttribute("href", `mailto:${encodeURIComponent(owner.email)}`);
    await expect(
      contact.getByRole("link", { name: "Anrufen", exact: true }),
    ).toHaveAttribute("href", "tel:+4940123456");
    await peerContext.grantPermissions(["clipboard-read", "clipboard-write"]);
    await contact
      .getByRole("button", { name: "E-Mail-Adresse kopieren", exact: true })
      .click();
    await expect(contact.getByRole("status")).toHaveText(
      "Kontaktangabe kopiert.",
    );
    expect(await other.evaluate(() => navigator.clipboard.readText())).toBe(
      owner.email,
    );
    await contact
      .getByRole("button", { name: "Telefonnummer kopieren", exact: true })
      .click();
    expect(await other.evaluate(() => navigator.clipboard.readText())).toBe(
      "+49 40 123456",
    );

    await page.getByLabel("Sprache", { exact: true }).selectOption("en");
    await page.getByLabel("Theme", { exact: true }).selectOption("dark");
    await expect(
      settings.getByRole("checkbox", {
        name: "Show email address to staff",
        exact: true,
      }),
    ).toBeChecked();
    await page.evaluate(() => document.fonts.ready);
    const scan = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(
      scan.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target),
      })),
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `docs/screenshots/${testInfo.project.name}-staff-contact-settings.png`,
      fullPage: true,
    });
    await settings
      .getByRole("checkbox", {
        name: "Show email address to staff",
        exact: true,
      })
      .uncheck();
    await settings
      .getByRole("checkbox", {
        name: "Show phone number to staff",
        exact: true,
      })
      .uncheck();
    await settings
      .getByRole("button", { name: "Save contact visibility", exact: true })
      .click();
    await expect(
      settings.getByText("Contact visibility saved.", { exact: true }),
    ).toBeVisible();
    await other.reload();
    await expect(
      contact.getByText("Keine Kontaktangaben für dein Konto freigegeben.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(contact.getByRole("link")).toHaveCount(0);
    await expect(
      contact.getByRole("button", { name: /kopieren/i }),
    ).toHaveCount(0);
  } finally {
    await peerContext.close();
  }
});
