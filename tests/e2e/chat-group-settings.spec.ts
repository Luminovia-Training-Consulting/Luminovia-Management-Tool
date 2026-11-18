/**
 * Browser workflows for real private messages and membership revocation in already-connected sessions.
 * Rendered workflows are checked in isolation; this does not replace manual device/platform acceptance.
 */
import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const isolated = process.env.PORTAL_TEST_MODE === "1";
test.skip(
  !isolated,
  "Chat journeys mutate only the isolated ./portal test environment.",
);
/** Creates a local SDK test client with its own nonpersistent Auth session. */
function localClient(key: string) {
  const url = process.env.SUPABASE_URL!;
  if (
    !url ||
    !["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname)
  )
    throw new Error("Chat fixtures require an isolated loopback backend.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
/** Creates the administrative fixture client; its key stays outside the browser application. */
const service = () => localClient(process.env.SUPABASE_SERVICE_ROLE_KEY!);
interface Account {
  id: string;
  email: string;
  name: string;
}
/** Creates a fictional actor for separate browser/API sessions and later scoped cleanup. */
async function account(label: string): Promise<Account> {
  const tag = randomUUID().slice(0, 8);
  const email = `chat-${label}-${tag}@example.invalid`;
  const name = `Chat QA ${label} ${tag}`;
  const { data, error } = await service().auth.admin.createUser({
    email,
    password: process.env.E2E_PASSWORD!,
    email_confirm: true,
  });
  expect(error).toBeNull();
  const id = data.user!.id;
  const profile = await service()
    .from("profiles")
    .update({ display_name: name })
    .eq("id", id);
  expect(profile.error).toBeNull();
  const role = await service()
    .from("user_roles")
    .insert({ user_id: id, role: "lecturer" });
  expect(role.error).toBeNull();
  return { id, email, name };
}
/** Signs this test actor in through the visible form and waits for confirmed navigation. */
async function login(page: Page, user: Account) {
  await page.goto("/login");
  await page.getByLabel("E-Mail", { exact: true }).fill(user.email);
  await page
    .getByLabel("Passwort", { exact: true })
    .fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/chats");
  await expect(
    page.getByRole("heading", { name: "Chats", exact: true }),
  ).toBeVisible();
}

test("group owner changes information and a member can only read it", async ({
  browser,
  page,
}, testInfo) => {
  test.setTimeout(100_000);
  const owner = await account("owner-settings");
  const member = await account("member-settings");
  const context = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173",
    viewport: testInfo.project.use.viewport,
    isMobile: testInfo.project.use.isMobile,
    hasTouch: testInfo.project.use.hasTouch,
  });
  try {
    await login(page, owner);
    const other = await context.newPage();
    await login(other, member);
    const title = `Original ${randomUUID().slice(0, 8)}`;
    const updated = `Updated ${randomUUID().slice(0, 8)}`;
    await page
      .getByRole("button", { name: "Gruppe erstellen", exact: true })
      .click();
    await page.getByLabel("Gruppenname", { exact: true }).fill(title);
    await page
      .getByRole("checkbox", { name: member.name, exact: true })
      .check();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Gruppe erstellen", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Gruppeninformationen", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Gruppeninformationen" });
    await dialog
      .getByRole("button", { name: "Gruppeninformationen bearbeiten" })
      .click();
    await dialog.getByLabel("Gruppenname").fill(updated);
    await dialog.getByLabel("Beschreibung").fill("Private group description");
    await dialog
      .getByRole("button", { name: "Speichern", exact: true })
      .click();
    await expect(
      dialog.getByText("Private group description", { exact: true }),
    ).toBeVisible();
    await dialog
      .getByRole("button", { name: "Schließen", exact: true })
      .click();
    await expect(page.getByRole("heading", { name: updated })).toBeVisible();
    await other
      .locator(".chat-room-row")
      .filter({ hasText: updated })
      .locator(".chat-room-button")
      .click();
    await other
      .getByRole("button", { name: "Gruppeninformationen", exact: true })
      .click();
    const memberDialog = other.getByRole("dialog", {
      name: "Gruppeninformationen",
    });
    await expect(
      memberDialog.getByText("Private group description", { exact: true }),
    ).toBeVisible();
    await expect(
      memberDialog.getByRole("button", {
        name: "Gruppeninformationen bearbeiten",
      }),
    ).toHaveCount(0);
    await memberDialog
      .getByRole("button", { name: "Schließen", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Mitglieder verwalten", exact: true })
      .click();
    const membersDialog = page.getByRole("dialog", {
      name: "Mitglieder verwalten",
    });
    await membersDialog
      .getByLabel("Verantwortung übertragen an")
      .selectOption({ label: member.name });
    await membersDialog
      .getByRole("button", { name: "Gruppenverantwortung übertragen" })
      .click();
    await page
      .getByRole("dialog", { name: "Gruppenverantwortung übertragen?" })
      .getByRole("button", { name: "Gruppenverantwortung übertragen" })
      .click();
    await expect(
      page.getByText("Die Gruppenverantwortung wurde übertragen."),
    ).toBeVisible();
    await expect(
      page
        .getByRole("dialog")
        .getByRole("button", { name: "Gruppe verlassen", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Gruppe verlassen", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Gruppe verlassen?" })
      .getByRole("button", { name: "Gruppe verlassen" })
      .click();
    await expect(page.getByRole("heading", { name: updated })).toHaveCount(0);
    await other.reload();
    await other.getByRole("button", { name: new RegExp(updated) }).click();
    await expect(other.getByRole("heading", { name: updated })).toBeVisible();
  } finally {
    await context.close();
  }
});
