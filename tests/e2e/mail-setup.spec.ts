import { expect, test } from "@playwright/test";
import { actor, api, checked, login } from "./helpers/accounts-support";

test("reports invitation and relay switches only to current mail administrators", async ({
  page,
}) => {
  const admin = await actor("Fictional mail setup administrator", "admin");
  const lecturer = await actor("Fictional mail setup lecturer", "lecturer");
  await login(page, admin.email);
  await page.goto("/admin/mail");

  const settings = page.getByRole("region", { name: "Einrichtung prüfen" });
  await expect(settings).toBeVisible();
  await expect(settings).toContainText(
    "Der Server erlaubt E-Mail-Einladungen.",
  );
  await expect(settings).toContainText("Der Mail-Relay fehlt.");
  await expect(settings).toContainText("ohne E-Mail-Versand");

  const client = api(process.env.SUPABASE_ANON_KEY!);
  await checked(
    client.auth.signInWithPassword({
      email: lecturer.email,
      password: process.env.E2E_PASSWORD!,
    }),
  );
  const denied = await client.functions.invoke("mail-admin", { method: "GET" });
  expect(denied.response?.status).toBe(403);
  expect(denied.data).toBeNull();

  await page.getByRole("link", { name: "Systembetrieb" }).click();
  await expect(
    page.getByRole("heading", { name: "Systembetrieb" }),
  ).toBeVisible();
  await expect(page.getByText("Dauerhafte Datenlöschung")).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Alle Daten dieser Installation löschen",
    }),
  ).toBeDisabled();
});
