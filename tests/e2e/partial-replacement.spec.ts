import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { actor, adminLogin, api, checked } from "./helpers/accounts-support";

const day = 86400000;

test.skip(
  process.env.PORTAL_TEST_MODE !== "1",
  "Requires a disposable runtime.",
);

test("staff assigns one future teaching session at a reviewed fee", async ({
  page,
}) => {
  test.setTimeout(90000);
  const tag = randomUUID().slice(0, 8);
  const name = `Fictional cover ${tag}`;
  const manager = await actor(`Fictional manager ${tag}`, "admin");
  const source = await actor(`Fictional source ${tag}`, "lecturer");
  const target = await actor(name, "lecturer");
  const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const job = randomUUID();
  const claim = randomUUID();
  const time = Date.now();
  const slots = [-3, 10, 12].map((date) => ({
    id: randomUUID(),
    starts_at: new Date(time + date * day).toISOString(),
    ends_at: new Date(time + date * day + 3600000).toISOString(),
  }));
  await checked(
    service
      .from("jobs")
      .insert({
        id: job,
        title: `Fictional course ${tag}`,
        customer_name: "Fictional customer",
        status: "filled",
        delivery_type: "online",
        amount: 650,
        total_amount: 650,
        currency: "EUR",
        rate_unit: "fixed_total",
        terms: "Fictional original terms",
      }),
  );
  await checked(
    service
      .from("job_sessions")
      .insert(
        slots.map(({ starts_at, ends_at }) => ({
          job_id: job,
          starts_at,
          ends_at,
        })),
      ),
  );
  await checked(
    service
      .from("job_claims")
      .insert({
        id: claim,
        job_id: job,
        lecturer_id: source.id,
        idempotency_key: randomUUID(),
        status: "confirmed",
        amount: 650,
        total_amount: 650,
        currency: "EUR",
        rate_unit: "fixed_total",
        terms: "Fictional original terms",
        terms_version: 1,
      }),
  );
  await checked(
    service
      .from("assignment_sessions")
      .insert(
        slots.map((slot) => ({
          ...slot,
          claim_id: claim,
          lecturer_id: source.id,
        })),
      ),
  );
  await adminLogin(page, manager);
  await page.goto(`/jobs/${job}`);
  await page
    .getByRole("button", { name: "Einzelne Termine vertreten" })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Teilvertretung bestätigen",
  });
  await expect(dialog.getByRole("checkbox")).toHaveCount(2);
  await dialog.getByRole("checkbox").first().check();
  await dialog.getByLabel("Dozent:innen suchen").pressSequentially(tag);
  const select = dialog.getByLabel("Vertretung", { exact: true });
  await expect(
    select.getByRole("option", { name, exact: true }),
  ).toBeAttached();
  await select.selectOption({ label: name });
  await dialog.getByLabel("Vereinbartes Gesamthonorar (EUR)").fill("210,75");
  await dialog
    .getByLabel("Vereinbarte Konditionen der Vertretung")
    .fill("Fictional agreed cover terms");
  await dialog
    .getByLabel("Grund der Teilvertretung")
    .fill("Fictional approved cover operation");
  await dialog
    .getByRole("button", { name: "Teilvertretung verbindlich zuweisen" })
    .click();
  await expect(
    dialog.getByText("Teilvertretung bestätigt.", { exact: true }),
  ).toBeVisible();
  const replacement = await checked(
    service
      .from("job_claims")
      .select("id,job_id,total_amount,terms")
      .eq("lecturer_id", target.id)
      .single(),
    { requireData: true },
  );
  expect(replacement.total_amount).toBe(210.75);
  expect(replacement.terms).toBe("Fictional agreed cover terms");
  const prior = await checked(
    service
      .from("job_claims")
      .select("total_amount,terms")
      .eq("id", claim)
      .single(),
    { requireData: true },
  );
  expect(prior).toEqual({
    total_amount: 650,
    terms: "Fictional original terms",
  });
  const previousSlots = await checked(
    service
      .from("assignment_sessions")
      .select("id,released_at")
      .eq("claim_id", claim)
      .order("starts_at"),
    { requireData: true },
  );
  expect(previousSlots.map((s) => [s.id, Boolean(s.released_at)])).toEqual([
    [slots[0].id, false],
    [slots[1].id, true],
    [slots[2].id, false],
  ]);
  await dialog.getByRole("link", { name: "Vertretungsauftrag öffnen" }).click();
  await expect(page).toHaveURL(new RegExp(`/jobs/${replacement.job_id}$`));
});
