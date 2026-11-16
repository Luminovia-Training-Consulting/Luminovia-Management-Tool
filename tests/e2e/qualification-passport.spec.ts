/** Real profile action downloads the protected PDF; the canonical fixture owns
 * its fictional identity and removes it even if a browser assertion fails. */
import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { actor, api, checked, login } from "./helpers/accounts-support";
test.skip(
  process.env.PORTAL_TEST_MODE !== "1",
  "Only canonical disposable account fixtures.",
);
test("own profile explicitly downloads its passport and blocks offline export", async ({
  page,
  context,
}) => {
  const teacher = await actor("Fictional Passport Browser", "lecturer");
  const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
  try {
    await login(page, teacher.email);
    await page.goto("/profile");
    const button = page.getByRole("button", {
      name: "Qualifikationspass als PDF herunterladen",
      exact: true,
    });
    await expect(button).toBeEnabled();
    const waiting = page.waitForEvent("download");
    await button.click();
    const download = await waiting;
    expect(download.suggestedFilename()).toBe(
      "Luminovia-Qualifikationspass.pdf",
    );
    expect(
      (await readFile((await download.path())!)).subarray(0, 5).toString(),
    ).toBe("%PDF-");
    await context.setOffline(true);
    await expect(button).toBeDisabled();
  } finally {
    await context.setOffline(false);
    await checked(service.auth.admin.deleteUser(teacher.id));
  }
});
