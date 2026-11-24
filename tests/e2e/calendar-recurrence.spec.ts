import { expect, test } from "@playwright/test";
import { DateTime } from "luxon";
import { randomUUID } from "node:crypto";
import { actor, api, checked, login } from "./helpers/accounts-support";

test.skip(
  process.env.PORTAL_TEST_MODE !== "1",
  "Private recurrence runs only in the isolated browser test project.",
);

test("previews a custom appointment series and saves its exact dates after confirmation", async ({
  page,
}) => {
  const owner = await actor("Private series owner", "lecturer");
  const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const title = `Private series ${randomUUID().slice(0, 8)}`;
  const zone = "Europe/Berlin";
  const start = DateTime.now()
    .setZone(zone)
    .plus({ days: 1 })
    .startOf("day")
    .plus({ hours: 10 });
  const local = (value: DateTime) => value.toFormat("yyyy-MM-dd'T'HH:mm");
  const savedRows = () =>
    checked(
      service
        .from("personal_events")
        .select("starts_at,ends_at,recurrence_series_id")
        .eq("user_id", owner.id)
        .eq("title", title)
        .order("starts_at"),
      { requireData: true },
    );
  try {
    await login(page, owner.email);
    await page.goto("/calendar");
    await page
      .getByRole("button", { name: "Privaten Termin hinzufügen", exact: true })
      .click();
    const editor = page.getByRole("dialog", {
      name: "Privaten Termin hinzufügen",
      exact: true,
    });
    await editor.getByLabel("Titel", { exact: true }).fill(title);
    await editor.getByLabel("Zeitzone", { exact: true }).selectOption(zone);
    await editor.getByLabel("Beginn", { exact: true }).fill(local(start));
    await editor
      .getByLabel("Ende", { exact: true })
      .fill(local(start.plus({ hours: 1 })));
    await editor
      .getByLabel("Wiederholung", { exact: true })
      .selectOption("weekly");
    await editor.getByLabel("Alle … Wochen", { exact: true }).fill("2");
    await editor.getByLabel("Anzahl der Termine", { exact: true }).fill("6");
    await expect(editor.getByRole("status")).toHaveText(
      "6 Termine · Europe/Berlin",
    );
    const disclosure = editor.getByText("Weitere Termine anzeigen", {
      exact: true,
    });
    await disclosure.focus();
    await disclosure.press("Enter");
    await expect(disclosure.locator("..")).toHaveAttribute("open", "");
    expect(
      await editor.evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1,
      ),
    ).toBe(true);
    await editor
      .getByRole("button", { name: "Terminserie prüfen", exact: true })
      .click();
    const review = page.getByRole("dialog", {
      name: "Terminserie prüfen",
      exact: true,
    });
    await expect(review.getByRole("listitem")).toHaveCount(6);
    expect(await savedRows()).toEqual([]);
    await review
      .getByRole("button", { name: "Terminserie speichern", exact: true })
      .click();
    await expect(review).toBeHidden();
    const rows = await savedRows();
    expect(rows).toHaveLength(6);
    expect(rows[0].recurrence_series_id).toBeTruthy();
    expect(new Set(rows.map((row) => row.recurrence_series_id)).size).toBe(1);
    expect(rows.map((row) => new Date(row.starts_at).toISOString())).toEqual(
      Array.from({ length: 6 }, (_, index) =>
        start
          .plus({ weeks: 2 * index })
          .toUTC()
          .toISO(),
      ),
    );
    expect(rows.map((row) => new Date(row.ends_at).toISOString())).toEqual(
      Array.from({ length: 6 }, (_, index) =>
        start
          .plus({ weeks: 2 * index, hours: 1 })
          .toUTC()
          .toISO(),
      ),
    );
  } finally {
    await checked(
      service.from("personal_events").delete().eq("user_id", owner.id),
    );
    await checked(service.auth.admin.deleteUser(owner.id));
  }
});
