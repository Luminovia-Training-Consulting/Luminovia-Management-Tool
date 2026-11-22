/** Old invitations and bookmarks lead to the normal offer list. */
import { expect, test } from "@playwright/test";
import { actor, login } from "./helpers/accounts-support";

test("the old replacement route opens the ordinary job marketplace", async ({
  page,
}) => {
  const lecturer = await actor(
    "Fictional legacy job link lecturer",
    "lecturer",
  );
  await login(page, lecturer.email);
  await page.goto("/replacements");
  await expect(page).toHaveURL(/\/jobs(?:\?.*)?$/);
  const workspace = page.getByRole("main");
  await expect(workspace).toBeVisible();
  await expect(workspace.locator(".replacement-card")).toHaveCount(0);
  await expect(workspace.getByText("Ersatzbörse", { exact: true })).toHaveCount(
    0,
  );
});
