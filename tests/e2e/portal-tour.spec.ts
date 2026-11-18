/**
 * Authenticated tour acceptance using a fictional actor on the disposable local stack.
 * Unlike the public demo, this signs in through the UI and reads real fixture records.
 */
import { expect, test } from "@playwright/test";
import { actor, api, checked, login } from "./helpers/accounts-support";

// Exercise lecturer-visible sections, focus, resume state and language changes.
// The final read-back checks this actor's profile, claims and private calendar.
test("a real lecturer follows the permission-aware portal tour without changing business records", async ({
  page,
}) => {
  const teacher = await actor("Fictional guided portal lecturer", "lecturer");
  const accessEndpoint = "**/rpc/get_my_permissions**";
  await page.route(accessEndpoint, (route) => route.abort("failed"));
  await login(page, teacher.email);
  await page.goto("/settings");
  const guide = page.getByRole("region", {
    name: "Portal-Rundgang",
    exact: true,
  });
  const launch = guide.getByRole("button", {
    name: "Portal-Rundgang",
    exact: true,
  });
  await expect(guide.getByRole("alert")).toContainText(
    "Die Zugriffsrechte konnten nicht geladen werden",
  );
  await expect(launch).toBeDisabled();
  await page.unroute(accessEndpoint);
  await guide
    .getByRole("button", { name: "Zugriffsrechte erneut laden", exact: true })
    .click();
  await expect(launch).toBeEnabled();
  await expect(launch).toBeFocused();
  await expect(guide.getByRole("alert")).toHaveCount(0);
  await launch.click();
  await expect(guide.getByText(/Du bist im echten Portal/)).toBeVisible();
  const section = guide.getByRole("combobox", {
    name: "Bereich auswählen",
    exact: true,
  });
  const options = await section
    .getByRole("option")
    .evaluateAll((items) =>
      items.map((item) => (item as HTMLOptionElement).value),
    );
  // Management-only sections must not appear in this lecturer's tour selector.
  expect(options).toContain("jobs");
  expect(options).not.toContain("accounts");
  expect(options).not.toContain("audit");
  expect(options).not.toContain("clients");
  await section.selectOption("jobs");
  await expect(page).toHaveURL((url) => url.pathname === "/jobs");
  await expect(
    guide.getByRole("heading", { name: "Aufträge übernehmen", exact: true }),
  ).toBeFocused();
  await guide.getByRole("button", { name: "Pausieren", exact: true }).click();
  await page.reload();
  const resume = guide.getByRole("button", {
    name: "Rundgang fortsetzen",
    exact: true,
  });
  await expect(resume).toBeEnabled();
  await resume.click();
  await expect(
    guide.getByRole("combobox", { name: "Bereich auswählen", exact: true }),
  ).toHaveValue("jobs");
  await page
    .locator(".topbar-actions .preferences select[aria-label='Sprache']")
    .selectOption("en");
  const englishGuide = page.getByRole("region", {
    name: "Portal tour",
    exact: true,
  });
  const englishSection = englishGuide.getByRole("combobox", {
    name: "Choose a section",
    exact: true,
  });
  await expect(englishSection).toHaveValue("jobs");
  await englishSection.selectOption("calendar");
  await expect(page).toHaveURL((url) => url.pathname === "/calendar");
  await expect(
    englishGuide.getByRole("link", {
      name: "Help with this section",
      exact: true,
    }),
  ).toHaveAttribute("href", "/help?topic=calendar");
  await englishGuide.locator("h2").focus();
  await page.keyboard.press("Escape");
  await expect(
    englishGuide.getByRole("button", { name: "Resume tour", exact: true }),
  ).toBeFocused();
  await expect(englishGuide.getByRole("progressbar")).toHaveCount(0);
  // Privileged reads inspect only this fictional actor; browser actions use the
  // signed-in lecturer. These assertions cover the listed records, not all tables.
  const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const profile = await checked(
    service
      .from("profiles")
      .select("display_name")
      .eq("id", teacher.id)
      .single(),
  );
  expect(profile.display_name).toBe(teacher.name);
  expect(
    await checked(
      service.from("job_claims").select("id").eq("lecturer_id", teacher.id),
    ),
  ).toEqual([]);
  expect(
    await checked(
      service.from("personal_events").select("id").eq("user_id", teacher.id),
    ),
  ).toEqual([]);
});
