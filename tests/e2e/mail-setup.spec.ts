import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
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
  await expect(settings).toContainText(
    "Der Verbindungstest prüft TLS und die Anmeldung.",
  );
  await expect(settings).toContainText(
    "Eine Testmail geht an die bestätigte E-Mail-Adresse deines Portalkontos.",
  );

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

  await page.getByRole("link", { name: "Vollreset" }).click();
  await expect(
    page.getByRole("heading", { name: "Vollreset" }),
  ).toBeVisible();
  await expect(page.getByText("Dauerhafte Datenlöschung")).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Alle Daten dieser Installation löschen",
    }),
  ).toBeDisabled();
});

test("mail administrators can correct a rejected invitation while ambiguous messages stay locked", async ({
  page,
}) => {
  const admin = await actor("Fictional delivery administrator", "admin");
  const lecturer = await actor("Fictional delivery reader", "lecturer");
  const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const typo = `wrong-${randomUUID()}@example.invalid`;
  const actual = `correct-${randomUUID()}@example.invalid`;
  const ambiguous = `ambiguous-${randomUUID()}@example.invalid`;
  await checked(service.from("invitation_requests").insert([
    {
      actor_id: admin.id, idempotency_key: randomUUID(), email: typo, status: "failed",
      delivery_rejected: true, completed_at: new Date().toISOString(), display_name: "Fictional learner",
    },
    {
      actor_id: admin.id, idempotency_key: randomUUID(), email: ambiguous, status: "failed",
      delivery_rejected: false, completed_at: new Date().toISOString(), display_name: "Fictional learner",
    },
  ]));
  const caller = api(process.env.SUPABASE_ANON_KEY!);
  await checked(caller.auth.signInWithPassword({
    email: lecturer.email,
    password: process.env.E2E_PASSWORD!,
  }));
  const denied = await caller.rpc("mail_delivery_failures", {}, { get: true });
  expect(denied.status).toBe(403);

  await login(page, admin.email);
  await page.goto("/admin/mail");
  const history = page.getByRole("region", { name: "Fehlgeschlagene Zustellungen" });
  const uncertain = history.getByRole("listitem").filter({ hasText: ambiguous });
  await expect(uncertain).toContainText("Annahme durch den Mailserver unklar");
  await expect(uncertain.getByRole("button", { name: "Zustellung erneut anstoßen" })).toHaveCount(0);
  const recoverable = history.getByRole("listitem").filter({ hasText: typo });
  await recoverable.getByLabel("Empfängeradresse für die Einladung").fill(actual);
  await recoverable.getByRole("button", { name: "Zustellung erneut anstoßen" }).click();
  await expect(history.getByRole("status")).toContainText("Der Einladungsdienst hat den Versand bestätigt.");

  const inbox = new URL(process.env.E2E_MAILPIT_URL ?? "http://127.0.0.1:54324");
  expect(inbox.hostname).toBe("127.0.0.1");
  await expect.poll(async () => {
    const messages = await (await fetch(new URL("/api/v1/messages", inbox))).json();
    return messages.messages.filter(
      (message: { To: { Address: string }[] }) => message.To.some(({ Address }) => Address === actual),
    ).length;
  }).toBe(1);
  await expect(recoverable).toHaveCount(0);
});
