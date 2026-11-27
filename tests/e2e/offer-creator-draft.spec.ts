/** Verify incomplete offer recovery and confirmation in the real desktop and mobile application. */
import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { actor, api, checked, login } from "./helpers/accounts-support";

test("restores a standalone offer after a reload and confirms it once", async ({
  page,
}) => {
  const container = process.env.PORTAL_DB_CONTAINER;
  if (
    process.env.PORTAL_TEST_MODE !== "1" ||
    !container ||
    !/^supabase_db_luminovia-portal-test-[a-f0-9]+$/.test(container)
  )
    throw new Error("Offer fixtures require the owned disposable portal");
  const manager = await actor("Fictional draft editor", "management");
  const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const title =
    "Fictional long-running teaching offer for multiple departments " +
    randomUUID();
  try {
    await login(page, manager.email);
    await page.getByLabel(/^(Sprache|Language)$/).selectOption("de");
    await page.getByLabel(/^(Farbschema|Theme)$/).selectOption("dark");
    await page.goto("/admin?create=job");

    await page.getByLabel("Titel", { exact: true }).fill(title);
    await page
      .getByLabel("Beschreibung", { exact: true })
      .fill("Recover the exact unsent description.");
    await page
      .getByRole("button", { name: "Zwischenstand speichern", exact: true })
      .click();
    await expect(
      page.getByText("Entwurf auf dem Server gespeichert."),
    ).toBeVisible();
    expect(
      await checked(service.from("jobs").select("id").eq("title", title)),
    ).toEqual([]);

    await page.reload();
    await page
      .getByRole("button", { name: "Gespeicherte Angebotsentwürfe" })
      .click();
    const library = page.getByRole("dialog", {
      name: "Gespeicherte Angebotsentwürfe",
    });
    const draftRow = library.getByRole("listitem").filter({ hasText: title });
    await expect(draftRow).toBeVisible();
    const resumeDraft = draftRow.getByRole("button", {
      name: "Weiterbearbeiten",
    });
    await expect
      .poll(async () => {
        const heading = await draftRow.getByText(title).boundingBox();
        const action = await resumeDraft.boundingBox();
        if (!heading || !action) return false;
        return (
          action.y >= heading.y + heading.height + 8 &&
          action.height >= 44 &&
          Math.abs(action.x - heading.x) <= 1
        );
      })
      .toBe(true);
    await expect
      .poll(() =>
        library.evaluate(
          (element) => element.scrollWidth <= element.clientWidth + 1,
        ),
      )
      .toBe(true);
    await resumeDraft.click();
    await expect(page.getByLabel("Titel", { exact: true })).toHaveValue(title);
    await expect(page.getByLabel("Beschreibung", { exact: true })).toHaveValue(
      "Recover the exact unsent description.",
    );
    await page
      .getByLabel("Unternehmen", { exact: true })
      .fill("Fictional training company");
    await page
      .getByLabel("Konditionen", { exact: true })
      .fill("Fictional reviewed terms");
    await page
      .getByRole("button", { name: "Auftrag speichern", exact: true })
      .click();
    await expect(
      page.getByText("Auftrag gespeichert.", { exact: true }),
    ).toBeVisible();
    const jobs = await checked(
      service.from("jobs").select("id,status").eq("title", title),
    );
    expect(jobs).toEqual([{ id: expect.any(String), status: "draft" }]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  } finally {
    // Only this run's fictional draft and unpublished assignment are removed.
    execFileSync(
      "docker",
      [
        "exec",
        "-i",
        container,
        "psql",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-X",
        "-q",
        "-v",
        "ON_ERROR_STOP=1",
      ],
      {
        input: `begin;
        delete from private.training_offer_creator_drafts where owner_id='${manager.id}';
        delete from private.job_lifecycle_requests where actor_id='${manager.id}';
        delete from public.jobs where created_by='${manager.id}' and title='${title}';
        commit;`,
      },
    );
    await checked(service.auth.admin.deleteUser(manager.id));
  }
});
