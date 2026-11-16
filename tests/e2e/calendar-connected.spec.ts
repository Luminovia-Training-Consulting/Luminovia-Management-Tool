import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { actor, api, checked, login } from "./helpers/accounts-support";
test("calendar secret links and explicit minimal offline schedule survive reload and clear on logout", async ({
  page,
}) => {
  const owner = await actor(
      "Fictional connected calendar lecturer",
      "lecturer",
    ),
    service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const job = randomUUID(),
    claim = randomUUID(),
    assignment = randomUUID(),
    privateEvent = randomUUID();
  const starts = new Date(Date.now() + 2 * 86400000).toISOString(),
    ends = new Date(Date.now() + 2 * 86400000 + 3600000).toISOString();
  try {
    await checked(
      service
        .from("jobs")
        .insert({
          id: job,
          title: "Fictional offline teaching",
          customer_name: "PRIVATE CUSTOMER",
          delivery_type: "online",
          status: "filled",
          location: "https://private.invalid/class",
          amount: 321,
          currency: "EUR",
          rate_unit: "fixed_total",
          total_amount: 321,
          terms: "PRIVATE COMMERCIAL TERMS",
        }),
    );
    await checked(
      service
        .from("job_claims")
        .insert({
          id: claim,
          job_id: job,
          lecturer_id: owner.id,
          idempotency_key: randomUUID(),
          amount: 321,
          currency: "EUR",
          rate_unit: "fixed_total",
          total_amount: 321,
          terms: "PRIVATE COMMERCIAL TERMS",
          terms_version: 1,
        }),
    );
    await checked(
      service
        .from("assignment_sessions")
        .insert({
          id: assignment,
          claim_id: claim,
          lecturer_id: owner.id,
          starts_at: starts,
          ends_at: ends,
        }),
    );
    await checked(
      service
        .from("personal_events")
        .insert({
          id: privateEvent,
          user_id: owner.id,
          title: "PRIVATE APPOINTMENT",
          starts_at: new Date(Date.now() + 4 * 86400000).toISOString(),
          ends_at: new Date(Date.now() + 4 * 86400000 + 3600000).toISOString(),
          time_zone: "Europe/Berlin",
        }),
    );
    await login(page, owner.email);
    await page.goto("/calendar");
    await page.getByText("Kalender abonnieren", { exact: true }).click();
    await page
      .getByRole("button", { name: "Kalenderadresse erstellen", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("Name des Kalenderabos", { exact: true })
      .fill("Fictional Google calendar");
    await expect(
      dialog.getByRole("checkbox", {
        name: "Auch meine privaten Termine ausdrücklich freigeben",
        exact: true,
      }),
    ).not.toBeChecked();
    await dialog
      .getByRole("button", {
        name: "Neue geheime Adresse bestätigen",
        exact: true,
      })
      .click();
    const address = page.getByLabel("Geheime Kalenderadresse", { exact: true });
    await expect(address).toHaveAttribute("type", "password");
    expect(
      (await address.inputValue()).includes(
        "/functions/v1/calendar-feed?token=",
      ),
    ).toBe(true);
    await page.reload();
    await page.getByText("Kalender abonnieren", { exact: true }).click();
    await expect(
      page.getByText("Fictional Google calendar", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByLabel("Geheime Kalenderadresse", { exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Adresse widerrufen", exact: true })
      .click();
    await expect(page.getByText("Widerrufen", { exact: true })).toBeVisible();
    await page
      .getByText("Unterrichtsplan offline bereithalten", { exact: true })
      .click();
    await page
      .getByRole("button", {
        name: "Unterrichtsplan für offline speichern",
        exact: true,
      })
      .click();
    await expect(
      page.getByText("Die reduzierte Offline-Vorschau wurde gespeichert.", {
        exact: true,
      }),
    ).toBeVisible();
    const readSnapshot = () =>
      page.evaluate(
        () =>
          new Promise<unknown>((resolve, reject) => {
            const open = indexedDB.open("luminovia-offline-schedule", 1);
            open.onerror = reject;
            open.onsuccess = () => {
              const database = open.result,
                request = database
                  .transaction("snapshot")
                  .objectStore("snapshot")
                  .get("current");
              request.onsuccess = () => {
                database.close();
                resolve(request.result);
              };
            };
          }),
      );
    const snapshot = (await readSnapshot()) as { items: { title: string }[] };
    expect(snapshot.items[0].title).toBe("Fictional offline teaching");
    expect(JSON.stringify(snapshot)).not.toContain("PRIVATE");
    expect(JSON.stringify(snapshot)).not.toContain("https://");
    await page.context().setOffline(true);
    await expect(
      page.getByRole("button", {
        name: "Unterrichtsplan für offline speichern",
        exact: true,
      }),
    ).toBeDisabled();
    await expect(
      page.getByText(/Gespeicherte Vorschau: Änderungen und Absagen/),
    ).toBeVisible();
    await page.context().setOffline(false);
    await page.getByRole("button", { name: "Abmelden", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect.poll(async () => Boolean(await readSnapshot())).toBe(false);
  } finally {
    await page.context().setOffline(false);
    await checked(
      service.from("notifications").delete().eq("user_id", owner.id),
    );
    await checked(
      service.from("personal_events").delete().eq("id", privateEvent),
    );
    await checked(
      service.from("assignment_sessions").delete().eq("id", assignment),
    );
    await checked(service.from("job_claims").delete().eq("id", claim));
    await checked(service.from("jobs").delete().eq("id", job));
    await checked(
      service.from("audit_events").delete().eq("actor_id", owner.id),
    );
    await checked(service.auth.admin.deleteUser(owner.id));
  }
});
