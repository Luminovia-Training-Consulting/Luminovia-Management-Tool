import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@supabase/supabase-js";
import { randomUUID, createHmac } from "node:crypto";
import { DateTime } from "luxon";
test.skip(
  process.env.PORTAL_TEST_MODE !== "1",
  "Operations workflows run only through the isolated ./portal test command.",
);
function api(key: string) {
  const url = process.env.SUPABASE_URL!;
  if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname))
    throw new Error("Operations tests require loopback fixtures.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
async function login(page: Page, email = process.env.E2E_LECTURER_EMAIL!) {
  await page.goto("/login");
  await page.getByLabel("E-Mail", { exact: true }).fill(email);
  await page
    .getByLabel("Passwort", { exact: true })
    .fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
}
async function a11y(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  const scan = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    scan.violations.map((item) => ({
      id: item.id,
      nodes: item.nodes.map((node) => ({
        target: node.target,
        summary: node.failureSummary,
      })),
    })),
  ).toEqual([]);
}
function code(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret.replace(/=+$/, "")]
    .map((char) => alphabet.indexOf(char).toString(2).padStart(5, "0"))
    .join("");
  const key = Buffer.from(
    bits.match(/.{8}/g)!.map((byte) => Number.parseInt(byte, 2)),
  );
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac("sha1", key).update(counter).digest();
  return ((digest.readUInt32BE(digest.at(-1)! & 15) & 0x7fffffff) % 1000000)
    .toString()
    .padStart(6, "0");
}
test("readonly operations catalogue is accessible and private client directory is denied", async ({
  page,
}, testInfo) => {
  await login(page);
  await page.goto("/courses");
  await expect(
    page.getByRole("heading", { name: "Kurse", exact: true }),
  ).toBeVisible();
  await a11y(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `docs/screenshots/${testInfo.project.name}-courses.png`,
    fullPage: true,
  });
  await page.goto("/clients");
  await expect(page.getByRole("alert")).toContainText(
    "Für diesen Bereich fehlt dir die Berechtigung.",
  );
});
test("admin persists private customer/contact, course template/run and safe unpublished copy through real UI", async ({
  page,
}, testInfo) => {
  test.setTimeout(100000);
  const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const email = `operations-ui-${randomUUID()}@example.invalid`;
  const created = await service.auth.admin.createUser({
    email,
    password: process.env.E2E_PASSWORD!,
    email_confirm: true,
  });
  expect(created.error).toBeNull();
  const role = await service
    .from("user_roles")
    .insert({ user_id: created.data.user!.id, role: "admin" });
  expect(role.error).toBeNull();
  const client = api(process.env.SUPABASE_ANON_KEY!);
  expect(
    (
      await client.auth.signInWithPassword({
        email,
        password: process.env.E2E_PASSWORD!,
      })
    ).error,
  ).toBeNull();
  const enrolled = await client.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "Operations UI QA",
  });
  expect(enrolled.error).toBeNull();
  expect(
    (
      await client.auth.mfa.challengeAndVerify({
        factorId: enrolled.data!.id,
        code: code(enrolled.data!.totp.secret),
      })
    ).error,
  ).toBeNull();
  await login(page, email);
  await page.goto("/security");
  await page
    .getByLabel("Sechsstelliger Code", { exact: true })
    .fill(code(enrolled.data!.totp.secret));
  await page
    .getByRole("button", { name: "Code bestätigen", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("zwei Faktoren");
  const suffix = randomUUID().slice(0, 8);
  const company = `Fiktive Akademie ${suffix}`;
  const title = `Linux Kurs ${suffix}`;
  const note = `Private contact note ${suffix}`;
  await page.goto("/clients");
  await page
    .getByRole("button", { name: "Organisation anlegen", exact: true })
    .click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name", { exact: true }).fill(company);
  await dialog.getByLabel("Land", { exact: true }).fill("DE");
  await dialog.getByLabel("Ort", { exact: true }).fill("Fiktivstadt");
  await dialog.getByLabel("Branche", { exact: true }).fill("Training");
  await dialog.getByLabel("Interne Notizen", { exact: true }).fill(note);
  await dialog.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("heading", { name: company, exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Kontakt hinzufügen", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name", { exact: true }).fill("Fiktive Kursplanung");
  await dialog
    .getByLabel("Geschäftliche E-Mail", { exact: true })
    .fill("contact@example.invalid");
  await dialog.getByLabel("Telefon", { exact: true }).fill("+490000000");
  await dialog.getByLabel("Kontaktnotizen", { exact: true }).fill(note);
  await dialog.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  // Selection is view state; reselect the saved organisation after the document
  // reload before asserting that its private data was persisted by the server.
  await page.getByRole("button", { name: company, exact: true }).click();
  await expect(page.getByText(note, { exact: true }).first()).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Fiktive Kursplanung", exact: true }),
  ).toBeVisible();
  await a11y(page);
  await page.screenshot({
    path: `docs/screenshots/${testInfo.project.name}-clients.png`,
    fullPage: true,
  });
  await page.goto("/courses");
  await page
    .getByRole("button", { name: "Vorlage anlegen", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Titel", { exact: true }).fill(title);
  await dialog
    .getByLabel("Beschreibung", { exact: true })
    .fill("Fiktiver Kurs für die tatsächliche Browserprüfung.");
  await dialog
    .getByLabel("Lehrplan", { exact: true })
    .fill("Shell, Rechte und Prozesse. <script>alert(1)</script>");
  await dialog
    .getByLabel("Voraussetzungen", { exact: true })
    .fill("Linux Grundlagen");
  await dialog.getByRole("checkbox", { name: "Linux", exact: true }).check();
  await dialog.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(dialog).toBeHidden();
  await page
    .getByRole("button", { name: "Durchführung anlegen", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Kursvorlage", { exact: true })
    .selectOption({ label: title });
  await dialog
    .getByLabel("Organisation", { exact: true })
    .selectOption({ label: company });
  await dialog
    .getByLabel("Ort / Zugangslink", { exact: true })
    .fill("Fiktiver Schulungsraum");
  const first = DateTime.now()
    .setZone("Europe/Berlin")
    .plus({ days: 100 })
    .set({ hour: 9, minute: 0, second: 0 });
  await dialog
    .getByLabel("Beginn 1", { exact: true })
    .fill(first.toFormat("yyyy-MM-dd'T'HH:mm"));
  await dialog
    .getByLabel("Ende 1", { exact: true })
    .fill(first.plus({ hours: 5 }).toFormat("yyyy-MM-dd'T'HH:mm"));
  await dialog
    .getByRole("button", { name: "Termin ergänzen", exact: true })
    .click();
  await dialog
    .getByLabel("Beginn 2", { exact: true })
    .fill(first.plus({ days: 1 }).toFormat("yyyy-MM-dd'T'HH:mm"));
  await dialog
    .getByLabel("Ende 2", { exact: true })
    .fill(first.plus({ days: 1, hours: 5 }).toFormat("yyyy-MM-dd'T'HH:mm"));
  await dialog
    .getByRole("checkbox", { name: "Veröffentlicht", exact: true })
    .check();
  await dialog.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByLabel("Suchen", { exact: true }).fill(title);
  let card = page
    .locator(".operations-course")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
  await expect(card).toHaveCount(1);
  await card.getByRole("button", { name: "Ansehen", exact: true }).click();
  dialog = page.getByRole("dialog");
  await expect(
    dialog.getByText("Shell, Rechte und Prozesse. <script>alert(1)</script>", {
      exact: true,
    }),
  ).toBeVisible();
  expect(await dialog.locator("script").count()).toBe(0);
  await expect(dialog.locator(".session-list li")).toHaveCount(2);
  await dialog.getByRole("button", { name: "Schließen", exact: true }).click();
  await card
    .getByRole("button", { name: "Sicher kopieren", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(
    "keine Aufträge, Verträge, persönlichen Daten",
  );
  await dialog
    .getByRole("button", { name: "Sicher kopieren", exact: true })
    .click();
  await expect(dialog).toBeHidden();
  await expect(card).toHaveCount(2);
  await page.reload();
  await page.getByLabel("Suchen", { exact: true }).fill(title);
  card = page
    .locator(".operations-course")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
  await expect(card).toHaveCount(2);
  expect(await card.filter({ hasText: "Entwurf" }).count()).toBe(1);
  await a11y(page);
});
