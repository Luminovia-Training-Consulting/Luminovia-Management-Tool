import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { actor, api, checked, login } from "./helpers/accounts-support";

async function checkCapturedInvitation(actual: string) {
  const inbox = new URL(process.env.E2E_MAILPIT_URL ?? "http://127.0.0.1:54324");
  expect(inbox.hostname).toBe("127.0.0.1");
  await expect.poll(async () => {
    const messages = await (await fetch(new URL("/api/v1/messages", inbox))).json();
    return messages.messages.filter(
      (message: { To: { Address: string }[] }) => message.To.some(({ Address }) => Address === actual),
    ).length;
  }).toBe(1);
}

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
    "Der Verbindungstest prüft TLS und die Anmeldung beim Mailanbieter.",
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

  await checkCapturedInvitation(actual);
  await expect(recoverable).toHaveCount(0);
});

test("mail administrators recover rejected invitations bound to the original class", async ({ page }) => {
  const admin = await actor("Fictional class mail administrator", "admin");
  const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const adminClient = api(process.env.SUPABASE_ANON_KEY!);
  const [org, template, run] = Array.from({ length: 3 }, randomUUID);
  await checked(adminClient.auth.signInWithPassword({ email: admin.email, password: process.env.E2E_PASSWORD! }));
  await checked(service.from("organisations").insert({ id: org, name: "Fictional recovery company" }));
  await checked(service.from("course_templates").insert({ id: template, title: "Fictional recovery course" }));
  await checked(service.from("course_runs").insert({ id: run, template_id: template, organisation_id: org }));
  await checked(adminClient.rpc("set_company_premium", {
    p_organisation_id: org, p_enabled: true, p_expected_version: 0, p_request_id: randomUUID(),
  }));
  const classOptions = await checked(adminClient.rpc("set_course_class", {
    p_course_id: run, p_class_id: null, p_new_name: "Fictional recovery class", p_expected_version: 0,
  }), { requireData: true });
  const original = `class-typo-${randomUUID()}@example.invalid`;
  const corrected = `class-corrected-${randomUUID()}@example.invalid`;
  const dispatched = await checked(adminClient.rpc("reserve_class_participant_invitation", {
    p_organisation_id: org, p_class_id: classOptions.current.id, p_email: original,
    p_display_name: "Fictional class learner", p_request_id: randomUUID(),
  }), { requireData: true });
  const claim = await checked(service.rpc("claim_company_participant_invitation", {
    p_request_id: dispatched.request_id,
  }), { requireData: true });
  await checked(service.rpc("complete_invitation_delivery_failure", {
    p_invitation_id: claim.invitation_id, p_definite_rejection: true,
  }));
  await checked(service.rpc("finish_company_participant_invitation", {
    p_request_id: dispatched.request_id, p_success: false,
  }));

  await login(page, admin.email);
  await page.goto("/admin/mail");
  const history = page.getByRole("region", { name: "Fehlgeschlagene Zustellungen" });
  const failed = history.getByRole("listitem").filter({ hasText: original });
  await failed.getByLabel("Empfängeradresse für die Einladung").fill(corrected);
  await failed.getByRole("button", { name: "Zustellung erneut anstoßen" }).click();
  await expect(history.getByRole("status")).toContainText("Der Einladungsdienst hat den Versand bestätigt.");
  await checkCapturedInvitation(corrected);
  const repaired = await checked(
    service.from("invitation_requests").select("status,requested_role,organisation_id,retry_of")
      .eq("email", corrected).single(),
    { requireData: true },
  );
  expect(repaired).toMatchObject({
    status: "sent", requested_role: "participant", organisation_id: org, retry_of: claim.invitation_id,
  });
});
