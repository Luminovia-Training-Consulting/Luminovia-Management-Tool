/** Sign in as a fictional platform owner and verify the scoped account UI. */
import { expect, test } from "@playwright/test";
import { actor, api, checked, login } from "./helpers/accounts-support";

test.skip(
  process.env.PORTAL_TEST_MODE !== "1",
  "Owner account fixtures require the isolated portal test stack.",
);

test("platform owner can review administrator roles while owner accounts stay protected", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const users: Awaited<ReturnType<typeof actor>>[] = [];
  try {
    const owner = await actor("Fictional platform owner", "owner");
    users.push(owner);
    const peer = await actor("Fictional peer platform owner", "owner");
    users.push(peer);
    const admin = await actor("Fictional subordinate administrator", "admin");
    users.push(admin);

    await login(page, owner.email);
    await page.goto("/admin/accounts");
    await expect(
      page.getByRole("heading", { name: "Konten & Zugänge", exact: true }),
    ).toBeVisible();
    const search = page.getByRole("searchbox", {
      name: "Konten suchen",
      exact: true,
    });
    const accountRow = (email: string) =>
      page
        .locator(".account-list")
        .getByRole("listitem")
        .filter({
          has: page.getByText(email, { exact: true }),
        });
    const rolesButton = { name: "Rollen bearbeiten", exact: true };

    for (const protectedOwner of [owner, peer]) {
      await search.fill(protectedOwner.email);
      const row = accountRow(protectedOwner.email);
      await expect(
        row.getByText("Plattformleitung", { exact: true }),
      ).toBeVisible();
      await expect(row.getByRole("button", rolesButton)).toHaveCount(0);
    }

    await search.fill(admin.email);
    await accountRow(admin.email).getByRole("button", rolesButton).click();
    const roles = page.getByRole("dialog", rolesButton);
    await expect(
      roles.getByRole("checkbox", { name: "Administration", exact: true }),
    ).toBeChecked();
    await expect(
      roles.getByRole("checkbox", { name: "Plattformmanagement", exact: true }),
    ).toBeEnabled();
    await expect(
      roles.getByRole("checkbox", {
        name: "Plattformleitung",
        exact: true,
      }),
    ).toHaveCount(0);
    await roles.getByRole("button", { name: "Schließen", exact: true }).click();
    await expect(roles).toHaveCount(0);
  } finally {
    for (const user of users.reverse()) {
      await checked(service.auth.admin.deleteUser(user.id));
    }
  }
});
